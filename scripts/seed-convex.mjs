#!/usr/bin/env node
/**
 * Seeds a Convex deployment with the Iṣẹ́ demo world.
 *
 * Usage:
 *   CONVEX_URL=https://<deployment>.convex.cloud SEED_TOKEN=<secret> \
 *     node scripts/seed-convex.mjs
 *
 * Requires SEED_TOKEN to be set on the deployment too (npx convex env set).
 * Every PDF is generated locally and uploaded to Convex file storage.
 */

import PDFDocument from 'pdfkit';
import bcrypt from 'bcryptjs';
import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const api = anyApi;
const CONVEX_URL = process.env.CONVEX_URL;
const SEED_TOKEN = process.env.SEED_TOKEN;
if (!CONVEX_URL || !SEED_TOKEN) {
  console.error('Set CONVEX_URL and SEED_TOKEN in the environment.');
  process.exit(1);
}

const client = new ConvexHttpClient(CONVEX_URL);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_REGULAR = path.join(__dirname, '..', 'server', 'assets', 'fonts', 'DejaVuSans.ttf');
const FONT_BOLD = path.join(__dirname, '..', 'server', 'assets', 'fonts', 'DejaVuSans-Bold.ttf');
const PASSWORD = 'Password123';

// --- data pools -------------------------------------------------------------

const YORUBA_M = ['Adébáyọ̀', 'Ṣẹ́gun', 'Babátúndé', 'Olúwásẹ́gun', 'Káyọ̀dé', 'Gbẹ́nga', 'Olúfẹ́mi', 'Adéwálé'];
const YORUBA_F = ['Ṣadé', 'Títíláyọ̀', 'Adérọ̀nkẹ́', 'Fúnkẹ́', 'Yẹ̀túndé', 'Kẹ́mí', 'Bísọlá', 'Mọ́dúpẹ́'];
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
  FEDERAL: [
    'University of Lagos',
    'University of Ibadan',
    'Obafemi Awolowo University',
    'University of Nigeria, Nsukka',
    'Ahmadu Bello University',
    'University of Benin',
    'Federal University of Technology, Akure',
    'University of Ilorin',
  ],
  STATE: ['Lagos State University', 'Olabisi Onabanjo University', 'Rivers State University', 'Kaduna State University'],
  PRIVATE: ['Covenant University', 'Babcock University', 'Bowen University', 'Baze University'],
  POLYTECHNIC: ['Yaba College of Technology', 'Kaduna Polytechnic', 'Auchi Polytechnic'],
};

const DEGREES = [
  { level: 'BSC', label: 'BSc', courses: ['Computer Science', 'Economics', 'Accounting', 'Mass Communication', 'Business Administration', 'Microbiology'] },
  { level: 'HND', label: 'HND', courses: ['Computer Science', 'Accountancy', 'Electrical Engineering'] },
  { level: 'MSC', label: 'MSc', courses: ['Data Science', 'Finance', 'Public Health'] },
];

const CLASSES = ['FIRST', 'SECOND_UPPER', 'SECOND_UPPER', 'SECOND_UPPER', 'SECOND_LOWER', 'SECOND_LOWER', 'THIRD'];
const SKILLS = [
  'Microsoft Excel', 'SQL', 'Python', 'Power BI', 'Tableau', 'Data analysis', 'Customer service',
  'Project management', 'Digital marketing', 'SEO', 'Accounting', 'QuickBooks', 'Payroll',
  'Human resources', 'Recruitment', 'Supply chain', 'Logistics', 'Communication', 'Teamwork',
  'JavaScript', 'React', 'Node.js', 'Figma', 'Canva', 'Report writing', 'Leadership',
];

let seed = 20260222;
function random() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
const pick = (list) => list[Math.floor(random() * list.length)];
const sample = (list, count) => [...list].sort(() => random() - 0.5).slice(0, count);

const ORGS = [
  { name: 'Federal Tech Partners', slug: 'federal-tech', sector: 'Technology' },
  { name: 'Lagos Fintech Group', slug: 'lagos-fintech', sector: 'Financial services' },
];

