/**
 * Bias-audit statistics.
 *
 * Pure functions so the maths can be unit tested independently of the database.
 * Every function reports suppressed groups rather than silently dropping them.
 */

export interface GroupObservation {
  group: string;
  /** Whether the member was selected (advanced) at this stage. */
  selected: boolean;
  /** Numeric proxy value, e.g. CV length or years of experience. */
  value?: number;
  /** Numeric score used for proxy / override tests. */
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

export function selectionRates(
  observations: GroupObservation[],
  minGroupSize = 5,
): GroupStat[] {
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

/**
 * Four-fifths rule: any group whose selection rate is below `threshold` (0.8)
 * of the highest group's rate is flagged.
 */
export function adverseImpact(groups: GroupStat[], threshold = 0.8): ImpactAnalysis {
  const eligible = groups.filter((g) => !g.suppressed && g.total > 0);
  if (eligible.length < 2) {
    return {
      highestGroup: eligible[0]?.group ?? null,
      highestRate: eligible[0]?.rate ?? 0,
      groups: groups.map((g) => ({
        ...g,
        ratio: 1,
        severity: 'none' as Severity,
        flagged: false,
      })),
      flagged: false,
      summary:
        'Not enough declared groups above the privacy threshold to run an adverse-impact test.',
    };
  }
  const highest = eligible.reduce((best, g) => (g.rate > best.rate ? g : best), eligible[0]);
  const results: ImpactResult[] = groups.map((g) => {
    const ratio = highest.rate > 0 ? g.rate / highest.rate : 1;
    const severity = severityFor(ratio, g.suppressed);
    return {
      group: g.group,
      total: g.total,
      selected: g.selected,
      rate: g.rate,
      ratio: Number(ratio.toFixed(3)),
      severity,
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

/** Two-proportion z-test p-value (two-tailed) using the normal approximation. */
export function twoProportionPValue(aSelected: number, aTotal: number, bSelected: number, bTotal: number): number {
  if (aTotal === 0 || bTotal === 0) return 1;
  const p1 = aSelected / aTotal;
  const p2 = bSelected / bTotal;
  const p = (aSelected + bSelected) / (aTotal + bTotal);
  const se = Math.sqrt(p * (1 - p) * (1 / aTotal + 1 / bTotal));
  if (se === 0) return 1;
  const z = Math.abs((p1 - p2) / se);
  // Two-tailed normal survival function via erfc approximation.
  return Math.max(0, Math.min(1, 2 * (1 - normalCdf(z))));
}

function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p =
    d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/** Pearson correlation, returns 0 for degenerate input. */
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

/** Point-biserial correlation between a binary group flag and a numeric value. */
export function pointBiserial(isGroup: boolean[], values: number[]): number {
  return pearson(isGroup.map((b) => (b ? 1 : 0)), values);
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

/**
 * Flags features that correlate both with a protected group and with the score.
 * A feature that predicts the score and the group is a possible proxy.
 */
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

export function severityLabel(severity: Severity): string {
  switch (severity) {
    case 'severe':
      return 'Severe (below 50% of the highest group’s rate)';
    case 'high':
      return 'High (below 67%)';
    case 'moderate':
      return 'Moderate (below 80% — four-fifths rule)';
    default:
      return 'No adverse impact detected';
  }
}
