import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { isProduction } from './config';
import { isValidIsoDate, todayIso } from './domain/dates';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const uuidParam = z.uuid({ error: 'not found' });
export const isoDateString = z.string().refine(isValidIsoDate, 'must be a valid date (YYYY-MM-DD)');

/** Parses `schema` or throws a 400 with the zod issues. */
export function parseOr400<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(400, 'invalid request', result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
  }
  return result.data;
}

/** Server date, with a `?today=YYYY-MM-DD` override outside production (tests and the demo). */
export function requestToday(req: Request): string {
  const override = req.query.today;
  if (!isProduction() && typeof override === 'string') {
    if (!isValidIsoDate(override)) throw new HttpError(400, 'today must be a valid date (YYYY-MM-DD)');
    return override;
  }
  return todayIso();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.session?.authed) return next();
  res.status(401).json({ error: 'not logged in' });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, ...(err.details !== undefined && { details: err.details }) });
    return;
  }
  const status = (err as { status?: number }).status;
  if (status && status >= 400 && status < 500) {
    // e.g. malformed JSON from express.json()
    res.status(status).json({ error: (err as Error).message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'something went wrong on the server' });
}
