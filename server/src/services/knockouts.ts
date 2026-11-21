import { DEGREE_CLASS_RANK, normaliseDegreeClass, type DegreeClassValue } from '../domain/types.js';

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

/**
 * Knockout questions flag candidates — they never delete or auto-reject them.
 * A recruiter sees the flag and the answer and decides.
 */
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
          if (!passed) reason = `Degree class ${actual.replace('_', ' ').toLowerCase()} is below the required ${min.replace('_', ' ').toLowerCase()}.`;
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
