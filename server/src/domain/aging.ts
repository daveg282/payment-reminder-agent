import { addDays, daysBetween } from './dates';
import { RiskInvoice, RiskLabel, scoreCustomer } from './risk';

export interface AgingInvoice extends RiskInvoice {
  customer_id: string;
  invoice_ref: string;
  currency: string;
  promise_date: string | null;
}

export interface AgingCustomer {
  id: string;
  name: string;
}

export interface AgingReply {
  status: 'new' | 'reviewed';
  classification: string;
}

/** Reply classes the agent never acts on by itself: the user has to look at them. */
export const ATTENTION_CLASSES = ['dispute', 'already_paid', 'needs_review'];

export type BucketName = 'due_soon' | 'late_1_7' | 'late_8_30' | 'late_30_plus';
export type Buckets<A = number> = Record<BucketName, { count: number; amount: A }>;

export interface CurrencyTotals {
  currency: string;
  totalOwed: number;
  totalOverdue: number;
  buckets: Buckets;
}

export interface DashboardSummary {
  /** The single currency of all open invoices; null when there are none or they are mixed. */
  currency: string | null;
  /** Money totals are null when currencies are mixed — see `byCurrency`. Counts are always set. */
  totalOwed: number | null;
  totalOverdue: number | null;
  buckets: Buckets<number | null>;
  byCurrency: CurrencyTotals[];
  callFirst: Array<{
    customerId: string;
    name: string;
    invoiceRef: string;
    amount: number;
    currency: string;
    daysLate: number;
    risk: RiskLabel;
    reason: string;
  }>;
  promisesThisWeek: Array<{
    customerId: string;
    name: string;
    invoiceRef: string;
    amount: number;
    currency: string;
    promiseDate: string;
  }>;
  /** New replies classified dispute / already_paid / needs_review. */
  repliesNeedingAttention: number;
}

const BUCKETS: BucketName[] = ['due_soon', 'late_1_7', 'late_8_30', 'late_30_plus'];
const round2 = (n: number) => Math.round(n * 100) / 100;
const emptyBuckets = (): Buckets => Object.fromEntries(BUCKETS.map((b) => [b, { count: 0, amount: 0 }])) as Buckets;

/** Which aging bucket an open invoice falls in, or null when it is due more than 7 days from now. */
export function bucketFor(dueDate: string, today: string): BucketName | null {
  const daysLate = daysBetween(dueDate, today);
  if (daysLate <= 0) return daysLate >= -7 ? 'due_soon' : null;
  if (daysLate <= 7) return 'late_1_7';
  if (daysLate <= 30) return 'late_8_30';
  return 'late_30_plus';
}

/**
 * Dashboard numbers for `today`. `invoices` should include paid ones too (they drive the risk score).
 * Promises come from `invoice.promise_date`; `replies` gives the "needs attention" count.
 */
export function summarize(
  invoices: AgingInvoice[],
  customers: AgingCustomer[],
  replies: AgingReply[],
  today: string,
): DashboardSummary {
  const nameOf = new Map(customers.map((c) => [c.id, c.name]));
  const open = invoices.filter((i) => i.status === 'open');

  // Totals and buckets, grouped by currency so different currencies are never added together.
  const totals = new Map<string, CurrencyTotals>();
  for (const inv of open) {
    let t = totals.get(inv.currency);
    if (!t) totals.set(inv.currency, (t = { currency: inv.currency, totalOwed: 0, totalOverdue: 0, buckets: emptyBuckets() }));
    t.totalOwed += inv.amount;
    if (inv.due_date < today) t.totalOverdue += inv.amount;
    const bucket = bucketFor(inv.due_date, today);
    if (bucket) {
      t.buckets[bucket].count++;
      t.buckets[bucket].amount += inv.amount;
    }
  }
  const byCurrency = [...totals.values()]
    .map((t) => ({
      ...t,
      totalOwed: round2(t.totalOwed),
      totalOverdue: round2(t.totalOverdue),
      buckets: Object.fromEntries(BUCKETS.map((b) => [b, { count: t.buckets[b].count, amount: round2(t.buckets[b].amount) }])) as Buckets,
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  const single = byCurrency.length <= 1;
  const only = byCurrency[0];
  const buckets = Object.fromEntries(
    BUCKETS.map((b) => [
      b,
      {
        count: byCurrency.reduce((n, t) => n + t.buckets[b].count, 0),
        amount: single ? (only?.buckets[b].amount ?? 0) : null,
      },
    ]),
  ) as Buckets<number | null>;

  // Risk per customer, from their full history.
  const byCustomer = new Map<string, AgingInvoice[]>();
  for (const inv of invoices) byCustomer.set(inv.customer_id, [...(byCustomer.get(inv.customer_id) ?? []), inv]);
  const riskCache = new Map<string, ReturnType<typeof scoreCustomer>>();
  const riskOf = (customerId: string) => {
    if (!riskCache.has(customerId)) riskCache.set(customerId, scoreCustomer(byCustomer.get(customerId) ?? [], today));
    return riskCache.get(customerId)!;
  };

  const callFirst = open
    .filter((i) => i.due_date < today)
    .map((i) => ({ inv: i, daysLate: daysBetween(i.due_date, today) }))
    .sort((a, b) => b.inv.amount - a.inv.amount || b.daysLate - a.daysLate || a.inv.invoice_ref.localeCompare(b.inv.invoice_ref))
    .slice(0, 10)
    .map(({ inv, daysLate }) => {
      const risk = riskOf(inv.customer_id);
      return {
        customerId: inv.customer_id,
        name: nameOf.get(inv.customer_id) ?? '',
        invoiceRef: inv.invoice_ref,
        amount: inv.amount,
        currency: inv.currency,
        daysLate,
        risk: risk.label,
        reason: risk.reason,
      };
    });

  const weekEnd = addDays(today, 6);
  const promisesThisWeek = open
    .filter((i) => i.promise_date && i.promise_date >= today && i.promise_date <= weekEnd)
    .sort((a, b) => a.promise_date!.localeCompare(b.promise_date!) || a.invoice_ref.localeCompare(b.invoice_ref))
    .map((i) => ({
      customerId: i.customer_id,
      name: nameOf.get(i.customer_id) ?? '',
      invoiceRef: i.invoice_ref,
      amount: i.amount,
      currency: i.currency,
      promiseDate: i.promise_date!,
    }));

  return {
    currency: single ? (only?.currency ?? null) : null,
    totalOwed: single ? (only?.totalOwed ?? 0) : null,
    totalOverdue: single ? (only?.totalOverdue ?? 0) : null,
    buckets,
    byCurrency,
    callFirst,
    promisesThisWeek,
    repliesNeedingAttention: replies.filter((r) => r.status === 'new' && ATTENTION_CLASSES.includes(r.classification)).length,
  };
}
