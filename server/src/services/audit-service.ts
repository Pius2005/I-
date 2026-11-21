import { prisma } from '../db.js';
import { env } from '../env.js';
import { openJson } from '../lib/crypto.js';
import {
  adverseImpact,
  proxyBias,
  selectionRates,
  suggestedFixes,
  type GroupObservation,
  type ImpactAnalysis,
  type ProxyFinding,
} from '../domain/audit.js';
import { DEGREE_CLASS_LABEL, highestEducation, yearsOfExperience, type ParsedCVData } from '../domain/types.js';

/**
 * Bias audit engine.
 *
 * Reads voluntary self-declarations, decrypts them in memory only, and emits
 * aggregates. Nothing below the group level ever leaves this service.
 */

export interface DemographicPayload {
  gender?: 'FEMALE' | 'MALE' | 'NON_BINARY' | 'PREFER_NOT_TO_SAY';
  ageBand?: '18-24' | '25-29' | '30-34' | '35-39' | '40+' | 'PREFER_NOT_TO_SAY';
  stateOfOrigin?: string | null;
  universityType?: 'FEDERAL' | 'STATE' | 'PRIVATE' | 'POLYTECHNIC' | 'UNKNOWN' | 'PREFER_NOT_TO_SAY';
  disabilityStatus?: 'NONE' | 'DECLARED' | 'PREFER_NOT_TO_SAY';
  consentVersion?: string;
}

const STAGE_ORDER = ['APPLIED', 'SCREENED', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'HIRED'] as const;
export type StageName = (typeof STAGE_ORDER)[number];

const ZONES: Record<string, string> = {
  lagos: 'South West', ogun: 'South West', Oyo: 'South West', oyo: 'South West', osun: 'South West',
  ondo: 'South West', ekiti: 'South West', abia: 'South East', anambra: 'South East', ebonyi: 'South East',
  enugu: 'South East', imo: 'South East', akwaibom: 'South South', 'akwa ibom': 'South South',
  bayelsa: 'South South', 'cross river': 'South South', delta: 'South South', edo: 'South South',
  rivers: 'South South', benue: 'North Central', kogi: 'North Central', kwara: 'North Central',
  nasarawa: 'North Central', niger: 'North Central', plateau: 'North Central', 'fct': 'North Central',
  abuja: 'North Central', adamawa: 'North East', bauchi: 'North East', borno: 'North East',
  gombe: 'North East', taraba: 'North East', yobe: 'North East', jigawa: 'North West',
  kaduna: 'North West', kano: 'North West', katsina: 'North West', kebbi: 'North West',
  sokoto: 'North West', zamfara: 'North West',
};

export function regionFor(state?: string | null): string {
  if (!state) return 'Not declared';
  return ZONES[state.trim().toLowerCase()] ?? 'Other';
}

export const DEMOGRAPHIC_DIMENSIONS = [
  { key: 'gender', label: 'Gender' },
  { key: 'ageBand', label: 'Age band' },
  { key: 'region', label: 'Geopolitical region' },
  { key: 'universityType', label: 'University type' },
  { key: 'degreeClass', label: 'Degree class band' },
  { key: 'disability', label: 'Disability' },
] as const;

export type DimensionKey = (typeof DEMOGRAPHIC_DIMENSIONS)[number]['key'];

export interface AuditScopeInput {
  jobId?: string;
  organisationId?: string;
  minGroupSize?: number;
  threshold?: number;
}

interface ApplicationRow {
  id: string;
  stage: string;
  score: number | null;
  createdAt: Date;
  candidateId: string;
  jobId: string;
  aiRecommendedStage: string | null;
  jobTitle: string;
  orgId: string;
  parsedCv: unknown;
  cvextractedText: string | null;
}

export interface StageAnalysis {
  stage: StageName;
  label: string;
  groups: Record<DimensionKey, { stats: ReturnType<typeof selectionRates>; analysis: ImpactAnalysis }>;
  flagged: boolean;
}

