import { Router } from 'express';
import { prisma } from '../db.js';
import { asyncHandler } from '../lib/async.js';
import { ApiError } from '../lib/errors.js';
import { paginated, paginationSchema, validate } from '../lib/validate.js';
import { z } from 'zod';

const router = Router();

router.get(
  '/meta',
  asyncHandler(async (_req, res) => {
    const [jobs, organisations, candidates, published] = await Promise.all([
      prisma.job.count({ where: { status: 'OPEN' } }),
      prisma.organisation.count(),
      prisma.user.count({ where: { role: 'CANDIDATE', isActive: true } }),
      prisma.biasReport.count(),
    ]);
    res.json({
      data: {
        name: 'Iṣẹ́',
        tagline: 'Fair, fast graduate hiring for Nigeria.',
        stats: { openJobs: jobs, organisations, candidates, biasReports: published },
        aiNoticeVersion: '2026-02-v1',
      },
    });
  }),
);

const jobListSchema = paginationSchema.extend({
  search: z.string().max(120).optional(),
  location: z.string().max(80).optional(),
  type: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'NYSC']).optional(),
});

router.get(
  '/jobs',
  asyncHandler(async (req, res) => {
    const query = validate(jobListSchema, req.query);
    const where = {
      status: 'OPEN' as const,
      deadline: { gte: new Date() },
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' as const } },
              { description: { contains: query.search, mode: 'insensitive' as const } },
              { organisation: { name: { contains: query.search, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
      ...(query.location ? { location: { contains: query.location, mode: 'insensitive' as const } } : {}),
      ...(query.type ? { employmentType: query.type } : {}),
    };
    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          title: true,
          slug: true,
          location: true,
          employmentType: true,
          deadline: true,
          openings: true,
          createdAt: true,
          organisation: { select: { name: true, sector: true } },
          _count: { select: { applications: true } },
          criteria: { select: { id: true, kind: true, type: true, label: true, weight: true }, orderBy: { order: 'asc' } },
        },
      }),
      prisma.job.count({ where }),
    ]);
    res.json(paginated(jobs, total, query.page, query.pageSize));
  }),
);

router.get(
  '/jobs/:slug',
  asyncHandler(async (req, res) => {
    const job = await prisma.job.findUnique({
      where: { slug: req.params.slug },
      select: {
        id: true,
        title: true,
        slug: true,
        description: true,
        location: true,
        employmentType: true,
        deadline: true,
        openings: true,
        status: true,
        minYearsExperience: true,
        blindScreening: true,
        createdAt: true,
        organisation: { select: { name: true, sector: true, website: true } },
        criteria: { orderBy: { order: 'asc' } },
        knockoutQuestions: { orderBy: { order: 'asc' } },
        _count: { select: { applications: true } },
      },
    });
    if (!job) throw ApiError.notFound('That job could not be found.');
    if (job.status === 'DRAFT') throw ApiError.notFound('That job could not be found.');
    res.json({ data: job });
  }),
);

router.get('/privacy', (_req, res) => {
  res.json({ data: { version: '2026-02-v1', retentionDays: 365 } });
});

export default router;
