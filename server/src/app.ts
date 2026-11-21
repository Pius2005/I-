import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { env, corsOrigins, isProd } from './env.js';
import { ApiError, toErrorBody } from './lib/errors.js';
import { requestId } from './lib/logger.js';
import { apiLimiter, heavyLimiter, uploadLimiter } from './middleware/rateLimit.js';
import { MAX_CV_BYTES } from './services/extraction.js';

import authRoutes from './routes/auth.js';
import publicRoutes from './routes/public.js';
import candidateRoutes from './routes/candidate.js';
import applicationRoutes from './routes/applications.js';
import recruiterRoutes from './routes/recruiter.js';
import interviewRoutes from './routes/interviews.js';
import auditRoutes from './routes/audit.js';
import adminRoutes from './routes/admin.js';
import notificationRoutes from './routes/notifications.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    req.requestId = requestId();
    res.setHeader('X-Request-Id', req.requestId);
    next();
  });

  app.use(
    helmet({
      contentSecurityPolicy: isProd
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:', 'blob:'],
              fontSrc: ["'self'", 'data:'],
              connectSrc: ["'self'"],
              objectSrc: ["'none'"],
              frameAncestors: ["'none'"],
              baseUri: ["'self'"],
            },
          }
        : false,
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        // In development any loopback port is acceptable: Vite moves to the next
        // free port when 5173 is taken, and a rejected origin otherwise looks
        // like a broken sign-in. Production still uses the explicit allow-list.
        const isLocalDevOrigin =
          !isProd && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin ?? '');
        if (!origin || corsOrigins.includes(origin) || isLocalDevOrigin) return callback(null, true);
        // A rejected origin is an authorization problem, not a server fault:
        // surface it as 403 so the browser and logs show the real cause.
        callback(
          new ApiError(
            403,
            'ORIGIN_NOT_ALLOWED',
            `The origin ${origin} is not allowed. Add it to CORS_ORIGINS.`,
          ),
        );
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Ise-Request'],
    }),
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ data: { status: 'ok', time: new Date().toISOString(), env: env.NODE_ENV } });
  });

  app.use('/api', apiLimiter);

  app.use('/api/auth', authRoutes);
  app.use('/api/public', publicRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/candidate', candidateRoutes);
  app.use('/api/applications', uploadLimiter, applicationRoutes);
  app.use('/api/recruiter', recruiterRoutes);
  app.use('/api/interviews', interviewRoutes);
  app.use('/api/audit', heavyLimiter, auditRoutes);
  app.use('/api/admin', adminRoutes);

  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
  });

  // Serve the built SPA in production (the Docker image builds the client).
  const clientDist = path.resolve(process.cwd(), '../client/dist');
  if (existsSync(clientDist)) {
    app.use(
      express.static(clientDist, {
        maxAge: '1h',
        setHeaders(res, filePath) {
          if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  // Consistent error envelope. Never leak stack traces or CV contents.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const { status, body } = toErrorBody(err, req.requestId);

    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE' ? `Your CV must be ${Math.floor(MAX_CV_BYTES / (1024 * 1024))} MB or smaller.` : 'That upload could not be accepted.';
      return res.status(400).json({ error: { code: err.code, message, requestId: req.requestId } });
    }
    if (!(err instanceof ApiError) && status >= 500) {
      // eslint-disable-next-line no-console
      console.error(JSON.stringify({ level: 'error', message: (err as Error)?.message, stack: (err as Error)?.stack?.split('\n').slice(0, 4), requestId: req.requestId }));
    }
    res.status(status).json(body);
  });

  return app;
}
