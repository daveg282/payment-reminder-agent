import { Db, withTransaction } from '../db';
import { MIN_CONFIDENCE } from '../domain/replySchema';
import { addressOf, stripQuoted } from '../domain/replyText';
import { setPromiseDate } from '../repos/invoices';
import { getGoogleToken } from '../repos/googleTokens';
import { insertReply, knownMessageIds, readableThreads, ReplyClass } from '../repos/replies';
import { skipPendingForInvoice } from '../repos/reminders';
import { classifyReply } from './gemini';
import { gmailFor } from './gmail';

export interface ReplyCheckResult {
  threadsChecked: number;
  repliesProcessed: number;
  byClass: Partial<Record<ReplyClass, number>>;
}

/**
 * Reads ONLY the threads of reminders we sent (stored thread ids on open invoices) — never searches
 * the mailbox — classifies each new customer message with Gemini and acts on it. Never sends email.
 *
 * Throws GeminiUnavailableError (from classifyReply) as soon as Gemini can't be used: the message being
 * handled is left untouched and the rest of the run's replies wait for the next run.
 */
export async function checkReplies(db: Db, today: string): Promise<ReplyCheckResult> {
  const result: ReplyCheckResult = { threadsChecked: 0, repliesProcessed: 0, byClass: {} };
  const token = await getGoogleToken(db);
  if (!token) return result; // Google not connected: nothing to read
  const gmail = gmailFor(token.refresh_token);
  const ownAddress = token.email.toLowerCase();

  for (const thread of await readableThreads(db)) {
    result.threadsChecked++;
    const messages = await gmail.threadMessages(thread.thread_id);
    const ours = new Set(thread.our_message_ids);
    const lastOurs = Math.max(0, ...messages.filter((m) => ours.has(m.id)).map((m) => m.internalDate));
    const candidates = messages.filter((m) => m.internalDate > lastOurs && !ours.has(m.id) && addressOf(m.from) !== ownAddress);
    const known = await knownMessageIds(db, candidates.map((m) => m.id));

    for (const msg of candidates.filter((m) => !known.has(m.id)).sort((a, b) => a.internalDate - b.internalDate)) {
      const text = stripQuoted(await gmail.messageText(msg.id));
      const verdict = await classifyReply({
        text,
        today,
        dueDate: thread.due_date,
        invoiceRef: thread.invoice_ref,
        amount: thread.amount,
        currency: thread.currency,
      });

      // Decide what this reply means. Anything uncertain goes to the user as needs_review.
      let classification: ReplyClass = 'needs_review';
      let extractedDate: string | null = null;
      if (verdict.ok) {
        const v = verdict.value;
        extractedDate = v.promise_date;
        if (v.confidence < MIN_CONFIDENCE) classification = 'needs_review';
        else if (v.classification === 'promise_to_pay') classification = v.promise_date! >= today ? 'promise_to_pay' : 'needs_review';
        else classification = v.classification;
      }

      const stored = await withTransaction(async (tx) => {
        const reply = await insertReply(tx, {
          gmail_message_id: msg.id,
          gmail_thread_id: thread.thread_id,
          invoice_id: thread.invoice_id,
          customer_id: thread.customer_id,
          classification,
          extracted_date: extractedDate,
          snippet: text.slice(0, 500) || '(empty message)',
          received_at: new Date(msg.internalDate).toISOString(),
        });
        if (!reply) return false; // stored by a concurrent run
        if (classification === 'promise_to_pay') {
          await setPromiseDate(tx, thread.invoice_id, extractedDate!); // pauses reminders until that date
          await skipPendingForInvoice(tx, thread.invoice_id);
        } else if (classification === 'dispute' || classification === 'already_paid') {
          // Never reply automatically: stop pending drafts and let the user decide.
          await skipPendingForInvoice(tx, thread.invoice_id);
        }
        return true;
      });
      if (stored) {
        result.repliesProcessed++;
        result.byClass[classification] = (result.byClass[classification] ?? 0) + 1;
      }
    }
  }
  return result;
}
