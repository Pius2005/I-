import type { ParsedCVData } from './types.js';

/**
 * Blind-screening redaction.
 *
 * Two layers: structured fields are dropped, and free text is scrubbed of names,
 * emails, phone numbers and (optionally) universities. Redaction runs before the
 * recruiter payload leaves the server, so a recruiter can never see the original.
 */

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
    // Redact each name token of 3+ characters and the full name.
    out = out.replace(new RegExp(escapeRegExp(name), 'gi'), '[name hidden]');
    for (const part of name.split(/\s+/)) {
      if (part.length >= 3) {
        out = out.replace(new RegExp(`\\b${escapeRegExp(part)}\\b`, 'gi'), '[name hidden]');
      }
    }
  }

  // Nigerian state-of-origin / marital / religion / DOB lines are removed wholesale.
  out = out
    .split('\n')
    .filter(
      (line) =>
        !/^\s*(state of origin|date of birth|d\.o\.b|marital status|religion|gender|sex)\s*[:\-]/i.test(
          line,
        ),
    )
    .join('\n');

  if (options.hideUniversity) {
    out = out.replace(/(University of [A-Za-z\s]+|University [A-Za-z\s]+|[A-Za-z\s]+ University|[A-Za-z\s]+ Polytechnic)/g, '[institution hidden]');
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

/** Removes identity signals from the scoring input. Scoring must never see them. */
export function stripIdentityForScoring(cv: ParsedCVData): ParsedCVData {
  return {
    ...cv,
    name: null,
    email: null,
    phone: null,
    location: null,
    summary: cv.summary ?? null,
  };
}

export interface IdentityReveal {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
}

export interface BlindApplicationView {
  anonymousRef: string;
  identityRevealed: boolean;
  candidate?: IdentityReveal;
  cv: ParsedCVData | null;
  cvText: string | null;
}

export function buildBlindView(args: {
  anonymousRef: string;
  identityRevealed: boolean;
  candidate: IdentityReveal;
  cv: ParsedCVData | null;
  cvText: string | null;
  hideUniversity: boolean;
}): BlindApplicationView {
  const { anonymousRef, identityRevealed, candidate, cv, cvText, hideUniversity } = args;
  if (identityRevealed) {
    return { anonymousRef, identityRevealed: true, candidate, cv, cvText };
  }
  const names = [candidate.name, candidate.name?.split(' ')[0]].filter(Boolean) as string[];
  return {
    anonymousRef,
    identityRevealed: false,
    cv: cv ? redactCvData(cv, { hideUniversity, names }) : null,
    cvText: cvText ? redactText(cvText, { hideUniversity, names }) : null,
  };
}
