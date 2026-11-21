import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncHandler } from '../lib/async.js';
import { ApiError } from '../lib/errors.js';
import { paginated, paginationSchema, validate } from '../lib/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../middleware/audit.js';
import { buildAuditSnapshot } from '../services/audit-service.js';
import { buildBiasReportPdf } from '../services/report.js';
import { getAuditSettings } from '../services/settings.js';
import { buildVariants, deltaAgainstBaseline } from '../services/counterfactual.js';
import { evaluateCv } from '../services/pipeline.js';
import { EMPTY_CV, type ParsedCVData } from '../domain/types.js';

const router = Router();
router.use(requireAuth, requireRole('RECRUITER', 'ADMIN'));

async function assertScope(req: Parameters<typeof asyncHandler>[0] extends never ? never : any, jobId?: string, organisationId?: string) {
  const user = req.user!;
  if (user.role === 'ADMIN') return organisationId ?? (jobId ? (await prisma.job.findUnique({ where: { id: jobId }, select: { organisationId: true } }))?.organisationId : undefined);
  if (jobId) {
    const job = await prisma.job.findUnique({ where: { id: jobId }, select: { organisationId: true } });
    if (!job) throw ApiError.notFound('Job not found');
    if (job.organisationId !== user.orgId) throw ApiError.forbidden();
    return job.organisationId;
  }
  if (organisationId && organisationId !== user.orgId) throw ApiError.forbidden();
  return user.orgId ?? undefined;
}

const scopeQuery = z.object({
  jobId: z.string().optional(),
  organisationId: z.string().optional(),
});

router.get(
  '/snapshot',
  asyncHandler(async (req, res) => {
    const query = validate(scopeQuery, req.query);
    const organisationId = await assertScope(req, query.jobId, query.organisationId);
    const settings = await getAuditSettings();
    const snapshot = await buildAuditSnapshot({
      jobId: query.jobId,
      organisationId: organisationId ?? undefined,
      minGroupSize: settings.minGroupSize,
      threshold: settings.threshold,
    });
    res.json({ data: snapshot });
  }),
);

router.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const organisationId = await assertScope(req, undefined, undefined);
    const [jobs, reports, applications] = await Promise.all([
      prisma.job.findMany({
        where: organisationId ? { organisationId } : {},
        select: { id: true, title: true, status: true, _count: { select: { applications: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.biasReport.findMany({
        where: organisationId ? { organisationId } : {},
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, jobId: true, flagCount: true, createdAt: true, sampleSize: true },
      }),
      prisma.application.count({
        where: organisationId ? { job: { organisationId } } : {},
      }),
    ]);
    const latestByJob = new Map<string, { flagCount: number; createdAt: Date }>();
    for (const report of reports) {
      if (report.jobId && !latestByJob.has(report.jobId)) {
        latestByJob.set(report.jobId, { flagCount: report.flagCount, createdAt: report.createdAt });
      }
    }
    res.json({
      data: {
        jobs: jobs.map((job) => ({
          id: job.id,
          title: job.title,
          status: job.status,
          applications: job._count.applications,
          lastReport: latestByJob.get(job.id) ?? null,
        })),
        reports,
        totalApplications: applications,
        flaggedReports: reports.filter((r) => r.flagCount > 0).length,
      },
    });
  }),
);

const reportSchema = z.object({
  jobId: z.string().optional(),
  organisationId: z.string().optional(),
});

router.post(
  '/reports',
  asyncHandler(async (req, res) => {
    const input = validate(reportSchema, req.body ?? {});
    const organisationId = await assertScope(req, input.jobId, input.organisationId);
    const settings = await getAuditSettings();
    const snapshot = await buildAuditSnapshot({
      jobId: input.jobId,
      organisationId: organisationId ?? undefined,
      minGroupSize: settings.minGroupSize,
      threshold: settings.threshold,
    });

    const report = await prisma.biasReport.create({
      data: {
        jobId: input.jobId ?? null,
        organisationId: organisationId ?? null,
        generatedById: req.user!.id,
        summary: snapshot as unknown as object,
        findings: { findings: snapshot.findings, flags: snapshot.flags } as object,
        flagCount: snapshot.flags.length,
        methodology: snapshot.methodology.join('\n'),
        sampleSize: snapshot.sampleSize,
      },
    });
    await writeAudit(req, 'BIAS_REPORT_GENERATED', 'BiasReport', report.id, {
      jobId: input.jobId ?? null,
      flags: snapshot.flags.length,
    });
    res.status(201).json({ data: { reportId: report.id, snapshot } });
  }),
);

router.get(
  '/reports',
  asyncHandler(async (req, res) => {
    const query = validate(paginationSchema.extend({ jobId: z.string().optional() }), req.query);
    const organisationId = await assertScope(req, query.jobId, undefined);
    const where = {
      ...(organisationId ? { organisationId } : {}),
      ...(query.jobId ? { jobId: query.jobId } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.biasReport.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          jobId: true,
          flagCount: true,
          sampleSize: true,
          createdAt: true,
          job: { select: { title: true } },
          generatedBy: { select: { fullName: true } },
        },
      }),
      prisma.biasReport.count({ where }),
    ]);
    res.json(paginated(items, total, query.page, query.pageSize));
  }),
);

router.get(
  '/reports/:id',
  asyncHandler(async (req, res) => {
    const report = await prisma.biasReport.findUnique({
      where: { id: req.params.id },
      include: { job: { select: { title: true } } },
    });
    if (!report) throw ApiError.notFound('Report not found');
    if (req.user!.role !== 'ADMIN' && report.organisationId !== req.user!.orgId) throw ApiError.forbidden();
    res.json({ data: report });
  }),
);

