import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { resetConfig } from '../src/config';

const cron = vi.hoisted(() => ({ schedule: vi.fn() }));
vi.mock('node-cron', () => ({ default: cron }));
import { startDevScheduler } from '../src/scheduler';

describe('production settings', () => {
  const original = { NODE_ENV: process.env.NODE_ENV, CLIENT_ORIGIN: process.env.CLIENT_ORIGIN };
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    process.env.CLIENT_ORIGIN = 'https://payment-reminder.onrender.com/';
    resetConfig();
    cron.schedule.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    Object.assign(process.env, original);
    resetConfig();
    vi.restoreAllMocks();
  });

  it('trusts the proxy and sets a SameSite=None; Secure session cookie behind HTTPS', async () => {
    const res = await request(createApp())
      .post('/auth/login')
      .set('X-Forwarded-Proto', 'https')
      .send({ password: process.env.APP_PASSWORD })
      .expect(200);
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    expect(cookies.length).toBeGreaterThan(0);
    for (const c of cookies) {
      expect(c).toMatch(/;\s*secure/i);
      expect(c).toMatch(/;\s*samesite=none/i);
      expect(c).toMatch(/;\s*httponly/i);
    }
  });

  it('allows credentialed CORS only from CLIENT_ORIGIN (trailing slash ignored)', async () => {
    const app = createApp();
    const ok = await request(app).get('/health').set('Origin', 'https://payment-reminder.onrender.com');
    expect(ok.headers['access-control-allow-origin']).toBe('https://payment-reminder.onrender.com');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const other = await request(app).get('/health').set('Origin', 'https://evil.example');
    expect(other.headers['access-control-allow-origin']).not.toBe('https://evil.example');
  });

  it('never starts the dev cron in production', () => {
    expect(startDevScheduler()).toBe(false);
    expect(cron.schedule).not.toHaveBeenCalled();
  });

  it('starts the dev cron outside production', () => {
    process.env.NODE_ENV = 'development';
    expect(startDevScheduler()).toBe(true);
    expect(cron.schedule).toHaveBeenCalledWith('*/10 * * * *', expect.any(Function));
  });
});
