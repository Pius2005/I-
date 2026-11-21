import { Router } from 'express';
import { z } from 'zod';
import type { ApplicationStage, JobStatus, Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { asyncHandler } from '../lib/async.js';
import { ApiError } from '../lib/errors.js';
import { paginated, paginationSchema, validate } from '../lib/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../middleware/audit.js';
import { buildBlindView } from '../domain/redact.js';
import type { ParsedCVData } from '../domain/types.js';
import { generateSlots } from '../domain/ics.js';
import { notify } from '../services/notifications.js';
import { renderTemplate } from '../services/templates.js';
import { enqueue } from '../services/queue.js';
import { maybeAlertOnJob } from '../services/audit-service.js';
import { scoreAndStore } from '../services/pipeline.js';

const router = Router();
router.use(requireAuth, requireRole('RECRUITER', 'ADMIN'));

type AuthedRequest = Parameters<Parameters<typeof asyncHandler>[0]>[0];

async function loadJob(jobId: string, req: AuthedRequest) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      criteria: { orderBy: { order: 'asc' } },
      knockoutQuestions: { orderBy: { order: 'asc' } },
      organisation: { select: { id: true, name: true, slug: true } },
    },
  });
  if (!job) throw ApiError.notFound('Job not found');
  if (req.user!.role !== 'ADMIN' && job.organisationId !== req.user!.orgId) throw ApiError.forbidden();
  return job;
}

const criteriaSchema = z.object({
  kind: z.enum(['MUST_HAVE', 'NICE_TO_HAVE']),
  type: z.enum(['SKILL', 'DEGREE_LEVEL', 'DEGREE_CLASS', 'FIELD_OF_STUDY', 'EXPERIENCE', 'CERTIFICATION', 'LANGUAGE']),
  label: z.string().min(2).max(160),
  weight: z.number().int().min(0).max(100),
  config: z.record(z.unknown()).default({}),
});

const knockoutSchema = z.object({
  type: z.enum(['NYSC', 'DEGREE_CLASS', 'LOCATION', 'AVAILABILITY', 'WORK_AUTH']),
  prompt: z.string().min(5).max(300),
  options: z.array(z.string().max(80)).default([]),
  config: z.record(z.unknown()).default({}),
});

const jobSchema = z.object({
  title: z.string().min(3).max(160),
  description: z.string().min(40).max(20_000),
  location: z.string().min(2).max(120),
  employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'NYSC']).default('FULL_TIME'),
  deadline: z.coerce.date(),
  openings: z.number().int().min(1).max(500).default(1),
  minYearsExperience: z.number().int().min(0).max(30).default(0),
  blindScreening: z.boolean().default(true),
  hideUniversityBlind: z.boolean().default(true),
  biasDemoMode: z.boolean().default(false),
  status: z.enum(['DRAFT', 'OPEN', 'CLOSED']).default('DRAFT'),
  criteria: z.array(criteriaSchema).max(20).default([]),
  knockoutQuestions: z.array(knockoutSchema).max(10).default([]),
});

function assertWeights(criteria: { weight: number }[]) {
  if (!criteria.length) throw ApiError.badRequest('Add at least one criterion so scoring has a rubric.');
  const total = criteria.reduce((sum, c) => sum + c.weight, 0);
  if (total !== 100) throw ApiError.badRequest(`Criterion weights must total 100% (currently ${total}%).`);
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70);
}

// --- Dashboard --------------------------------------------------------------
router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const orgFilter = req.user!.role === 'ADMIN' ? {} : { organisationId: req.user!.orgId ?? 'none' };
    const jobs = await prisma.job.findMany({
      where: orgFilter,
      select: { id: true, title: true, status: true, deadline: true, openings: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    const jobIds = jobs.map((j) => j.id);
    const [applications, byStage, upcoming, recent, scores, shortlistTimes] = await Promise.all([
      prisma.application.count({ where: { jobId: { in: jobIds } } }),
      prisma.application.groupBy({ by: ['stage'], where: { jobId: { in: jobIds } }, _count: true }),
      prisma.interview.count({
        where: { status: 'SCHEDULED', slot: { startsAt: { gte: new Date() } }, application: { jobId: { in: jobIds } } },
      }),
      prisma.application.findMany({
        where: { jobId: { in: jobIds } },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true,
          publicRef: true,
          stage: true,
          score: true,
          createdAt: true,
          identityRevealedAt: true,
          knockoutPassed: true,
          job: { select: { id: true, title: true } },
          candidate: { select: { fullName: true } },
        },
      }),
      prisma.application.findMany({
        where: { jobId: { in: jobIds }, score: { not: null } },
        select: { score: true },
        take: 2000,
      }),
      prisma.application.findMany({
        where: { jobId: { in: jobIds }, shortlistedAt: { not: null } },
        select: { createdAt: true, shortlistedAt: true },
        take: 500,
      }),
    ]);
    const distribution = Array.from({ length: 10 }, (_, i) => ({
      bucket: `${i * 10}-${i * 10 + 9}`,
      count: scores.filter((s) => (s.score ?? 0) >= i * 10 && (s.score ?? 0) < i * 10 + 10).length,
    }));
    const avgDaysToShortlist = shortlistTimes.length
      ? shortlistTimes.reduce((sum, a) => sum + ((a.shortlistedAt!.getTime() - a.createdAt.getTime()) / 86_400_000), 0) /
        shortlistTimes.length
      : null;
    const recentSafe = recent.map((a) => ({
      ...a,
      candidate: undefined,
      name: a.identityRevealedAt ? a.candidate.fullName : a.publicRef,
    }));

    res.json({
      data: {
        jobs: jobs.slice(0, 10),
        jobCount: jobs.length,
        openJobs: jobs.filter((j) => j.status === 'OPEN').length,
        applications,
        byStage: Object.fromEntries(byStage.map((s) => [s.stage, s._count])),
        upcomingInterviews: upcoming,
        recentApplications: recentSafe,
        scoreDistribution: distribution,
        avgDaysToShortlist: avgDaysToShortlist ? Number(avgDaysToShortlist.toFixed(1)) : null,
      },
    });
  }),
);

