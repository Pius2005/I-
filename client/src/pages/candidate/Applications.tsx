import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Download,
  FileWarning,
  Info,
  MessageSquareWarning,
  PencilLine,
  Upload,
} from 'lucide-react';
import { download, request, qs } from '../../lib/api';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  PageLoader,
  Pagination,
  ScoreRing,
  ScoreBar,
  Select,
  StatusBadge,
  Tabs,
  Textarea,
} from '../../components/ui';
import { STAGE_LABELS, STAGE_TONE, cn, formatDateTime } from '../../lib/utils';
import type { ParsedCV } from '../../types';

interface ApplicationListItem {
  id: string;
  stage: string;
  score: number | null;
  createdAt: string;
  job: { id: string; title: string; location: string; organisation: { name: string } };
  cvFile: { extractionStatus: string; extractionError: string | null } | null;
  interviews: { id: string; slot: { startsAt: string } }[];
}

export default function CandidateApplicationsPage() {
  const [stage, setStage] = useState('');
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['candidate', 'applications', { stage, page }],
    queryFn: () =>
      request<{ data: ApplicationListItem[]; meta: { page: number; totalPages: number; total: number } }>(
        `/applications${qs({ stage: stage || undefined, page, pageSize: 10 })}`,
      ),
    placeholderData: (previous) => previous,
  });

  return (
    <div className="animate-fade-in">
      <PageHeader title="My applications" description="Every stage, score and human decision on your applications." />

      <div className="mb-4">
        <Tabs
          value={stage}
          onChange={(value) => {
            setStage(value);
            setPage(1);
          }}
          tabs={[
            { value: '', label: 'All' },
            ...['APPLIED', 'SCREENED', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED'].map((value) => ({
              value,
              label: STAGE_LABELS[value],
            })),
          ]}
        />
      </div>

      {query.isLoading ? (
        <PageLoader />
      ) : query.isError ? (
        <Alert tone="bad">{(query.error as Error).message}</Alert>
      ) : !query.data?.data.length ? (
        <EmptyState
          icon={<PencilLine className="h-6 w-6" />}
          title="No applications here yet"
          description="Find a role whose criteria fit your experience, then upload your CV. You can correct the parsed details afterwards."
          action={<Link to="/candidate/jobs"><Button>Browse jobs</Button></Link>}
        />
      ) : (
        <div className="space-y-3">
          {query.data.data.map((application) => (
            <Link
              key={application.id}
              to={`/candidate/applications/${application.id}`}
              className="flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-white p-5 shadow-card transition hover:border-forest-300"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold">{application.job.title}</h2>
                  <StatusBadge status={STAGE_LABELS[application.stage] ?? application.stage} tone={STAGE_TONE[application.stage] ?? 'neutral'} />
                  {application.cvFile?.extractionStatus === 'FAILED' && (
                    <Badge tone="bad">
                      <FileWarning className="h-3 w-3" aria-hidden="true" /> CV unreadable
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-muted">
                  {application.job.organisation.name} · {application.job.location}
                </p>
                <p className="mt-1 text-xs text-muted">Applied {formatDateTime(application.createdAt)}</p>
                {application.interviews[0] && (
                  <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-forest-50 px-2 py-1 text-xs font-medium text-forest-800">
                    <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> Interview {formatDateTime(application.interviews[0].slot.startsAt)}
                  </p>
                )}
              </div>
              <ScoreRing score={application.score} size={64} />
            </Link>
          ))}
          <Pagination page={query.data.meta.page} totalPages={query.data.meta.totalPages} onChange={setPage} />
        </div>
      )}
    </div>
  );
}

