import { Router } from 'express';
import { z } from 'zod';
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '../db.js';
import { asyncHandler } from '../lib/async.js';
import { ApiError } from '../lib/errors.js';
import { paginated, paginationSchema, validate } from '../lib/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../middleware/audit.js';
import { hashPassword, randomToken } from '../lib/crypto.js';
import { getAuditSettings, updateAuditSettings } from '../services/settings.js';
import { issueEmailToken, revokeAllSessions } from '../services/auth-tokens.js';
import { storage } from '../services/storage.js';
import { notify } from '../services/notifications.js';

const router = Router();
router.use(requireAuth, requireRole('ADMIN'));

router.get(
  '/dashboard',
  asyncHandler(async (_req, res) => {
    const [organisations, users, jobs, applications, interviews, reports, flags, recentLogs] = await Promise.all([
      prisma.organisation.count(),
      prisma.user.count({ where: { isActive: true, deletedAt: null } }),
      prisma.job.count(),
      prisma.application.count(),
      prisma.interview.count({ where: { status: 'SCHEDULED' } }),
      prisma.biasReport.count(),
      prisma.biasReport.count({ where: { flagCount: { gt: 0 } } }),
      prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 12,
        select: { id: true, action: true, entityType: true, actorRole: true, createdAt: true, actor: { select: { fullName: true } } },
      }),
    ]);
    const pendingRequests = await prisma.dataRequest.count({ where: { status: 'PENDING' } });
    const byRole = await prisma.user.groupBy({ by: ['role'], where: { deletedAt: null }, _count: true });
    res.json({
      data: {
        organisations,
        users,
        jobs,
        applications,
        interviews,
        reports,
        flaggedReports: flags,
        pendingDataRequests: pendingRequests,
        byRole: Object.fromEntries(byRole.map((r) => [r.role, r._count])),
        recentLogs,
      },
    });
  }),
);

// --- Organisations ---------------------------------------------------------
router.get(
  '/organisations',
  asyncHandler(async (req, res) => {
    const query = validate(paginationSchema.extend({ search: z.string().optional() }), req.query);
    const where: Prisma.OrganisationWhereInput = query.search
      ? { name: { contains: query.search, mode: 'insensitive' } }
      : {};
    const [items, total] = await Promise.all([
      prisma.organisation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { _count: { select: { users: true, jobs: true } } },
      }),
      prisma.organisation.count({ where }),
    ]);
    res.json(paginated(items, total, query.page, query.pageSize));
  }),
);

router.post(
  '/organisations',
  asyncHandler(async (req, res) => {
    const input = validate(
      z.object({ name: z.string().min(2).max(160), sector: z.string().max(80).optional(), website: z.string().url().max(300).optional() }),
      req.body,
    );
    const slug = `${input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${randomToken(3)}`;
    const org = await prisma.organisation.create({ data: { ...input, slug: slug.slice(0, 80) } });
    await writeAudit(req, 'ORGANISATION_CREATED', 'Organisation', org.id);
    res.status(201).json({ data: org });
  }),
);

router.patch(
  '/organisations/:id',
  asyncHandler(async (req, res) => {
    const input = validate(
      z.object({ name: z.string().min(2).max(160).optional(), sector: z.string().max(80).nullable().optional(), website: z.string().max(300).nullable().optional() }),
      req.body,
    );
    const org = await prisma.organisation.update({ where: { id: req.params.id }, data: input });
    await writeAudit(req, 'ORGANISATION_UPDATED', 'Organisation', org.id, { fields: Object.keys(input) });
    res.json({ data: org });
  }),
);

