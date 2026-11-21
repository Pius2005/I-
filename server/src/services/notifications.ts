import type { NotificationType, Prisma } from '@prisma/client';
import { env } from '../env.js';
import { prisma } from '../db.js';
import { logger } from '../lib/logger.js';
import { sendMail, renderHtml } from './mailer.js';
import { sendSms } from './sms.js';

interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  email?: { subject: string; paragraphs: string[]; cta?: { label: string; url: string } } | null;
  sms?: string | null;
  /**
   * Transaction-scoped client, so notifications commit atomically with the
   * decision that produced them.
   */
  tx?: Prisma.TransactionClient;
}

/**
 * Single notification entry point: in-app record plus optional email/SMS,
 * gated by the user's channel preferences. Never throws into the caller.
 */
export async function notify(input: NotifyInput) {
  const db = input.tx ?? prisma;
  try {
    const [user, prefs] = await Promise.all([
      db.user.findUnique({
        where: { id: input.userId },
        select: { email: true, phone: true, isActive: true, deletedAt: true },
      }),
      db.notificationPreference.findUnique({ where: { userId: input.userId } }),
    ]);
    if (!user || !user.isActive || user.deletedAt) return;

    const inApp = prefs?.inApp ?? true;
    if (inApp) {
      await db.notification.create({
        data: {
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body,
          data: (input.data ?? {}) as Prisma.InputJsonValue,
        },
      });
    }

    if (input.email && (prefs?.email ?? true)) {
      await sendMail({
        to: user.email,
        subject: input.email.subject,
        text: `${input.email.paragraphs.join('\n\n')}\n\n${env.APP_URL}`,
        html: renderHtml(input.email.subject, input.email.paragraphs, input.email.cta),
      }).catch((error) => logger.error('notify.email_failed', { message: (error as Error).message }));
    }

    if (input.sms && user.phone) {
      if (prefs?.sms) {
        await sendSms({ to: user.phone, body: input.sms }).catch(() => undefined);
      }
      if (prefs?.whatsapp) {
        await sendSms({ to: user.phone, body: input.sms, channel: 'whatsapp' }).catch(() => undefined);
      }
    }
  } catch (error) {
    logger.error('notify.failed', { type: input.type, message: (error as Error).message });
  }
}

export async function notifyJobRecruiters(args: {
  jobId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}) {
  const job = await prisma.job.findUnique({
    where: { id: args.jobId },
    select: { recruiterId: true, organisation: { select: { users: { where: { role: 'ADMIN' }, select: { id: true } } } } },
  });
  if (!job) return;
  const recipients = new Set<string>([job.recruiterId, ...job.organisation.users.map((u) => u.id)]);
  for (const userId of recipients) {
    await notify({ userId, type: args.type, title: args.title, body: args.body, data: args.data });
  }
}

export async function unreadNotificationCount(userId: string) {
  return prisma.notification.count({ where: { userId, readAt: null } });
}
