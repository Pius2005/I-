import { prisma } from '../db.js';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { notify } from './notifications.js';
import { renderTemplate } from './templates.js';
import { storage } from './storage.js';

/**
 * In-process scheduler. Runs on an interval and is safe to call concurrently:
 * each notification is claimed with a conditional update on the reminder
 * timestamp, so a duplicated sweep cannot double-send.
 */

export async function runReminderSweep() {
  const now = Date.now();
  const windows = [
    { field: 'reminder24SentAt' as const, from: now + 23 * 3600_000, to: now + 24 * 3600_000, key: 'REMINDER_24H' as const },
    { field: 'reminder1SentAt' as const, from: now + 30 * 60_000, to: now + 60 * 60_000, key: 'REMINDER_1H' as const },
  ];

  for (const window of windows) {
    const interviews = await prisma.interview.findMany({
      where: {
        status: 'SCHEDULED',
        [window.field]: null,
        slot: { startsAt: { gte: new Date(window.from), lte: new Date(window.to) } },
      },
      include: {
        slot: true,
        application: {
          include: {
            job: { select: { title: true, organisation: { select: { name: true } } } },
            candidate: { select: { id: true, fullName: true, email: true } },
          },
        },
      },
      take: 100,
    });

    for (const interview of interviews) {
      const claimed = await prisma.interview.updateMany({
        where: { id: interview.id, [window.field]: null },
        data: { [window.field]: new Date() },
      });
      if (claimed.count === 0) continue;

      const candidate = interview.application.candidate;
      const when = interview.slot.startsAt.toLocaleString('en-NG', {
        timeZone: 'Africa/Lagos',
        dateStyle: 'medium',
        timeStyle: 'short',
      });
      const template = renderTemplate(
        window.key,
        {
          candidateName: candidate.fullName.split(' ')[0],
          jobTitle: interview.application.job.title,
          organisation: interview.application.job.organisation.name,
          date: `${when} (Africa/Lagos)`,
        },
        candidate.email,
      );
      await notify({
        userId: candidate.id,
        type: window.key,
        title: template.title,
        body: template.body,
        data: { interviewId: interview.id },
        email: template.email ? { subject: template.email.subject, paragraphs: [template.body], cta: { label: 'View interview', url: `${env.APP_URL}/candidate/applications` } } : null,
        sms: template.sms,
      });
    }
  }
}

/**
 * NDPA data-minimisation sweep: purge CV files (and parsed personal data) for
 * applications closed longer than the configured retention period. Audit logs
 * are retained as they contain no CV contents.
 */
export async function runRetentionSweep() {
  const cutoff = new Date(Date.now() - env.DATA_RETENTION_DAYS * 24 * 3600_000);
  const stale = await prisma.application.findMany({
    where: {
      stage: { in: ['HIRED', 'REJECTED'] },
      updatedAt: { lt: cutoff },
      cvFile: { isNot: null },
    },
    select: { id: true, cvFile: { select: { id: true, storageKey: true } } },
    take: 200,
  });

  let purged = 0;
  for (const application of stale) {
    if (!application.cvFile) continue;
    try {
      await storage.delete(application.cvFile.storageKey);
    } catch (error) {
      logger.warn('retention.file_delete_failed', { applicationId: application.id });
    }
    await prisma.$transaction([
      prisma.parsedCV.deleteMany({ where: { applicationId: application.id } }),
      prisma.cVFile.delete({ where: { id: application.cvFile.id } }),
    ]);
    purged += 1;
  }

  const [tokens, refresh] = await Promise.all([
    prisma.emailToken.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
    prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
  ]);
  if (purged) logger.info('retention.purged', { purged, emailTokens: tokens.count, refreshTokens: refresh.count });
  return { purged };
}

let timer: NodeJS.Timeout | null = null;

export function startScheduler() {
  if (timer) return timer;
  const sweep = async () => {
    try {
      await runReminderSweep();
    } catch (error) {
      logger.error('scheduler.reminder_failed', { message: (error as Error).message });
    }
  };
  timer = setInterval(sweep, 60_000);
  timer.unref?.();
  // Daily retention sweep.
  const retentionTimer = setInterval(
    () => runRetentionSweep().catch((error) => logger.error('scheduler.retention_failed', { message: (error as Error).message })),
    24 * 3600_000,
  );
  retentionTimer.unref?.();
  return timer;
}

export function stopScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
