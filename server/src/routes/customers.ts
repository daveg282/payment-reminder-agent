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
  const invoices = await listInvoices(getPool(), { customerId: customer.id });
  res.json({ ...customer, invoices });
});
