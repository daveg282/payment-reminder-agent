import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  APP_PASSWORD: z.string().min(1, 'APP_PASSWORD is required'),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 characters'),
  // The frontend's origin for CORS; a trailing slash would never match the browser's Origin header.
  CLIENT_ORIGIN: z.string().default('http://localhost:5173').transform((s) => s.replace(/\/+$/, '')),
  // Optional until the matching feature is used; services report a clear error when missing.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.url('GOOGLE_REDIRECT_URI must be a full URL like http://localhost:4000/auth/google/callback').optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),
  SENDER_NAME: z.string().default(''),
  JOB_SECRET: z.string().optional(),
  // Comma-separated addresses. When set, reminders can only be sent to these (a demo deployment that
  // other people can log into must never email a real customer address).
  SEND_ALLOWLIST: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean) : null)),
});

export type Config = z.infer<typeof envSchema>;

let cached: Config | undefined;

/** Forget the parsed env (tests change env vars between cases). */
export function resetConfig() {
  cached = undefined;
}

export function getConfig(): Config {
  if (!cached) {
    // `KEY=` in .env means "not set", so blank values fall back to the defaults.
    const env = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v.trim() !== ''));
    const parsed = envSchema.safeParse(env);
    if (!parsed.success) {
      const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
      throw new Error(`Invalid environment:\n${problems}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export const isProduction = () => process.env.NODE_ENV === 'production';
