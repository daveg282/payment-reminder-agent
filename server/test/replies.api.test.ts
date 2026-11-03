import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mocked Gmail (records any send) and mocked Gemini classification.
const gmail = vi.hoisted(() => ({ send: vi.fn(), messageIdHeader: vi.fn(), threadMessages: vi.fn(), messageText: vi.fn() }));
vi.mock('../src/services/gmail', () => ({ gmailFor: () => gmail }));
const ai = vi.hoisted(() => ({ classifyReply: vi.fn() }));
vi.mock('../src/services/gemini', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/gemini')>()),
  classifyReply: ai.classifyReply,
}));

import { createApp } from '../src/app';
import { getPool } from '../src/db';
import { GeminiUnavailableError } from '../src/services/gemini';
import { count, hasTestDb, loggedInAgent, useTestDb } from './helpers';

const TODAY = '2026-11-03';
const OURS = { id: 'gm-1', internalDate: 1_000, from: 'Sam Sender <owner@example.com>' };
const customerMsg = (id: string, internalDate = 2_000) => ({ id, internalDate, from: 'Demo Client <demo@example.com>' });
const verdict = (classification: string, promise_date: string | null = null, confidence = 0.9) => ({
  ok: true,
  value: { classification, promise_date, confidence },
});

/** An open invoice with a sent stage-2 reminder in thread th-1, plus a pending stage-3 draft. */
async function seed() {
  const db = getPool();
  await db.query(`insert into google_tokens (id, refresh_token, email) values (1, 'refresh-123', 'Owner@example.com')`);
  const { rows: [c] } = await db.query(`insert into customers (name, email, kind) values ('Demo Client', 'demo@example.com', 'one_off') returning id`);
  const { rows: [i] } = await db.query(
    `insert into invoices (customer_id, invoice_ref, amount, issue_date, due_date) values ($1, 'DEMO-001', 500, '2026-09-24', '2026-10-24') returning id`,
    [c.id],
  );
  await db.query(
    `insert into reminders (invoice_id, stage, tone, subject, body, status, gmail_message_id, gmail_thread_id, sent_at)
     values ($1, 2, 'friendly', 'Invoice DEMO-001', 'b', 'sent', 'gm-1', 'th-1', now())`,
    [i.id],
  );
  const { rows: [draft] } = await db.query(
    `insert into reminders (invoice_id, stage, tone, subject, body) values ($1, 3, 'firm', 'Re: Invoice DEMO-001', 'b') returning id`,
    [i.id],
  );
  return { invoiceId: i.id as string, draftId: draft.id as string };
}

const invoiceRow = async (id: string) => (await getPool().query('select promise_date, status from invoices where id = $1', [id])).rows[0];
const reminderStatus = async (id: string) => (await getPool().query('select status from reminders where id = $1', [id])).rows[0].status;
const replies = async () => (await getPool().query('select gmail_message_id, classification, extracted_date, status, snippet from replies order by received_at')).rows;

