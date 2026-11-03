import 'dotenv/config';
import { createApp } from './app';
import { getConfig, isProduction } from './config';
import { startDevScheduler } from './scheduler';

const config = getConfig();
if (isProduction()) {
  const missing = (['JOB_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'GEMINI_API_KEY', 'GEMINI_MODEL'] as const).filter((k) => !config[k]);
  if (missing.length) console.warn(`warning: not set in production: ${missing.join(', ')}`);
}

createApp().listen(config.PORT, () => {
  console.log(`server listening on port ${config.PORT} (${config.NODE_ENV})`);
});
startDevScheduler();
