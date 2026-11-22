import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { fail, requireUser } from '../shared/authz';
import { getAuditSettings, notify, paginate, pagination, setSetting, writeAudit } from '../shared/shared';
import { sha256Hex } from '../shared/crypto';

function requireAdmin(role: string) {
  if (role !== 'ADMIN') fail('FORBIDDEN', 'Administrators only.');
}

export const dashboard = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    requireAdmin(auth.role);

    const organisations = await ctx.db.query('organisations').collect();
    const users = await ctx.db.query('users').collect();
    const jobs = await ctx.db.query('jobs').collect();
    const applications = await ctx.db.query('applications').collect();
    const interviews = await ctx.db.query('interviews').collect();
    const reports = await ctx.db.query('biasReports').collect();
    const logs = await ctx.db.query('auditLogs').collect();
    const requests = await ctx.db.query('dataRequests').collect();

    const recentLogs = [];
    for (const log of logs.sort((a, b) => b.createdAt - a.createdAt).slice(0, 12)) {
      const actor = log.actorId ? await ctx.db.get(log.actorId) : null;
      recentLogs.push({
        id: log._id,
        action: log.action,
        entityType: log.entityType,
        actorRole: log.actorRole,
        createdAt: log.createdAt,
        actor: actor ? { fullName: actor.fullName } : null,
      });
    }

    const byRole: Record<string, number> = {};
    for (const user of users.filter((u) => !u.deletedAt)) byRole[user.role] = (byRole[user.role] ?? 0) + 1;

    return {
      organisations: organisations.length,
      users: users.filter((u) => u.isActive && !u.deletedAt).length,
      jobs: jobs.length,
      applications: applications.length,
      interviews: interviews.filter((i) => i.status === 'SCHEDULED').length,
      reports: reports.length,
      flaggedReports: reports.filter((r) => r.flagCount > 0).length,
      pendingDataRequests: requests.filter((r) => r.status === 'PENDING').length,
      byRole,
      recentLogs,
    };
  },
});

export const organisations = query({
  args: { token: v.string(), page: v.optional(v.number()), pageSize: v.optional(v.number()), search: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    requireAdmin(auth.role);
    const { page, pageSize, skip } = pagination(args);
    const search = args.search?.trim().toLowerCase();
    const rows = (await ctx.db.query('organisations').collect())
      .filter((org) => (search ? org.name.toLowerCase().includes(search) : true))
      .sort((a, b) => b.createdAt - a.createdAt);
    const items = [];
    for (const org of rows.slice(skip, skip + pageSize)) {
      const users = await ctx.db
        .query('users')
        .withIndex('by_organisation', (q) => q.eq('organisationId', org._id))
        .collect();
      const jobs = await ctx.db
        .query('jobs')
        .withIndex('by_organisation_status', (q) => q.eq('organisationId', org._id))
        .collect();
      items.push({ ...org, id: org._id, _count: { users: users.length, jobs: jobs.length } });
    }
    return paginate(items, rows.length, page, pageSize);
  },
});

