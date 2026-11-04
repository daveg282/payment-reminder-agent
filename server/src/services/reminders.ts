import { Db, getPool } from '../db';
import { daysBetween, todayIso } from '../domain/dates';
import { buildRawMessage } from '../domain/email';
import { scoreCustomer } from '../domain/risk';
import { nextStageDue } from '../domain/stages';
import { getConfig } from '../config';
import { HttpError } from '../http';
import { getGoogleToken } from '../repos/googleTokens';
import { getInvoice, listInvoices } from '../repos/invoices';
import { invoicesAwaitingReview } from '../repos/replies';
import {
  claimForSending,
  getReminder,
  insertDraft,
  listAllStages,
  markFailed,
  markSent,
  previousSent,
  Reminder,
  threadSubject,
} from '../repos/reminders';
import { draftReminder } from './gemini';
import { gmailFor } from './gmail';

const reSubject = (s: string) => (/^re:/i.test(s) ? s : `Re: ${s}`);

/**
 * Creates a draft for every open invoice whose next stage is due. Never sends anything.
 * `brokenPromises` holds the invoices whose promise was just cleared, so their next stage is due now.
 */
export async function createDueDrafts(
  db: Db,
  today: string,
  brokenPromises: Map<string, string> = new Map(),
): Promise<{ draftsCreated: number; draftsByAi: number; draftsByTemplate: number }> {
  const [invoices, stages, awaitingReview] = await Promise.all([listInvoices(db), listAllStages(db), invoicesAwaitingReview(db)]);
  const stagesByInvoice = new Map<string, typeof stages>();
  for (const s of stages) stagesByInvoice.set(s.invoice_id, [...(stagesByInvoice.get(s.invoice_id) ?? []), s]);
  const invoicesByCustomer = new Map<string, typeof invoices>();
  for (const i of invoices) invoicesByCustomer.set(i.customer_id, [...(invoicesByCustomer.get(i.customer_id) ?? []), i]);

  const result = { draftsCreated: 0, draftsByAi: 0, draftsByTemplate: 0 };
  // A dispute, "already paid" or unclear reply pauses new drafts until the user reviews it.
  for (const inv of invoices.filter((i) => i.status === 'open' && !awaitingReview.has(i.id))) {
    const risk = scoreCustomer(invoicesByCustomer.get(inv.customer_id) ?? [], today).label;
    const promise_date = brokenPromises.get(inv.id) ?? inv.promise_date;
    const due = nextStageDue({ ...inv, promise_date }, stagesByInvoice.get(inv.id) ?? [], risk, today);
    if (!due) continue;

    const draft = await draftReminder({
      customerName: inv.customer_name,
      invoiceRef: inv.invoice_ref,
      amount: inv.amount,
      currency: inv.currency,
      dueDate: inv.due_date,
      daysLate: daysBetween(inv.due_date, today),
      tone: due.tone,
      stage: due.stage,
      senderName: getConfig().SENDER_NAME,
    });
    // Later stages reply in the first reminder's thread, so keep its subject.
    const rootSubject = due.stage > 1 ? await threadSubject(db, inv.id) : undefined;
    const inserted = await insertDraft(db, {
      invoice_id: inv.id,
      stage: due.stage,
      tone: due.tone,
      subject: rootSubject ? reSubject(rootSubject) : draft.subject,
      body: draft.body,
      drafted_by: draft.draftedBy,
    });
    if (!inserted) continue;
    result.draftsCreated++;
    if (draft.draftedBy === 'ai') result.draftsByAi++;
    else result.draftsByTemplate++;
    console.log(`drafted ${inv.invoice_ref} stage ${due.stage} (${due.tone}) by ${draft.draftedBy}${draft.fallbackReason ? `: ${draft.fallbackReason}` : ''}`);
  }
  return result;
}

/**
 * Approves a draft (or retries a failed send) and sends it via Gmail right away.
 * This is the ONLY code path in the app that sends email.
 */
export async function approveAndSend(id: string): Promise<Reminder> {
  const db = getPool();
  const token = await getGoogleToken(db);
  if (!token) throw new HttpError(409, 'connect your Google account before sending reminders');

  const existing = await getReminder(db, id);
  if (!existing) throw new HttpError(404, 'reminder not found');
  const invoice = await getInvoice(db, existing.invoice_id);
  if (!invoice || invoice.status !== 'open') throw new HttpError(409, 'the invoice is no longer open; nothing was sent');
  if (invoice.promise_date && invoice.promise_date >= todayIso()) {
    throw new HttpError(409, 'reminders for this invoice are paused by a promise to pay; nothing was sent');
  }

  const { rows } = await db.query<{ email: string }>('select email from customers where id = $1', [invoice.customer_id]);
  const to = rows[0].email;
  const allowlist = getConfig().SEND_ALLOWLIST;
  if (allowlist && !allowlist.includes(to.toLowerCase())) {
    throw new HttpError(403, `This demo only sends to its own test inbox, and ${to} isn't on the allowlist, so nothing was sent.`);
  }

  const reminder = await claimForSending(db, id);
  if (!reminder) throw new HttpError(409, `reminder is ${existing.status}; only drafts or failed sends can be approved`);

  try {
    const gmail = gmailFor(token.refresh_token);
    const previous = reminder.stage > 1 ? await previousSent(db, reminder.invoice_id, reminder.stage) : undefined;
    const inReplyTo = previous?.gmail_message_id ? await gmail.messageIdHeader(previous.gmail_message_id) : null;

    const raw = buildRawMessage({
      fromName: getConfig().SENDER_NAME,
      fromAddress: token.email,
      to,
      subject: reminder.subject,
      body: reminder.body,
      inReplyTo,
    });
    const sent = await gmail.send(raw, previous?.gmail_thread_id ?? null);
    return await markSent(db, reminder.id, sent.messageId, sent.threadId);
  } catch (err) {
    console.error(`sending reminder ${reminder.id} failed:`, (err as Error).message);
    return markFailed(db, reminder.id, (err as Error).message || 'send failed');
  }
}
