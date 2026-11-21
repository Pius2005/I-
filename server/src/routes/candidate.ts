import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncHandler } from '../lib/async.js';
import { ApiError } from '../lib/errors.js';
import { validate } from '../lib/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../middleware/audit.js';
import { openJson, sealJson } from '../lib/crypto.js';
import { regionFor, type DemographicPayload } from '../services/audit-service.js';
import { notify } from '../services/notifications.js';

const router = Router();
router.use(requireAuth, requireRole('CANDIDATE'));

const profileSchema = z.object({
  headline: z.string().max(160).nullable().optional(),
  summary: z.string().max(2000).nullable().optional(),
  location: z.string().max(120).nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  linkedinUrl: z.string().url().max(300).nullable().optional().or(z.literal('')),
  portfolioUrl: z.string().url().max(300).nullable().optional().or(z.literal('')),
});

router.get(
  '/profile',
  asyncHandler(async (req, res) => {
    const profile = await prisma.candidateProfile.upsert({
      where: { userId: req.user!.id },
      create: { userId: req.user!.id },
      update: {},
    });
    const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { fullName: true, email: true, phone: true } });
    res.json({ data: { ...profile, fullName: user?.fullName, email: user?.email } });
  }),
);

router.put(
  '/profile',
  asyncHandler(async (req, res) => {
    const input = validate(profileSchema, req.body);
    const profile = await prisma.candidateProfile.upsert({
      where: { userId: req.user!.id },
      create: { userId: req.user!.id, ...input },
      update: input,
    });
    if (input.phone !== undefined) {
      await prisma.user.update({ where: { id: req.user!.id }, data: { phone: input.phone || null } });
    }
    res.json({ data: profile });
  }),
);

// --- Voluntary demographic self-declaration ---------------------------------
const demographicSchema = z.object({
  gender: z.enum(['FEMALE', 'MALE', 'NON_BINARY', 'PREFER_NOT_TO_SAY']).optional(),
  ageBand: z.enum(['18-24', '25-29', '30-34', '35-39', '40+', 'PREFER_NOT_TO_SAY']).optional(),
  stateOfOrigin: z.string().max(60).nullable().optional(),
  universityType: z.enum(['FEDERAL', 'STATE', 'PRIVATE', 'POLYTECHNIC', 'UNKNOWN', 'PREFER_NOT_TO_SAY']).optional(),
  disabilityStatus: z.enum(['NONE', 'DECLARED', 'PREFER_NOT_TO_SAY']).optional(),
  consentVersion: z.string().max(30).default('2026-02-v1'),
});

router.get(
  '/demographics',
  asyncHandler(async (req, res) => {
    const record = await prisma.demographicDeclaration.findUnique({ where: { userId: req.user!.id } });
    if (!record) return res.json({ data: null });
    const payload = openJson<DemographicPayload>(record.payload);
    res.json({ data: { ...payload, declaredAt: record.declaredAt, region: regionFor(payload.stateOfOrigin) } });
  }),
);

router.put(
  '/demographics',
  asyncHandler(async (req, res) => {
    const input = validate(demographicSchema, req.body);
    const sealed = sealJson(input);
    await prisma.demographicDeclaration.upsert({
      where: { userId: req.user!.id },
      create: { userId: req.user!.id, payload: sealed, consentVersion: input.consentVersion },
      update: { payload: sealed, consentVersion: input.consentVersion },
    });
    await writeAudit(req, 'DEMOGRAPHICS_DECLARED', 'User', req.user!.id);
    res.json({ data: { ok: true, declared: true } });
  }),
);

router.delete(
  '/demographics',
  asyncHandler(async (req, res) => {
    await prisma.demographicDeclaration.deleteMany({ where: { userId: req.user!.id } });
    await writeAudit(req, 'DEMOGRAPHICS_WITHDRAWN', 'User', req.user!.id);
    res.json({ data: { ok: true } });
  }),
);

// --- Consent ---------------------------------------------------------------
router.get(
  '/consent',
  asyncHandler(async (req, res) => {
    const records = await prisma.consentRecord.findMany({
      where: { userId: req.user!.id },
      orderBy: { grantedAt: 'desc' },
    });
    res.json({ data: records });
  }),
);

