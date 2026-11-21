// Shared domain types used by parsing, scoring, redaction and the audit engine.

export const DEGREE_CLASSES = [
  'FIRST',
  'SECOND_UPPER',
  'SECOND_LOWER',
  'THIRD',
  'PASS',
  'NONE',
] as const;
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
  score: number; // 0..1
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

/** Normalise free-text degree class found on Nigerian CVs. */
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

export function yearsOfExperience(cv: ParsedCVData, now = new Date()): number {
  let months = 0;
  for (const exp of cv.experience) {
    const start = exp.startYear ?? null;
    const end = exp.endYear ?? null;
    if (!start) continue;
    const endYear = end ?? now.getFullYear();
    const span = Math.max(0, endYear - start) * 12;
    months += span > 0 ? span : 6;
  }
  return Math.min(40, Math.round((months / 12) * 10) / 10);
}

export function highestEducation(cv: ParsedCVData): EducationEntry | null {
  if (!cv.education.length) return null;
  return [...cv.education].sort(
    (a, b) =>
      (DEGREE_LEVEL_RANK[b.degreeLevel ?? 'BSC'] ?? 0) -
      (DEGREE_LEVEL_RANK[a.degreeLevel ?? 'BSC'] ?? 0),
  )[0];
}
