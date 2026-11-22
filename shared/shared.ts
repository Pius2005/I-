import type { MutationCtx, QueryCtx } from '../convex/_generated/server';
import type { Doc, Id } from '../convex/_generated/dataModel';
import { fail, type AuthContext } from './authz';

type Ctx = MutationCtx | QueryCtx;

export async function writeAudit(
  ctx: MutationCtx,
  actor: { id?: Id<'users'>; role: string } | null,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown> = {},
) {
  await ctx.db.insert('auditLogs', {
    actorId: actor?.id,
    actorRole: actor?.role ?? 'SYSTEM',
    action,
    entityType,
    entityId,
    metadata,
    createdAt: Date.now(),
  });
}

export async function notify(
  ctx: MutationCtx,
  input: {
    userId: Id<'users'>;
    type:
      | 'APPLICATION_RECEIVED'
      | 'SCORED'
      | 'SHORTLISTED'
      | 'INTERVIEW_SCHEDULED'
      | 'INTERVIEW_CHANGED'
      | 'INTERVIEW_CANCELLED'
      | 'REMINDER_24H'
      | 'REMINDER_1H'
      | 'OUTCOME'
      | 'BIAS_ALERT'
      | 'SYSTEM';
    title: string;
    body: string;
    data?: Record<string, unknown>;
  },
) {
  const user = await ctx.db.get(input.userId);
  if (!user || !user.isActive || user.deletedAt) return;
  const prefs = await ctx.db
    .query('notificationPreferences')
    .withIndex('by_user', (q) => q.eq('userId', input.userId))
    .unique();
  if (prefs && prefs.inApp === false) return;
  await ctx.db.insert('notifications', {
    userId: input.userId,
    type: input.type,
    title: input.title,
    body: input.body,
    data: input.data ?? {},
    createdAt: Date.now(),
  });
}

export interface AuditSettings {
  minGroupSize: number;
  threshold: number;
  counterfactualThreshold: number;
  retentionDays: number;
  blindScreeningDefault: boolean;
}

export const DEFAULT_SETTINGS: AuditSettings = {
  minGroupSize: 5,
  threshold: 0.8,
  counterfactualThreshold: 5,
  retentionDays: 365,
  blindScreeningDefault: true,
};

export async function getAuditSettings(ctx: Ctx): Promise<AuditSettings> {
  const rows = await ctx.db
    .query('settings')
    .withIndex('by_key')
    .collect();
  const map = new Map(rows.filter((r) => r.key.startsWith('audit.')).map((r) => [r.key, r.value]));
  const num = (key: string, fallback: number) => {
    const value = map.get(`audit.${key}`);
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  };
  return {
    minGroupSize: num('minGroupSize', DEFAULT_SETTINGS.minGroupSize),
    threshold: num('threshold', DEFAULT_SETTINGS.threshold),
    counterfactualThreshold: num('counterfactualThreshold', DEFAULT_SETTINGS.counterfactualThreshold),
    retentionDays: num('retentionDays', DEFAULT_SETTINGS.retentionDays),
    blindScreeningDefault: (map.get('audit.blindScreeningDefault') as boolean | undefined) ?? DEFAULT_SETTINGS.blindScreeningDefault,
  };
}

export async function setSetting(ctx: MutationCtx, key: string, value: unknown) {
  const existing = await ctx.db
    .query('settings')
    .withIndex('by_key', (q) => q.eq('key', key))
    .unique();
  if (existing) await ctx.db.patch(existing._id, { value, updatedAt: Date.now() });
  else await ctx.db.insert('settings', { key, value, updatedAt: Date.now() });
}

// --- Validation helpers -----------------------------------------------------

export function text(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== 'string') fail('BAD_REQUEST', `${field} is required.`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    fail('BAD_REQUEST', `${field} must be between ${min} and ${max} characters.`);
  }
  return trimmed;
}

export function optionalText(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') fail('BAD_REQUEST', `${field} must be text.`);
  if (value.trim().length > max) fail('BAD_REQUEST', `${field} must be ${max} characters or fewer.`);
  return value.trim();
}

export function email(value: unknown): string {
  if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    fail('BAD_REQUEST', 'Enter a valid email address.');
  }
  return value.trim().toLowerCase();
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    fail('BAD_REQUEST', `${field} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

export function int(value: unknown, field: string, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    fail('BAD_REQUEST', `${field} must be a whole number between ${min} and ${max}.`);
  }
  return n;
}

export function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function paginate<T>(items: T[], total: number, page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    data: items,
    meta: {
      total,
      page,
      pageSize,
      totalPages,
      hasMore: page < totalPages,
    },
  };
}

export function pagination(args: { page?: number; pageSize?: number }) {
  const page = Math.max(1, Math.floor(args.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(args.pageSize ?? 20)));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export function scoreWithJob(application: Doc<'applications'>, auth: AuthContext) {
  return {
    ...application,
    id: application._id,
  };
}
