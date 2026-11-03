import { createHash, timingSafeEqual } from 'node:crypto';
import { Request, Response, Router } from 'express';
import { getConfig } from '../config';
import { getPool } from '../db';
import { HttpError, requestToday } from '../http';
import { JobsBusyError, runJobs, startJobs } from '../jobs/runJobs';
import { latestJobRun } from '../repos/jobRuns';
import { generateRecurringInvoices } from '../services/recurringInvoices';

async function runAndRespond(req: Request, res: Response) {
  try {
    res.json(await runJobs(requestToday(req)));
  } catch (err) {
    if (err instanceof JobsBusyError) throw new HttpError(409, err.message);
    throw err;
  }
}

// Hash both sides so the compare is constant-time regardless of length.
const digest = (s: string) => createHash('sha256').update(s).digest();

/** `POST /jobs/run` for the external scheduler: header X-Job-Secret, no session. Mounted before requireAuth. */
export const publicJobsRouter = Router();

publicJobsRouter.post('/run', async (req, res) => {
  const secret = getConfig().JOB_SECRET;
  if (!secret) throw new HttpError(503, 'JOB_SECRET is not configured');
  const given = req.get('x-job-secret') ?? '';
  if (!timingSafeEqual(digest(given), digest(secret))) throw new HttpError(401, 'invalid job secret');
  // Answer right away (schedulers time out); the run continues in the background.
  try {
    const { runId, done } = await startJobs(requestToday(req));
    done.catch((err) => console.error('background job run failed:', err.message));
    res.status(202).json({ runId, status: 'started' });
  } catch (err) {
    if (err instanceof JobsBusyError) throw new HttpError(409, err.message);
    throw err;
  }
});

/** Session-protected triggers for the logged-in user. */
export const jobsRouter = Router();

jobsRouter.post('/generate-recurring', async (req, res) => {
  res.json(await generateRecurringInvoices(getPool(), requestToday(req)));
});

// Runs all four job steps and waits for the summary (the UI's "Run checks now"). Never sends email.
jobsRouter.post('/run-now', runAndRespond);

// The last run's summary, for the UI. `running` is true while it is still in progress.
jobsRouter.get('/runs/latest', async (_req, res) => {
  res.json({ run: await latestJobRun(getPool()) });
});
