import {
  DEGREE_CLASS_LABEL,
  DEGREE_CLASS_RANK,
  DEGREE_LEVEL_RANK,
  DEGREE_LEVELS,
  highestEducation,
  yearsOfExperience,
  type CriterionInput,
  type CriterionScore,
  type ParsedCVData,
  type ScoringResult,
  type UniversityType,
} from './types.js';

export const RUBRIC_VERSION = 'rubric-v1';

/**
 * Deterministic, explainable scoring.
 *
 * Every criterion produces a 0..1 sub-score with a plain-language rationale.
 * The weight in the job's criteria builder decides how much it counts. Nothing
 * in this module can see name, gender, age, state of origin or photograph —
 * callers pass through stripIdentityForScoring() first.
 */

function normalise(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9+#.\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenise(value: string) {
  return normalise(value).split(' ').filter((t) => t.length > 1);
}

/** Fuzzy skill matching: exact phrase, token subset, or common alias. */
export function skillMatches(required: string, haystack: string[]): boolean {
  const req = normalise(required);
  if (!req) return false;
  const aliases: Record<string, string[]> = {
    javascript: ['js', 'ecmascript', 'node', 'react', 'typescript'],
    'microsoft excel': ['excel', 'spreadsheet', 'spreadsheets'],
    'data analysis': ['analytics', 'data analytics', 'sql', 'power bi'],
    'customer service': ['customer support', 'client service', 'customer care'],
    accounting: ['accountancy', 'bookkeeping', 'financial accounting'],
  };
  const candidates = [req, ...(aliases[req] ?? [])];
  return haystack.some((entry) => {
    const hay = normalise(entry);
    if (!hay) return false;
    if (candidates.some((c) => hay === c || hay.includes(c) || c.includes(hay))) return true;
    const reqTokens = tokenise(req);
    const hayTokens = new Set(tokenise(hay));
    if (!reqTokens.length) return false;
    return reqTokens.every((t) => hayTokens.has(t));
  });
}

function skillHaystack(cv: ParsedCVData) {
  return [
    ...cv.skills,
    ...cv.certifications,
    ...cv.experience.flatMap((e) => [e.title, e.description ?? '']),
    ...cv.projects.flatMap((p) => [p.name, p.description ?? '', ...(p.technologies ?? [])]),
    cv.summary ?? '',
  ].filter(Boolean);
}

function arrayFromConfig(config: Record<string, unknown>, key: string): string[] {
  const value = config[key];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string' && value.trim()) {
    return value.split(',').map((v) => v.trim()).filter(Boolean);
  }
  return [];
}

function levelFromConfig(config: Record<string, unknown>): (typeof DEGREE_LEVELS)[number] {
  const raw = String(config.minLevel ?? config.level ?? 'BSC').toUpperCase();
  if ((DEGREE_LEVELS as readonly string[]).includes(raw)) return raw as (typeof DEGREE_LEVELS)[number];
  if (raw === 'DEGREE' || raw === 'BACHELOR') return 'BSC';
  if (raw === 'MASTERS') return 'MSC';
  return 'BSC';
}

