import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import type { Role } from '@prisma/client';
import { prisma } from '../db.js';
import { asyncHandler } from '../lib/async.js';
import { ApiError } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/crypto.js';
import { validate } from '../lib/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { writeAudit } from '../middleware/audit.js';
import {
  consumeEmailToken,
  issueEmailToken,
  issueSession,
  publicUser,
  revokeAllSessions,
  revokeSession,
  rotateSession,
  REFRESH_COOKIE,
} from '../services/auth-tokens.js';
import { notify } from '../services/notifications.js';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a few minutes.' } },
});

const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128)
  .regex(/[a-zA-Z]/, 'Include a letter')
  .regex(/\d/, 'Include a number');

const registerSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email().toLowerCase(),
  password: passwordSchema,
  phone: z.string().max(30).optional(),
  role: z.enum(['CANDIDATE', 'RECRUITER']),
  organisationName: z.string().min(2).max(160).optional(),
  sector: z.string().max(80).optional(),
  acceptedAiNotice: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the AI-use notice to create an account' }),
  }),
});

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

// Register either a candidate or a recruiter (who creates an organisation).
router.post(
  '/register',
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = validate(registerSchema, req.body);

    if (input.role === 'RECRUITER' && !input.organisationName) {
      throw ApiError.badRequest('Tell us the organisation you recruit for.');
    }

    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw ApiError.conflict('An account with that email already exists. Try signing in.');

    const passwordHash = await hashPassword(input.password);

    const user = await prisma.$transaction(async (tx) => {
      let organisationId: string | null = null;
      if (input.role === 'RECRUITER' && input.organisationName) {
        const base = slugify(input.organisationName) || 'organisation';
        let slug = base;
        let attempt = 1;
        while (await tx.organisation.findUnique({ where: { slug } })) {
          slug = `${base}-${attempt}`;
          attempt += 1;
        }
        const org = await tx.organisation.create({
          data: { name: input.organisationName, slug, sector: input.sector },
        });
        organisationId = org.id;
      }

      const created = await tx.user.create({
        data: {
          email: input.email,
          fullName: input.fullName,
          passwordHash,
          phone: input.phone,
          role: input.role as Role,
          organisationId,
          ...(input.role === 'CANDIDATE' ? { candidateProfile: { create: {} } } : {}),
        },
      });

      await tx.consentRecord.create({
        data: {
          userId: created.id,
          purpose: 'ai_screening',
          version: '2026-02-v1',
          ip: req.ip,
        },
      });
      await tx.notificationPreference.create({ data: { userId: created.id } });
      return created;
    });

    await issueEmailToken(user, 'VERIFY_EMAIL');
    const accessToken = await issueSession(user, req, res);
    await writeAudit(req, 'USER_REGISTERED', 'User', user.id, { role: user.role });

    res.status(201).json({
      data: { user: publicUser(user), accessToken },
      message: 'Account created. Check your email to verify your address.',
    });
  }),
);

const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

router.post(
  '/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = validate(loginSchema, req.body);
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    // Constant-ish response: never reveal whether the email exists.
    const valid = user ? await verifyPassword(input.password, user.passwordHash) : false;
    if (!user || !valid || !user.isActive || user.deletedAt) {
      throw ApiError.unauthorized('Email or password is incorrect');
    }
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const accessToken = await issueSession(user, req, res);
    await writeAudit(req, 'USER_LOGIN', 'User', user.id);
    res.json({ data: { user: publicUser(user), accessToken } });
  }),
);

// Requires the custom header to defeat cross-site form submissions. The refresh
// cookie is httpOnly + SameSite=Lax and scoped to /api/auth.
function assertNotCsrf(req: { headers: Record<string, unknown> }) {
  if (req.headers['x-ise-request'] !== 'web') {
    throw ApiError.forbidden('Missing request header');
  }
}

