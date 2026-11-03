import { Router } from 'express';
import { getPool } from '../db';
import { HttpError, parseOr400, uuidParam } from '../http';
import { getCustomer, listCustomers } from '../repos/customers';
import { listInvoices } from '../repos/invoices';

export const customersRouter = Router();

customersRouter.get('/', async (_req, res) => {
  res.json(await listCustomers(getPool()));
});

customersRouter.get('/:id', async (req, res) => {
  const id = uuidParam.safeParse(req.params.id);
  const customer = id.success ? await getCustomer(getPool(), id.data) : undefined;
  if (!customer) throw new HttpError(404, 'customer not found');
  const invoices = await listInvoices(getPool(), { customerId: customer.id });
  res.json({ ...customer, invoices });
});
