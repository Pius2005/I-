/**
 * Iṣẹ́ domain layer — pure functions shared by the Convex functions.
 *
 * Nothing in this module touches the database. Scoring, redaction and parsing
 * are deterministic so a score can always be explained and reproduced.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const DEGREE_CLASSES = ['FIRST', 'SECOND_UPPER', 'SECOND_LOWER', 'THIRD', 'PASS', 'NONE'] as const;
export type DegreeClassValue = (typeof DEGREE_CLASSES)[number];

export const DEGREE_CLASS_RANK: Record<DegreeClassValue, number> = {
  NONE: 0,
  PASS: 1,
  THIRD: 2,
  SECOND_LOWER: 3,
  SECOND_UPPER: 4,
  FIRST: 5,
};

export const DEGREE_CLASS_LABEL: Record<DegreeClassValue, string> = {
  FIRST: 'First Class',
  SECOND_UPPER: 'Second Class Upper',
  SECOND_LOWER: 'Second Class Lower',
  THIRD: 'Third Class',
  PASS: 'Pass',
  NONE: 'Not stated',
};

export const DEGREE_LEVELS = ['SSCE', 'OND', 'HND', 'BSC', 'MSC', 'PHD'] as const;
export type DegreeLevel = (typeof DEGREE_LEVELS)[number];

export const DEGREE_LEVEL_RANK: Record<DegreeLevel, number> = {
  SSCE: 0,
  OND: 1,
  HND: 2,
  BSC: 3,
  MSC: 4,
  PHD: 5,
};

export const UNIVERSITY_TYPES = ['FEDERAL', 'STATE', 'PRIVATE', 'POLYTECHNIC', 'UNKNOWN'] as const;
export type UniversityType = (typeof UNIVERSITY_TYPES)[number];

export interface EducationEntry {
  institution: string;
  institutionType?: UniversityType;
  course?: string;
  degreeLevel?: DegreeLevel;
  degreeClass?: DegreeClassValue;
  startYear?: number | null;
  endYear?: number | null;
}

export interface ExperienceEntry {
  title: string;
  organisation?: string;
  startYear?: number | null;
  endYear?: number | null;
  description?: string;
  isInternship?: boolean;
}

export interface ProjectEntry {
  name: string;
  description?: string;
  technologies?: string[];
}

export interface ParsedCVData {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  headline?: string | null;
  summary?: string | null;
  skills: string[];
  education: EducationEntry[];
  experience: ExperienceEntry[];
  projects: ProjectEntry[];
  certifications: string[];
  languages: string[];
}

export const EMPTY_CV: ParsedCVData = {
  name: null,
  email: null,
  phone: null,
  location: null,
  headline: null,
  summary: null,
  skills: [],
  education: [],
  experience: [],
  projects: [],
  certifications: [],
  languages: [],
};

export interface CriterionInput {
  id: string;
  kind: 'MUST_HAVE' | 'NICE_TO_HAVE';
  type: 'SKILL' | 'DEGREE_LEVEL' | 'DEGREE_CLASS' | 'FIELD_OF_STUDY' | 'EXPERIENCE' | 'CERTIFICATION' | 'LANGUAGE';
  label: string;
  weight: number;
  config: Record<string, unknown>;
}

export interface CriterionScore {
  criterionId: string;
  label: string;
  kind: CriterionInput['kind'];
  type: CriterionInput['type'];
  weight: number;
  score: number;
  rationale: string;
  matched: string[];
  missing: string[];
}

export interface ScoringResult {
  total: number;
  breakdown: CriterionScore[];
  explanation: string;
  adjustments: { label: string; points: number; note: string }[];
  model: string;
  promptVersion: string;
  rubricVersion: string;
}

export function normaliseDegreeClass(input?: string | null): DegreeClassValue {
  if (!input) return 'NONE';
  const s = input.toLowerCase();
  if (/(first class|first-class|1st class)/.test(s)) return 'FIRST';
  if (/(second class upper|upper second|2:1|2\.1|upper credit|distinction)/.test(s)) return 'SECOND_UPPER';
  if (/(second class lower|lower second|2:2|2\.2|lower credit|credit)/.test(s)) return 'SECOND_LOWER';
  if (/(third class|3rd class|pass degree)/.test(s)) return 'THIRD';
  if (/\bpass\b/.test(s)) return 'PASS';
  return 'NONE';
}

export function normaliseDegreeLevel(input?: string | null): DegreeLevel {
  if (!input) return 'BSC';
  const s = input.toLowerCase();
  if (/(phd|ph\.d|doctor)/.test(s)) return 'PHD';
  if (/(msc|m\.sc|mba|m\.a\b|master)/.test(s)) return 'MSC';
  if (/(hnd|higher national)/.test(s)) return 'HND';
  if (/(ond|ordinary national)/.test(s)) return 'OND';
  if (/(ssce|waec|neco|o'?level)/.test(s)) return 'SSCE';
  return 'BSC';
}

export function yearsOfExperience(cv: ParsedCVData, nowYear = new Date().getFullYear()): number {
  let months = 0;
  for (const exp of cv.experience) {
    const start = exp.startYear ?? null;
    const end = exp.endYear ?? null;
    if (!start) continue;
    const endYear = end ?? nowYear;
    const span = Math.max(0, endYear - start) * 12;
    months += span > 0 ? span : 6;
  }
  return Math.min(40, Math.round((months / 12) * 10) / 10);
}

export function highestEducation(cv: ParsedCVData): EducationEntry | null {
  if (!cv.education.length) return null;
  return [...cv.education].sort(
    (a, b) => (DEGREE_LEVEL_RANK[b.degreeLevel ?? 'BSC'] ?? 0) - (DEGREE_LEVEL_RANK[a.degreeLevel ?? 'BSC'] ?? 0),
  )[0];
}

// ---------------------------------------------------------------------------
// Scoring — deterministic rubric, no identity inputs
// ---------------------------------------------------------------------------

export const RUBRIC_VERSION = 'rubric-v1';

function normalise(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9+#.\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenise(value: string) {
  return normalise(value).split(' ').filter((t) => t.length > 1);
}

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

function levelFromConfig(config: Record<string, unknown>): DegreeLevel {
  const raw = String(config.minLevel ?? config.level ?? 'BSC').toUpperCase();
  if ((DEGREE_LEVELS as readonly string[]).includes(raw)) return raw as DegreeLevel;
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
      const required = arrayFromConfig(config, 'skills').length ? arrayFromConfig(config, 'skills') : [criterion.label];
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
      const required = String(config.minClass ?? config.degreeClass ?? 'SECOND_LOWER') as DegreeClassValue;
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
      const fields = arrayFromConfig(config, 'fields').length ? arrayFromConfig(config, 'fields') : [criterion.label];
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
      const required = arrayFromConfig(config, 'languages').length ? arrayFromConfig(config, 'languages') : [criterion.label];
      const matched = required.filter((lang) => skillMatches(lang, cv.languages));
      const score = required.length ? matched.length / required.length : 0;
      return {
        ...base,
        score,
        rationale: matched.length ? `Speaks ${matched.join(', ')}.` : `No listed language matches ${required.join(', ')}.`,
        matched,
        missing: required.filter((l) => !matched.includes(l)),
      };
    }

    default:
      return { ...base, score: 0, rationale: 'Unknown criterion type.', matched: [], missing: [] };
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
  biasDemoMode?: boolean;
  llmModel?: string | null;
  promptVersion?: string;
}

export function scoreApplication(criteria: CriterionInput[], cv: ParsedCVData, options: ScoreOptions = {}): ScoringResult {
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
        note: `${type.toLowerCase()} institution treated as ${premium > 0 ? 'premium' : 'penalty'} by the demo rule.`,
      });
      total += premium;
    }
  }

  total = Math.max(0, Math.min(100, Math.round(total)));

  const strengths = breakdown.filter((c) => c.score >= 0.8).sort((a, b) => b.weight - a.weight).slice(0, 2);
  const gaps = breakdown.filter((c) => c.score < 0.5).sort((a, b) => b.weight - a.weight).slice(0, 3);

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

export function recommendationForScore(score: number | null | undefined): 'SHORTLISTED' | 'SCREENED' {
  if (score === null || score === undefined) return 'SCREENED';
  return score >= 60 ? 'SHORTLISTED' : 'SCREENED';
}

// ---------------------------------------------------------------------------
// Blind screening redaction
// ---------------------------------------------------------------------------

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/gi;
const PHONE = /(?:\+?234[\s-]?|0)(?:7|8|9)\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/g;
const URL = /https?:\/\/\S+/gi;

interface RedactOptions {
  hideUniversity?: boolean;
  names?: string[];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function redactText(text: string, options: RedactOptions = {}): string {
  if (!text) return '';
  let out = text.replace(EMAIL, '[email hidden]').replace(PHONE, '[phone hidden]').replace(URL, '[link hidden]');

  for (const name of options.names ?? []) {
    if (!name || name.length < 3) continue;
    out = out.replace(new RegExp(escapeRegExp(name), 'gi'), '[name hidden]');
    for (const part of name.split(/\s+/)) {
      if (part.length >= 3) {
        out = out.replace(new RegExp(`\\b${escapeRegExp(part)}\\b`, 'gi'), '[name hidden]');
      }
    }
  }

  out = out
    .split('\n')
    .filter((line) => !/^\s*(state of origin|date of birth|d\.o\.b|marital status|religion|gender|sex)\s*[:\-]/i.test(line))
    .join('\n');

  if (options.hideUniversity) {
    out = out.replace(
      /(University of [A-Za-z\s]+|University [A-Za-z\s]+|[A-Za-z\s]+ University|[A-Za-z\s]+ Polytechnic)/g,
      '[institution hidden]',
    );
  }
  return out;
}

export function redactCvData(cv: ParsedCVData, options: RedactOptions = {}): ParsedCVData {
  return {
    ...cv,
    name: null,
    email: null,
    phone: null,
    location: null,
    summary: cv.summary ? redactText(cv.summary, options) : null,
    education: cv.education.map((e) => ({
      ...e,
      institution: options.hideUniversity ? '[institution hidden]' : e.institution,
      institutionType: options.hideUniversity ? undefined : e.institutionType,
    })),
    experience: cv.experience.map((e) => ({
      ...e,
      description: e.description ? redactText(e.description, options) : e.description,
    })),
    projects: cv.projects.map((p) => ({
      ...p,
      description: p.description ? redactText(p.description, options) : p.description,
    })),
  };
}

export function stripIdentityForScoring(cv: ParsedCVData): ParsedCVData {
  return { ...cv, name: null, email: null, phone: null, location: null, summary: cv.summary ?? null };
}

export interface IdentityReveal {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
}

export function buildBlindView(args: {
  anonymousRef: string;
  identityRevealed: boolean;
  candidate: IdentityReveal;
  cv: ParsedCVData | null;
  cvText: string | null;
  hideUniversity: boolean;
}) {
  const { anonymousRef, identityRevealed, candidate, cv, cvText, hideUniversity } = args;
  if (identityRevealed) {
    return { anonymousRef, identityRevealed: true, candidate, cv, cvText };
  }
  const names = [candidate.name, candidate.name?.split(' ')[0]].filter(Boolean) as string[];
  return {
    anonymousRef,
    identityRevealed: false,
    candidate: undefined,
    cv: cv ? redactCvData(cv, { hideUniversity, names }) : null,
    cvText: cvText ? redactText(cvText, { hideUniversity, names }) : null,
  };
}

// ---------------------------------------------------------------------------
// Knockout questions — flag, never auto-reject
// ---------------------------------------------------------------------------

export interface KnockoutQuestionInput {
  id: string;
  type: 'NYSC' | 'DEGREE_CLASS' | 'LOCATION' | 'AVAILABILITY' | 'WORK_AUTH';
  prompt: string;
  options: unknown;
  config: unknown;
}

export interface KnockoutFlag {
  questionId: string;
  prompt: string;
  answer: unknown;
  reason: string;
}

export interface KnockoutOutcome {
  passed: boolean;
  flags: KnockoutFlag[];
  answers: { questionId: string; value: unknown; passed: boolean }[];
}

export function evaluateKnockouts(
  questions: KnockoutQuestionInput[],
  answers: Record<string, unknown>,
): KnockoutOutcome {
  const flags: KnockoutFlag[] = [];
  const stored: KnockoutOutcome['answers'] = [];

  for (const question of questions) {
    const config = (question.config ?? {}) as Record<string, unknown>;
    const raw = answers[question.id];
    const value = typeof raw === 'string' ? raw.trim() : raw;
    let passed = true;
    let reason = '';

    if (value === undefined || value === null || value === '') {
      passed = false;
      reason = 'No answer given to this knockout question.';
    } else {
      switch (question.type) {
        case 'NYSC': {
          const accepted = (config.accepted as string[] | undefined) ?? ['COMPLETED', 'SERVING', 'EXEMPTED'];
          passed = accepted.includes(String(value).toUpperCase());
          if (!passed) reason = `NYSC status "${value}" is outside the accepted values (${accepted.join(', ')}).`;
          break;
        }
        case 'DEGREE_CLASS': {
          const min = (config.minClass as string | undefined) ?? 'SECOND_LOWER';
          const minRank = DEGREE_CLASS_RANK[min as DegreeClassValue] ?? 3;
          const actual = normaliseDegreeClass(String(value));
          passed = DEGREE_CLASS_RANK[actual] >= minRank;
          if (!passed)
            reason = `Degree class ${actual.replace('_', ' ').toLowerCase()} is below the required ${min
              .replace('_', ' ')
              .toLowerCase()}.`;
          break;
        }
        case 'LOCATION': {
          const accepted = (config.acceptedLocations as string[] | undefined) ?? [];
          const relocation = Boolean(config.relocation);
          const answer = String(value).toLowerCase();
          if (relocation && /^(yes|true|willing|relocat)/.test(answer)) {
            passed = true;
          } else if (accepted.length) {
            passed = accepted.some((loc) => answer.includes(loc.toLowerCase()));
          }
          if (!passed) reason = `Location answer "${value}" does not meet the role's location or relocation requirement.`;
          break;
        }
        case 'AVAILABILITY': {
          const accepted = (config.accepted as string[] | undefined) ?? ['IMMEDIATE', 'WITHIN_30_DAYS'];
          passed = accepted.map((a) => a.toUpperCase()).includes(String(value).toUpperCase().replace(/\s+/g, '_'));
          if (!passed) reason = `Stated availability "${value}" is later than the role requires.`;
          break;
        }
        case 'WORK_AUTH': {
          const required = config.requiresAuthorisation !== false;
          const affirmatives = ['yes', 'true', 'authorised', 'authorized'];
          passed = required ? affirmatives.includes(String(value).toLowerCase()) : true;
          if (!passed) reason = 'Candidate is not confirmed as authorised to work in Nigeria.';
          break;
        }
        default:
          passed = true;
      }
    }

    stored.push({ questionId: question.id, value: value ?? null, passed });
    if (!passed) flags.push({ questionId: question.id, prompt: question.prompt, answer: value ?? null, reason });
  }

  return { passed: flags.length === 0, flags, answers: stored };
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

function formatUtc(ms: number) {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

function escapeText(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

export function buildIcs(input: {
  uid: string;
  start: number;
  end: number;
  summary: string;
  description: string;
  location?: string | null;
  organiserEmail: string;
  attendeeEmail?: string | null;
  cancelled?: boolean;
}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ise//Interview Scheduling//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${input.cancelled ? 'CANCEL' : 'REQUEST'}`,
    'BEGIN:VEVENT',
    `UID:${input.uid}`,
    `DTSTAMP:${formatUtc(Date.now())}`,
    `DTSTART:${formatUtc(input.start)}`,
    `DTEND:${formatUtc(input.end)}`,
    'SEQUENCE:0',
    `SUMMARY:${escapeText(input.summary)}`,
    `DESCRIPTION:${escapeText(input.description)}`,
    `LOCATION:${escapeText(input.location ?? 'Online')}`,
    `ORGANIZER;CN=Ise:mailto:${input.organiserEmail}`,
  ];
  if (input.attendeeEmail) lines.push(`ATTENDEE;CN=Candidate;RSVP=TRUE:mailto:${input.attendeeEmail}`);
  lines.push(input.cancelled ? 'STATUS:CANCELLED' : 'STATUS:CONFIRMED');
  lines.push(
    'BEGIN:VALARM',
    'TRIGGER:-PT24H',
    'ACTION:DISPLAY',
    'DESCRIPTION:Interview reminder',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  );
  return lines.join('\r\n');
}

export function generateSlots(window: {
  startsAt: number;
  endsAt: number;
  slotMinutes: number;
  bufferMinutes: number;
}): { startsAt: number; slotMinutes: number }[] {
  const slots: { startsAt: number; slotMinutes: number }[] = [];
  const step = (window.slotMinutes + window.bufferMinutes) * 60_000;
  if (step <= 0) return slots;
  for (let t = window.startsAt; t + window.slotMinutes * 60_000 <= window.endsAt; t += step) {
    slots.push({ startsAt: t, slotMinutes: window.slotMinutes });
  }
  return slots;
}

// ---------------------------------------------------------------------------
// Counterfactual identity testing
// ---------------------------------------------------------------------------

export interface CounterfactualVariant {
  id: string;
  label: string;
  cv: ParsedCVData;
  identity: Record<string, string>;
}

const NAME_SWAPS = [
  { label: 'Yoruba-presenting name', name: 'Adebayo Ogunleye', group: 'Yoruba' },
  { label: 'Igbo-presenting name', name: 'Chinedu Okonkwo', group: 'Igbo' },
  { label: 'Hausa-presenting name', name: 'Aisha Bello', group: 'Hausa-Fulani' },
  { label: 'Female-presenting name', name: 'Blessing Eze', group: 'Female' },
  { label: 'Male-presenting name', name: 'Ibrahim Musa', group: 'Male' },
];

export const IDENTITY_SWAPS = {
  universities: [
    { label: 'Federal university', type: 'FEDERAL' as UniversityType, institution: 'University of Lagos' },
    { label: 'State university', type: 'STATE' as UniversityType, institution: 'Lagos State University' },
    { label: 'Private university', type: 'PRIVATE' as UniversityType, institution: 'Covenant University' },
    { label: 'Polytechnic', type: 'POLYTECHNIC' as UniversityType, institution: 'Yaba College of Technology' },
  ],
  states: ['Lagos', 'Kano', 'Enugu', 'Rivers', 'Kaduna'],
};

export function buildVariants(base: ParsedCVData): CounterfactualVariant[] {
  const variants: CounterfactualVariant[] = [{ id: 'baseline', label: 'Baseline (as submitted)', cv: base, identity: {} }];

  for (const swap of NAME_SWAPS) {
    variants.push({
      id: `name:${swap.group}`,
      label: swap.label,
      cv: { ...base, name: swap.name },
      identity: { name: swap.name, group: swap.group },
    });
  }

  if (base.education.length) {
    for (const uni of IDENTITY_SWAPS.universities) {
      variants.push({
        id: `university:${uni.type}`,
        label: `Same qualifications, ${uni.label}`,
        cv: {
          ...base,
          education: base.education.map((e, i) =>
            i === 0 ? { ...e, institution: uni.institution, institutionType: uni.type } : e,
          ),
        },
        identity: { institution: uni.institution, type: uni.type },
      });
    }
  }

  return variants;
}

export function deltaAgainstBaseline(results: { variantId: string; total: number }[]) {
  const baseline = results.find((r) => r.variantId === 'baseline')?.total ?? 0;
  return results.map((r) => ({ variantId: r.variantId, delta: r.total - baseline }));
}

// ---------------------------------------------------------------------------
// Bias-audit statistics
// ---------------------------------------------------------------------------

export interface GroupObservation {
  group: string;
  selected: boolean;
  value?: number;
  score?: number | null;
}

export interface GroupStat {
  group: string;
  total: number;
  selected: number;
  rate: number;
  suppressed: boolean;
}

export type Severity = 'none' | 'moderate' | 'high' | 'severe';

export interface ImpactResult {
  group: string;
  total: number;
  selected: number;
  rate: number;
  ratio: number;
  severity: Severity;
  flagged: boolean;
  suppressed: boolean;
}

export interface ImpactAnalysis {
  highestGroup: string | null;
  highestRate: number;
  groups: ImpactResult[];
  flagged: boolean;
  summary: string;
}

export function selectionRates(observations: GroupObservation[], minGroupSize = 5): GroupStat[] {
  const buckets = new Map<string, { total: number; selected: number }>();
  for (const obs of observations) {
    const key = obs.group || 'Not declared';
    const bucket = buckets.get(key) ?? { total: 0, selected: 0 };
    bucket.total += 1;
    if (obs.selected) bucket.selected += 1;
    buckets.set(key, bucket);
  }
  return [...buckets.entries()]
    .map(([group, { total, selected }]) => ({
      group,
      total,
      selected,
      rate: total ? selected / total : 0,
      suppressed: total < minGroupSize,
    }))
    .sort((a, b) => b.rate - a.rate || b.total - a.total);
}

function severityFor(ratio: number, suppressed: boolean): Severity {
  if (suppressed) return 'none';
  if (ratio < 0.5) return 'severe';
  if (ratio < 0.67) return 'high';
  if (ratio < 0.8) return 'moderate';
  return 'none';
}

export function adverseImpact(groups: GroupStat[], threshold = 0.8): ImpactAnalysis {
  const eligible = groups.filter((g) => !g.suppressed && g.total > 0);
  if (eligible.length < 2) {
    return {
      highestGroup: eligible[0]?.group ?? null,
      highestRate: eligible[0]?.rate ?? 0,
      groups: groups.map((g) => ({ ...g, ratio: 1, severity: 'none' as Severity, flagged: false })),
      flagged: false,
      summary: 'Not enough declared groups above the privacy threshold to run an adverse-impact test.',
    };
  }
  const highest = eligible.reduce((best, g) => (g.rate > best.rate ? g : best), eligible[0]);
  const results: ImpactResult[] = groups.map((g) => {
    const ratio = highest.rate > 0 ? g.rate / highest.rate : 1;
    return {
      group: g.group,
      total: g.total,
      selected: g.selected,
      rate: g.rate,
      ratio: Number(ratio.toFixed(3)),
      severity: severityFor(ratio, g.suppressed),
      flagged: !g.suppressed && ratio < threshold,
      suppressed: g.suppressed,
    };
  });
  const flagged = results.some((r) => r.flagged);
  const worst = results.filter((r) => r.flagged).sort((a, b) => a.ratio - b.ratio)[0];
  return {
    highestGroup: highest.group,
    highestRate: highest.rate,
    groups: results,
    flagged,
    summary: flagged
      ? `The ${worst.group} group is selected at ${Math.round(worst.ratio * 100)}% of the rate of the ${highest.group} group.`
      : 'No group fell below the four-fifths threshold at this stage.',
  };
}

export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;
  const meanX = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const meanY = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const a = xs[i] - meanX;
    const b = ys[i] - meanY;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return 0;
  return num / Math.sqrt(dx * dy);
}

export function pointBiserial(isGroup: boolean[], values: number[]): number {
  return pearson(
    isGroup.map((b) => (b ? 1 : 0)),
    values,
  );
}

export interface ProxyFinding {
  proxy: string;
  correlationWithScore: number;
  strongestGroup: string | null;
  correlationWithGroup: number;
  sampleSize: number;
  flagged: boolean;
  note: string;
}

export function proxyBias(
  rows: { group: string; score: number | null; proxies: Record<string, number> }[],
  opts: { minGroupSize?: number; correlationThreshold?: number } = {},
): ProxyFinding[] {
  const minGroup = opts.minGroupSize ?? 5;
  const corrThreshold = opts.correlationThreshold ?? 0.3;
  const usable = rows.filter((r) => typeof r.score === 'number');
  if (usable.length < 6) return [];

  const groups = [...new Set(usable.map((r) => r.group))].filter(
    (g) => usable.filter((r) => r.group === g).length >= minGroup,
  );
  const proxies = [...new Set(usable.flatMap((r) => Object.keys(r.proxies)))];
  const findings: ProxyFinding[] = [];

  for (const proxy of proxies) {
    const values = usable.map((r) => Number(r.proxies[proxy] ?? 0));
    const scores = usable.map((r) => Number(r.score));
    const corrScore = Number(pearson(values, scores).toFixed(3));
    let strongestGroup: string | null = null;
    let strongest = 0;
    for (const group of groups) {
      const flags = usable.map((r) => r.group === group);
      const corr = pointBiserial(flags, values);
      if (Math.abs(corr) > Math.abs(strongest)) {
        strongest = corr;
        strongestGroup = group;
      }
    }
    const corrGroup = Number(strongest.toFixed(3));
    const flagged = Math.abs(corrGroup) >= corrThreshold && Math.abs(corrScore) >= corrThreshold;
    findings.push({
      proxy,
      correlationWithScore: corrScore,
      strongestGroup,
      correlationWithGroup: corrGroup,
      sampleSize: usable.length,
      flagged,
      note: flagged
        ? `${proxy} tracks both the AI score and the ${strongestGroup} group. Investigate whether it is acting as a proxy for identity.`
        : `${proxy} shows no material joint correlation with group and score.`,
    });
  }
  return findings.sort((a, b) => Math.abs(b.correlationWithScore) - Math.abs(a.correlationWithScore));
}

export function suggestedFixes(flagged: string[]): string[] {
  const map: Record<string, string> = {
    'selection-rate':
      'Review the screening criteria that drive this stage and remove requirements that are not genuinely job-related.',
    'adverse-impact':
      'Loosen or reweight criteria where the gap appears, blind university names, and have a human review the lowest-scoring group’s applications.',
    'proxy-bias':
      'Stop using the flagged feature in scoring — it is standing in for identity. Replace it with a direct, job-relevant measure.',
    counterfactual:
      'Scoring changes when identity signals change. Re-examine the prompt/rubric and remove features that encode identity.',
    override:
      'Overrides favour one group. Require written justification and second-reviewer sign-off for overrides.',
  };
  return flagged.map((f) => map[f] ?? 'Manually review the flagged pattern with the hiring panel.');
}

// ---------------------------------------------------------------------------
// Heuristic Nigerian-CV parser
// ---------------------------------------------------------------------------

const FEDERAL_INSTITUTIONS = [
  'university of lagos', 'university of ibadan', 'obafemi awolowo', 'university of nigeria',
  'ahmadu bello university', 'university of benin', 'university of ilorin', 'university of port harcourt',
  'university of calabar', 'university of jos', 'university of maiduguri', 'bayero university',
  'nnamdi azikiwe', 'federal university of technology', 'federal university', 'university of abuja',
  'university of uyo', 'university of agriculture', 'michael okpara', 'alex ekwueme',
  'yaba college of technology', 'kaduna polytechnic', 'auchi polytechnic', 'federal polytechnic',
  'nigeria defence academy', 'university of ilesha', 'university of abuja',
];

const PRIVATE_INSTITUTIONS = [
  'covenant university', 'babcock', 'bowen university', 'redeemer', 'lead city', 'afe babalola',
  'bells university', 'madonna university', 'igbinedion', 'caleb university', 'veritas university',
  'achievers university', 'elizade', 'american university of nigeria', 'pan-atlantic', 'pan atlantic',
  'baze university', 'chrisland university', 'gregory university', 'novena university',
  'caritas university', 'godfrey okoye', 'mountain top university', 'landmark university',
];

const SKILL_LEXICON = [
  'microsoft office', 'microsoft excel', 'excel', 'word', 'powerpoint', 'google workspace',
  'python', 'javascript', 'typescript', 'react', 'node.js', 'nodejs', 'sql', 'mysql', 'postgresql',
  'mongodb', 'html', 'css', 'java', 'php', 'laravel', 'django', 'flask', 'spring boot', 'git',
  'github', 'docker', 'aws', 'azure', 'linux', 'rest api', 'graphql', 'figma', 'canva',
  'data analysis', 'data analytics', 'power bi', 'tableau', 'spss', 'stata', 'r', 'machine learning',
  'digital marketing', 'seo', 'social media management', 'content writing', 'copywriting',
  'customer service', 'customer support', 'sales', 'business development', 'project management',
  'product management', 'agile', 'scrum', 'accounting', 'bookkeeping', 'quickbooks', 'sage',
  'financial analysis', 'auditing', 'taxation', 'payroll', 'human resources', 'recruitment',
  'operations management', 'supply chain', 'logistics', 'procurement', 'inventory management',
  'autocad', 'solidworks', 'matlab', 'revit', 'civil engineering', 'mechanical engineering',
  'electrical engineering', 'quality control', 'health safety', 'first aid', 'teaching',
  'lesson planning', 'curriculum development', 'nursing', 'phlebotomy', 'public health',
  'communication', 'teamwork', 'leadership', 'problem solving', 'time management',
  'critical thinking', 'negotiation', 'report writing', 'presentation', 'stakeholder management',
];

const CERTIFICATION_LEXICON = [
  'ican', 'acca', 'cipm', 'cima', 'pmp', 'prince2', 'ccna', 'ccnp', 'comptia', 'aws certified',
  'azure', 'google analytics', 'google digital skills', 'hubspot', 'microsoft certified',
  'scrum master', 'six sigma', 'nysc discharge', 'nysc certificate', 'cfa', 'cisa', 'itil',
];

const LANGUAGE_LEXICON = ['english', 'yoruba', 'igbo', 'hausa', 'french', 'arabic', 'pidgin', 'kanuri', 'tiv', 'fulfulde', 'edo', 'efik'];

const NIGERIAN_STATES = [
  'abia', 'adamawa', 'akwa ibom', 'anambra', 'bauchi', 'bayelsa', 'benue', 'borno', 'cross river',
  'delta', 'ebonyi', 'edo', 'ekiti', 'enugu', 'gombe', 'imo', 'jigawa', 'kaduna', 'kano', 'katsina',
  'kebbi', 'kogi', 'kwara', 'lagos', 'nasarawa', 'niger', 'ogun', 'ondo', 'osun', 'oyo', 'plateau',
  'rivers', 'sokoto', 'taraba', 'yobe', 'zamfara', 'abuja', 'fct',
];

export function inferInstitutionType(institution: string): UniversityType {
  const name = institution.toLowerCase();
  if (/polytechnic|college of technology|college of education/.test(name)) return 'POLYTECHNIC';
  if (PRIVATE_INSTITUTIONS.some((p) => name.includes(p))) return 'PRIVATE';
  if (/state university|state polytechnic|state college/.test(name)) return 'STATE';
  if (FEDERAL_INSTITUTIONS.some((f) => name.includes(f))) return 'FEDERAL';
  return 'UNKNOWN';
}

function sectionise(text: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current = 'header';
  sections.set(current, []);
  const headers: [RegExp, string][] = [
    [/^(education|academic|qualifications?)/i, 'education'],
    [/^(work experience|experience|employment|professional experience|career)/i, 'experience'],
    [/^(skills?|technical skills|competenc|core skills)/i, 'skills'],
    [/^(projects?|portfolio)/i, 'projects'],
    [/^(certifications?|certificates?|training|licen[cs]es?)/i, 'certifications'],
    [/^(languages?)/i, 'languages'],
    [/^(profile|summary|objective|about me)/i, 'summary'],
    [/^(referees?|references?|hobbies|interests)/i, 'ignored'],
  ];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const heading = line.replace(/[:\-\s]+$/, '');
    const match = headers.find(([re]) => re.test(heading) && heading.length < 45);
    if (match) {
      current = match[1];
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    sections.get(current)!.push(line);
  }
  return sections;
}

function extractEmail(text: string) {
  return text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? null;
}

function extractPhone(text: string) {
  const match = text.match(/(?:\+?234[\s-]?|0)(?:7|8|9)\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/);
  return match?.[0]?.trim() ?? null;
}

function extractName(sections: Map<string, string[]>): string | null {
  const header = sections.get('header') ?? [];
  for (const line of header.slice(0, 6)) {
    if (/@|\d{4,}|https?:/i.test(line)) continue;
    const words = line.replace(/[^A-Za-z'\- ]/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (words.length >= 2 && words.length <= 5 && line.length <= 60) return words.join(' ');
  }
  return null;
}

function extractLocation(text: string): string | null {
  for (const state of NIGERIAN_STATES) {
    if (new RegExp(`\\b${state}\\b`, 'i').test(text)) {
      return state.replace(/\b\w/g, (c) => c.toUpperCase());
    }
  }
  return null;
}

function parseYearRange(line: string): { start: number | null; end: number | null } {
  const range = line.match(/((?:19|20)\d{2})\s*(?:-|–|—|to)\s*((?:19|20)\d{2}|present|current|date)/i);
  if (range) {
    return { start: Number(range[1]), end: /present|current|date/i.test(range[2]) ? null : Number(range[2]) };
  }
  const single = line.match(/\b((?:19|20)\d{2})\b/);
  return { start: single ? Number(single[1]) : null, end: null };
}

function parseEducation(lines: string[]): EducationEntry[] {
  const entries: EducationEntry[] = [];
  const joined = lines.join('\n');
  const blocks = joined.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const degreeRe = /\b(b\.?\s?sc|b\.?\s?eng|b\.?\s?a\.?|b\.?\s?agric|hnd|ond|m\.?\s?sc|mba|m\.?\s?a|ph\.?\s?d|llb|b\.?\s?ed|nce)\b/i;
  let pending: EducationEntry | null = null;

  for (const line of blocks) {
    const hasInstitution = /university|polytechnic|college|institute/i.test(line);
    const degreeMatch = line.match(degreeRe);
    const classMatch = line.match(/(first class|second class (upper|lower)|upper credit|lower credit|distinction|2:1|2:2|third class|pass)/i);
    const courseMatch = line.match(/\b(?:in|of)\s+([A-Za-z][A-Za-z&\s,.'()-]{3,60})$/i);

    if (hasInstitution) {
      if (pending) entries.push(pending);
      const years = parseYearRange(line);
      pending = {
        institution: line.replace(/\(.*?\)/g, '').trim().slice(0, 160),
        institutionType: inferInstitutionType(line),
        startYear: years.start,
        endYear: years.end,
      };
      if (degreeMatch) pending.degreeLevel = normaliseDegreeLevel(degreeMatch[0]);
      if (classMatch) pending.degreeClass = normaliseDegreeClass(classMatch[0]);
      continue;
    }
    if (degreeMatch && pending) {
      pending.degreeLevel = normaliseDegreeLevel(degreeMatch[0]);
      if (classMatch) pending.degreeClass = normaliseDegreeClass(classMatch[0]);
      if (courseMatch) pending.course = courseMatch[1].trim();
      continue;
    }
    if (classMatch && pending) {
      pending.degreeClass = normaliseDegreeClass(classMatch[0]);
      continue;
    }
    if (degreeMatch && !pending) {
      pending = {
        institution: 'Institution not stated',
        institutionType: 'UNKNOWN',
        degreeLevel: normaliseDegreeLevel(degreeMatch[0]),
        degreeClass: classMatch ? normaliseDegreeClass(classMatch[0]) : 'NONE',
        course: courseMatch?.[1]?.trim(),
      };
    }
  }
  if (pending) entries.push(pending);

  if (!entries.some((e) => e.degreeClass && e.degreeClass !== 'NONE')) {
    const globalClass = joined.match(/(first class|second class upper|second class lower|upper credit|lower credit|2:1|2:2|third class)/i);
    if (globalClass && entries[0]) entries[0].degreeClass = normaliseDegreeClass(globalClass[0]);
  }

  return entries.slice(0, 5);
}

function parseExperience(lines: string[]): ExperienceEntry[] {
  const entries: ExperienceEntry[] = [];
  for (const line of lines) {
    if (line.length < 4) continue;
    const hasDate = /(?:19|20)\d{2}/.test(line);
    const roleHint =
      /(intern|nysc|corper|attach|assistant|officer|manager|analyst|developer|engineer|teacher|volunteer|clerk|supervisor|trainee|consultant|administrator)/i.test(
        line,
      );
    if (!hasDate && !roleHint) continue;
    const years = parseYearRange(line);
    const cleaned = line
      .replace(/((?:19|20)\d{2})\s*(?:-|–|—|to)\s*((?:19|20)\d{2}|present|current|date)/i, '')
      .replace(/[|•-]\s*$/, '')
      .trim();
    const [titlePart, orgPart] = cleaned.split(/\s+(?:at|@|,|-)\s+/);
    entries.push({
      title: (titlePart || cleaned).trim().slice(0, 120),
      organisation: orgPart?.trim().slice(0, 120),
      startYear: years.start,
      endYear: years.end,
      description: line.slice(0, 400),
      isInternship: /intern|attachment|nysc|corper|trainee/i.test(line),
    });
    if (entries.length >= 10) break;
  }
  return entries;
}

function collectFromLexicon(text: string, lexicon: string[], limit = 40) {
  const lower = text.toLowerCase();
  return lexicon
    .filter((entry) => {
      const escaped = entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(lower);
    })
    .slice(0, limit);
}

function parseSkills(section: string[], text: string): string[] {
  const listed = section
    .join(', ')
    .split(/[,;|•·\n/]/)
    .map((s) => s.replace(/^[\s\-–]+/, '').trim())
    .filter((s) => s.length >= 2 && s.length <= 40);
  const found = new Set<string>();
  for (const skill of [...listed, ...collectFromLexicon(text, SKILL_LEXICON)]) {
    if (skill.split(' ').length > 5) continue;
    found.add(skill.replace(/\s+/g, ' '));
  }
  return [...found].slice(0, 40);
}

export function parseCvHeuristically(text: string): ParsedCVData {
  const sections = sectionise(text);
  const headerText = (sections.get('header') ?? []).join('\n');
  const education = parseEducation(sections.get('education') ?? []);
  const experience = parseExperience(sections.get('experience') ?? []);
  const summaryLines = sections.get('summary') ?? [];
  const projectLines = sections.get('projects') ?? [];

  return {
    name: extractName(sections),
    email: extractEmail(headerText) ?? extractEmail(text),
    phone: extractPhone(headerText) ?? extractPhone(text),
    location: extractLocation(headerText),
    headline: summaryLines[0]?.slice(0, 120) ?? null,
    summary: summaryLines.slice(0, 4).join(' ').slice(0, 1200) || null,
    skills: parseSkills(sections.get('skills') ?? [], text),
    education,
    experience,
    projects: projectLines.slice(0, 6).map((line) => ({
      name: line.split(/[-–:]/)[0].trim().slice(0, 120),
      description: line.slice(0, 400),
      technologies: collectFromLexicon(line, SKILL_LEXICON, 6),
    })),
    certifications: [
      ...(sections.get('certifications') ?? []).map((l) => l.slice(0, 120)),
      ...collectFromLexicon(text, CERTIFICATION_LEXICON),
    ]
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .slice(0, 12),
    languages: [
      ...(sections.get('languages') ?? [])
        .join(', ')
        .split(/[,;|/]/)
        .map((l) => l.trim())
        .filter(Boolean),
      ...collectFromLexicon(text, LANGUAGE_LEXICON),
    ]
      .filter((v, i, arr) => arr.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i)
      .slice(0, 8),
  };
}

export function mergeParsedCv(base: ParsedCVData, llm: Partial<ParsedCVData> | null): ParsedCVData {
  if (!llm) return base;
  const pickArray = <T,>(a: T[] | undefined, b: T[]) => (a && a.length ? a : b);
  return {
    name: llm.name ?? base.name,
    email: llm.email ?? base.email,
    phone: llm.phone ?? base.phone,
    location: llm.location ?? base.location,
    headline: llm.headline ?? base.headline,
    summary: llm.summary ?? base.summary,
    skills: [...new Set([...(llm.skills ?? []), ...base.skills])].slice(0, 60),
    education: pickArray(llm.education, base.education),
    experience: pickArray(llm.experience, base.experience),
    projects: pickArray(llm.projects, base.projects),
    certifications: [...new Set([...(llm.certifications ?? []), ...base.certifications])].slice(0, 20),
    languages: [...new Set([...(llm.languages ?? []), ...base.languages])].slice(0, 10),
  };
}
