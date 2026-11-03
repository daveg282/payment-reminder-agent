// Display helpers. Dates are 'YYYY-MM-DD' calendar dates and are always formatted in UTC (no shifting).

export function money(amount: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

const asUtc = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

export const shortDate = (iso: string) => asUtc(iso).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
export const longDate = (iso: string) =>
  asUtc(iso).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
export const weekdayDate = (iso: string) => asUtc(iso).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
export const monthShort = (iso: string) => asUtc(iso).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short' });
export const dayOfMonth = (iso: string) => String(asUtc(iso).getUTCDate());

/** A timestamp (sent_at, received_at) in the viewer's local time. */
export const dateTime = (ts: string) =>
  new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/** Today on the viewer's calendar, as YYYY-MM-DD. */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const daysBetween = (from: string, to: string) => Math.round((asUtc(to).getTime() - asUtc(from).getTime()) / 86_400_000);

/** Server messages are lower-case fragments ("due date is not a valid date"); show them as sentences. */
export const sentence = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