router.post(
  '/consent',
  asyncHandler(async (req, res) => {
    const { purpose } = validate(
      z.object({ purpose: z.enum(['ai_screening', 'demographic_analysis', 'marketing']) }),
      req.body,
    );
    const record = await prisma.consentRecord.create({
      data: { userId: req.user!.id, purpose, version: '2026-02-v1', ip: req.ip },
    });
    res.status(201).json({ data: record });
  }),
);

router.delete(
  '/consent/:id',
  asyncHandler(async (req, res) => {
    await prisma.consentRecord.updateMany({
      where: { id: req.params.id, userId: req.user!.id },
      data: { withdrawnAt: new Date() },
    });
    res.json({ data: { ok: true } });
  }),
);

// --- NDPA data rights ------------------------------------------------------
router.get(
  '/data-requests',
  asyncHandler(async (req, res) => {
    const items = await prisma.dataRequest.findMany({
      where: { userId: req.user!.id },
      orderBy: { requestedAt: 'desc' },
    });
    res.json({ data: items });
  }),
);

router.post(
  '/data-requests',
  asyncHandler(async (req, res) => {
    const { type } = validate(z.object({ type: z.enum(['EXPORT', 'DELETE']) }), req.body);

    if (type === 'EXPORT') {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        include: {
          candidateProfile: true,
          applications: {
            include: {
              job: { select: { title: true, organisation: { select: { name: true } } } },
              parsedCV: true,
              scores: { orderBy: { createdAt: 'desc' }, take: 1 },
              interviews: { include: { slot: true } },
              statusHistory: true,
            },
          },
          consentRecords: true,
          notifications: { take: 100, orderBy: { createdAt: 'desc' } },
        },
      });
      const declaration = await prisma.demographicDeclaration.findUnique({ where: { userId: req.user!.id } });
      const pack = {
        exportedAt: new Date().toISOString(),
        noticeVersion: '2026-02-v1',
        account: user ? { ...user, passwordHash: undefined } : null,
        demographicDeclaration: declaration ? openJson(declaration.payload) : null,
        cvTexts: user?.applications.map((a) => ({ job: a.job.title, parsed: a.parsedCV?.data ?? null })) ?? [],
      };
      await prisma.dataRequest.create({
        data: { userId: req.user!.id, type, status: 'COMPLETED', completedAt: new Date() },
      });
      await writeAudit(req, 'DATA_EXPORT', 'User', req.user!.id);
      res.setHeader('Content-Disposition', 'attachment; filename="ise-data-export.json"');
      res.setHeader('Content-Type', 'application/json');
      return res.send(JSON.stringify(pack, null, 2));
    }

    // Deletion is human-reviewed so the audit trail and legal obligations survive.
    const request = await prisma.dataRequest.create({ data: { userId: req.user!.id, type } });
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true } });
    for (const admin of admins) {
      await notify({
        userId: admin.id,
        type: 'SYSTEM',
        title: 'Data deletion request',
        body: `A candidate requested account deletion (request ${request.id}). Review and process it in Admin → Data requests.`,
        data: { dataRequestId: request.id },
      });
    }
    await writeAudit(req, 'DATA_DELETION_REQUESTED', 'DataRequest', request.id);
    res.status(201).json({ data: request });
  }),
);

router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const [applications, interviews, unread, profile] = await Promise.all([
      prisma.application.findMany({
        where: { candidateId: req.user!.id },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: {
          id: true,
          stage: true,
          score: true,
          createdAt: true,
          job: { select: { id: true, title: true, organisation: { select: { name: true } } } },
        },
      }),
      prisma.interview.findMany({
        where: { application: { candidateId: req.user!.id }, status: 'SCHEDULED', slot: { startsAt: { gte: new Date() } } },
        include: { slot: true, application: { include: { job: { select: { title: true } } } } },
        orderBy: { slot: { startsAt: 'asc' } },
        take: 3,
      }),
      prisma.notification.count({ where: { userId: req.user!.id, readAt: null } }),
      prisma.candidateProfile.findUnique({ where: { userId: req.user!.id } }),
    ]);
    const total = await prisma.application.count({ where: { candidateId: req.user!.id } });
    res.json({
      data: {
        applications,
        upcomingInterviews: interviews,
        unreadNotifications: unread,
        totalApplications: total,
        profileComplete: Boolean(profile?.headline && profile?.location),
      },
    });
  }),
);

router.get(
  '/applications-count',
  asyncHandler(async (req, res) => {
    const count = await prisma.application.count({ where: { candidateId: req.user!.id } });
    res.json({ data: { count } });
  }),
);

export default router;
