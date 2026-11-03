import { Db } from '../db';
import { ReminderStatus, Tone } from '../domain/stages';

export interface Reminder {
  id: string;
  invoice_id: string;
  stage: number;
  tone: Tone;
  subject: string;
  body: string;
  status: ReminderStatus;
  drafted_by: 'ai' | 'template';
  gmail_message_id: string | null;
  gmail_thread_id: string | null;
  error: string | null;
  sent_at: string | null;
  created_at: string;
}

/** Pending (draft/approved) reminders for an invoice become `skipped`. Returns how many changed. */
export async function skipPendingForInvoice(db: Db, invoiceId: string): Promise<number> {
  const { rowCount } = await db.query(
    `update reminders set status = 'skipped' where invoice_id = $1 and status in ('draft', 'approved')`,
    [invoiceId],
  );
  return rowCount ?? 0;
}

export async function listAllStages(db: Db): Promise<Array<{ invoice_id: string; stage: number; status: ReminderStatus }>> {
  const { rows } = await db.query('select invoice_id, stage, status from reminders');
  return rows;
}

/** Inserts a draft; a second draft for the same (invoice, stage) is silently ignored. Returns true if inserted. */
export async function insertDraft(
  db: Db,
  d: { invoice_id: string; stage: number; tone: Tone; subject: string; body: string; drafted_by: 'ai' | 'template' },
): Promise<boolean> {
  const { rowCount } = await db.query(
    `insert into reminders (invoice_id, stage, tone, subject, body, drafted_by)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (invoice_id, stage) do nothing`,
    [d.invoice_id, d.stage, d.tone, d.subject, d.body, d.drafted_by],
  );
  return rowCount === 1;
}

export async function getReminder(db: Db, id: string): Promise<Reminder | undefined> {
  const { rows } = await db.query<Reminder>('select * from reminders where id = $1', [id]);
  return rows[0];
}

export async function listReminders(db: Db, status?: ReminderStatus) {
  const { rows } = await db.query(
    `select r.*,
            json_build_object('id', i.id, 'invoice_ref', i.invoice_ref, 'amount', i.amount, 'currency', i.currency,
                              'due_date', i.due_date, 'status', i.status, 'promise_date', i.promise_date) as invoice,
            json_build_object('id', c.id, 'name', c.name, 'email', c.email) as customer
     from reminders r
     join invoices i on i.id = r.invoice_id
     join customers c on c.id = i.customer_id
     where ($1::text is null or r.status = $1)
     order by r.created_at desc, r.stage desc`,
    [status ?? null],
  );
  return rows as Array<Reminder & { invoice: { id: string; amount: number }; customer: { id: string; name: string; email: string } }>;
}

/** Edits a draft. Returns undefined when the reminder is not a draft (or does not exist). */
export async function updateDraft(db: Db, id: string, subject: string, body: string): Promise<Reminder | undefined> {
  const { rows } = await db.query<Reminder>(
    `update reminders set subject = $2, body = $3 where id = $1 and status = 'draft' returning *`,
    [id, subject, body],
  );
  return rows[0];
}

/**
 * Atomically moves a draft (or a failed send, for retry) to `approved`. Only one caller can win,
 * so a double click can never send twice. Returns undefined when it was not draft/failed.
 */
export async function claimForSending(db: Db, id: string): Promise<Reminder | undefined> {
  const { rows } = await db.query<Reminder>(
    `update reminders set status = 'approved', error = null where id = $1 and status in ('draft', 'failed') returning *`,
    [id],
  );
  return rows[0];
}

export async function markSent(db: Db, id: string, gmailMessageId: string, gmailThreadId: string): Promise<Reminder> {
  const { rows } = await db.query<Reminder>(
    `update reminders set status = 'sent', gmail_message_id = $2, gmail_thread_id = $3, sent_at = now(), error = null
     where id = $1 returning *`,
    [id, gmailMessageId, gmailThreadId],
  );
  return rows[0];
}

export async function markFailed(db: Db, id: string, error: string): Promise<Reminder> {
  const { rows } = await db.query<Reminder>(`update reminders set status = 'failed', error = $2 where id = $1 returning *`, [id, error]);
  return rows[0];
}

export async function markSkipped(db: Db, id: string): Promise<Reminder | undefined> {
  const { rows } = await db.query<Reminder>(
    `update reminders set status = 'skipped' where id = $1 and status in ('draft', 'failed') returning *`,
    [id],
  );
  return rows[0];
}

/** The most recent sent reminder for an invoice before `stage` — its thread is where later stages reply. */
export async function previousSent(db: Db, invoiceId: string, stage: number): Promise<Reminder | undefined> {
  const { rows } = await db.query<Reminder>(
    `select * from reminders
     where invoice_id = $1 and stage < $2 and status = 'sent' and gmail_thread_id is not null
     order by stage desc limit 1`,
    [invoiceId, stage],
  );
  return rows[0];
}

/** Subject of the first sent reminder in a thread (later stages reply as "Re: <that subject>"). */
export async function threadSubject(db: Db, invoiceId: string): Promise<string | undefined> {
  const { rows } = await db.query<{ subject: string }>(
    `select subject from reminders where invoice_id = $1 and status = 'sent' and gmail_thread_id is not null order by stage limit 1`,
    [invoiceId],
  );
  return rows[0]?.subject;
}
