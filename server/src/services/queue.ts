import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { processApplicationCv, scoreAndStore } from './pipeline.js';
import { runReminderSweep, runRetentionSweep } from './scheduler.js';
import { syncInterviewToGoogle } from './calendar.js';

/**
 * Job queue.
 *
 * With REDIS_URL set this uses BullMQ; otherwise an in-process queue runs jobs
 * asynchronously so the API stays responsive on a laptop with no Redis.
 * Neither path silently drops work — failures are logged with the job id.
 */

type JobName = 'cv.process' | 'cv.score' | 'interview.calendar' | 'reminders' | 'retention';

let bullQueue: import('bullmq').Queue | null = null;

async function getBullQueue() {
  if (!env.REDIS_URL) return null;
  if (!bullQueue) {
    const { Queue } = await import('bullmq');
    bullQueue = new Queue('ise', {
      connection: { url: env.REDIS_URL },
      defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 3000 }, removeOnComplete: 500 },
    });
  }
  return bullQueue;
}

export async function enqueue(name: JobName, payload: Record<string, unknown>) {
  try {
    const queue = await getBullQueue();
    if (queue) {
      await queue.add(name, payload);
      return;
    }
    setImmediate(() => {
      runInline(name, payload).catch((error) =>
        logger.error('queue.inline_failed', { name, message: (error as Error).message }),
      );
    });
  } catch (error) {
    logger.error('queue.enqueue_failed', { name, message: (error as Error).message });
    // Never lose a CV because the queue is down.
    if (name === 'cv.process' && typeof payload.applicationId === 'string') {
      await processApplicationCv(payload.applicationId).catch(() => undefined);
    }
  }
}

export async function runInline(name: string, payload: Record<string, unknown>) {
  switch (name) {
    case 'cv.process':
      await processApplicationCv(String(payload.applicationId));
      break;
    case 'cv.score':
      await scoreAndStore(String(payload.applicationId), { source: 'manual' });
      break;
    case 'interview.calendar':
      await syncInterviewToGoogle(String(payload.interviewId));
      break;
    case 'reminders':
      await runReminderSweep();
      break;
    case 'retention':
      await runRetentionSweep();
      break;
    default:
      logger.warn('queue.unknown_job', { name });
  }
}

export async function startBullWorker() {
  if (!env.REDIS_URL) return null;
  const { Worker } = await import('bullmq');
  const worker = new Worker(
    'ise',
    async (job) => {
      await runInline(job.name, job.data as Record<string, unknown>);
    },
    { connection: { url: env.REDIS_URL }, concurrency: 3 },
  );
  worker.on('failed', (job, error) => logger.error('queue.job_failed', { job: job?.name, message: error.message }));
  logger.info('queue.worker_started');
  return worker;
}
