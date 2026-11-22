import { action, internalMutation, internalQuery, mutation, query } from './_generated/server';
import { internalRefs } from '../shared/refs';
import { v } from 'convex/values';
import bcrypt from 'bcryptjs';
import { fail, publicUser, requireUser, SESSION_DAYS } from '../shared/authz';
import { writeAudit } from '../shared/shared';
import { sha256Hex } from '../shared/crypto';
import type { Id } from './_generated/dataModel';

function randomToken(bytes: number) {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return [...array].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function sessionExpiry() {
  return Date.now() + SESSION_DAYS * 24 * 3600_000;
}

// ---------------------------------------------------------------------------
// Internal building blocks
// ---------------------------------------------------------------------------

export const findByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', args.email))
      .unique();
  },
});

export const createSession = internalMutation({
  args: { userId: v.id('users'), tokenHash: v.string(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert('sessions', {
      userId: args.userId,
      tokenHash: args.tokenHash,
      expiresAt: args.expiresAt,
      createdAt: Date.now(),
    });
    return id;
  },
});

export const createAccount = internalMutation({
  args: {
    email: v.string(),
    passwordHash: v.string(),
    fullName: v.string(),
    role: v.union(v.literal('CANDIDATE'), v.literal('RECRUITER')),
    phone: v.optional(v.string()),
    organisationName: v.optional(v.string()),
    sector: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', args.email))
      .unique();
    if (existing) fail('CONFLICT', 'An account with that email already exists. Try signing in.');

    let organisationId: Id<'organisations'> | undefined;
    if (args.role === 'RECRUITER' && args.organisationName) {
      const base = slugify(args.organisationName) || 'organisation';
      let slug = base;
      let attempt = 1;
      while (
        await ctx.db
          .query('organisations')
          .withIndex('by_slug', (q) => q.eq('slug', slug))
          .unique()
      ) {
        slug = `${base}-${attempt}`;
        attempt += 1;
      }
      organisationId = await ctx.db.insert('organisations', {
        name: args.organisationName,
        slug,
        sector: args.sector,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    const now = Date.now();
    const userId = await ctx.db.insert('users', {
      email: args.email,
      passwordHash: args.passwordHash,
      fullName: args.fullName,
      role: args.role,
      phone: args.phone,
      organisationId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    if (args.role === 'CANDIDATE') {
      await ctx.db.insert('candidateProfiles', { userId, createdAt: now, updatedAt: now });
    }
    await ctx.db.insert('consentRecords', {
      userId,
      purpose: 'ai_screening',
      version: '2026-02-v1',
      grantedAt: now,
    });
    await ctx.db.insert('notificationPreferences', {
      userId,
      email: true,
      sms: false,
      whatsapp: false,
      inApp: true,
      updatedAt: now,
    });
    await writeAudit(ctx, { id: userId, role: args.role }, 'USER_REGISTERED', 'User', userId, { role: args.role });
    return userId;
  },
});

export const markLogin = internalMutation({
  args: { userId: v.id('users') },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { lastLoginAt: Date.now(), updatedAt: Date.now() });
  },
});

// ---------------------------------------------------------------------------
// Public actions / functions
// ---------------------------------------------------------------------------

export const register = action({
  args: {
    fullName: v.string(),
    email: v.string(),
    password: v.string(),
    role: v.union(v.literal('CANDIDATE'), v.literal('RECRUITER')),
    phone: v.optional(v.string()),
    organisationName: v.optional(v.string()),
    sector: v.optional(v.string()),
    acceptedAiNotice: v.boolean(),
  },
  handler: async (ctx, args) => {
    if (!args.acceptedAiNotice) fail('BAD_REQUEST', 'You must accept the AI-use notice to create an account.');
    const fullName = args.fullName.trim();
    if (fullName.length < 2) fail('BAD_REQUEST', 'Enter your full name.');
    const email = args.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('BAD_REQUEST', 'Enter a valid email address.');
    if (args.password.length < 10 || !/[a-zA-Z]/.test(args.password) || !/\d/.test(args.password)) {
      fail('BAD_REQUEST', 'Use at least 10 characters, including a letter and a number.');
    }
    if (args.role === 'RECRUITER' && !args.organisationName?.trim()) {
      fail('BAD_REQUEST', 'Tell us the organisation you recruit for.');
    }

    const passwordHash = await bcrypt.hash(args.password, 10);
    const userId = await ctx.runMutation(internalRefs.auth.createAccount, {
      email,
      passwordHash,
      fullName,
      role: args.role,
      phone: args.phone?.trim() || undefined,
      organisationName: args.organisationName?.trim(),
      sector: args.sector?.trim(),
    });

    const token = randomToken(48);
    await ctx.runMutation(internalRefs.auth.createSession, {
      userId,
      tokenHash: sha256Hex(token),
      expiresAt: sessionExpiry(),
    });
    await ctx.runMutation(internalRefs.auth.issueEmailToken, { userId, type: 'VERIFY_EMAIL' });

    const user = await ctx.runQuery(internalRefs.auth.getUserById, { userId });
    return { user: publicUser(user!), accessToken: token };
  },
});

export const login = action({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const user = await ctx.runQuery(internalRefs.auth.findByEmail, { email });
    let valid = false;
    if (user) {
      try {
        valid = await bcrypt.compare(args.password, user.passwordHash);
      } catch {
        // Accounts created by an administrator have no usable password yet.
        valid = false;
      }
    }
    if (!user || !valid || !user.isActive || user.deletedAt) {
      fail('UNAUTHORIZED', 'Email or password is incorrect');
    }
    const token = randomToken(48);
    await ctx.runMutation(internalRefs.auth.createSession, {
      userId: user._id,
      tokenHash: sha256Hex(token),
      expiresAt: sessionExpiry(),
    });
    await ctx.runMutation(internalRefs.auth.markLogin, { userId: user._id });
    await ctx.runMutation(internalRefs.auth.logLogin, { userId: user._id });
    return { user: publicUser(user), accessToken: token };
  },
});

export const getUserById = internalQuery({
  args: { userId: v.id('users') },
  handler: async (ctx, args) => await ctx.db.get(args.userId),
});

export const logLogin = internalMutation({
  args: { userId: v.id('users') },
  handler: async (ctx, args) => {
    await writeAudit(ctx, { id: args.userId, role: 'USER' }, 'USER_LOGIN', 'User', args.userId);
  },
});

export const logout = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query('sessions')
      .withIndex('by_token', (q) => q.eq('tokenHash', sha256Hex(args.token)))
      .unique();
    if (session) await ctx.db.patch(session._id, { revokedAt: Date.now() });
    return { ok: true };
  },
});

