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
process.env.SESSION_SECRET = 'test-session-secret-1234567890';
