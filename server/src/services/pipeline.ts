import { env } from '../env.js';
import type { Job } from '@prisma/client';
import { prisma } from '../db.js';
import { logger } from '../lib/logger.js';
import { extractCvText } from './extraction.js';
import { storage } from './storage.js';
import { parseCvHeuristically, mergeParsedCv } from './cv-parser.js';
import { llmEnabled, llmParseCv, llmJudgeCriteria, llmModelLabel } from './llm.js';
import { recommendationForScore } from '../domain/scoring.js';
import { scoreApplication } from '../domain/scoring.js';
import { stripIdentityForScoring } from '../domain/redact.js';
import type { CriterionInput, ParsedCVData, ScoringResult } from '../domain/types.js';

type JobWithCriteria = Job & {
  criteria: { id: string; kind: string; type: string; label: string; weight: number; config: unknown }[];
};

export function toCriterionInputs(job: JobWithCriteria): CriterionInput[] {
  return job.criteria.map((c) => ({
    id: c.id,
    kind: c.kind as CriterionInput['kind'],
    type: c.type as CriterionInput['type'],
    label: c.label,
    weight: c.weight,
    config: (c.config ?? {}) as Record<string, unknown>,
  }));
}

/**
 * Scores one CV against a job without touching the database. Used by the live
 * pipeline and by counterfactual testing (which must not persist scores).
 */
export async function evaluateCv(job: JobWithCriteria, cv: ParsedCVData): Promise<ScoringResult> {
  const criteria = toCriterionInputs(job);
  const blindInput = stripIdentityForScoring(cv);
  // University prestige signals are removed unless the demo bias rule is on.
  if (!job.biasDemoMode) {
    blindInput.education = blindInput.education.map((e) => ({ ...e, institution: '' }));
  }
  const rubric = scoreApplication(criteria, blindInput, {
    biasDemoMode: job.biasDemoMode && env.ALLOW_BIAS_DEMO,
    llmModel: llmModelLabel(),
    promptVersion: env.PROMPT_VERSION,
  });

  if (!llmEnabled) return rubric;

  const judgements = await llmJudgeCriteria(criteria, blindInput);
  if (!judgements?.length) return rubric;

  const byId = new Map(judgements.map((j) => [j.criterionId, j]));
  let blendedWeight = 0;
  let blendedScore = 0;
  const breakdown = rubric.breakdown.map((c) => {
    const judge = byId.get(c.criterionId);
    if (!judge) return c;
    const score = Math.round(((c.score + judge.score) / 2) * 100) / 100;
    blendedWeight += c.weight;
    blendedScore += score * c.weight;
    return {
      ...c,
      score,
      rationale: `${c.rationale} AI reviewer: ${judge.rationale}`.slice(0, 700),
    };
  });

  if (blendedWeight === 0) return rubric;

  const adjustmentsTotal = rubric.adjustments.reduce((sum, a) => sum + a.points, 0);
  const totalWeight = breakdown.reduce((sum, c) => sum + c.weight, 0);
  const base = totalWeight ? (breakdown.reduce((s, c) => s + c.weight * c.score, 0) / totalWeight) * 100 : 0;
  const total = Math.max(0, Math.min(100, Math.round(base + adjustmentsTotal)));

  return {
    ...rubric,
    breakdown,
    total,
    explanation: `${rubric.explanation} Scores combine the deterministic rubric with AI review of the evidence.`.slice(0, 1400),
    model: env.LLM_MODEL,
    promptVersion: env.PROMPT_VERSION,
  };
}

export interface ParsedCvSave {
  parsed: ParsedCVData;
  model: string;
  promptVersion: string;
  rawText: string;
  warning?: string;
}

/** Extract + parse a CV buffer. Throws ApiError(422) when unreadable. */
export async function parseCvBuffer(buffer: Buffer, mimeType: string, filename: string): Promise<ParsedCvSave> {
  const extraction = await extractCvText(buffer, mimeType, filename);
  const base = parseCvHeuristically(extraction.text);
  let parsed = base;
  let model = 'heuristic-v1';
  if (llmEnabled) {
    const llm = await llmParseCv(extraction.text);
    if (llm) {
      parsed = mergeParsedCv(base, llm);
      model = llmModelLabel();
    }
  }
  return { parsed, model, promptVersion: env.PROMPT_VERSION, rawText: extraction.text, warning: extraction.warning };
}

