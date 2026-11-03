import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { z } from 'zod';
import { getConfig } from '../config';
import { addDays, nextWeekday, weekdayNextWeek, weekdayOf } from '../domain/dates';
import { replyJsonSchema, replySchema, ReplyClassification } from '../domain/replySchema';
import { formatDate, formatMoney, ReminderFacts, templateReminder } from '../domain/templates';

/** Gemini could not be reached or refused (not configured, 429, 5xx, network). Callers must change nothing. */
export class GeminiUnavailableError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

export type DraftedBy = 'ai' | 'template';

const draftSchema = z.object({
  subject: z.string().trim().min(3).max(150),
  body: z.string().trim().min(20).max(1500),
});

const draftJsonSchema = {
  type: 'object',
  properties: {
    subject: { type: 'string', description: 'Email subject line, under 80 characters' },
    body: { type: 'string', description: 'Plain-text email body, under 120 words' },
  },
  required: ['subject', 'body'],
};

const TONE_GUIDE = {
  friendly: 'warm and relaxed; assume it is an oversight',
  firm: 'clear and direct; ask for payment or a payment date',
  final: 'firm but respectful; this is the last reminder; ask for payment or a firm date within a few days',
};

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/** The facts given to Gemini: plain wording only ("10 days", never "day(s)"), and no stage count. */
export function draftFacts(f: ReminderFacts): string[] {
  const when =
    f.daysLate < 0
      ? `due in ${days(-f.daysLate)}, on ${formatDate(f.dueDate)}`
      : f.daysLate === 0
        ? `due today, ${formatDate(f.dueDate)}`
        : `${days(f.daysLate)} overdue (it was due on ${formatDate(f.dueDate)})`;
  return [
    `Customer name: ${f.customerName}`,
    `Invoice: ${f.invoiceRef}`,
    `Amount: ${formatMoney(f.amount, f.currency)}`,
    `Status: ${when}`,
  ];
}

export function buildDraftPrompt(f: ReminderFacts): string {
  const signOff = f.senderName
    ? `- End with a sign-off line (e.g. "Best regards,") followed by the name "${f.senderName}" on its own line.`
    : '- End with a short sign-off line (e.g. "Best regards,") and no name.';
  return [
    'Write a payment reminder email.',
    '',
    'Facts (use exactly these, do not invent any others):',
    ...draftFacts(f).map((fact) => `- ${fact}`),
    '',
    `Tone: ${f.tone} — ${TONE_GUIDE[f.tone]}.`,
    '',
    'Format of the body:',
    `- A greeting line on its own, e.g. "Hi ${f.customerName},".`,
    '- Then 2–3 short paragraphs, separated by a blank line.',
    signOff,
    '',
    'Rules:',
    '- Plain, polite and short: the body must be under 120 words.',
    '- Mention the invoice reference and the amount.',
    '- Do not say which reminder number this is.',
    '- No threats, no legal claims, no late fees, no mention of collections or credit scores.',
    '- No placeholders like [Name] or [Date]. Plain text only, no markdown.',
    '- Say that if they have already paid, they can ignore the message.',
    '',
    'Return JSON with "subject" and "body".',
  ].join('\n');
}

