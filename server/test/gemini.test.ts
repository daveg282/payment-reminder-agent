import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetConfig } from '../src/config';
import { ReminderFacts, templateReminder } from '../src/domain/templates';
import { buildDraftPrompt, draftReminder } from '../src/services/gemini';

const generateContent = vi.hoisted(() => vi.fn());
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
}));

const facts: ReminderFacts = {
  customerName: 'Aster Design',
  invoiceRef: 'INV-1001',
  amount: 1200,
  currency: 'USD',
  dueDate: '2026-09-30',
  daysLate: 34,
  tone: 'firm',
  stage: 3,
  senderName: 'Sam Sender',
};
const reply = (obj: unknown) => ({ text: typeof obj === 'string' ? obj : JSON.stringify(obj) });

describe('draftReminder', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_MODEL = 'gemini-test';
    resetConfig();
    generateContent.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    process.env.GEMINI_API_KEY = '';
    resetConfig();
    vi.restoreAllMocks();
  });

  it('uses the validated Gemini draft and asks for structured JSON', async () => {
    generateContent.mockResolvedValue(reply({ subject: 'Invoice INV-1001 is overdue', body: 'Hi Aster Design, invoice INV-1001 for $1,200.00 is 34 days overdue. Please pay or reply with a date. Sam Sender' }));
    const draft = await draftReminder(facts);
    expect(draft).toMatchObject({ draftedBy: 'ai', subject: 'Invoice INV-1001 is overdue' });
    const call = generateContent.mock.calls[0][0];
    expect(call.model).toBe('gemini-test');
    expect(call.config.responseMimeType).toBe('application/json');
    expect(call.config.responseJsonSchema.required).toEqual(['subject', 'body']);
  });

  it.each([
    ['Gemini throws (e.g. 429 / network)', () => generateContent.mockRejectedValue(Object.assign(new Error('Resource exhausted'), { status: 429 }))],
    ['the response is not JSON', () => generateContent.mockResolvedValue(reply('Sure! Here is your email...'))],
    ['the JSON fails the zod schema', () => generateContent.mockResolvedValue(reply({ subject: 'Hi' }))],
    ['the draft omits the invoice reference', () => generateContent.mockResolvedValue(reply({ subject: 'Payment reminder', body: 'Hello, you owe us money. Please pay soon, thanks.' }))],
    ['the draft contains a placeholder', () => generateContent.mockResolvedValue(reply({ subject: 'INV-1001', body: 'Hi [Customer Name], please pay invoice INV-1001 soon.' }))],
  ])('falls back to the fixed template for the tone when %s', async (_case, setup) => {
    setup();
    const draft = await draftReminder(facts);
    expect(draft.draftedBy).toBe('template');
    expect({ subject: draft.subject, body: draft.body }).toEqual(templateReminder(facts));
  });

  it('uses the template without calling Gemini when it is not configured', async () => {
    process.env.GEMINI_API_KEY = '';
    resetConfig();
    expect((await draftReminder(facts)).draftedBy).toBe('template');
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('puts the real facts and safety rules in the prompt', () => {
    const prompt = buildDraftPrompt(facts);
    for (const s of ['Aster Design', 'INV-1001', '$1,200.00', '34 day(s) overdue', 'under 120 words', 'No threats, no legal claims']) {
      expect(prompt).toContain(s);
    }
  });
});

describe('templateReminder', () => {
  it.each(['friendly', 'firm', 'final'] as const)('%s template states the facts in under 120 words', (tone) => {
    const t = templateReminder({ ...facts, tone });
    expect(`${t.subject} ${t.body}`).toContain('INV-1001');
    expect(t.body).toContain('$1,200.00');
    expect(t.body).toContain('September 30, 2026');
    expect(t.body.split(/\s+/).length).toBeLessThan(120);
  });

  it('friendly before the due date says "is due", not overdue', () => {
    const t = templateReminder({ ...facts, tone: 'friendly', daysLate: -3, stage: 1 });
    expect(t.body).toContain('is due on September 30, 2026');
    expect(t.body).not.toMatch(/overdue/);
  });
});
