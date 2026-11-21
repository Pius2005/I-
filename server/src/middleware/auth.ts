import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { verifyAccessToken } from '../lib/crypto.js';
import { ApiError } from '../lib/errors.js';
import { prisma } from '../db.js';

/** Bearer-token authentication. Sessions are also rejected after deactivation. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw ApiError.unauthorized();
    const payload = verifyAccessToken(header.slice(7));
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, organisationId: true, isActive: true, deletedAt: true },
    });
    if (!user || !user.isActive || user.deletedAt) throw ApiError.unauthorized('Session is no longer valid');
    req.user = { id: user.id, role: user.role, orgId: user.organisationId, email: user.email };
    next();
  } catch (error) {
    next(error instanceof ApiError ? error : ApiError.unauthorized('Session expired — sign in again'));
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) return next(ApiError.forbidden());
    next();
  };
}

export function isAdmin(req: Request) {
  return req.user?.role === 'ADMIN';
}

/** Recruiters may only touch their own organisation; admins may touch any. */
export function assertOrganisationAccess(req: Request, organisationId: string | null | undefined) {
  if (!req.user) throw ApiError.unauthorized();
  if (req.user.role === 'ADMIN') return;
  if (req.user.role !== 'RECRUITER' || !organisationId || req.user.orgId !== organisationId) {
    throw ApiError.forbidden();
  }
}

/** Auditor/admin view: admins see all, recruiters only their organisation. */
export function scopeOrganisation(req: Request, requested?: string | null): string | undefined {
  if (!req.user) throw ApiError.unauthorized();
  if (req.user.role === 'ADMIN') return requested ?? undefined;
  if (req.user.role === 'RECRUITER') return req.user.orgId ?? 'none';
  throw ApiError.forbidden();
}
