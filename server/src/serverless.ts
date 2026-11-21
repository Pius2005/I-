import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from './app.js';
import { prisma } from './db.js';
import { logger } from './lib/logger.js';

/**
 * Serverless entry point (Vercel, Netlify, Lambda).
 *
 * The Express app is built once per warm instance and reused, so a container
 * that serves thousands of requests connects to Postgres once. `index.ts` stays
 * the long-running server used by Docker and local development.
 */

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let ready: Promise<Handler> | null = null;

async function bootstrap(): Promise<Handler> {
  await prisma.$connect().catch((error) => {
    // A cold start can race the database; routes surface their own errors.
    logger.error('prisma.connect_failed', { message: (error as Error).message });
  });
  return createApp() as unknown as Handler;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!ready) ready = bootstrap();
  const app = await ready;
  return app(req, res);
}
