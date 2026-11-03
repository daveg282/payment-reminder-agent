import { describe, expect, it } from 'vitest';
import { buildDemoData } from '../src/demo/demoData';
import { summarize } from '../src/domain/aging';
import { scoreCustomer } from '../src/domain/risk';

describe.each(['2026-11-03', '2026-11-20', '2027-01-02'])('demo seed data on %s', (today) => {
  const data = buildDemoData(today, 'live@example.com');
  const invoices = data.flatMap((c) =>
    c.invoices.map((i) => ({ ...i, customer_id: c.email, invoice_ref: i.ref, currency: 'USD' })),
  );
  const summary = summarize(invoices, data.map((c) => ({ id: c.email, name: c.name })), [], today);

  it('has ~12 customers: 3 tenants on the 1st and 2 retainers on the 5th, USD only', () => {
    expect(data).toHaveLength(12);
    expect(data.filter((c) => c.kind === 'recurring' && c.billing_day === 1)).toHaveLength(3);
    expect(data.filter((c) => c.kind === 'recurring' && c.billing_day === 5)).toHaveLength(2);
    expect(summary.currency).toBe('USD');
    expect(summary.byCurrency).toHaveLength(1);
  });

  it('produces low, medium and high risk', () => {
    const labels = new Set(data.map((c) => scoreCustomer(c.invoices, today).label));
    expect([...labels].sort()).toEqual(['high', 'low', 'medium']);
  });

  it('has open invoices in every aging bucket, including a large 30+ overdue', () => {
    for (const b of ['due_soon', 'late_1_7', 'late_8_30', 'late_30_plus'] as const) expect(summary.buckets[b].count).toBeGreaterThan(0);
    expect(summary.callFirst[0]).toMatchObject({ invoiceRef: 'BL-112', amount: 8400, daysLate: 45 });
  });

  it('uses the live email exactly once, with unique refs and periods per customer', () => {
    expect(data.filter((c) => c.email === 'live@example.com')).toHaveLength(1);
    for (const c of data) {
      expect(new Set(c.invoices.map((i) => i.ref)).size).toBe(c.invoices.length);
      expect(c.invoices.every((i) => i.amount > 0 && i.due_date >= i.issue_date)).toBe(true);
    }
  });

  it('has a promise this week and a dispute that needs the user', () => {
    expect(summary.promisesThisWeek.map((p) => p.invoiceRef)).toEqual(['OV-17']);
    expect(invoices.filter((i) => i.reply?.classification === 'dispute').map((i) => i.ref)).toEqual(['KC-30']);
  });
});
