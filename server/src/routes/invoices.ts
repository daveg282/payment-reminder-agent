import { Router } from 'express';
import { z } from 'zod';
import { getPool, withTransaction } from '../db';
import { HttpError, isoDateString, parseOr400, requestToday, uuidParam } from '../http';
import { getInvoice, listInvoices, markPaid } from '../repos/invoices';
import { skipPendingForInvoice } from '../repos/reminders';

export const invoicesRouter = Router();

invoicesRouter.get('/', async (req, res) => {
  const { status } = parseOr400(z.object({ status: z.enum(['open', 'paid', 'void']).optional() }), req.query);
  res.json(await listInvoices(getPool(), { status }));
});

invoicesRouter.post('/:id/mark-paid', async (req, res) => {
  const id = uuidParam.safeParse(req.params.id);
  if (!id.success) throw new HttpError(404, 'invoice not found');
  const body = parseOr400(z.object({ paid_date: isoDateString.optional() }), req.body ?? {});
  const paidDate = body.paid_date ?? requestToday(req);

  const result = await withTransaction(async (tx) => {
    const invoice = await getInvoice(tx, id.data);
    if (!invoice) throw new HttpError(404, 'invoice not found');
    if (invoice.status === 'void') throw new HttpError(409, 'a void invoice cannot be marked paid');
    const updated = await markPaid(tx, invoice.id, paidDate);
    const remindersSkipped = await skipPendingForInvoice(tx, invoice.id);
    return { invoice: updated, remindersSkipped };
  });
  res.json(result);
});