interface ScoreBreakdown {
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

interface ApplicationDetail {
  id: string;
  stage: string;
  score: number | null;
  scoredAt: string | null;
  aiRecommendedStage: string | null;
  explanation: string | null;
  breakdown: ScoreBreakdown[];
  scoreMeta: { model: string; promptVersion: string; rubricVersion: string; createdAt: string } | null;
  job: { id: string; title: string; slug: string; location: string; blindScreening: boolean; organisation: { name: string } };
  coverLetter: string | null;
  knockoutPassed: boolean;
  knockoutFlags: { prompt: string; answer: unknown; reason: string }[];
  knockoutAnswers: { prompt: string; type: string; value: unknown; passed: boolean }[];
  cvFile: { id: string; filename: string; sizeBytes: number; extractionStatus: string; extractionError: string | null; createdAt: string } | null;
  parsedCV: { data: ParsedCV; reviewStatus: string; parserModel: string } | null;
  statusHistory: { toStage: string; reason: string | null; createdAt: string }[];
  interviews: {
    id: string;
    status: string;
    type: string;
    location: string | null;
    meetingLink: string | null;
    slot: { startsAt: string; endsAt: string };
  }[];
  humanReviewRequestedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

interface Slot {
  id: string;
  startsAt: string;
  endsAt: string;
  window: { interviewType: string; location: string | null; slotMinutes: number; timezone: string };
}

export function CandidateApplicationDetailPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [bookingSlot, setBookingSlot] = useState<Slot | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [editingCv, setEditingCv] = useState(false);

  const query = useQuery({
    queryKey: ['candidate', 'application', id],
    queryFn: () => request<ApplicationDetail>(`/applications/${id}`),
    enabled: Boolean(id),
    refetchInterval: (q) => (q.state.data?.cvFile?.extractionStatus === 'PROCESSING' ? 4000 : false),
  });

  const slotsQuery = useQuery({
    queryKey: ['candidate', 'slots', id],
    queryFn: () => request<{ slots: Slot[]; cutoffHours: number; currentInterviewId: string | null; reason?: string }>(`/interviews/applications/${id}/slots`),
    enabled: Boolean(id) && Boolean(query.data) && ['SHORTLISTED', 'INTERVIEW', 'OFFER', 'HIRED'].includes(query.data?.stage ?? ''),
  });

  const cvForm = useForm<{
    summary: string;
    skills: string;
    institution: string;
    institutionType: string;
    course: string;
    degreeLevel: string;
    degreeClass: string;
    startYear: string;
    endYear: string;
  }>();