/** Full background job: extract text, parse, store, score, advance the stage. */
export async function processApplicationCv(applicationId: string) {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    include: {
      cvFile: true,
      job: { include: { criteria: true } },
      candidate: { select: { id: true } },
    },
  });
  if (!application || !application.cvFile) return;

  const cvFile = application.cvFile;
  await prisma.cVFile.update({
    where: { id: cvFile.id },
    data: { extractionStatus: 'PROCESSING', extractionError: null },
  });

  try {
    const buffer = await storage.get(cvFile.storageKey);
    const parsedResult = await parseCvBuffer(buffer, cvFile.mimeType, cvFile.filename);

    await prisma.$transaction([
      prisma.cVFile.update({
        where: { id: cvFile.id },
        data: {
          extractionStatus: 'COMPLETED',
          extractedText: parsedResult.rawText.slice(0, 200_000),
          extractionError: null,
        },
      }),
      prisma.parsedCV.upsert({
        where: { applicationId },
        create: {
          applicationId,
          cvFileId: cvFile.id,
          data: parsedResult.parsed as unknown as object,
          parserModel: parsedResult.model,
          promptVersion: parsedResult.promptVersion,
        },
        update: {
          data: parsedResult.parsed as unknown as object,
          parserModel: parsedResult.model,
          promptVersion: parsedResult.promptVersion,
          reviewStatus: 'PARSED',
        },
      }),
    ]);

    await scoreAndStore(applicationId, {
      cv: parsedResult.parsed,
      source: 'pipeline',
    });
    logger.info('cv.processed', { applicationId });
  } catch (error) {
    const message = (error as Error).message;
    await prisma.cVFile
      .update({
        where: { id: cvFile.id },
        data: { extractionStatus: 'FAILED', extractionError: message.slice(0, 500) },
      })
      .catch(() => undefined);
    logger.error('cv.process_failed', { applicationId, message });
  }
}

/** Score an application from stored parsed CV (or a supplied CV). */
export async function scoreAndStore(
  applicationId: string,
  opts: { cv?: ParsedCVData; source?: 'pipeline' | 'manual' | 'candidate_edit' } = {},
): Promise<ScoringResult | null> {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    include: {
      job: { include: { criteria: true } },
      parsedCV: true,
      candidate: { select: { id: true } },
    },
  });
  if (!application) return null;

  const cv = opts.cv ?? (application.parsedCV?.data as unknown as ParsedCVData | undefined);
  if (!cv) return null;

  const result = await evaluateCv(application.job, cv);
  const recommendation = recommendationForScore(result.total);

  await prisma.$transaction(async (tx) => {
    await tx.score.create({
      data: {
        applicationId,
        total: result.total,
        breakdown: result.breakdown as unknown as object,
        explanation: result.explanation,
        model: result.model,
        promptVersion: result.promptVersion,
        rubricVersion: result.rubricVersion,
      },
    });
    const shouldAdvance = application.stage === 'APPLIED';
    await tx.application.update({
      where: { id: applicationId },
      data: {
        score: result.total,
        scoredAt: new Date(),
        aiRecommendedStage: recommendation,
        ...(shouldAdvance ? { stage: 'SCREENED' as const } : {}),
      },
    });
    if (shouldAdvance) {
      await tx.statusHistory.create({
        data: {
          applicationId,
          fromStage: 'APPLIED',
          toStage: 'SCREENED',
          reason: 'Automated screening completed; awaiting human review.',
        },
      });
    }
    await tx.auditLog.create({
      data: {
        actorRole: 'SYSTEM',
        action: 'AUTOMATED_SCORE',
        entityType: 'Application',
        entityId: applicationId,
        metadata: {
          total: result.total,
          model: result.model,
          promptVersion: result.promptVersion,
          rubricVersion: result.rubricVersion,
          source: opts.source ?? 'pipeline',
        },
      },
    });
  });

  return result;
}