const JOBS = [
  {
    organisationSlug: 'federal-tech',
    title: 'Graduate Software Engineer',
    slug: 'graduate-software-engineer',
    description:
      'Build and maintain internal services for a federal digital programme. You will pair with senior engineers, write tested TypeScript, and learn our deployment pipeline. This role is open to graduates completing NYSC in 2026.',
    location: 'Abuja',
    employmentType: 'FULL_TIME',
    deadlineDays: 28,
    openings: 12,
    status: 'OPEN',
    blindScreening: true,
    hideUniversityBlind: true,
    biasDemoMode: false,
    criteria: [
      { kind: 'MUST_HAVE', type: 'SKILL', label: 'JavaScript or TypeScript', weight: 30, config: { skills: ['javascript', 'typescript'] } },
      { kind: 'MUST_HAVE', type: 'DEGREE_LEVEL', label: 'Bachelor’s degree', weight: 20, config: { minLevel: 'BSC' } },
      { kind: 'NICE_TO_HAVE', type: 'EXPERIENCE', label: 'Internship experience', weight: 15, config: { minYears: 1 } },
      { kind: 'NICE_TO_HAVE', type: 'SKILL', label: 'React', weight: 20, config: { skills: ['react'] } },
      { kind: 'NICE_TO_HAVE', type: 'CERTIFICATION', label: 'Cloud certification', weight: 15, config: { certifications: ['aws certified', 'azure'] } },
    ],
    knockouts: [
      { type: 'NYSC', prompt: 'What is your NYSC status?', config: { accepted: ['COMPLETED', 'SERVING', 'EXEMPTED'] } },
      { type: 'WORK_AUTH', prompt: 'Are you authorised to work in Nigeria?', config: { requiresAuthorisation: true } },
    ],
  },
  {
    organisationSlug: 'lagos-fintech',
    title: 'Data Analyst (Graduate)',
    slug: 'data-analyst-graduate',
    description:
      'Join the analytics team supporting lending decisions. You will clean data, build dashboards, and present findings to credit and operations leads. Excel and SQL are used daily; Power BI is our reporting layer.',
    location: 'Lagos',
    employmentType: 'FULL_TIME',
    deadlineDays: 21,
    openings: 6,
    status: 'OPEN',
    blindScreening: true,
    hideUniversityBlind: true,
    biasDemoMode: false,
    criteria: [
      { kind: 'MUST_HAVE', type: 'SKILL', label: 'SQL', weight: 30, config: { skills: ['sql'] } },
      { kind: 'MUST_HAVE', type: 'SKILL', label: 'Microsoft Excel', weight: 25, config: { skills: ['microsoft excel'] } },
      { kind: 'NICE_TO_HAVE', type: 'SKILL', label: 'Power BI', weight: 20, config: { skills: ['power bi'] } },
      { kind: 'NICE_TO_HAVE', type: 'DEGREE_CLASS', label: 'Second Class Lower or better', weight: 15, config: { minClass: 'SECOND_LOWER' } },
      { kind: 'NICE_TO_HAVE', type: 'EXPERIENCE', label: 'One year of analysis work', weight: 10, config: { minYears: 1 } },
    ],
    knockouts: [{ type: 'DEGREE_CLASS', prompt: 'What degree class did you graduate with?', config: { minClass: 'SECOND_LOWER' } }],
  },
  {
    organisationSlug: 'lagos-fintech',
    title: 'Customer Support Associate',
    slug: 'customer-support-associate',
    description:
      'Be the first human our customers reach. You will resolve account questions over chat and phone, document recurring issues, and work with product to remove friction from onboarding.',
    location: 'Lagos',
    employmentType: 'FULL_TIME',
    deadlineDays: 14,
    openings: 10,
    status: 'OPEN',
    blindScreening: true,
    hideUniversityBlind: true,
    biasDemoMode: false,
    criteria: [
      { kind: 'MUST_HAVE', type: 'SKILL', label: 'Customer service', weight: 35, config: { skills: ['customer service'] } },
      { kind: 'MUST_HAVE', type: 'SKILL', label: 'Communication', weight: 25, config: { skills: ['communication'] } },
      { kind: 'NICE_TO_HAVE', type: 'EXPERIENCE', label: 'One year of support work', weight: 20, config: { minYears: 1 } },
      { kind: 'NICE_TO_HAVE', type: 'LANGUAGE', label: 'English', weight: 20, config: { languages: ['english'] } },
    ],
    knockouts: [{ type: 'AVAILABILITY', prompt: 'When can you start?', config: { accepted: ['IMMEDIATE', 'WITHIN_30_DAYS'] } }],
  },
  {
    organisationSlug: 'federal-tech',
    title: 'Finance and Accounting Intern',
    slug: 'finance-accounting-intern',
    description:
      'A one-year internship for accounting graduates. You will support reconciliations, prepare payment schedules, and learn the controls behind public-sector finance.',
    location: 'Abuja',
    employmentType: 'INTERNSHIP',
    deadlineDays: 30,
    openings: 8,
    status: 'OPEN',
    blindScreening: true,
    hideUniversityBlind: true,
    biasDemoMode: false,
    criteria: [
      { kind: 'MUST_HAVE', type: 'SKILL', label: 'Accounting', weight: 30, config: { skills: ['accounting', 'bookkeeping'] } },
      { kind: 'MUST_HAVE', type: 'DEGREE_LEVEL', label: 'Bachelor’s degree', weight: 20, config: { minLevel: 'BSC' } },
      { kind: 'NICE_TO_HAVE', type: 'SKILL', label: 'QuickBooks', weight: 20, config: { skills: ['quickbooks'] } },
      { kind: 'NICE_TO_HAVE', type: 'CERTIFICATION', label: 'ICAN or ACCA progress', weight: 20, config: { certifications: ['ican', 'acca'] } },
      { kind: 'NICE_TO_HAVE', type: 'DEGREE_CLASS', label: 'Second Class Upper', weight: 10, config: { minClass: 'SECOND_UPPER' } },
    ],
    knockouts: [{ type: 'NYSC', prompt: 'What is your NYSC status?', config: { accepted: ['COMPLETED', 'SERVING', 'EXEMPTED', 'NOT_STARTED'] } }],
  },
  {
    organisationSlug: 'lagos-fintech',
    title: 'Product Designer',
    slug: 'product-designer',
    description:
      'Design flows for a savings product used by first-time bank customers. You will run usability sessions in Lagos and Ibadan, prototype in Figma, and hand off with engineers.',
    location: 'Lagos',
    employmentType: 'CONTRACT',
    deadlineDays: 25,
    openings: 3,
    status: 'OPEN',
    blindScreening: true,
    hideUniversityBlind: true,
    biasDemoMode: false,
    criteria: [
      { kind: 'MUST_HAVE', type: 'SKILL', label: 'Figma', weight: 40, config: { skills: ['figma'] } },
      { kind: 'NICE_TO_HAVE', type: 'SKILL', label: 'User research', weight: 25, config: { skills: ['communication', 'report writing'] } },
      { kind: 'NICE_TO_HAVE', type: 'EXPERIENCE', label: 'Two years of design work', weight: 20, config: { minYears: 2 } },
      { kind: 'NICE_TO_HAVE', type: 'FIELD_OF_STUDY', label: 'Design or computing', weight: 15, config: { fields: ['computer science', 'design'] } },
    ],
    knockouts: [{ type: 'LOCATION', prompt: 'Are you based in Lagos or willing to relocate?', config: { relocation: true, acceptedLocations: ['lagos'] } }],
  },
  {
    organisationSlug: 'federal-tech',
    title: 'Graduate Trainee (Bias Demo)',
    slug: 'graduate-trainee-bias-demo',
    description:
      'A demonstration role used during the bias audit walkthrough. The scoring rule deliberately up-weights federal university pedigree so the audit can show a real flag. Enable ALLOW_BIAS_DEMO to keep it active.',
    location: 'Abuja',
    employmentType: 'FULL_TIME',
    deadlineDays: 40,
    openings: 5,
    status: 'OPEN',
    blindScreening: false,
    hideUniversityBlind: false,
    biasDemoMode: true,
    criteria: [
      { kind: 'MUST_HAVE', type: 'SKILL', label: 'Communication', weight: 35, config: { skills: ['communication'] } },
      { kind: 'MUST_HAVE', type: 'DEGREE_LEVEL', label: 'Bachelor’s degree', weight: 25, config: { minLevel: 'BSC' } },
      { kind: 'NICE_TO_HAVE', type: 'EXPERIENCE', label: 'One year of experience', weight: 20, config: { minYears: 1 } },
      { kind: 'NICE_TO_HAVE', type: 'SKILL', label: 'Teamwork', weight: 20, config: { skills: ['teamwork'] } },
    ],
    knockouts: [],
  },
];