// --- Users -----------------------------------------------------------------
router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const query = validate(
      paginationSchema.extend({ role: z.string().optional(), search: z.string().optional(), organisationId: z.string().optional() }),
      req.query,
    );
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(query.role ? { role: query.role as Role } : {}),
      ...(query.organisationId ? { organisationId: query.organisationId } : {}),
      ...(query.search
        ? {
            OR: [
              { fullName: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          isActive: true,
          emailVerifiedAt: true,
          lastLoginAt: true,
          createdAt: true,
          organisation: { select: { id: true, name: true } },
          _count: { select: { applications: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);
    res.json(paginated(items, total, query.page, query.pageSize));
  }),
);

router.post(
  '/users',
  asyncHandler(async (req, res) => {
    const input = validate(
      z.object({
        email: z.string().email().toLowerCase(),
        fullName: z.string().min(2).max(120),
        role: z.enum(['CANDIDATE', 'RECRUITER', 'ADMIN']),
        organisationId: z.string().nullable().optional(),
      }),
      req.body,
    );
    if (input.role === 'RECRUITER' && !input.organisationId) {
      throw ApiError.badRequest('A recruiter must belong to an organisation.');
    }
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw ApiError.conflict('That email is already registered.');
    // A random unusable password is set; the user receives a reset link.
    const user = await prisma.user.create({
      data: {
        email: input.email,
        fullName: input.fullName,
        role: input.role,
        organisationId: input.organisationId ?? null,
        passwordHash: await hashPassword(randomToken(24)),
        ...(input.role === 'CANDIDATE' ? { candidateProfile: { create: {} } } : {}),
      },
    });
    await prisma.notificationPreference.create({ data: { userId: user.id } }).catch(() => undefined);
    await issueEmailToken(user, 'RESET_PASSWORD');
    await writeAudit(req, 'USER_CREATED_BY_ADMIN', 'User', user.id, { role: input.role });
    res.status(201).json({
      data: { id: user.id, email: user.email, role: user.role },
      message: 'Account created. The user has been emailed a link to set a password.',
    });
  }),
);

router.patch(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const input = validate(
      z.object({
        role: z.enum(['CANDIDATE', 'RECRUITER', 'ADMIN']).optional(),
        isActive: z.boolean().optional(),
        organisationId: z.string().nullable().optional(),
      }),
      req.body,
    );
    if (req.params.id === req.user!.id && input.isActive === false) {
      throw ApiError.badRequest('You cannot deactivate your own account.');
    }
    const user = await prisma.user.update({ where: { id: req.params.id }, data: input });
    if (input.isActive === false) await revokeAllSessions(user.id);
    await writeAudit(req, 'USER_UPDATED', 'User', user.id, { fields: Object.keys(input), isActive: input.isActive });
    res.json({ data: { id: user.id, role: user.role, isActive: user.isActive } });
  }),
);

// --- Settings --------------------------------------------------------------
router.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    const settings = await getAuditSettings();
    res.json({ data: settings });
  }),
);

router.put(
  '/settings',
  asyncHandler(async (req, res) => {
    const input = validate(
      z.object({
        minGroupSize: z.number().int().min(2).max(100).optional(),
        threshold: z.number().min(0.1).max(1).optional(),
        counterfactualThreshold: z.number().min(0).max(50).optional(),
        retentionDays: z.number().int().min(30).max(3650).optional(),
        blindScreeningDefault: z.boolean().optional(),
      }),
      req.body,
    );
    const settings = await updateAuditSettings(input, req.user!.id);
    res.json({ data: settings });
  }),
);

