import { Router } from 'express';
import { z } from 'zod';
import { getPool, withTransaction } from '../db';
import { HttpError, isoDateString, parseOr400, requestToday, uuidParam } from '../http';
import { setPromiseDate } from '../repos/invoices';
import { getReply, listRepliesDetailed, markReviewed } from '../repos/replies';
import { skipPendingForInvoice } from '../repos/reminders';

export const repliesRouter = Router();

repliesRouter.get('/', async (req, res) => {
  const { status } = parseOr400(z.object({ status: z.enum(['new', 'reviewed']).optional() }), req.query);
  res.json(await listRepliesDetailed(getPool(), status));
});

// The user confirms or corrects a classification. A (corrected) promise sets the invoice's promise_date.
repliesRouter.post('/:id/review', async (req, res) => {
  const id = uuidParam.safeParse(req.params.id);
  if (!id.success) throw new HttpError(404, 'reply not found');
  const body = parseOr400(
    z.object({
      classification: z.enum(['promise_to_pay', 'dispute', 'already_paid', 'other']).optional(),
      promise_date: isoDateString.nullable().optional(),
    }),
    req.body ?? {},
  );
  const today = requestToday(req);

  const result = await withTransaction(async (tx) => {
    const reply = await getReply(tx, id.data);
    if (!reply) throw new HttpError(404, 'reply not found');
    const classification = body.classification ?? reply.classification;
    if (classification === 'needs_review') throw new HttpError(400, 'choose a classification for this reply');
    const promiseDate = classification === 'promise_to_pay' ? (body.promise_date ?? reply.extracted_date) : (body.promise_date ?? null);
    if (classification === 'promise_to_pay') {
      if (!promiseDate) throw new HttpError(400, 'a promise to pay needs a promise_date');
      if (promiseDate < today) throw new HttpError(400, 'the promise date has already passed');
    }

    const updated = await markReviewed(tx, reply.id, classification, promiseDate);
    let promiseSet = false;
    if (reply.invoice_id && classification === 'promise_to_pay') {
      promiseSet = await setPromiseDate(tx, reply.invoice_id, promiseDate!);
      await skipPendingForInvoice(tx, reply.invoice_id);
    } else if (reply.invoice_id && (classification === 'dispute' || classification === 'already_paid')) {
      await skipPendingForInvoice(tx, reply.invoice_id);
    }
    return { reply: updated, promiseSet };
  });
  res.json(result);
});
