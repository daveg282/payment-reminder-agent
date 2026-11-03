// Calendar dates as 'YYYY-MM-DD' strings. All math is done in UTC so there are no time-zone shifts.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date in strict YYYY-MM-DD form (rejects 2026-02-30). */
export function isValidIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

export function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Today's date on the server's local calendar. */
export function todayIso(now: Date = new Date()): string {
  return isoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function parseIso(value: string): { year: number; month: number; day: number } {
  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day };
}

const toUtc = (value: string) => {
  const { year, month, day } = parseIso(value);
  return Date.UTC(year, month - 1, day);
};

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

export function addDays(value: string, days: number): string {
  const d = new Date(toUtc(value) + days * 86_400_000);
  return isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Same calendar day one year earlier (Feb 29 → Feb 28). */
export function oneYearBefore(value: string): string {
  const { year, month, day } = parseIso(value);
  const lastDay = new Date(Date.UTC(year - 1, month, 0)).getUTCDate();
  return isoDate(year - 1, month, Math.min(day, lastDay));
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export function weekdayOf(value: string): (typeof WEEKDAYS)[number] {
  return WEEKDAYS[new Date(toUtc(value)).getUTCDay()];
}

/**
 * Date rule for relative weekdays in customer replies:
 * "next <weekday>" (also "this <weekday>" / "on <weekday>") means the nearest upcoming occurrence of
 * that weekday strictly AFTER today. E.g. on Tue 2026-11-03, "next Friday" = Fri 2026-11-06, and
 * "next Tuesday" = Tue 2026-11-10 (never today).
 */
export function nextWeekday(today: string, weekday: (typeof WEEKDAYS)[number]): string {
  const target = WEEKDAYS.indexOf(weekday);
  const current = new Date(toUtc(today)).getUTCDay();
  const ahead = ((target - current + 7) % 7) || 7;
  return addDays(today, ahead);
}

/**
 * "<weekday> next week" means that weekday in the following Monday–Sunday week.
 * E.g. on Tue 2026-11-03, "Friday next week" = Fri 2026-11-13.
 */
export function weekdayNextWeek(today: string, weekday: (typeof WEEKDAYS)[number]): string {
  const current = new Date(toUtc(today)).getUTCDay();
  const nextMonday = addDays(today, ((8 - current) % 7) || 7);
  return addDays(nextMonday, (WEEKDAYS.indexOf(weekday) + 6) % 7);
}
