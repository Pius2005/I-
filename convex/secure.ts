'use node';

/**
 * Voluntary demographic declarations and NDPA data export.
 *
 * Self-declarations are encrypted with AES-256-GCM before they touch the
 * database and are only ever opened inside this Node runtime. The audit engine
 * aggregates them without exposing individual rows.
 */

import { internalRefs } from '../shared/refs';
import crypto from 'node:crypto';
import { action } from './_generated/server';
import { v } from 'convex/values';
import { ConvexError } from 'convex/values';

const CONSENT_VERSION = '2026-02-v1';

function appError(code: string, message: string): never {
  throw new ConvexError(JSON.stringify({ code, message }));
}

function encryptionKey(): Buffer {
  const raw = process.env.FIELD_ENCRYPTION_KEY;
  const fallback = process.env.APP_SECRET ?? process.env.JWT_ACCESS_SECRET ?? 'ise-convex-development-secret';
  if (!raw) return crypto.createHash('sha256').update(`${fallback}:field`).digest();
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  return crypto.createHash('sha256').update(raw).digest();
}

function seal(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(value), 'utf8')), cipher.final()]);
  return Buffer.from(
    JSON.stringify({
      v: 1,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: encrypted.toString('base64'),
    }),
    'utf8',
  ).toString('base64');
}

export function open<T = unknown>(sealed: string): T {
  const payload = JSON.parse(Buffer.from(sealed, 'base64').toString('utf8')) as {
    iv: string;
    tag: string;
    ciphertext: string;
  };
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8')) as T;
}

const demographicPayload = v.object({
  gender: v.optional(v.string()),
  ageBand: v.optional(v.string()),
  stateOfOrigin: v.optional(v.union(v.string(), v.null())),
  universityType: v.optional(v.string()),
  disabilityStatus: v.optional(v.string()),
  consentVersion: v.optional(v.string()),
});

const ZONES: Record<string, string> = {
  lagos: 'South West', ogun: 'South West', oyo: 'South West', osun: 'South West', ondo: 'South West',
  ekiti: 'South West', abia: 'South East', anambra: 'South East', ebonyi: 'South East', enugu: 'South East',
  imo: 'South East', 'akwa ibom': 'South South', akwaibom: 'South South', bayelsa: 'South South',
  'cross river': 'South South', delta: 'South South', edo: 'South South', rivers: 'South South',
  benue: 'North Central', kogi: 'North Central', kwara: 'North Central', nasarawa: 'North Central',
  niger: 'North Central', plateau: 'North Central', fct: 'North Central', abuja: 'North Central',
  adamawa: 'North East', bauchi: 'North East', borno: 'North East', gombe: 'North East',
  taraba: 'North East', yobe: 'North East', jigawa: 'North West', kaduna: 'North West',
  kano: 'North West', katsina: 'North West', kebbi: 'North West', sokoto: 'North West', zamfara: 'North West',
};

export function regionFor(state?: string | null): string {
  if (!state) return 'Not declared';
  return ZONES[state.trim().toLowerCase()] ?? 'Other';
}

export const getDemographics = action({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.runQuery(internalRefs.secureData.declaration, { token: args.token });
    if (!row) return null;
    try {
      const payload = open<Record<string, unknown>>(row.payload);
      return { ...payload, declaredAt: row.declaredAt, region: regionFor(payload.stateOfOrigin as string | null) };
    } catch {
      appError('DECRYPT_FAILED', 'Your declaration could not be read. Please declare again.');
    }
  },
});

export const setDemographics = action({
  args: { token: v.string(), payload: demographicPayload },
  handler: async (ctx, args) => {
    const sealed = seal(args.payload);
    await ctx.runMutation(internalRefs.secureData.saveDeclaration, {
      token: args.token,
      payload: sealed,
      consentVersion: args.payload.consentVersion ?? CONSENT_VERSION,
    });
    return { ok: true, declared: true };
  },
});

export const withdrawDemographics = action({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await ctx.runMutation(internalRefs.secureData.deleteDeclaration, { token: args.token });
    return { ok: true };
  },
});

export const seedDeclaration = action({
  args: { token: v.string(), userId: v.id('users'), payload: v.any() },
  handler: async (ctx, args) => {
    await ctx.runMutation(internalRefs.secureData.seedDeclaration, {
      token: args.token,
      userId: args.userId,
      payload: seal(args.payload),
      consentVersion: CONSENT_VERSION,
    });
    return { ok: true };
  },
});

export const exportData = action({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const bundle = await ctx.runQuery(internalRefs.secureData.exportBundle, { token: args.token });
    let demographicDeclaration: unknown = null;
    try {
      demographicDeclaration = bundle.declaration ? open(bundle.declaration.payload) : null;
    } catch {
      demographicDeclaration = null;
    }
    const pack = {
      exportedAt: new Date().toISOString(),
      noticeVersion: CONSENT_VERSION,
      account: bundle.account,
      demographicDeclaration,
      cvTexts: bundle.cvTexts,
      applications: bundle.applications,
      consentRecords: bundle.consentRecords,
      notifications: bundle.notifications,
    };
    await ctx.runMutation(internalRefs.secureData.recordExport, { token: args.token });
    return pack;
  },
});
