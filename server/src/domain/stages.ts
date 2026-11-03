import { addDays } from './dates';
import { RiskLabel, firmerTone } from './risk';

export type Tone = 'friendly' | 'firm' | 'final';
export type ReminderStatus = 'draft' | 'approved' | 'sent' | 'skipped' | 'failed';

/** Stage schedule: days relative to the due date, and the base tone. */
export const STAGES: ReadonlyArray<{ stage: number; offsetDays: number; tone: Tone }> = [
  { stage: 1, offsetDays: -3, tone: 'friendly' },
  { stage: 2, offsetDays: 1, tone: 'friendly' },
  { stage: 3, offsetDays: 7, tone: 'firm' },
  { stage: 4, offsetDays: 14, tone: 'final' },
];

/** A reminder that still needs the user (or a retry) before anything else goes out. */
export const isPending = (status: ReminderStatus) => status === 'draft' || status === 'approved' || status === 'failed';

export interface StageInvoice {
  status: 'open' | 'paid' | 'void';
  due_date: string;
  promise_date: string | null;
}

/**
 * The reminder stage to draft now for an invoice, or null.
 * - Only open invoices; paused while `promise_date >= today`.
 * - Never a new stage while an earlier one is still pending (draft / approved / failed-awaiting-retry).
 * - Picks the latest stage whose date has arrived, so an invoice first seen 10 days late gets stage 3, not stage 1.
 * - Broken promise (`promise_date < today`): the next stage not yet drafted is due immediately.
 */
export function nextStageDue(
  invoice: StageInvoice,
  existingStages: Array<{ stage: number; status: ReminderStatus }>,
  risk: RiskLabel,
  today: string,
): { stage: number; tone: Tone } | null {
  if (invoice.status !== 'open') return null;
  if (invoice.promise_date && invoice.promise_date >= today) return null;
  if (existingStages.some((r) => isPending(r.status))) return null;

  const last = Math.max(0, ...existingStages.map((r) => r.stage));
  if (last >= STAGES.length) return null;

  const reached = STAGES.filter((s) => s.stage > last && addDays(invoice.due_date, s.offsetDays) <= today);
  let next = reached.at(-1);
  if (!next && invoice.promise_date && invoice.promise_date < today) next = STAGES[last]; // stage last + 1
  if (!next) return null;
  return { stage: next.stage, tone: firmerTone(next.tone, risk) };
}