export const me = query({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const user = auth.user;
    const organisation = user.organisationId ? await ctx.db.get(user.organisationId) : null;
    const profile = await ctx.db
      .query('candidateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .unique();
    const prefs = await ctx.db
      .query('notificationPreferences')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .unique();
    return {
      user: {
        ...publicUser(user),
        organisation: organisation
          ? { id: organisation._id, name: organisation.name, slug: organisation.slug }
          : null,
        profile,
      },
      preferences: prefs
        ? { email: prefs.email, sms: prefs.sms, whatsapp: prefs.whatsapp, inApp: prefs.inApp }
        : { email: true, sms: false, whatsapp: false, inApp: true },
    };
  },
});

export const updateMe = mutation({
  args: { token: v.string(), fullName: v.optional(v.string()), phone: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.fullName !== undefined) {
      if (args.fullName.trim().length < 2) fail('BAD_REQUEST', 'Enter your full name.');
      patch.fullName = args.fullName.trim();
    }
    if (args.phone !== undefined) patch.phone = args.phone ?? undefined;
    await ctx.db.patch(auth.user._id, patch);
    const user = await ctx.db.get(auth.user._id);
    return { user: publicUser(user!) };
  },
});

export const issueEmailToken = internalMutation({
  args: {
    userId: v.id('users'),
    type: v.union(v.literal('VERIFY_EMAIL'), v.literal('RESET_PASSWORD')),
  },
  handler: async (ctx, args) => {
    const raw = randomToken(32);
    const ttlMinutes = args.type === 'RESET_PASSWORD' ? 60 : 24 * 60;
    await ctx.db.insert('emailTokens', {
      userId: args.userId,
      type: args.type,
      tokenHash: sha256Hex(raw),
      expiresAt: Date.now() + ttlMinutes * 60_000,
      createdAt: Date.now(),
    });
    const user = await ctx.db.get(args.userId);
    if (user) {
      await ctx.db.insert('auditLogs', {
        actorId: user._id,
        actorRole: 'SYSTEM',
        action: args.type === 'VERIFY_EMAIL' ? 'VERIFICATION_EMAIL_QUEUED' : 'PASSWORD_RESET_QUEUED',
        entityType: 'User',
        entityId: user._id,
        metadata: { email: user.email },
        createdAt: Date.now(),
      });
    }
    return { ok: true };
  },
});

