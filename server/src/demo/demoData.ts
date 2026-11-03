// Invented demo book for `npm run seed:demo`. Every date is relative to `today`, so the dashboard
// always shows every aging bucket and all three risk labels, whenever the seed is run.
import { addDays, isoDate, parseIso } from '../domain/dates';
import { duePeriods } from '../domain/recurring';
import { STAGES, Tone } from '../domain/stages';
import { templateReminder } from '../domain/templates';

export interface DemoInvoice {
  ref: string;
  amount: number;
  issue_date: string;
  due_date: string;
  paid_date: string | null;
  status: 'open' | 'paid';
  period: string | null;
  source: 'import' | 'recurring';
  promise_date: string | null;
  sentStages: number[]; // reminder history already sent (no Gmail thread: seeded history is never read)
  reply?: { classification: 'promise_to_pay' | 'dispute'; snippet: string; extracted_date: string | null; received_at: string };
}

export interface DemoCustomer {
  name: string;
  email: string;
  kind: 'one_off' | 'recurring';
  billing_day: number | null;
  amount_per_period: number | null;
  recurring_start: string | null;
  invoices: DemoInvoice[];
}

const CURRENCY = 'USD';

export function buildDemoData(today: string, liveEmail: string): DemoCustomer[] {
  const d = (offset: number) => addDays(today, offset);
  const open = (ref: string, amount: number, dueOffset: number, extra: Partial<DemoInvoice> = {}): DemoInvoice => ({
    ref, amount, issue_date: d(dueOffset - 30), due_date: d(dueOffset), paid_date: null, status: 'open',
    period: null, source: 'import', promise_date: null, sentStages: [], ...extra,
  });
  /** Paid `daysLate` days after the due date (negative = early). */
  const paid = (ref: string, amount: number, dueOffset: number, daysLate: number): DemoInvoice => ({
    ...open(ref, amount, dueOffset), paid_date: d(dueOffset + daysLate), status: 'paid',
  });

  const oneOff = (name: string, email: string, invoices: DemoInvoice[]): DemoCustomer => ({
    name, email, kind: 'one_off', billing_day: null, amount_per_period: null, recurring_start: null, invoices,
  });

  /** Recurring customer: one invoice per due period (paid per `pattern`), plus the next one if it's due within 7 days. */
  const recurring = (
    name: string, email: string, billingDay: number, amount: number, monthsBack: number,
    pattern: (index: number, total: number) => number | 'open', sentOnOpen: (dueDate: string) => number[] = () => [],
  ): DemoCustomer => {
    const t = parseIso(today);
    const shift = (months: number) => {
      const m = t.month - 1 + months;
      return { year: t.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 + 1 };
    };
    const first = shift(-monthsBack);
    const start = isoDate(first.year, first.month, billingDay);
    const periods = duePeriods({ billing_day: billingDay, recurring_start: start }, today);
    const upcoming = shift(t.day >= billingDay ? 1 : 0); // next billing date strictly after today
    const next = isoDate(upcoming.year, upcoming.month, billingDay);
    const all = [...periods];
    if (next > today && next <= d(7)) all.push({ period: next.slice(0, 7), issue_date: `${next.slice(0, 7)}-01`, due_date: next });
    const invoices = all.map((p, i): DemoInvoice => {
      const outcome = p.due_date > today ? 'open' : pattern(i, periods.length);
      const base: DemoInvoice = {
        ref: `REC-${p.period}`, amount, issue_date: p.issue_date, due_date: p.due_date, paid_date: null, status: 'open',
        period: p.period, source: 'recurring', promise_date: null, sentStages: [],
      };
      if (outcome === 'open') return { ...base, sentStages: sentOnOpen(p.due_date) };
      return { ...base, status: 'paid', paid_date: addDays(p.due_date, outcome) };
    });
    return { name, email, kind: 'recurring', billing_day: billingDay, amount_per_period: amount, recurring_start: start, invoices };
  };
  /** Stages whose date has already passed for an invoice due on `due` (for "already sent" history). */
  const reached = (due: string, upTo = 4) => STAGES.filter((s) => s.stage <= upTo && addDays(due, s.offsetDays) <= today).map((s) => s.stage);

  return [
    // ---------- a freelancer's clients ----------
    oneOff('Brightline Studio', 'billing@brightline.example', [
      paid('BL-101', 3200, -300, 22),
      paid('BL-104', 2800, -200, 18),
      paid('BL-107', 4100, -110, 25),
      open('BL-112', 8400, -45, { sentStages: [2, 3] }), // the big 30+ overdue; stage 4 (final) is next
    ]),
    oneOff('Kiln Ceramics', 'accounts@kilnceramics.example', [
      paid('KC-21', 900, -240, 9),
      paid('KC-24', 1100, -150, 12),
      paid('KC-27', 750, -80, 9),
      open('KC-30', 1480, -20, {
        sentStages: [2, 3],
        reply: {
          classification: 'dispute',
          snippet: 'We only received 40 of the 60 mugs on this order, so we will not pay KC-30 in full until the rest arrive or the invoice is corrected.',
          extracted_date: null,
          received_at: `${d(-1)}T15:12:00Z`,
        },
      }),
    ]),
    oneOff('Orchard & Vale', 'finance@orchardvale.example', [
      paid('OV-11', 2000, -210, 6),
      paid('OV-14', 1600, -120, 6),
      open('OV-17', 2350, -5, {
        sentStages: [2],
        promise_date: d(3),
        reply: {
          classification: 'promise_to_pay',
          snippet: `Sorry for the delay on OV-17. Our payment run is on ${new Date(`${d(3)}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long' })}, you'll have it then.`,
          extracted_date: d(3),
          received_at: `${d(-1)}T09:40:00Z`,
        },
      }),
    ]),
    oneOff('Pebble Coffee Co', 'owner@pebblecoffee.example', [open('PC-01', 1250, -34)]),
    oneOff('Fieldnote Media', 'ap@fieldnote.example', [
      paid('FN-1', 1800, -150, -2),
      paid('FN-2', 1800, -90, 0),
      open('FN-3', 2200, -12, { sentStages: [2] }),
    ]),
    oneOff('Northwind Labs', 'billing@northwind.example', [paid('NW-31', 3000, -60, -1), open('NW-35', 2600, 4)]),
    // The live send → reply on camera goes to this customer.
    oneOff('Juniper Events', liveEmail, [paid('JE-195', 480, -40, -1), open('JE-201', 640, -2)]),

    // ---------- tenants: rent on the 1st ----------
    recurring('Maple Court · Flat 1A', 'flat1a@maplecourt.example', 1, 1450, 5, (i, n) => (i === n - 1 ? 'open' : -1), (due) => reached(due, 2)),
    recurring('Maple Court · Flat 2B', 'flat2b@maplecourt.example', 1, 1600, 5, (i, n) => (i >= n - 2 ? 'open' : [16, 19, 15, 21][i % 4])),
    recurring('Maple Court · Flat 3C', 'flat3c@maplecourt.example', 1, 1350, 5, (i, n) => (i === n - 1 ? 'open' : i === 1 || i === 3 ? 5 : 0)),

    // ---------- retainers: billed on the 5th ----------
    recurring('Lumen Analytics', 'finance@lumen.example', 5, 3200, 4, () => -2, (due) => reached(due)),
    recurring('Copperleaf Partners', 'ap@copperleaf.example', 5, 2750, 4, (i) => (i === 1 ? 9 : 0)),
  ];
}

/** Text for a seeded "already sent" reminder (the fixed template for its tone). */
export function seededReminder(c: DemoCustomer, inv: DemoInvoice, stage: number, tone: Tone, senderName: string) {
  const due = STAGES.find((s) => s.stage === stage)!;
  const sentOn = addDays(inv.due_date, due.offsetDays);
  const { subject, body } = templateReminder({
    customerName: c.name, invoiceRef: inv.ref, amount: inv.amount, currency: CURRENCY, dueDate: inv.due_date,
    daysLate: Math.max(due.offsetDays, -3), tone, stage, senderName,
  });
  return { subject, body, sent_at: `${sentOn}T10:00:00Z` };
}

export const DEMO_CURRENCY = CURRENCY;
