import { randomUUID } from 'node:crypto';
import type { Request } from 'express';

export function requestContext(req: Request) {
  return {
    ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip,
    userAgent: req.headers['user-agent'],
  };
}

export function requestId() {
  return randomUUID();
}

/**
 * Structured logger. It intentionally only logs identifiers and counts — never
 * CV contents, demographic payloads or passwords.
 */
export const logger = {
  info(message: string, meta?: Record<string, unknown>) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ level: 'info', message, at: new Date().toISOString(), ...meta }));
  },
  warn(message: string, meta?: Record<string, unknown>) {
    // eslint-disable-next-line no-console
    console.warn(JSON.stringify({ level: 'warn', message, at: new Date().toISOString(), ...meta }));
  },
  error(message: string, meta?: Record<string, unknown>) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: 'error', message, at: new Date().toISOString(), ...meta }));
  },
};
