import { query } from './_generated/server';
import { v } from 'convex/values';
import { paginate, pagination } from '../shared/shared';

export const meta = query({
  args: {},
  handler: async (ctx) => {
    const jobs = await ctx.db
      .query('jobs')
      .withIndex('by_status_deadline', (q) => q.eq('status', 'OPEN'))
      .collect();
    const organisations = await ctx.db.query('organisations').collect();
    const candidates = await ctx.db
      .query('users')
      .withIndex('by_role', (q) => q.eq('role', 'CANDIDATE'))
      .collect();
    const reports = await ctx.db.query('biasReports').collect();
    return {
      name: 'Iṣẹ́',
      tagline: 'Fair, fast graduate hiring for Nigeria.',
      stats: {
        openJobs: jobs.filter((j) => j.deadline >= Date.now()).length,
        organisations: organisations.length,
        candidates: candidates.filter((u) => u.isActive && !u.deletedAt).length,
        biasReports: reports.length,
      },
      aiNoticeVersion: '2026-02-v1',
    };
  },
});

export const jobs = query({
  args: {
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    search: v.optional(v.string()),
    location: v.optional(v.string()),
    type: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { page, pageSize, skip } = pagination(args);
    const search = args.search?.trim().toLowerCase();
    const location = args.location?.trim().toLowerCase();
    const now = Date.now();

    const open = await ctx.db
      .query('jobs')
      .withIndex('by_status_deadline', (q) => q.eq('status', 'OPEN'))
      .collect();

    const organisations = new Map(
      (await ctx.db.query('organisations').collect()).map((o) => [o._id, o]),
    );

    const filtered = open
      .filter((job) => job.deadline >= now)
      .filter((job) => (args.type ? job.employmentType === args.type : true))
      .filter((job) => (location ? job.location.toLowerCase().includes(location) : true))
      .filter((job) => {
        if (!search) return true;
        const org = organisations.get(job.organisationId);
        return (
          job.title.toLowerCase().includes(search) ||
          job.description.toLowerCase().includes(search) ||
          (org?.name.toLowerCase().includes(search) ?? false)
        );
      })
      .sort((a, b) => b.createdAt - a.createdAt);

    const pageItems = filtered.slice(skip, skip + pageSize);
    const items = await Promise.all(
      pageItems.map(async (job) => {
        const org = organisations.get(job.organisationId);
        const criteria = await ctx.db
          .query('jobCriteria')
          .withIndex('by_job', (q) => q.eq('jobId', job._id))
          .collect();
        const applications = await ctx.db
          .query('applications')
          .withIndex('by_job', (q) => q.eq('jobId', job._id))
          .collect();
        return {
          id: job._id,
          title: job.title,
          slug: job.slug,
          location: job.location,
          employmentType: job.employmentType,
          deadline: job.deadline,
          openings: job.openings,
          createdAt: job.createdAt,
          organisation: org ? { name: org.name, sector: org.sector ?? null } : null,
          _count: { applications: applications.length },
          criteria: criteria
            .sort((a, b) => a.order - b.order)
            .map((c) => ({ id: c._id, kind: c.kind, type: c.type, label: c.label, weight: c.weight })),
        };
      }),
    );

    return paginate(items, filtered.length, page, pageSize);
  },
});

export const jobBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.db
      .query('jobs')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .unique();
    if (!job || job.status === 'DRAFT') return null;
    const organisation = await ctx.db.get(job.organisationId);
    const criteria = await ctx.db
      .query('jobCriteria')
      .withIndex('by_job', (q) => q.eq('jobId', job._id))
      .collect();
    const knockouts = await ctx.db
      .query('knockoutQuestions')
      .withIndex('by_job', (q) => q.eq('jobId', job._id))
      .collect();
    const applications = await ctx.db
      .query('applications')
      .withIndex('by_job', (q) => q.eq('jobId', job._id))
      .collect();
    return {
      id: job._id,
      title: job.title,
      slug: job.slug,
      description: job.description,
      location: job.location,
      employmentType: job.employmentType,
      deadline: job.deadline,
      openings: job.openings,
      status: job.status,
      minYearsExperience: job.minYearsExperience,
      blindScreening: job.blindScreening,
      createdAt: job.createdAt,
      organisation: organisation
        ? { name: organisation.name, sector: organisation.sector ?? null, website: organisation.website ?? null }
        : null,
      criteria: criteria.sort((a, b) => a.order - b.order),
      knockoutQuestions: knockouts.sort((a, b) => a.order - b.order),
      _count: { applications: applications.length },
    };
  },
});

export const privacy = query({
  args: {},
  handler: async () => ({ version: '2026-02-v1', retentionDays: 365 }),
});
