'use node';

/**
 * Bias audit engine.
 *
 * Reads voluntary self-declarations, decrypts them in memory only, and emits
 * aggregates. Nothing below the group level ever leaves this action.
 */

import { internalRefs } from '../shared/refs';
import { action } from './_generated/server';
import { v } from 'convex/values';
import { ConvexError } from 'convex/values';
import { open, regionFor } from './secure';
import {
  adverseImpact,
  buildVariants,
  deltaAgainstBaseline,
  evaluateCvForAudit,
  highestEducation,
  proxyBias,
  selectionRates,
  suggestedFixes,
  yearsOfExperience,
  DEGREE_CLASS_LABEL,
  type GroupObservation,
  type ParsedCVData,
} from '../shared/auditEngine';

const STAGE_ORDER = ['APPLIED', 'SCREENED', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'HIRED'] as const;
type StageName = (typeof STAGE_ORDER)[number];

export const DEMOGRAPHIC_DIMENSIONS = [
  { key: 'gender', label: 'Gender' },
  { key: 'ageBand', label: 'Age band' },
  { key: 'region', label: 'Geopolitical region' },
  { key: 'universityType', label: 'University type' },
  { key: 'degreeClass', label: 'Degree class band' },
  { key: 'disability', label: 'Disability' },
] as const;

type DimensionKey = (typeof DEMOGRAPHIC_DIMENSIONS)[number]['key'];

interface DemographicPayload {
  gender?: string;
  ageBand?: string;
  stateOfOrigin?: string | null;
  universityType?: string;
  disabilityStatus?: string;
  consentVersion?: string;
}

interface Row {
  id: string;
  stage: string;
  score: number | null;
  createdAt: number;
  candidateId: string;
  jobId: string;
  jobTitle: string;
  orgId: string;
  aiRecommendedStage: string | null;
  parsedCv: ParsedCVData | null;
  cvText: string | null;
  history: Set<string>;
  demo: DemographicPayload | null;
}

/** Shape of one application row returned by the snapshot query. */
interface SnapshotApplication {
  id: string;
  stage: string;
  score: number | null;
  createdAt: number;
  candidateId: string;
  jobId: string;
  jobTitle: string;
  organisationId: string;
  aiRecommendedStage: string | null;
  parsedCv: ParsedCVData | null;
  cvText: string | null;
  historyStages: string[];
}

interface CounterfactualRow {
  flagged: boolean;
  maxDelta: number;
}

function stageRank(stage: string) {
  const index = STAGE_ORDER.indexOf(stage as StageName);
  return index === -1 ? -1 : index;
}

