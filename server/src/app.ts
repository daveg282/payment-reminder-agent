import cookieSession from 'cookie-session';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { getConfig, isProduction } from './config';
import { errorHandler, requireAuth } from './http';
import { authRouter } from './routes/auth';
import { customersRouter } from './routes/customers';
import { dashboardRouter } from './routes/dashboard';
import { importRouter } from './routes/import';
import { invoicesRouter } from './routes/invoices';
import { jobsRouter } from './routes/jobs';

export function createApp() {
  const config = getConfig();
  const app = express();

  if (isProduction()) app.set('trust proxy', 1); // Render terminates TLS in front of us
  app.use(helmet());
  app.use(cors({ origin: config.CLIENT_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(
    cookieSession({
      name: 'pr_session',
      secret: config.SESSION_SECRET,
      httpOnly: true,
      // Frontend and API live on different domains in production.
      sameSite: isProduction() ? 'none' : 'lax',
      secure: isProduction(),
      maxAge: 7 * 24 * 60 * 60 * 1000,
    }),
  );

  // Public routes. (`POST /jobs/run`, guarded by X-Job-Secret, is added here in Brief 03.)
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/auth', authRouter);

  // Everything below needs a logged-in session.
  app.use(requireAuth);
  app.use('/import', importRouter);
  app.use('/dashboard', dashboardRouter);
  app.use('/customers', customersRouter);
  app.use('/invoices', invoicesRouter);
  app.use('/jobs', jobsRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'not found' });
  });
  app.use(errorHandler);
  return app;
}
