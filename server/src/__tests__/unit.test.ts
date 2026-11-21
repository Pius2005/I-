import { describe, expect, it } from 'vitest';
import { recommendationForScore, scoreApplication, skillMatches } from '../domain/scoring.js';
import { buildBlindView, redactCvData, redactText, stripIdentityForScoring } from '../domain/redact.js';
import { adverseImpact, selectionRates, twoProportionPValue, proxyBias } from '../domain/audit.js';
import { buildIcs, generateSlots } from '../domain/ics.js';
import { evaluateKnockouts } from '../services/knockouts.js';
import PDFDocument from 'pdfkit';
import { registerPdfFonts, resolvePdfFonts } from '../services/pdf-fonts.js';
import type { CriterionInput, ParsedCVData } from '../domain/types.js';

const cv: ParsedCVData = {
  name: 'Ada Obi',
  email: 'ada@example.com',
  phone: '08031234567',
  location: 'Lagos',
  summary: 'Backend engineer at a Lagos fintech.',
  skills: ['TypeScript', 'Node.js'],
  education: [
    {
      institution: 'University of Lagos',
      institutionType: 'FEDERAL',
      course: 'Computer Science',
      degreeLevel: 'BSC',
      degreeClass: 'SECOND_UPPER',
      startYear: 2015,
      endYear: 2019,
    },
  ],
  experience: [{ title: 'Software Engineer', startYear: 2020, endYear: 2024 }],
  projects: [],
  certifications: [],
  languages: ['English'],
};

const criterion = (overrides: Partial<CriterionInput>): CriterionInput => ({
  id: 'c1',
  kind: 'MUST_HAVE',
  type: 'SKILL',
  label: 'TypeScript',
  weight: 100,
  config: { skills: ['TypeScript'] },
  ...overrides,
});

describe('scoring', () => {
  it('weights criteria to a 0–100 total and explains the result', () => {
    const result = scoreApplication(
      [
        criterion({ id: 'skill', weight: 50, config: { skills: ['TypeScript'] } }),
        criterion({ id: 'class', type: 'DEGREE_CLASS', weight: 30, label: 'Degree class', config: { minClass: 'SECOND_LOWER' } }),
        criterion({ id: 'exp', type: 'EXPERIENCE', weight: 20, label: 'Experience', config: { minYears: 2 } }),
      ],
      cv,
    );
    expect(result.total).toBe(100);
    expect(result.breakdown).toHaveLength(3);
    expect(result.breakdown.every((b) => b.rationale.length > 0)).toBe(true);
    expect(result.explanation).toContain('recruiter makes the final decision');
    expect(result.rubricVersion).toBe('rubric-v1');
  });

  it('scores a missing required skill as a partial score with a listed gap', () => {
    const result = scoreApplication(
      [criterion({ config: { skills: ['TypeScript', 'Kubernetes'] } })],
      cv,
    );
    expect(result.total).toBe(50);
    expect(result.breakdown[0].missing).toContain('Kubernetes');
  });

  it('applies the demo university adjustment only when biasDemoMode is on', () => {
    const criteria = [
      criterion({ id: 'skill', weight: 50, config: { skills: ['TypeScript'] } }),
      criterion({ id: 'cert', type: 'CERTIFICATION', weight: 50, label: 'AWS', config: { certifications: ['AWS'] } }),
    ];
    const neutral = scoreApplication(criteria, cv);
    const biased = scoreApplication(criteria, cv, { biasDemoMode: true });
    expect(neutral.total).toBe(50);
    expect(biased.adjustments).toHaveLength(1);
    expect(biased.adjustments[0].points).toBe(8);
    expect(biased.total).toBe(58);
  });

  it('never auto-rejects: the recommendation is only SHORTLISTED or SCREENED', () => {
    expect(recommendationForScore(60)).toBe('SHORTLISTED');
    expect(recommendationForScore(59)).toBe('SCREENED');
    expect(recommendationForScore(null)).toBe('SCREENED');
  });

  it('matches skill aliases without rewarding unrelated text', () => {
    expect(skillMatches('JavaScript', ['js', 'React'])).toBe(true);
    expect(skillMatches('Accounting', ['bookkeeping'])).toBe(true);
    expect(skillMatches('Kubernetes', ['TypeScript', 'Node.js'])).toBe(false);
  });
});

