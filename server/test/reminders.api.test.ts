import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mocked Gmail: records every outgoing message. This is the only way the app can send email.
const gmail = vi.hoisted(() => ({
  send: vi.fn(),
  messageIdHeader: vi.fn(),
  threadMessages: vi.fn(),
  messageText: vi.fn(),
}));
vi.mock('../src/services/gmail', () => ({ gmailFor: () => gmail }));

const google = vi.hoisted(() => ({ exchangeCode: vi.fn() }));
vi.mock('../src/services/google', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/google')>()),
  exchangeCode: google.exchangeCode,
}));

import { createApp } from '../src/app';
import { resetConfig } from '../src/config';
import { getPool } from '../src/db';
import { runJobs } from '../src/jobs/runJobs';
import { count, hasTestDb, loggedInAgent, useTestDb } from './helpers';

const decode = (raw: string) => Buffer.from(raw, 'base64url').toString('utf8');

async function seedInvoice(opts: { due?: string; promise?: string | null } = {}) {
  const db = getPool();
  const { rows: [c] } = await db.query(`insert into customers (name, email, kind) values ('Aster Design', 'aster@example.com', 'one_off') returning id`);
  const { rows: [i] } = await db.query(
    `insert into invoices (customer_id, invoice_ref, amount, issue_date, due_date, promise_date) values ($1, 'INV-1001', 1200, '2026-09-01', $2, $3) returning id`,
    [c.id, opts.due ?? '2026-10-30', opts.promise ?? null],
  );
  return { customerId: c.id as string, invoiceId: i.id as string };
}

const connectGoogle = () =>
  getPool().query(`insert into google_tokens (id, refresh_token, email) values (1, 'refresh-123', 'owner@example.com')`);

