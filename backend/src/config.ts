import 'dotenv/config';
import { z } from 'zod';

const bool = (def: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(def)
    .transform((v) => v === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  OTP_SECRET: z.string().min(32, 'OTP_SECRET must be at least 32 characters'),
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  // Returns the OTP in the API response. Only for local development; refused in production.
  OTP_DEV_ECHO: bool('false'),
  // Base URL of the customer-facing web pages (receipt / khata links sent on WhatsApp).
  PUBLIC_BASE_URL: z.url().default('http://localhost:3000'),
  CORS_ORIGIN: z.string().default('*'),
  // Runs the outbound message sender and daily-summary scheduler in this process.
  RUN_WORKERS: bool('true'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}
if (parsed.data.NODE_ENV === 'production' && parsed.data.OTP_DEV_ECHO) {
  console.error('OTP_DEV_ECHO must not be enabled in production');
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
