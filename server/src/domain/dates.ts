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
