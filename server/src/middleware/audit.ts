import type { Request } from 'express';
import { prisma } from '../db.js';
import { requestContext } from '../lib/logger.js';

/**
 * Immutable decision log. There are deliberately no update/delete endpoints for
 * AuditLog anywhere in the API.
 */
export async function writeAudit(
  req: Request,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown> = {},
) {
  const context = requestContext(req);
  await prisma.auditLog.create({
    data: {
      actorId: req.user?.id ?? null,
      actorRole: req.user?.role ?? 'SYSTEM',
      action,
      entityType,
      entityId,
      metadata: metadata as object,
      ip: context.ip,
    },
  });
}
