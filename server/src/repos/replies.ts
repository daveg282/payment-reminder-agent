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
