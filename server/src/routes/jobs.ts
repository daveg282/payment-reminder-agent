import { Router } from 'express';
import { getPool } from '../db';
import { requestToday } from '../http';
import { generateRecurringInvoices } from '../services/recurringInvoices';

// Session-protected job triggers for testing. `POST /jobs/run` (secret header) arrives in Brief 03.
export const jobsRouter = Router();

jobsRouter.post('/generate-recurring', async (req, res) => {
  res.json(await generateRecurringInvoices(getPool(), requestToday(req)));
});
