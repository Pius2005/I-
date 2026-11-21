import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, ArrowLeft, Download, FileText, FlaskConical, Info, ShieldCheck } from 'lucide-react';
import { download, qs, request } from '../../lib/api';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  PageLoader,
  StatCard,
  StatusBadge,
  Tabs,
} from '../../components/ui';
import { STAGE_LABELS, STAGE_TONE, formatDate, formatDateTime, percent } from '../../lib/utils';

interface GroupStat {
  group: string;
  total: number;
  selected: number;
  rate: number;
  suppressed: boolean;
}

interface ImpactGroup extends GroupStat {
  ratio: number;
  severity: string;
  flagged: boolean;
}

interface Analysis {
  highestGroup: string | null;
  highestRate: number;
  groups: ImpactGroup[];
  flagged: boolean;
  summary: string;
}

interface StageAnalysis {
  stage: string;
  label: string;
  groups: Record<string, { stats: GroupStat[]; analysis: Analysis }>;
  flagged: boolean;
}

interface Snapshot {
  scope: { jobId: string | null; organisationId: string | null; jobTitle: string | null };
  generatedAt: string;
  sampleSize: number;
  declaredSample: number;
  stages: StageAnalysis[];
  proxyFindings: {
    proxy: string;
    correlationWithScore: number;
    strongestGroup: string | null;
    correlationWithGroup: number;
    sampleSize: number;
    flagged: boolean;
    note: string;
  }[];
  overrideAnalysis: {
    dimension: string;
    total: number;
    aiAgreementRate: number;
    groups: { group: string; total: number; favourableOverrides: number; disfavourableOverrides: number; favourableRate: number; disfavourableRate: number; flagged: boolean }[];
    flagged: boolean;
    note: string;
  }[];
  counterfactual?: { runs: number; maxDelta: number; flagged: number };
  flags: { code: string; severity: string; message: string }[];
  findings: string[];
  suggestedFixes: string[];
  sampleWarnings: string[];
  methodology: string[];
  minGroupSize: number;
  threshold: number;
}

interface Overview {
  jobs: { id: string; title: string; status: string; applications: number; lastReport: { flagCount: number; createdAt: string } | null }[];
  reports: { id: string; jobId: string | null; flagCount: number; createdAt: string; sampleSize: number }[];
  totalApplications: number;
  flaggedReports: number;
}

const DIMENSIONS = [
  { key: 'gender', label: 'Gender' },
  { key: 'ageBand', label: 'Age band' },
  { key: 'region', label: 'Region' },
  { key: 'universityType', label: 'University type' },
  { key: 'degreeClass', label: 'Degree class' },
  { key: 'disability', label: 'Disability' },
];

