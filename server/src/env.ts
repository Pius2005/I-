import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

// Load `.env` from the repo root, then any server-local override.
const here = path.dirname(fileURLToPath(import.meta.url));
const candidates = [
  path.resolve(here, '../../.env'),
  path.resolve(here, '../.env'),
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../.env'),
];
for (const candidate of candidates) {
  if (existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === 'true' || v === '1'));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // A blank or zero PORT coerces to 0, so treat those as unset and use 4000.
  PORT: z.preprocess(
    (value) => (value === '' || value === undefined || value === null || Number(value) === 0 ? undefined : value),
    z.coerce.number().int().min(1).max(65535).default(4000),
  ),
  APP_URL: z.string().default('http://localhost:5173'),
  API_URL: z.string().default('http://localhost:4000'),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:4000'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(16).default('dev-access-secret-change-me-please'),
  JWT_REFRESH_SECRET: z.string().min(16).default('dev-refresh-secret-change-me-please'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(7),
  BCRYPT_ROUNDS: z.coerce.number().min(4).max(15).default(12),
  FIELD_ENCRYPTION_KEY: z.string().optional().default(''),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('./uploads'),
  S3_BUCKET: z.string().optional().default(''),
  S3_REGION: z.string().optional().default(''),
  S3_ENDPOINT: z.string().optional().default(''),
  S3_ACCESS_KEY_ID: z.string().optional().default(''),
  S3_SECRET_ACCESS_KEY: z.string().optional().default(''),
  S3_FORCE_PATH_STYLE: bool(false),

  LLM_BASE_URL: z.string().default('https://api.openai.com/v1'),
  LLM_API_KEY: z.string().optional().default(''),
  LLM_MODEL: z.string().default('gpt-4o-mini'),
  LLM_TIMEOUT_MS: z.coerce.number().default(30000),
  PROMPT_VERSION: z.string().default('2026-02-v1'),

  EMAIL_PROVIDER: z.enum(['console', 'smtp', 'resend']).default('console'),
  EMAIL_FROM: z.string().default('Iṣẹ́ <no-reply@ise.example>'),
  RESEND_API_KEY: z.string().optional().default(''),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),

  SMS_PROVIDER: z.enum(['console', 'termii']).default('console'),
  TERMII_API_KEY: z.string().optional().default(''),
  TERMII_SENDER_ID: z.string().default('Ise'),
  TERMII_BASE_URL: z.string().default('https://api.ng.termii.com'),

  REDIS_URL: z.string().optional().default(''),

  GOOGLE_CALENDAR_ENABLED: bool(false),
  GOOGLE_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
  GOOGLE_REFRESH_TOKEN: z.string().optional().default(''),
  GOOGLE_CALENDAR_ID: z.string().default('primary'),

  AUDIT_MIN_GROUP_SIZE: z.coerce.number().min(2).default(5),
  AUDIT_ADVERSE_IMPACT_THRESHOLD: z.coerce.number().default(0.8),
  AUDIT_COUNTERFACTUAL_THRESHOLD: z.coerce.number().default(5),
  DATA_RETENTION_DAYS: z.coerce.number().default(365),
  ALLOW_BIAS_DEMO: bool(true),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  throw new Error('Environment validation failed');
}

export const env = parsed.data;

export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
export const corsOrigins = env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
