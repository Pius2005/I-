import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { requireUser, fail } from '../shared/authz';
import { notify, writeAudit } from '../shared/shared';

const profileFields = {
  headline: v.optional(v.union(v.string(), v.null())),
  summary: v.optional(v.union(v.string(), v.null())),
  location: v.optional(v.union(v.string(), v.null())),
  phone: v.optional(v.union(v.string(), v.null())),
  linkedinUrl: v.optional(v.union(v.string(), v.null())),
  portfolioUrl: v.optional(v.union(v.string(), v.null())),
};

export const profile = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    // Queries are read-only, so a missing profile is reported as an empty one;
    // the row itself is created by updateProfile on the first save.
    const record = await ctx.db
      .query('candidateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', auth.user._id))
      .unique();
    const now = Date.now();
    return {
      headline: record?.headline ?? null,
      summary: record?.summary ?? null,
      location: record?.location ?? null,
      phone: record?.phone ?? null,
      linkedinUrl: record?.linkedinUrl ?? null,
      portfolioUrl: record?.portfolioUrl ?? null,
      createdAt: record?.createdAt ?? now,
      updatedAt: record?.updatedAt ?? now,
      userId: auth.user._id,
      id: record?._id ?? null,
      fullName: auth.user.fullName,
      email: auth.user.email,
    };
  },
});

export const updateProfile = mutation({
  args: { token: v.string(), ...profileFields },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    if (auth.role !== 'CANDIDATE') fail('FORBIDDEN', 'Only candidates have a candidate profile.');
    const { token: _token, ...input } = args;
    for (const key of ['linkedinUrl', 'portfolioUrl'] as const) {
      const value = input[key];
      if (value && !/^https?:\/\/\S+$/.test(value)) fail('BAD_REQUEST', 'Enter a full URL, including https://');
    }
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) patch[key] = value === '' ? undefined : value;
    }
    const existing = await ctx.db
      .query('candidateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', auth.user._id))
      .unique();
    let id;
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      id = existing._id;
    } else {
      const now = Date.now();
      id = await ctx.db.insert('candidateProfiles', {
        userId: auth.user._id,
        ...(patch as object),
        createdAt: now,
        updatedAt: now,
      });
    }
    if (input.phone !== undefined) {
      await ctx.db.patch(auth.user._id, { phone: input.phone ?? undefined, updatedAt: Date.now() });
    }
    const record = await ctx.db.get(id);
    return { ...record, id: record!._id };
  },
});

export const consent = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const rows = await ctx.db
      .query('consentRecords')
      .withIndex('by_user', (q) => q.eq('userId', auth.user._id))
      .collect();
    return rows.sort((a, b) => b.grantedAt - a.grantedAt);
  },
});

export const grantConsent = mutation({
  args: {
    token: v.string(),
    purpose: v.union(v.literal('ai_screening'), v.literal('demographic_analysis'), v.literal('marketing')),
  },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const id = await ctx.db.insert('consentRecords', {
      userId: auth.user._id,
      purpose: args.purpose,
      version: '2026-02-v1',
      grantedAt: Date.now(),
    });
    return await ctx.db.get(id);
  },
});

export const withdrawConsent = mutation({
  args: { token: v.string(), id: v.id('consentRecords') },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const record = await ctx.db.get(args.id);
    if (record && record.userId === auth.user._id) {
      await ctx.db.patch(record._id, { withdrawnAt: Date.now() });
    }
    return { ok: true };
  },
});

export const dataRequests = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const rows = await ctx.db
      .query('dataRequests')
      .withIndex('by_user', (q) => q.eq('userId', auth.user._id))
      .collect();
    return rows.sort((a, b) => b.requestedAt - a.requestedAt);
  },
});

export const requestDeletion = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const now = Date.now();
    const id = await ctx.db.insert('dataRequests', {
      userId: auth.user._id,
      type: 'DELETE',
      status: 'PENDING',
      requestedAt: now,
    });
    const admins = await ctx.db
      .query('users')
      .withIndex('by_role', (q) => q.eq('role', 'ADMIN'))
      .collect();
    for (const admin of admins.filter((a) => a.isActive)) {
      await notify(ctx, {
        userId: admin._id,
        type: 'SYSTEM',
        title: 'Data deletion request',
        body: `A candidate requested account deletion (request ${id}). Review and process it in Admin → Data requests.`,
        data: { dataRequestId: id },
      });
    }
    await writeAudit(ctx, { id: auth.user._id, role: auth.role }, 'DATA_DELETION_REQUESTED', 'DataRequest', id);
    const record = await ctx.db.get(id);
    return record;
  },
});

export const dashboard = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const applications = await ctx.db
      .query('applications')
      .withIndex('by_candidate', (q) => q.eq('candidateId', auth.user._id))
      .collect();
    const recent = applications.sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
    const jobs = new Map(
      (
        await Promise.all(recent.map(async (a) => await ctx.db.get(a.jobId)))
      )
        .filter(Boolean)
        .map((job) => [job!._id, job!]),
    );
    const applicationItems = await Promise.all(
      recent.map(async (a) => {
        const job = jobs.get(a.jobId);
        const organisation = job ? await ctx.db.get(job.organisationId) : null;
        return {
          id: a._id,
          stage: a.stage,
          score: a.score ?? null,
          createdAt: a.createdAt,
          job: job
            ? { id: job._id, title: job.title, organisation: organisation ? { name: organisation.name } : null }
            : null,
        };
      }),
    );

    const interviews = await ctx.db
      .query('interviews')
      .withIndex('by_status', (q) => q.eq('status', 'SCHEDULED'))
      .collect();
    const upcoming = [];
    for (const interview of interviews) {
      const application = await ctx.db.get(interview.applicationId);
      if (!application || application.candidateId !== auth.user._id) continue;
      const slot = await ctx.db.get(interview.slotId);
      if (!slot || slot.startsAt < Date.now()) continue;
      const job = await ctx.db.get(application.jobId);
      upcoming.push({
        ...interview,
        id: interview._id,
        slot,
        application: { ...application, id: application._id, job: job ? { title: job.title } : null },
      });
    }
    upcoming.sort((a, b) => a.slot.startsAt - b.slot.startsAt);

    const unread = await ctx.db
      .query('notifications')
      .withIndex('by_user', (q) => q.eq('userId', auth.user._id))
      .collect();
    const profile = await ctx.db
      .query('candidateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', auth.user._id))
      .unique();

    return {
      applications: applicationItems,
      upcomingInterviews: upcoming.slice(0, 3),
      unreadNotifications: unread.filter((n) => !n.readAt).length,
      totalApplications: applications.length,
      profileComplete: Boolean(profile?.headline && profile?.location),
    };
  },
});

export const applicationsCount = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const rows = await ctx.db
      .query('applications')
      .withIndex('by_candidate', (q) => q.eq('candidateId', auth.user._id))
      .collect();
    return { count: rows.length };
  },
});