describe.skipIf(!hasTestDb)('reply detection (mocked Gmail + Gemini)', () => {
  useTestDb();
  beforeEach(() => {
    gmail.send.mockReset();
    gmail.threadMessages.mockReset().mockResolvedValue([OURS, customerMsg('cust-1')]);
    gmail.messageText.mockReset().mockResolvedValue("Sorry! I'll pay next Friday.\n\nOn Tue, Nov 3, 2026 at 12:47 PM Sam <owner@example.com> wrote:\n> Hi Demo Client");
    ai.classifyReply.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('a promise sets promise_date, skips the open draft, and is processed only once', async () => {
    const { invoiceId, draftId } = await seed();
    ai.classifyReply.mockResolvedValue(verdict('promise_to_pay', '2026-11-06'));
    const agent = await loggedInAgent();
    const res = await agent.post(`/jobs/run-now?today=${TODAY}`).expect(200);
    expect(res.body).toMatchObject({ repliesProcessed: 1, errors: [] });

    // Gemini gets the stripped text, today's date and the due date.
    expect(ai.classifyReply).toHaveBeenCalledWith({ text: "Sorry! I'll pay next Friday.", today: TODAY, dueDate: '2026-10-24', invoiceRef: 'DEMO-001', amount: 500, currency: 'USD' });
    expect(await replies()).toEqual([{ gmail_message_id: 'cust-1', classification: 'promise_to_pay', extracted_date: '2026-11-06', status: 'new', snippet: "Sorry! I'll pay next Friday." }]);
    expect(await invoiceRow(invoiceId)).toEqual({ promise_date: '2026-11-06', status: 'open' });
    expect(await reminderStatus(draftId)).toBe('skipped');

    const again = await agent.post(`/jobs/run-now?today=${TODAY}`).expect(200);
    expect(again.body.repliesProcessed).toBe(0);
    expect(ai.classifyReply).toHaveBeenCalledTimes(1);
    expect(await count('reminders', `status = 'draft'`)).toBe(0); // paused by the promise
    expect(gmail.send).not.toHaveBeenCalled();
  });

  it.each(['dispute', 'already_paid'])('a %s skips drafts, pauses new ones and never produces an outgoing call', async (cls) => {
    const { invoiceId, draftId } = await seed();
    ai.classifyReply.mockResolvedValue(verdict(cls));
    const agent = await loggedInAgent();
    await agent.post(`/jobs/run-now?today=${TODAY}`).expect(200);

    expect((await replies())[0]).toMatchObject({ classification: cls, status: 'new' });
    expect(await reminderStatus(draftId)).toBe('skipped');
    expect(await invoiceRow(invoiceId)).toEqual({ promise_date: null, status: 'open' });
    // Later runs (stage 4 would be due) create no draft while the reply is unreviewed.
    await agent.post('/jobs/run-now?today=2026-11-20').expect(200);
    expect(await count('reminders', `status = 'draft'`)).toBe(0);
    await agent.post(`/reminders/${draftId}/approve`).expect(409);
    expect(gmail.send).not.toHaveBeenCalled();
  });

  it.each([
    ['a promise with a past date', verdict('promise_to_pay', '2026-11-01')],
    ['low confidence', verdict('promise_to_pay', '2026-11-06', 0.5)],
    ['low-confidence dispute', verdict('dispute', null, 0.3)],
    ['output that failed validation', { ok: false, reason: 'Gemini output failed validation' }],
  ])('%s → needs_review, schedule unchanged', async (_case, result) => {
    const { invoiceId, draftId } = await seed();
    ai.classifyReply.mockResolvedValue(result);
    const agent = await loggedInAgent();
    await agent.post(`/jobs/run-now?today=${TODAY}`).expect(200);
    expect((await replies())[0].classification).toBe('needs_review');
    expect(await invoiceRow(invoiceId)).toEqual({ promise_date: null, status: 'open' });
    expect(await reminderStatus(draftId)).toBe('draft');
  });

  it('a Gemini 429 stops the reply step, changes nothing, and is logged in job_runs', async () => {
    const { invoiceId, draftId } = await seed();
    gmail.threadMessages.mockResolvedValue([OURS, customerMsg('cust-1', 2_000), customerMsg('cust-2', 3_000)]);
    ai.classifyReply.mockRejectedValue(new GeminiUnavailableError('Gemini error 429: Resource exhausted', 429));
    const agent = await loggedInAgent();
    const res = await agent.post(`/jobs/run-now?today=${TODAY}`).expect(200);

    expect(res.body.repliesProcessed).toBe(0);
    expect(res.body.errors).toEqual(['replies: Gemini error 429: Resource exhausted']);
    expect(ai.classifyReply).toHaveBeenCalledTimes(1); // stopped at the first message
    expect(await count('replies')).toBe(0);
    expect(await invoiceRow(invoiceId)).toEqual({ promise_date: null, status: 'open' });
    expect(await reminderStatus(draftId)).toBe('draft');
    const { rows } = await getPool().query('select error from job_runs order by started_at desc limit 1');
    expect(rows[0].error).toContain('429');

    // Next run, Gemini is back: both messages get processed.
    ai.classifyReply.mockResolvedValue(verdict('other'));
    expect((await agent.post(`/jobs/run-now?today=${TODAY}`)).body.repliesProcessed).toBe(2);
  });

  it('reads only stored threads of open invoices, and only new customer messages after our last reminder', async () => {
    const { invoiceId } = await seed();
    gmail.threadMessages.mockResolvedValue([
      customerMsg('before-ours', 500), // older than our reminder
      OURS,
      { id: 'mine', internalDate: 1_500, from: 'owner@EXAMPLE.com' }, // from the connected address
      customerMsg('cust-1', 2_000),
    ]);
    ai.classifyReply.mockResolvedValue(verdict('other'));
    const agent = await loggedInAgent();
    await agent.post(`/jobs/run-now?today=${TODAY}`).expect(200);
    expect(gmail.threadMessages.mock.calls).toEqual([['th-1']]);
    expect(gmail.messageText.mock.calls).toEqual([['cust-1']]);
    expect((await replies()).map((r) => r.gmail_message_id)).toEqual(['cust-1']);

    // Once the invoice is paid, its thread is no longer read at all.
    await getPool().query(`update invoices set status = 'paid', paid_date = '2026-11-03' where id = $1`, [invoiceId]);
    gmail.threadMessages.mockClear();
    await agent.post(`/jobs/run-now?today=${TODAY}`).expect(200);
    expect(gmail.threadMessages).not.toHaveBeenCalled();
  });

  it('GET /replies and POST /replies/:id/review: a corrected promise sets promise_date', async () => {
    const { invoiceId, draftId } = await seed();
    ai.classifyReply.mockResolvedValue(verdict('promise_to_pay', '2026-11-06', 0.4));
    const agent = await loggedInAgent();
    await agent.post(`/jobs/run-now?today=${TODAY}`).expect(200);
    const [reply] = (await agent.get('/replies?status=new').expect(200)).body;
    expect(reply).toMatchObject({ classification: 'needs_review', extracted_date: '2026-11-06', invoice_ref: 'DEMO-001', customer_name: 'Demo Client' });

    await agent.post(`/replies/${reply.id}/review?today=${TODAY}`).send({}).expect(400); // still needs a class
    await agent.post(`/replies/${reply.id}/review?today=${TODAY}`).send({ classification: 'promise_to_pay', promise_date: '2026-11-01' }).expect(400);
    const res = await agent.post(`/replies/${reply.id}/review?today=${TODAY}`).send({ classification: 'promise_to_pay', promise_date: '2026-11-13' }).expect(200);
    expect(res.body).toMatchObject({ promiseSet: true, reply: { classification: 'promise_to_pay', extracted_date: '2026-11-13', status: 'reviewed' } });
    expect(await invoiceRow(invoiceId)).toEqual({ promise_date: '2026-11-13', status: 'open' });
    expect(await reminderStatus(draftId)).toBe('skipped');
    expect((await agent.get('/replies?status=new')).body).toHaveLength(0);
    await agent.post('/replies/00000000-0000-0000-0000-000000000000/review').send({ classification: 'other' }).expect(404);
  });
});

describe.skipIf(!hasTestDb)('POST /jobs/run (scheduler) and GET /jobs/runs/latest', () => {
  useTestDb();
  beforeEach(() => {
    gmail.threadMessages.mockReset().mockResolvedValue([OURS, customerMsg('cust-1')]);
    gmail.messageText.mockReset().mockResolvedValue('I will pay on the 13th.');
    ai.classifyReply.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('needs the X-Job-Secret header, not a session', async () => {
    const app = createApp();
    await request(app).post('/jobs/run').expect(401);
    await request(app).post('/jobs/run').set('X-Job-Secret', 'wrong').expect(401);
    await request(app).post('/jobs/run-now').set('X-Job-Secret', 'test-job-secret').expect(401); // run-now needs login
    await request(app).get('/jobs/runs/latest').expect(401);
  });

  it('returns 202 with the run id at once, runs in the background, and refuses to overlap (409)', async () => {
    await seed();
    // Hold the run open inside the reply step until the test releases it.
    let release!: () => void;
    ai.classifyReply.mockImplementation(
      () => new Promise((resolve) => (release = () => resolve(verdict('promise_to_pay', '2026-11-13')))),
    );
    const app = createApp();
    const started = await request(app).post(`/jobs/run?today=${TODAY}`).set('X-Job-Secret', 'test-job-secret').expect(202);
    expect(started.body).toEqual({ runId: expect.stringMatching(/^[0-9a-f-]{36}$/), status: 'started' });

    await vi.waitFor(() => expect(ai.classifyReply).toHaveBeenCalled(), { timeout: 20_000 });
    await request(app).post(`/jobs/run?today=${TODAY}`).set('X-Job-Secret', 'test-job-secret').expect(409);
    const agent = await loggedInAgent();
    await agent.post(`/jobs/run-now?today=${TODAY}`).expect(409);
    const during = (await agent.get('/jobs/runs/latest').expect(200)).body.run;
    expect(during).toMatchObject({ id: started.body.runId, running: true, finished_at: null, summary: null });

    release();
    await vi.waitFor(async () => {
      const { run } = (await agent.get('/jobs/runs/latest')).body;
      expect(run.running).toBe(false);
    }, { timeout: 20_000, interval: 300 });
    const after = (await agent.get('/jobs/runs/latest')).body.run;
    expect(after).toMatchObject({ id: started.body.runId, error: null, summary: { repliesProcessed: 1, errors: [] } });
    expect(await count('job_runs')).toBe(1);
  });

  it('latest is null before any run', async () => {
    const agent = await loggedInAgent();
    expect((await agent.get('/jobs/runs/latest').expect(200)).body).toEqual({ run: null });
  });
});
