import { Router } from 'express';
import { getPool } from '../db';
import { ATTENTION_CLASSES, summarize } from '../domain/aging';
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

// Badge counts for the top nav.
dashboardRouter.get('/counts', async (_req, res) => {
  const { rows } = await getPool().query(
    `select
       (select count(*) from reminders where status in ('draft', 'failed'))::int as drafts,
       (select count(*) from reminders where status = 'failed')::int as failed,
       (select count(*) from replies where status = 'new')::int as replies_new,
       (select count(*) from replies where status = 'new' and classification = any($1))::int as replies_needing_attention`,
    [ATTENTION_CLASSES],
  );
  const r = rows[0];
  res.json({ drafts: r.drafts, failed: r.failed, repliesNew: r.replies_new, repliesNeedingAttention: r.replies_needing_attention });
});