export const consumeEmailToken = internalMutation({
  args: {
    token: v.string(),
    type: v.union(v.literal('VERIFY_EMAIL'), v.literal('RESET_PASSWORD')),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query('emailTokens')
      .withIndex('by_token', (q) => q.eq('tokenHash', sha256Hex(args.token)))
      .unique();
    if (!record || record.type !== args.type || record.usedAt || record.expiresAt < Date.now()) return null;
    await ctx.db.patch(record._id, { usedAt: Date.now() });
    return record;
  },
});

export const verifyEmail = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const record: { userId: Id<'users'> } | null = await ctx.runMutation(internalRefs.auth.consumeEmailToken, {
      token: args.token,
      type: 'VERIFY_EMAIL',
    });
    if (!record) fail('BAD_REQUEST', 'This verification link is invalid or has expired.');
    await ctx.db.patch(record.userId, { emailVerifiedAt: Date.now(), updatedAt: Date.now() });
    const user = await ctx.db.get(record.userId);
    await writeAudit(ctx, { id: record.userId, role: 'USER' }, 'EMAIL_VERIFIED', 'User', record.userId);
    return { user: publicUser(user!) };
  },
});

export const resendVerification = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    if (auth.user.emailVerifiedAt) return { ok: true, alreadyVerified: true };
    await ctx.runMutation(internalRefs.auth.issueEmailToken, { userId: auth.user._id, type: 'VERIFY_EMAIL' });
    return { ok: true };
  },
});

export const forgotPassword = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const user = await ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', email))
      .unique();
    if (user && user.isActive) {
      await ctx.runMutation(internalRefs.auth.issueEmailToken, { userId: user._id, type: 'RESET_PASSWORD' });
    }
    return { ok: true };
  },
});

export const resetPassword = action({
  args: { token: v.string(), password: v.string() },
  handler: async (ctx, args) => {
    if (args.password.length < 10 || !/[a-zA-Z]/.test(args.password) || !/\d/.test(args.password)) {
      fail('BAD_REQUEST', 'Use at least 10 characters, including a letter and a number.');
    }
    const record = await ctx.runMutation(internalRefs.auth.consumeEmailToken, {
      token: args.token,
      type: 'RESET_PASSWORD',
    });
    if (!record) fail('BAD_REQUEST', 'This reset link is invalid or has expired.');
    const passwordHash = await bcrypt.hash(args.password, 10);
    await ctx.runMutation(internalRefs.auth.applyPasswordReset, {
      userId: record.userId,
      passwordHash,
    });
    return { ok: true };
  },
});

export const applyPasswordReset = internalMutation({
  args: { userId: v.id('users'), passwordHash: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { passwordHash: args.passwordHash, updatedAt: Date.now() });
    const sessions = await ctx.db
      .query('sessions')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .collect();
    for (const session of sessions) {
      if (!session.revokedAt) await ctx.db.patch(session._id, { revokedAt: Date.now() });
    }
    await ctx.db.insert('notifications', {
      userId: args.userId,
      type: 'SYSTEM',
      title: 'Password changed',
      body: 'Your password was reset. If this was not you, contact support immediately.',
      data: {},
      createdAt: Date.now(),
    });
    await writeAudit(ctx, { id: args.userId, role: 'USER' }, 'PASSWORD_RESET', 'User', args.userId);
  },
});

export const sessions = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const rows = await ctx.db
      .query('sessions')
      .withIndex('by_user', (q) => q.eq('userId', auth.user._id))
      .collect();
    return rows
      .filter((s) => !s.revokedAt && s.expiresAt > Date.now())
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((s) => ({
        id: s._id,
        createdAt: s.createdAt,
        userAgent: s.userAgent ?? null,
        expiresAt: s.expiresAt,
        current: s._id === auth.sessionId,
      }));
  },
});

export const revokeSession = mutation({
  args: { token: v.string(), id: v.id('sessions') },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const session = await ctx.db.get(args.id);
    if (session && session.userId === auth.user._id) {
      await ctx.db.patch(session._id, { revokedAt: Date.now() });
    }
    return { ok: true };
  },
});
