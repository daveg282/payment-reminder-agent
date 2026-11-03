import 'dotenv/config';
import cron from 'node-cron';
import { createApp } from './app';
import { getConfig, isProduction } from './config';
import { todayIso } from './domain/dates';
import { JobsBusyError, runJobs } from './jobs/runJobs';

const { PORT } = getConfig();
createApp().listen(PORT, () => {
  console.log(`server listening on http://localhost:${PORT}`);
});

// Dev only: run the jobs every 10 minutes. In production an external scheduler calls POST /jobs/run.
if (!isProduction()) {
  cron.schedule('*/10 * * * *', () => {
    runJobs(todayIso())
      .then((s) => console.log('scheduled jobs:', JSON.stringify(s)))
      .catch((err) => {
        if (!(err instanceof JobsBusyError)) console.error('scheduled jobs failed:', err.message);
      });
  });
  console.log('dev scheduler: jobs run every 10 minutes');
}
