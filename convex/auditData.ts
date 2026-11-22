import { internalQuery } from './_generated/server';
import { v } from 'convex/values';

/** Raw rows for the bias engine. Aggregation happens in the Node action. */
export const snapshotRows = internalQuery({
  args: { jobId: v.optional(v.id('jobs')), organisationId: v.optional(v.id('organisations')) },
  handler: async (ctx, args) => {
    let jobs;
    if (args.jobId) {
      const job = await ctx.db.get(args.jobId);
      jobs = job ? [job] : [];
    } else if (args.organisationId) {
      jobs = await ctx.db
        .query('jobs')
        .withIndex('by_organisation_status', (q) => q.eq('organisationId', args.organisationId!))
        .collect();
    } else {
      jobs = await ctx.db.query('jobs').collect();
    }

    const applications = [];
    for (const job of jobs) {
      const rows = await ctx.db
        .query('applications')
        .withIndex('by_job', (q) => q.eq('jobId', job._id))
        .collect();
      for (const row of rows) {
        const parsed = await ctx.db
          .query('parsedCvs')
          .withIndex('by_application', (q) => q.eq('applicationId', row._id))
          .unique();
        const cvFile = await ctx.db
          .query('cvFiles')
          .withIndex('by_application', (q) => q.eq('applicationId', row._id))
          .unique();
        const history = await ctx.db
          .query('statusHistory')
          .withIndex('by_application', (q) => q.eq('applicationId', row._id))
          .collect();
        applications.push({
          id: row._id,
          jobId: row.jobId,
          jobTitle: job.title,
          organisationId: job.organisationId,
          candidateId: row.candidateId,
          stage: row.stage,
          score: row.score ?? null,
          aiRecommendedStage: row.aiRecommendedStage ?? null,
          createdAt: row.createdAt,
          parsedCv: parsed?.data ?? null,
          cvText: cvFile?.extractedText ?? null,
          historyStages: history.map((h) => h.toStage),
        });
      }
    }

    const candidateIds = [...new Set(applications.map((a) => a.candidateId))];
    const declarations = [];
    for (const userId of candidateIds) {
      const declaration = await ctx.db
        .query('demographicDeclarations')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .unique();
      if (declaration) declarations.push({ userId, payload: declaration.payload });
    }

    const runs = [];
    for (const job of jobs) {
      const jobRuns = await ctx.db
        .query('counterfactualRuns')
        .withIndex('by_job', (q) => q.eq('jobId', job._id))
        .collect();
      runs.push(...jobRuns);
    }

    return {
      jobs: jobs.map((j) => ({ id: j._id, title: j.title, organisationId: j.organisationId })),
      applications,
      declarations,
      runs: runs.map((r) => ({ maxDelta: r.maxDelta, flagged: r.flagged })),
    };
  },
});

export const counterfactualBase = internalQuery({
  args: { applicationId: v.optional(v.id('applications')) },
  handler: async (ctx, args) => {
    if (!args.applicationId) return null;
    const application = await ctx.db.get(args.applicationId);
    if (!application) return null;
    const parsed = await ctx.db
      .query('parsedCvs')
      .withIndex('by_application', (q) => q.eq('applicationId', application._id))
      .unique();
    return {
      applicationId: application._id,
      jobId: application.jobId,
      parsed: parsed?.data ?? null,
    };
  },
});

export const persistReport = internalQuery({
  args: { id: v.id('biasReports') },
  handler: async (ctx, args) => await ctx.db.get(args.id),
});
