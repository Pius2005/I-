import { rateLimit } from 'express-rate-limit';

const message = {
  error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down and try again shortly.' },
};

/** Global API limiter. Generous enough for a dashboard, strict enough to blunt abuse. */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 1200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message,
});

/** Uploads: 30 CVs per hour per IP. */
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message,
});

/** Expensive AI/report endpoints. */
export const heavyLimiter = rateLimit({
  windowMs: 10 * 60_000,
  limit: 40,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message,
});
