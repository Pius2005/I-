import { createApp } from './app.js';
import { env } from './env.js';
import { prisma } from './db.js';
import { logger } from './lib/logger.js';
import { startScheduler } from './services/scheduler.js';
import { startBullWorker } from './services/queue.js';

async function main() {
  await prisma.$connect();
  const app = createApp();

  const server = app.listen(env.PORT, () => {
    logger.info('server.started', { port: env.PORT, env: env.NODE_ENV });
    // eslint-disable-next-line no-console
    console.log(`\n  Iṣẹ́ API ready on http://localhost:${env.PORT}\n`);
  });

  const scheduler = startScheduler();
  const worker = await startBullWorker().catch((error) => {
    logger.error('queue.worker_failed', { message: (error as Error).message });
    return null;
  });

  const shutdown = async (signal: string) => {
    logger.info('server.shutting_down', { signal });
    server.close();
    clearInterval(scheduler);
    await worker?.close().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled_rejection', { message: String(reason) });
  });
}

main().catch(async (error) => {
  logger.error('server.failed_to_start', { message: (error as Error).message });
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
