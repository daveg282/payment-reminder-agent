import { getPool } from '../db';
import { clearBrokenPromises } from '../repos/invoices';
import { finishJobRun, startJobRun } from '../repos/jobRuns';
import { generateRecurringInvoices } from '../services/recurringInvoices';
import { createDueDrafts } from '../services/reminders';

export interface JobSummary {
  recurringCreated: number;
  promisesCleared: number;
  draftsCreated: number;
  draftsByAi: number;
  draftsByTemplate: number;
  repliesProcessed: number;
  errors: string[];
}

export class JobsBusyError extends Error {
  constructor() {
    super('jobs are already running');
  }
}

let running = false;

/**
 * The scheduled work, in order; each step has its own try/catch so one failure doesn't stop the rest.
 * Steps 1–3 for now (recurring invoices, broken promises, drafts); reply checking is added in Part B.
 * Never sends email — drafts wait for the user's approval.
 */
export async function runJobs(today: string): Promise<JobSummary> {
  if (running) throw new JobsBusyError();
  running = true;
  const db = getPool();
  const summary: JobSummary = { recurringCreated: 0, promisesCleared: 0, draftsCreated: 0, draftsByAi: 0, draftsByTemplate: 0, repliesProcessed: 0, errors: [] };
  const fail = (step: string, err: unknown) => {
    console.error(`job step "${step}" failed:`, err);
    summary.errors.push(`${step}: ${(err as Error).message}`);
  };

  try {
    const runId = await startJobRun(db);

    try {
      summary.recurringCreated = (await generateRecurringInvoices(db, today)).invoicesCreated;
    } catch (err) {
      fail('recurring', err);
    }

    const broken = new Map<string, string>();
    try {
      for (const b of await clearBrokenPromises(db, today)) broken.set(b.id, b.promise_date);
      summary.promisesCleared = broken.size;
    } catch (err) {
      fail('broken promises', err);
    }

    try {
      Object.assign(summary, await createDueDrafts(db, today, broken));
    } catch (err) {
      fail('drafts', err);
    }

    await finishJobRun(db, runId, summary, summary.errors.length ? summary.errors.join('; ') : null);
    return summary;
  } finally {
    running = false;
  }
}
