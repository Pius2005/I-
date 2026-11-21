import { prisma } from '../db.js';
import { env } from '../env.js';

/**
 * Global settings, stored in the Setting table and falling back to env defaults.
 * Admin changes apply to new reports and alerts without a restart.
 */

export interface AuditSettings {
  minGroupSize: number;
  threshold: number;
  counterfactualThreshold: number;
  retentionDays: number;
  blindScreeningDefault: boolean;
}

const DEFAULTS: AuditSettings = {
  minGroupSize: env.AUDIT_MIN_GROUP_SIZE,
  threshold: env.AUDIT_ADVERSE_IMPACT_THRESHOLD,
  counterfactualThreshold: env.AUDIT_COUNTERFACTUAL_THRESHOLD,
  retentionDays: env.DATA_RETENTION_DAYS,
  blindScreeningDefault: true,
};

export async function getAuditSettings(): Promise<AuditSettings> {
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: 'audit.' } } });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const num = (key: string, fallback: number) => {
    const value = map.get(key);
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  };
  return {
    minGroupSize: num('audit.minGroupSize', DEFAULTS.minGroupSize),
    threshold: num('audit.threshold', DEFAULTS.threshold),
    counterfactualThreshold: num('audit.counterfactualThreshold', DEFAULTS.counterfactualThreshold),
    retentionDays: num('audit.retentionDays', DEFAULTS.retentionDays),
    blindScreeningDefault: (map.get('audit.blindScreeningDefault') as boolean | undefined) ?? DEFAULTS.blindScreeningDefault,
  };
}

export async function updateAuditSettings(patch: Partial<AuditSettings>, actorId: string) {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  for (const [key, value] of entries) {
    await prisma.setting.upsert({
      where: { key: `audit.${key}` },
      create: { key: `audit.${key}`, value: value as boolean | number },
      update: { value: value as boolean | number },
    });
  }
  await prisma.auditLog.create({
    data: {
      actorId,
      actorRole: 'ADMIN',
      action: 'SETTINGS_UPDATED',
      entityType: 'Setting',
      entityId: 'audit',
      metadata: patch as object,
    },
  });
  return getAuditSettings();
}
