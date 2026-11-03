// 20 invented customers with fixed histories, scored on TODAY. Expected values are hand-calculated.
import { addDays } from '../../src/domain/dates';
import { RiskInvoice, RiskLabel } from '../../src/domain/risk';

export const TODAY = '2026-11-03'; // "last 12 months" = paid after 2025-11-03

/** Paid `daysLate` days after the due date (negative = early). */
const paid = (due: string, daysLate: number, amount = 100): RiskInvoice => ({
  due_date: due,
  paid_date: addDays(due, daysLate),
  amount,
  status: 'paid',
});
const open = (due: string, amount = 100): RiskInvoice => ({ due_date: due, paid_date: null, amount, status: 'open' });
const voided = (due: string, amount = 100): RiskInvoice => ({ due_date: due, paid_date: null, amount, status: 'void' });
/** Open invoice exactly `days` days overdue on TODAY. */
const overdueBy = (days: number, amount = 100) => open(addDays(TODAY, -days), amount);

export interface RiskCase {
  name: string;
  invoices: RiskInvoice[];
  expected: RiskLabel;
  points: number;
  reason?: string;
}

export const riskCustomers: RiskCase[] = [
  {
    name: 'Amber Works — no history',
    invoices: [],
    expected: 'low',
    points: 0,
    reason: 'no payment history yet',
  },
  {
    name: 'Bluebell Co — one invoice, not due yet',
    invoices: [open('2026-11-20')],
    expected: 'low',
    points: 0,
    reason: 'no payment history yet',
  },
  {
    name: 'Copper Lane — all on time (plus a void invoice that must be ignored)',
    invoices: [paid('2026-03-01', 0), paid('2026-06-01', -2), paid('2026-09-01', 0), voided('2026-08-01')],
    expected: 'low',
    points: 0,
    reason: 'all invoices paid on time',
  },
  {
    name: 'Dahlia Studio — 1 late, 3 days',
    invoices: [paid('2026-05-01', 0), paid('2026-08-01', 3)],
    expected: 'medium',
    points: 2, // 1 late → 1, avg 3 → 1
    reason: '1 late payment in the last 12 months, average 3 days late',
  },
  {
    name: 'Ember Media — exactly 2 late, avg 5',
    invoices: [paid('2026-04-01', 4), paid('2026-07-01', 6), paid('2026-09-01', 0)],
    expected: 'medium',
    points: 3, // 2 late → 2, avg 5 → 1
    reason: '2 late payments in the last 12 months, average 5 days late',
  },
  {
    name: 'Fern & Co — 3 late, avg 4',
    invoices: [paid('2026-02-01', 3), paid('2026-05-01', 4), paid('2026-08-01', 5)],
    expected: 'high',
    points: 5, // 3 late → 4, avg 4 → 1
  },
  {
    name: 'Garnet Labs — 4 of 5 more than 14 days late',
    invoices: [paid('2026-01-10', 20), paid('2026-03-10', 20), paid('2026-05-10', 20), paid('2026-07-10', 20), paid('2026-09-10', 0)],
    expected: 'high',
    points: 7, // 4 late → 4, avg 20 → 3
    reason: 'paid 4 of the last 5 invoices more than 14 days late',
  },
  {
    name: 'Hazel Partners — huge 63-day overdue, clean history',
    invoices: [paid('2026-04-01', 0), paid('2026-06-01', 0), open('2026-09-01', 25_000)],
    expected: 'medium',
    points: 2, // overdue 30+ → 2
    reason: 'has an invoice 63 days overdue',
  },
  {
    name: 'Indigo Ltd — paid late more than 12 months ago (must not count)',
    invoices: [paid('2025-06-01', 30), paid('2026-06-01', 0)],
    expected: 'low',
    points: 0,
    reason: 'no late payments in the last 12 months',
  },
  {
    name: 'Jasper Group — border: 1 late at 7 days + 30+ overdue',
    invoices: [paid('2026-06-01', 7), overdueBy(40)],
    expected: 'medium',
    points: 4, // 1 + avg 7 → 1 + 2
    reason: '1 late payment in the last 12 months, average 7 days late, and has an invoice 40 days overdue',
  },
  {
    name: 'Kelp Kitchens — border: 1 late at 8 days + 30+ overdue',
    invoices: [paid('2026-06-01', 8), overdueBy(40)],
    expected: 'high',
    points: 5, // 1 + avg 8 → 2 + 2
  },
  {
    name: 'Lilac Events — border: 2 late, avg 14',
    invoices: [paid('2026-04-01', 14), paid('2026-07-01', 14)],
    expected: 'medium',
    points: 4, // 2 + avg 14 → 2
    reason: '2 late payments in the last 12 months, average 14 days late',
  },
  {
    name: 'Maple Rentals — border: 2 late, avg 15',
    invoices: [paid('2026-04-01', 15), paid('2026-07-01', 15)],
    expected: 'high',
    points: 5, // 2 + avg 15 → 3
    reason: 'paid 2 of the last 2 invoices more than 14 days late',
  },
  {
    name: 'Nettle Design — exactly 30 days overdue, clean history',
    invoices: [paid('2026-05-01', 0), overdueBy(30)],
    expected: 'medium',
    points: 2,
  },
  {
    name: 'Olive Tutors — 29 days overdue, clean history',
    invoices: [paid('2026-05-01', 0), overdueBy(29)],
    expected: 'low',
    points: 0,
    reason: 'all invoices paid on time, but an invoice is 29 days overdue',
  },
  {
    name: 'Pine Audio — no paid history, 45 days overdue',
    invoices: [overdueBy(45, 900)],
    expected: 'medium',
    points: 2,
  },
  {
    name: 'Quartz Print — 2 late at 7 and 8 days (avg 7.5 rounds to 8)',
    invoices: [paid('2026-04-01', 7), paid('2026-07-01', 8)],
    expected: 'medium',
    points: 4, // 2 + avg 8 → 2
  },
  {
    name: 'Rowan Builders — 5 late avg 30 and 40 days overdue',
    invoices: [paid('2026-01-01', 30), paid('2026-03-01', 30), paid('2026-05-01', 30), paid('2026-07-01', 30), paid('2026-09-01', 30), overdueBy(40)],
    expected: 'high',
    points: 9, // 4 + 3 + 2
    reason: 'paid 5 of the last 5 invoices more than 14 days late, and has an invoice 40 days overdue',
  },
  {
    name: 'Sage Clinic — always pays early',
    invoices: [paid('2026-03-01', -5), paid('2026-07-01', -1)],
    expected: 'low',
    points: 0,
  },
  {
    name: 'Thyme Bakery — 12-month edge: paid on 2025-11-03 excluded, 2025-11-04 counted',
    invoices: [paid('2025-09-24', 40) /* paid 2025-11-03 */, paid('2025-10-25', 10) /* paid 2025-11-04 */],
    expected: 'medium',
    points: 3, // 1 + avg 10 → 2
    reason: '1 late payment in the last 12 months, average 10 days late',
  },
];
