import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  Download,
  Eye,
  FileText,
  FlaskConical,
  Gavel,
  RefreshCw,
  ShieldCheck,
  StickyNote,
  UserRound,
} from 'lucide-react';
import { download, request } from '../../lib/api';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Modal,
  PageHeader,
  PageLoader,
  ScoreRing,
  Select,
  Tabs,
  Textarea,
} from '../../components/ui';
import { STAGE_LABELS, STAGE_TONE, formatDateTime, scoreTone } from '../../lib/utils';

interface BreakdownItem {
  criterionId: string;
  label: string;
  kind: string;
  type: string;
  weight: number;
  score: number;
  rationale: string;
  matched: string[];
  missing: string[];
}

interface ParsedCV {
  headline?: string | null;
  summary?: string | null;
  skills: string[];
  education: {
    institution: string;
    institutionType?: string;
    course?: string;
    degreeLevel?: string;
    degreeClass?: string;
    startYear?: number | null;
    endYear?: number | null;
  }[];
  experience: { title: string; organisation?: string; description?: string; startYear?: number | null; endYear?: number | null }[];
  projects: { name: string; description?: string }[];
  certifications: string[];
  languages: string[];
}

interface ApplicationDetailData {
  id: string;
  job: {
    id: string;
    title: string;
    blindScreening: boolean;
    hideUniversityBlind: boolean;
    organisation: string;
    deadline: string;
    criteria: { id: string; label: string; weight: number; kind: string; type: string }[];
  };
  stage: string;
  score: number | null;
  scoredAt: string | null;
  aiRecommendedStage: string | null;
  aiRecommendationNote: string;
  breakdown: BreakdownItem[];
  explanation: string | null;
  scoreMeta: { model: string; promptVersion: string; rubricVersion: string; createdAt: string } | null;
  coverLetter: string | null;
  knockoutPassed: boolean;
  knockoutFlags: { prompt?: string; reason: string; answer?: unknown }[];
  knockoutAnswers: { prompt: string; type: string; value: unknown; passed: boolean }[];
  cvStatus: string;
  cvError: string | null;
  cvFilename: string | null;
  cv: ParsedCV | null;
  cvText: string | null;
  identityRevealed: boolean;
  identity: { name?: string | null; email?: string | null; phone?: string | null; location?: string | null } | null;
  anonymousRef: string;
  canReveal: boolean;
  humanReviewRequestedAt: string | null;
  rejectionReason: string | null;
  overrideReason: string | null;
  notes: { id: string; body: string; createdAt: string; author: { fullName: string } }[];
  statusHistory: { id: string; fromStage: string; toStage: string; reason: string | null; createdAt: string }[];
  interviews: {
    id: string;
    status: string;
    type: string;
    location: string | null;
    meetingLink: string | null;
    cancelledAt: string | null;
    slot: { startsAt: string; endsAt: string };
  }[];
  createdAt: string;
}

interface CounterfactualResult {
  runId: string;
  maxDelta: number;
  threshold: number;
  flagged: boolean;
  note: string;
  results: { variantId: string; label: string; total: number; identity: Record<string, string>; delta: number }[];
}

