import { Request } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { getPool } from '../src/db';
import { todayIso } from '../src/domain/dates';
import { requestToday } from '../src/http';
import { customers, invoices, TODAY, withIds } from './fixtures/dashboard-data';
import { hasTestDb, loggedInAgent, useTestDb } from './helpers';

async function seedDashboard(): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const c of customers) {
    const { rows } = await getPool().query(`insert into customers (name, email, kind) values ($1, $2, 'one_off') returning id`, [c.name, c.email]);
    ids[c.key] = rows[0].id;
  }
  for (const i of invoices) {
    await getPool().query(
      `insert into invoices (customer_id, invoice_ref, amount, issue_date, due_date, paid_date, status, promise_date)
       values ($1, $2, $3, $4::date - 30, $4, $5, $6, $7)`,
      [ids[i.customer], i.ref, i.amount, i.due, i.paid ?? null, i.status ?? 'open', i.promise ?? null],
    );
  }
  return ids;
}

describe.skipIf(!hasTestDb)('dashboard API', () => {
  useTestDb();

  it(`GET /dashboard?today=${TODAY} returns exactly the hand-calculated values`, async () => {
    const ids = await seedDashboard();
    const agent = await loggedInAgent();
    const res = await agent.get(`/dashboard?today=${TODAY}`).expect(200);
    expect(res.body).toEqual({ today: TODAY, ...withIds(ids) });
  });

  it('GET /customers includes each risk label and reason', async () => {
    await seedDashboard();
    const agent = await loggedInAgent();
    const res = await agent.get(`/customers?today=${TODAY}`).expect(200);
    const risks = Object.fromEntries(res.body.map((c: { name: string; risk: unknown }) => [c.name, c.risk]));
    expect(risks).toEqual({
      'Alder Architects': { label: 'high', reason: 'paid 3 of the last 3 invoices more than 14 days late, and has an invoice 63 days overdue' },
      'Basil Bistro': { label: 'medium', reason: 'has an invoice 30 days overdue' },
      'Clove Clinic': { label: 'low', reason: 'no payment history yet, but an invoice is 7 days overdue' },
      'Dill Digital': { label: 'medium', reason: 'has an invoice 31 days overdue' },
      'Elder Events': { label: 'medium', reason: '1 late payment in the last 12 months, average 5 days late, and has an invoice 80 days overdue' },
    });
  });

  it('GET /dashboard/counts gives the nav badge counts', async () => {
    const ids = await seedDashboard();
    const db = getPool();
    const { rows: [inv] } = await db.query(`select id from invoices where invoice_ref = 'INV-A1'`);
    await db.query(
      `insert into reminders (invoice_id, stage, tone, subject, body, status) values ($1, 1, 'friendly', 's', 'b', 'draft'), ($1, 2, 'firm', 's', 'b', 'failed'), ($1, 3, 'firm', 's', 'b', 'sent')`,
      [inv.id],
    );
    await db.query(
      `insert into replies (gmail_message_id, gmail_thread_id, invoice_id, customer_id, classification, snippet, received_at, status) values
       ('m1', 't1', $1, $2, 'dispute', 'x', now(), 'new'), ('m2', 't1', $1, $2, 'promise_to_pay', 'x', now(), 'new'), ('m3', 't1', $1, $2, 'needs_review', 'x', now(), 'reviewed')`,
      [inv.id, ids.A],
    );
    const agent = await loggedInAgent();
    expect((await agent.get('/dashboard/counts').expect(200)).body).toEqual({ drafts: 2, failed: 1, repliesNew: 2, repliesNeedingAttention: 1 });
    expect((await agent.get(`/dashboard?today=${TODAY}`)).body.repliesNeedingAttention).toBe(1);
  });

  it('GET /customers/:id includes risk, reminder history per invoice and replies', async () => {
    const ids = await seedDashboard();
    const db = getPool();
    const { rows: [inv] } = await db.query(`select id from invoices where invoice_ref = 'INV-A1'`);
    await db.query(`insert into reminders (invoice_id, stage, tone, subject, body, status, sent_at) values ($1, 4, 'final', 's', 'b', 'sent', now())`, [inv.id]);
    await db.query(
      `insert into replies (gmail_message_id, gmail_thread_id, invoice_id, customer_id, classification, extracted_date, snippet, received_at) values ('m1', 't1', $1, $2, 'promise_to_pay', '2026-11-06', 'next Friday', now())`,
      [inv.id, ids.A],
    );
    const agent = await loggedInAgent();
    const res = await agent.get(`/customers/${ids.A}?today=${TODAY}`).expect(200);
    expect(res.body.risk.label).toBe('high');
    expect(res.body.invoices).toHaveLength(6);
    expect(res.body.invoices.find((i: { invoice_ref: string }) => i.invoice_ref === 'INV-A1').reminders).toMatchObject([{ stage: 4, tone: 'final', status: 'sent' }]);
    expect(res.body.replies).toMatchObject([{ classification: 'promise_to_pay', extracted_date: '2026-11-06', invoice_ref: 'INV-A1' }]);
  });

  it('GET /import/sample.csv downloads the clean sample', async () => {
    const agent = await loggedInAgent();
    const res = await agent.get('/import/sample.csv').expect(200);
    expect(res.headers['content-disposition']).toContain('payment-reminder-sample.csv');
    expect(res.text.split('\n')[0]).toBe('kind,customer_name,customer_email,invoice_ref,amount,currency,issue_date,due_date,billing_day,amount_per_period,recurring_start');
  });

  it('rejects a malformed ?today', async () => {
    const agent = await loggedInAgent();
    await agent.get('/dashboard?today=2026-02-30').expect(400);
  });
});

describe('?today override', () => {
  const original = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = original;
  });

  it('is ignored in production', () => {
    process.env.NODE_ENV = 'production';
    expect(requestToday({ query: { today: '2020-01-01' } } as unknown as Request)).toBe(todayIso());
  });

  it('is honoured outside production', () => {
    expect(requestToday({ query: { today: '2020-01-01' } } as unknown as Request)).toBe('2020-01-01');
  });
});
