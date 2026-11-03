import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { getConfig } from '../config';
import { formatDate, formatMoney, ReminderFacts, templateReminder } from '../domain/templates';

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

export function buildDraftPrompt(f: ReminderFacts): string {
  const when =
    f.daysLate < 0
      ? `due in ${-f.daysLate} day(s), on ${formatDate(f.dueDate)}`
      : f.daysLate === 0
        ? `due today, ${formatDate(f.dueDate)}`
        : `${f.daysLate} day(s) overdue (it was due on ${formatDate(f.dueDate)})`;
  return [
    'Write a payment reminder email.',
    '',
    'Facts (use exactly these, do not invent any others):',
    `- Customer name: ${f.customerName}`,
    `- Invoice: ${f.invoiceRef}`,
    `- Amount: ${formatMoney(f.amount, f.currency)}`,
    `- Status: ${when}`,
    `- Reminder number: ${f.stage} of 4`,
    `- Sign the email as: ${f.senderName || '(no name — end with a short closing only)'}`,
    '',
    `Tone: ${f.tone} — ${TONE_GUIDE[f.tone]}.`,
    '',
    'Rules:',
    '- Plain, polite and short: the body must be under 120 words.',
    '- Mention the invoice reference and the amount.',
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
        httpOptions: { timeout: 20_000 },
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