const DECISION_STAGES = ['SCREENED', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED'];

export default function RecruiterApplicationDetail() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('assessment');
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [revealOpen, setRevealOpen] = useState(false);
  const [stage, setStage] = useState('SHORTLISTED');
  const [reason, setReason] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [revealReason, setRevealReason] = useState('');
  const [note, setNote] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [counterfactual, setCounterfactual] = useState<CounterfactualResult | null>(null);

  const query = useQuery({
    queryKey: ['recruiter', 'application', id],
    queryFn: () => request<ApplicationDetailData>(`/recruiter/applications/${id}`),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['recruiter'] });

  const decisionMutation = useMutation({
    mutationFn: () =>
      request(`/recruiter/applications/${id}/stage`, {
        method: 'PATCH',
        body: { stage, reason: reason || undefined, overrideReason: overrideReason || undefined },
      }),
    onSuccess: async () => {
      setDecisionOpen(false);
      setReason('');
      setOverrideReason('');
      await refresh();
    },
    onError: (error) => setActionError((error as Error).message),
  });

  const revealMutation = useMutation({
    mutationFn: () => request(`/recruiter/applications/${id}/reveal`, { method: 'POST', body: { reason: revealReason } }),
    onSuccess: async () => {
      setRevealOpen(false);
      setRevealReason('');
      await refresh();
    },
    onError: (error) => setActionError((error as Error).message),
  });

  const noteMutation = useMutation({
    mutationFn: () => request(`/recruiter/applications/${id}/notes`, { method: 'POST', body: { body: note } }),
    onSuccess: async () => {
      setNote('');
      await refresh();
    },
    onError: (error) => setActionError((error as Error).message),
  });

  const rescoreMutation = useMutation({
    mutationFn: () => request(`/recruiter/applications/${id}/rescore`, { method: 'POST' }),
    onSuccess: refresh,
    onError: (error) => setActionError((error as Error).message),
  });

  const counterfactualMutation = useMutation({
    mutationFn: () =>
      request<CounterfactualResult>(`/audit/jobs/${query.data!.job.id}/counterfactual`, {
        method: 'POST',
        body: { applicationId: id },
      }),
    onSuccess: (result) => setCounterfactual(result),
    onError: (error) => setActionError((error as Error).message),
  });

  if (query.isLoading) return <PageLoader label="Loading application…" />;
  if (query.isError) return <Alert tone="bad">{(query.error as Error).message}</Alert>;
  const data = query.data!;
  const displayName = data.identityRevealed ? data.identity?.name ?? data.anonymousRef : data.anonymousRef;
  const isOverride =
    (stage === 'REJECTED' && data.aiRecommendedStage === 'SHORTLISTED') ||
    (stage === 'SHORTLISTED' && data.aiRecommendedStage === 'SCREENED');

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={displayName}
        description={`${data.job.title} · ${data.job.organisation} · applied ${formatDateTime(data.createdAt)}`}
        action={
          <div className="flex flex-wrap gap-2">
            <Link to={`/recruiter/jobs/${data.job.id}/pipeline`}>
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Pipeline
              </Button>
            </Link>
            {query.data!.canReveal && (
              <Button variant="secondary" size="sm" onClick={() => setRevealOpen(true)}>
                <Eye className="h-4 w-4" aria-hidden="true" /> Reveal identity
              </Button>
            )}
            <Button size="sm" onClick={() => setDecisionOpen(true)}>
              <Gavel className="h-4 w-4" aria-hidden="true" /> Record decision
            </Button>
          </div>
        }
      />

      {actionError && (
        <Alert tone="bad" className="mb-4" title="That action did not go through">
          {actionError}
        </Alert>
      )}

      {!data.identityRevealed && data.job.blindScreening && (
        <Alert tone="info" className="mb-4" title="Blind screening is on">
          Name, contact details and (where configured) university are hidden. The candidate’s original CV and identity become visible only
          after a shortlist and an explicit reveal, which is written to the audit log.
        </Alert>
      )}

      {data.humanReviewRequestedAt && (
        <Alert tone="warn" className="mb-4" title="The candidate requested a human review">
          Requested {formatDateTime(data.humanReviewRequestedAt)}. Review the CV evidence yourself and record your reasoning.
        </Alert>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr,340px]">
        <div className="space-y-5">
          <Card className="p-5">
            <div className="flex flex-wrap items-center gap-5">
              <ScoreRing score={data.score} size={104} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={STAGE_TONE[data.stage] ?? 'neutral'}>{STAGE_LABELS[data.stage] ?? data.stage}</Badge>
                  <Badge tone={scoreTone(data.score)}>{data.score ?? '—'} / 100</Badge>
                  {data.aiRecommendedStage && <Badge tone="info">AI suggested {STAGE_LABELS[data.aiRecommendedStage] ?? data.aiRecommendedStage}</Badge>}
                  {!data.knockoutPassed && (
                    <Badge tone="warn">
                      <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Knockout flag
                    </Badge>
                  )}
                  {data.humanReviewRequestedAt && <Badge tone="warn">Human review requested</Badge>}
                </div>
                <p className="mt-3 text-sm leading-relaxed text-ink/85">{data.explanation ?? 'No explanation stored for this score.'}</p>
                <p className="mt-2 text-xs text-muted">{data.aiRecommendationNote}</p>
                {data.scoreMeta && (
                  <p className="mt-2 text-[11px] text-muted">
                    Model {data.scoreMeta.model} · rubric {data.scoreMeta.rubricVersion} · prompt {data.scoreMeta.promptVersion} · scored{' '}
                    {formatDateTime(data.scoreMeta.createdAt)}
                  </p>
                )}
              </div>
              <Button variant="secondary" size="sm" loading={rescoreMutation.isPending} onClick={() => rescoreMutation.mutate()}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" /> Rescore
              </Button>
            </div>
          </Card>

          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'assessment', label: 'Assessment' },
              { value: 'cv', label: 'CV' },
              { value: 'knockouts', label: 'Knockouts', count: data.knockoutAnswers.length },
              { value: 'history', label: 'History', count: data.statusHistory.length },
              { value: 'fairness', label: 'Fairness test' },
            ]}
          />

          {tab === 'assessment' && (
            <Card>
              <CardHeader title="How the score was built" subtitle="Every criterion shows its weight, sub-score and reasoning." />
              <div className="divide-y divide-line">
                {!data.breakdown.length && <p className="px-5 py-6 text-sm text-muted">No breakdown stored. Run a rescore.</p>}
                {data.breakdown.map((item) => (
                  <div key={item.criterionId} className="px-5 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{item.label}</span>
                        <Badge tone={item.kind === 'MUST_HAVE' ? 'info' : 'neutral'}>
                          {item.kind === 'MUST_HAVE' ? 'Must have' : 'Nice to have'}
                        </Badge>
                      </div>
                      <span className="text-sm font-semibold tabular-nums">{Math.round(item.score * 100)}%</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-stone-200">
                      <div
                        className={item.score >= 0.8 ? 'h-full rounded-full bg-forest-600' : item.score >= 0.5 ? 'h-full rounded-full bg-gold-500' : 'h-full rounded-full bg-amber-700'}
                        style={{ width: `${Math.max(2, item.score * 100)}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted">
                      Weight {item.weight}% · {item.rationale}
                    </p>
                  </div>
                ))}
              </div>
              {data.coverLetter && (
                <div className="border-t border-line px-5 py-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Cover letter</p>
                  <p className="mt-1 whitespace-pre-line text-sm leading-relaxed">{data.coverLetter}</p>
                </div>
              )}
            </Card>
          )}

          {tab === 'cv' && (
            <Card>
              <CardHeader
                title="Parsed CV"
                subtitle={data.identityRevealed ? 'Original document available.' : 'Redacted view — identity fields removed.'}
                action={
                  data.identityRevealed && data.cvFilename ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => download(`/recruiter/applications/${data.id}/cv`, data.cvFilename!)}
                    >
                      <Download className="h-4 w-4" aria-hidden="true" /> Download original
                    </Button>
                  ) : (
                    <Badge tone="neutral">
                      <FileText className="h-3 w-3" aria-hidden="true" /> Original hidden
                    </Badge>
                  )
                }
              />
              <div className="px-5 py-4">
                {data.cvStatus === 'FAILED' && (
                  <Alert tone="warn" title="This file could not be read" className="mb-4">
                    {data.cvError ?? 'The uploaded document could not be parsed.'} Ask the candidate to upload a text-based PDF or DOCX, or paste
                    their CV as text from their application page. Knockout flags and weak scores from an unreadable file should not be treated as
                    evidence.
                  </Alert>
                )}
                {data.cv ? (
                  <div className="space-y-4">
                    {data.cv.headline && <p className="text-sm font-medium">{data.cv.headline}</p>}
                    {data.cv.summary && <p className="text-sm leading-relaxed text-ink/80">{data.cv.summary}</p>}
                    {data.cv.skills.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Skills</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {data.cv.skills.map((skill) => (
                            <span key={skill} className="rounded-full bg-forest-50 px-2 py-0.5 text-xs text-forest-800">
                              {skill}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {data.cv.education.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Education</p>
                        <ul className="mt-1 space-y-1 text-sm">
                          {data.cv.education.map((entry, index) => (
                            <li key={index}>
                              {entry.degreeLevel ?? 'Degree'}
                              {entry.course ? ` in ${entry.course}` : ''} — {entry.institution}
                              {entry.degreeClass ? ` (${entry.degreeClass.replace('_', ' ')})` : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {data.cv.experience.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Experience</p>
                        <ul className="mt-1 space-y-2 text-sm">
                          {data.cv.experience.map((entry, index) => (
                            <li key={index}>
                              <p className="font-medium">
                                {entry.title}
                                {entry.organisation ? ` · ${entry.organisation}` : ''}
                              </p>
                              {entry.description && <p className="text-xs leading-relaxed text-muted">{entry.description}</p>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted">No parsed CV data for this application.</p>
                )}

                {data.cvText && (
                  <details className="mt-4">
                    <summary className="cursor-pointer text-sm font-medium text-forest-700">View extracted text</summary>
                    <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-stone-50 p-3 text-xs leading-relaxed">
                      {data.cvText}
                    </pre>
                  </details>
                )}
              </div>
            </Card>
          )}

          {tab === 'knockouts' && (
            <Card>
              <CardHeader
                title="Knockout answers"
                subtitle="Flags are advisory. They never reject or delete a candidate."
              />
              <div className="divide-y divide-line">
                {!data.knockoutAnswers.length && <p className="px-5 py-6 text-sm text-muted">This job asks no knockout questions.</p>}
                {data.knockoutAnswers.map((answer, index) => (
                  <div key={index} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                    <div>
                      <p className="text-sm font-medium">{answer.prompt}</p>
                      <p className="mt-0.5 text-sm text-muted">{String(answer.value ?? 'No answer')}</p>
                    </div>
                    <Badge tone={answer.passed ? 'good' : 'warn'}>{answer.passed ? 'Passed' : 'Flagged'}</Badge>
                  </div>
                ))}
                {data.knockoutFlags.map((flag, index) => (
                  <div key={`flag-${index}`} className="px-5 py-3 text-xs text-amber-900">
                    {flag.reason}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {tab === 'history' && (
            <div className="space-y-5">
              <Card>
                <CardHeader title="Status history" subtitle="Who moved the candidate, when, and why." />
                <ul className="divide-y divide-line">
                  {!data.statusHistory.length && <li className="px-5 py-6 text-sm text-muted">No stage changes recorded.</li>}
                  {data.statusHistory.map((entry) => (
                    <li key={entry.id} className="px-5 py-3.5">
                      <p className="text-sm">
                        {STAGE_LABELS[entry.fromStage] ?? entry.fromStage} → <span className="font-medium">{STAGE_LABELS[entry.toStage] ?? entry.toStage}</span>
                      </p>
                      <p className="text-xs text-muted">{formatDateTime(entry.createdAt)}</p>
                      {entry.reason && <p className="mt-1 text-xs text-ink/80">Reason: {entry.reason}</p>}
                    </li>
                  ))}
                </ul>
              </Card>

              <Card>
                <CardHeader title="Recruiter notes" subtitle="Visible to your organisation’s recruiters." />
                <div className="space-y-3 px-5 py-4">
                  {data.notes.map((entry) => (
                    <div key={entry.id} className="rounded-lg bg-stone-50 p-3">
                      <p className="whitespace-pre-line text-sm">{entry.body}</p>
                      <p className="mt-1 text-[11px] text-muted">
                        {entry.author.fullName} · {formatDateTime(entry.createdAt)}
                      </p>
                    </div>
                  ))}
                  <Field label="Add a note" htmlFor="note">
                    <Textarea id="note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
                  </Field>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={noteMutation.isPending}
                    disabled={note.trim().length < 2}
                    onClick={() => noteMutation.mutate()}
                  >
                    <StickyNote className="h-4 w-4" aria-hidden="true" /> Save note
                  </Button>
                </div>
              </Card>
            </div>
          )}

          {tab === 'fairness' && (
            <Card>
              <CardHeader
                title="Counterfactual test"
                subtitle="Re-score this CV with identity signals swapped: name, gender-coded name, region and institution type."
              />
              <div className="px-5 py-4">
                <p className="text-sm leading-relaxed text-muted">
                  This keeps the qualifications constant and changes only the identity markers a human might read into a CV. A large score
                  difference suggests the rubric or the model is responding to something other than merit.
                </p>
                <Button className="mt-4" loading={counterfactualMutation.isPending} onClick={() => counterfactualMutation.mutate()}>
                  <FlaskConical className="h-4 w-4" aria-hidden="true" /> Run counterfactual
                </Button>

                {counterfactual && (
                  <div className="mt-5">
                    <Alert tone={counterfactual.flagged ? 'bad' : 'good'} title={counterfactual.flagged ? 'Score shifted beyond threshold' : 'No material shift'}>
                      {counterfactual.note} Max delta {counterfactual.maxDelta} point(s), threshold {counterfactual.threshold}.
                    </Alert>
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="text-left text-xs uppercase tracking-wide text-muted">
                          <tr>
                            <th className="py-2">Variant</th>
                            <th className="py-2">Identity swapped</th>
                            <th className="py-2 text-right">Score</th>
                            <th className="py-2 text-right">Delta</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {counterfactual.results.map((result) => (
                            <tr key={result.variantId}>
                              <td className="py-2">{result.label}</td>
                              <td className="py-2 text-xs text-muted">{Object.entries(result.identity).map(([k, v]) => `${k}: ${v}`).join(' · ')}</td>
                              <td className="py-2 text-right tabular-nums">{result.total}</td>
                              <td className={`py-2 text-right tabular-nums ${result.delta > 0 ? 'text-forest-700' : result.delta < 0 ? 'text-red-700' : 'text-muted'}`}>
                                {result.delta > 0 ? '+' : ''}
                                {result.delta}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>

        <aside className="space-y-5">
          <Card>
            <CardHeader title="Candidate" subtitle={data.identityRevealed ? 'Revealed' : 'Blind view'} />
            <div className="space-y-2 px-5 py-4 text-sm">
              <p className="flex items-center gap-2 font-medium">
                <UserRound className="h-4 w-4 text-muted" aria-hidden="true" /> {displayName}
              </p>
              {data.identityRevealed ? (
                <>
                  {data.identity?.email && <p className="text-xs text-muted">{data.identity.email}</p>}
                  {data.identity?.phone && <p className="text-xs text-muted">{data.identity.phone}</p>}
                  {data.identity?.location && <p className="text-xs text-muted">{data.identity.location}</p>}
                </>
              ) : (
                <p className="text-xs text-muted">Contact details stay hidden while blind screening is on.</p>
              )}
              <p className="text-xs text-muted">Reference {data.anonymousRef}</p>
              {data.rejectionReason && <p className="text-xs text-red-700">Rejection reason: {data.rejectionReason}</p>}
              {data.overrideReason && <p className="text-xs text-amber-800">Override reason: {data.overrideReason}</p>}
            </div>
          </Card>

          <Card>
            <CardHeader title="Interviews" />
            <div className="divide-y divide-line">
              {!data.interviews.length && <p className="px-5 py-4 text-sm text-muted">No interview booked.</p>}
              {data.interviews.map((interview) => (
                <div key={interview.id} className="px-5 py-3.5">
                  <p className="text-sm font-medium">{formatDateTime(interview.slot.startsAt)}</p>
                  <p className="text-xs text-muted">
                    {interview.type} · {STAGE_LABELS[interview.status] ?? interview.status}
                  </p>
                  <button
                    onClick={() => download(`/interviews/${interview.id}/ics`, `ise-interview-${interview.id}.ics`)}
                    className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-forest-700 hover:underline"
                  >
                    <CalendarClock className="h-3 w-3" aria-hidden="true" /> Calendar (.ics)
                  </button>
                </div>
              ))}
            </div>
          </Card>

          <Card className="border-forest-200 bg-forest-50/60 p-5 text-xs leading-relaxed text-forest-900/80">
            <ShieldCheck className="h-5 w-5 text-forest-700" aria-hidden="true" />
            <p className="mt-2 text-sm font-semibold text-forest-900">Evidence, not automation</p>
            <p className="mt-1">
              Scores never reject anyone. Rejections need a written reason; overriding the AI needs its own reason. Both are stored with your
              identity in the audit log.
            </p>
          </Card>
        </aside>
      </div>

      <Modal
        open={decisionOpen}
        onClose={() => setDecisionOpen(false)}
        title="Record a decision"
        description={`AI suggested ${STAGE_LABELS[data.aiRecommendedStage ?? 'SCREENED'] ?? 'no suggestion'}. Your decision and reason are audited.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDecisionOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={decisionMutation.isPending}
              disabled={(stage === 'REJECTED' && reason.trim().length < 5) || (isOverride && overrideReason.trim().length < 5)}
              onClick={() => decisionMutation.mutate()}
            >
              Save decision
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Move to stage" htmlFor="stage">
            <Select id="stage" value={stage} onChange={(e) => setStage(e.target.value)}>
              {DECISION_STAGES.map((value) => (
                <option key={value} value={value}>
                  {STAGE_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={stage === 'REJECTED' ? 'Rejection reason (required)' : 'Reason'}
            htmlFor="decisionReason"
            hint="stored for audit"
          >
            <Textarea
              id="decisionReason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reference the evidence, e.g. met 3 of 4 must-have criteria; no evidence of SQL."
            />
          </Field>
          {isOverride && (
            <Field label="Override reason (required)" htmlFor="overrideReason" hint="you are disagreeing with the AI">
              <Textarea
                id="overrideReason"
                rows={3}
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="Why your judgement differs from the recommendation."
              />
            </Field>
          )}
          {decisionMutation.isError && <Alert tone="bad">{(decisionMutation.error as Error).message}</Alert>}
        </div>
      </Modal>

      <Modal
        open={revealOpen}
        onClose={() => setRevealOpen(false)}
        title="Reveal candidate identity"
        description="This ends blind screening for this application and is permanently recorded."
        footer={
          <>
            <Button variant="secondary" onClick={() => setRevealOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={revealMutation.isPending}
              disabled={revealReason.trim().length < 5}
              onClick={() => revealMutation.mutate()}
            >
              Reveal identity
            </Button>
          </>
        }
      >
        <Field label="Reason for revealing" htmlFor="revealReason" hint="min. 5 characters">
          <Input
            id="revealReason"
            value={revealReason}
            onChange={(e) => setRevealReason(e.target.value)}
            placeholder="Shortlisted for interview scheduling"
          />
        </Field>
        {revealMutation.isError && <Alert tone="bad" className="mt-3">{(revealMutation.error as Error).message}</Alert>}
      </Modal>
    </div>
  );
}
