import cron from 'node-cron';
import { isProduction } from './config';
import { todayIso } from './domain/dates';
import { JobsBusyError, runJobs } from './jobs/runJobs';

/**
 * Dev only: run the jobs every 10 minutes. In production the free Render service sleeps, so an
 * external scheduler (cron-job.org) calls POST /jobs/run instead. Returns whether a schedule was started.
 */
export function startDevScheduler(): boolean {
  if (isProduction()) return false;
  cron.schedule('*/10 * * * *', () => {
    runJobs(todayIso())
      .then((s) => console.log('scheduled jobs:', JSON.stringify(s)))
      .catch((err) => {
        if (!(err instanceof JobsBusyError)) console.error('scheduled jobs failed:', err.message);
      });
  });
  console.log('dev scheduler: jobs run every 10 minutes');
  return true;
}