export const createOrganisation = mutation({
  args: { token: v.string(), name: v.string(), sector: v.optional(v.string()), website: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    requireAdmin(auth.role);
    if (args.name.trim().length < 2) fail('BAD_REQUEST', 'Enter an organisation name.');
    if (args.website && !/^https?:\/\//.test(args.website)) fail('BAD_REQUEST', 'Enter a full URL, including https://');
    const base = args.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'organisation';
    const slug = `${base}-${Math.random().toString(36).slice(2, 6)}`.slice(0, 80);
    const now = Date.now();
    const id = await ctx.db.insert('organisations', {
      name: args.name.trim(),
      slug,
      sector: args.sector?.trim(),
      website: args.website?.trim(),
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, { id: auth.user._id, role: auth.role }, 'ORGANISATION_CREATED', 'Organisation', id);
    return await ctx.db.get(id);
  },
});

export const updateOrganisation = mutation({
  args: {
    token: v.string(),
    id: v.id('organisations'),
    name: v.optional(v.string()),
    sector: v.optional(v.union(v.string(), v.null())),
    website: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    requireAdmin(auth.role);
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.name !== undefined) patch.name = args.name;
    if (args.sector !== undefined) patch.sector = args.sector ?? undefined;
    if (args.website !== undefined) patch.website = args.website ?? undefined;
    await ctx.db.patch(args.id, patch);
    await writeAudit(ctx, { id: auth.user._id, role: auth.role }, 'ORGANISATION_UPDATED', 'Organisation', args.id, {
      fields: Object.keys(patch),
    });
    return await ctx.db.get(args.id);
  },
});

export const users = query({
  args: {
    token: v.string(),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    role: v.optional(v.string()),
    search: v.optional(v.string()),
    organisationId: v.optional(v.id('organisations')),
  },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    requireAdmin(auth.role);
    const { page, pageSize, skip } = pagination(args);
    const search = args.search?.trim().toLowerCase();
    const rows = (await ctx.db.query('users').collect())
      .filter((user) => !user.deletedAt)
      .filter((user) => (args.role ? user.role === args.role : true))
      .filter((user) => (args.organisationId ? user.organisationId === args.organisationId : true))
      .filter((user) =>
        search ? user.fullName.toLowerCase().includes(search) || user.email.toLowerCase().includes(search) : true,
      )
      .sort((a, b) => b.createdAt - a.createdAt);

    const items = [];
    for (const user of rows.slice(skip, skip + pageSize)) {
      const organisation = user.organisationId ? await ctx.db.get(user.organisationId) : null;
      const applications = await ctx.db
        .query('applications')
        .withIndex('by_candidate', (q) => q.eq('candidateId', user._id))
        .collect();
      items.push({
        id: user._id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        isActive: user.isActive,
        emailVerifiedAt: user.emailVerifiedAt ?? null,
        lastLoginAt: user.lastLoginAt ?? null,
        createdAt: user.createdAt,
        organisation: organisation ? { id: organisation._id, name: organisation.name } : null,
        _count: { applications: applications.length },
      });
    }
    return paginate(items, rows.length, page, pageSize);
  },
});

export const createUser = mutation({
  args: {
    token: v.string(),
    email: v.string(),
    fullName: v.string(),
    role: v.union(v.literal('CANDIDATE'), v.literal('RECRUITER'), v.literal('ADMIN')),
    organisationId: v.optional(v.union(v.id('organisations'), v.null())),
  },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    requireAdmin(auth.role);
    const email = args.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('BAD_REQUEST', 'Enter a valid email address.');
    if (args.role === 'RECRUITER' && !args.organisationId) {
      fail('BAD_REQUEST', 'A recruiter must belong to an organisation.');
    }
    const existing = await ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', email))
      .unique();
    if (existing) fail('CONFLICT', 'That email is already registered.');

    const now = Date.now();
    // Unusable password; the user receives a reset link before they can sign in.
    const unusable = `!reset-${sha256Hex(`${email}:${now}:${Math.random()}`)}`;
    const userId = await ctx.db.insert('users', {
      email,
      fullName: args.fullName.trim(),
      role: args.role,
      organisationId: args.organisationId ?? undefined,
      passwordHash: unusable,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    if (args.role === 'CANDIDATE') {
      await ctx.db.insert('candidateProfiles', { userId, createdAt: now, updatedAt: now });
    }
    await ctx.db.insert('notificationPreferences', {
      userId,
      email: true,
      sms: false,
      whatsapp: false,
      inApp: true,
      updatedAt: now,
    });
    await ctx.db.insert('emailTokens', {
      userId,
      type: 'RESET_PASSWORD',
      tokenHash: sha256Hex(`reset-${userId}-${now}`),
      expiresAt: now + 60 * 60_000,
      createdAt: now,
    });
    await writeAudit(ctx, { id: auth.user._id, role: auth.role }, 'USER_CREATED_BY_ADMIN', 'User', userId, {
      role: args.role,
    });
    return { id: userId, email, role: args.role };
  },
});

export const updateUser = mutation({
  args: {
    token: v.string(),
    id: v.id('users'),
    role: v.optional(v.union(v.literal('CANDIDATE'), v.literal('RECRUITER'), v.literal('ADMIN'))),
    isActive: v.optional(v.boolean()),
    organisationId: v.optional(v.union(v.id('organisations'), v.null())),
  },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    requireAdmin(auth.role);
    if (args.id === auth.user._id && args.isActive === false) fail('BAD_REQUEST', 'You cannot deactivate your own account.');

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.role !== undefined) patch.role = args.role;
    if (args.isActive !== undefined) patch.isActive = args.isActive;
    if (args.organisationId !== undefined) patch.organisationId = args.organisationId ?? undefined;
    await ctx.db.patch(args.id, patch);

    if (args.isActive === false) {
      const sessions = await ctx.db
        .query('sessions')
        .withIndex('by_user', (q) => q.eq('userId', args.id))
        .collect();
      for (const session of sessions.filter((s) => !s.revokedAt)) {
        await ctx.db.patch(session._id, { revokedAt: Date.now() });
      }
    }
    await writeAudit(ctx, { id: auth.user._id, role: auth.role }, 'USER_UPDATED', 'User', args.id, {
      fields: Object.keys(patch),
      isActive: args.isActive,
    });
    const user = await ctx.db.get(args.id);
    return { id: args.id, role: user?.role, isActive: user?.isActive };
  },
});

