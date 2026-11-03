import { Router } from 'express';
import { getPool } from '../db';
import { HttpError, requestToday } from '../http';
import { JobsBusyError, runJobs } from '../jobs/runJobs';
import { generateRecurringInvoices } from '../services/recurringInvoices';

// Session-protected job triggers. `POST /jobs/run` (secret header, no session) arrives in Brief 03 Part B.
export const jobsRouter = Router();

jobsRouter.post('/generate-recurring', async (req, res) => {
  res.json(await generateRecurringInvoices(getPool(), requestToday(req)));
});

// Temporary: runs recurring → broken promises → drafts. Never sends email.
jobsRouter.post('/run-now', async (req, res) => {
  try {
    res.json(await runJobs(requestToday(req)));
  } catch (err) {
    if (err instanceof JobsBusyError) throw new HttpError(409, err.message);
    throw err;
  }
});
