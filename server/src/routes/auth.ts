import { createHash, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { getConfig } from '../config';
import { HttpError, parseOr400 } from '../http';

// Hash both sides so the compare is constant-time regardless of length.
const digest = (s: string) => createHash('sha256').update(s).digest();
const passwordMatches = (given: string) => timingSafeEqual(digest(given), digest(getConfig().APP_PASSWORD));

export const authRouter = Router();

authRouter.post('/login', (req, res) => {
  const { password } = parseOr400(z.object({ password: z.string() }), req.body);
  if (!passwordMatches(password)) throw new HttpError(401, 'wrong password');
  req.session = { authed: true };
  res.json({ ok: true });
});

authRouter.post('/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

authRouter.get('/me', (req, res) => {
  res.json({ authed: Boolean(req.session?.authed) });
});