// --- Jobs -------------------------------------------------------------------
router.get(
  '/jobs',
  asyncHandler(async (req, res) => {
    const query = validate(paginationSchema.extend({ status: z.string().optional(), search: z.string().optional() }), req.query);
    const where: Prisma.JobWhereInput = {
      ...(req.user!.role === 'ADMIN' ? {} : { organisationId: req.user!.orgId ?? 'none' }),
      ...(query.status ? { status: query.status as JobStatus } : {}),
      ...(query.search ? { title: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.job.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          organisation: { select: { name: true } },
          _count: { select: { applications: true } },
          criteria: { select: { weight: true } },
        },
      }),
      prisma.job.count({ where }),
    ]);
    res.json(
      paginated(
        items.map((job) => ({
          ...job,
          criteriaWeightTotal: job.criteria.reduce((s, c) => s + c.weight, 0),
          criteria: undefined,
        })),
        total,
        query.page,
        query.pageSize,
      ),
    );
  }),
);

router.post(
  '/jobs',
  asyncHandler(async (req, res) => {
    if (req.user!.role !== 'RECRUITER' && req.user!.role !== 'ADMIN') throw ApiError.forbidden();
    const input = validate(jobSchema, req.body);
    assertWeights(input.criteria);
    if (input.biasDemoMode && !env.ALLOW_BIAS_DEMO) {
      throw ApiError.badRequest('The bias demo rule is disabled on this server.');
    }

    const orgId = req.user!.role === 'ADMIN' ? req.user!.orgId : req.user!.orgId;
    if (!orgId) throw ApiError.badRequest('Your account is not linked to an organisation.');

    let slug = slugify(input.title) || 'job';
    let attempt = 1;
    while (await prisma.job.findUnique({ where: { slug } })) {
      slug = `${slugify(input.title)}-${attempt}`;
      attempt += 1;
    }

    const job = await prisma.job.create({
      data: {
        organisationId: orgId,
        recruiterId: req.user!.id,
        title: input.title,
        slug,
        description: input.description,
        location: input.location,
        employmentType: input.employmentType,
        deadline: input.deadline,
        openings: input.openings,
        minYearsExperience: input.minYearsExperience,
        blindScreening: input.blindScreening,
        hideUniversityBlind: input.hideUniversityBlind,
        biasDemoMode: input.biasDemoMode,
        status: input.status,
        criteria: {
          create: input.criteria.map((c, index) => ({
            kind: c.kind,
            type: c.type,
            label: c.label,
            weight: c.weight,
            config: c.config as object,
            order: index,
          })),
        },
        knockoutQuestions: {
          create: input.knockoutQuestions.map((q, index) => ({
            type: q.type,
            prompt: q.prompt,
            options: q.options,
            config: q.config as object,
            order: index,
          })),
        },
      },
    });
    await writeAudit(req, 'JOB_CREATED', 'Job', job.id, { title: job.title, status: job.status });
    res.status(201).json({ data: job });
  }),
);

router.get(
  '/jobs/:id',
  asyncHandler(async (req, res) => {
    const job = await loadJob(req.params.id, req);
    const [byStage, interviewCount] = await Promise.all([
      prisma.application.groupBy({ by: ['stage'], where: { jobId: job.id }, _count: true }),
      prisma.interview.count({ where: { application: { jobId: job.id }, status: 'SCHEDULED' } }),
    ]);
    res.json({
      data: {
        ...job,
        stats: {
          totalApplications: byStage.reduce((s, b) => s + b._count, 0),
          byStage: Object.fromEntries(byStage.map((b) => [b.stage, b._count])),
          interviews: interviewCount,
        },
      },
    });
  }),
);

