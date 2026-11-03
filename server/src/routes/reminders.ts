import { Router } from 'express';
import { z } from 'zod';
import { getPool } from '../db';
import { scoreCustomer } from '../domain/risk';
import { HttpError, parseOr400, requestToday, uuidParam } from '../http';
import { listInvoices } from '../repos/invoices';
import { getReminder, listReminders, markSkipped, updateDraft } from '../repos/reminders';
import { approveAndSend } from '../services/reminders';

export const remindersRouter = Router();

const reminderId = (raw: string) => {
  const id = uuidParam.safeParse(raw);
  if (!id.success) throw new HttpError(404, 'reminder not found');
  return id.data;
};

remindersRouter.get('/', async (req, res) => {
  const { status } = parseOr400(z.object({ status: z.enum(['draft', 'approved', 'sent', 'skipped', 'failed']).optional() }), req.query);
  const today = requestToday(req);
  const [reminders, invoices] = await Promise.all([listReminders(getPool(), status), listInvoices(getPool())]);
  res.json(
    reminders.map((r) => {
      const { label, reason } = scoreCustomer(invoices.filter((i) => i.customer_id === r.customer.id), today);
      return { ...r, risk: { label, reason } };
    }),
  );
});

remindersRouter.patch('/:id', async (req, res) => {
  const id = reminderId(req.params.id);
  const body = parseOr400(
    z.object({
      subject: z.string().trim().min(1, 'subject is required').max(200).refine((s) => !/[\r\n]/.test(s), 'subject must be one line'),
      body: z.string().trim().min(1, 'body is required').max(5000),
    }),
    req.body,
  );
  const updated = await updateDraft(getPool(), id, body.subject, body.body);
  if (updated) return void res.json(updated);
  const existing = await getReminder(getPool(), id);
  if (!existing) throw new HttpError(404, 'reminder not found');
  throw new HttpError(409, `reminder is ${existing.status}; only drafts can be edited`);
});

remindersRouter.post('/:id/approve', async (req, res) => {
  const reminder = await approveAndSend(reminderId(req.params.id));
  res.status(reminder.status === 'sent' ? 200 : 502).json(reminder);
});

remindersRouter.post('/:id/skip', async (req, res) => {
  const id = reminderId(req.params.id);
  const skipped = await markSkipped(getPool(), id);
  if (skipped) return void res.json(skipped);
  const existing = await getReminder(getPool(), id);
  if (!existing) throw new HttpError(404, 'reminder not found');
  throw new HttpError(409, `reminder is ${existing.status}; only drafts or failed sends can be skipped`);
});
