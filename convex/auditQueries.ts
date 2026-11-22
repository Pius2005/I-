import { query } from './_generated/server';
import { v } from 'convex/values';
import { fail, requireUser } from '../shared/authz';
import { paginate, pagination } from '../shared/shared';

export const overview = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    if (auth.role === 'CANDIDATE') fail('FORBIDDEN', 'Recruiters only.');

    const jobs = await ctx.db.query('jobs').collect();
    const scoped = jobs.filter((job) => auth.role === 'ADMIN' || job.organisationId === auth.orgId);
    const reports = await ctx.db.query('biasReports').collect();
    const scopedReports = reports
      .filter((report) => auth.role === 'ADMIN' || report.organisationId === auth.orgId)
      .sort((a, b) => b.createdAt - a.createdAt);

    const items = [];
    for (const job of scoped.sort((a, b) => b.createdAt - a.createdAt)) {
      const applications = await ctx.db
        .query('applications')
        .withIndex('by_job', (q) => q.eq('jobId', job._id))
        .collect();
      const latest = scopedReports.find((report) => report.jobId === job._id);
      items.push({
        id: job._id,
        title: job.title,
        status: job.status,
        applications: applications.length,
        lastReport: latest ? { flagCount: latest.flagCount, createdAt: latest.createdAt } : null,
      });
    }

    let totalApplications = 0;
    for (const job of scoped) {
      const applications = await ctx.db
        .query('applications')
        .withIndex('by_job', (q) => q.eq('jobId', job._id))
        .collect();
      totalApplications += applications.length;
    }

    return {
      jobs: items,
      reports: scopedReports.slice(0, 20).map((report) => ({
        id: report._id,
        jobId: report.jobId ?? null,
        flagCount: report.flagCount,
        createdAt: report.createdAt,
        sampleSize: report.sampleSize,
      })),
      totalApplications,
      flaggedReports: scopedReports.filter((r) => r.flagCount > 0).length,
    };
  },
});

export const reports = query({
  args: { token: v.string(), page: v.optional(v.number()), pageSize: v.optional(v.number()), jobId: v.optional(v.id('jobs')) },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    if (auth.role === 'CANDIDATE') fail('FORBIDDEN', 'Recruiters only.');
    const { page, pageSize, skip } = pagination(args);

    const all = await ctx.db.query('biasReports').collect();
    const scoped = all
      .filter((report) => auth.role === 'ADMIN' || report.organisationId === auth.orgId)
      .filter((report) => (args.jobId ? report.jobId === args.jobId : true))
      .sort((a, b) => b.createdAt - a.createdAt);

    const items = [];
    for (const report of scoped.slice(skip, skip + pageSize)) {
      const job = report.jobId ? await ctx.db.get(report.jobId) : null;
      const generatedBy = await ctx.db.get(report.generatedById);
      items.push({
        id: report._id,
        jobId: report.jobId ?? null,
        flagCount: report.flagCount,
        sampleSize: report.sampleSize,
        createdAt: report.createdAt,
        job: job ? { title: job.title } : null,
        generatedBy: { fullName: generatedBy?.fullName ?? 'System' },
      });
    }
    return paginate(items, scoped.length, page, pageSize);
  },
});

export const reportById = query({
  args: { token: v.string(), id: v.id('biasReports') },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const report = await ctx.db.get(args.id);
    if (!report) fail('NOT_FOUND', 'Report not found');
    if (auth.role !== 'ADMIN' && report.organisationId !== auth.orgId) fail('FORBIDDEN', 'You do not have access to this report.');
    const job = report.jobId ? await ctx.db.get(report.jobId) : null;
    return { ...report, id: report._id, job: job ? { title: job.title } : null };
  },
});

export const counterfactualRuns = query({
  args: { token: v.string(), jobId: v.id('jobs') },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const job = await ctx.db.get(args.jobId);
    if (!job) fail('NOT_FOUND', 'Job not found');
    if (auth.role !== 'ADMIN' && job.organisationId !== auth.orgId) fail('FORBIDDEN', 'You do not have access to this job.');
    const runs = await ctx.db
      .query('counterfactualRuns')
      .withIndex('by_job', (q) => q.eq('jobId', job._id))
      .collect();
    return runs
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 20)
      .map((run) => ({
        id: run._id,
        maxDelta: run.maxDelta,
        threshold: run.threshold,
        flagged: run.flagged,
        createdAt: run.createdAt,
        results: run.results,
      }));
  },
});
