import { describe, expect, it } from 'vitest';
import { AgingInvoice, bucketFor, summarize } from '../src/domain/aging';
import { customers, expected, invoices, TODAY } from './fixtures/dashboard-data';

const asAging = (): AgingInvoice[] =>
  invoices.map((i) => ({
    customer_id: i.customer,
    invoice_ref: i.ref,
    amount: i.amount,
    currency: 'USD',
    due_date: i.due,
    paid_date: i.paid ?? null,
    status: i.status ?? 'open',
    promise_date: i.promise ?? null,
  }));
const asCustomers = () => customers.map((c) => ({ id: c.key, name: c.name }));

describe('summarize on the dashboard fixture', () => {
  it('matches every hand-calculated value', () => {
    expect(summarize(asAging(), asCustomers(), [], TODAY)).toEqual(expected);
  });
});

describe('bucketFor', () => {
  it.each([
    ['2026-11-10', 'due_soon'], // due in 7 days
    ['2026-11-11', null], // due in 8 days
    ['2026-11-03', 'due_soon'], // due today
    ['2026-11-02', 'late_1_7'],
    ['2026-10-27', 'late_1_7'], // 7 late
    ['2026-10-26', 'late_8_30'], // 8 late
    ['2026-10-04', 'late_8_30'], // 30 late
    ['2026-10-03', 'late_30_plus'], // 31 late
  ])('due %s → %s', (due, bucket) => {
    expect(bucketFor(due, TODAY)).toBe(bucket);
  });
});

describe('summarize with mixed currencies', () => {
  it('groups totals by currency instead of adding them', () => {
    const inv = (ref: string, currency: string, amount: number, due: string): AgingInvoice => ({
      customer_id: 'X', invoice_ref: ref, amount, currency, due_date: due, paid_date: null, status: 'open', promise_date: null,
    });
    const s = summarize([inv('1', 'USD', 100, '2026-10-01'), inv('2', 'EUR', 50, '2026-11-05'), inv('3', 'USD', 25, '2026-11-01')], [{ id: 'X', name: 'X' }], [], TODAY);
    expect(s.currency).toBeNull();
    expect(s.totalOwed).toBeNull();
    expect(s.totalOverdue).toBeNull();
    expect(s.buckets.late_1_7).toEqual({ count: 1, amount: null });
    expect(s.byCurrency.map((c) => [c.currency, c.totalOwed, c.totalOverdue])).toEqual([
      ['EUR', 50, 0],
      ['USD', 125, 125],
    ]);
    expect(s.callFirst.map((c) => [c.invoiceRef, c.currency])).toEqual([['1', 'USD'], ['3', 'USD']]);
  });

  it('counts only new dispute / already_paid / needs_review replies as needing attention', () => {
    const replies = [
      { status: 'new' as const, classification: 'dispute' },
      { status: 'new' as const, classification: 'needs_review' },
      { status: 'new' as const, classification: 'already_paid' },
      { status: 'new' as const, classification: 'promise_to_pay' },
      { status: 'reviewed' as const, classification: 'dispute' },
    ];
    expect(summarize([], [], replies, TODAY).repliesNeedingAttention).toBe(3);
  });

  it('returns zeros for an empty book', () => {
    const s = summarize([], [], [], TODAY);
    expect(s).toMatchObject({ currency: null, totalOwed: 0, totalOverdue: 0, byCurrency: [], callFirst: [], promisesThisWeek: [] });
  });
});