router.patch(
  '/jobs/:id',
  asyncHandler(async (req, res) => {
    const existing = await loadJob(req.params.id, req);
    const input = validate(jobSchema.partial(), req.body);
    if (input.criteria) assertWeights(input.criteria);
    if (input.biasDemoMode && !env.ALLOW_BIAS_DEMO) throw ApiError.badRequest('The bias demo rule is disabled on this server.');

    const job = await prisma.$transaction(async (tx) => {
      if (input.criteria) {
        await tx.jobCriteria.deleteMany({ where: { jobId: existing.id } });
        await tx.jobCriteria.createMany({
          data: input.criteria.map((c, index) => ({
            jobId: existing.id,
            kind: c.kind,
            type: c.type,
            label: c.label,
            weight: c.weight,
            config: c.config as object,
            order: index,
          })),
        });
      }
      if (input.knockoutQuestions) {
        const incoming = input.knockoutQuestions;
        const [existingQuestions, answered] = await Promise.all([
          tx.knockoutQuestion.findMany({ where: { jobId: existing.id }, orderBy: { order: 'asc' } }),
          tx.knockoutAnswer.findMany({
            where: { application: { jobId: existing.id } },
            select: { questionId: true },
          }),
        ]);
        const answeredIds = new Set(answered.map((a) => a.questionId));

        // A question that already holds candidate answers must survive unchanged
        // at the same position; unanswered questions and new ones are rewritten.
        // Ordering the check this way lets a recruiter still edit the role, the
        // criteria and unused knockouts after the first applications arrive.
        const stable = (value: unknown): string => {
          if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
          if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
          const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => a.localeCompare(b));
          return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
        };

        const locked = existingQuestions.filter((q) => answeredIds.has(q.id));
        for (const question of locked) {
          const replacement = incoming[question.order];
          const unchanged =
            replacement &&
            replacement.type === question.type &&
            replacement.prompt === question.prompt &&
            stable(replacement.config) === stable(question.config);
          if (!unchanged) {
            throw ApiError.badRequest(
              'A knockout question already has candidate answers, so it cannot be edited or removed. Add a new question instead.',
            );
          }
        }

        const lockedIds = locked.map((q) => q.id);
        await tx.knockoutQuestion.deleteMany({ where: { jobId: existing.id, id: { notIn: lockedIds } } });
        const lockedOrders = new Set(locked.map((q) => q.order));
        const toCreate = incoming
          .map((question, index) => ({ question, index }))
          .filter(({ index }) => !lockedOrders.has(index));
        if (toCreate.length) {
          await tx.knockoutQuestion.createMany({
            data: toCreate.map(({ question, index }) => ({
              jobId: existing.id,
              type: question.type,
              prompt: question.prompt,
              options: question.options,
              config: question.config as object,
              order: index,
            })),
          });
        }
      }
      return tx.job.update({
        where: { id: existing.id },
        data: {
          title: input.title,
          description: input.description,
          location: input.location,
          employmentType: input.employmentType,
          deadline: input.deadline,
          openings: input.openings,
          minYearsExperience: input.minYearsExperience,
          blindScreening: input.blindScreening,
          hideUniversityBlind: input.hideUniversityBlind,
          biasDemoMode: input.biasDemoMode,
          status: input.status,
          ...(input.status === 'CLOSED' ? { closedAt: new Date() } : {}),
        },
      });
    });

    await writeAudit(req, 'JOB_UPDATED', 'Job', job.id, {
      changes: Object.keys(input),
      criteriaReplaced: Boolean(input.criteria),
    });

    // Criteria changes mean every existing score is stale: rescore in background.
    if (input.criteria) {
      const applications = await prisma.application.findMany({
        where: { jobId: job.id, parsedCV: { isNot: null } },
        select: { id: true },
        take: 500,
      });
      for (const application of applications) await enqueue('cv.score', { applicationId: application.id });
    }

    res.json({ data: job });
  }),
);

router.post(
  '/jobs/:id/status',
  asyncHandler(async (req, res) => {
    const { status } = validate(z.object({ status: z.enum(['DRAFT', 'OPEN', 'CLOSED']) }), req.body);
    const existing = await loadJob(req.params.id, req);
    const job = await prisma.job.update({
      where: { id: existing.id },
      data: { status, ...(status === 'CLOSED' ? { closedAt: new Date() } : {}) },
    });
    await writeAudit(req, 'JOB_STATUS_CHANGED', 'Job', job.id, { from: existing.status, to: status });
    res.json({ data: job });
  }),
);

