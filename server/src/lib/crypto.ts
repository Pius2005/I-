import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../env.js';
import type { Role } from '@prisma/client';

export interface AccessPayload {
  sub: string;
  role: Role;
  orgId: string | null;
  email: string;
}

export function hashPassword(password: string) {
  return bcrypt.hash(password, env.BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function signAccessToken(payload: AccessPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL as SignOptions['expiresIn'],
    issuer: 'ise',
  });
}

export function verifyAccessToken(token: string): AccessPayload {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: 'ise' });
  if (typeof decoded === 'string') throw new Error('Malformed token');
  return decoded as unknown as AccessPayload;
}

export function randomToken(bytes = 48) {
  return crypto.randomBytes(bytes).toString('hex');
}

export function sha256(input: string) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

// --- AES-256-GCM for sensitive fields ---------------------------------------
function encryptionKey(): Buffer {
  const raw = env.FIELD_ENCRYPTION_KEY;
  if (!raw) {
    // Development fallback derived from the JWT secret. Production must set a key.
    return crypto.createHash('sha256').update(`${env.JWT_ACCESS_SECRET}:field`).digest();
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  return crypto.createHash('sha256').update(raw).digest();
}

export interface SealedPayload {
  v: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

export function sealJson(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const payload: SealedPayload = {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: encrypted.toString('base64'),
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

export function openJson<T = unknown>(sealed: string): T {
  const payload = JSON.parse(Buffer.from(sealed, 'base64').toString('utf8')) as SealedPayload;
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(payload.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString('utf8')) as T;
}

/** Stable anonymous reference that leaks nothing about identity. */
export function anonymousRef(applicationId: string) {
  const digest = crypto
    .createHmac('sha256', env.JWT_ACCESS_SECRET)
    .update(applicationId)
    .digest('hex')
    .slice(0, 8)
    .toUpperCase();
  return `ANON-${digest}`;
}
