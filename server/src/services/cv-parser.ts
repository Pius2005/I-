import {
  normaliseDegreeClass,
  normaliseDegreeLevel,
  type EducationEntry,
  type ExperienceEntry,
  type ParsedCVData,
  type UniversityType,
} from '../domain/types.js';

/**
 * Heuristic Nigerian-CV parser.
 *
 * Used when no LLM key is configured, and as the base that LLM output is merged
 * onto. It is deliberately conservative: it never guesses gender, age, religion
 * or ethnicity, because those must never reach the scorer.
 */

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
    if (words.length >= 2 && words.length <= 5 && line.length <= 60) {
      return words.join(' ');
    }
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
    return {
      start: Number(range[1]),
      end: /present|current|date/i.test(range[2]) ? null : Number(range[2]),
    };
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
    const classMatch = line.match(
      /(first class|second class (upper|lower)|upper credit|lower credit|distinction|2:1|2:2|third class|pass)/i,
    );
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

  // Attach degree class by scanning the education block for the nearest class line.
  if (!entries.some((e) => e.degreeClass && e.degreeClass !== 'NONE')) {
    const globalClass = joined.match(
      /(first class|second class upper|second class lower|upper credit|lower credit|2:1|2:2|third class)/i,
    );
    if (globalClass && entries[0]) entries[0].degreeClass = normaliseDegreeClass(globalClass[0]);
  }

  return entries.slice(0, 5);
}

function parseExperience(lines: string[]): ExperienceEntry[] {
  const entries: ExperienceEntry[] = [];
  for (const line of lines) {
    if (line.length < 4) continue;
    const hasDate = /(?:19|20)\d{2}/.test(line);
    const roleHint = /(intern|nysc|corper|attach|assistant|officer|manager|analyst|developer|engineer|teacher|volunteer|clerk|supervisor|trainee|consultant|administrator)/i.test(line);
    if (!hasDate && !roleHint && line.length > 90) continue;
    if (!hasDate && !roleHint) continue;
    const years = parseYearRange(line);
    const cleaned = line.replace(/((?:19|20)\d{2})\s*(?:-|–|—|to)\s*((?:19|20)\d{2}|present|current|date)/i, '').replace(/[|•-]\s*$/, '').trim();
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
  return lexicon.filter((entry) => {
    const escaped = entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(lower);
  }).slice(0, limit);
}

function parseSkills(section: string[], text: string): string[] {
  const listed = section
    .join(', ')
    .split(/[,;|•·\n\/]/)
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

/** Merge LLM output over the heuristic base, keeping whichever has more data. */
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