export const settings = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    requireAdmin(auth.role);
    return await getAuditSettings(ctx);
  },
});

export const updateSettings = mutation({
  args: {
    token: v.string(),
    minGroupSize: v.optional(v.number()),
    threshold: v.optional(v.number()),
    counterfactualThreshold: v.optional(v.number()),
    retentionDays: v.optional(v.number()),
    blindScreeningDefault: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    requireAdmin(auth.role);
    if (args.minGroupSize !== undefined && (args.minGroupSize < 2 || args.minGroupSize > 100)) {
      fail('BAD_REQUEST', 'Minimum group size must be between 2 and 100.');
    }
    if (args.threshold !== undefined && (args.threshold < 0.1 || args.threshold > 1)) {
      fail('BAD_REQUEST', 'The threshold must be between 0.1 and 1.');
    }
    const patch = {
      minGroupSize: args.minGroupSize,
      threshold: args.threshold,
      counterfactualThreshold: args.counterfactualThreshold,
      retentionDays: args.retentionDays,
      blindScreeningDefault: args.blindScreeningDefault,
    };
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) await setSetting(ctx, `audit.${key}`, value);
    }
    await writeAudit(ctx, { id: auth.user._id, role: auth.role }, 'SETTINGS_UPDATED', 'Setting', 'audit', patch);
    return await getAuditSettings(ctx);
  },
});

export const auditLogs = query({
  args: {
    token: v.string(),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    action: v.optional(v.string()),
    entityType: v.optional(v.string()),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    requireAdmin(auth.role);
    const { page, pageSize, skip } = pagination(args);
    const action = args.action?.trim().toLowerCase();
    const rows = (await ctx.db.query('auditLogs').collect())
      .filter((log) => (action ? log.action.toLowerCase().includes(action) : true))
      .filter((log) => (args.entityType ? log.entityType === args.entityType : true))
      .filter((log) => (args.from ? log.createdAt >= args.from : true))
      .filter((log) => (args.to ? log.createdAt <= args.to : true))
      .sort((a, b) => b.createdAt - a.createdAt);

    const items = [];
    for (const log of rows.slice(skip, skip + pageSize)) {
      const actor = log.actorId ? await ctx.db.get(log.actorId) : null;
      items.push({
        ...log,
        id: log._id,
        actor: actor ? { fullName: actor.fullName, email: actor.email } : null,
      });
    }
    return paginate(items, rows.length, page, pageSize);
  },
});

export const exportAuditLogs = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    requireAdmin(auth.role);
    const logs = (await ctx.db.query('auditLogs').collect()).sort((a, b) => b.createdAt - a.createdAt).slice(0, 10_000);
    const rows = [];
    for (const log of logs) {
      const actor = log.actorId ? await ctx.db.get(log.actorId) : null;
      rows.push({
        id: log._id,
        createdAt: new Date(log.createdAt).toISOString(),
        actorRole: log.actorRole,
        actorEmail: actor?.email ?? '',
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        ip: log.ip ?? '',
        metadata: JSON.stringify(log.metadata),
      });
    }
    await writeAudit(ctx, { id: auth.user._id, role: auth.role }, 'AUDIT_LOG_EXPORTED', 'AuditLog', 'all', {
      rows: rows.length,
    });
    const header = ['id', 'createdAt', 'actorRole', 'actorEmail', 'action', 'entityType', 'entityId', 'ip', 'metadata'];
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const csv = [header.join(','), ...rows.map((row) => header.map((key) => escape(String((row as never)[key]))).join(','))].join(
      '\n',
    );
    return { csv, count: rows.length };
  },
});

