import { readFileSync } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { getPool } from '../src/db';
import { count, hasTestDb, loggedInAgent, useTestDb } from './helpers';

const fixturePath = path.join(__dirname, 'fixtures', 'import-mixed.csv');
const validOnlyCsv = readFileSync(fixturePath, 'utf8')
  .split('\n')
  .filter((_, i) => [0, 1, 2, 4, 7, 10, 11].includes(i)) // header + the 6 valid rows
  .join('\n');

describe.skipIf(!hasTestDb)('import API', () => {
  useTestDb();

  const totalRows = async () => (await count('customers')) + (await count('invoices'));

  it('requires login', async () => {
    await request(createApp()).post('/import/preview').attach('file', fixturePath).expect(401);
  });

  it('preview returns counts and row errors and saves nothing', async () => {
    const agent = await loggedInAgent();
    const res = await agent.post('/import/preview').attach('file', fixturePath).expect(200);
    expect(res.body.validCount).toBe(6);
    expect(res.body.errorCount).toBe(6);
    expect(res.body.errors.map((e: { row: number }) => e.row)).toEqual([4, 6, 7, 9, 10, 13]);
    expect(await totalRows()).toBe(0);
  });

  it('commit mode=all with errors → 422 and zero rows', async () => {
    const agent = await loggedInAgent();
    const res = await agent.post('/import/commit?mode=all').attach('file', fixturePath).expect(422);
    expect(res.body.errors).toHaveLength(6);
    expect(await totalRows()).toBe(0);
  });

  it('commit mode=valid_only writes exactly the 6 valid rows', async () => {
    const agent = await loggedInAgent();
    const res = await agent.post('/import/commit?mode=valid_only').attach('file', fixturePath).expect(200);
    expect(res.body).toMatchObject({
      rowsImported: 6,
      rowsSkipped: 6,
      customersCreated: 5, // Aster has two invoices
      invoicesCreated: 4,
      recurringCustomers: 2,
    });

    const { rows: customers } = await getPool().query('select email, kind, billing_day, amount_per_period, recurring_start from customers order by email');
    expect(customers).toEqual([
      { email: 'aster@example.com', kind: 'one_off', billing_day: null, amount_per_period: null, recurring_start: null },
      { email: 'cedar@example.com', kind: 'recurring', billing_day: 1, amount_per_period: 1500, recurring_start: '2026-08-01' },
      { email: 'fjord@example.com', kind: 'one_off', billing_day: null, amount_per_period: null, recurring_start: null },
      { email: 'iris@example.com', kind: 'recurring', billing_day: 15, amount_per_period: 2000, recurring_start: '2026-07-15' },
      { email: 'juniper@example.com', kind: 'one_off', billing_day: null, amount_per_period: null, recurring_start: null },
    ]);
    const { rows: invoices } = await getPool().query('select invoice_ref, amount, currency, due_date, status, source from invoices order by invoice_ref');
    expect(invoices).toEqual([
      { invoice_ref: 'INV-1001', amount: 1200, currency: 'USD', due_date: '2026-09-30', status: 'open', source: 'import' },
      { invoice_ref: 'INV-1002', amount: 450.5, currency: 'USD', due_date: '2026-10-31', status: 'open', source: 'import' },
      { invoice_ref: 'INV-5001', amount: 3000, currency: 'EUR', due_date: '2026-11-14', status: 'open', source: 'import' },
      { invoice_ref: 'INV-7001', amount: 975.25, currency: 'USD', due_date: '2026-11-09', status: 'open', source: 'import' },
    ]);
  });

  it('commit mode=all succeeds for a clean file, and re-importing it adds nothing', async () => {
    const agent = await loggedInAgent();
    await agent.post('/import/commit?mode=all').attach('file', Buffer.from(validOnlyCsv), 'clean.csv').expect(200);
    const again = await agent.post('/import/commit?mode=all').attach('file', Buffer.from(validOnlyCsv), 'clean.csv').expect(200);
    expect(again.body).toMatchObject({ customersCreated: 0, customersUpdated: 5, invoicesCreated: 0, invoicesAlreadyExisting: 4 });
    expect(await count('customers')).toBe(5);
    expect(await count('invoices')).toBe(4);
  });

  it('a DB error mid-transaction rolls everything back', async () => {
    // Make the 3rd invoice insert fail inside the database, after earlier rows were written in the transaction.
    await getPool().query(`
      create or replace function fail_on_inv_5001() returns trigger language plpgsql as $$
      begin
        if new.invoice_ref = 'INV-5001' then raise exception 'forced failure'; end if;
        return new;
      end $$;
      create trigger fail_on_inv_5001 before insert on invoices for each row execute function fail_on_inv_5001();
    `);
    try {
      const agent = await loggedInAgent();
      const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
      const res = await agent.post('/import/commit?mode=valid_only').attach('file', fixturePath);
      quiet.mockRestore();
      expect(res.status).toBe(500);
      expect(await totalRows()).toBe(0);
    } finally {
      await getPool().query('drop trigger fail_on_inv_5001 on invoices; drop function fail_on_inv_5001();');
    }
  });

  it('rejects bad uploads clearly', async () => {
    const agent = await loggedInAgent();
    const noFile = await agent.post('/import/preview').expect(400);
    expect(noFile.body.error).toMatch(/attach a CSV file/);
    const badHeader = await agent.post('/import/preview').attach('file', Buffer.from('a,b\n1,2\n'), 'x.csv').expect(400);
    expect(badHeader.body.error).toMatch(/header row is wrong/);
    const tooBig = await agent.post('/import/preview').attach('file', Buffer.alloc(2 * 1024 * 1024 + 1, 'a'), 'big.csv').expect(413);
    expect(tooBig.body.error).toBe('file is larger than 2 MB');
    await agent.post('/import/commit?mode=everything').attach('file', fixturePath).expect(400);
  });
});
