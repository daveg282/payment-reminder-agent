import { config as loadEnv } from 'dotenv';

loadEnv({ quiet: true });
process.env.NODE_ENV = 'test';

const testUrl = process.env.TEST_DATABASE_URL;
if (testUrl) {
  // Tests truncate tables, so never let them touch the real database.
  if (testUrl === process.env.DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL must point at a different database than DATABASE_URL');
  }
  process.env.DATABASE_URL = testUrl;
} else {
  // DB-backed tests are skipped; this placeholder just keeps the real database out of reach.
  process.env.DATABASE_URL = 'postgres://no-test-db@127.0.0.1:1/none';
}
process.env.APP_PASSWORD = 'test-password';
// Tests never call the real Gemini or Google APIs (live AI tests opt in with RUN_LIVE_AI=1).
if (process.env.RUN_LIVE_AI !== '1') process.env.GEMINI_API_KEY = '';
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.GOOGLE_REDIRECT_URI = 'http://localhost:4000/auth/google/callback';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';
process.env.SENDER_NAME = 'Sam Sender';
process.env.SESSION_SECRET = 'test-session-secret-1234567890';