// --- CV rendering -----------------------------------------------------------

function cvText(candidate) {
  const edu = candidate.education;
  return [
    candidate.fullName,
    `${candidate.email} | ${candidate.phone} | ${candidate.location}`,
    '',
    'PROFILE',
    `${candidate.degreeLabel} graduate in ${edu.course} from ${edu.institution}. ${candidate.headline}`,
    '',
    'EDUCATION',
    `${edu.institution} — ${candidate.degreeLabel} ${edu.course} (${edu.startYear}–${edu.endYear})`,
    `Class of degree: ${edu.classLabel}`,
    '',
    'EXPERIENCE',
    ...candidate.experience.map((item) => `${item.title} at ${item.organisation} (${item.startYear}–${item.endYear ?? 'present'})`),
    '',
    'SKILLS',
    candidate.skills.join(', '),
    '',
    'CERTIFICATIONS',
    candidate.certifications.join(', ') || 'None listed',
    '',
    'LANGUAGES',
    candidate.languages.join(', '),
  ].join('\n');
}

function renderPdf(candidate, text) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('body', FONT_REGULAR);
    doc.registerFont('bold', FONT_BOLD);

    doc.font('bold').fontSize(18).text('Iṣẹ́ — Curriculum Vitae', { align: 'left' });
    doc.moveDown(0.5);
    doc.font('body').fontSize(10).fillColor('#555555').text('Generated for the Iṣẹ́ screening demonstration.');
    doc.moveDown(1);
    doc.fillColor('#111111').fontSize(11).text(text, { lineGap: 3 });
    doc.end();
  });
}

