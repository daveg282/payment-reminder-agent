import { Router } from 'express';
import { getPool } from '../db';
import { summarize } from '../domain/aging';
import { requestToday } from '../http';
import { listCustomers } from '../repos/customers';
import { listInvoices } from '../repos/invoices';
import { listReplies } from '../repos/replies';

export const dashboardRouter = Router();

dashboardRouter.get('/', async (req, res) => {
  const today = requestToday(req);
  const db = getPool();
  const [invoices, customers, replies] = await Promise.all([listInvoices(db), listCustomers(db), listReplies(db)]);
  res.json({ today, ...summarize(invoices, customers, replies, today) });
});
