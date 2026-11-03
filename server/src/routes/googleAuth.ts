import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { getConfig } from '../config';
import { getPool } from '../db';
import { HttpError } from '../http';
import { getGoogleToken, saveGoogleToken } from '../repos/googleTokens';
import { consentUrl, exchangeCode } from '../services/google';

// Mounted at /auth/google behind requireAuth: only the logged-in user may connect a Google account.
export const googleAuthRouter = Router();

googleAuthRouter.get('/', (req, res) => {
  const state = randomBytes(24).toString('hex');
  const url = consentUrl(state);
  req.session!.googleState = state;
  res.redirect(url);
});

googleAuthRouter.get('/callback', async (req, res) => {
  const expected = req.session?.googleState;
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  req.session!.googleState = undefined;
  if (!expected || state.length !== expected.length || !timingSafeEqual(Buffer.from(state), Buffer.from(expected))) {
    throw new HttpError(400, 'the Google sign-in link expired or was tampered with; start again');
  }
  const back = new URL(getConfig().CLIENT_ORIGIN);
  if (typeof req.query.error === 'string') {
    back.searchParams.set('google', 'denied');
    return res.redirect(back.toString());
  }
  if (typeof req.query.code !== 'string') throw new HttpError(400, 'missing authorization code');

  const { refreshToken, email } = await exchangeCode(req.query.code);
  await saveGoogleToken(getPool(), { refresh_token: refreshToken, email });
  back.searchParams.set('google', 'connected');
  res.redirect(back.toString());
});

googleAuthRouter.get('/status', async (_req, res) => {
  const token = await getGoogleToken(getPool());
  res.json({ connected: Boolean(token), email: token?.email ?? null });
});
