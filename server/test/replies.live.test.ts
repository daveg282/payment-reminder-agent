// Live Gemini check of reply classification. Runs only with RUN_LIVE_AI=1 (uses the real GEMINI_API_KEY).
import { describe, expect, it } from 'vitest';
import { resetConfig } from '../src/config';
import { classifyReply, GeminiUnavailableError } from '../src/services/gemini';
import fixture from './fixtures/replies.json';

const live = process.env.RUN_LIVE_AI === '1';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!live)('reply classification with the real Gemini', () => {
  it('classifies at least 18 of the 20 invented replies correctly', { timeout: 1_800_000 }, async () => {
    resetConfig();
    const rows: Array<{ id: number; expected: string; got: string; ok: boolean }> = [];
    for (const r of fixture.replies) {
      let verdict;
      for (let attempt = 1; ; attempt++) {
        try {
          verdict = await classifyReply({ text: r.text, today: fixture.today, dueDate: fixture.dueDate, invoiceRef: fixture.invoiceRef, amount: fixture.amount, currency: fixture.currency });
          break;
        } catch (err) {
          // Temporary Gemini trouble (rate limit, overload, timeout): back off and retry. The app itself
          // never retries like this — it pauses reply detection until the next run.
          const temporary = err instanceof GeminiUnavailableError && (err.status === undefined || [429, 500, 503, 504].includes(err.status));
          if (temporary && attempt < 6) {
            console.log(`reply ${r.id}: ${(err as Error).message.slice(0, 80)} — retrying (${attempt}/5)`);
            await sleep(20_000 * attempt);
            continue;
          }
          throw err;
        }
      }
      const got = verdict.ok ? `${verdict.value.classification}${verdict.value.promise_date ? ` ${verdict.value.promise_date}` : ''} (${verdict.value.confidence})` : `invalid: ${verdict.reason}`;
      const ok =
        verdict.ok &&
        verdict.value.classification === r.expected &&
        (r.expected !== 'promise_to_pay' || verdict.value.promise_date === r.date);
      rows.push({ id: r.id, expected: `${r.expected}${r.date ? ` ${r.date}` : ''}`, got, ok });
      await sleep(1_000);
    }
    const score = rows.filter((r) => r.ok).length;
    console.table(rows);
    console.log(`LIVE SCORE: ${score}/20`);
    expect(score).toBeGreaterThanOrEqual(18);
  });
});
