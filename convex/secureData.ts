import { internalMutation, internalQuery } from './_generated/server';
import { v } from 'convex/values';
import { requireUser } from '../shared/authz';
import { writeAudit } from '../shared/shared';

export const seedDeclaration = internalMutation({
  args: { token: v.string(), userId: v.id('users'), payload: v.string(), consentVersion: v.string() },
  handler: async (ctx, args) => {
    const secret = process.env.SEED_TOKEN;
    if (!secret || args.token !== secret) throw new Error('Seeding is not enabled on this deployment.');
    const now = Date.now();
    const existing = await ctx.db
      .query('demographicDeclarations')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { payload: args.payload, consentVersion: args.consentVersion, updatedAt: now });
    } else {
      await ctx.db.insert('demographicDeclarations', {
        userId: args.userId,
        payload: args.payload,
        keyVersion: 1,
        consentVersion: args.consentVersion,
        declaredAt: now,
        updatedAt: now,
      });
    }
  },
});

export const declaration = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    return await ctx.db
      .query('demographicDeclarations')
      .withIndex('by_user', (q) => q.eq('userId', auth.user._id))
      .unique();
  },
});

export const saveDeclaration = internalMutation({
  args: { token: v.string(), payload: v.string(), consentVersion: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const now = Date.now();
    const existing = await ctx.db
      .query('demographicDeclarations')
      .withIndex('by_user', (q) => q.eq('userId', auth.user._id))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        payload: args.payload,
        consentVersion: args.consentVersion,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert('demographicDeclarations', {
        userId: auth.user._id,
        payload: args.payload,
        keyVersion: 1,
        consentVersion: args.consentVersion,
        declaredAt: now,
        updatedAt: now,
      });
    }
    await writeAudit(ctx, { id: auth.user._id, role: auth.role }, 'DEMOGRAPHICS_DECLARED', 'User', auth.user._id);
  },
});

export const deleteDeclaration = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const existing = await ctx.db
      .query('demographicDeclarations')
      .withIndex('by_user', (q) => q.eq('userId', auth.user._id))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    await writeAudit(ctx, { id: auth.user._id, role: auth.role }, 'DEMOGRAPHICS_WITHDRAWN', 'User', auth.user._id);
  },
});

export const exportBundle = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const user = auth.user;
    const profile = await ctx.db
      .query('candidateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .unique();
    const applications = await ctx.db
      .query('applications')
      .withIndex('by_candidate', (q) => q.eq('candidateId', user._id))
      .collect();
    const applicationDetail = [];
    for (const application of applications) {
      const job = await ctx.db.get(application.jobId);
      const organisation = job ? await ctx.db.get(job.organisationId) : null;
      const parsed = await ctx.db
        .query('parsedCvs')
        .withIndex('by_application', (q) => q.eq('applicationId', application._id))
        .unique();
      const scores = await ctx.db
        .query('scores')
        .withIndex('by_application', (q) => q.eq('applicationId', application._id))
        .collect();
      applicationDetail.push({
        id: application._id,
        job: job?.title ?? null,
        organisation: organisation?.name ?? null,
        stage: application.stage,
        score: application.score ?? null,
        parsed: parsed?.data ?? null,
        latestScore: scores.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null,
      });
    }
    const consentRecords = await ctx.db
      .query('consentRecords')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .collect();
    const notifications = await ctx.db
      .query('notifications')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .collect();
    const declaration = await ctx.db
      .query('demographicDeclarations')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .unique();

    return {
      account: {
        id: user._id,
        email: user.email,
        fullName: user.fullName,
        phone: user.phone ?? null,
        role: user.role,
        createdAt: user.createdAt,
        profile,
      },
      declaration,
      applications: applicationDetail,
      cvTexts: applicationDetail.map((a) => ({ job: a.job, parsed: a.parsed })),
      consentRecords,
      notifications: notifications
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 100)
        .map((n) => ({ title: n.title, body: n.body, createdAt: n.createdAt })),
    };
  },
});

export const recordExport = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    await ctx.db.insert('dataRequests', {
      userId: auth.user._id,
      type: 'EXPORT',
      status: 'COMPLETED',
      requestedAt: Date.now(),
      completedAt: Date.now(),
    });
    await writeAudit(ctx, { id: auth.user._id, role: auth.role }, 'DATA_EXPORT', 'User', auth.user._id);
  },
});
