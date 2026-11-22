import { internalQuery } from './_generated/server';
import { v } from 'convex/values';
import { requireUser } from '../shared/authz';
import { getAuditSettings } from '../shared/shared';

export const current = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireUser(ctx, args.token);
    return await getAuditSettings(ctx);
  },
});

export const jobScope = internalQuery({
  args: { token: v.string(), jobId: v.id('jobs') },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const job = await ctx.db.get(args.jobId);
    if (!job) return { allowed: false, organisationId: null };
    if (auth.role === 'ADMIN') return { allowed: true, organisationId: job.organisationId };
    if (auth.role !== 'RECRUITER') return { allowed: false, organisationId: null };
    return { allowed: job.organisationId === auth.orgId, organisationId: job.organisationId };
  },
});

export const orgScope = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    return auth.role === 'ADMIN' ? undefined : auth.orgId ?? undefined;
  },
});

export const jobForScoring = internalQuery({
  args: { jobId: v.id('jobs') },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;
    const criteria = await ctx.db
      .query('jobCriteria')
      .withIndex('by_job', (q) => q.eq('jobId', job._id))
      .collect();
    return {
      job: { biasDemoMode: job.biasDemoMode },
      criteria: criteria.map((c) => ({
        _id: c._id,
        kind: c.kind,
        type: c.type,
        label: c.label,
        weight: c.weight,
        config: c.config,
        order: c.order,
      })),
    };
  },
});

export const auditSettings = internalQuery({
  args: {},
  handler: async (ctx) => await getAuditSettings(ctx),
});