export function scoreCriterion(criterion: CriterionInput, cv: ParsedCVData): CriterionScore {
  const base = {
    criterionId: criterion.id,
    label: criterion.label,
    kind: criterion.kind,
    type: criterion.type,
    weight: criterion.weight,
  };

  const haystack = skillHaystack(cv);
  const education = highestEducation(cv);
  const config = criterion.config ?? {};

  switch (criterion.type) {
    case 'SKILL': {
      const required = arrayFromConfig(config, 'skills').length
        ? arrayFromConfig(config, 'skills')
        : [criterion.label];
      const matched = required.filter((skill) => skillMatches(skill, haystack));
      const missing = required.filter((skill) => !matched.includes(skill));
      const score = required.length ? matched.length / required.length : 0;
      const rationale = required.length
        ? `Matched ${matched.length} of ${required.length} required skill${required.length === 1 ? '' : 's'}${
            missing.length ? `; missing ${missing.slice(0, 3).join(', ')}` : ''
          }.`
        : 'No skills were configured for this criterion.';
      return { ...base, score, rationale, matched, missing };
    }

    case 'DEGREE_LEVEL': {
      const required = levelFromConfig(config);
      const actual = education?.degreeLevel ?? 'SSCE';
      const score = DEGREE_LEVEL_RANK[actual] >= DEGREE_LEVEL_RANK[required] ? 1 : 0;
      return {
        ...base,
        score,
        rationale:
          score === 1
            ? `Holds ${actual}, meeting the ${required} requirement.`
            : `Highest qualification is ${actual}; the role asks for ${required}.`,
        matched: score === 1 ? [actual] : [],
        missing: score === 0 ? [required] : [],
      };
    }

    case 'DEGREE_CLASS': {
      const required = String(config.minClass ?? config.degreeClass ?? 'SECOND_LOWER') as keyof typeof DEGREE_CLASS_RANK;
      const minRank = DEGREE_CLASS_RANK[required] ?? 3;
      if (!education) {
        return {
          ...base,
          score: 0,
          rationale: 'No education history was found, so degree class could not be verified.',
          matched: [],
          missing: [DEGREE_CLASS_LABEL[required] ?? required],
        };
      }
      const actual = education.degreeClass ?? 'NONE';
      const score = DEGREE_CLASS_RANK[actual] >= minRank ? 1 : 0;
      return {
        ...base,
        score,
        rationale: `Degree class recorded as ${DEGREE_CLASS_LABEL[actual]}${
          score === 1
            ? `, meeting the ${DEGREE_CLASS_LABEL[required]} threshold.`
            : `, below the ${DEGREE_CLASS_LABEL[required]} threshold.`
        }`,
        matched: score === 1 ? [DEGREE_CLASS_LABEL[actual]] : [],
        missing: score === 0 ? [DEGREE_CLASS_LABEL[required]] : [],
      };
    }

    case 'FIELD_OF_STUDY': {
      const fields = arrayFromConfig(config, 'fields').length
        ? arrayFromConfig(config, 'fields')
        : [criterion.label];
      const courses = cv.education.map((e) => e.course ?? '').filter(Boolean);
      const matched = fields.filter((field) => courses.some((course) => skillMatches(field, [course])));
      const score = fields.length ? (matched.length ? 1 : 0) : 0;
      return {
        ...base,
        score,
        rationale: matched.length
          ? `Course of study (${courses[0]}) matches ${matched[0]}.`
          : `Course of study${courses.length ? ` (${courses[0]})` : ''} does not match ${fields.join(' / ')}.`,
        matched,
        missing: fields.filter((f) => !matched.includes(f)),
      };
    }

    case 'EXPERIENCE': {
      const minYears = Number(config.minYears ?? 0) || 0;
      const years = yearsOfExperience(cv);
      const score = minYears <= 0 ? 1 : Math.min(1, years / minYears);
      return {
        ...base,
        score,
        rationale:
          minYears <= 0
            ? 'No minimum experience was required.'
            : years >= minYears
              ? `${years} year(s) of experience meets the ${minYears}-year minimum.`
              : `${years} year(s) of experience against a ${minYears}-year requirement.`,
        matched: years > 0 ? [`${years} yrs`] : [],
        missing: years >= minYears ? [] : [`${minYears} yrs`],
      };
    }

    case 'CERTIFICATION': {
      const required = arrayFromConfig(config, 'certifications').length
        ? arrayFromConfig(config, 'certifications')
        : [criterion.label];
      const matched = required.filter((cert) => skillMatches(cert, cv.certifications));
      const score = required.length ? matched.length / required.length : 0;
      return {
        ...base,
        score,
        rationale: matched.length
          ? `Certification${matched.length > 1 ? 's' : ''} listed: ${matched.join(', ')}.`
          : `None of the requested certifications (${required.join(', ')}) were listed.`,
        matched,
        missing: required.filter((c) => !matched.includes(c)),
      };
    }

    case 'LANGUAGE': {
      const required = arrayFromConfig(config, 'languages').length
        ? arrayFromConfig(config, 'languages')
        : [criterion.label];
      const matched = required.filter((lang) => skillMatches(lang, cv.languages));
      const score = required.length ? matched.length / required.length : 0;
      return {
        ...base,
        score,
        rationale: matched.length
          ? `Speaks ${matched.join(', ')}.`
          : `No listed language matches ${required.join(', ')}.`,
        matched,
        missing: required.filter((l) => !matched.includes(l)),
      };
    }

    default:
      return {
        ...base,
        score: 0,
        rationale: 'Unknown criterion type.',
        matched: [],
        missing: [],
      };
  }
}

