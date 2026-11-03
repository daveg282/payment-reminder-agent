import { Router } from 'express';
import { getPool } from '../db';
import { scoreCustomer } from '../domain/risk';
import { HttpError, requestToday, uuidParam } from '../http';
import { getCustomer, listCustomers } from '../repos/customers';
import { listInvoices } from '../repos/invoices';

export const customersRouter = Router();

customersRouter.get('/', async (req, res) => {
  const today = requestToday(req);
  const [customers, invoices] = await Promise.all([listCustomers(getPool()), listInvoices(getPool())]);
  res.json(
    customers.map((c) => {
      const { label, reason } = scoreCustomer(invoices.filter((i) => i.customer_id === c.id), today);
      return { ...c, risk: { label, reason } };
    }),
  );
});

customersRouter.get('/:id', async (req, res) => {
  const id = uuidParam.safeParse(req.params.id);
  const customer = id.success ? await getCustomer(getPool(), id.data) : undefined;
  if (!customer) throw new HttpError(404, 'customer not found');
  const db = getPool();
  const [invoices, reminders, replies] = await Promise.all([
    listInvoices(db, { customerId: customer.id }),
    db.query(
      `select r.id, r.invoice_id, r.stage, r.tone, r.status, r.sent_at, r.created_at, r.drafted_by, r.error
       from reminders r join invoices i on i.id = r.invoice_id where i.customer_id = $1 order by r.stage`,
      [customer.id],
    ),
    db.query(
      `select rp.id, rp.invoice_id, rp.classification, rp.extracted_date, rp.snippet, rp.status, rp.received_at, i.invoice_ref
       from replies rp left join invoices i on i.id = rp.invoice_id where rp.customer_id = $1 order by rp.received_at desc`,
      [customer.id],
    ),
  ]);
  const { label, reason } = scoreCustomer(invoices, requestToday(req));
  res.json({
    ...customer,
    risk: { label, reason },
    invoices: invoices.map((i) => ({ ...i, reminders: reminders.rows.filter((r) => r.invoice_id === i.id) })),
    replies: replies.rows,
  });
});