export const dataRequests = query({
  args: { token: v.string(), page: v.optional(v.number()), pageSize: v.optional(v.number()), status: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    requireAdmin(auth.role);
    const { page, pageSize, skip } = pagination(args);
    const rows = (await ctx.db.query('dataRequests').collect())
      .filter((request) => (args.status ? request.status === args.status : true))
      .sort((a, b) => b.requestedAt - a.requestedAt);
    const items = [];
    for (const request of rows.slice(skip, skip + pageSize)) {
      const user = await ctx.db.get(request.userId);
      items.push({
        ...request,
        id: request._id,
        user: user ? { id: user._id, email: user.email, fullName: user.fullName, role: user.role } : null,
      });
    }
    return paginate(items, rows.length, page, pageSize);
  },
});

export const completeDataRequest = mutation({
  args: { token: v.string(), id: v.id('dataRequests'), action: v.union(v.literal('COMPLETE'), v.literal('REJECT')) },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    requireAdmin(auth.role);
    const request = await ctx.db.get(args.id);
    if (!request) fail('NOT_FOUND', 'Request not found');
    if (request.status !== 'PENDING') fail('BAD_REQUEST', 'This request has already been handled.');

    if (args.action === 'REJECT') {
      await ctx.db.patch(request._id, {
        status: 'REJECTED',
        completedAt: Date.now(),
        note: 'Rejected by administrator',
      });
      await writeAudit(ctx, { id: auth.user._id, role: auth.role }, 'DATA_REQUEST_REJECTED', 'DataRequest', request._id);
      return { ok: true };
    }

    if (request.type === 'DELETE') {
      const cvFiles = await ctx.db
        .query('cvFiles')
        .withIndex('by_candidate', (q) => q.eq('candidateId', request.userId))
        .collect();
      for (const file of cvFiles) {
        if (file.storageId) await ctx.storage.delete(file.storageId);
        await ctx.db.delete(file._id);
      }
      const applications = await ctx.db
        .query('applications')
        .withIndex('by_candidate', (q) => q.eq('candidateId', request.userId))
        .collect();
      for (const application of applications) {
        const parsed = await ctx.db
          .query('parsedCvs')
          .withIndex('by_application', (q) => q.eq('applicationId', application._id))
          .unique();
        if (parsed) await ctx.db.delete(parsed._id);
      }
      const declarations = await ctx.db
        .query('demographicDeclarations')
        .withIndex('by_user', (q) => q.eq('userId', request.userId))
        .collect();
      for (const declaration of declarations) await ctx.db.delete(declaration._id);
      const profiles = await ctx.db
        .query('candidateProfiles')
        .withIndex('by_user', (q) => q.eq('userId', request.userId))
        .collect();
      for (const profile of profiles) await ctx.db.delete(profile._id);
      const notifications = await ctx.db
        .query('notifications')
        .withIndex('by_user', (q) => q.eq('userId', request.userId))
        .collect();
      for (const notification of notifications) await ctx.db.delete(notification._id);
      const sessions = await ctx.db
        .query('sessions')
        .withIndex('by_user', (q) => q.eq('userId', request.userId))
        .collect();
      for (const session of sessions) await ctx.db.patch(session._id, { revokedAt: Date.now() });
      await ctx.db.patch(request.userId, {
        email: `deleted-${request.userId}@ise.invalid`,
        fullName: 'Deleted account',
        phone: undefined,
        passwordHash: `!deleted-${Date.now()}`,
        isActive: false,
        deletedAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.patch(request._id, {
        status: 'COMPLETED',
        completedAt: Date.now(),
        note: 'Personal data erased',
      });
      await writeAudit(ctx, { id: auth.user._id, role: auth.role }, 'DATA_ERASED', 'DataRequest', request._id, {
        userId: request.userId,
        cvFiles: cvFiles.length,
      });
      return { ok: true, erased: true };
    }

    await ctx.db.patch(request._id, { status: 'COMPLETED', completedAt: Date.now() });
    await notify(ctx, {
      userId: request.userId,
      type: 'SYSTEM',
      title: 'Your data request is complete',
      body: 'Your data export is ready from your privacy page.',
    });
    await writeAudit(ctx, { id: auth.user._id, role: auth.role }, 'DATA_REQUEST_COMPLETED', 'DataRequest', request._id);
    return { ok: true };
  },
});