describe('blind screening redaction', () => {
  it('removes contact details and identity lines from free text', () => {
    const out = redactText('Ada Obi, ada@example.com, 08031234567\nDate of Birth: 1998\nState of Origin: Oyo', {
      names: ['Ada Obi'],
    });
    expect(out).not.toContain('ada@example.com');
    expect(out).not.toContain('08031234567');
    expect(out).not.toContain('Date of Birth');
    expect(out).not.toContain('State of Origin');
    expect(out).toContain('[name hidden]');
  });

  it('hides institution names when the job requires it', () => {
    const redacted = redactCvData(cv, { hideUniversity: true });
    expect(redacted.education[0].institution).toBe('[institution hidden]');
    expect(redacted.education[0].institutionType).toBeUndefined();
  });

  it('drops identity from the payload sent to recruiters', () => {
    const view = buildBlindView({
      anonymousRef: 'ISE-0001',
      identityRevealed: false,
      candidate: { name: 'Ada Obi', email: 'ada@example.com', phone: '08031234567' },
      cv,
      cvText: 'Ada Obi — ada@example.com',
      hideUniversity: true,
    });
    expect(view.identityRevealed).toBe(false);
    expect(view.candidate).toBeUndefined();
    expect(view.cv?.name).toBeNull();
    expect(JSON.stringify(view)).not.toContain('ada@example.com');
    expect(JSON.stringify(view)).not.toContain('Ada Obi');
  });

  it('returns the real identity once a recruiter reveals it', () => {
    const view = buildBlindView({
      anonymousRef: 'ISE-0001',
      identityRevealed: true,
      candidate: { name: 'Ada Obi', email: 'ada@example.com' },
      cv,
      cvText: 'Ada Obi',
      hideUniversity: false,
    });
    expect(view.candidate?.name).toBe('Ada Obi');
    expect(view.cv?.email).toBe('ada@example.com');
  });

  it('strips identity from the scoring input', () => {
    const stripped = stripIdentityForScoring(cv);
    expect(stripped.name).toBeNull();
    expect(stripped.email).toBeNull();
    expect(stripped.phone).toBeNull();
  });
});

describe('bias audit statistics', () => {
  it('computes selection rates and suppresses small groups instead of hiding them', () => {
    const rows = [
      ...Array.from({ length: 8 }, () => ({ group: 'Female', selected: true })),
      ...Array.from({ length: 2 }, () => ({ group: 'Female', selected: false })),
      ...Array.from({ length: 2 }, () => ({ group: 'Male', selected: true })),
      ...Array.from({ length: 8 }, () => ({ group: 'Male', selected: false })),
      ...Array.from({ length: 2 }, () => ({ group: 'Not declared', selected: true })),
    ];
    const stats = selectionRates(rows, 5);
    const female = stats.find((s) => s.group === 'Female')!;
    const undeclared = stats.find((s) => s.group === 'Not declared')!;
    expect(female.rate).toBeCloseTo(0.8);
    expect(undeclared.suppressed).toBe(true);
    expect(stats.every((s) => s.total > 0)).toBe(true);
  });

  it('applies the four-fifths rule and reports severity', () => {
    const result = adverseImpact([
      { group: 'Female', total: 10, selected: 8, rate: 0.8, suppressed: false },
      { group: 'Male', total: 10, selected: 2, rate: 0.2, suppressed: false },
    ]);
    expect(result.flagged).toBe(true);
    expect(result.highestGroup).toBe('Female');
    const male = result.groups.find((g) => g.group === 'Male')!;
    expect(male.ratio).toBeCloseTo(0.25);
    expect(male.severity).toBe('severe');
    expect(result.summary).toContain('Male');
  });

  it('does not flag suppressed groups or a single eligible group', () => {
    const single = adverseImpact([{ group: 'Only', total: 20, selected: 10, rate: 0.5, suppressed: false }]);
    expect(single.flagged).toBe(false);

    const withSuppressed = adverseImpact([
      { group: 'A', total: 20, selected: 10, rate: 0.5, suppressed: false },
      { group: 'B', total: 20, selected: 10, rate: 0.5, suppressed: false },
      { group: 'C', total: 2, selected: 0, rate: 0, suppressed: true },
    ]);
    expect(withSuppressed.groups.find((g) => g.group === 'C')?.flagged).toBe(false);
  });

  it('returns bounded p-values from the two-proportion test', () => {
    expect(twoProportionPValue(10, 100, 10, 100)).toBeGreaterThan(0.9);
    expect(twoProportionPValue(0, 50, 40, 50)).toBeLessThan(0.01);
    expect(twoProportionPValue(0, 0, 5, 10)).toBe(1);
  });

  it('flags a feature that tracks both a protected group and the score', () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => ({ group: 'Group A', score: 90 + i, proxies: { cvLength: 10 + i * 0.1 } })),
      ...Array.from({ length: 10 }, (_, i) => ({ group: 'Group B', score: 20 + i, proxies: { cvLength: 1 + i * 0.1 } })),
    ];
    const findings = proxyBias(rows, { minGroupSize: 5, correlationThreshold: 0.3 });
    expect(findings).toHaveLength(1);
    expect(findings[0].proxy).toBe('cvLength');
    expect(findings[0].flagged).toBe(true);
    expect(Math.abs(findings[0].correlationWithGroup)).toBeGreaterThan(0.3);
  });

  it('returns no proxy findings when there is not enough data', () => {
    expect(proxyBias([{ group: 'A', score: 10, proxies: { x: 1 } }])).toEqual([]);
  });
});

