import { ConvexError } from 'convex/values';
import type { MutationCtx, QueryCtx } from '../convex/_generated/server';
import type { Doc, Id } from '../convex/_generated/dataModel';
import { sha256Hex } from './crypto';

export type Role = 'CANDIDATE' | 'RECRUITER' | 'ADMIN';

export const SESSION_DAYS = 30;

export interface AuthContext {
  user: Doc<'users'>;
  role: Role;
  orgId: Id<'organisations'> | null;
  sessionId: Id<'sessions'>;
}

export class AppError extends ConvexError<string> {
  constructor(code: string, message: string, details?: unknown) {
    super(JSON.stringify({ code, message, details }));
  }
}

export function fail(code: string, message: string, details?: unknown): never {
  throw new AppError(code, message, details);
}

/** Resolves the bearer token sent by the client to an active user. */
export async function requireUser(
  ctx: QueryCtx | MutationCtx,
  token: string | undefined | null,
): Promise<AuthContext> {
  if (!token) fail('UNAUTHORIZED', 'Sign in to continue.');
  const tokenHash = sha256Hex(token);
  const session = await ctx.db
    .query('sessions')
    .withIndex('by_token', (q) => q.eq('tokenHash', tokenHash))
    .unique();
  if (!session || session.revokedAt || session.expiresAt < Date.now()) {
    fail('UNAUTHORIZED', 'Your session has expired — sign in again.');
  }
  const user = await ctx.db.get(session.userId);
  if (!user || !user.isActive || user.deletedAt) {
    fail('UNAUTHORIZED', 'This account is not active.');
  }
  return {
    user,
    role: user.role as Role,
    orgId: user.organisationId ?? null,
    sessionId: session._id,
  };
}

export function requireRole(auth: AuthContext, ...roles: Role[]) {
  if (!roles.includes(auth.role)) fail('FORBIDDEN', 'You do not have access to that resource.');
}

/** Recruiter and admin views are scoped to one organisation. */
export function requireOrg(auth: AuthContext): Id<'organisations'> {
  if (!auth.orgId) fail('FORBIDDEN', 'Your account is not linked to an organisation.');
  return auth.orgId;
}

export async function assertJobAccess(
  ctx: QueryCtx | MutationCtx,
  auth: AuthContext,
  jobId: Id<'jobs'>,
) {
  const job = await ctx.db.get(jobId);
  if (!job) fail('NOT_FOUND', 'Job not found');
  if (auth.role !== 'ADMIN' && job.organisationId !== auth.orgId) fail('FORBIDDEN', 'You do not have access to that job.');
  return job;
}

export async function assertApplicationAccess(
  ctx: QueryCtx | MutationCtx,
  auth: AuthContext,
  applicationId: Id<'applications'>,
) {
  const application = await ctx.db.get(applicationId);
  if (!application) fail('NOT_FOUND', 'Application not found');
  const job = await ctx.db.get(application.jobId);
  if (!job) fail('NOT_FOUND', 'Job not found');
  if (auth.role !== 'ADMIN' && job.organisationId !== auth.orgId) fail('FORBIDDEN', 'You do not have access to that application.');
  return { application: application as Doc<'applications'>, job };
}

export function publicUser(user: Doc<'users'>) {
  return {
    id: user._id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    organisationId: user.organisationId ?? null,
    emailVerified: Boolean(user.emailVerifiedAt),
    phone: user.phone ?? null,
  };
}

export const APP_URL = () => (process.env.APP_URL ?? 'http://localhost:5174').replace(/\/$/, '');

/** Secret used for anonymous refs and the development encryption fallback. */
export const APP_SECRET = () => process.env.APP_SECRET ?? process.env.JWT_ACCESS_SECRET ?? 'ise-convex-development-secret';