const UNIVERSITY_PREMIUM: Record<UniversityType, number> = {
  FEDERAL: 8,
  STATE: 2,
  PRIVATE: 0,
  POLYTECHNIC: -10,
  UNKNOWN: 0,
};

export interface ScoreOptions {
  /** Demo-only: mimic a biased employer that rewards federal-university pedigree. */
  biasDemoMode?: boolean;
  llmModel?: string | null;
  promptVersion?: string;
}

export function scoreApplication(
  criteria: CriterionInput[],
  cv: ParsedCVData,
  options: ScoreOptions = {},
): ScoringResult {
  const breakdown = criteria.map((criterion) => scoreCriterion(criterion, cv));
  const totalWeight = breakdown.reduce((sum, c) => sum + c.weight, 0);
  const weighted = breakdown.reduce((sum, c) => sum + c.weight * c.score, 0);
  const baseScore = totalWeight > 0 ? (weighted / totalWeight) * 100 : 0;

  const adjustments: ScoringResult['adjustments'] = [];
  let total = baseScore;

  if (options.biasDemoMode) {
    const edu = highestEducation(cv);
    const type = edu?.institutionType ?? 'UNKNOWN';
    const premium = UNIVERSITY_PREMIUM[type];
    if (premium !== 0) {
      adjustments.push({
        label: 'University pedigree adjustment (demo)',
        points: premium,
        note: `${type.toLowerCase()} institution treated as ${
          premium > 0 ? 'premium' : 'penalty'
        } by the demo rule.`,
      });
      total += premium;
    }
  }

  total = Math.max(0, Math.min(100, Math.round(total)));

  const strengths = breakdown
    .filter((c) => c.score >= 0.8)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 2);
  const gaps = breakdown
    .filter((c) => c.score < 0.5)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3);

  const parts: string[] = [];
  parts.push(
    strengths.length
      ? `Strongest against ${strengths.map((s) => s.label).join(' and ')} (${strengths
          .map((s) => `${Math.round(s.score * 100)}%`)
          .join(', ')}).`
      : 'No criterion scored above 80%.',
  );
  if (gaps.length) {
    parts.push(
      `Gaps: ${gaps
        .map((g) => `${g.label} — ${g.missing.length ? `missing ${g.missing.slice(0, 2).join(', ')}` : g.rationale}`)
        .join('; ')}.`,
    );
  } else {
    parts.push('No material gaps against the stated criteria.');
  }
  if (adjustments.length) {
    parts.push(
      `A non-merit adjustment of ${adjustments
        .map((a) => `${a.points > 0 ? '+' : ''}${a.points}`)
        .join(', ')} points was applied by the demo bias rule.`,
    );
  }
  parts.push('AI screening only recommends; a recruiter makes the final decision.');

  return {
    total,
    breakdown,
    explanation: parts.join(' '),
    adjustments,
    model: options.llmModel || 'rubric-v1',
    promptVersion: options.promptVersion || 'deterministic-rubric',
    rubricVersion: RUBRIC_VERSION,
  };
}

/** AI recommendation derived from score — never an automatic rejection. */
export function recommendationForScore(score: number | null | undefined): 'SHORTLISTED' | 'SCREENED' {
  if (score === null || score === undefined) return 'SCREENED';
  return score >= 60 ? 'SHORTLISTED' : 'SCREENED';
}
