import { isoDate, parseIso } from './dates';

export interface RecurringSchedule {
  billing_day: number;
  recurring_start: string; // YYYY-MM-DD
}

export interface DuePeriod {
  period: string; // YYYY-MM
  issue_date: string;
  due_date: string;
}

/**
 * Every billing period from `recurring_start` up to `today` whose due date has arrived.
 * The due date is that month's `billing_day`; the first period is the first billing day on or after the start.
 * The invoice is issued on the 1st of the month (or the start date, if later).
 */
export function duePeriods(customer: RecurringSchedule, today: string): DuePeriod[] {
  const start = parseIso(customer.recurring_start);
  const periods: DuePeriod[] = [];
  let { year, month } = start;

  for (;;) {
    const due = isoDate(year, month, customer.billing_day);
    if (due > today) break;
    if (due >= customer.recurring_start) {
      const firstOfMonth = isoDate(year, month, 1);
      periods.push({
        period: due.slice(0, 7),
        issue_date: firstOfMonth > customer.recurring_start ? firstOfMonth : customer.recurring_start,
        due_date: due,
      });
    }
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return periods;
}

export const recurringInvoiceRef = (period: string) => `REC-${period}`;
