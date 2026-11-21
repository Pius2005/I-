import type { Request, Response } from 'express';
import type { User } from '@prisma/client';
import { env, isProd } from '../env.js';
import { prisma } from '../db.js';
import { randomToken, sha256, signAccessToken } from '../lib/crypto.js';
import { requestContext } from '../lib/logger.js';
import { sendMail, renderHtml } from './mailer.js';

export const REFRESH_COOKIE = 'ise_refresh';

export function publicUser(user: Pick<User, 'id' | 'email' | 'fullName' | 'role' | 'organisationId' | 'emailVerifiedAt' | 'phone'>) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    organisationId: user.organisationId,
    emailVerified: Boolean(user.emailVerifiedAt),
    phone: user.phone,
  };
}

export async function issueSession(user: User, req: Request, res: Response) {
  const refresh = randomToken(48);
  const context = requestContext(req);
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(refresh),
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 3600_000),
      userAgent: context.userAgent?.slice(0, 250),
      ip: context.ip,
    },
  });
  res.cookie(REFRESH_COOKIE, refresh, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/api/auth',
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 3600_000,
  });
  return signAccessToken({
    sub: user.id,
    role: user.role,
    orgId: user.organisationId,
    email: user.email,
  });
}

/** Rotates a refresh token: the presented token is revoked and replaced. */
export async function rotateSession(req: Request, res: Response) {
  const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (!raw) return null;
  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash: sha256(raw) },
    include: { user: true },
  });
  if (!record || record.revokedAt || record.expiresAt < new Date()) return null;
  if (!record.user.isActive || record.user.deletedAt) return null;

  await prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
  const accessToken = await issueSession(record.user, req, res);
  return { accessToken, user: publicUser(record.user) };
}

export async function revokeSession(req: Request, res: Response) {
  const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (raw) {
    await prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(raw), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
}

export async function revokeAllSessions(userId: string) {
  await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

type EmailTokenKind = 'VERIFY_EMAIL' | 'RESET_PASSWORD';

export async function issueEmailToken(user: User, type: EmailTokenKind) {
  const token = randomToken(32);
  await prisma.emailToken.create({
    data: {
      userId: user.id,
      type,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + (type === 'RESET_PASSWORD' ? 60 : 24 * 60) * 60_000),
    },
  });
  const path = type === 'VERIFY_EMAIL' ? `/verify-email?token=${token}` : `/reset-password?token=${token}`;
  const url = `${env.APP_URL.replace(/\/$/, '')}${path}`;
  if (type === 'VERIFY_EMAIL') {
    await sendMail({
      to: user.email,
      subject: 'Verify your Iṣẹ́ email address',
      text: `Hello ${user.fullName.split(' ')[0]},\n\nConfirm your email address to finish setting up your Iṣẹ́ account:\n${url}\n\nThis link expires in 24 hours.`,
      html: renderHtml('Confirm your email', [
        `Hello ${user.fullName.split(' ')[0]},`,
        'Confirm your email address to finish setting up your account. This link expires in 24 hours.',
        'If you did not create an Iṣẹ́ account, you can ignore this message.',
      ], { label: 'Verify email', url }),
    });
  } else {
    await sendMail({
      to: user.email,
      subject: 'Reset your Iṣẹ́ password',
      text: `Hello ${user.fullName.split(' ')[0]},\n\nReset your password using this link (valid for one hour):\n${url}\n\nIf you did not request this, your password has not changed and you can ignore this email.`,
      html: renderHtml('Reset your password', [
        'We received a request to reset your Iṣẹ́ password. The link below is valid for one hour.',
        'If you did not request this, your password has not changed.',
      ], { label: 'Reset password', url }),
    });
  }
  return token;
}

/** Consumes a one-time email token (verification or reset). */
export async function consumeEmailToken(rawToken: string, type: EmailTokenKind) {
  const record = await prisma.emailToken.findUnique({ where: { tokenHash: sha256(rawToken) } });
  if (!record || record.type !== type || record.usedAt || record.expiresAt < new Date()) return null;
  await prisma.emailToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
  return record;
}
