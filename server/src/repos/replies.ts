import { Db } from '../db';

export interface Reply {
  id: string;
  gmail_message_id: string;
  gmail_thread_id: string;
  invoice_id: string | null;
  customer_id: string | null;
  classification: 'promise_to_pay' | 'dispute' | 'already_paid' | 'other' | 'needs_review';
  extracted_date: string | null;
  snippet: string;
  status: 'new' | 'reviewed';
  received_at: string;
  created_at: string;
}

export async function listReplies(db: Db): Promise<Reply[]> {
  const { rows } = await db.query<Reply>('select * from replies order by received_at desc');
  return rows;
}

export type ReplyClass = Reply['classification'];

/** Threads the app may read: those of sent reminders on open invoices, with our message ids in each. */
export async function readableThreads(db: Db): Promise<
  Array<{ thread_id: string; invoice_id: string; customer_id: string; due_date: string; invoice_ref: string; amount: number; currency: string; our_message_ids: string[] }>
> {
  const { rows } = await db.query(
    `select r.gmail_thread_id as thread_id, i.id as invoice_id, i.customer_id, i.due_date, i.invoice_ref, i.amount, i.currency,
            array_agg(r.gmail_message_id) as our_message_ids
     from reminders r join invoices i on i.id = r.invoice_id
     where r.status = 'sent' and r.gmail_thread_id is not null and r.gmail_message_id is not null and i.status = 'open'
     group by r.gmail_thread_id, i.id`,
  );
  return rows;
}

export async function knownMessageIds(db: Db, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { rows } = await db.query<{ gmail_message_id: string }>('select gmail_message_id from replies where gmail_message_id = any($1)', [ids]);
  return new Set(rows.map((r) => r.gmail_message_id));
}

/** Stores a reply once; returns undefined if this Gmail message was already stored. */
export async function insertReply(
  db: Db,
  r: { gmail_message_id: string; gmail_thread_id: string; invoice_id: string; customer_id: string; classification: ReplyClass; extracted_date: string | null; snippet: string; received_at: string },
): Promise<Reply | undefined> {
  const { rows } = await db.query<Reply>(
    `insert into replies (gmail_message_id, gmail_thread_id, invoice_id, customer_id, classification, extracted_date, snippet, received_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (gmail_message_id) do nothing returning *`,
    [r.gmail_message_id, r.gmail_thread_id, r.invoice_id, r.customer_id, r.classification, r.extracted_date, r.snippet, r.received_at],
  );
  return rows[0];
}

export async function listRepliesDetailed(db: Db, status?: 'new' | 'reviewed') {
  const { rows } = await db.query(
    `select rp.*, i.invoice_ref, i.amount, i.currency, i.status as invoice_status, i.promise_date, c.name as customer_name, c.email as customer_email
     from replies rp
     left join invoices i on i.id = rp.invoice_id
     left join customers c on c.id = rp.customer_id
     where ($1::text is null or rp.status = $1)
     order by rp.received_at desc`,
    [status ?? null],
  );
  return rows;
}

export async function getReply(db: Db, id: string): Promise<Reply | undefined> {
  const { rows } = await db.query<Reply>('select * from replies where id = $1', [id]);
  return rows[0];
}

export async function markReviewed(db: Db, id: string, classification: ReplyClass, extractedDate: string | null): Promise<Reply> {
  const { rows } = await db.query<Reply>(
    `update replies set classification = $2, extracted_date = $3, status = 'reviewed' where id = $1 returning *`,
    [id, classification, extractedDate],
  );
  return rows[0];
}

/**
 * Invoices with an unreviewed reply that needs the user (dispute, already paid, or unclear):
 * no new drafts are created for them until the reply is reviewed.
 */
export async function invoicesAwaitingReview(db: Db): Promise<Set<string>> {
  const { rows } = await db.query<{ invoice_id: string }>(
    `select distinct invoice_id from replies
     where status = 'new' and invoice_id is not null and classification in ('dispute', 'already_paid', 'needs_review')`,
  );
  return new Set(rows.map((r) => r.invoice_id));
}
