import { Tone } from './stages';

export interface ReminderFacts {
  customerName: string;
  invoiceRef: string;
  amount: number;
  currency: string;
  dueDate: string; // YYYY-MM-DD
  daysLate: number; // negative = not yet due
  tone: Tone;
  stage: number;
  senderName: string;
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** e.g. "September 30, 2026" — formatted in UTC so the date never shifts. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', dateStyle: 'long' });
}

const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

/** Fixed fallback reminder for each tone, used when Gemini fails or returns something invalid. */
export function templateReminder(f: ReminderFacts): { subject: string; body: string } {
  const amount = formatMoney(f.amount, f.currency);
  const due = formatDate(f.dueDate);
  const signOff = f.senderName ? `\n\n${f.senderName}` : '';
  const greeting = `Hi ${f.customerName},`;

  if (f.tone === 'friendly') {
    if (f.daysLate <= 0) {
      return {
        subject: `Friendly reminder: invoice ${f.invoiceRef} is due ${due}`,
        body: `${greeting}\n\nThis is a friendly reminder that invoice ${f.invoiceRef} for ${amount} is due on ${due}.\n\nIf it's already on its way, thank you, and please ignore this note. If you have any questions about the invoice, just reply to this email.\n\nBest regards,${signOff}`,
      };
    }
    return {
      subject: `Reminder: invoice ${f.invoiceRef} is now overdue`,
      body: `${greeting}\n\nI hope all is well. Invoice ${f.invoiceRef} for ${amount} was due on ${due} and is now ${days(f.daysLate)} overdue.\n\nCould you let me know when I can expect payment? If you've already paid, thank you, and please ignore this message.\n\nBest regards,${signOff}`,
    };
  }
  if (f.tone === 'firm') {
    return {
      subject: `Invoice ${f.invoiceRef} is ${days(Math.max(f.daysLate, 0))} overdue`,
      body: `${greeting}\n\nInvoice ${f.invoiceRef} for ${amount} was due on ${due} and remains unpaid, now ${days(Math.max(f.daysLate, 0))} past due.\n\nPlease arrange payment as soon as possible, or reply with a date when payment will be made. If there is a problem with the invoice, let me know so we can sort it out.\n\nRegards,${signOff}`,
    };
  }
  return {
    subject: `Final reminder: invoice ${f.invoiceRef} for ${amount}`,
    body: `${greeting}\n\nThis is a final reminder that invoice ${f.invoiceRef} for ${amount}, due on ${due}, is still unpaid and now ${days(Math.max(f.daysLate, 0))} overdue.\n\nPlease make payment within the next few days, or reply today with a firm payment date. If you believe this invoice is incorrect, please tell me straight away.\n\nThank you,${signOff}`,
  };
}
