import { internalMutation } from './_generated/server';
import { v } from 'convex/values';
import { writeAudit } from '../shared/shared';
import { requireUser } from '../shared/authz';

export const saveReport = internalMutation({
  args: {
    token: v.string(),
    jobId: v.optional(v.id('jobs')),
    organisationId: v.optional(v.id('organisations')),
    summary: v.any(),
    flagCount: v.number(),
    methodology: v.string(),
    sampleSize: v.number(),
    flags: v.any(),
  },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const now = Date.now();
    const reportId = await ctx.db.insert('biasReports', {
      jobId: args.jobId,
      organisationId: args.organisationId,
      generatedById: auth.user._id,
      summary: args.summary,
      findings: { findings: (args.summary as { findings?: unknown }).findings ?? [], flags: args.flags },
      flagCount: args.flagCount,
      methodology: args.methodology,
      sampleSize: args.sampleSize,
      createdAt: now,
    });
    await writeAudit(ctx, { id: auth.user._id, role: auth.role }, 'BIAS_REPORT_GENERATED', 'BiasReport', reportId, {
      jobId: args.jobId ?? null,
      flags: args.flagCount,
    });
    return reportId;
  },
});

export const saveCounterfactual = internalMutation({
  args: {
    token: v.string(),
    jobId: v.id('jobs'),
    baseCv: v.any(),
    variants: v.any(),
    results: v.any(),
    maxDelta: v.number(),
    threshold: v.number(),
    flagged: v.boolean(),
  },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const runId = await ctx.db.insert('counterfactualRuns', {
      jobId: args.jobId,
      createdById: auth.user._id,
      baseCv: args.baseCv,
      variants: args.variants,
      results: args.results,
      maxDelta: args.maxDelta,
      threshold: args.threshold,
      flagged: args.flagged,
      createdAt: Date.now(),
    });
    await writeAudit(ctx, { id: auth.user._id, role: auth.role }, 'COUNTERFACTUAL_RUN', 'Job', args.jobId, {
      runId,
      maxDelta: args.maxDelta,
      flagged: args.flagged,
    });
    return runId;
  },
});
