import type { MutationCtx } from '../convex/_generated/server';
import type { Doc, Id } from '../convex/_generated/dataModel';
import { recommendationForScore, scoreApplication, stripIdentityForScoring, type CriterionInput, type ParsedCVData, type ScoringResult } from './domain';
import { writeAudit } from './shared';

export type EvaluableJob = Doc<'jobs'>;

export function toCriterionInputs(criteria: Doc<'jobCriteria'>[]): CriterionInput[] {
  return criteria
    .sort((a, b) => a.order - b.order)
    .map((c) => ({
      id: c._id,
      kind: c.kind,
      type: c.type,
      label: c.label,
      weight: c.weight,
      config: (c.config ?? {}) as Record<string, unknown>,
    }));
}

/** Scores one CV against a job. Identity fields never reach the rubric. */
export function evaluateCv(
  job: EvaluableJob,
  criteria: Doc<'jobCriteria'>[],
  cv: ParsedCVData,
): ScoringResult {
  const inputs = toCriterionInputs(criteria);
  const blindInput = stripIdentityForScoring(cv);
  // University prestige is removed unless the demo bias rule is enabled.
  if (!job.biasDemoMode) {
    blindInput.education = blindInput.education.map((e) => ({ ...e, institution: '' }));
  }
  const allowDemo = job.biasDemoMode && process.env.ALLOW_BIAS_DEMO !== 'false';
  return scoreApplication(inputs, blindInput, {
    biasDemoMode: allowDemo,
    llmModel: 'rubric-v1',
    promptVersion: 'deterministic-rubric',
  });
}

/**
 * Persists a score, sets the AI recommendation and advances APPLIED → SCREENED.
 * AI only recommends; nothing here rejects a candidate.
 */
export async function scoreAndStore(
  ctx: MutationCtx,
  applicationId: Id<'applications'>,
  opts: { cv?: ParsedCVData; source?: 'pipeline' | 'manual' | 'candidate_edit' } = {},
): Promise<ScoringResult | null> {
  const application = await ctx.db.get(applicationId);
  if (!application) return null;
  const job = await ctx.db.get(application.jobId);
  if (!job) return null;
  const parsed = await ctx.db
    .query('parsedCvs')
    .withIndex('by_application', (q) => q.eq('applicationId', applicationId))
    .unique();
  const cv = opts.cv ?? ((parsed?.data as ParsedCVData | undefined) ?? undefined);
  if (!cv) return null;

  const criteria = await ctx.db
    .query('jobCriteria')
    .withIndex('by_job', (q) => q.eq('jobId', job._id))
    .collect();
  const result = evaluateCv(job, criteria, cv);
  const recommendation = recommendationForScore(result.total);
  const now = Date.now();

  await ctx.db.insert('scores', {
    applicationId,
    total: result.total,
    breakdown: result.breakdown,
    explanation: result.explanation,
    model: result.model,
    promptVersion: result.promptVersion,
    rubricVersion: result.rubricVersion,
    createdAt: now,
  });

  const shouldAdvance = application.stage === 'APPLIED';
  await ctx.db.patch(applicationId, {
    score: result.total,
    scoredAt: now,
    aiRecommendedStage: recommendation,
    ...(shouldAdvance ? { stage: 'SCREENED' as const } : {}),
    updatedAt: now,
  });
  if (shouldAdvance) {
    await ctx.db.insert('statusHistory', {
      applicationId,
      fromStage: 'APPLIED',
      toStage: 'SCREENED',
      reason: 'Automated screening completed; awaiting human review.',
      createdAt: now,
    });
  }
  await writeAudit(ctx, null, 'AUTOMATED_SCORE', 'Application', applicationId, {
    total: result.total,
    model: result.model,
    promptVersion: result.promptVersion,
    rubricVersion: result.rubricVersion,
    source: opts.source ?? 'pipeline',
  });
  return result;
}