  useEffect(() => {
    if (!query.data?.parsedCV) return;
    const cv = query.data.parsedCV.data;
    const edu = cv.education?.[0];
    cvForm.reset({
      summary: cv.summary ?? '',
      skills: (cv.skills ?? []).join(', '),
      institution: edu?.institution ?? '',
      institutionType: edu?.institutionType ?? 'UNKNOWN',
      course: edu?.course ?? '',
      degreeLevel: edu?.degreeLevel ?? 'BSC',
      degreeClass: edu?.degreeClass ?? 'NONE',
      startYear: edu?.startYear ? String(edu.startYear) : '',
      endYear: edu?.endYear ? String(edu.endYear) : '',
    });
  }, [query.data?.parsedCV, cvForm]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['candidate', 'application', id] });
    await queryClient.invalidateQueries({ queryKey: ['candidate', 'applications'] });
  };

  const saveCorrections = cvForm.handleSubmit(async (values) => {
    setError(null);
    try {
      const cv = query.data?.parsedCV?.data;
      const existing = cv?.education ?? [];
      const updatedEducation = values.institution
        ? [
            {
              ...(existing[0] ?? {}),
              institution: values.institution,
              institutionType: values.institutionType,
              course: values.course || undefined,
              degreeLevel: values.degreeLevel,
              degreeClass: values.degreeClass,
              startYear: values.startYear ? Number(values.startYear) : null,
              endYear: values.endYear ? Number(values.endYear) : null,
            },
            ...existing.slice(1),
          ]
        : existing;
      await request(`/applications/${id}/parsed-cv`, {
        method: 'PUT',
        body: {
          name: cv?.name ?? null,
          email: cv?.email ?? null,
          phone: cv?.phone ?? null,
          location: cv?.location ?? null,
          headline: cv?.headline ?? null,
          summary: values.summary || null,
          skills: values.skills.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 60),
          education: updatedEducation,
          experience: cv?.experience ?? [],
          projects: cv?.projects ?? [],
          certifications: cv?.certifications ?? [],
          languages: cv?.languages ?? [],
        },
      });
      await refresh();
      setEditingCv(false);
      setNotice('Corrections saved and the score recomputed.');
    } catch (err) {
      setError((err as Error).message);
    }
  });

  const submitPastedText = useMutation({
    mutationFn: () => request(`/applications/${id}/cv-text`, { method: 'POST', body: { text: pasteText } }),
    onSuccess: async () => {
      setPasteOpen(false);
      setNotice('CV text received. We are parsing it again.');
      await refresh();
    },
    onError: (err) => setError((err as Error).message),
  });

  const requestReview = useMutation({
    mutationFn: () => request(`/applications/${id}/request-human-review`, { method: 'POST', body: { note: reviewNote } }),
    onSuccess: async () => {
      setReviewOpen(false);
      setNotice('Human review requested. The hiring team has been notified.');
      await refresh();
    },
    onError: (err) => setError((err as Error).message),
  });

  const bookSlot = useMutation({
    mutationFn: (slot: Slot) => request(`/interviews/applications/${id}/interview`, { method: 'POST', body: { slotId: slot.id } }),
    onSuccess: async () => {
      setBookingSlot(null);
      setNotice('Interview booked. A calendar invitation and confirmation are on their way.');
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ['candidate', 'slots', id] });
    },
    onError: (err) => setError((err as Error).message),
  });

  const cancelInterview = useMutation({
    mutationFn: (interviewId: string) => request(`/interviews/${interviewId}/cancel`, { method: 'PATCH', body: { reason: cancelReason } }),
    onSuccess: async () => {
      setCancelTarget(null);
      setCancelReason('');
      setNotice('Interview cancelled. The slot is free again.');
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ['candidate', 'slots', id] });
    },
    onError: (err) => setError((err as Error).message),
  });

  if (query.isLoading) return <PageLoader />;
  if (query.isError) return <Alert tone="bad">{(query.error as Error).message}</Alert>;
  const application = query.data!;
  const cv = application.parsedCV?.data;
  const interview = application.interviews.find((i) => i.status === 'SCHEDULED');
  const canBook = ['SHORTLISTED', 'INTERVIEW', 'OFFER'].includes(application.stage);

  return (
    <div className="animate-fade-in">
      <Link to="/candidate/applications" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-forest-700">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All applications
      </Link>

      {notice && (
        <Alert tone="good" className="mb-4">
          {notice}
        </Alert>
      )}
      {error && (
        <Alert tone="bad" className="mb-4">
          {error}
        </Alert>
      )}

      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{application.job.title}</h1>
            <StatusBadge status={STAGE_LABELS[application.stage] ?? application.stage} tone={STAGE_TONE[application.stage] ?? 'neutral'} />
            {application.humanReviewRequestedAt && <Badge tone="warn">Human review requested</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted">
            {application.job.organisation.name} · {application.job.location} · applied {formatDateTime(application.createdAt)}
          </p>
        </div>
        <Button variant="secondary" onClick={() => setReviewOpen(true)} disabled={Boolean(application.humanReviewRequestedAt)}>
          <MessageSquareWarning className="h-4 w-4" aria-hidden="true" />
          {application.humanReviewRequestedAt ? 'Review requested' : 'Request human review'}
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.5fr,1fr] lg:items-start">
        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Your score, explained"
              subtitle="Generated against the published criteria. AI recommends; a person decides."
              action={<ScoreRing score={application.score} />}
            />
            <div className="space-y-4 p-5">
              {application.score === null && (
                <Alert tone="warn" title="Screening in progress">
                  {application.cvFile?.extractionStatus === 'FAILED'
                    ? 'We could not read your file. Paste your CV text below so a human and the scorer can read it.'
                    : 'Your CV is being read now. This page refreshes automatically.'}
                </Alert>
              )}
              {application.explanation && <p className="text-sm leading-relaxed text-ink/90">{application.explanation}</p>}
              <div className="space-y-4">
                {(application.breakdown ?? []).map((criterion) => (
                  <div key={criterion.criterionId} className="rounded-xl border border-line p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{criterion.label}</p>
                      <span className="text-xs text-muted">{criterion.weight}% weight</span>
                    </div>
                    <div className="mt-2">
                      <ScoreBar value={criterion.score} />
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-muted">{criterion.rationale}</p>
                  </div>
                ))}
              </div>
              {application.scoreMeta && (
                <p className="border-t border-line pt-3 text-[11px] text-muted">
                  Model {application.scoreMeta.model} · prompt {application.scoreMeta.promptVersion} · rubric{' '}
                  {application.scoreMeta.rubricVersion} · {formatDateTime(application.scoreMeta.createdAt)}
                </p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Your CV data"
              subtitle="Review and correct what the parser extracted. Corrections recompute the score."
              action={
                application.parsedCV && (
                  <Button size="sm" variant="secondary" onClick={() => setEditingCv((v) => !v)}>
                    <PencilLine className="h-4 w-4" aria-hidden="true" /> {editingCv ? 'Cancel' : 'Correct details'}
                  </Button>
                )
              }
            />
            <div className="space-y-4 p-5">
              {application.cvFile?.extractionStatus === 'FAILED' && (
                <Alert tone="bad" title="We could not read this file">
                  {application.cvFile.extractionError ?? 'It may be scanned or password-protected.'}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setPasteOpen(true)}>
                      <Upload className="h-4 w-4" aria-hidden="true" /> Paste CV text instead
                    </Button>
                  </div>
                </Alert>
              )}

              {!application.parsedCV && application.cvFile?.extractionStatus !== 'FAILED' && (
                <p className="text-sm text-muted">Extraction is still running. This page refreshes automatically.</p>
              )}

              {editingCv ? (
                <form onSubmit={saveCorrections} className="space-y-4">
                  <Field label="Summary" htmlFor="summary">
                    <Textarea id="summary" rows={3} {...cvForm.register('summary')} />
                  </Field>
                  <Field label="Skills" htmlFor="skills" hint="comma separated">
                    <Input id="skills" {...cvForm.register('skills')} />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Institution" htmlFor="institution">
                      <Input id="institution" {...cvForm.register('institution')} />
                    </Field>
                    <Field label="Institution type" htmlFor="institutionType">
                      <Select id="institutionType" {...cvForm.register('institutionType')}>
                        {['FEDERAL', 'STATE', 'PRIVATE', 'POLYTECHNIC', 'UNKNOWN'].map((value) => (
                          <option key={value} value={value}>
                            {value[0] + value.slice(1).toLowerCase()}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Course" htmlFor="course">
                      <Input id="course" {...cvForm.register('course')} />
                    </Field>
                    <Field label="Degree level" htmlFor="degreeLevel">
                      <Select id="degreeLevel" {...cvForm.register('degreeLevel')}>
                        {['SSCE', 'OND', 'HND', 'BSC', 'MSC', 'PHD'].map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Degree class" htmlFor="degreeClass">
                      <Select id="degreeClass" {...cvForm.register('degreeClass')}>
                        {['FIRST', 'SECOND_UPPER', 'SECOND_LOWER', 'THIRD', 'PASS', 'NONE'].map((value) => (
                          <option key={value} value={value}>
                            {value.replace('_', ' ').toLowerCase()}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Start year" htmlFor="startYear">
                        <Input id="startYear" inputMode="numeric" {...cvForm.register('startYear')} />
                      </Field>
                      <Field label="End year" htmlFor="endYear">
                        <Input id="endYear" inputMode="numeric" {...cvForm.register('endYear')} />
                      </Field>
                    </div>
                  </div>
                  <Button type="submit" loading={cvForm.formState.isSubmitting}>
                    Save corrections and rescore
                  </Button>
                </form>
              ) : cv ? (
                <div className="space-y-4 text-sm">
                  {cv.summary && <p className="leading-relaxed text-ink/90">{cv.summary}</p>}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">Skills</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {cv.skills?.map((skill) => (
                        <span key={skill} className="rounded-md bg-forest-50 px-2 py-1 text-xs text-forest-800">
                          {skill}
                        </span>
                      ))}
                      {!cv.skills?.length && <span className="text-muted">None detected.</span>}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">Education</p>
                    <ul className="mt-1.5 space-y-2">
                      {cv.education?.map((entry, index) => (
                        <li key={index} className="rounded-lg border border-line p-3">
                          <p className="font-medium">{entry.institution}</p>
                          <p className="text-xs text-muted">
                            {[entry.degreeLevel, entry.course, entry.degreeClass?.replace('_', ' '), entry.startYear && `${entry.startYear}–${entry.endYear ?? 'present'}`]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        </li>
                      ))}
                      {!cv.education?.length && <li className="text-muted">No education entries detected.</li>}
                    </ul>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">Experience</p>
                    <ul className="mt-1.5 space-y-2">
                      {cv.experience?.map((entry, index) => (
                        <li key={index} className="rounded-lg border border-line p-3">
                          <p className="font-medium">{entry.title}</p>
                          <p className="text-xs text-muted">
                            {[entry.organisation, entry.startYear && `${entry.startYear}–${entry.endYear ?? 'present'}`].filter(Boolean).join(' · ')}
                          </p>
                        </li>
                      ))}
                      {!cv.experience?.length && <li className="text-muted">No experience entries detected.</li>}
                    </ul>
                  </div>
                  {application.parsedCV?.reviewStatus === 'CORRECTED' && <Badge tone="good">You have corrected these details</Badge>}
                </div>
              ) : null}

              {application.cvFile && (
                <div className="flex items-center justify-between border-t border-line pt-3 text-xs text-muted">
                  <span>
                    {application.cvFile.filename} · {(application.cvFile.sizeBytes / 1024).toFixed(0)} KB
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => download(`/applications/${id}/cv`, application.cvFile!.filename)}>
                    <Download className="h-3.5 w-3.5" aria-hidden="true" /> Download
                  </Button>
                </div>
              )}
            </div>
          </Card>

          {application.knockoutAnswers.length > 0 && (
            <Card>
              <CardHeader title="Knockout answers" subtitle="Flags are visible to recruiters; they never delete your application." />
              <ul className="divide-y divide-line">
                {application.knockoutAnswers.map((answer, index) => (
                  <li key={index} className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
                    <div>
                      <p className="font-medium">{answer.prompt}</p>
                      <p className="text-xs text-muted">{String(answer.value)}</p>
                    </div>
                    <Badge tone={answer.passed ? 'good' : 'warn'}>{answer.passed ? 'Meets requirement' : 'Flagged for human review'}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Interview" subtitle="Book a slot once you are shortlisted." />
            <div className="space-y-4 p-5">
              {interview ? (
                <div className="rounded-xl border border-forest-200 bg-forest-50/60 p-4">
                  <p className="text-sm font-semibold text-forest-900">{formatDateTime(interview.slot.startsAt)}</p>
                  <p className="mt-1 text-xs text-forest-900/80">
                    {interview.type.replace('_', ' ').toLowerCase()} · {interview.meetingLink ?? interview.location ?? 'Details to follow'}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => download(`/interviews/${interview.id}/ics`, 'ise-interview.ics')}>
                      <Download className="h-3.5 w-3.5" aria-hidden="true" /> Add to calendar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setCancelTarget(interview.id)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : canBook ? (
                <p className="text-sm text-muted">
                  Pick an open slot below. You can reschedule or cancel up to {slotsQuery.data?.cutoffHours ?? 12} hours before the
                  interview.
                </p>
              ) : (
                <p className="text-sm text-muted">Interview booking opens when you are shortlisted.</p>
              )}

              {canBook && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Available slots</p>
                  {slotsQuery.isLoading && <p className="mt-2 text-sm text-muted">Checking availability…</p>}
                  {slotsQuery.data?.reason && <p className="mt-2 text-sm text-muted">{slotsQuery.data.reason}</p>}
                  <div className="mt-2 space-y-2">
                    {slotsQuery.data?.slots?.slice(0, 6).map((slot) => (
                      <div key={slot.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                        <div>
                          <p className="font-medium">{formatDateTime(slot.startsAt)}</p>
                          <p className="text-xs text-muted">
                            {slot.window.interviewType.replace('_', ' ').toLowerCase()} · {slot.window.slotMinutes} min
                          </p>
                        </div>
                        <Button size="sm" variant={interview ? 'secondary' : 'primary'} onClick={() => setBookingSlot(slot)}>
                          {interview ? 'Move here' : 'Book'}
                        </Button>
                      </div>
                    ))}
                    {slotsQuery.data && !slotsQuery.data.slots.length && (
                      <p className="text-sm text-muted">No open slots yet. The recruiter will publish availability soon.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Your journey" />
            <ol className="space-y-0 p-5">
              {application.statusHistory.map((entry, index) => (
                <li key={index} className="relative flex gap-3 pb-4 last:pb-0">
                  {index < application.statusHistory.length - 1 && (
                    <span className="absolute left-[7px] top-4 h-full w-px bg-line" aria-hidden="true" />
                  )}
                  <span className={cn('mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2', index === application.statusHistory.length - 1 ? 'border-forest-600 bg-forest-600' : 'border-forest-300 bg-white')} aria-hidden="true" />
                  <div>
                    <p className="text-sm font-medium">{STAGE_LABELS[entry.toStage] ?? entry.toStage}</p>
                    <p className="text-xs text-muted">{formatDateTime(entry.createdAt)}</p>
                    {entry.reason && <p className="mt-0.5 text-xs text-muted">{entry.reason}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </Card>

          {application.stage === 'REJECTED' && (
            <Card className="border-stone-300 bg-stone-100 p-5">
              <AlertTriangle className="h-5 w-5 text-ink" aria-hidden="true" />
              <p className="mt-2 text-sm font-semibold text-ink">Outcome recorded</p>
              {application.rejectionReason && <p className="mt-1 text-sm text-ink/90">{application.rejectionReason}</p>}
              <p className="mt-2 text-xs text-muted">You can still request human review of this decision.</p>
            </Card>
          )}

          {application.knockoutFlags.length > 0 && (
            <Alert tone="warn" title="Flagged answers">
              <ul className="list-disc space-y-1 pl-4">
                {application.knockoutFlags.map((flag, index) => (
                  <li key={index}>{flag.reason}</li>
                ))}
              </ul>
            </Alert>
          )}
        </div>
      </div>

      {/* Modals */}
      <Modal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        title="Request human review"
        description="A recruiter will review your application manually. The request is logged."
        footer={
          <>
            <Button variant="secondary" onClick={() => setReviewOpen(false)}>
              Cancel
            </Button>
            <Button loading={requestReview.isPending} onClick={() => requestReview.mutate()}>
              Send request
            </Button>
          </>
        }
      >
        <Field label="Anything you want the reviewer to know?" htmlFor="reviewNote" hint="optional">
          <Textarea id="reviewNote" rows={4} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} />
        </Field>
      </Modal>

      <Modal
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        title="Paste your CV text"
        description="If your file is scanned or unreadable, paste the text so it can be parsed and scored."
        footer={
          <>
            <Button variant="secondary" onClick={() => setPasteOpen(false)}>
              Cancel
            </Button>
            <Button loading={submitPastedText.isPending} disabled={pasteText.trim().length < 120} onClick={() => submitPastedText.mutate()}>
              Use this text
            </Button>
          </>
        }
      >
        <Field label="CV text" htmlFor="pasteText" hint="at least 120 characters">
          <Textarea id="pasteText" rows={10} value={pasteText} onChange={(event) => setPasteText(event.target.value)} />
        </Field>
      </Modal>

      <Modal
        open={Boolean(bookingSlot)}
        onClose={() => setBookingSlot(null)}
        title="Confirm interview"
        description={bookingSlot ? formatDateTime(bookingSlot.startsAt) : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setBookingSlot(null)}>
              Cancel
            </Button>
            <Button loading={bookSlot.isPending} onClick={() => bookingSlot && bookSlot.mutate(bookingSlot)}>
              Confirm booking
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          You will receive an email and, if enabled, an SMS confirmation. The slot is held for you immediately and cannot be
          double-booked.
        </p>
      </Modal>

      <Modal
        open={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        title="Cancel interview"
        description="The slot returns to the pool and the recruiter is notified."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelTarget(null)}>
              Keep interview
            </Button>
            <Button
              variant="danger"
              loading={cancelInterview.isPending}
              disabled={cancelReason.trim().length < 3}
              onClick={() => cancelTarget && cancelInterview.mutate(cancelTarget)}
            >
              Cancel interview
            </Button>
          </>
        }
      >
        <Field label="Reason" htmlFor="cancelReason" hint="required">
          <Textarea id="cancelReason" rows={3} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} />
        </Field>
      </Modal>
    </div>
  );
}
