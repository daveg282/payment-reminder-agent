import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { getPool } from '../src/db';
import { count, hasTestDb, loggedInAgent, useTestDb } from './helpers';

describe('health and auth (no DB needed)', () => {
  it('GET /health is public', async () => {
    const res = await request(createApp()).get('/health').expect(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('protects routes and accepts only the right password', async () => {
    const app = createApp();
    await request(app).get('/customers').expect(401);
    await request(app).post('/auth/login').send({ password: 'nope' }).expect(401);
    const agent = request.agent(app);
    await agent.post('/auth/login').send({ password: 'test-password' }).expect(200);
    expect((await agent.get('/auth/me')).body).toEqual({ authed: true });
    await agent.post('/auth/logout').expect(200);
    expect((await agent.get('/auth/me')).body).toEqual({ authed: false });
  });
});

describe.skipIf(!hasTestDb)('customers, invoices and recurring API', () => {
  useTestDb();

  async function seed() {
    const db = getPool();
    const { rows: [c] } = await db.query(
      `insert into customers (name, email, kind, billing_day, amount_per_period, recurring_start)
       values ('Kestrel Lofts', 'kestrel@example.com', 'recurring', 15, 1000, '2026-01-15') returning id`,
    );
    const { rows: [inv] } = await db.query(
      `insert into invoices (customer_id, invoice_ref, amount, issue_date, due_date, promise_date)
       values ($1, 'INV-9', 250, '2026-03-01', '2026-03-31', '2026-04-10') returning id`,
      [c.id],
    );
    await db.query(
      `insert into reminders (invoice_id, stage, tone, subject, body, status) values
       ($1, 1, 'friendly', 's', 'b', 'sent'), ($1, 2, 'firm', 's', 'b', 'draft'), ($1, 3, 'final', 's', 'b', 'approved')`,
      [inv.id],
    );
    return { customerId: c.id as string, invoiceId: inv.id as string };
  }

  it('generate-recurring creates due periods once (start Jan 15, today Apr 3 → Jan–Mar)', async () => {
    const { customerId } = await seed();
    const agent = await loggedInAgent();
    const res = await agent.post('/jobs/generate-recurring?today=2026-04-03').expect(200);
    expect(res.body).toEqual({ customers: 1, invoicesCreated: 3 });
    await agent.post('/jobs/generate-recurring?today=2026-04-03').expect(200, { customers: 1, invoicesCreated: 0 });

    const { rows } = await getPool().query(
      `select invoice_ref, period, issue_date, due_date, amount, source from invoices where customer_id = $1 and source = 'recurring' order by period`,
      [customerId],
    );
    expect(rows).toEqual([
      { invoice_ref: 'REC-2026-01', period: '2026-01', issue_date: '2026-01-15', due_date: '2026-01-15', amount: 1000, source: 'recurring' },
      { invoice_ref: 'REC-2026-02', period: '2026-02', issue_date: '2026-02-01', due_date: '2026-02-15', amount: 1000, source: 'recurring' },
      { invoice_ref: 'REC-2026-03', period: '2026-03', issue_date: '2026-03-01', due_date: '2026-03-15', amount: 1000, source: 'recurring' },
    ]);
  });

  it('lists customers and returns one with its invoices', async () => {
    const { customerId } = await seed();
    const agent = await loggedInAgent();
    const list = await agent.get('/customers').expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ name: 'Kestrel Lofts', open_count: 1, open_amount: 250 });

    const one = await agent.get(`/customers/${customerId}`).expect(200);
    expect(one.body.invoices.map((i: { invoice_ref: string }) => i.invoice_ref)).toEqual(['INV-9']);
    await agent.get('/customers/not-a-uuid').expect(404);
    await agent.get('/customers/00000000-0000-0000-0000-000000000000').expect(404);
  });

  it('filters invoices by status', async () => {
    await seed();
    const agent = await loggedInAgent();
    expect((await agent.get('/invoices?status=open').expect(200)).body).toHaveLength(1);
    expect((await agent.get('/invoices?status=paid').expect(200)).body).toHaveLength(0);
    await agent.get('/invoices?status=late').expect(400);
  });

  it('mark-paid sets paid, clears the promise and skips pending reminders', async () => {
    const { invoiceId } = await seed();
    const agent = await loggedInAgent();
    const res = await agent.post(`/invoices/${invoiceId}/mark-paid`).send({ paid_date: '2026-04-05' }).expect(200);
    expect(res.body.invoice).toMatchObject({ status: 'paid', paid_date: '2026-04-05', promise_date: null });
    expect(res.body.remindersSkipped).toBe(2);
    expect(await count('reminders', `status = 'skipped'`)).toBe(2);
    expect(await count('reminders', `status = 'sent'`)).toBe(1);

    await agent.post(`/invoices/${invoiceId}/mark-paid`).send({ paid_date: '2026-02-30' }).expect(400);
    await agent.post('/invoices/00000000-0000-0000-0000-000000000000/mark-paid').send({}).expect(404);
  });
});
