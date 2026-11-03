// A fixed, invented book of invoices for TODAY with hand-calculated dashboard values.
export const TODAY = '2026-11-03';

export const customers = [
  { key: 'A', name: 'Alder Architects', email: 'alder@example.com' }, // chronic late payer → high
  { key: 'B', name: 'Basil Bistro', email: 'basil@example.com' }, // on time, but 30 days overdue → medium
  { key: 'C', name: 'Clove Clinic', email: 'clove@example.com' }, // new, a little overdue → low
  { key: 'D', name: 'Dill Digital', email: 'dill@example.com' }, // new, 31 days overdue → medium
  { key: 'E', name: 'Elder Events', email: 'elder@example.com' }, // 1 late + 80 days overdue → medium
] as const;

type Key = (typeof customers)[number]['key'];

export interface FixtureInvoice {
  customer: Key;
  ref: string;
  amount: number;
  due: string;
  status?: 'open' | 'paid' | 'void';
  paid?: string;
  promise?: string;
}

//                                                          days late on TODAY → bucket
export const invoices: FixtureInvoice[] = [
  { customer: 'A', ref: 'INV-A1', amount: 5000, due: '2026-09-01', promise: '2026-11-03' }, // 63 → 30+, promise today ✓
  { customer: 'A', ref: 'INV-A2', amount: 1200, due: '2026-10-20' }, //                        14 → 8–30
  { customer: 'A', ref: 'INV-A3', amount: 100, due: '2026-10-29' }, //                          5 → 1–7 (11th overdue: cut from call-first)
  { customer: 'A', ref: 'INV-A-P1', amount: 1000, due: '2026-03-01', status: 'paid', paid: '2026-03-21' }, // 20 days late
  { customer: 'A', ref: 'INV-A-P2', amount: 1000, due: '2026-05-01', status: 'paid', paid: '2026-05-21' }, // 20 days late
  { customer: 'A', ref: 'INV-A-P3', amount: 1000, due: '2026-07-01', status: 'paid', paid: '2026-07-21' }, // 20 days late
  { customer: 'B', ref: 'INV-B1', amount: 3000, due: '2026-10-04', promise: '2026-11-09' }, // 30 → 8–30, promise today+6 ✓
  { customer: 'B', ref: 'INV-B2', amount: 3000, due: '2026-10-24' }, //                        10 → 8–30 (ties B1 on amount; B1 is later → first)
  { customer: 'B', ref: 'INV-B3', amount: 700, due: '2026-11-03' }, //                          0 → due soon (due today)
  { customer: 'B', ref: 'INV-B-P1', amount: 500, due: '2026-06-01', status: 'paid', paid: '2026-05-30' }, // early
  { customer: 'C', ref: 'INV-C1', amount: 800, due: '2026-11-02' }, //                          1 → 1–7
  { customer: 'C', ref: 'INV-C2', amount: 950, due: '2026-10-27', promise: '2026-11-02' }, //   7 → 1–7, promise yesterday ✗ (broken)
  { customer: 'C', ref: 'INV-C3', amount: 1100, due: '2026-11-10' }, //                        -7 → due soon (edge)
  { customer: 'D', ref: 'INV-D1', amount: 400, due: '2026-10-03', promise: '2026-11-10' }, //  31 → 30+, promise today+7 ✗
  { customer: 'D', ref: 'INV-D2', amount: 2500, due: '2026-10-26' }, //                         8 → 8–30
  { customer: 'D', ref: 'INV-D3', amount: 2000, due: '2026-11-11' }, //                        -8 → no bucket (owed only)
  { customer: 'E', ref: 'INV-E1', amount: 150, due: '2026-10-31' }, //                          3 → 1–7
  { customer: 'E', ref: 'INV-E2', amount: 600, due: '2026-08-15' }, //                         80 → 30+
  { customer: 'E', ref: 'INV-E3', amount: 300, due: '2026-11-05' }, //                         -2 → due soon
  { customer: 'E', ref: 'INV-E4', amount: 999, due: '2026-09-01', status: 'void', promise: '2026-11-04' }, // void: ignored everywhere
  { customer: 'E', ref: 'INV-E-P1', amount: 200, due: '2026-09-01', status: 'paid', paid: '2026-09-06' }, // 5 days late
];

