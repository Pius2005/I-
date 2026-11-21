/**
 * Iṣẹ́ demo seed.
 *
 * Creates 1 admin, 2 organisations with recruiters, 6 jobs, 150 synthetic
 * Nigerian candidates (real PDF CVs written to storage), applications with
 * parsed CVs and scores, shortlisting decisions, availability and one upcoming
 * interview, plus a generated bias report for the deliberately biased demo job.
 *
 * WARNING: this deletes existing data. It refuses to run when NODE_ENV=production.
 */
import crypto from 'node:crypto';
import PDFDocument from 'pdfkit';
import { PrismaClient } from '@prisma/client';
import { anonymousRef, hashPassword, sealJson } from '../src/lib/crypto.js';
import { storage } from '../src/services/storage.js';
import { parseCvHeuristically } from '../src/services/cv-parser.js';
import { evaluateCv } from '../src/services/pipeline.js';
import { recommendationForScore } from '../src/domain/scoring.js';
import { buildAuditSnapshot } from '../src/services/audit-service.js';
import { registerPdfFonts } from '../src/services/pdf-fonts.js';

const prisma = new PrismaClient();

if (process.env.NODE_ENV === 'production') {
  // eslint-disable-next-line no-console
  console.error('Refusing to seed a production database.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Synthetic data pools
// ---------------------------------------------------------------------------
const YORUBA_M = ['Adebayo', 'Oluwaseun', 'Tunde', 'Femi', 'Kayode', 'Gbenga', 'Segun', 'Wale'];
const YORUBA_F = ['Aderonke', 'Titilayo', 'Bisola', 'Funke', 'Yetunde', 'Kemi', 'Modupe', 'Sade'];
const IGBO_M = ['Chinedu', 'Emeka', 'Obinna', 'Ifeanyi', 'Uchenna', 'Tochukwu', 'Nnamdi', 'Chukwudi'];
const IGBO_F = ['Ngozi', 'Chiamaka', 'Adaeze', 'Ijeoma', 'Nneka', 'Chidinma', 'Amarachi', 'Oluchi'];
const HAUSA_M = ['Ibrahim', 'Musa', 'Abdulrahman', 'Sani', 'Yusuf', 'Bello', 'Nasiru', 'Suleiman'];
const HAUSA_F = ['Aisha', 'Halima', 'Fatima', 'Zainab', 'Maryam', 'Hauwa', 'Safiya', 'Rukayat'];

const SURNAMES = {
  yoruba: ['Ogunleye', 'Adeyemi', 'Balogun', 'Akinwale', 'Oladipo', 'Fashola', 'Alabi', 'Ajayi'],
  igbo: ['Okonkwo', 'Eze', 'Nwosu', 'Obi', 'Chukwu', 'Okafor', 'Anyanwu', 'Nnaji'],
  hausa: ['Bello', 'Sani', 'Musa', 'Abubakar', 'Yusuf', 'Ibrahim', 'Lawal', 'Garba'],
};

const UNIVERSITIES = {
  federal: [
    'University of Lagos',
    'University of Ibadan',
    'Obafemi Awolowo University',
    'University of Nigeria, Nsukka',
    'Ahmadu Bello University',
    'University of Benin',
    'Federal University of Technology, Akure',
    'University of Ilorin',
  ],
  state: [
    'Lagos State University',
    'Olabisi Onabanjo University',
    'Ekiti State University',
    'Enugu State University of Science and Technology',
    'Kaduna State University',
    'Rivers State University',
  ],
  private: [
    'Covenant University',
    'Babcock University',
    'Bowen University',
    'Lead City University',
    'Baze University',
    'Caleb University',
  ],
  polytechnic: [
    'Yaba College of Technology',
    'Kaduna Polytechnic',
    'Auchi Polytechnic',
    'The Polytechnic, Ibadan',
    'Federal Polytechnic, Nekede',
    'Gateway Polytechnic, Saapade',
  ],
};

const COURSES = [
  'Computer Science',
  'Software Engineering',
  'Economics',
  'Accounting',
  'Business Administration',
  'Mass Communication',
  'Statistics',
  'Electrical Engineering',
  'Marketing',
  'Finance',
  'Mathematics',
  'English Language',
];

const STATE_BY_GROUP: Record<string, string[]> = {
  yoruba: ['Lagos', 'Ogun', 'Oyo', 'Osun', 'Ondo', 'Ekiti'],
  igbo: ['Enugu', 'Anambra', 'Imo', 'Abia', 'Ebonyi'],
  hausa: ['Kano', 'Kaduna', 'Katsina', 'Bauchi', 'Sokoto'],
};

const SKILL_POOLS = {
  tech: ['JavaScript', 'React', 'Node.js', 'TypeScript', 'Git', 'SQL', 'HTML', 'CSS', 'REST API', 'Python'],
  data: ['Excel', 'SQL', 'Power BI', 'Tableau', 'Python', 'Data Analysis', 'SPSS', 'Statistics'],
  finance: ['Accounting', 'Excel', 'QuickBooks', 'Sage', 'Financial Analysis', 'Auditing', 'Bookkeeping'],
  marketing: ['Digital Marketing', 'SEO', 'Social Media Management', 'Canva', 'Content Writing', 'Copywriting'],
  business: ['Customer Service', 'Communication', 'Microsoft Office', 'Project Management', 'Teamwork', 'Negotiation'],
};

const CERTS = ['ICAN', 'ACCA', 'CIPM', 'Google Analytics', 'HubSpot', 'Microsoft Certified', 'PMP', 'NYSC Discharge'];

const JOBS = [
  {
    title: 'Graduate Software Engineer',
    org: 'federaltech',
    description:
      'Join a product team building payment infrastructure for Nigerian SMEs. You will ship React and Node.js features, pair with senior engineers, and take part in a structured six-month graduate programme with mentorship, code review and quarterly reviews.',
    location: 'Lagos (Hybrid)',
    employmentType: 'FULL_TIME' as const,
    blindScreening: true,
    biasDemoMode: false,
    criteria: [
      { kind: 'MUST_HAVE' as const, type: 'SKILL' as const, label: 'Core JavaScript/TypeScript', weight: 25, config: { skills: ['JavaScript', 'TypeScript', 'React'] } },
      { kind: 'MUST_HAVE' as const, type: 'SKILL' as const, label: 'Version control', weight: 10, config: { skills: ['Git'] } },
      { kind: 'MUST_HAVE' as const, type: 'DEGREE_LEVEL' as const, label: 'Bachelor degree or HND', weight: 10, config: { minLevel: 'BSC' } },
      { kind: 'MUST_HAVE' as const, type: 'DEGREE_CLASS' as const, label: 'Minimum Second Class Lower', weight: 10, config: { minClass: 'SECOND_LOWER' } },
      { kind: 'MUST_HAVE' as const, type: 'FIELD_OF_STUDY' as const, label: 'Computing or engineering field', weight: 15, config: { fields: ['Computer Science', 'Software Engineering', 'Electrical Engineering', 'Mathematics'] } },
      { kind: 'NICE_TO_HAVE' as const, type: 'EXPERIENCE' as const, label: 'One year of experience or internship', weight: 15, config: { minYears: 1 } },
      { kind: 'NICE_TO_HAVE' as const, type: 'SKILL' as const, label: 'Databases', weight: 10, config: { skills: ['SQL'] } },
      { kind: 'NICE_TO_HAVE' as const, type: 'LANGUAGE' as const, label: 'English', weight: 5, config: { languages: ['English'] } },
    ],
  },
  {
    title: 'Data Analyst (Graduate)',
    org: 'lagosfintech',
    description:
      'Work with the credit team to turn lending data into decisions. You will build dashboards, clean messy datasets, and present weekly insights to the risk committee. Strong Excel and SQL are essential; Power BI is a plus.',
    location: 'Lagos (On-site)',
    employmentType: 'FULL_TIME' as const,
    blindScreening: true,
    biasDemoMode: false,
    criteria: [
      { kind: 'MUST_HAVE' as const, type: 'SKILL' as const, label: 'Spreadsheet and SQL analysis', weight: 25, config: { skills: ['Excel', 'SQL'] } },
      { kind: 'MUST_HAVE' as const, type: 'SKILL' as const, label: 'Visualisation tools', weight: 15, config: { skills: ['Power BI', 'Tableau'] } },
      { kind: 'MUST_HAVE' as const, type: 'DEGREE_LEVEL' as const, label: 'Bachelor degree', weight: 10, config: { minLevel: 'BSC' } },
      { kind: 'MUST_HAVE' as const, type: 'DEGREE_CLASS' as const, label: 'Minimum Second Class Lower', weight: 10, config: { minClass: 'SECOND_LOWER' } },
      { kind: 'MUST_HAVE' as const, type: 'FIELD_OF_STUDY' as const, label: 'Numeric discipline', weight: 15, config: { fields: ['Statistics', 'Economics', 'Mathematics', 'Computer Science'] } },
      { kind: 'NICE_TO_HAVE' as const, type: 'EXPERIENCE' as const, label: 'One year of experience', weight: 10, config: { minYears: 1 } },
      { kind: 'NICE_TO_HAVE' as const, type: 'CERTIFICATION' as const, label: 'Analytics certification', weight: 10, config: { certifications: ['Google Analytics'] } },
      { kind: 'NICE_TO_HAVE' as const, type: 'LANGUAGE' as const, label: 'English', weight: 5, config: { languages: ['English'] } },
    ],
  },
  {
    title: 'Customer Success Associate',
    org: 'lagosfintech',
    description:
      'Be the first human our merchants meet. You will onboard new businesses, resolve issues over phone and WhatsApp, and turn feedback into product improvements. Excellent written and spoken communication is essential.',
    location: 'Abuja (Hybrid)',
    employmentType: 'FULL_TIME' as const,
    blindScreening: false,
    biasDemoMode: false,
    criteria: [
      { kind: 'MUST_HAVE' as const, type: 'SKILL' as const, label: 'Customer support skills', weight: 25, config: { skills: ['Customer Service', 'Communication'] } },
      { kind: 'MUST_HAVE' as const, type: 'SKILL' as const, label: 'Office and CRM tools', weight: 10, config: { skills: ['Microsoft Office', 'Excel'] } },
      { kind: 'MUST_HAVE' as const, type: 'DEGREE_LEVEL' as const, label: 'Bachelor degree or HND', weight: 10, config: { minLevel: 'HND' } },
      { kind: 'MUST_HAVE' as const, type: 'DEGREE_CLASS' as const, label: 'Minimum Second Class Lower', weight: 10, config: { minClass: 'SECOND_LOWER' } },
      { kind: 'NICE_TO_HAVE' as const, type: 'FIELD_OF_STUDY' as const, label: 'Business or communications field', weight: 15, config: { fields: ['Business Administration', 'Mass Communication', 'English Language', 'Marketing'] } },
      { kind: 'NICE_TO_HAVE' as const, type: 'EXPERIENCE' as const, label: 'Customer-facing experience', weight: 5, config: { minYears: 1 } },
      { kind: 'NICE_TO_HAVE' as const, type: 'LANGUAGE' as const, label: 'English and a Nigerian language', weight: 15, config: { languages: ['English', 'Yoruba', 'Igbo', 'Hausa'] } },
      { kind: 'NICE_TO_HAVE' as const, type: 'CERTIFICATION' as const, label: 'People certification', weight: 10, config: { certifications: ['CIPM'] } },
    ],
  },
  {
    title: 'NYSC Graduate Trainee Programme',
    org: 'federaltech',
    description:
      'A twelve-month rotational programme for serving and recently discharged corps members. Rotate through operations, technology and client teams while completing a structured learning path.',
    location: 'Nationwide',
    employmentType: 'NYSC' as const,
    blindScreening: true,
    biasDemoMode: false,
    criteria: [
      { kind: 'MUST_HAVE' as const, type: 'DEGREE_LEVEL' as const, label: 'Bachelor degree or HND', weight: 15, config: { minLevel: 'HND' } },
      { kind: 'MUST_HAVE' as const, type: 'DEGREE_CLASS' as const, label: 'Minimum Second Class Lower', weight: 15, config: { minClass: 'SECOND_LOWER' } },
      { kind: 'MUST_HAVE' as const, type: 'SKILL' as const, label: 'Microsoft Office', weight: 20, config: { skills: ['Microsoft Office', 'Excel'] } },
      { kind: 'MUST_HAVE' as const, type: 'SKILL' as const, label: 'Communication and teamwork', weight: 20, config: { skills: ['Communication', 'Teamwork'] } },
      { kind: 'NICE_TO_HAVE' as const, type: 'LANGUAGE' as const, label: 'English', weight: 10, config: { languages: ['English'] } },
      { kind: 'NICE_TO_HAVE' as const, type: 'CERTIFICATION' as const, label: 'NYSC discharge certificate', weight: 10, config: { certifications: ['NYSC Discharge'] } },
      { kind: 'NICE_TO_HAVE' as const, type: 'FIELD_OF_STUDY' as const, label: 'Any recognised discipline', weight: 10, config: { fields: ['Computer Science', 'Economics', 'Accounting', 'Business Administration', 'Mass Communication'] } },
    ],
  },
  {
    // Deliberately biased demo job: the demo scoring rule rewards federal
    // universities and penalises polytechnics. The audit should flag it.
    title: 'Finance & Accounting Graduate Trainee (Bias Demo)',
    org: 'federaltech',
    description:
      'A demo role used in the Iṣẹ́ bias audit walkthrough. It uses the same criteria as a real finance trainee role, plus a dev-only university-pedigree adjustment that the audit is designed to catch. Do not use this configuration in production.',
    location: 'Lagos (On-site)',
    employmentType: 'FULL_TIME' as const,
    blindScreening: true,
    biasDemoMode: true,
    criteria: [
      { kind: 'MUST_HAVE' as const, type: 'SKILL' as const, label: 'Accounting fundamentals', weight: 25, config: { skills: ['Accounting', 'Bookkeeping'] } },
      { kind: 'MUST_HAVE' as const, type: 'SKILL' as const, label: 'Accounting software', weight: 15, config: { skills: ['QuickBooks', 'Sage', 'Excel'] } },
      { kind: 'MUST_HAVE' as const, type: 'DEGREE_LEVEL' as const, label: 'Bachelor degree or HND', weight: 10, config: { minLevel: 'BSC' } },
      { kind: 'MUST_HAVE' as const, type: 'DEGREE_CLASS' as const, label: 'Minimum Second Class Lower', weight: 15, config: { minClass: 'SECOND_LOWER' } },
      { kind: 'MUST_HAVE' as const, type: 'FIELD_OF_STUDY' as const, label: 'Accounting, finance or economics', weight: 15, config: { fields: ['Accounting', 'Finance', 'Economics'] } },
      { kind: 'NICE_TO_HAVE' as const, type: 'EXPERIENCE' as const, label: 'One year of finance experience', weight: 10, config: { minYears: 1 } },
      { kind: 'NICE_TO_HAVE' as const, type: 'CERTIFICATION' as const, label: 'Professional certification', weight: 10, config: { certifications: ['ICAN', 'ACCA'] } },
    ],
  },
  {
    title: 'Digital Marketing Associate',
    org: 'lagosfintech',
    description:
      'Own our social channels and paid search for a growing consumer lending brand. You will write copy, design simple assets in Canva, run A/B tests and report on what actually converts.',
    location: 'Remote (Nigeria)',
    employmentType: 'FULL_TIME' as const,
    blindScreening: true,
    biasDemoMode: false,
    criteria: [
      { kind: 'MUST_HAVE' as const, type: 'SKILL' as const, label: 'Digital marketing channels', weight: 30, config: { skills: ['Digital Marketing', 'SEO', 'Social Media Management'] } },
      { kind: 'MUST_HAVE' as const, type: 'SKILL' as const, label: 'Content and design tools', weight: 15, config: { skills: ['Canva', 'Content Writing', 'Copywriting'] } },
      { kind: 'MUST_HAVE' as const, type: 'DEGREE_LEVEL' as const, label: 'Bachelor degree or HND', weight: 10, config: { minLevel: 'HND' } },
      { kind: 'MUST_HAVE' as const, type: 'DEGREE_CLASS' as const, label: 'Minimum Second Class Lower', weight: 10, config: { minClass: 'SECOND_LOWER' } },
      { kind: 'NICE_TO_HAVE' as const, type: 'FIELD_OF_STUDY' as const, label: 'Marketing or communications', weight: 15, config: { fields: ['Marketing', 'Mass Communication', 'Business Administration'] } },
      { kind: 'NICE_TO_HAVE' as const, type: 'EXPERIENCE' as const, label: 'One year of marketing experience', weight: 10, config: { minYears: 1 } },
      { kind: 'NICE_TO_HAVE' as const, type: 'CERTIFICATION' as const, label: 'Marketing certification', weight: 10, config: { certifications: ['Google Analytics', 'HubSpot'] } },
    ],
  },
];

const KNOCKOUTS = [
  { type: 'NYSC' as const, prompt: 'What is your NYSC status?', options: ['COMPLETED', 'SERVING', 'EXEMPTED', 'NOT_YET'], config: { accepted: ['COMPLETED', 'SERVING', 'EXEMPTED'] } },
  { type: 'DEGREE_CLASS' as const, prompt: 'What degree classification did you graduate with?', options: ['FIRST', 'SECOND_UPPER', 'SECOND_LOWER', 'THIRD', 'PASS'], config: { minClass: 'SECOND_LOWER' } },
  { type: 'WORK_AUTH' as const, prompt: 'Are you authorised to work in Nigeria?', options: ['Yes', 'No'], config: { requiresAuthorisation: true } },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function pick<T>(arr: T[], index: number): T {
  return arr[index % arr.length];
}

function pdfFromText(text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const hasFonts = registerPdfFonts(doc);
    doc.font(hasFonts ? 'Body' : 'Helvetica');
    text.split('\n').forEach((line) => {
      doc.fontSize(line === line.toUpperCase() && line.length < 30 ? 12 : 10).text(line, { lineGap: 2 });
    });
    doc.end();
  });
}

const CLASS_LABELS: Record<string, string> = {
  FIRST: 'First Class Honours',
  SECOND_UPPER: 'Second Class Upper Division',
  SECOND_LOWER: 'Second Class Lower Division',
  THIRD: 'Third Class Honours',
  PASS: 'Pass',
};

const DEGREE_LABELS: Record<string, string> = { BSC: 'B.Sc.', HND: 'HND' };

interface CandidateSpec {
  index: number;
  fullName: string;
  email: string;
  gender: 'FEMALE' | 'MALE';
  ageBand: string;
  group: 'yoruba' | 'igbo' | 'hausa';
  state: string;
  university: string;
  universityType: 'FEDERAL' | 'STATE' | 'PRIVATE' | 'POLYTECHNIC';
  degreeLevel: 'BSC' | 'HND';
  degreeClass: 'FIRST' | 'SECOND_UPPER' | 'SECOND_LOWER' | 'THIRD' | 'PASS';
  course: string;
  skills: string[];
  track: keyof typeof SKILL_POOLS;
  yearsExperience: number;
  certification: string;
  languages: string[];
  declaresDemographics: boolean;
  nysc: string;
}

function pick2<T>(arr: T[], start: number, count: number): T[] {
  return Array.from({ length: count }, (_, k) => arr[(start + k) % arr.length]);
}

function buildCandidates(): CandidateSpec[] {
  const candidates: CandidateSpec[] = [];
  const groups: ('yoruba' | 'igbo' | 'hausa')[] = ['yoruba', 'igbo', 'hausa'];
  const classCycle: CandidateSpec['degreeClass'][] = ['SECOND_UPPER', 'SECOND_UPPER', 'SECOND_LOWER', 'FIRST', 'SECOND_LOWER', 'SECOND_UPPER', 'THIRD', 'SECOND_LOWER', 'FIRST', 'PASS'];
  const tracks: (keyof typeof SKILL_POOLS)[] = ['tech', 'data', 'finance', 'marketing', 'business'];

  for (let i = 0; i < 150; i += 1) {
    const group = groups[i % 3];
    const female = i % 2 === 0;
    const firstNames =
      group === 'yoruba' ? (female ? YORUBA_F : YORUBA_M) : group === 'igbo' ? (female ? IGBO_F : IGBO_M) : female ? HAUSA_F : HAUSA_M;
    const first = pick(firstNames, Math.floor(i / 3));
    const last = pick(SURNAMES[group], i);
    const state = pick(STATE_BY_GROUP[group], i);
    // Deliberate synthetic skew so the audit has a real proxy pattern to find:
    // polytechnic attendance is more common among northern candidates here.
    const universityType: CandidateSpec['universityType'] =
      group === 'hausa' && i % 2 === 0 ? 'POLYTECHNIC' : i % 5 === 0 ? 'PRIVATE' : i % 3 === 0 ? 'STATE' : i % 7 === 0 ? 'POLYTECHNIC' : 'FEDERAL';
    const key = universityType.toLowerCase() as keyof typeof UNIVERSITIES;
    const university = pick(UNIVERSITIES[key] ?? UNIVERSITIES.federal, i);
    const degreeLevel: 'BSC' | 'HND' = universityType === 'POLYTECHNIC' ? 'HND' : 'BSC';
    const course = pick(COURSES, i + Math.floor(i / 5));
    const track = tracks[i % tracks.length];
    const skills = [...new Set([...pick2(SKILL_POOLS[track], i, 5), ...pick2(SKILL_POOLS.business, i + 2, 2)])];
    candidates.push({
      index: i,
      fullName: `${first} ${last}`,
      email: `candidate${i + 1}@ise.test`,
      gender: female ? 'FEMALE' : 'MALE',
      ageBand: pick(['18-24', '25-29', '25-29', '30-34'], i),
      group,
      state,
      university,
      universityType,
      degreeLevel,
      degreeClass: pick(classCycle, i + Math.floor(i / 3)),
      course,
      skills,
      track,
      yearsExperience: i % 4,
      certification: pick(CERTS, i),
      languages: ['English', group === 'yoruba' ? 'Yoruba' : group === 'igbo' ? 'Igbo' : 'Hausa'],
      declaresDemographics: i % 6 !== 0,
      nysc: i % 9 === 0 ? 'NOT_YET' : i % 4 === 0 ? 'SERVING' : 'COMPLETED',
    });
  }
  return candidates;
}

function cvTextFor(candidate: CandidateSpec): string {
  const degree = DEGREE_LABELS[candidate.degreeLevel];
  const experienceLines: string[] =
    candidate.yearsExperience > 0
      ? [
          `${candidate.track === 'tech' ? 'Software Engineering Intern' : candidate.track === 'finance' ? 'Finance Intern' : candidate.track === 'marketing' ? 'Marketing Intern' : candidate.track === 'data' ? 'Data Analyst Intern' : 'Customer Service Officer'} — ${pick(['Paystack', 'Flutterwave', 'KPMG Nigeria', 'GTBank', 'Jumia Nigeria', 'Stanbic IBTC'], candidate.index)} (${2024 - candidate.yearsExperience} - 2024)`,
          `Supported the ${candidate.track} team with reporting, documentation and day-to-day delivery. Used ${candidate.skills.slice(0, 3).join(', ')}.`,
        ]
      : ['No formal work experience yet. Completed a final-year project and community volunteering.'];

  return [
    candidate.fullName,
    `${candidate.email} | 080${String(30000000 + candidate.index * 137).slice(0, 8)} | ${candidate.state}`,
    `State of Origin: ${candidate.state}`,
    `Marital Status: ${candidate.index % 2 === 0 ? 'Single' : 'Married'}`,
    '',
    'PROFILE',
    `${candidate.degreeLevel === 'HND' ? 'Higher National Diploma' : 'Bachelor'} graduate in ${candidate.course} from ${candidate.university}, looking for a graduate role in ${candidate.track}.`,
    '',
    'SKILLS',
    candidate.skills.join(', '),
    '',
    'EDUCATION',
    `${candidate.university}, ${candidate.state}`,
    `${degree} ${candidate.course} (${2020 - candidate.yearsExperience} - ${2024 - candidate.yearsExperience})`,
    CLASS_LABELS[candidate.degreeClass],
    '',
    'EXPERIENCE',
    ...experienceLines,
    '',
    'PROJECTS',
    `Final year project: ${pick(['Campus ride-sharing app', 'SME bookkeeping dashboard', 'Local market price tracker', 'Customer feedback survey'], candidate.index)}`,
    '',
    'CERTIFICATIONS',
    `${candidate.certification}${candidate.nysc === 'COMPLETED' ? ', NYSC Discharge' : ''}`,
    '',
    'LANGUAGES',
    candidate.languages.join(', '),
    '',
    'Referees available on request.',
  ].join('\n');
}

function buildCvData(candidate: CandidateSpec, text: string) {
  const base = parseCvHeuristically(text);
  return {
    ...base,
    name: candidate.fullName,
    email: candidate.email,
    phone: `080${String(30000000 + candidate.index * 137).slice(0, 8)}`,
    location: candidate.state,
    headline: `${candidate.degreeLevel === 'HND' ? 'HND' : 'BSc'} ${candidate.course} graduate`,
    skills: candidate.skills,
    education: [
      {
        institution: candidate.university,
        institutionType: candidate.universityType,
        course: candidate.course,
        degreeLevel: candidate.degreeLevel,
        degreeClass: candidate.degreeClass,
        startYear: 2020 - candidate.yearsExperience,
        endYear: 2024 - candidate.yearsExperience,
      },
    ],
    experience:
      candidate.yearsExperience > 0
        ? [
            {
              title:
                candidate.track === 'tech'
                  ? 'Software Engineering Intern'
                  : candidate.track === 'finance'
                    ? 'Finance Intern'
                    : candidate.track === 'marketing'
                      ? 'Marketing Intern'
                      : candidate.track === 'data'
                        ? 'Data Analyst Intern'
                        : 'Customer Service Officer',
              organisation: 'Nigerian graduate employer',
              startYear: 2024 - candidate.yearsExperience,
              endYear: 2024,
              description: `Used ${candidate.skills.slice(0, 3).join(', ')}.`,
              isInternship: true,
            },
          ]
        : [],
    certifications: [candidate.certification, ...(candidate.nysc === 'COMPLETED' ? ['NYSC Discharge'] : [])],
    languages: candidate.languages,
    projects: base.projects,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  // eslint-disable-next-line no-console
  console.log('Clearing existing data…');
  await prisma.$transaction([
    prisma.interview.deleteMany(),
    prisma.interviewSlot.deleteMany(),
    prisma.availabilityWindow.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.counterfactualRun.deleteMany(),
    prisma.biasReport.deleteMany(),
    prisma.knockoutAnswer.deleteMany(),
    prisma.score.deleteMany(),
    prisma.parsedCV.deleteMany(),
    prisma.cVFile.deleteMany(),
    prisma.note.deleteMany(),
    prisma.statusHistory.deleteMany(),
    prisma.application.deleteMany(),
    prisma.knockoutQuestion.deleteMany(),
    prisma.jobCriteria.deleteMany(),
    prisma.job.deleteMany(),
    prisma.demographicDeclaration.deleteMany(),
    prisma.dataRequest.deleteMany(),
    prisma.consentRecord.deleteMany(),
    prisma.notificationPreference.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.emailToken.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.candidateProfile.deleteMany(),
    prisma.user.deleteMany(),
    prisma.organisation.deleteMany(),
    prisma.setting.deleteMany(),
  ]);

  const password = await hashPassword('Password123');
  const candidatePassword = await hashPassword('CandidatePass123');

  const [federalTech, lagosFintech] = await Promise.all([
    prisma.organisation.create({ data: { name: 'Federal Tech Solutions', slug: 'federal-tech-solutions', sector: 'Technology' } }),
    prisma.organisation.create({ data: { name: 'Lagos FinTech Group', slug: 'lagos-fintech-group', sector: 'Financial services' } }),
  ]);

  const admin = await prisma.user.create({
    data: {
      email: 'admin@ise.test',
      fullName: 'Amara Nwachukwu',
      role: 'ADMIN',
      passwordHash: password,
      emailVerifiedAt: new Date(),
      notificationPref: { create: {} },
    },
  });
  const recruiterA = await prisma.user.create({
    data: {
      email: 'recruiter@federaltech.test',
      fullName: 'Tolu Adeyemi',
      role: 'RECRUITER',
      organisationId: federalTech.id,
      passwordHash: password,
      emailVerifiedAt: new Date(),
      notificationPref: { create: {} },
    },
  });
  const recruiterB = await prisma.user.create({
    data: {
      email: 'hr@lagosfintech.test',
      fullName: 'Ifeoma Balogun',
      role: 'RECRUITER',
      organisationId: lagosFintech.id,
      passwordHash: password,
      emailVerifiedAt: new Date(),
      notificationPref: { create: {} },
    },
  });

  const demoCandidate = await prisma.user.create({
    data: {
      email: 'candidate@ise.test',
      fullName: 'Adaeze Okafor',
      role: 'CANDIDATE',
      passwordHash: candidatePassword,
      emailVerifiedAt: new Date(),
      candidateProfile: {
        create: {
          headline: 'BSc Computer Science graduate — frontend engineer',
          summary: 'Graduate developer with internship experience building React interfaces for a payments company.',
          location: 'Lagos',
        },
      },
      notificationPref: { create: {} },
      consentRecords: { create: { purpose: 'ai_screening', version: '2026-02-v1' } },
    },
  });

  const jobs = [];
  for (const spec of JOBS) {
    const org = spec.org === 'federaltech' ? federalTech : lagosFintech;
    const recruiter = spec.org === 'federaltech' ? recruiterA : recruiterB;
    const job = await prisma.job.create({
      data: {
        organisationId: org.id,
        recruiterId: recruiter.id,
        title: spec.title,
        slug: spec.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        description: spec.description,
        location: spec.location,
        employmentType: spec.employmentType,
        deadline: new Date(Date.now() + 30 * 86_400_000),
        openings: 2 + (JOBS.indexOf(spec) % 3),
        status: 'OPEN',
        blindScreening: spec.blindScreening,
        hideUniversityBlind: true,
        biasDemoMode: spec.biasDemoMode,
        minYearsExperience: 0,
        criteria: {
          create: spec.criteria.map((c, index) => ({
            kind: c.kind,
            type: c.type,
            label: c.label,
            weight: c.weight,
            config: c.config,
            order: index,
          })),
        },
        knockoutQuestions: {
          create: KNOCKOUTS.map((k, index) => ({ type: k.type, prompt: k.prompt, options: k.options, config: k.config, order: index })),
        },
      },
      include: { criteria: true, knockoutQuestions: true },
    });
    jobs.push(job);
  }

  const generated = buildCandidates();
  const specs: CandidateSpec[] = [
    {
      ...generated[0],
      fullName: 'Adaeze Okafor',
      email: 'candidate@ise.test',
      gender: 'FEMALE',
      group: 'igbo',
      state: 'Enugu',
      university: 'University of Nigeria, Nsukka',
      universityType: 'FEDERAL',
      degreeLevel: 'BSC',
      degreeClass: 'FIRST',
      course: 'Computer Science',
      skills: ['JavaScript', 'React', 'TypeScript', 'Node.js', 'Git', 'SQL', 'Communication'],
      track: 'tech',
      yearsExperience: 2,
      certification: 'Google Analytics',
      languages: ['English', 'Igbo'],
      declaresDemographics: true,
      nysc: 'COMPLETED',
    },
    ...generated.slice(1),
  ];

  // eslint-disable-next-line no-console
  console.log('Creating 150 candidates, CV PDFs and applications…');
  const appRecords: { id: string; jobId: string; score: number }[] = [];
  let applicationIndex = 0;

  for (const spec of specs) {
    const isDemo = spec.email === 'candidate@ise.test';
    const user = isDemo
      ? demoCandidate
      : await prisma.user.create({
          data: {
            email: spec.email,
            fullName: spec.fullName,
            role: 'CANDIDATE',
            passwordHash: candidatePassword,
            emailVerifiedAt: new Date(),
            phone: `080${String(30000000 + spec.index * 137).slice(0, 8)}`,
            candidateProfile: { create: { headline: `${spec.degreeLevel === 'HND' ? 'HND' : 'BSc'} ${spec.course} graduate`, location: spec.state } },
            notificationPref: { create: {} },
            consentRecords: { create: { purpose: 'ai_screening', version: '2026-02-v1' } },
          },
        });

    if (spec.declaresDemographics) {
      await prisma.demographicDeclaration.create({
        data: {
          userId: user.id,
          payload: sealJson({
            gender: spec.gender,
            ageBand: spec.ageBand,
            stateOfOrigin: spec.state,
            universityType: spec.universityType,
            disabilityStatus: 'NONE',
            consentVersion: '2026-02-v1',
          }),
          consentVersion: '2026-02-v1',
        },
      });
    }

    const trackJobIndex: Record<string, number[]> = {
      tech: [0, 3, 5],
      data: [1, 4, 3],
      finance: [4, 1, 2],
      marketing: [5, 2, 3],
      business: [2, 3, 5],
    };
    const jobIndices = trackJobIndex[spec.track] ?? [0];
    const applyCount = isDemo ? 3 : 1 + (spec.index % 3 === 0 ? 1 : 0) + (spec.index % 7 === 0 ? 1 : 0);

    for (let a = 0; a < applyCount; a += 1) {
      const job = jobs[jobIndices[a % jobIndices.length]];
      const text = cvTextFor(spec);
      const cvData = buildCvData(spec, text);
      const applicationId = crypto.randomUUID();
      const pdf = await pdfFromText(text);
      const storageKey = `cvs/${user.id}/${applicationId}.pdf`;
      await storage.put(storageKey, pdf, 'application/pdf');

      const knockoutAnswers = job.knockoutQuestions.map((question) => {
        let value: string;
        let passed = true;
        if (question.type === 'NYSC') {
          value = spec.nysc;
          passed = ['COMPLETED', 'SERVING', 'EXEMPTED'].includes(value);
        } else if (question.type === 'DEGREE_CLASS') {
          value = spec.degreeClass;
          passed = ['FIRST', 'SECOND_UPPER', 'SECOND_LOWER'].includes(value);
        } else {
          value = 'Yes';
        }
        return { questionId: question.id, value, passed };
      });

      const application = await prisma.application.create({
        data: {
          id: applicationId,
          jobId: job.id,
          candidateId: user.id,
          publicRef: anonymousRef(applicationId),
          coverLetter: `I am applying for ${job.title} because my ${spec.degreeLevel} in ${spec.course} and my work with ${spec.skills.slice(0, 2).join(' and ')} fit the role.`,
          knockoutPassed: knockoutAnswers.every((k) => k.passed),
          knockoutFlags: knockoutAnswers
            .filter((k) => !k.passed)
            .map((k) => ({
              questionId: k.questionId,
              prompt: job.knockoutQuestions.find((q) => q.id === k.questionId)?.prompt ?? '',
              answer: k.value,
              reason: 'Answer falls outside the stated requirement.',
            })) as object,
          knockoutAnswers: {
            create: knockoutAnswers.map((k) => ({ questionId: k.questionId, value: k.value, passed: k.passed })),
          },
          cvFile: {
            create: {
              candidateId: user.id,
              filename: `${spec.fullName.replace(/\s+/g, '-')}-CV.pdf`,
              mimeType: 'application/pdf',
              sizeBytes: pdf.length,
              storageKey,
              checksum: crypto.createHash('sha256').update(pdf).digest('hex'),
              extractionStatus: 'COMPLETED',
              extractedText: text,
            },
          },
          parsedCV: {
            create: { data: cvData as unknown as object, parserModel: 'seed-fixture', promptVersion: '2026-02-v1' },
          },
          statusHistory: { create: { toStage: 'APPLIED', reason: 'Application submitted' } },
        },
      });

      const scored = await evaluateCv(job, cvData);
      await prisma.score.create({
        data: {
          applicationId: application.id,
          total: scored.total,
          breakdown: scored.breakdown as unknown as object,
          explanation: scored.explanation,
          model: scored.model,
          promptVersion: scored.promptVersion,
          rubricVersion: scored.rubricVersion,
        },
      });

      const recommendation = recommendationForScore(scored.total);
      const shortlisted = scored.total >= 62;
      const rejected = scored.total < 35 && applicationIndex % 3 === 0;
      const stage = rejected ? 'REJECTED' : shortlisted ? 'SHORTLISTED' : 'SCREENED';

      await prisma.application.update({
        where: { id: application.id },
        data: {
          score: scored.total,
          scoredAt: new Date(),
          aiRecommendedStage: recommendation,
          stage,
          ...(shortlisted ? { shortlistedAt: new Date() } : {}),
          ...(rejected ? { rejectionReason: 'Human review: did not meet the published criteria for this shortlist round.' } : {}),
        },
      });
      if (['SHORTLISTED', 'SCREENED', 'REJECTED'].includes(stage)) {
        await prisma.statusHistory.create({
          data: {
            applicationId: application.id,
            fromStage: 'APPLIED',
            toStage: stage,
            actorId: job.recruiterId,
            reason:
              stage === 'SHORTLISTED'
                ? 'Recruiter shortlisted after reviewing the explained score.'
                : stage === 'REJECTED'
                  ? 'Human review: did not meet the published criteria for this shortlist round.'
                  : 'Screened; awaiting a human shortlisting decision.',
          },
        });
      }

      appRecords.push({ id: application.id, jobId: job.id, score: scored.total });
      applicationIndex += 1;
    }
  }

  const demoJob = jobs[0]!;

  // --- Availability + one upcoming interview --------------------------------
  const start = new Date(Date.now() + 33 * 3600_000);
  start.setMinutes(0, 0, 0);
  const window = await prisma.availabilityWindow.create({
    data: {
      jobId: demoJob.id,
      recruiterId: demoJob.recruiterId,
      startsAt: start,
      endsAt: new Date(start.getTime() + 4 * 3600_000),
      slotMinutes: 30,
      bufferMinutes: 10,
      timezone: 'Africa/Lagos',
      interviewType: 'VIDEO',
      location: 'Google Meet',
      slots: {
        create: Array.from({ length: 6 }, (_, i) => ({
          jobId: demoJob.id,
          startsAt: new Date(start.getTime() + i * 40 * 60_000),
          endsAt: new Date(start.getTime() + i * 40 * 60_000 + 30 * 60_000),
        })),
      },
    },
    include: { slots: { orderBy: { startsAt: 'asc' } } },
  });

  const demoApplication = await prisma.application.findFirst({
    where: { jobId: demoJob.id, candidateId: demoCandidate.id },
    orderBy: { createdAt: 'desc' },
  });
  if (demoApplication) {
    const slot = window.slots[0];
    await prisma.interviewSlot.update({ where: { id: slot.id }, data: { applicationId: demoApplication.id } });
    const interview = await prisma.interview.create({
      data: {
        slotId: slot.id,
        applicationId: demoApplication.id,
        type: 'VIDEO',
        meetingLink: `https://meet.example.com/${demoApplication.publicRef.toLowerCase()}`,
        interviewerIds: [demoJob.recruiterId],
        icsUid: `${demoApplication.id}@ise`,
      },
    });
    await prisma.application.update({ where: { id: demoApplication.id }, data: { stage: 'INTERVIEW' } });
    await prisma.notification.create({
      data: {
        userId: demoCandidate.id,
        type: 'INTERVIEW_SCHEDULED',
        title: 'Interview scheduled',
        body: `Your interview for ${demoJob.title} is booked for ${slot.startsAt.toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}.`,
        data: { interviewId: interview.id },
      },
    });
  }

  await prisma.notification.createMany({
    data: [
      {
        userId: recruiterA.id,
        type: 'APPLICATION_RECEIVED',
        title: 'Your graduate roles are live',
        body: 'Review the screened pipeline — AI scores are recommendations only, and a written reason is required for rejections.',
      },
      {
        userId: demoCandidate.id,
        type: 'SHORTLISTED',
        title: 'You have been shortlisted',
        body: `You have been shortlisted for ${demoJob.title}. Your interview is booked.`,
      },
    ],
  });

  await prisma.auditLog.createMany({
    data: [
      { actorId: admin.id, actorRole: 'ADMIN', action: 'SEED_COMPLETED', entityType: 'System', entityId: 'seed', metadata: {} },
      { actorId: recruiterA.id, actorRole: 'RECRUITER', action: 'JOB_CREATED', entityType: 'Job', entityId: demoJob.id, metadata: { title: demoJob.title } },
    ],
  });

  // eslint-disable-next-line no-console
  console.log('Generating bias audit report for the demo job…');
  const biasedJob = jobs.find((job) => job.biasDemoMode) ?? demoJob;
  const snapshot = await buildAuditSnapshot({ jobId: biasedJob.id });
  await prisma.biasReport.create({
    data: {
      jobId: biasedJob.id,
      organisationId: biasedJob.organisationId,
      generatedById: recruiterA.id,
      summary: snapshot as unknown as object,
      findings: { findings: snapshot.findings, flags: snapshot.flags } as object,
      flagCount: snapshot.flags.length,
      methodology: snapshot.methodology.join('\n'),
      sampleSize: snapshot.sampleSize,
    },
  });

  const counts = {
    users: await prisma.user.count(),
    jobs: await prisma.job.count(),
    applications: await prisma.application.count(),
    scores: await prisma.score.count(),
    interviews: await prisma.interview.count(),
    biasFlags: snapshot.flags.length,
  };
  // eslint-disable-next-line no-console
  console.log('\nSeed complete:');
  // eslint-disable-next-line no-console
  console.table(counts);
  // eslint-disable-next-line no-console
  console.log(`
Sign in:
  Admin      admin@ise.test / Password123
  Recruiter  recruiter@federaltech.test / Password123
  Recruiter  hr@lagosfintech.test / Password123
  Candidate  candidate@ise.test / CandidatePass123

Bias demo job: "${biasedJob.title}" — ${snapshot.flags.length} flag(s).
`);
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