describe.skipIf(!hasTestDb)('reminders: drafts, approval and send (mocked Gmail)', () => {
  useTestDb();
  beforeEach(() => {
    gmail.send.mockReset().mockResolvedValue({ messageId: 'gm-1', threadId: 'th-1' });
    gmail.messageIdHeader.mockReset().mockResolvedValue('<first@mail.gmail.com>');
    gmail.threadMessages.mockReset().mockResolvedValue([]); // no customer replies in these tests
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('running jobs twice creates no duplicate drafts, and jobs never send', async () => {
    const { invoiceId } = await seedInvoice(); // due 2026-10-30 → 4 days late on 2026-11-03 → stage 2
    const agent = await loggedInAgent();
    const first = await agent.post('/jobs/run-now?today=2026-11-03').expect(200);
    expect(first.body).toMatchObject({ draftsCreated: 1, draftsByTemplate: 1, errors: [] });
    const second = await agent.post('/jobs/run-now?today=2026-11-03').expect(200);
    expect(second.body.draftsCreated).toBe(0);
    // Even days later, stage 3 waits while stage 2 is still a draft.
    await agent.post('/jobs/run-now?today=2026-11-20').expect(200);

    const { rows } = await getPool().query('select stage, tone, status, drafted_by from reminders where invoice_id = $1', [invoiceId]);
    expect(rows).toEqual([{ stage: 2, tone: 'friendly', status: 'draft', drafted_by: 'template' }]);
    expect(await count('job_runs', 'finished_at is not null')).toBe(3);
    expect(gmail.send).not.toHaveBeenCalled();
  });

  it('approve sends exactly one message, and a second approve cannot resend', async () => {
    await seedInvoice();
    await connectGoogle();
    const agent = await loggedInAgent();
    await agent.post('/jobs/run-now?today=2026-11-03').expect(200);
    const [draft] = (await agent.get('/reminders?status=draft').expect(200)).body;
    expect(draft).toMatchObject({ stage: 2, customer: { name: 'Aster Design' }, invoice: { invoice_ref: 'INV-1001' }, risk: { label: expect.any(String) } });

    const res = await agent.post(`/reminders/${draft.id}/approve`).expect(200);
    expect(res.body).toMatchObject({ status: 'sent', gmail_message_id: 'gm-1', gmail_thread_id: 'th-1', error: null });
    expect(res.body.sent_at).toBeTruthy();
    await agent.post(`/reminders/${draft.id}/approve`).expect(409);
    await Promise.all([agent.post(`/reminders/${draft.id}/approve`), agent.post(`/reminders/${draft.id}/approve`)]);

    expect(gmail.send).toHaveBeenCalledTimes(1);
    const [raw, threadId] = gmail.send.mock.calls[0];
    expect(threadId).toBeNull(); // first reminder starts a new thread
    const msg = decode(raw);
    expect(msg).toContain('From: "Sam Sender" <owner@example.com>');
    expect(msg).toContain('To: aster@example.com');
    expect(msg).toContain(`Subject: ${draft.subject}`);
  });

  it('a later stage replies in the same thread with In-Reply-To / References', async () => {
    await seedInvoice();
    await connectGoogle();
    const agent = await loggedInAgent();
    await agent.post('/jobs/run-now?today=2026-11-03').expect(200);
    const [stage2] = (await agent.get('/reminders?status=draft')).body;
    await agent.post(`/reminders/${stage2.id}/approve`).expect(200);

    gmail.send.mockResolvedValue({ messageId: 'gm-2', threadId: 'th-1' });
    await agent.post('/jobs/run-now?today=2026-11-06').expect(200); // 7 days late → stage 3
    const [stage3] = (await agent.get('/reminders?status=draft')).body;
    expect(stage3).toMatchObject({ stage: 3, tone: 'firm', subject: `Re: ${stage2.subject}` });
    await agent.post(`/reminders/${stage3.id}/approve`).expect(200);

    expect(gmail.messageIdHeader).toHaveBeenCalledWith('gm-1');
    const [raw, threadId] = gmail.send.mock.calls[1];
    expect(threadId).toBe('th-1');
    expect(decode(raw)).toContain('In-Reply-To: <first@mail.gmail.com>');
    expect(decode(raw)).toContain('References: <first@mail.gmail.com>');
  });

  it('a Gmail error marks the reminder failed, and approve retries it', async () => {
    await seedInvoice();
    await connectGoogle();
    const agent = await loggedInAgent();
    await agent.post('/jobs/run-now?today=2026-11-03');
    const [draft] = (await agent.get('/reminders?status=draft')).body;

    vi.spyOn(console, 'error').mockImplementation(() => {});
    gmail.send.mockRejectedValueOnce(new Error('invalid_grant'));
    const failed = await agent.post(`/reminders/${draft.id}/approve`).expect(502);
    expect(failed.body).toMatchObject({ status: 'failed', error: 'invalid_grant' });
    // A failed stage blocks the next one until it is retried or skipped.
    await agent.post('/jobs/run-now?today=2026-11-20');
    expect(await count('reminders')).toBe(1);

    const retried = await agent.post(`/reminders/${draft.id}/approve`).expect(200);
    expect(retried.body).toMatchObject({ status: 'sent', error: null });
    expect(gmail.send).toHaveBeenCalledTimes(2);
  });

  it('SEND_ALLOWLIST: refuses (and keeps the draft) for any address not on it', async () => {
    await seedInvoice(); // customer: aster@example.com
    await connectGoogle();
    const agent = await loggedInAgent();
    await agent.post('/jobs/run-now?today=2026-11-03');
    const [draft] = (await agent.get('/reminders?status=draft')).body;
    try {
      process.env.SEND_ALLOWLIST = 'demo-inbox@example.com, Someone@Example.org';
      resetConfig();
      const refused = await agent.post(`/reminders/${draft.id}/approve`).expect(403);
      expect(refused.body.error).toContain("aster@example.com isn't on the allowlist, so nothing was sent");
      expect(gmail.send).not.toHaveBeenCalled();
      expect((await agent.get('/reminders?status=draft')).body.map((r: { id: string }) => r.id)).toEqual([draft.id]); // still a draft

      process.env.SEND_ALLOWLIST = 'demo-inbox@example.com, ASTER@example.com'; // case-insensitive
      resetConfig();
      await agent.post(`/reminders/${draft.id}/approve`).expect(200);
      expect(gmail.send).toHaveBeenCalledTimes(1);
    } finally {
      delete process.env.SEND_ALLOWLIST;
      resetConfig();
    }
  });

  it('refuses to send without a Google connection, or for a paid or promised invoice', async () => {
    const { invoiceId } = await seedInvoice();
    const agent = await loggedInAgent();
    await agent.post('/jobs/run-now?today=2026-11-03');
    const [draft] = (await agent.get('/reminders?status=draft')).body;

    const noGoogle = await agent.post(`/reminders/${draft.id}/approve`).expect(409);
    expect(noGoogle.body.error).toMatch(/connect your Google account/);
    await connectGoogle();
    await getPool().query(`update invoices set promise_date = current_date + 5 where id = $1`, [invoiceId]);
    await agent.post(`/reminders/${draft.id}/approve`).expect(409);
    await getPool().query(`update invoices set promise_date = null, status = 'paid', paid_date = current_date where id = $1`, [invoiceId]);
    await agent.post(`/reminders/${draft.id}/approve`).expect(409);
    expect(gmail.send).not.toHaveBeenCalled();
    expect((await agent.get('/reminders?status=draft')).body).toHaveLength(1); // still a draft
  });

  it('PATCH edits drafts only; skip marks skipped', async () => {
    await seedInvoice();
    await connectGoogle();
    const agent = await loggedInAgent();
    await agent.post('/jobs/run-now?today=2026-11-03');
    const [draft] = (await agent.get('/reminders?status=draft')).body;

    const edited = await agent.patch(`/reminders/${draft.id}`).send({ subject: 'Quick note about INV-1001', body: 'Hi Aster, a gentle nudge.' }).expect(200);
    expect(edited.body).toMatchObject({ subject: 'Quick note about INV-1001', body: 'Hi Aster, a gentle nudge.' });
    await agent.patch(`/reminders/${draft.id}`).send({ subject: 'Two\nlines', body: 'x' }).expect(400);
    await agent.patch(`/reminders/${draft.id}`).send({ subject: '', body: 'x' }).expect(400);

    await agent.post(`/reminders/${draft.id}/approve`).expect(200);
    expect(decode(gmail.send.mock.calls[0][0])).toContain('Subject: Quick note about INV-1001');
    await agent.patch(`/reminders/${draft.id}`).send({ subject: 'Too late', body: 'x' }).expect(409);
    await agent.post(`/reminders/${draft.id}/skip`).expect(409);

    await agent.post('/jobs/run-now?today=2026-11-06');
    const [next] = (await agent.get('/reminders?status=draft')).body;
    const skipped = await agent.post(`/reminders/${next.id}/skip`).expect(200);
    expect(skipped.body.status).toBe('skipped');
    await agent.patch('/reminders/00000000-0000-0000-0000-000000000000').send({ subject: 'a', body: 'b' }).expect(404);
  });

  it('a broken promise is cleared and the next stage is drafted immediately', async () => {
    const { invoiceId } = await seedInvoice({ due: '2026-10-30', promise: '2026-11-02' });
    await getPool().query(`insert into reminders (invoice_id, stage, tone, subject, body, status) values ($1, 2, 'friendly', 's', 'b', 'sent')`, [invoiceId]);
    const agent = await loggedInAgent();
    const res = await agent.post('/jobs/run-now?today=2026-11-03').expect(200); // 4 days late: stage 3 normally waits until day 7
    expect(res.body).toMatchObject({ promisesCleared: 1, draftsCreated: 1 });
    const { rows } = await getPool().query('select promise_date from invoices where id = $1', [invoiceId]);
    expect(rows[0].promise_date).toBeNull();
    expect((await agent.get('/reminders?status=draft')).body[0]).toMatchObject({ stage: 3, tone: 'firm' });
  });

  it('runJobs refuses to overlap with itself', async () => {
    const first = runJobs('2026-11-03');
    await expect(runJobs('2026-11-03')).rejects.toThrow('jobs are already running');
    await first;
  });
});

describe.skipIf(!hasTestDb)('Google OAuth', () => {
  useTestDb();

  it('needs the app login', async () => {
    await request(createApp()).get('/auth/google').expect(401);
    await request(createApp()).get('/auth/google/status').expect(401);
  });

  it('redirects to Google consent with offline access, consent prompt, scopes and state', async () => {
    const agent = await loggedInAgent();
    const res = await agent.get('/auth/google').expect(302);
    const url = new URL(res.headers.location);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('scope')!.split(' ')).toEqual([
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/spreadsheets.readonly',
      'openid',
      'email',
    ]);
    expect(url.searchParams.get('state')).toMatch(/^[0-9a-f]{48}$/);
  });

  it('callback stores the refresh token and email, then redirects to the client', async () => {
    google.exchangeCode.mockResolvedValue({ refreshToken: 'refresh-xyz', email: 'owner@example.com' });
    const agent = await loggedInAgent();
    expect((await agent.get('/auth/google/status')).body).toEqual({ connected: false, email: null });
    const state = new URL((await agent.get('/auth/google')).headers.location).searchParams.get('state');

    const res = await agent.get(`/auth/google/callback?code=abc&state=${state}`).expect(302);
    expect(res.headers.location).toBe('http://localhost:5173/?google=connected');
    expect(google.exchangeCode).toHaveBeenCalledWith('abc');
    expect((await agent.get('/auth/google/status')).body).toEqual({ connected: true, email: 'owner@example.com' });
    const { rows } = await getPool().query('select id, refresh_token from google_tokens');
    expect(rows).toEqual([{ id: 1, refresh_token: 'refresh-xyz' }]);

    // The state is single-use.
    await agent.get(`/auth/google/callback?code=abc&state=${state}`).expect(400);
  });

  it('rejects a callback with a wrong state', async () => {
    const agent = await loggedInAgent();
    await agent.get('/auth/google');
    await agent.get('/auth/google/callback?code=abc&state=forged').expect(400);
    expect(await count('google_tokens')).toBe(0);
  });
});