const A = 'paid 3 of the last 3 invoices more than 14 days late, and has an invoice 63 days overdue';
const B = 'has an invoice 30 days overdue';
const C = 'no payment history yet, but an invoice is 7 days overdue';
const D = 'has an invoice 31 days overdue';
const E = '1 late payment in the last 12 months, average 5 days late, and has an invoice 80 days overdue';

// Open: 5000+1200+100+3000+3000+700+800+950+1100+400+2500+2000+150+600+300 = 21800
// Overdue (due before today): 21800 − 700 − 1100 − 2000 − 300 = 17700
const buckets = {
  due_soon: { count: 3, amount: 2100 }, //     700 + 1100 + 300
  late_1_7: { count: 4, amount: 2000 }, //     100 + 800 + 950 + 150
  late_8_30: { count: 4, amount: 9700 }, //    1200 + 3000 + 3000 + 2500
  late_30_plus: { count: 3, amount: 6000 }, // 5000 + 400 + 600
};

/** Expected summary; `customerId` holds the customer key — tests map keys to real ids. */
export const expected = {
  currency: 'USD',
  totalOwed: 21800,
  totalOverdue: 17700,
  buckets,
  byCurrency: [{ currency: 'USD', totalOwed: 21800, totalOverdue: 17700, buckets }],
  callFirst: [
    { customerId: 'A', name: 'Alder Architects', invoiceRef: 'INV-A1', amount: 5000, currency: 'USD', daysLate: 63, risk: 'high', reason: A },
    { customerId: 'B', name: 'Basil Bistro', invoiceRef: 'INV-B1', amount: 3000, currency: 'USD', daysLate: 30, risk: 'medium', reason: B },
    { customerId: 'B', name: 'Basil Bistro', invoiceRef: 'INV-B2', amount: 3000, currency: 'USD', daysLate: 10, risk: 'medium', reason: B },
    { customerId: 'D', name: 'Dill Digital', invoiceRef: 'INV-D2', amount: 2500, currency: 'USD', daysLate: 8, risk: 'medium', reason: D },
    { customerId: 'A', name: 'Alder Architects', invoiceRef: 'INV-A2', amount: 1200, currency: 'USD', daysLate: 14, risk: 'high', reason: A },
    { customerId: 'C', name: 'Clove Clinic', invoiceRef: 'INV-C2', amount: 950, currency: 'USD', daysLate: 7, risk: 'low', reason: C },
    { customerId: 'C', name: 'Clove Clinic', invoiceRef: 'INV-C1', amount: 800, currency: 'USD', daysLate: 1, risk: 'low', reason: C },
    { customerId: 'E', name: 'Elder Events', invoiceRef: 'INV-E2', amount: 600, currency: 'USD', daysLate: 80, risk: 'medium', reason: E },
    { customerId: 'D', name: 'Dill Digital', invoiceRef: 'INV-D1', amount: 400, currency: 'USD', daysLate: 31, risk: 'medium', reason: D },
    { customerId: 'E', name: 'Elder Events', invoiceRef: 'INV-E1', amount: 150, currency: 'USD', daysLate: 3, risk: 'medium', reason: E },
  ],
  promisesThisWeek: [
    { customerId: 'A', name: 'Alder Architects', invoiceRef: 'INV-A1', amount: 5000, currency: 'USD', promiseDate: '2026-11-03' },
    { customerId: 'B', name: 'Basil Bistro', invoiceRef: 'INV-B1', amount: 3000, currency: 'USD', promiseDate: '2026-11-09' },
  ],
};

/** Replace customer keys in the expected summary with real ids. */
export function withIds(ids: Record<string, string>) {
  return {
    ...expected,
    callFirst: expected.callFirst.map((r) => ({ ...r, customerId: ids[r.customerId] })),
    promisesThisWeek: expected.promisesThisWeek.map((r) => ({ ...r, customerId: ids[r.customerId] })),
  };
}
