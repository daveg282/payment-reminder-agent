import { Db } from '../db';

/** Pending (draft/approved) reminders for an invoice become `skipped`. Returns how many changed. */
export async function skipPendingForInvoice(db: Db, invoiceId: string): Promise<number> {
  const { rowCount } = await db.query(
    `update reminders set status = 'skipped' where invoice_id = $1 and status in ('draft', 'approved')`,
    [invoiceId],
  );
  return rowCount ?? 0;
}