// --- Audit logs & CSV export ----------------------------------------------
router.get(
  '/audit-logs',
  asyncHandler(async (req, res) => {
    const query = validate(
      paginationSchema.extend({
        action: z.string().optional(),
        entityType: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        format: z.enum(['json', 'csv']).default('json'),
      }),
      req.query,
    );
    const where: Prisma.AuditLogWhereInput = {
      ...(query.action ? { action: { contains: query.action, mode: 'insensitive' } } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    if (query.format === 'csv') {
      const logs = await prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 10_000,
        include: { actor: { select: { email: true } } },
      });
      const header = ['id', 'createdAt', 'actorRole', 'actorEmail', 'action', 'entityType', 'entityId', 'ip', 'metadata'];
      const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
      const rows = logs.map((log) =>
        [
          log.id,
          log.createdAt.toISOString(),
          log.actorRole,
          log.actor?.email ?? '',
          log.action,
          log.entityType,
          log.entityId,
          log.ip ?? '',
          JSON.stringify(log.metadata),
        ]
          .map((v) => escape(String(v)))
          .join(','),
      );
      await writeAudit(req, 'AUDIT_LOG_EXPORTED', 'AuditLog', 'all', { rows: logs.length });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="ise-audit-log.csv"');
      return res.send([header.join(','), ...rows].join('\n'));
    }

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { actor: { select: { fullName: true, email: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);
    res.json(paginated(items, total, query.page, query.pageSize));
  }),
);

// --- Data subject requests -------------------------------------------------
router.get(
  '/data-requests',
  asyncHandler(async (req, res) => {
    const query = validate(paginationSchema.extend({ status: z.string().optional() }), req.query);
    const where = query.status ? { status: query.status as never } : {};
    const [items, total] = await Promise.all([
      prisma.dataRequest.findMany({
        where,
        orderBy: { requestedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { user: { select: { id: true, email: true, fullName: true, role: true } } },
      }),
      prisma.dataRequest.count({ where }),
    ]);
    res.json(paginated(items, total, query.page, query.pageSize));
  }),
);

router.post(
  '/data-requests/:id/complete',
  asyncHandler(async (req, res) => {
    const { action } = validate(z.object({ action: z.enum(['COMPLETE', 'REJECT']) }), req.body);
    const request = await prisma.dataRequest.findUnique({ where: { id: req.params.id }, include: { user: true } });
    if (!request) throw ApiError.notFound('Request not found');
    if (request.status !== 'PENDING') throw ApiError.badRequest('This request has already been handled.');

    if (action === 'REJECT') {
      await prisma.dataRequest.update({
        where: { id: request.id },
        data: { status: 'REJECTED', completedAt: new Date(), note: 'Rejected by administrator' },
      });
      await writeAudit(req, 'DATA_REQUEST_REJECTED', 'DataRequest', request.id);
      return res.json({ data: { ok: true } });
    }

    if (request.type === 'DELETE') {
      // Anonymise: remove personal data, keep auditable decision records.
      const cvFiles = await prisma.cVFile.findMany({ where: { candidateId: request.userId } });
      for (const file of cvFiles) await storage.delete(file.storageKey).catch(() => undefined);
      await prisma.$transaction([
        prisma.parsedCV.deleteMany({ where: { application: { candidateId: request.userId } } }),
        prisma.cVFile.deleteMany({ where: { candidateId: request.userId } }),
        prisma.demographicDeclaration.deleteMany({ where: { userId: request.userId } }),
        prisma.candidateProfile.deleteMany({ where: { userId: request.userId } }),
        prisma.notification.deleteMany({ where: { userId: request.userId } }),
        prisma.refreshToken.updateMany({ where: { userId: request.userId }, data: { revokedAt: new Date() } }),
        prisma.user.update({
          where: { id: request.userId },
          data: {
            email: `deleted-${request.userId}@ise.invalid`,
            fullName: 'Deleted account',
            phone: null,
            passwordHash: randomToken(32),
            isActive: false,
            deletedAt: new Date(),
          },
        }),
        prisma.dataRequest.update({
          where: { id: request.id },
          data: { status: 'COMPLETED', completedAt: new Date(), note: 'Personal data erased' },
        }),
        prisma.auditLog.create({
          data: {
            actorId: req.user!.id,
            actorRole: 'ADMIN',
            action: 'DATA_ERASED',
            entityType: 'DataRequest',
            entityId: request.id,
            metadata: { userId: request.userId, cvFiles: cvFiles.length },
          },
        }),
      ]);
      return res.json({ data: { ok: true, erased: true } });
    }

    await prisma.dataRequest.update({
      where: { id: request.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    await notify({
      userId: request.userId,
      type: 'SYSTEM',
      title: 'Your data request is complete',
      body: 'Your data export is ready from your privacy page.',
    });
    await writeAudit(req, 'DATA_REQUEST_COMPLETED', 'DataRequest', request.id);
    res.json({ data: { ok: true } });
  }),
);

export default router;