router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    assertNotCsrf(req);
    const session = await rotateSession(req, res);
    if (!session) throw ApiError.unauthorized('Session expired — sign in again');
    res.json({ data: session });
  }),
);

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    assertNotCsrf(req);
    await revokeSession(req, res);
    res.json({ data: { ok: true } });
  }),
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        organisationId: true,
        emailVerifiedAt: true,
        phone: true,
        organisation: { select: { id: true, name: true, slug: true } },
        candidateProfile: true,
      },
    });
    if (!user) throw ApiError.notFound('Account not found');
    const prefs = await prisma.notificationPreference.findUnique({ where: { userId: user.id } });
    res.json({
      data: {
        user: { ...publicUser(user as never), organisation: user.organisation, profile: user.candidateProfile },
        preferences: prefs ?? { email: true, sms: false, whatsapp: false, inApp: true },
      },
    });
  }),
);

const updateMeSchema = z.object({
  fullName: z.string().min(2).max(120).optional(),
  phone: z.string().max(30).nullable().optional(),
});

router.patch(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = validate(updateMeSchema, req.body);
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { fullName: input.fullName, phone: input.phone === null ? null : input.phone },
    });
    res.json({ data: { user: publicUser(user) } });
  }),
);

router.post(
  '/verify-email',
  asyncHandler(async (req, res) => {
    const { token } = validate(z.object({ token: z.string().min(20) }), req.body);
    const record = await consumeEmailToken(token, 'VERIFY_EMAIL');
    if (!record) throw ApiError.badRequest('This verification link is invalid or has expired.');
    const user = await prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } });
    await writeAudit(req, 'EMAIL_VERIFIED', 'User', user.id);
    if (req.user?.id !== user.id) {
      // No session: sign the user straight in after verifying.
      const accessToken = await issueSession(user, req, res);
      return res.json({ data: { user: publicUser(user), accessToken } });
    }
    res.json({ data: { user: publicUser(user) } });
  }),
);

router.post(
  '/resend-verification',
  authLimiter,
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw ApiError.notFound();
    if (user.emailVerifiedAt) return res.json({ data: { ok: true, alreadyVerified: true } });
    await issueEmailToken(user, 'VERIFY_EMAIL');
    res.json({ data: { ok: true } });
  }),
);

router.post(
  '/forgot-password',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { email } = validate(z.object({ email: z.string().email().toLowerCase() }), req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && user.isActive) await issueEmailToken(user, 'RESET_PASSWORD');
    // Always the same response: no account enumeration.
    res.json({ data: { ok: true }, message: 'If that email is registered, a reset link is on its way.' });
  }),
);

router.post(
  '/reset-password',
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = validate(
      z.object({ token: z.string().min(20), password: passwordSchema }),
      req.body,
    );
    const record = await consumeEmailToken(input.token, 'RESET_PASSWORD');
    if (!record) throw ApiError.badRequest('This reset link is invalid or has expired.');
    const passwordHash = await hashPassword(input.password);
    await prisma.user.update({ where: { id: record.userId }, data: { passwordHash } });
    await revokeAllSessions(record.userId);
    const user = await prisma.user.findUnique({ where: { id: record.userId } });
    if (user) {
      await notify({
        userId: user.id,
        type: 'SYSTEM',
        title: 'Password changed',
        body: 'Your password was reset. If this was not you, contact support immediately.',
      });
      await writeAudit(req, 'PASSWORD_RESET', 'User', user.id);
    }
    res.json({ data: { ok: true } });
  }),
);

router.get(
  '/sessions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const sessions = await prisma.refreshToken.findMany({
      where: { userId: req.user!.id, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, createdAt: true, userAgent: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ data: sessions });
  }),
);

router.delete(
  '/sessions/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    await prisma.refreshToken.updateMany({
      where: { id: req.params.id, userId: req.user!.id },
      data: { revokedAt: new Date() },
    });
    res.json({ data: { ok: true } });
  }),
);

export { REFRESH_COOKIE };
export default router;
