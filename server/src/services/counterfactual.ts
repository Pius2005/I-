import type { ParsedCVData } from '../domain/types.js';

/**
 * Counterfactual identity testing.
 *
 * Holds qualifications constant and swaps only identity signals. A fair scorer
 * should produce (nearly) identical totals for every variant.
 */

export interface CounterfactualVariant {
  id: string;
  label: string;
  cv: ParsedCVData;
  identity: Record<string, string>;
}

const NAME_SWAPS: { label: string; name: string; group: string }[] = [
  { label: 'Yoruba-presenting name', name: 'Adebayo Ogunleye', group: 'Yoruba' },
  { label: 'Igbo-presenting name', name: 'Chinedu Okonkwo', group: 'Igbo' },
  { label: 'Hausa-presenting name', name: 'Aisha Bello', group: 'Hausa-Fulani' },
  { label: 'Female-presenting name', name: 'Blessing Eze', group: 'Female' },
  { label: 'Male-presenting name', name: 'Ibrahim Musa', group: 'Male' },
];

export const IDENTITY_SWAPS = {
  names: NAME_SWAPS,
  universities: [
    { label: 'Federal university', type: 'FEDERAL' as const, institution: 'University of Lagos' },
    { label: 'State university', type: 'STATE' as const, institution: 'Lagos State University' },
    { label: 'Private university', type: 'PRIVATE' as const, institution: 'Covenant University' },
    { label: 'Polytechnic', type: 'POLYTECHNIC' as const, institution: 'Yaba College of Technology' },
  ],
  states: ['Lagos', 'Kano', 'Enugu', 'Rivers', 'Kaduna'],
};

export function buildVariants(base: ParsedCVData): CounterfactualVariant[] {
  const variants: CounterfactualVariant[] = [
    { id: 'baseline', label: 'Baseline (as submitted)', cv: base, identity: {} },
  ];

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

export function deltaAgainstBaseline(
  results: { variantId: string; total: number }[],
): { variantId: string; delta: number }[] {
  const baseline = results.find((r) => r.variantId === 'baseline')?.total ?? 0;
  return results.map((r) => ({ variantId: r.variantId, delta: r.total - baseline }));
}
