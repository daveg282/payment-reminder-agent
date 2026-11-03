import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  APP_PASSWORD: z.string().min(1, 'APP_PASSWORD is required'),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 characters'),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
});

export type Config = z.infer<typeof envSchema>;

let cached: Config | undefined;

export function getConfig(): Config {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
      throw new Error(`Invalid environment:\n${problems}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export const isProduction = () => process.env.NODE_ENV === 'production';
