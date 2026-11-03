import request from 'supertest';
import { beforeAll, beforeEach, afterAll } from 'vitest';
import { createApp } from '../src/app';
import { closePool, getPool } from '../src/db';
import { migrate } from '../src/migrate';

export const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
if (!hasTestDb) console.warn('TEST_DATABASE_URL is not set — skipping API tests');

/** Migrates once, truncates every table before each test, and closes the pool afterwards. */
export function useTestDb() {
  beforeAll(async () => {
    await migrate(() => {});
  });
  beforeEach(async () => {
    await getPool().query('truncate customers, invoices, reminders, replies, google_tokens, job_runs cascade');
  });
  afterAll(async () => {
    await closePool();
  });
}

export async function count(table: string, where = 'true'): Promise<number> {
  const { rows } = await getPool().query(`select count(*)::int as n from ${table} where ${where}`);
  return rows[0].n;
}

/** A supertest agent that is already logged in. */
export async function loggedInAgent() {
  const agent = request.agent(createApp());
  await agent.post('/auth/login').send({ password: process.env.APP_PASSWORD }).expect(200);
  return agent;
}