// --- Applications: blind list & pipeline ------------------------------------
const listSchema = paginationSchema.extend({
  stage: z.string().optional(),
  sort: z.enum(['score_desc', 'score_asc', 'newest', 'oldest']).default('newest'),
  search: z.string().optional(),
  knockout: z.enum(['all', 'passed', 'flagged']).default('all'),
});

function applicationWhere(jobId: string, query: z.infer<typeof listSchema>): Prisma.ApplicationWhereInput {
  return {
    jobId,
    ...(query.stage ? { stage: query.stage as ApplicationStage } : {}),
    ...(query.knockout === 'passed' ? { knockoutPassed: true } : {}),
    ...(query.knockout === 'flagged' ? { knockoutPassed: false } : {}),
    ...(query.search
      ? {
          OR: [
            { publicRef: { contains: query.search, mode: 'insensitive' } },
            { identityRevealedAt: { not: null }, candidate: { fullName: { contains: query.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
}

function orderByFor(sort: string): Prisma.ApplicationOrderByWithRelationInput {
  switch (sort) {
    case 'score_desc':
      return { score: 'desc' };
    case 'score_asc':
      return { score: 'asc' };
    case 'oldest':
      return { createdAt: 'asc' };
    default:
      return { createdAt: 'desc' };
  }
}

router.get(
  '/jobs/:id/applications',
  asyncHandler(async (req, res) => {
    const job = await loadJob(req.params.id, req);
    const query = validate(listSchema, req.query);
    const where = applicationWhere(job.id, query);
    const [items, total] = await Promise.all([
      prisma.application.findMany({
        where,
        orderBy: orderByFor(query.sort),
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          publicRef: true,
          stage: true,
          score: true,
          knockoutPassed: true,
          knockoutFlags: true,
          humanReviewRequestedAt: true,
          identityRevealedAt: true,
          createdAt: true,
          parsedCV: { select: { data: true } },
          cvFile: { select: { extractionStatus: true, extractionError: true } },
          _count: { select: { interviews: true } },
        },
      }),
      prisma.application.count({ where }),
    ]);

    const data = items.map((item) => {
      const cv = (item.parsedCV?.data ?? null) as ParsedCVData | null;
      const flags = Array.isArray(item.knockoutFlags) ? (item.knockoutFlags as unknown[]) : [];
      return {
        id: item.id,
        anonymousRef: item.publicRef,
        stage: item.stage,
        score: item.score,
        knockoutPassed: item.knockoutPassed,
        knockoutFlagCount: flags.length,
        humanReviewRequestedAt: item.humanReviewRequestedAt,
        identityRevealed: Boolean(item.identityRevealedAt),
        createdAt: item.createdAt,
        interviewCount: item._count.interviews,
        cvStatus: item.cvFile?.extractionStatus ?? 'NONE',
        cvError: item.cvFile?.extractionError ?? null,
        topSkills: cv?.skills?.slice(0, 6) ?? [],
        education: cv?.education?.map((e) => ({
          degreeLevel: e.degreeLevel,
          degreeClass: e.degreeClass,
          course: e.course,
          institution: job.hideUniversityBlind && job.blindScreening && !item.identityRevealedAt ? 'Hidden' : e.institution,
        })) ?? [],
      };
    });
    res.json(paginated(data, total, query.page, query.pageSize));
  }),
);

router.get(
  '/jobs/:id/pipeline',
  asyncHandler(async (req, res) => {
    const job = await loadJob(req.params.id, req);
    const applications = await prisma.application.findMany({
      where: { jobId: job.id },
      orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
      take: 800,
      select: {
        id: true,
        publicRef: true,
        stage: true,
        score: true,
        knockoutPassed: true,
        knockoutFlags: true,
        identityRevealedAt: true,
        createdAt: true,
        humanReviewRequestedAt: true,
        parsedCV: { select: { data: true } },
      },
    });
    const stages: Record<string, { count: number; items: unknown[] }> = {};
    for (const stage of ['APPLIED', 'SCREENED', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED']) {
      stages[stage] = { count: 0, items: [] };
    }
    for (const app of applications) {
      const cv = (app.parsedCV?.data ?? null) as ParsedCVData | null;
      stages[app.stage].count += 1;
      stages[app.stage].items.push({
        id: app.id,
        anonymousRef: app.publicRef,
        score: app.score,
        stage: app.stage,
        knockoutPassed: app.knockoutPassed,
        knockoutFlagCount: Array.isArray(app.knockoutFlags) ? app.knockoutFlags.length : 0,
        identityRevealed: Boolean(app.identityRevealedAt),
        createdAt: app.createdAt,
        humanReviewRequestedAt: app.humanReviewRequestedAt,
        headline: cv?.headline ?? null,
        skills: cv?.skills?.slice(0, 4) ?? [],
      });
    }
    res.json({
      data: {
        job: {
          id: job.id,
          title: job.title,
          blindScreening: job.blindScreening,
          hideUniversityBlind: job.hideUniversityBlind,
          stages: ['APPLIED', 'SCREENED', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED'],
        },
        stages,
        total: applications.length,
      },
    });
  }),
);

// Candidate detail, redacted until an explicit, audited reveal.
router.get(
  '/applications/:id',
  asyncHandler(async (req, res) => {
    const application = await prisma.application.findUnique({
      where: { id: req.params.id },
      include: {
        job: { include: { organisation: true, criteria: { orderBy: { order: 'asc' } } } },
        candidate: { select: { id: true, fullName: true, email: true, phone: true, candidateProfile: true } },
        cvFile: true,
        parsedCV: true,
        scores: { orderBy: { createdAt: 'desc' }, take: 3 },
        knockoutAnswers: { include: { question: { select: { prompt: true, type: true } } } },
        notes: { include: { author: { select: { fullName: true } } }, orderBy: { createdAt: 'desc' } },
        statusHistory: { orderBy: { createdAt: 'desc' } },
        interviews: { include: { slot: true }, orderBy: { createdAt: 'desc' } },
        interviewSlots: true,
      },
    });
    if (!application) throw ApiError.notFound('Application not found');
    if (req.user!.role !== 'ADMIN' && application.job.organisationId !== req.user!.orgId) throw ApiError.forbidden();

    const revealed = Boolean(application.identityRevealedAt);
    const blind = application.job.blindScreening && !revealed;
    const cv = (application.parsedCV?.data ?? null) as ParsedCVData | null;

    const blindView = buildBlindView({
      anonymousRef: application.publicRef,
      identityRevealed: !blind,
      candidate: {
        name: application.candidate.fullName,
        email: application.candidate.email,
        phone: application.candidate.phone,
        location: application.candidate.candidateProfile?.location,
      },
      cv,
      cvText: blind ? null : application.cvFile?.extractedText ?? null,
      hideUniversity: application.job.hideUniversityBlind,
    });

    const latestScore = application.scores[0] ?? null;
    const stageIndex = ['APPLIED', 'SCREENED', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'HIRED'].indexOf(application.stage);

    res.json({
      data: {
        id: application.id,
        job: {
          id: application.job.id,
          title: application.job.title,
          blindScreening: application.job.blindScreening,
          hideUniversityBlind: application.job.hideUniversityBlind,
          organisation: application.job.organisation.name,
          criteria: application.job.criteria,
          deadline: application.job.deadline,
        },
        stage: application.stage,
        score: application.score,
        scoredAt: application.scoredAt,
        aiRecommendedStage: application.aiRecommendedStage,
        aiRecommendationNote:
          'AI only recommends. Move, shortlist or reject candidates yourself; a written reason is required for overrides and rejections.',
        breakdown: latestScore?.breakdown ?? [],
        explanation: latestScore?.explanation ?? null,
        scoreMeta: latestScore
          ? {
              model: latestScore.model,
              promptVersion: latestScore.promptVersion,
              rubricVersion: latestScore.rubricVersion,
              createdAt: latestScore.createdAt,
            }
          : null,
        coverLetter: application.coverLetter,
        knockoutPassed: application.knockoutPassed,
        knockoutFlags: application.knockoutFlags,
        knockoutAnswers: application.knockoutAnswers.map((a) => ({
          prompt: a.question.prompt,
          type: a.question.type,
          value: a.value,
          passed: a.passed,
        })),
        cvStatus: application.cvFile?.extractionStatus ?? 'NONE',
        cvError: application.cvFile?.extractionError ?? null,
        cvFilename: application.cvFile?.filename ?? null,
        cv: blindView.cv,
        cvText: blindView.cvText,
        identityRevealed: revealed,
        identity: reportedIdentity(blindView.candidate),
        anonymousRef: application.publicRef,
        canReveal: application.job.blindScreening && !revealed && stageIndex >= 2,
        humanReviewRequestedAt: application.humanReviewRequestedAt,
        rejectionReason: application.rejectionReason,
        overrideReason: application.overrideReason,
        notes: application.notes,
        statusHistory: application.statusHistory,
        interviews: application.interviews,
        createdAt: application.createdAt,
      },
    });
  }),
);

function reportedIdentity(candidate?: { name?: string | null; email?: string | null; phone?: string | null; location?: string | null }) {
  if (!candidate) return null;
  return { name: candidate.name, email: candidate.email, phone: candidate.phone, location: candidate.location };
}

// The raw CV is only downloadable after reveal; blind recruiters get redacted text.
router.get(
  '/applications/:id/cv',
  asyncHandler(async (req, res) => {
    const application = await prisma.application.findUnique({
      where: { id: req.params.id },
      include: { job: { select: { organisationId: true, blindScreening: true } }, cvFile: true },
    });
    if (!application?.cvFile) throw ApiError.notFound('No CV on this application');
    if (req.user!.role !== 'ADMIN' && application.job.organisationId !== req.user!.orgId) throw ApiError.forbidden();
    if (application.job.blindScreening && !application.identityRevealedAt) {
      throw ApiError.forbidden('Blind screening is on: the original CV stays hidden until you reveal the candidate.');
    }
    const buffer = await (await import('../services/storage.js')).storage.get(application.cvFile.storageKey);
    res.setHeader('Content-Type', application.cvFile.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${application.cvFile.filename.replace(/"/g, '')}"`);
    res.send(buffer);
  }),
);

// Explicit, audited identity reveal (allowed from shortlist stage onward).
router.post(
  '/applications/:id/reveal',
  asyncHandler(async (req, res) => {
    const { reason } = validate(z.object({ reason: z.string().min(5).max(500) }), req.body);
    const application = await prisma.application.findUnique({
      where: { id: req.params.id },
      include: { job: { select: { organisationId: true, blindScreening: true, title: true } } },
    });
    if (!application) throw ApiError.notFound('Application not found');
    if (req.user!.role !== 'ADMIN' && application.job.organisationId !== req.user!.orgId) throw ApiError.forbidden();
    if (application.identityRevealedAt) return res.json({ data: { ok: true, alreadyRevealed: true } });
    const rank = ['APPLIED', 'SCREENED', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'HIRED'].indexOf(application.stage);
    if (rank < 2 && req.user!.role !== 'ADMIN') {
      throw ApiError.badRequest('Identity is revealed only after a candidate is shortlisted.');
    }
    await prisma.application.update({
      where: { id: application.id },
      data: { identityRevealedAt: new Date(), identityRevealedBy: req.user!.id },
    });
    await writeAudit(req, 'IDENTITY_REVEALED', 'Application', application.id, {
      reason,
      jobId: application.jobId,
      blindScreening: application.job.blindScreening,
    });
    res.json({ data: { ok: true } });
  }),
);

// --- Decisions --------------------------------------------------------------
const stageSchema = z.object({
  stage: z.enum(['APPLIED', 'SCREENED', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED']),
  reason: z.string().max(2000).optional(),
  overrideReason: z.string().max(2000).optional(),
});

async function decideStage(
  applicationId: string,
  input: z.infer<typeof stageSchema>,
  actor: { id: string; role: string; orgId: string | null },
  req: AuthedRequest,
) {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    include: {
      job: { select: { organisationId: true, title: true, id: true } },
      candidate: { select: { id: true, email: true, fullName: true } },
    },
  });
  if (!application) throw ApiError.notFound('Application not found');
  if (actor.role !== 'ADMIN' && application.job.organisationId !== actor.orgId) throw ApiError.forbidden();

  const isRejection = input.stage === 'REJECTED';
  const aiSaidShortlist = application.aiRecommendedStage === 'SHORTLISTED';
  const movingToShortlist = input.stage === 'SHORTLISTED';
  const isOverride =
    (isRejection && aiSaidShortlist) || (movingToShortlist && application.aiRecommendedStage === 'SCREENED');

  if (isRejection && !input.reason?.trim()) {
    throw ApiError.badRequest('A written reason is required when rejecting a candidate.');
  }
  if (isOverride && !input.overrideReason?.trim()) {
    throw ApiError.badRequest(
      'You are overriding the AI recommendation. Record why before continuing — the decision and reason are audited.',
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.application.update({
      where: { id: applicationId },
      data: {
        stage: input.stage,
        ...(movingToShortlist && !application.shortlistedAt ? { shortlistedAt: new Date() } : {}),
        ...(isRejection ? { rejectionReason: input.reason } : {}),
        ...(isOverride ? { overrideReason: input.overrideReason } : {}),
      },
    });
    await tx.statusHistory.create({
      data: {
        applicationId,
        fromStage: application.stage,
        toStage: input.stage,
        actorId: actor.id,
        reason: input.overrideReason || input.reason || null,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        actorRole: actor.role,
        action: 'HUMAN_DECISION',
        entityType: 'Application',
        entityId: applicationId,
        metadata: {
          from: application.stage,
          to: input.stage,
          aiRecommendedStage: application.aiRecommendedStage,
          override: isOverride,
          reason: input.overrideReason || input.reason || null,
          jobId: application.jobId,
        },
        ip: req.ip,
      },
    });
    return result;
  });

  const templateKey = input.stage === 'SHORTLISTED' ? 'SHORTLISTED' : isRejection || input.stage === 'HIRED' ? 'OUTCOME' : null;
  if (templateKey) {
    const template = renderTemplate(
      templateKey,
      {
        candidateName: application.candidate.fullName.split(' ')[0],
        jobTitle: application.job.title,
        stage: input.stage.replace('_', ' ').toLowerCase(),
        reason: isRejection ? input.reason : undefined,
      },
      application.candidate.email,
    );
    await notify({
      userId: application.candidate.id,
      type: input.stage === 'SHORTLISTED' ? 'SHORTLISTED' : 'OUTCOME',
      title: template.title,
      body: template.body,
      data: { applicationId, jobId: application.jobId },
      email: template.email ? { subject: template.email.subject, paragraphs: [template.body], cta: { label: 'View application', url: `${env.APP_URL}/candidate/applications/${applicationId}` } } : null,
      sms: template.sms,
    });
  }

  if (['SHORTLISTED', 'REJECTED', 'HIRED'].includes(input.stage)) {
    maybeAlertOnJob(application.jobId).catch(() => undefined);
  }
  return updated;
}

router.patch(
  '/applications/:id/stage',
  asyncHandler(async (req, res) => {
    const input = validate(stageSchema, req.body);
    const updated = await decideStage(req.params.id, input, req.user!, req);
    res.json({ data: updated });
  }),
);

router.post(
  '/jobs/:id/bulk',
  asyncHandler(async (req, res) => {
    const job = await loadJob(req.params.id, req);
    const input = validate(
      z.object({
        applicationIds: z.array(z.string().min(1)).min(1).max(100),
        stage: z.enum(['SCREENED', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED']),
        reason: z.string().max(2000).optional(),
        overrideReason: z.string().max(2000).optional(),
      }),
      req.body,
    );
    if (input.stage === 'REJECTED' && !input.reason?.trim()) {
      throw ApiError.badRequest('A written reason is required for bulk rejection.');
    }
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of input.applicationIds) {
      try {
        const owned = await prisma.application.findUnique({ where: { id }, select: { jobId: true } });
        if (owned?.jobId !== job.id) throw new Error('Application is not part of this job');
        await decideStage(id, { stage: input.stage, reason: input.reason, overrideReason: input.overrideReason }, req.user!, req);
        results.push({ id, ok: true });
      } catch (error) {
        results.push({ id, ok: false, error: (error as Error).message });
      }
    }
    res.json({ data: { results, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length } });
  }),
);

// --- Notes & comparison -----------------------------------------------------
router.post(
  '/applications/:id/notes',
  asyncHandler(async (req, res) => {
    const { body } = validate(z.object({ body: z.string().min(2).max(4000) }), req.body);
    const application = await prisma.application.findUnique({
      where: { id: req.params.id },
      include: { job: { select: { organisationId: true } } },
    });
    if (!application) throw ApiError.notFound();
    if (req.user!.role !== 'ADMIN' && application.job.organisationId !== req.user!.orgId) throw ApiError.forbidden();
    const note = await prisma.note.create({
      data: { applicationId: application.id, authorId: req.user!.id, body },
      include: { author: { select: { fullName: true } } },
    });
    await writeAudit(req, 'NOTE_ADDED', 'Application', application.id);
    res.status(201).json({ data: note });
  }),
);

router.get(
  '/jobs/:id/compare',
  asyncHandler(async (req, res) => {
    const job = await loadJob(req.params.id, req);
    const ids = String(req.query.ids ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 5);
    if (ids.length < 2) throw ApiError.badRequest('Select two or more candidates to compare.');
    const applications = await prisma.application.findMany({
      where: { id: { in: ids }, jobId: job.id },
      select: {
        id: true,
        publicRef: true,
        score: true,
        stage: true,
        identityRevealedAt: true,
        knockoutPassed: true,
        parsedCV: { select: { data: true } },
        scores: { orderBy: { createdAt: 'desc' }, take: 1, select: { breakdown: true, explanation: true } },
      },
    });
    res.json({
      data: applications.map((a) => {
        const cv = (a.parsedCV?.data ?? null) as ParsedCVData | null;
        return {
          id: a.id,
          anonymousRef: a.publicRef,
          score: a.score,
          stage: a.stage,
          knockoutPassed: a.knockoutPassed,
          skills: cv?.skills ?? [],
          education: cv?.education?.map((e) => ({
            ...e,
            institution: job.hideUniversityBlind && job.blindScreening && !a.identityRevealedAt ? 'Hidden' : e.institution,
          })) ?? [],
          breakdown: a.scores[0]?.breakdown ?? [],
          explanation: a.scores[0]?.explanation ?? null,
        };
      }),
    });
  }),
);

// --- Availability windows and slots ----------------------------------------
router.post(
  '/jobs/:id/availability',
  asyncHandler(async (req, res) => {
    const job = await loadJob(req.params.id, req);
    const input = validate(
      z.object({
        startsAt: z.coerce.date(),
        endsAt: z.coerce.date(),
        slotMinutes: z.number().int().min(10).max(240).default(30),
        bufferMinutes: z.number().int().min(0).max(120).default(10),
        timezone: z.string().default('Africa/Lagos'),
        interviewType: z.enum(['IN_PERSON', 'PHONE', 'VIDEO']).default('VIDEO'),
        location: z.string().max(300).optional(),
        interviewerIds: z.array(z.string()).max(10).default([]),
      }),
      req.body,
    );
    if (input.endsAt <= input.startsAt) throw ApiError.badRequest('The window must end after it starts.');
    if (input.startsAt < new Date(Date.now() - 60_000)) throw ApiError.badRequest('Pick a future availability window.');

    const slots = generateSlots(input);
    if (!slots.length) throw ApiError.badRequest('That window is too short for the chosen slot length.');

    const window = await prisma.availabilityWindow.create({
      data: {
        jobId: job.id,
        recruiterId: req.user!.id,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        slotMinutes: input.slotMinutes,
        bufferMinutes: input.bufferMinutes,
        timezone: input.timezone,
        interviewType: input.interviewType,
        location: input.location,
        slots: {
          create: slots.map((slot) => ({
            jobId: job.id,
            startsAt: slot.startsAt,
            endsAt: new Date(slot.startsAt.getTime() + slot.slotMinutes * 60_000),
          })),
        },
      },
      include: { slots: { orderBy: { startsAt: 'asc' } } },
    });
    await writeAudit(req, 'AVAILABILITY_CREATED', 'Job', job.id, { windowId: window.id, slots: window.slots.length });
    res.status(201).json({ data: window });
  }),
);

router.get(
  '/jobs/:id/availability',
  asyncHandler(async (req, res) => {
    const job = await loadJob(req.params.id, req);
    const windows = await prisma.availabilityWindow.findMany({
      where: { jobId: job.id, startsAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
      orderBy: { startsAt: 'asc' },
      include: {
        slots: {
          orderBy: { startsAt: 'asc' },
          include: { interview: { select: { id: true, status: true } } },
        },
      },
    });
    res.json({ data: windows });
  }),
);

router.delete(
  '/availability/:id',
  asyncHandler(async (req, res) => {
    const window = await prisma.availabilityWindow.findUnique({
      where: { id: req.params.id },
      include: { job: { select: { organisationId: true, id: true } }, slots: { where: { applicationId: { not: null } } } },
    });
    if (!window) throw ApiError.notFound();
    if (req.user!.role !== 'ADMIN' && window.job.organisationId !== req.user!.orgId) throw ApiError.forbidden();
    if (window.slots.length) throw ApiError.conflict('This window has booked interviews. Cancel them first.');
    await prisma.availabilityWindow.delete({ where: { id: window.id } });
    await writeAudit(req, 'AVAILABILITY_DELETED', 'Job', window.job.id, { windowId: window.id });
    res.json({ data: { ok: true } });
  }),
);

// Recruiter view of all interviews in their organisation.
router.get(
  '/interviews',
  asyncHandler(async (req, res) => {
    const query = validate(paginationSchema.extend({ upcoming: z.coerce.boolean().default(false) }), req.query);
    const where: Prisma.InterviewWhereInput = {
      ...(req.user!.role === 'ADMIN' ? {} : { application: { job: { organisationId: req.user!.orgId ?? 'none' } } }),
      ...(query.upcoming ? { status: 'SCHEDULED', slot: { startsAt: { gte: new Date() } } } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.interview.findMany({
        where,
        include: {
          slot: true,
          application: {
            select: {
              id: true,
              publicRef: true,
              stage: true,
              identityRevealedAt: true,
              job: { select: { id: true, title: true } },
              candidate: { select: { fullName: true, email: true } },
            },
          },
        },
        orderBy: { slot: { startsAt: 'asc' } },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.interview.count({ where }),
    ]);
    const safe = items.map((i) => ({
      ...i,
      application: {
        ...i.application,
        candidate: i.application.identityRevealedAt ? i.application.candidate : { fullName: i.application.publicRef, email: null },
      },
    }));
    res.json(paginated(safe, total, query.page, query.pageSize));
  }),
);

// Manual rescore (recruiter) — audited, never automatic rejection.
router.post(
  '/applications/:id/rescore',
  asyncHandler(async (req, res) => {
    const application = await prisma.application.findUnique({
      where: { id: req.params.id },
      include: { job: { select: { organisationId: true } } },
    });
    if (!application) throw ApiError.notFound();
    if (req.user!.role !== 'ADMIN' && application.job.organisationId !== req.user!.orgId) throw ApiError.forbidden();
    const result = await scoreAndStore(application.id, { source: 'manual' });
    if (!result) throw ApiError.badRequest('This application has no parsed CV yet.');
    await writeAudit(req, 'MANUAL_RESCORE', 'Application', application.id, { total: result.total, model: result.model });
    res.json({ data: result });
  }),
);

export default router;