export interface AuditSnapshot {
  scope: { jobId: string | null; organisationId: string | null; jobTitle: string | null };
  generatedAt: string;
  sampleSize: number;
  declaredSample: number;
  stages: StageAnalysis[];
  proxyFindings: ProxyFinding[];
  overrideAnalysis: {
    dimension: string;
    total: number;
    aiAgreementRate: number;
    groups: {
      group: string;
      total: number;
      favourableOverrides: number;
      disfavourableOverrides: number;
      favourableRate: number;
      disfavourableRate: number;
      flagged: boolean;
    }[];
    flagged: boolean;
    note: string;
  }[];
  counterfactual?: { runs: number; maxDelta: number; flagged: number };
  flags: { code: string; severity: string; message: string }[];
  findings: string[];
  suggestedFixes: string[];
  sampleWarnings: string[];
  methodology: string[];
  minGroupSize: number;
  threshold: number;
}

function stageRank(stage: string): number {
  const index = STAGE_ORDER.indexOf(stage as StageName);
  return index === -1 ? -1 : index;
}

function reachedStage(row: ApplicationRow, historyStages: Set<string>, stage: StageName): boolean {
  return stageRank(row.stage) >= stageRank(stage) || historyStages.has(stage);
}

function dimensionValue(row: ApplicationRow, dim: DimensionKey, demo: DemographicPayload | null): string {
  if (!demo) return 'Not declared';
  switch (dim) {
    case 'gender':
      return demo.gender && demo.gender !== 'PREFER_NOT_TO_SAY' ? titleCase(demo.gender) : 'Not declared';
    case 'ageBand':
      return demo.ageBand && demo.ageBand !== 'PREFER_NOT_TO_SAY' ? demo.ageBand : 'Not declared';
    case 'region':
      return regionFor(demo.stateOfOrigin);
    case 'universityType': {
      const cv = row.parsedCv as ParsedCVData | null;
      const edu = cv ? highestEducation(cv) : null;
      const declared = demo.universityType;
      const inferred = edu?.institutionType;
      const value = declared && declared !== 'PREFER_NOT_TO_SAY' ? declared : inferred;
      return value && value !== 'UNKNOWN' ? titleCase(value) : 'Not declared';
    }
    case 'degreeClass': {
      const cv = row.parsedCv as ParsedCVData | null;
      const edu = cv ? highestEducation(cv) : null;
      const cls = edu?.degreeClass;
      if (!cls || cls === 'NONE') return 'Not declared';
      if (['FIRST', 'SECOND_UPPER'].includes(cls)) return 'First / 2:1';
      if (cls === 'SECOND_LOWER') return '2:2';
      return DEGREE_CLASS_LABEL[cls];
    }
    case 'disability':
      return demo.disabilityStatus === 'DECLARED'
        ? 'Declared disability'
        : demo.disabilityStatus === 'NONE'
          ? 'No disability declared'
          : 'Not declared';
    default:
      return 'Not declared';
  }
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function wordCount(text?: string | null) {
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

export async function buildAuditSnapshot(input: AuditScopeInput): Promise<AuditSnapshot> {
  const minGroupSize = input.minGroupSize ?? env.AUDIT_MIN_GROUP_SIZE;
  const threshold = input.threshold ?? env.AUDIT_ADVERSE_IMPACT_THRESHOLD;

  const jobWhere = input.jobId
    ? { id: input.jobId }
    : input.organisationId
      ? { organisationId: input.organisationId }
      : {};

  const jobs = await prisma.job.findMany({
    where: jobWhere,
    select: { id: true, title: true, organisationId: true },
  });
  const jobIds = jobs.map((j) => j.id);

  const applications = await prisma.application.findMany({
    where: { jobId: { in: jobIds } },
    select: {
      id: true,
      stage: true,
      score: true,
      createdAt: true,
      candidateId: true,
      jobId: true,
      aiRecommendedStage: true,
      job: { select: { title: true, organisationId: true } },
      parsedCV: { select: { data: true } },
      cvFile: { select: { extractedText: true } },
      statusHistory: { select: { toStage: true } },
    },
  });

  const candidateIds = [...new Set(applications.map((a) => a.candidateId))];
  const declarations = await prisma.demographicDeclaration.findMany({
    where: { userId: { in: candidateIds } },
    select: { userId: true, payload: true },
  });
  const demographics = new Map<string, DemographicPayload>();
  for (const decl of declarations) {
    try {
      demographics.set(decl.userId, openJson<DemographicPayload>(decl.payload));
    } catch {
      // A record encrypted with a rotated key is skipped, never decrypted with a guess.
    }
  }

  const rows: (ApplicationRow & { history: Set<string>; demo: DemographicPayload | null })[] = applications.map((a) => ({
    id: a.id,
    stage: a.stage,
    score: a.score,
    createdAt: a.createdAt,
    candidateId: a.candidateId,
    jobId: a.jobId,
    aiRecommendedStage: a.aiRecommendedStage,
    jobTitle: a.job.title,
    orgId: a.job.organisationId,
    parsedCv: a.parsedCV?.data ?? null,
    cvextractedText: a.cvFile?.extractedText ?? null,
    history: new Set(a.statusHistory.map((h) => h.toStage)),
    demo: demographics.get(a.candidateId) ?? null,
  }));

  const stageDefinitions: { stage: StageName; next: StageName; label: string }[] = [
    { stage: 'SCREENED', next: 'SHORTLISTED', label: 'Screened → Shortlisted' },
    { stage: 'SHORTLISTED', next: 'INTERVIEW', label: 'Shortlisted → Interviewed' },
    { stage: 'INTERVIEW', next: 'OFFER', label: 'Interviewed → Offered' },
    { stage: 'OFFER', next: 'HIRED', label: 'Offered → Hired' },
  ];

  const stages: StageAnalysis[] = stageDefinitions.map((def) => {
    const groups: Record<string, { stats: ReturnType<typeof selectionRates>; analysis: ImpactAnalysis }> = {};
    let flagged = false;
    for (const dim of DEMOGRAPHIC_DIMENSIONS) {
      const observations: GroupObservation[] = rows
        .filter((row) => row.demo && reachedStage(row, row.history, def.stage))
        .map((row) => ({
          group: dimensionValue(row, dim.key, row.demo),
          selected: reachedStage(row, row.history, def.next),
        }))
        .filter((o) => o.group !== 'Not declared');
      const stats = selectionRates(observations, minGroupSize);
      const analysis = adverseImpact(stats, threshold);
      if (analysis.flagged) flagged = true;
      groups[dim.key] = { stats, analysis };
    }
    return { stage: def.stage, label: def.label, groups: groups as StageAnalysis['groups'], flagged };
  });

  // --- Proxy bias ------------------------------------------------------------
  const proxyRows = rows
    .filter((r) => r.demo && typeof r.score === 'number')
    .map((r) => {
      const cv = (r.parsedCv ?? {}) as ParsedCVData;
      const edu = highestEducation(cv);
      const tier =
        edu?.institutionType === 'FEDERAL' ? 3 : edu?.institutionType === 'STATE' ? 2 : edu?.institutionType === 'PRIVATE' ? 1 : 0;
      return {
        group: dimensionValue(r, 'universityType', r.demo),
        score: r.score,
        proxies: {
          'CV word count': wordCount(r.cvextractedText),
          'Years of experience': yearsOfExperience(cv),
          'Internships listed': cv.experience?.filter((e) => e.isInternship).length ?? 0,
          'Institution tier': tier,
        },
      };
    });
  const proxyFindings = proxyBias(proxyRows, { minGroupSize, correlationThreshold: 0.3 });

  // --- Override analysis -----------------------------------------------------
  const overrideAnalysis: AuditSnapshot['overrideAnalysis'] = DEMOGRAPHIC_DIMENSIONS.map((dim) => {
    const buckets = new Map<string, { total: number; fav: number; dis: number }>();
    for (const row of rows) {
      if (!row.demo) continue;
      const group = dimensionValue(row, dim.key, row.demo);
      if (group === 'Not declared') continue;
      const bucket = buckets.get(group) ?? { total: 0, fav: 0, dis: 0 };
      bucket.total += 1;
      const advanced = reachedStage(row, row.history, 'SHORTLISTED');
      const aiRecommended = row.aiRecommendedStage === 'SHORTLISTED' || (row.score ?? 0) >= 60;
      if (advanced && !aiRecommended) bucket.fav += 1;
      if (!advanced && aiRecommended) bucket.dis += 1;
      buckets.set(group, bucket);
    }
    const groups = [...buckets.entries()].map(([group, b]) => ({
      group,
      total: b.total,
      favourableOverrides: b.fav,
      disfavourableOverrides: b.dis,
      favourableRate: b.total ? b.fav / b.total : 0,
      disfavourableRate: b.total ? b.dis / b.total : 0,
      flagged: false,
    }));
    const overallFav = groups.reduce((s, g) => s + g.favourableOverrides, 0) / Math.max(1, groups.reduce((s, g) => s + g.total, 0));
    const overallDis = groups.reduce((s, g) => s + g.disfavourableOverrides, 0) / Math.max(1, groups.reduce((s, g) => s + g.total, 0));
    for (const g of groups) {
      if (g.total < minGroupSize) continue;
      const favRatio = overallFav > 0 ? g.favourableRate / overallFav : 1;
      const disRatio = overallDis > 0 ? g.disfavourableRate / overallDis : 1;
      g.flagged = favRatio >= 1.25 || disRatio >= 1.25;
    }
    const total = groups.reduce((s, g) => s + g.total, 0);
    const agreements = rows.filter((r) => r.demo).filter((r) => {
      const advanced = reachedStage(r, r.history, 'SHORTLISTED');
      const aiRecommended = r.aiRecommendedStage === 'SHORTLISTED' || (r.score ?? 0) >= 60;
      return advanced === aiRecommended;
    }).length;
    return {
      dimension: dim.label,
      total,
      aiAgreementRate: total ? Number((agreements / total).toFixed(3)) : 0,
      groups,
      flagged: groups.some((g) => g.flagged),
      note:
        'Overrides are human decisions that disagree with the AI recommendation. A one-sided pattern warrants a review of the decision, not of the candidate.',
    };
  });

  const counterfactualAgg = await prisma.counterfactualRun.aggregate({
    where: { jobId: { in: jobIds } },
    _count: true,
    _max: { maxDelta: true },
  });
  const flaggedCf = await prisma.counterfactualRun.count({ where: { jobId: { in: jobIds }, flagged: true } });

  // --- Findings & flags ------------------------------------------------------
  const flags: AuditSnapshot['flags'] = [];
  for (const stage of stages) {
    for (const dim of DEMOGRAPHIC_DIMENSIONS) {
      const analysis = stage.groups[dim.key]?.analysis;
      if (!analysis?.flagged) continue;
      const worst = analysis.groups.filter((g) => g.flagged).sort((a, b) => a.ratio - b.ratio)[0];
      flags.push({
        code: 'adverse-impact',
        severity: worst?.severity ?? 'moderate',
        message: `${stage.label} — ${dim.label}: ${worst?.group} selected at ${Math.round((worst?.ratio ?? 1) * 100)}% of the ${analysis.highestGroup} rate.`,
      });
    }
  }
  for (const finding of proxyFindings.filter((p) => p.flagged)) {
    flags.push({
      code: 'proxy-bias',
      severity: 'moderate',
      message: `Possible proxy: "${finding.proxy}" correlates with both score (r=${finding.correlationWithScore}) and the ${finding.strongestGroup} group.`,
    });
  }
  for (const override of overrideAnalysis.filter((o) => o.flagged)) {
    flags.push({
      code: 'override',
      severity: 'moderate',
      message: `${override.dimension}: override decisions are unevenly distributed between groups.`,
    });
  }
  if (flaggedCf > 0) {
    flags.push({
      code: 'counterfactual',
      severity: 'high',
      message: `${flaggedCf} counterfactual run(s) produced score differences above the configured threshold when identity signals were swapped.`,
    });
  }

  const findings: string[] = [];
  const declared = rows.filter((r) => r.demo).length;
  if (rows.length === 0) {
    findings.push('No applications exist yet for this scope, so no statistics can be computed.');
  } else if (declared === 0) {
    findings.push(
      'No candidates have completed voluntary self-declaration, so group statistics cannot be computed. Recruitment bias cannot be assessed without this data.',
    );
  } else {
    const flaggedStages = stages.filter((s) => s.flagged);
    if (!flaggedStages.length) {
      findings.push(
        'No stage shows a selection-rate disparity below the four-fifths threshold among groups large enough to report.',
      );
    } else {
      findings.push(
        `${flaggedStages.length} of ${stages.length} stages show at least one group below the four-fifths threshold. Review the affected stage before making further offers.`,
      );
    }
    if (proxyFindings.some((p) => p.flagged)) {
      findings.push('At least one CV feature behaves like a proxy for a protected group; see the proxy table.');
    }
    if (overrideAnalysis.some((o) => o.flagged)) {
      findings.push('Human overrides are unevenly distributed; review the reasons recorded for those decisions.');
    }
  }
  const sampleWarnings: string[] = [];
  if (declared < 30) {
    sampleWarnings.push(
      `Only ${declared} application(s) have self-declared demographics. Small samples produce unstable rates; treat all figures as indicative.`,
    );
  }
  const suppressed = stages.flatMap((s) => Object.values(s.groups)).flatMap((g) => g.stats.filter((x) => x.suppressed));
  if (suppressed.length) {
    sampleWarnings.push(
      `${suppressed.length} group(s) fall below the ${minGroupSize}-person privacy threshold and are suppressed. Aggregating across more jobs may be necessary for a meaningful read.`,
    );
  }
  sampleWarnings.push(
    'Self-declaration is voluntary: candidates who opt out are excluded from group analysis, which can bias the comparison itself.',
  );

  const methodology = [
    'Selection rate = candidates in a group who advanced past a stage ÷ candidates in that group who reached the stage.',
    `Groups with fewer than ${minGroupSize} people are suppressed (shown as "suppressed") to protect privacy.`,
    `Adverse impact ratio = group selection rate ÷ the highest group's selection rate. Ratios below ${threshold} trigger the four-fifths rule flag.`,
    'Proxy detection correlates CV-derived features with both the AI score and group membership (Pearson / point-biserial, |r| ≥ 0.3).',
    'Override analysis compares the AI recommendation with the human decision and measures one-sided override rates per group.',
    'All figures are aggregate; no recruiter can view an individual applicant’s self-declaration.',
    'Statistical flags indicate possible bias and require human investigation. They are not legal findings of discrimination.',
  ];

  const jobTitle = input.jobId ? jobs[0]?.title ?? null : null;

  return {
    scope: {
      jobId: input.jobId ?? null,
      organisationId: input.organisationId ?? jobs[0]?.organisationId ?? null,
      jobTitle,
    },
    generatedAt: new Date().toISOString(),
    sampleSize: rows.length,
    declaredSample: declared,
    stages,
    proxyFindings,
    overrideAnalysis,
    counterfactual: {
      runs: counterfactualAgg._count,
      maxDelta: counterfactualAgg._max.maxDelta ?? 0,
      flagged: flaggedCf,
    },
    flags,
    findings,
    suggestedFixes: [...new Set(suggestedFixes([...new Set(flags.map((f) => f.code))]))],
    sampleWarnings,
    methodology,
    minGroupSize,
    threshold,
  };
}

/** Alert recruiters when a live job's flags cross the threshold. */
export async function maybeAlertOnJob(jobId: string) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, title: true, recruiterId: true, organisationId: true },
  });
  if (!job) return;
  const snapshot = await buildAuditSnapshot({ jobId });
  if (!snapshot.flags.length) return;

  const existing = await prisma.notification.findFirst({
    where: {
      userId: job.recruiterId,
      type: 'BIAS_ALERT',
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      data: { path: ['jobId'], equals: jobId },
    },
  });
  if (existing) return;

  const { notify } = await import('./notifications.js');
  await notify({
    userId: job.recruiterId,
    type: 'BIAS_ALERT',
    title: `Bias alert: ${job.title}`,
    body: `${snapshot.flags[0].message} Open the bias audit to review the full report. Statistical flags need human investigation; they are not legal findings.`,
    data: { jobId },
    email: {
      subject: `Bias alert — ${job.title}`,
      paragraphs: [
        `The live screening statistics for ${job.title} have crossed a bias flag threshold.`,
        snapshot.flags[0].message,
        'Open the bias audit dashboard to review the report and documented methodology.',
      ],
      cta: { label: 'Open bias audit', url: `${env.APP_URL}/recruiter/jobs/${jobId}/audit` },
    },
  });
}