// --- Overview ---------------------------------------------------------------
export default function AuditOverviewPage({ global = false }: { global?: boolean }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({ queryKey: ['audit', 'overview'], queryFn: () => request<Overview>('/audit/overview') });

  const generate = useMutation({
    mutationFn: () => request<{ reportId: string }>('/audit/reports', { method: 'POST', body: {} }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['audit'] });
      await download(`/audit/reports/${result.reportId}/pdf`, `ise-bias-report-${result.reportId}.pdf`);
    },
    onError: (err) => setError((err as Error).message),
  });

  if (query.isLoading) return <PageLoader label="Loading audit overview…" />;
  if (query.isError) return <Alert tone="bad">{(query.error as Error).message}</Alert>;
  const data = query.data!;
  const jobTitle = (id: string | null) => data.jobs.find((job) => job.id === id)?.title ?? 'Organisation-wide';

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={global ? 'Bias audit — system wide' : 'Bias audit'}
        description="Selection rates, four-fifths adverse impact, proxy detection, override patterns and counterfactual tests. Flags are prompts for human investigation, not legal findings."
        action={
          <Button loading={generate.isPending} onClick={() => generate.mutate()}>
            <FileText className="h-4 w-4" aria-hidden="true" /> Generate report
          </Button>
        }
      />

      {error && (
        <Alert tone="bad" className="mb-4">
          {error}
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Applications analysed" value={data.totalApplications} icon={<ShieldCheck className="h-5 w-5" />} />
        <StatCard label="Jobs in scope" value={data.jobs.length} />
        <StatCard label="Reports generated" value={data.reports.length} />
        <StatCard
          label="Reports with flags"
          value={data.flaggedReports}
          tone={data.flaggedReports ? 'warn' : 'good'}
          icon={<AlertTriangle className="h-5 w-5" />}
          hint="Investigate each before further offers"
        />
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.4fr,1fr]">
        <Card>
          <CardHeader title="Jobs" subtitle="Open a job’s audit to see stage-by-stage selection rates." />
          <div className="divide-y divide-line">
            {!data.jobs.length && <p className="px-5 py-6 text-sm text-muted">No jobs yet.</p>}
            {data.jobs.map((job) => (
              <div key={job.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{job.title}</p>
                  <p className="text-xs text-muted">{job.applications} application(s)</p>
                </div>
                <StatusBadge status={STAGE_LABELS[job.status] ?? job.status} tone={STAGE_TONE[job.status] ?? 'neutral'} />
                {job.lastReport ? (
                  <Badge tone={job.lastReport.flagCount ? 'warn' : 'good'}>
                    {job.lastReport.flagCount} flag(s) · {formatDate(job.lastReport.createdAt)}
                  </Badge>
                ) : (
                  <Badge tone="neutral">No report</Badge>
                )}
                <Link to={`/recruiter/jobs/${job.id}/audit`} className="text-sm font-medium text-forest-700 hover:underline">
                  Audit
                </Link>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Recent reports" subtitle="Download the PDF for a record of the methodology and findings." />
          <div className="divide-y divide-line">
            {!data.reports.length && <p className="px-5 py-6 text-sm text-muted">No reports generated yet.</p>}
            {data.reports.map((report) => (
              <div key={report.id} className="flex items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{jobTitle(report.jobId)}</p>
                  <p className="text-xs text-muted">
                    {formatDateTime(report.createdAt)} · {report.sampleSize} application(s)
                  </p>
                </div>
                <Badge tone={report.flagCount ? 'warn' : 'good'}>{report.flagCount} flag(s)</Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Download report PDF"
                  onClick={() => download(`/audit/reports/${report.id}/pdf`, `ise-bias-report-${report.id}.pdf`)}
                >
                  <Download className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

// --- Per-job audit ----------------------------------------------------------
export function JobAuditPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const [stageIndex, setStageIndex] = useState(0);
  const [dimension, setDimension] = useState('gender');
  const [error, setError] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['audit', 'snapshot', id],
    queryFn: () => request<Snapshot>(`/audit/snapshot${qs({ jobId: id })}`),
  });

  const runs = useQuery({
    queryKey: ['audit', 'counterfactual', id],
    queryFn: () =>
      request<{ id: string; maxDelta: number; threshold: number; flagged: boolean; createdAt: string }[]>(
        `/audit/jobs/${id}/counterfactual`,
      ),
  });

  const generate = useMutation({
    mutationFn: () => request<{ reportId: string }>('/audit/reports', { method: 'POST', body: { jobId: id } }),
    onSuccess: async (result) => {
      setReportId(result.reportId);
      await queryClient.invalidateQueries({ queryKey: ['audit'] });
    },
    onError: (err) => setError((err as Error).message),
  });

  if (query.isLoading) return <PageLoader label="Computing audit statistics…" />;
  if (query.isError) return <Alert tone="bad">{(query.error as Error).message}</Alert>;
  const snapshot = query.data!;
  const stage = snapshot.stages[Math.min(stageIndex, snapshot.stages.length - 1)];
  const dimensionData = stage?.groups[dimension];
  const chartData = (dimensionData?.stats ?? [])
    .filter((group) => !group.suppressed)
    .map((group) => ({ name: group.group, rate: Math.round(group.rate * 1000) / 10, total: group.total }));

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={`Bias audit — ${snapshot.scope.jobTitle ?? 'job'}`}
        description={`${snapshot.sampleSize} application(s), ${snapshot.declaredSample} with voluntary self-declaration. Groups below ${snapshot.minGroupSize} are suppressed.`}
        action={
          <div className="flex flex-wrap gap-2">
            <Link to="/recruiter/audit">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Overview
              </Button>
            </Link>
            <Link to={`/recruiter/jobs/${id}/pipeline`}>
              <Button variant="secondary" size="sm">
                Pipeline
              </Button>
            </Link>
            <Button size="sm" loading={generate.isPending} onClick={() => generate.mutate()}>
              <FileText className="h-4 w-4" aria-hidden="true" /> Generate report
            </Button>
            {reportId && (
              <Button
                size="sm"
                variant="gold"
                onClick={() => download(`/audit/reports/${reportId}/pdf`, `ise-bias-report-${reportId}.pdf`)}
              >
                <Download className="h-4 w-4" aria-hidden="true" /> PDF
              </Button>
            )}
          </div>
        }
      />

      {error && (
        <Alert tone="bad" className="mb-4">
          {error}
        </Alert>
      )}

      {snapshot.flags.length > 0 ? (
        <Alert tone="warn" title={`${snapshot.flags.length} statistical flag(s) need investigation`} className="mb-4">
          <ul className="list-disc space-y-1 pl-4">
            {snapshot.flags.map((flag, index) => (
              <li key={index}>{flag.message}</li>
            ))}
          </ul>
        </Alert>
      ) : (
        <Alert tone="good" title="No statistical flags at the current thresholds" className="mb-4">
          This does not certify fairness. Keep sample sizes, self-declaration rates and counterfactual runs under review.
        </Alert>
      )}

      {snapshot.findings.length > 0 && (
        <Card className="mb-5 p-5">
          <p className="text-sm font-semibold">Findings</p>
          <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-ink/85">
            {snapshot.findings.map((finding, index) => (
              <li key={index} className="flex gap-2">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-forest-600" aria-hidden="true" />
                {finding}
              </li>
            ))}
          </ul>
          {snapshot.suggestedFixes.length > 0 && (
            <>
              <p className="mt-4 text-sm font-semibold">Suggested next steps</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink/85">
                {snapshot.suggestedFixes.map((fix, index) => (
                  <li key={index}>{fix}</li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}

      {snapshot.sampleWarnings.length > 0 && (
        <div className="mb-5 space-y-2">
          {snapshot.sampleWarnings.map((warning, index) => (
            <p key={index} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
              {warning}
            </p>
          ))}
        </div>
      )}

      <Card className="mb-5">
        <CardHeader
          title="Selection rates by stage"
          subtitle="Selection rate = group members who advanced ÷ group members who reached the stage. Ratio is against the highest group."
        />
        <div className="px-5 pt-4">
          <Tabs
            value={String(stageIndex)}
            onChange={(value) => setStageIndex(Number(value))}
            tabs={snapshot.stages.map((entry, index) => ({ value: String(index), label: entry.label, count: entry.flagged ? 1 : undefined }))}
          />
          <div className="mt-3">
            <Tabs value={dimension} onChange={setDimension} tabs={DIMENSIONS.map((dim) => ({ value: dim.key, label: dim.label }))} />
          </div>
        </div>

        <div className="mt-4 grid gap-5 px-5 pb-5 xl:grid-cols-[1fr,1fr]">
          <div>
            {dimensionData?.analysis.summary && (
              <p className={`mb-3 rounded-lg px-3 py-2 text-xs ${dimensionData.analysis.flagged ? 'bg-amber-50 text-amber-950' : 'bg-forest-50 text-forest-900'}`}>
                {dimensionData.analysis.summary}
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="py-2">Group</th>
                    <th className="py-2 text-right">Reached</th>
                    <th className="py-2 text-right">Selected</th>
                    <th className="py-2 text-right">Rate</th>
                    <th className="py-2 text-right">Ratio</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(dimensionData?.analysis.groups ?? []).map((group) => (
                    <tr key={group.group} className={group.flagged ? 'bg-red-50/60' : undefined}>
                      <td className="py-2">
                        <span className="flex items-center gap-1.5">
                          {group.group}
                          {group.flagged && <AlertTriangle className="h-3.5 w-3.5 text-red-600" aria-label="Flagged" />}
                        </span>
                      </td>
                      <td className="py-2 text-right tabular-nums">{group.total}</td>
                      <td className="py-2 text-right tabular-nums">{group.selected}</td>
                      <td className="py-2 text-right tabular-nums">{group.suppressed ? 'suppressed' : percent(group.rate)}</td>
                      <td className="py-2 text-right tabular-nums">{group.suppressed ? '—' : percent(group.ratio)}</td>
                    </tr>
                  ))}
                  {!(dimensionData?.analysis.groups ?? []).length && (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-xs text-muted">
                        No declared data for this dimension yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="h-64">
            {chartData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee9dc" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} unit="%" domain={[0, 100]} />
                  <Tooltip
                    contentStyle={{ borderRadius: 12, borderColor: '#e2ddcd', fontSize: 12 }}
                    formatter={(value, _name, item) => [`${value}%`, `${(item.payload as { total: number }).total} in group`]}
                  />
                  <Bar dataKey="rate" radius={[4, 4, 0, 0]}>
                    {chartData.map((entry) => (
                      <Cell key={entry.name} fill={entry.name === dimensionData?.analysis.highestGroup ? '#0b5d3b' : '#c89b3c'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-muted">
                No reportable groups for this dimension at this stage.
              </div>
            )}
          </div>
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Proxy detection" subtitle="CV features that correlate with both group and score are possible proxies." />
          <div className="overflow-x-auto px-5 py-4">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="py-2">Feature</th>
                  <th className="py-2 text-right">r (score)</th>
                  <th className="py-2 text-right">r (group)</th>
                  <th className="py-2">Strongest group</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {!snapshot.proxyFindings.length && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-xs text-muted">
                      Not enough scored, self-declared applications to test proxies (needs 6+).
                    </td>
                  </tr>
                )}
                {snapshot.proxyFindings.map((finding) => (
                  <tr key={finding.proxy} className={finding.flagged ? 'bg-red-50/60' : undefined}>
                    <td className="py-2">{finding.proxy}</td>
                    <td className="py-2 text-right tabular-nums">{finding.correlationWithScore}</td>
                    <td className="py-2 text-right tabular-nums">{finding.correlationWithGroup}</td>
                    <td className="py-2 text-xs text-muted">{finding.strongestGroup ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="Override analysis" subtitle="Where human decisions disagreed with the AI recommendation." />
          <div className="divide-y divide-line">
            {snapshot.overrideAnalysis.map((dimensionEntry) => (
              <div key={dimensionEntry.dimension} className="px-5 py-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{dimensionEntry.dimension}</p>
                  <Badge tone={dimensionEntry.flagged ? 'bad' : 'good'}>
                    AI agreement {percent(dimensionEntry.aiAgreementRate)}
                  </Badge>
                </div>
                <div className="mt-2 space-y-1">
                  {dimensionEntry.groups.slice(0, 5).map((group) => (
                    <div key={group.group} className="flex items-center justify-between text-xs">
                      <span className={group.flagged ? 'font-semibold text-red-800' : 'text-ink/80'}>{group.group}</span>
                      <span className="text-muted">
                        +{group.favourableOverrides} favourable · −{group.disfavourableOverrides} disfavourable
                      </span>
                    </div>
                  ))}
                  {!dimensionEntry.groups.length && <p className="text-xs text-muted">No declared data.</p>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader
          title="Counterfactual runs"
          subtitle="Identity-swapped re-scoring of real or synthetic CVs. Max delta above the threshold flags the rubric."
          action={
            <Badge tone={snapshot.counterfactual?.flagged ? 'bad' : 'neutral'}>
              <FlaskConical className="h-3 w-3" aria-hidden="true" /> {snapshot.counterfactual?.runs ?? 0} run(s)
            </Badge>
          }
        />
        <div className="divide-y divide-line">
          {!runs.data?.length && (
            <p className="px-5 py-5 text-sm text-muted">
              No counterfactual runs yet. Run one from an application’s Fairness test tab.
            </p>
          )}
          {runs.data?.map((run) => (
            <div key={run.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <span className="text-sm">Max delta {run.maxDelta} point(s)</span>
              <span className="text-xs text-muted">threshold {run.threshold}</span>
              <Badge tone={run.flagged ? 'bad' : 'good'}>{run.flagged ? 'Flagged' : 'Within threshold'}</Badge>
              <span className="ml-auto text-xs text-muted">{formatDateTime(run.createdAt)}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="mt-5">
        <CardHeader title="Methodology and limits" subtitle="Read this alongside every number above." />
        <div className="px-5 py-4">
          <ul className="list-disc space-y-1.5 pl-5 text-xs leading-relaxed text-muted">
            {snapshot.methodology.map((entry, index) => (
              <li key={index}>{entry}</li>
            ))}
          </ul>
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-950">
            Statistical anomalies are not legal findings of discrimination. Self-declaration is voluntary and can itself bias the comparison.
            Review flagged stages with the hiring panel and a qualified adviser before acting. Generated {formatDateTime(snapshot.generatedAt)}.
          </div>
        </div>
      </Card>

      {snapshot.sampleSize === 0 && (
        <div className="mt-5">
          <EmptyState
            icon={<ShieldCheck className="h-5 w-5" />}
            title="No applications in scope"
            description="Statistics appear once candidates apply and volunteer their demographics."
          />
        </div>
      )}
    </div>
  );
}