/** Checks that a Gemini draft is usable; returns a reason when it is not. */
function rejectDraft(d: z.infer<typeof draftSchema>, f: ReminderFacts): string | null {
  const text = `${d.subject}\n${d.body}`;
  if (!text.includes(f.invoiceRef)) return 'does not mention the invoice reference';
  if (/\[[^\]]+\]|\{\{/.test(text)) return 'contains a placeholder';
  if (/day\(s\)/i.test(text)) return 'contains "day(s)"';
  if (d.body.split(/\s+/).filter(Boolean).length > 150) return 'body is too long';
  return null;
}

let client: GoogleGenAI | undefined;
const gemini = (apiKey: string) => (client ??= new GoogleGenAI({ apiKey }));

/**
 * Drafts a reminder with Gemini. Falls back to the fixed template for the tone whenever Gemini
 * is not configured, errors, or returns output that fails validation — a draft is always produced.
 */
export async function draftReminder(f: ReminderFacts): Promise<{ subject: string; body: string; draftedBy: DraftedBy; fallbackReason?: string }> {
  const { GEMINI_API_KEY, GEMINI_MODEL } = getConfig();
  const fallback = (reason: string) => ({ ...templateReminder(f), draftedBy: 'template' as const, fallbackReason: reason });
  if (!GEMINI_API_KEY || !GEMINI_MODEL) return fallback('Gemini is not configured');

  try {
    const res = await gemini(GEMINI_API_KEY).models.generateContent({
      model: GEMINI_MODEL,
      contents: buildDraftPrompt(f),
      config: {
        responseMimeType: 'application/json',
        responseJsonSchema: draftJsonSchema,
        temperature: 0.4,
        // Flash-Lite can take 20–40 s under load; a timeout falls back to the template.
        httpOptions: { timeout: 45_000 },
      },
    });
    const parsed = draftSchema.safeParse(JSON.parse(res.text ?? ''));
    if (!parsed.success) return fallback('Gemini output failed validation');
    const problem = rejectDraft(parsed.data, f);
    if (problem) return fallback(`Gemini draft ${problem}`);
    return { ...parsed.data, draftedBy: 'ai' };
  } catch (err) {
    console.warn('gemini draft failed, using template:', (err as Error).message);
    return fallback(`Gemini error: ${(err as Error).message}`);
  }
}

// ---------- reply classification ----------

export interface ReplyFacts {
  text: string; // quoted history already stripped
  today: string;
  dueDate: string;
  invoiceRef: string;
  amount: number;
  currency: string;
}

/** The next 21 days with weekday names, so Gemini can read dates instead of doing calendar math. */
export function upcomingCalendar(today: string, days = 21): string[] {
  return Array.from({ length: days }, (_, i) => {
    const d = addDays(today, i + 1);
    return `${weekdayOf(d)} ${d}`;
  });
}

export function buildReplyPrompt(r: ReplyFacts): string {
  const friday = nextWeekday(r.today, 'Friday');
  return [
    'Classify a customer\'s email reply to a payment reminder.',
    '',
    `Today is ${weekdayOf(r.today)} ${r.today}.`,
    `The reminder was about invoice ${r.invoiceRef} for ${formatMoney(r.amount, r.currency)}, due on ${weekdayOf(r.dueDate)} ${r.dueDate}.`,
    '',
    'Classes:',
    '- promise_to_pay: they commit to paying on or by a specific date.',
    '- dispute: they say the invoice is wrong, not owed, or the work/goods were not delivered as agreed.',
    '- already_paid: they say they have already paid.',
    '- other: anything else (out of office, thanks, questions, change of contact, "will forward to accounts", vague "soon" without a date).',
    '',
    'promise_date rules (YYYY-MM-DD):',
    '- Only for promise_to_pay; otherwise null.',
    '- Resolve relative dates against today.',
    `- "next <weekday>", "this <weekday>" and "on <weekday>" mean the nearest upcoming occurrence of that weekday strictly after today (today "next Friday" = ${friday}).`,
    `- "<weekday> next week" means that weekday in the following Monday–Sunday week (today "Friday next week" = ${weekdayNextWeek(r.today, 'Friday')}).`,
    '- A day of the month without a month ("the 15th") means the next such date on or after today.',
    '- Numeric dates like 17/11/2026 are day/month/year.',
    '- If they promise to pay without any date, use other.',
    '',
    'Upcoming calendar:',
    ...upcomingCalendar(r.today).map((d) => `- ${d}`),
    '',
    'confidence: 0–1, how sure you are of the class (and date).',
    '',
    'Reply text:',
    '"""',
    r.text.slice(0, 4000),
    '"""',
  ].join('\n');
}

/**
 * Classifies a reply with Gemini. Returns the validated result, or `{ ok: false }` when the output
 * fails validation (→ needs_review). Throws GeminiUnavailableError when Gemini can't be used, so the
 * caller stops and changes nothing — it never guesses.
 */
export async function classifyReply(r: ReplyFacts): Promise<{ ok: true; value: ReplyClassification } | { ok: false; reason: string }> {
  const { GEMINI_API_KEY, GEMINI_MODEL } = getConfig();
  if (!GEMINI_API_KEY || !GEMINI_MODEL) throw new GeminiUnavailableError('Gemini is not configured');

  let text: string | undefined;
  try {
    const res = await gemini(GEMINI_API_KEY).models.generateContent({
      model: GEMINI_MODEL,
      contents: buildReplyPrompt(r),
      config: {
        responseMimeType: 'application/json',
        responseJsonSchema: replyJsonSchema,
        temperature: 0,
        // Short structured answer: low thinking keeps it fast. Flash-Lite can still take 20–40 s under
        // load; a timeout stops the reply step for this run (nothing changes) and it retries next run.
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        httpOptions: { timeout: 60_000 },
      },
    });
    text = res.text;
  } catch (err) {
    const status = (err as { status?: number }).status;
    throw new GeminiUnavailableError(`Gemini error${status ? ` ${status}` : ''}: ${(err as Error).message}`, status);
  }

  let json: unknown;
  try {
    json = JSON.parse(text ?? '');
  } catch {
    return { ok: false, reason: 'Gemini output is not JSON' };
  }
  const parsed = replySchema.safeParse(json);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, reason: 'Gemini output failed validation' };
}
