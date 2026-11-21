import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Columns3, Eye, Scale, ShieldCheck, Users } from 'lucide-react';
import { request, qs } from '../../lib/api';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  PageLoader,
  ScoreRing,
  Select,
  Textarea,
} from '../../components/ui';
import { STAGE_LABELS, STAGE_TONE, formatDate, scoreTone } from '../../lib/utils';

interface PipelineItem {
  id: string;
  anonymousRef: string;
  score: number | null;
  stage: string;
  knockoutPassed: boolean;
  knockoutFlagCount: number;
  identityRevealed: boolean;
  createdAt: string;
  humanReviewRequestedAt: string | null;
  headline: string | null;
  skills: string[];
}

interface PipelineData {
  job: { id: string; title: string; blindScreening: boolean; hideUniversityBlind: boolean; stages: string[] };
  stages: Record<string, { count: number; items: PipelineItem[] }>;
  total: number;
}

const COLUMN_STAGES = ['APPLIED', 'SCREENED', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED'];
const MOVE_STAGES = ['SCREENED', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED'];

export default function PipelinePage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkStage, setBulkStage] = useState('SHORTLISTED');
  const [bulkReason, setBulkReason] = useState('');
  const [bulkOverride, setBulkOverride] = useState('');
  const [search, setSearch] = useState('');

  const query = useQuery({
    queryKey: ['recruiter', 'pipeline', id],
    queryFn: () => request<PipelineData>(`/recruiter/jobs/${id}/pipeline`),
  });

  const bulkMutation = useMutation({
    mutationFn: () =>
      request<{ succeeded: number; failed: number; results: { id: string; ok: boolean; error?: string }[] }>(
        `/recruiter/jobs/${id}/bulk`,
        {
          method: 'POST',
          body: {
            applicationIds: selected,
            stage: bulkStage,
            reason: bulkReason || undefined,
            overrideReason: bulkOverride || undefined,
          },
        },
      ),
    onSuccess: async () => {
      setBulkOpen(false);
      setSelected([]);
      setBulkReason('');
      setBulkOverride('');
      await queryClient.invalidateQueries({ queryKey: ['recruiter'] });
    },
  });

  const data = query.data;
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!data) return {} as Record<string, PipelineItem[]>;
    const map: Record<string, PipelineItem[]> = {};
    for (const stage of COLUMN_STAGES) {
      const items = data.stages[stage]?.items ?? [];
      map[stage] = term
        ? items.filter(
            (item) =>
              item.anonymousRef.toLowerCase().includes(term) ||
              (item.headline ?? '').toLowerCase().includes(term) ||
              item.skills.some((skill) => skill.toLowerCase().includes(term)),
          )
        : items;
    }
    return map;
  }, [data, search]);

  if (query.isLoading) return <PageLoader label="Loading pipeline…" />;
  if (query.isError) return <Alert tone="bad">{(query.error as Error).message}</Alert>;
  if (!data) return null;

  const toggle = (applicationId: string) =>
    setSelected((current) =>
      current.includes(applicationId) ? current.filter((value) => value !== applicationId) : [...current, applicationId],
    );

  const allVisible = Object.values(filtered).flat();
  const allSelected = allVisible.length > 0 && allVisible.every((item) => selected.includes(item.id));

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={data.job.title}
        description={`${data.total} application(s). Blind screening ${data.job.blindScreening ? 'is on' : 'is off'}. Moving a candidate is a human decision and is recorded with its reason.`}
        action={
          <div className="flex flex-wrap gap-2">
            <Link to="/recruiter/jobs">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Jobs
              </Button>
            </Link>
            <Link to={`/recruiter/jobs/${id}/compare${selected.length >= 2 ? qs({ ids: selected.join(',') }) : ''}`}>
              <Button variant="secondary" size="sm" disabled={selected.length < 2}>
                <Scale className="h-4 w-4" aria-hidden="true" /> Compare ({selected.length})
              </Button>
            </Link>
            <Link to={`/recruiter/jobs/${id}/audit`}>
              <Button variant="secondary" size="sm">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Bias audit
              </Button>
            </Link>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search reference, headline or skill"
          aria-label="Search pipeline"
          className="w-full max-w-sm rounded-lg border border-line bg-white px-3 py-2 text-sm"
        />
        <Checkbox
          checked={allSelected}
          label="Select all visible"
          onChange={() => setSelected(allSelected ? [] : allVisible.map((item) => item.id))}
        />
        {data.job.blindScreening && (
          <Badge tone="info">
            <Eye className="h-3 w-3" aria-hidden="true" /> Identity hidden until shortlist + reveal
          </Badge>
        )}
      </div>

      {bulkMutation.isError && (
        <Alert tone="bad" className="mb-4">
          {(bulkMutation.error as Error).message}
        </Alert>
      )}

      {!data.total && (
        <EmptyState
          icon={<Users className="h-5 w-5" />}
          title="No applications yet"
          description="Share the public job link. Applications are parsed and scored automatically, then land here for a human decision."
        />
      )}

      <div className="grid gap-4 overflow-x-auto pb-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {COLUMN_STAGES.map((stage) => {
          const items = filtered[stage] ?? [];
          const count = data.stages[stage]?.count ?? 0;
          return (
            <section key={stage} className="min-w-64 rounded-2xl border border-line bg-white/60 p-3" aria-label={`${STAGE_LABELS[stage]} column`}>
              <header className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Columns3 className="h-4 w-4 text-muted" aria-hidden="true" />
                  <h2 className="text-sm font-semibold">{STAGE_LABELS[stage]}</h2>
                  <Badge tone={STAGE_TONE[stage] ?? 'neutral'}>{count}</Badge>
                </div>
              </header>
              <div className="space-y-2">
                {!items.length && <p className="px-1 py-4 text-xs text-muted">No candidates at this stage.</p>}
                {items.map((item) => (
                  <article
                    key={item.id}
                    className="rounded-xl border border-line bg-white p-3 shadow-sm transition hover:border-forest-300"
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 rounded border-line text-forest-600"
                        checked={selected.includes(item.id)}
                        onChange={() => toggle(item.id)}
                        aria-label={`Select ${item.anonymousRef}`}
                      />
                      <div className="min-w-0 flex-1">
                        <Link
                          to={`/recruiter/applications/${item.id}`}
                          className="block truncate text-sm font-semibold hover:text-forest-700 hover:underline"
                        >
                          {item.anonymousRef}
                        </Link>
                        {item.headline && <p className="line-clamp-2 text-xs text-muted">{item.headline}</p>}
                      </div>
                      <Badge tone={scoreTone(item.score)}>{item.score ?? '—'}</Badge>
                    </div>
                    {item.skills.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {item.skills.map((skill) => (
                          <span key={skill} className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-700">
                            {skill}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {!item.knockoutPassed && (
                        <Badge tone="warn">
                          <AlertTriangle className="h-3 w-3" aria-hidden="true" /> {item.knockoutFlagCount} knockout
                        </Badge>
                      )}
                      {item.humanReviewRequestedAt && <Badge tone="info">Review requested</Badge>}
                      {item.identityRevealed && <Badge tone="good">Revealed</Badge>}
                      <span className="ml-auto text-[11px] text-muted">{formatDate(item.createdAt)}</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {selected.length > 0 && (
        <div className="sticky bottom-3 z-20 mt-2 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-forest-200 bg-white p-3 shadow-lg">
          <p className="text-sm font-medium">
            {selected.length} candidate(s) selected
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
              Clear
            </Button>
            <Button size="sm" onClick={() => setBulkOpen(true)}>
              Move selected
            </Button>
          </div>
        </div>
      )}

      <Modal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title={`Move ${selected.length} candidate(s)`}
        description="Every move is written to the status history and audit log with your name."
        footer={
          <>
            <Button variant="secondary" onClick={() => setBulkOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={bulkMutation.isPending}
              onClick={() => {
                if (bulkStage === 'REJECTED' && bulkReason.trim().length < 5) return;
                bulkMutation.mutate();
              }}
              disabled={bulkStage === 'REJECTED' && bulkReason.trim().length < 5}
            >
              Move candidates
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="New stage" htmlFor="bulkStage">
            <Select id="bulkStage" value={bulkStage} onChange={(e) => setBulkStage(e.target.value)}>
              {MOVE_STAGES.map((stage) => (
                <option key={stage} value={stage}>
                  {STAGE_LABELS[stage]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={bulkStage === 'REJECTED' ? 'Rejection reason (required)' : 'Reason (optional)'}
            htmlFor="bulkReason"
            hint="stored for audit"
          >
            <Textarea
              id="bulkReason"
              rows={3}
              value={bulkReason}
              onChange={(e) => setBulkReason(e.target.value)}
              placeholder="Evidence-based reason, e.g. did not evidence the required SQL criterion."
            />
          </Field>
          <Field label="Override reason" htmlFor="bulkOverride" hint="needed only when overriding the AI recommendation">
            <Textarea id="bulkOverride" rows={2} value={bulkOverride} onChange={(e) => setBulkOverride(e.target.value)} />
          </Field>
          {bulkMutation.isError && <Alert tone="bad">{(bulkMutation.error as Error).message}</Alert>}
        </div>
      </Modal>
    </div>
  );
}

// --- Compare ----------------------------------------------------------------
interface CompareCandidate {
  id: string;
  anonymousRef: string;
  score: number | null;
  stage: string;
  knockoutPassed: boolean;
  skills: string[];
  education: { institution: string; course?: string; degreeLevel?: string; degreeClass?: string }[];
  breakdown: { label: string; score: number; weight: number; rationale: string }[];
  explanation: string | null;
}

export function ComparePage() {
  const { id = '' } = useParams();
  const [searchParams] = useSearchParams();
  const ids = searchParams.get('ids') ?? '';

  const query = useQuery({
    queryKey: ['recruiter', 'compare', id, ids],
    queryFn: () => request<CompareCandidate[]>(`/recruiter/jobs/${id}/compare${qs({ ids })}`),
    enabled: ids.split(',').filter(Boolean).length >= 2,
  });

  if (ids.split(',').filter(Boolean).length < 2) {
    return (
      <div>
        <PageHeader title="Compare candidates" description="Select two or more candidates from the pipeline." />
        <EmptyState
          icon={<Scale className="h-5 w-5" />}
          title="Nothing selected"
          description="Go back to the pipeline and tick the candidates you want side by side."
          action={
            <Link to={`/recruiter/jobs/${id}/pipeline`}>
              <Button>Open pipeline</Button>
            </Link>
          }
        />
      </div>
    );
  }

  if (query.isLoading) return <PageLoader label="Comparing candidates…" />;
  if (query.isError) return <Alert tone="bad">{(query.error as Error).message}</Alert>;

  const candidates = query.data ?? [];
  const criterionLabels = [...new Set(candidates.flatMap((candidate) => candidate.breakdown.map((item) => item.label)))];

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Compare candidates"
        description="Same rubric, side by side. Differences in wording are shown so a person can judge the evidence."
        action={
          <Link to={`/recruiter/jobs/${id}/pipeline`}>
            <Button variant="secondary" size="sm">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to pipeline
            </Button>
          </Link>
        }
      />

      <div className="overflow-x-auto">
        <div className="grid min-w-[720px] gap-4" style={{ gridTemplateColumns: `180px repeat(${candidates.length}, minmax(220px, 1fr))` }}>
          <div />
          {candidates.map((candidate) => (
            <Card key={candidate.id} className="p-4">
              <ScoreRing score={candidate.score} size={64} />
              <Link to={`/recruiter/applications/${candidate.id}`} className="mt-2 block text-sm font-semibold hover:underline">
                {candidate.anonymousRef}
              </Link>
              <p className="text-xs text-muted">{STAGE_LABELS[candidate.stage] ?? candidate.stage}</p>
              {!candidate.knockoutPassed && (
                <Badge tone="warn" className="mt-2">
                  Knockout flag
                </Badge>
              )}
            </Card>
          ))}

          {criterionLabels.map((label) => (
            <div key={label} className="contents">
              <div className="flex items-center border-t border-line py-3 text-xs font-medium text-ink/70">{label}</div>
              {candidates.map((candidate) => {
                const item = candidate.breakdown.find((entry) => entry.label === label);
                return (
                  <div key={`${candidate.id}-${label}`} className="border-t border-line py-3">
                    {item ? (
                      <>
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold tabular-nums">{Math.round(item.score * 100)}%</span>
                          <span className="text-muted">weight {item.weight}%</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-stone-200">
                          <div className="h-full rounded-full bg-forest-600" style={{ width: `${item.score * 100}%` }} />
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-muted">{item.rationale}</p>
                      </>
                    ) : (
                      <span className="text-xs text-muted">No data</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          <div className="border-t border-line py-3 text-xs font-medium text-ink/70">Skills</div>
          {candidates.map((candidate) => (
            <div key={`${candidate.id}-skills`} className="border-t border-line py-3">
              <div className="flex flex-wrap gap-1">
                {candidate.skills.slice(0, 8).map((skill) => (
                  <span key={skill} className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px]">
                    {skill}
                  </span>
                ))}
                {!candidate.skills.length && <span className="text-xs text-muted">None parsed</span>}
              </div>
            </div>
          ))}

          <div className="border-t border-line py-3 text-xs font-medium text-ink/70">Education</div>
          {candidates.map((candidate) => (
            <div key={`${candidate.id}-edu`} className="border-t border-line py-3 text-xs text-muted">
              {candidate.education.slice(0, 2).map((entry, index) => (
                <p key={index}>
                  {entry.degreeLevel ?? 'Degree'} {entry.course ? `— ${entry.course}` : ''} · {entry.institution}
                </p>
              ))}
              {!candidate.education.length && 'No education parsed'}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
