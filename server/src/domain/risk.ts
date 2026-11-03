import { daysBetween, oneYearBefore } from './dates';

export type RiskLabel = 'low' | 'medium' | 'high';

export interface RiskInvoice {
  due_date: string;
  paid_date: string | null;
  amount: number;
  status: 'open' | 'paid' | 'void';
}

export interface RiskScore {
  label: RiskLabel;
  points: number;
  reason: string;
  lateCount: number;
  avgDaysLate: number; // whole days, averaged over late payments in the last 12 months
  overdueAmount: number;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function latePoints(count: number): number {
  if (count >= 3) return 4;
  return count; // 0 → 0, 1 → 1, 2 → 2
}

function avgPoints(avg: number): number {
  if (avg <= 0) return 0;
  if (avg <= 7) return 1;
  if (avg <= 14) return 2;
  return 3;
}

/** Rule-based customer risk from their invoice history. `today` is YYYY-MM-DD. */
export function scoreCustomer(invoices: RiskInvoice[], today: string): RiskScore {
  const cutoff = oneYearBefore(today); // "last 12 months" = paid after this date
  const paid = invoices.filter((i) => i.status === 'paid' && i.paid_date);
  const paidRecently = paid.filter((i) => i.paid_date! > cutoff);
  const lateRecently = paidRecently.filter((i) => i.paid_date! > i.due_date);
  const daysLate = lateRecently.map((i) => daysBetween(i.due_date, i.paid_date!));

  const lateCount = lateRecently.length;
  const avgDaysLate = lateCount ? Math.round(daysLate.reduce((a, b) => a + b, 0) / lateCount) : 0;

  const overdue = invoices.filter((i) => i.status === 'open' && i.due_date < today);
  const overdueAmount = Math.round(overdue.reduce((sum, i) => sum + i.amount, 0) * 100) / 100;
  const maxDaysOverdue = overdue.reduce((max, i) => Math.max(max, daysBetween(i.due_date, today)), 0);

  const latenessPoints = latePoints(lateCount) + avgPoints(avgDaysLate);
  const overduePoints = maxDaysOverdue >= 30 ? 2 : 0;
  const points = latenessPoints + overduePoints;
  const label: RiskLabel = points >= 5 ? 'high' : points >= 2 ? 'medium' : 'low';

  // Reason: one sentence, strongest factor first.
  let lateness: string | undefined;
  if (lateCount > 0) {
    if (avgDaysLate >= 15) {
      const veryLate = daysLate.filter((d) => d > 14).length;
      lateness = `paid ${veryLate} of the last ${plural(paidRecently.length, 'invoice')} more than 14 days late`;
    } else {
      lateness = `${plural(lateCount, 'late payment')} in the last 12 months, average ${plural(avgDaysLate, 'day')} late`;
    }
  }
  const overdueText = `has an invoice ${plural(maxDaysOverdue, 'day')} overdue`;

  let reason: string;
  if (lateness && overduePoints) {
    reason = overduePoints > latenessPoints ? `${overdueText}, and ${lateness}` : `${lateness}, and ${overdueText}`;
  } else if (lateness) {
    reason = lateness;
  } else if (overduePoints) {
    reason = overdueText;
  } else {
    const base =
      paid.length === 0
        ? 'no payment history yet'
        : paid.some((i) => i.paid_date! > i.due_date)
          ? 'no late payments in the last 12 months'
          : 'all invoices paid on time';
    reason = maxDaysOverdue > 0 ? `${base}, but an invoice is ${plural(maxDaysOverdue, 'day')} overdue` : base;
  }

  return { label, points, reason, lateCount, avgDaysLate, overdueAmount };
}

/** High risk makes reminders one step firmer (used by Brief 03). */
export function firmerTone(tone: 'friendly' | 'firm' | 'final', risk: RiskLabel): 'friendly' | 'firm' | 'final' {
  if (risk !== 'high') return tone;
  return tone === 'friendly' ? 'firm' : 'final';
}