// --- main -------------------------------------------------------------------

function classLabel(value) {
  return (
    {
      FIRST: 'First Class',
      SECOND_UPPER: 'Second Class Upper',
      SECOND_LOWER: 'Second Class Lower',
      THIRD: 'Third Class',
      PASS: 'Pass',
      NONE: 'Not stated',
    }[value] ?? 'Not stated'
  );
}

function makeCandidate(index) {
  const ethnicity = index % 3 === 0 ? 'yoruba' : index % 3 === 1 ? 'igbo' : 'hausa';
  const female = index % 2 === 0;
  const firstNames =
    ethnicity === 'yoruba' ? (female ? YORUBA_F : YORUBA_M) : ethnicity === 'igbo' ? (female ? IGBO_F : IGBO_M) : female ? HAUSA_F : HAUSA_M;
  const first = firstNames[index % firstNames.length];
  const surname = SURNAMES[ethnicity][index % SURNAMES[ethnicity].length];
  const fullName = `${first} ${surname}`;

  const institutionType = pick(['FEDERAL', 'FEDERAL', 'STATE', 'PRIVATE', 'POLYTECHNIC']);
  const institution = pick(UNIVERSITIES[institutionType]);
  const degree = pick(DEGREES);
  const degreeClass = pick(CLASSES);
  const endYear = 2022 + (index % 4);
  const skills = sample(SKILLS, 5 + (index % 4));
  const years = index % 4;

  return {
    fullName,
    email: `${fullName.toLowerCase().replace(/[^a-z]+/g, '.')}.${index}@example.ng`,
    phone: `080${String(30000000 + index * 137).slice(0, 8)}`,
    location: pick(['Lagos', 'Abuja', 'Kano', 'Enugu', 'Ibadan', 'Port Harcourt']),
    headline: pick([
      'Looking for a graduate role where I can grow quickly.',
      'Analytical, detail-oriented and comfortable with data.',
      'Customer-first mindset with strong written communication.',
      'Building software in my spare time and eager to learn in a team.',
    ]),
    education: { institution, institutionType, course: pick(degree.courses), startYear: endYear - 4, endYear },
    degreeLabel: degree.label,
    degreeLevel: degree.level,
    degreeClass,
    classLabel: classLabel(degreeClass),
    experience: [
      {
        title: pick(['Intern', 'NYSC Corps Member', 'Administrative Assistant', 'Sales Assistant', 'Teaching Assistant']),
        organisation: pick(['Lagos Internal Revenue Service', 'Andela', 'Access Bank', 'Kano State Ministry of Education', 'Flutterwave']),
        startYear: endYear,
        endYear: endYear + years || null,
      },
    ],
    skills,
    certifications: random() > 0.6 ? sample(['ICAN', 'ACCA', 'AWS Certified Cloud Practitioner', 'Google Analytics'], 1) : [],
    languages: ['English', ...(random() > 0.55 ? [pick(['Yoruba', 'Igbo', 'Hausa'])] : [])],
    gender: female ? 'FEMALE' : 'MALE',
    ageBand: pick(['18-24', '25-29', '25-29', '30-34']),
    stateOfOrigin: pick(['Lagos', 'Kano', 'Enugu', 'Oyo', 'Rivers', 'Kaduna']),
    universityType: institutionType,
    disabilityStatus: 'NONE',
    _institutionType: institutionType,
  };
}

