// Bias-audit engine entry point: pure statistics plus a scoring helper that
// works on plain rows (used by the Node audit action).

export {
  adverseImpact,
  buildVariants,
  deltaAgainstBaseline,
  highestEducation,
  proxyBias,
  selectionRates,
  suggestedFixes,
  yearsOfExperience,
  DEGREE_CLASS_LABEL,
  stripIdentityForScoring,
  scoreApplication,
  type GroupObservation,
  type ParsedCVData,
  type CriterionInput,
  type ScoringResult,
} from './domain';

import { scoreApplication, stripIdentityForScoring, type CriterionInput, type ParsedCVData, type ScoringResult } from './domain';

interface JobLike {
  biasDemoMode: boolean;
}

interface CriterionRow {
  _id: string;
  kind: 'MUST_HAVE' | 'NICE_TO_HAVE';
  type: 'SKILL' | 'DEGREE_LEVEL' | 'DEGREE_CLASS' | 'FIELD_OF_STUDY' | 'EXPERIENCE' | 'CERTIFICATION' | 'LANGUAGE';
  label: string;
  weight: number;
  config: unknown;
  order: number;
}

/** Scores a CV against a job without touching the database. */
export function evaluateCvForAudit(job: JobLike, criteria: CriterionRow[], cv: ParsedCVData): ScoringResult {
  const inputs: CriterionInput[] = [...criteria]
    .sort((a, b) => a.order - b.order)
    .map((c) => ({
      id: c._id,
      kind: c.kind,
      type: c.type,
      label: c.label,
      weight: c.weight,
      config: (c.config ?? {}) as Record<string, unknown>,
    }));
  const blind = stripIdentityForScoring(cv);
  if (!job.biasDemoMode) {
    blind.education = blind.education.map((e) => ({ ...e, institution: '' }));
  }
  return scoreApplication(inputs, blind, {
    biasDemoMode: job.biasDemoMode && process.env.ALLOW_BIAS_DEMO !== 'false',
    llmModel: 'rubric-v1',
    promptVersion: 'deterministic-rubric',
  });
}