function reachedStage(row: Row, stage: StageName) {
  return stageRank(row.stage) >= stageRank(stage) || row.history.has(stage);
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function dimensionValue(row: Row, dim: DimensionKey): string {
  const demo = row.demo;
  if (!demo) return 'Not declared';
  switch (dim) {
    case 'gender':
      return demo.gender && demo.gender !== 'PREFER_NOT_TO_SAY' ? titleCase(demo.gender) : 'Not declared';
    case 'ageBand':
      return demo.ageBand && demo.ageBand !== 'PREFER_NOT_TO_SAY' ? demo.ageBand : 'Not declared';
    case 'region':
      return regionFor(demo.stateOfOrigin);
    case 'universityType': {
      const edu = row.parsedCv ? highestEducation(row.parsedCv) : null;
      const declared = demo.universityType;
      const value = declared && declared !== 'PREFER_NOT_TO_SAY' ? declared : edu?.institutionType;
      return value && value !== 'UNKNOWN' ? titleCase(value) : 'Not declared';
    }
    case 'degreeClass': {
      const edu = row.parsedCv ? highestEducation(row.parsedCv) : null;
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

function wordCount(text?: string | null) {
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

function jsonError(code: string, message: string): never {
  throw new ConvexError(JSON.stringify({ code, message }));
}

export const snapshot = action({
  args: {
    token: v.string(),
    jobId: v.optional(v.id('jobs')),
    organisationId: v.optional(v.id('organisations')),
    minGroupSize: v.optional(v.number()),
    threshold: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const settings = await ctx.runQuery(internalRefs.settings.current, { token: args.token });
    const minGroupSize = args.minGroupSize ?? settings.minGroupSize;
    const threshold = args.threshold ?? settings.threshold;

    let organisationId = args.organisationId;
    let jobId = args.jobId;
    if (jobId) {
      const scope = await ctx.runQuery(internalRefs.settings.jobScope, { token: args.token, jobId });
      if (!scope.allowed) jsonError('FORBIDDEN', 'You do not have access to that job.');
      organisationId = scope.organisationId ?? undefined;
    } else {
      organisationId = await ctx.runQuery(internalRefs.settings.orgScope, { token: args.token });
    }

    const data = await ctx.runQuery(internalRefs.auditData.snapshotRows, { jobId, organisationId });

    const demographics = new Map<string, DemographicPayload>();
    for (const declaration of data.declarations) {
      try {
        demographics.set(declaration.userId, open<DemographicPayload>(declaration.payload));
      } catch {
        // A record encrypted with a rotated key is skipped, never guessed at.
      }
    }

    const rows: Row[] = data.applications.map((a: SnapshotApplication) => ({
      id: a.id,
      stage: a.stage,
      score: a.score,
      createdAt: a.createdAt,
      candidateId: a.candidateId,
      jobId: a.jobId,
      jobTitle: a.jobTitle,
      orgId: a.organisationId,
      aiRecommendedStage: a.aiRecommendedStage,
      parsedCv: (a.parsedCv as ParsedCVData | null) ?? null,
      cvText: a.cvText,
      history: new Set(a.historyStages),
      demo: demographics.get(a.candidateId) ?? null,
    }));

    const stageDefinitions: { stage: StageName; next: StageName; label: string }[] = [
      { stage: 'SCREENED', next: 'SHORTLISTED', label: 'Screened → Shortlisted' },
      { stage: 'SHORTLISTED', next: 'INTERVIEW', label: 'Shortlisted → Interviewed' },
      { stage: 'INTERVIEW', next: 'OFFER', label: 'Interviewed → Offered' },
      { stage: 'OFFER', next: 'HIRED', label: 'Offered → Hired' },
    ];

    const stages = stageDefinitions.map((definition) => {
      const groups: Record<string, unknown> = {};
      let flagged = false;
      for (const dim of DEMOGRAPHIC_DIMENSIONS) {
        const observations: GroupObservation[] = rows
          .filter((row) => row.demo && reachedStage(row, definition.stage))
          .map((row) => ({ group: dimensionValue(row, dim.key), selected: reachedStage(row, definition.next) }))
          .filter((o) => o.group !== 'Not declared');
        const stats = selectionRates(observations, minGroupSize);
        const analysis = adverseImpact(stats, threshold);
        if (analysis.flagged) flagged = true;
        groups[dim.key] = { stats, analysis };
      }
      return { stage: definition.stage, label: definition.label, groups, flagged };
    });

    const proxyRows = rows
      .filter((row) => row.demo && typeof row.score === 'number')
      .map((row) => {
        const cv = row.parsedCv ?? { education: [], experience: [] } as unknown as ParsedCVData;
        const edu = highestEducation(cv);
        const tier =
          edu?.institutionType === 'FEDERAL' ? 3 : edu?.institutionType === 'STATE' ? 2 : edu?.institutionType === 'PRIVATE' ? 1 : 0;
        return {
          group: dimensionValue(row, 'universityType'),
          score: row.score,
          proxies: {
            'CV word count': wordCount(row.cvText),
            'Years of experience': yearsOfExperience(cv),
            'Internships listed': cv.experience?.filter((e) => e.isInternship).length ?? 0,
            'Institution tier': tier,
          },
        };
      });
    const proxyFindings = proxyBias(proxyRows, { minGroupSize, correlationThreshold: 0.3 });

    const overrideAnalysis = DEMOGRAPHIC_DIMENSIONS.map((dim) => {
      const buckets = new Map<string, { total: number; fav: number; dis: number }>();
      for (const row of rows) {
        if (!row.demo) continue;
        const group = dimensionValue(row, dim.key);
        if (group === 'Not declared') continue;
        const bucket = buckets.get(group) ?? { total: 0, fav: 0, dis: 0 };
        bucket.total += 1;
        const advanced = reachedStage(row, 'SHORTLISTED');
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
      const total = groups.reduce((sum, g) => sum + g.total, 0);
      const overallFav = groups.reduce((sum, g) => sum + g.favourableOverrides, 0) / Math.max(1, total);
      const overallDis = groups.reduce((sum, g) => sum + g.disfavourableOverrides, 0) / Math.max(1, total);
      for (const group of groups) {
        if (group.total < minGroupSize) continue;
        const favRatio = overallFav > 0 ? group.favourableRate / overallFav : 1;
        const disRatio = overallDis > 0 ? group.disfavourableRate / overallDis : 1;
        group.flagged = favRatio >= 1.25 || disRatio >= 1.25;
      }
      const agreements = rows.filter((row) => {
        if (!row.demo) return false;
        const advanced = reachedStage(row, 'SHORTLISTED');
        const aiRecommended = row.aiRecommendedStage === 'SHORTLISTED' || (row.score ?? 0) >= 60;
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

    const flaggedCf = data.runs.filter((r: CounterfactualRow) => r.flagged).length;
    const maxDelta = data.runs.reduce((max: number, r: CounterfactualRow) => Math.max(max, r.maxDelta), 0);

    const flags: { code: string; severity: string; message: string }[] = [];
    for (const stage of stages) {
      for (const dim of DEMOGRAPHIC_DIMENSIONS) {
        const group = stage.groups[dim.key] as { analysis: ReturnType<typeof adverseImpact> };
        if (!group?.analysis?.flagged) continue;
        const worst = group.analysis.groups.filter((g) => g.flagged).sort((a, b) => a.ratio - b.ratio)[0];
        flags.push({
          code: 'adverse-impact',
          severity: worst?.severity ?? 'moderate',
          message: `${stage.label} — ${dim.label}: ${worst?.group} selected at ${Math.round((worst?.ratio ?? 1) * 100)}% of the ${group.analysis.highestGroup} rate.`,
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
    const declared = rows.filter((row) => row.demo).length;
    if (rows.length === 0) {
      findings.push('No applications exist yet for this scope, so no statistics can be computed.');
    } else if (declared === 0) {
      findings.push(
        'No candidates have completed voluntary self-declaration, so group statistics cannot be computed. Recruitment bias cannot be assessed without this data.',
      );
    } else {
      const flaggedStages = stages.filter((s) => s.flagged);
      if (!flaggedStages.length) {
        findings.push('No stage shows a selection-rate disparity below the four-fifths threshold among groups large enough to report.');
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
    const suppressed = stages
      .flatMap((s) => Object.values(s.groups) as { stats: { suppressed: boolean }[] }[])
      .flatMap((g) => g.stats)
      .filter((s) => s.suppressed);
    if (suppressed.length) {
      sampleWarnings.push(
        `${suppressed.length} group(s) fall below the ${minGroupSize}-person privacy threshold and are suppressed. Aggregating across more jobs may be necessary for a meaningful read.`,
      );
    }
    sampleWarnings.push('Self-declaration is voluntary: candidates who opt out are excluded from group analysis.');

    const methodology = [
      'Selection rate = candidates in a group who advanced past a stage ÷ candidates in that group who reached the stage.',
      `Groups with fewer than ${minGroupSize} people are suppressed to protect privacy.`,
      `Adverse impact ratio = group selection rate ÷ the highest group's selection rate. Ratios below ${threshold} trigger the four-fifths rule flag.`,
      'Proxy detection correlates CV-derived features with both the AI score and group membership (|r| ≥ 0.3).',
      'Override analysis compares the AI recommendation with the human decision and measures one-sided override rates per group.',
      'All figures are aggregate; no recruiter can view an individual applicant’s self-declaration.',
      'Statistical flags indicate possible bias and require human investigation. They are not legal findings of discrimination.',
    ];

    return {
      scope: {
        jobId: jobId ?? null,
        organisationId: organisationId ?? data.jobs[0]?.organisationId ?? null,
        jobTitle: jobId ? data.jobs[0]?.title ?? null : null,
      },
      generatedAt: new Date().toISOString(),
      sampleSize: rows.length,
      declaredSample: declared,
      stages,
      proxyFindings,
      overrideAnalysis,
      counterfactual: { runs: data.runs.length, maxDelta, flagged: flaggedCf },
      flags,
      findings,
      suggestedFixes: [...new Set(suggestedFixes([...new Set(flags.map((f) => f.code))]))],
      sampleWarnings,
      methodology,
      minGroupSize,
      threshold,
    };
  },
});

export const createReport = action({
  args: { token: v.string(), jobId: v.optional(v.id('jobs')), organisationId: v.optional(v.id('organisations')) },
  handler: async (ctx, args) => {
    const snapshotResult = await ctx.runAction(internalRefs.audit.snapshot, {
      token: args.token,
      jobId: args.jobId,
      organisationId: args.organisationId,
    });
    const reportId = await ctx.runMutation(internalRefs.auditWrites.saveReport, {
      token: args.token,
      jobId: args.jobId,
      organisationId: snapshotResult.scope.organisationId ?? undefined,
      summary: snapshotResult,
      flagCount: snapshotResult.flags.length,
      methodology: snapshotResult.methodology.join('\n'),
      sampleSize: snapshotResult.sampleSize,
      flags: snapshotResult.flags,
    });
    return { reportId, snapshot: snapshotResult };
  },
});

export const runCounterfactual = action({
  args: { token: v.string(), jobId: v.id('jobs'), applicationId: v.optional(v.id('applications')), cv: v.optional(v.any()) },
  handler: async (ctx, args) => {
    const scope = await ctx.runQuery(internalRefs.settings.jobScope, { token: args.token, jobId: args.jobId });
    if (!scope.allowed) jsonError('FORBIDDEN', 'You do not have access to that job.');
    const jobData = await ctx.runQuery(internalRefs.settings.jobForScoring, { jobId: args.jobId });
    if (!jobData) jsonError('NOT_FOUND', 'Job not found');

    let baseCv = args.cv as ParsedCVData | undefined;
    if (args.applicationId) {
      const base = await ctx.runQuery(internalRefs.auditData.counterfactualBase, { applicationId: args.applicationId });
      if (!base || base.jobId !== args.jobId) jsonError('NOT_FOUND', 'Application not found for this job');
      if (!base.parsed) jsonError('BAD_REQUEST', 'That application has not been parsed yet.');
      baseCv = base.parsed as ParsedCVData;
    }
    if (!baseCv) jsonError('BAD_REQUEST', 'Choose an application or supply a synthetic CV.');

    const variants = buildVariants(baseCv);
    const results = variants.map((variant) => {
      const scored = evaluateCvForAudit(jobData.job, jobData.criteria, variant.cv);
      return { variantId: variant.id, label: variant.label, total: scored.total, identity: variant.identity };
    });
    const deltas = deltaAgainstBaseline(results);
    const settings = await ctx.runQuery(internalRefs.settings.current, { token: args.token });
    const threshold = settings.counterfactualThreshold;
    const maxDelta = deltas.reduce((max, d) => Math.max(max, Math.abs(d.delta)), 0);
    const flagged = maxDelta >= threshold;

    const runId = await ctx.runMutation(internalRefs.auditWrites.saveCounterfactual, {
      token: args.token,
      jobId: args.jobId,
      baseCv: { skills: baseCv.skills, education: baseCv.education, experience: baseCv.experience },
      variants: variants.map((variant) => ({ id: variant.id, label: variant.label, identity: variant.identity })),
      results: { results, deltas },
      maxDelta,
      threshold,
      flagged,
    });

    return {
      runId,
      maxDelta,
      threshold,
      flagged,
      results: results.map((result) => ({
        ...result,
        delta: deltas.find((d) => d.variantId === result.variantId)?.delta ?? 0,
      })),
      note: flagged
        ? 'Swapping identity signals changed the score beyond the configured threshold. Investigate the rubric before relying on these scores.'
        : 'Swapping identity signals produced no material score change in this run. Keep testing as CVs and criteria change.',
    };
  },
});