router.get(
  '/reports/:id/pdf',
  asyncHandler(async (req, res) => {
    const report = await prisma.biasReport.findUnique({ where: { id: req.params.id } });
    if (!report) throw ApiError.notFound('Report not found');
    if (req.user!.role !== 'ADMIN' && report.organisationId !== req.user!.orgId) throw ApiError.forbidden();
    const pdf = await buildBiasReportPdf(report.summary as never);
    await writeAudit(req, 'BIAS_REPORT_EXPORTED', 'BiasReport', report.id, { format: 'pdf' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="ise-bias-report-${report.id}.pdf"`);
    res.send(pdf);
  }),
);

// --- Counterfactual testing ------------------------------------------------
const cvSchema = z.object({
  name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  headline: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  skills: z.array(z.string()).default([]),
  education: z
    .array(
      z.object({
        institution: z.string(),
        institutionType: z.enum(['FEDERAL', 'STATE', 'PRIVATE', 'POLYTECHNIC', 'UNKNOWN']).optional(),
        course: z.string().optional(),
        degreeLevel: z.enum(['SSCE', 'OND', 'HND', 'BSC', 'MSC', 'PHD']).optional(),
        degreeClass: z.enum(['FIRST', 'SECOND_UPPER', 'SECOND_LOWER', 'THIRD', 'PASS', 'NONE']).optional(),
        startYear: z.number().nullable().optional(),
        endYear: z.number().nullable().optional(),
      }),
    )
    .default([]),
  experience: z
    .array(
      z.object({
        title: z.string(),
        organisation: z.string().optional(),
        startYear: z.number().nullable().optional(),
        endYear: z.number().nullable().optional(),
        description: z.string().optional(),
        isInternship: z.boolean().optional(),
      }),
    )
    .default([]),
  projects: z.array(z.object({ name: z.string(), description: z.string().optional() })).default([]),
  certifications: z.array(z.string()).default([]),
  languages: z.array(z.string()).default([]),
});

router.post(
  '/jobs/:id/counterfactual',
  asyncHandler(async (req, res) => {
    const job = await prisma.job.findUnique({
      where: { id: req.params.id },
      include: { criteria: { orderBy: { order: 'asc' } } },
    });
    if (!job) throw ApiError.notFound('Job not found');
    if (req.user!.role !== 'ADMIN' && job.organisationId !== req.user!.orgId) throw ApiError.forbidden();

    const input = validate(
      z.object({
        applicationId: z.string().optional(),
        cv: cvSchema.optional(),
      }),
      req.body ?? {},
    );

    let baseCv: ParsedCVData = { ...EMPTY_CV };
    if (input.applicationId) {
      const application = await prisma.application.findUnique({
        where: { id: input.applicationId },
        include: { parsedCV: true, job: { select: { id: true } } },
      });
      if (!application || application.jobId !== job.id) throw ApiError.notFound('Application not found for this job');
      if (!application.parsedCV) throw ApiError.badRequest('That application has not been parsed yet.');
      baseCv = application.parsedCV.data as unknown as ParsedCVData;
    } else if (input.cv) {
      baseCv = input.cv as ParsedCVData;
    } else {
      throw ApiError.badRequest('Choose an application or supply a synthetic CV.');
    }

    const variants = buildVariants(baseCv);
    const results: { variantId: string; label: string; total: number; identity: Record<string, string> }[] = [];
    for (const variant of variants) {
      const scored = await evaluateCv(job, variant.cv);
      results.push({ variantId: variant.id, label: variant.label, total: scored.total, identity: variant.identity });
    }
    const deltas = deltaAgainstBaseline(results);
    const threshold = (await getAuditSettings()).counterfactualThreshold;
    const maxDelta = deltas.reduce((max, d) => Math.max(max, Math.abs(d.delta)), 0);
    const flagged = maxDelta >= threshold;

    const run = await prisma.counterfactualRun.create({
      data: {
        jobId: job.id,
        createdById: req.user!.id,
        baseCv: { skills: baseCv.skills, education: baseCv.education, experience: baseCv.experience } as object,
        variants: variants.map((v) => ({ id: v.id, label: v.label, identity: v.identity })) as object,
        results: { results, deltas } as object,
        maxDelta,
        threshold,
        flagged,
      },
    });
    await writeAudit(req, 'COUNTERFACTUAL_RUN', 'Job', job.id, { runId: run.id, maxDelta, flagged });

    res.status(201).json({
      data: {
        runId: run.id,
        maxDelta,
        threshold,
        flagged,
        results: results.map((r) => ({
          ...r,
          delta: deltas.find((d) => d.variantId === r.variantId)?.delta ?? 0,
        })),
        note: flagged
          ? 'Swapping identity signals changed the score beyond the configured threshold. Investigate the rubric and prompt before relying on these scores.'
          : 'Swapping identity signals produced no material score change in this run. Keep testing as CVs and criteria change.',
      },
    });
  }),
);

router.get(
  '/jobs/:id/counterfactual',
  asyncHandler(async (req, res) => {
    const job = await prisma.job.findUnique({ where: { id: req.params.id }, select: { organisationId: true } });
    if (!job) throw ApiError.notFound();
    if (req.user!.role !== 'ADMIN' && job.organisationId !== req.user!.orgId) throw ApiError.forbidden();
    const runs = await prisma.counterfactualRun.findMany({
      where: { jobId: req.params.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, maxDelta: true, threshold: true, flagged: true, createdAt: true, results: true },
    });
    res.json({ data: runs });
  }),
);

export default router;
