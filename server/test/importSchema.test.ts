import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CsvFileError, parseImportCsv, validateRows } from '../src/domain/importSchema';

const fixture = readFileSync(path.join(__dirname, 'fixtures', 'import-mixed.csv'));

describe('validateRows on import-mixed.csv', () => {
  const { valid, errors } = validateRows(parseImportCsv(fixture));

  it('returns exactly the 6 planted errors with row numbers counting the header', () => {
    expect(errors).toEqual([
      { row: 4, field: 'due_date', message: 'due date is not a valid date' },
      { row: 6, field: 'amount', message: 'amount is missing' },
      { row: 7, field: 'customer_email', message: 'customer email is not a valid email' },
      { row: 9, field: 'billing_day', message: 'billing day must be between 1 and 28' },
      { row: 10, field: 'due_date', message: 'due date is before issue date' },
      { row: 13, field: 'invoice_ref', message: 'duplicate of row 2' },
    ]);
  });

  it('returns the 6 valid rows: 4 one-off and 2 recurring', () => {
    expect(valid.map((r) => r.row)).toEqual([2, 3, 5, 8, 11, 12]);
    expect(valid.filter((r) => r.kind === 'one_off')).toHaveLength(4);
    expect(valid.filter((r) => r.kind === 'recurring')).toHaveLength(2);
  });

  it('normalizes values', () => {
    const juniper = valid.find((r) => r.row === 12);
    expect(juniper).toMatchObject({ kind: 'one_off', amount: 975.25, currency: 'USD' }); // blank currency → USD
    const cedar = valid.find((r) => r.row === 5);
    expect(cedar).toEqual({
      row: 5,
      kind: 'recurring',
      customer_name: 'Cedar Flat Tenant',
      customer_email: 'cedar@example.com',
      currency: 'USD',
      billing_day: 1,
      amount_per_period: 1500,
      recurring_start: '2026-08-01',
    });
  });
});

describe('validateRows rules', () => {
  const base = {
    kind: 'one_off',
    customer_name: 'Test Co',
    customer_email: 'Test@Example.com',
    invoice_ref: 'A-1',
    amount: '10',
    currency: 'usd',
    issue_date: '2026-01-01',
    due_date: '2026-01-31',
  };
  const errorsFor = (overrides: Record<string, string>) => validateRows([{ ...base, ...overrides }]).errors;

  it('accepts a good row and normalizes email and currency', () => {
    const { valid, errors } = validateRows([base]);
    expect(errors).toEqual([]);
    expect(valid[0]).toMatchObject({ customer_email: 'test@example.com', currency: 'USD', amount: 10 });
  });

  it('rejects an unknown kind', () => {
    expect(errorsFor({ kind: 'weekly' })).toEqual([{ row: 2, field: 'kind', message: 'kind must be one_off or recurring' }]);
  });

  it.each([
    [{ amount: '0' }, 'amount', 'amount must be greater than 0'],
    [{ amount: '-5' }, 'amount', 'amount must be greater than 0'],
    [{ amount: 'ten' }, 'amount', 'amount must be a number'],
    [{ amount: '1.999' }, 'amount', 'amount can have at most 2 decimal places'],
    [{ customer_name: ' ' }, 'customer_name', 'customer name is missing'],
    [{ invoice_ref: '' }, 'invoice_ref', 'invoice ref is missing'],
    [{ currency: 'dollars' }, 'currency', 'currency must be a 3-letter code like USD'],
    [{ issue_date: '2026-02-30' }, 'issue_date', 'issue date is not a valid date'],
    [{ due_date: '01/31/2026' }, 'due_date', 'due date is not a valid date'],
  ])('%o → %s: %s', (overrides, field, message) => {
    expect(errorsFor(overrides)).toEqual([{ row: 2, field, message }]);
  });

  it('accepts due date equal to issue date', () => {
    expect(errorsFor({ due_date: '2026-01-01' })).toEqual([]);
  });

  it('reports every bad field in a row once', () => {
    expect(errorsFor({ amount: '', due_date: 'soon' }).map((e) => e.field)).toEqual(['amount', 'due_date']);
  });

  it('ignores invoice fields on recurring rows', () => {
    const { valid, errors } = validateRows([
      { kind: 'Recurring', customer_name: 'R', customer_email: 'r@example.com', invoice_ref: 'X', amount: 'junk', billing_day: '28', amount_per_period: '99.5', recurring_start: '2026-01-10' },
    ]);
    expect(errors).toEqual([]);
    expect(valid[0]).not.toHaveProperty('amount');
  });

  it('treats duplicate refs case-insensitively on email', () => {
    const { errors } = validateRows([base, { ...base, customer_email: 'TEST@example.com' }]);
    expect(errors).toEqual([{ row: 3, field: 'invoice_ref', message: 'duplicate of row 2' }]);
  });
});

describe('parseImportCsv', () => {
  it('accepts a case-insensitive, padded header and a BOM', () => {
    const csv = '﻿ KIND ,Customer_Name,customer_email,invoice_ref,amount,currency,issue_date,due_date,billing_day,amount_per_period,recurring_start\none_off,A,a@example.com,1,5,,2026-01-01,2026-01-02,,,\n,,,,,,,,,,\n';
    const records = parseImportCsv(csv);
    expect(records).toHaveLength(1);
    expect(records[0].kind).toBe('one_off');
  });

  it('rejects a wrong header', () => {
    expect(() => parseImportCsv('kind,name\none_off,A\n')).toThrow(CsvFileError);
    expect(() => parseImportCsv('kind,name\none_off,A\n')).toThrow(/missing columns: customer_name/);
  });

  it('rejects a file with no data rows', () => {
    expect(() => parseImportCsv('kind,customer_name,customer_email,invoice_ref,amount,currency,issue_date,due_date,billing_day,amount_per_period,recurring_start\n')).toThrow(/no data rows/);
  });
});
