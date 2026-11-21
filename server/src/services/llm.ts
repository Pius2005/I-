import { z } from 'zod';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import type { CriterionInput, ParsedCVData } from '../domain/types.js';

export const llmEnabled = Boolean(env.LLM_API_KEY);

const parsedCvSchema = z.object({
  name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  headline: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  skills: z.array(z.string()).default([]),
  education: z
    .array(
      z.object({
        institution: z.string(),
        institutionType: z.enum(['FEDERAL', 'STATE', 'PRIVATE', 'POLYTECHNIC', 'UNKNOWN']).optional(),
        course: z.string().optional(),
        degreeLevel: z.enum(['SSCE', 'OND', 'HND', 'BSC', 'MSC', 'PHD']).optional(),
        degreeClass: z
          .enum(['FIRST', 'SECOND_UPPER', 'SECOND_LOWER', 'THIRD', 'PASS', 'NONE'])
          .optional(),
        startYear: z.number().nullable().optional(),
        endYear: z.number().nullable().optional(),
      }),
    )
    .default([]),
  experience: z
    .array(
      z.object({
        title: z.string(),
        organisation: z.string().optional(),
        startYear: z.number().nullable().optional(),
        endYear: z.number().nullable().optional(),
        description: z.string().optional(),
        isInternship: z.boolean().optional(),
      }),
    )
    .default([]),
  projects: z
    .array(z.object({ name: z.string(), description: z.string().optional(), technologies: z.array(z.string()).optional() }))
    .default([]),
  certifications: z.array(z.string()).default([]),
  languages: z.array(z.string()).default([]),
});

const PARSE_SYSTEM = `You extract structured data from Nigerian graduate CVs.
Return ONLY a JSON object. Never invent facts: use null or [] when something is absent.
Rules:
- Do not infer gender, age, state of origin, religion or marital status. Omit them entirely.
- Map Nigerian qualifications: "B.Sc"/"B.Eng"/"B.A." -> BSC, HND -> HND, OND -> OND, M.Sc/MBA -> MSC, PhD -> PHD.
- Map degree class: First Class -> FIRST, Second Class Upper / 2:1 / Upper Credit -> SECOND_UPPER,
  Second Class Lower / 2:2 / Lower Credit -> SECOND_LOWER, Third Class -> THIRD, Pass -> PASS.
- institutionType must be one of FEDERAL, STATE, PRIVATE, POLYTECHNIC, UNKNOWN, based only on the
  institution name (Polytechnic => POLYTECHNIC; "State University" => STATE; otherwise UNKNOWN).
- skills must be concrete tools, methods and competencies found in the text.
- Years must be integers. Use null when a date is missing.
JSON shape: {"name":string|null,"email":string|null,"phone":string|null,"location":string|null,
"headline":string|null,"summary":string|null,"skills":string[],
"education":[{"institution":string,"institutionType":string,"course":string,"degreeLevel":string,
"degreeClass":string,"startYear":number|null,"endYear":number|null}],
"experience":[{"title":string,"organisation":string,"startYear":number|null,"endYear":number|null,
"description":string,"isInternship":boolean}],
"projects":[{"name":string,"description":string,"technologies":string[]}],
"certifications":string[],"languages":string[]}`;

async function chatJson<T>(system: string, user: string, validate: (input: unknown) => T): Promise<T | null> {
  if (!llmEnabled) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.LLM_TIMEOUT_MS);
  try {
    const res = await fetch(`${env.LLM_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.LLM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: env.LLM_MODEL,
        temperature: 0,
        top_p: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) {
      logger.warn('llm.http_error', { status: res.status });
      return null;
    }
    const payload = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return null;
    return validate(JSON.parse(content));
  } catch (error) {
    logger.warn('llm.call_failed', { message: (error as Error).message });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function llmParseCv(text: string): Promise<ParsedCVData | null> {
  // Keep prompts within a sane token budget.
  const clipped = text.slice(0, 18000);
  return chatJson(PARSE_SYSTEM, `CV TEXT:\n"""\n${clipped}\n"""`, (input) => {
    const parsed = parsedCvSchema.parse(input);
    return {
      ...parsed,
      education: parsed.education ?? [],
      experience: parsed.experience ?? [],
      projects: parsed.projects ?? [],
      skills: parsed.skills ?? [],
      certifications: parsed.certifications ?? [],
      languages: parsed.languages ?? [],
    } as ParsedCVData;
  });
}

const SCORE_SYSTEM = `You are an evidence-extraction assistant for fair hiring.
You receive a job's weighted criteria and anonymised CV facts. Judge only job-relevant evidence.
Rules:
- Never use name, gender, age, state of origin, religion, marital status, photograph, or university
  prestige to influence a score. Institutional prestige is explicitly forbidden.
- Return ONLY JSON: {"criteria":[{"criterionId":string,"score":number,"rationale":string}]}
- score is between 0 and 1 inclusive, based strictly on evidence for that criterion.
- rationale must quote or paraphrase concrete evidence, max 240 characters.`;

const scoreResponseSchema = z.object({
  criteria: z.array(
    z.object({
      criterionId: z.string(),
      score: z.number().min(0).max(1),
      rationale: z.string().max(400),
    }),
  ),
});

export interface LlmCriterionJudgement {
  criterionId: string;
  score: number;
  rationale: string;
}

export async function llmJudgeCriteria(
  criteria: CriterionInput[],
  cv: ParsedCVData,
): Promise<LlmCriterionJudgement[] | null> {
  const anonymised = {
    skills: cv.skills,
    education: cv.education.map((e) => ({
      course: e.course,
      degreeLevel: e.degreeLevel,
      degreeClass: e.degreeClass,
      startYear: e.startYear,
      endYear: e.endYear,
    })),
    experience: cv.experience,
    projects: cv.projects,
    certifications: cv.certifications,
    languages: cv.languages,
  };
  const payload = {
    criteria: criteria.map((c) => ({ id: c.id, type: c.type, label: c.label, config: c.config })),
    cv: anonymised,
  };
  const result = await chatJson(SCORE_SYSTEM, JSON.stringify(payload), (input) => scoreResponseSchema.parse(input));
  if (!result) return null;
  return result.criteria.filter((c) => criteria.some((crit) => crit.id === c.criterionId));
}

export function llmModelLabel() {
  return llmEnabled ? env.LLM_MODEL : 'rubric-v1';
}
