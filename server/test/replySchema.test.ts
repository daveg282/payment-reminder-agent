import { describe, expect, it } from 'vitest';
import { replySchema } from '../src/domain/replySchema';

describe('replySchema', () => {
  it('accepts valid classifications', () => {
    expect(replySchema.safeParse({ classification: 'promise_to_pay', promise_date: '2026-11-06', confidence: 0.9 }).success).toBe(true);
    expect(replySchema.safeParse({ classification: 'dispute', promise_date: null, confidence: 0.8 }).success).toBe(true);
    expect(replySchema.safeParse({ classification: 'other', promise_date: null, confidence: 0 }).success).toBe(true);
  });

  it('rejects a promise without a date', () => {
    expect(replySchema.safeParse({ classification: 'promise_to_pay', promise_date: null, confidence: 0.9 }).success).toBe(false);
  });

  it.each(['06/11/2026', '2026-11-6', 'next Friday', '2026/11/06', ''])('rejects a bad date format: %s', (promise_date) => {
    expect(replySchema.safeParse({ classification: 'promise_to_pay', promise_date, confidence: 0.9 }).success).toBe(false);
  });

  it.each(['payment_plan', 'needs_review', 'PROMISE_TO_PAY', ''])('rejects an unknown class: %s', (classification) => {
    expect(replySchema.safeParse({ classification, promise_date: null, confidence: 0.9 }).success).toBe(false);
  });

  it('rejects confidence outside 0–1 and missing fields', () => {
    expect(replySchema.safeParse({ classification: 'other', promise_date: null, confidence: 1.2 }).success).toBe(false);
    expect(replySchema.safeParse({ classification: 'other', promise_date: null }).success).toBe(false);
    expect(replySchema.safeParse({ classification: 'other', confidence: 0.7 }).success).toBe(false);
  });
});
