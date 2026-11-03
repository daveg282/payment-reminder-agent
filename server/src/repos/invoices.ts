import { Db } from '../db';

export type InvoiceStatus = 'open' | 'paid' | 'void';

export interface Invoice {
  id: string;
  customer_id: string;
  invoice_ref: string;
  amount: number;
  currency: string;
  issue_date: string;
  due_date: string;
  paid_date: string | null;
  status: InvoiceStatus;
  period: string | null;
  promise_date: string | null;
  source: 'import' | 'recurring' | 'sheet' | 'manual';
  created_at: string;
}

export interface NewInvoice {
  customer_id: string;
  invoice_ref: string;
  amount: number;
  currency: string;
  issue_date: string;
  due_date: string;
  period?: string | null;
  source: Invoice['source'];
}

/** Inserts an invoice unless one with the same ref (or period) already exists. Returns true if inserted. */
export async function insertInvoiceIfNew(db: Db, inv: NewInvoice): Promise<boolean> {
  const { rowCount } = await db.query(
    `insert into invoices (customer_id, invoice_ref, amount, currency, issue_date, due_date, period, source)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict do nothing`,
    [inv.customer_id, inv.invoice_ref, inv.amount, inv.currency, inv.issue_date, inv.due_date, inv.period ?? null, inv.source],
  );
  return rowCount === 1;
}

export async function listInvoices(
  db: Db,
  filter: { status?: InvoiceStatus; customerId?: string } = {},
): Promise<(Invoice & { customer_name: string; customer_email: string })[]> {
  const { rows } = await db.query(
    `select i.*, c.name as customer_name, c.email as customer_email
     from invoices i join customers c on c.id = i.customer_id
     where ($1::text is null or i.status = $1)
       and ($2::uuid is null or i.customer_id = $2)
     order by i.due_date, i.invoice_ref`,
    [filter.status ?? null, filter.customerId ?? null],
  );
  return rows;
}

export async function getInvoice(db: Db, id: string): Promise<Invoice | undefined> {
  const { rows } = await db.query<Invoice>('select * from invoices where id = $1', [id]);
  return rows[0];
}

export async function markPaid(db: Db, id: string, paidDate: string): Promise<Invoice> {
  const { rows } = await db.query<Invoice>(
    `update invoices set paid_date = $2, status = 'paid', promise_date = null where id = $1 returning *`,
    [id, paidDate],
  );
  return rows[0];
}
