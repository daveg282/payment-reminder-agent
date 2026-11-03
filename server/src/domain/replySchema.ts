import { z } from 'zod';

/** Gemini's classification of a customer reply. Anything that fails this schema becomes `needs_review`. */
export const replySchema = z
  .object({
    classification: z.enum(['promise_to_pay', 'dispute', 'already_paid', 'other']),
    promise_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    confidence: z.number().min(0).max(1),
  })
  .refine((v) => v.classification !== 'promise_to_pay' || v.promise_date !== null);

export type ReplyClassification = z.infer<typeof replySchema>;

/** Same shape as JSON Schema, for Gemini structured output. */
export const replyJsonSchema = {
  type: 'object',
  properties: {
    classification: { type: 'string', enum: ['promise_to_pay', 'dispute', 'already_paid', 'other'] },
    promise_date: { type: ['string', 'null'], description: 'YYYY-MM-DD date the customer promises to pay; null unless promise_to_pay' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['classification', 'promise_date', 'confidence'],
};

/** Below this confidence a classification is never acted on; it goes to the user as `needs_review`. */
export const MIN_CONFIDENCE = 0.6;