async function main() {
  console.log('Resetting demo data…');
  await client.mutation(api.seed.reset, { token: SEED_TOKEN });

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const candidates = Array.from({ length: 150 }, (_, i) => makeCandidate(i));

  console.log('Creating organisations, users and jobs…');
  const world = await client.mutation(api.seed.createWorld, {
    token: SEED_TOKEN,
    admin: { email: 'admin@ise.test', passwordHash, fullName: 'Adaeze Nwosu' },
    organisations: ORGS,
    users: [
      { email: 'recruiter@federaltech.test', passwordHash, fullName: 'Tunde Balogun', role: 'RECRUITER', organisationSlug: 'federal-tech' },
      { email: 'hr@lagosfintech.test', passwordHash, fullName: 'Zainab Yusuf', role: 'RECRUITER', organisationSlug: 'lagos-fintech' },
      ...candidates.map((candidate) => ({
        email: candidate.email,
        passwordHash,
        fullName: candidate.fullName,
        role: 'CANDIDATE',
      })),
    ],
    jobs: JOBS,
  });

  const candidateUsers = world.users.filter((user) => user.role === 'CANDIDATE');
  const jobs = world.jobs;
  console.log(`Created ${candidateUsers.length} candidates and ${jobs.length} jobs.`);

  let uploaded = 0;
  for (let i = 0; i < candidateUsers.length; i += 1) {
    const user = candidateUsers[i];
    const candidate = candidates[i];
    const text = cvText(candidate);
    const pdf = await renderPdf(candidate, text);

    const uploadUrl = await client.mutation(api.files.generateUploadUrlAsSeed, { token: SEED_TOKEN });
    const response = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: pdf });
    if (!response.ok) throw new Error(`Upload failed for ${user.email}`);
    const { storageId } = await response.json();

    const targetJobs = [jobs[i % jobs.length], jobs[(i + 1) % jobs.length]];
    for (const job of targetJobs) {
      await client.mutation(api.seed.attachApplication, {
        token: SEED_TOKEN,
        candidateId: user.id,
        jobId: job.id,
        storageId,
        filename: `${candidate.fullName.replace(/\s+/g, '-').toLowerCase()}-cv.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: pdf.length,
        text,
        createdAt: Date.now() - (150 - i) * 3_600_000,
        knockoutPassed: i % 7 !== 0,
      });
      uploaded += 1;
    }

    if (i % 3 !== 0) {
      await client.action(api.secure.seedDeclaration, {
        token: SEED_TOKEN,
        userId: user.id,
        payload: {
          gender: candidate.gender,
          ageBand: candidate.ageBand,
          stateOfOrigin: candidate.stateOfOrigin,
          universityType: candidate.universityType,
          disabilityStatus: candidate.disabilityStatus,
          consentVersion: '2026-02-v1',
        },
      });
    }
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${candidateUsers.length} candidates seeded`);
  }
  console.log(`Attached ${uploaded} applications with PDF CVs.`);

  for (const job of jobs) {
    const result = await client.mutation(api.seed.shortlistSome, {
      token: SEED_TOKEN,
      jobId: job.id,
      percentile: 30,
      limit: 40,
    });
    console.log(`Shortlisted ${result.shortlisted} for ${job.title}`);
  }

  const recruiter = world.users.find((user) => user.role === 'RECRUITER');
  for (const job of jobs.slice(0, 2)) {
    await client.mutation(api.seed.scheduleInterview, {
      token: SEED_TOKEN,
      jobId: job.id,
      recruiterId: recruiter.id,
      inDays: 3,
    });
  }

  console.log('Generating bias reports…');
  const login = await client.action(api.auth.login, { email: 'admin@ise.test', password: PASSWORD });
  const adminToken = login.accessToken;
  for (const job of jobs) {
    const report = await client.action(api.audit.createReport, { token: adminToken, jobId: job.id });
    console.log(`  ${job.title}: ${report.snapshot.flags.length} flag(s)`);
  }

  const summary = await client.mutation(api.seed.summarise, { token: SEED_TOKEN });
  console.log('Seed complete:', summary);
  console.log(`Sign in with admin@ise.test / ${PASSWORD}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