describe('interview scheduling', () => {
  it('generates non-overlapping slots that respect the buffer', () => {
    const slots = generateSlots({
      startsAt: new Date('2026-03-02T09:00:00Z'),
      endsAt: new Date('2026-03-02T11:00:00Z'),
      slotMinutes: 30,
      bufferMinutes: 10,
    });
    expect(slots).toHaveLength(3);
    for (let i = 1; i < slots.length; i += 1) {
      const previousEnd = slots[i - 1].startsAt.getTime() + slots[i - 1].slotMinutes * 60_000;
      expect(slots[i].startsAt.getTime()).toBeGreaterThanOrEqual(previousEnd);
    }
  });

  it('emits UTC timestamps and a cancel method in the ICS payload', () => {
    const ics = buildIcs({
      uid: 'ise-test-1',
      start: new Date('2026-03-02T09:00:00Z'),
      end: new Date('2026-03-02T09:30:00Z'),
      summary: 'Interview: Backend Engineer, Lagos',
      description: 'Video call',
      organiserEmail: 'recruiter@federaltech.test',
      attendeeEmail: 'candidate@ise.test',
      cancelled: true,
    });
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(ics).toContain('DTSTART:20260302T090000Z');
    expect(ics).toContain('METHOD:CANCEL');
    expect(ics).toContain('STATUS:CANCELLED');
    expect(ics).toContain('SUMMARY:Interview: Backend Engineer\\, Lagos');
    expect(ics.split('\r\n').length).toBeGreaterThan(10);
  });
});

describe('knockout questions', () => {
  const nysc = {
    id: 'q1',
    type: 'NYSC' as const,
    prompt: 'Have you completed NYSC?',
    options: ['COMPLETED', 'SERVING', 'NOT_STARTED'],
    config: { accepted: ['COMPLETED', 'SERVING'] },
  };

  it('flags an unacceptable answer but never discards the application', () => {
    const outcome = evaluateKnockouts([nysc], { q1: 'NOT_STARTED' });
    expect(outcome.passed).toBe(false);
    expect(outcome.flags).toHaveLength(1);
    expect(outcome.flags[0].reason).toContain('NYSC');
    expect(outcome.answers).toEqual([{ questionId: 'q1', value: 'NOT_STARTED', passed: false }]);
  });

  it('records the answer for a candidate who passes', () => {
    const outcome = evaluateKnockouts([nysc], { q1: 'SERVING' });
    expect(outcome.passed).toBe(true);
    expect(outcome.flags).toHaveLength(0);
  });

  it('flags an unanswered knockout question', () => {
    const outcome = evaluateKnockouts([nysc], {});
    expect(outcome.passed).toBe(false);
    expect(outcome.flags[0].reason).toContain('No answer');
  });

  it('compares degree class against the configured minimum', () => {
    const outcome = evaluateKnockouts(
      [
        {
          id: 'q2',
          type: 'DEGREE_CLASS',
          prompt: 'What class of degree did you obtain?',
          options: [],
          config: { minClass: 'SECOND_UPPER' },
        },
      ],
      { q2: 'Second Class Lower' },
    );
    expect(outcome.passed).toBe(false);
    expect(outcome.flags[0].reason).toContain('below');
  });
});
describe('PDF fonts', () => {
  it('resolves the bundled Unicode fonts', () => {
    const fonts = resolvePdfFonts();
    expect(fonts).not.toBeNull();
    expect(fonts!.body).toContain('assets');
    expect(fonts!.body.endsWith('DejaVuSans.ttf')).toBe(true);
    expect(fonts!.bold.endsWith('DejaVuSans-Bold.ttf')).toBe(true);
  });

  it('maps Yoruba sub-dot glyphs so ṣ and ẹ are embedded, not dropped', async () => {
    const doc = new PDFDocument({ size: 'A4', compress: false });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
    expect(registerPdfFonts(doc)).toBe(true);
    doc.font('Body').fontSize(12).text('Iṣẹ́ ẹ ṣ');
    doc.font('Bold').text('Iṣẹ́');
    doc.end();
    const pdf = (await done).toString('latin1');
    expect(pdf).toContain('DejaVuSans');
    expect(pdf).toMatch(/<1e63>/i);
    expect(pdf).toMatch(/<1eb9>/i);
  });
});
