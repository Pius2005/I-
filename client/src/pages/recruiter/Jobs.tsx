import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BarChart3, Briefcase, Pencil, Plus, Send, ShieldCheck, Trash2 } from 'lucide-react';
import { request, qs, type Paginated } from '../../lib/api';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  EmptyState,
  Field,
  Input,
  PageHeader,
  PageLoader,
  Select,
  StatusBadge,
  Tabs,
  Textarea,
  Toggle,
} from '../../components/ui';
import { STAGE_LABELS, STAGE_TONE, formatDate } from '../../lib/utils';

type JobStatusValue = 'DRAFT' | 'OPEN' | 'CLOSED';
type CriterionType = 'SKILL' | 'DEGREE_LEVEL' | 'DEGREE_CLASS' | 'FIELD_OF_STUDY' | 'EXPERIENCE' | 'CERTIFICATION' | 'LANGUAGE';
type CriterionKind = 'MUST_HAVE' | 'NICE_TO_HAVE';
type KnockoutType = 'NYSC' | 'DEGREE_CLASS' | 'LOCATION' | 'AVAILABILITY' | 'WORK_AUTH';

interface JobRow {
  id: string;
  title: string;
  status: JobStatusValue;
  location: string;
  deadline: string;
  openings: number;
  biasDemoMode: boolean;
  organisation: { name: string };
  _count: { applications: number };
  criteriaWeightTotal: number;
}

interface CriterionDraft {
  kind: CriterionKind;
  type: CriterionType;
  label: string;
  weight: number;
  config: Record<string, unknown>;
}

interface KnockoutDraft {
  type: KnockoutType;
  prompt: string;
  config: Record<string, unknown>;
}

interface JobDetail {
  id: string;
  title: string;
  description: string;
  location: string;
  employmentType: string;
  deadline: string;
  openings: number;
  minYearsExperience: number;
  blindScreening: boolean;
  hideUniversityBlind: boolean;
  biasDemoMode: boolean;
  status: JobStatusValue;
  criteria: { id: string; kind: CriterionKind; type: CriterionType; label: string; weight: number; config: Record<string, unknown> }[];
  knockoutQuestions: { id: string; type: KnockoutType; prompt: string; options: string[]; config: Record<string, unknown> }[];
}

const CRITERION_TYPES: { value: CriterionType; label: string }[] = [
  { value: 'SKILL', label: 'Skills' },
  { value: 'DEGREE_LEVEL', label: 'Degree level' },
  { value: 'DEGREE_CLASS', label: 'Degree class' },
  { value: 'FIELD_OF_STUDY', label: 'Field of study' },
  { value: 'EXPERIENCE', label: 'Years of experience' },
  { value: 'CERTIFICATION', label: 'Certification' },
  { value: 'LANGUAGE', label: 'Language' },
];

const KNOCKOUT_TYPES: { value: KnockoutType; label: string; prompt: string; options: string[] }[] = [
  {
    value: 'NYSC',
    label: 'NYSC status',
    prompt: 'What is your NYSC status?',
    options: ['COMPLETED', 'SERVING', 'EXEMPTED', 'NOT_SERVED'],
  },
  {
    value: 'DEGREE_CLASS',
    label: 'Degree class',
    prompt: 'What degree class did you graduate with?',
    options: ['FIRST', 'SECOND_UPPER', 'SECOND_LOWER', 'THIRD', 'PASS'],
  },
  {
    value: 'LOCATION',
    label: 'Location',
    prompt: 'Where are you currently based, and are you able to relocate?',
    options: ['LAGOS', 'ABUJA', 'WILLING_TO_RELOCATE', 'NOT_WILLING'],
  },
  {
    value: 'AVAILABILITY',
    label: 'Availability',
    prompt: 'When can you start?',
    options: ['IMMEDIATE', 'WITHIN_30_DAYS', 'WITHIN_60_DAYS', 'MORE_THAN_60_DAYS'],
  },
  { value: 'WORK_AUTH', label: 'Work authorisation', prompt: 'Are you authorised to work in Nigeria?', options: ['YES', 'NO'] },
];

const LIST_KEY: Partial<Record<CriterionType, string>> = {
  SKILL: 'skills',
  FIELD_OF_STUDY: 'fields',
  CERTIFICATION: 'certifications',
  LANGUAGE: 'languages',
};

function listValue(config: Record<string, unknown>, key: string) {
  const value = config[key];
  return Array.isArray(value) ? value.join(', ') : typeof value === 'string' ? value : '';
}

function parseList(value: string) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function toDateInput(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

// --- List -------------------------------------------------------------------
export default function RecruiterJobsPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'ALL' | JobStatusValue>('ALL');

  const query = useQuery({
    queryKey: ['recruiter', 'jobs', status],
    queryFn: () => request<Paginated<JobRow>>(`/recruiter/jobs${qs({ pageSize: 60, status: status === 'ALL' ? undefined : status })}`),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: JobStatusValue }) =>
      request(`/recruiter/jobs/${id}/status`, { method: 'POST', body: { status: next } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recruiter'] });
    },
  });

  const jobs = query.data?.data ?? [];
  const counts = useMemo(() => {
    return {
      ALL: query.data?.meta.total ?? 0,
      OPEN: jobs.filter((j) => j.status === 'OPEN').length,
      DRAFT: jobs.filter((j) => j.status === 'DRAFT').length,
      CLOSED: jobs.filter((j) => j.status === 'CLOSED').length,
    };
  }, [jobs, query.data?.meta.total]);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Jobs"
        description="Weighted criteria give every score a rubric. Blind screening stays on until you shortlist and reveal."
        action={
          <Link to="/recruiter/jobs/new">
            <Button>
              <Plus className="h-4 w-4" aria-hidden="true" /> New job
            </Button>
          </Link>
        }
      />

      <div className="mb-5">
        <Tabs
          value={status}
          onChange={(value) => setStatus(value as 'ALL' | JobStatusValue)}
          tabs={[
            { value: 'ALL', label: 'All', count: counts.ALL },
            { value: 'OPEN', label: 'Open', count: counts.OPEN },
            { value: 'DRAFT', label: 'Draft', count: counts.DRAFT },
            { value: 'CLOSED', label: 'Closed', count: counts.CLOSED },
          ]}
        />
      </div>

      {statusMutation.isError && (
        <Alert tone="bad" className="mb-4">
          {(statusMutation.error as Error).message}
        </Alert>
      )}

      {query.isLoading && <PageLoader />}
      {query.isError && <Alert tone="bad">{(query.error as Error).message}</Alert>}

      {!query.isLoading && !jobs.length && (
        <EmptyState
          icon={<Briefcase className="h-5 w-5" />}
          title="No jobs in this view"
          description="Create a role with criteria that total 100% so screening is explainable and auditable."
          action={
            <Link to="/recruiter/jobs/new">
              <Button>Post a job</Button>
            </Link>
          }
        />
      )}

      <div className="grid gap-4">
        {jobs.map((job) => (
          <Card key={job.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold">{job.title}</h2>
                  <StatusBadge status={STAGE_LABELS[job.status] ?? job.status} tone={STAGE_TONE[job.status] ?? 'neutral'} />
                  {job.biasDemoMode && <Badge tone="warn">Bias demo rule</Badge>}
                  {job.criteriaWeightTotal !== 100 && <Badge tone="bad">Weights {job.criteriaWeightTotal}%</Badge>}
                </div>
                <p className="mt-1 text-sm text-muted">
                  {job.organisation.name} · {job.location} · {job.openings} opening(s) · closes {formatDate(job.deadline)}
                </p>
                <p className="mt-1 text-xs text-muted">{job._count.applications} application(s)</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link to={`/recruiter/jobs/${job.id}/pipeline`}>
                  <Button variant="secondary" size="sm">
                    <BarChart3 className="h-4 w-4" aria-hidden="true" /> Pipeline
                  </Button>
                </Link>
                <Link to={`/recruiter/jobs/${job.id}/audit`}>
                  <Button variant="ghost" size="sm">
                    <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Audit
                  </Button>
                </Link>
                <Link to={`/recruiter/jobs/${job.id}/edit`}>
                  <Button variant="ghost" size="sm">
                    <Pencil className="h-4 w-4" aria-hidden="true" /> Edit
                  </Button>
                </Link>
                {job.status !== 'OPEN' && (
                  <Button
                    size="sm"
                    variant="gold"
                    loading={statusMutation.isPending}
                    onClick={() => statusMutation.mutate({ id: job.id, next: 'OPEN' })}
                  >
                    <Send className="h-4 w-4" aria-hidden="true" /> Publish
                  </Button>
                )}
                {job.status === 'OPEN' && (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={statusMutation.isPending}
                    onClick={() => statusMutation.mutate({ id: job.id, next: 'CLOSED' })}
                  >
                    Close
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// --- Editor -----------------------------------------------------------------
const EMPTY_FORM = {
  title: '',
  description: '',
  location: 'Lagos',
  employmentType: 'FULL_TIME',
  deadline: '',
  openings: 1,
  minYearsExperience: 0,
  blindScreening: true,
  hideUniversityBlind: true,
  biasDemoMode: false,
  status: 'DRAFT' as JobStatusValue,
};

function newCriterion(): CriterionDraft {
  return { kind: 'MUST_HAVE', type: 'SKILL', label: '', weight: 20, config: { skills: [] } };
}

function newKnockout(type: KnockoutType = 'NYSC'): KnockoutDraft {
  const definition = KNOCKOUT_TYPES.find((k) => k.value === type)!;
  return { type, prompt: definition.prompt, config: type === 'DEGREE_CLASS' ? { minClass: 'SECOND_LOWER' } : {} };
}

export function JobEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEdit = Boolean(id);

  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [criteria, setCriteria] = useState<CriterionDraft[]>([newCriterion()]);
  const [knockouts, setKnockouts] = useState<KnockoutDraft[]>([]);
  const [error, setError] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ['recruiter', 'job', id],
    queryFn: () => request<JobDetail>(`/recruiter/jobs/${id}`),
    enabled: isEdit,
  });

  useEffect(() => {
    const job = detail.data;
    if (!job) return;
    setForm({
      title: job.title,
      description: job.description,
      location: job.location,
      employmentType: job.employmentType,
      deadline: toDateInput(job.deadline),
      openings: job.openings,
      minYearsExperience: job.minYearsExperience,
      blindScreening: job.blindScreening,
      hideUniversityBlind: job.hideUniversityBlind,
      biasDemoMode: job.biasDemoMode,
      status: job.status,
    });
    setCriteria(
      job.criteria.map((c) => ({ kind: c.kind, type: c.type, label: c.label, weight: c.weight, config: { ...c.config } })),
    );
    setKnockouts(
      job.knockoutQuestions.map((k) => ({ type: k.type, prompt: k.prompt, config: { ...k.config } })),
    );
  }, [detail.data]);

  const totalWeight = criteria.reduce((sum, c) => sum + (Number(c.weight) || 0), 0);

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      isEdit
        ? request(`/recruiter/jobs/${id}`, { method: 'PATCH', body: payload })
        : request('/recruiter/jobs', { method: 'POST', body: payload }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['recruiter'] });
      navigate('/recruiter/jobs');
    },
    onError: (err) => setError((err as Error).message),
  });

  const submit = () => {
    setError(null);
    if (form.title.trim().length < 3) return setError('Give the role a title of at least 3 characters.');
    if (form.description.trim().length < 40) return setError('The description needs at least 40 characters so candidates know the role.');
    if (!form.deadline) return setError('Choose an application deadline.');
    if (!criteria.length) return setError('Add at least one criterion.');
    if (totalWeight !== 100) return setError(`Criterion weights must total 100% (currently ${totalWeight}%).`);
    const unlabelled = criteria.find((c) => c.label.trim().length < 2);
    if (unlabelled) return setError('Every criterion needs a label.');
    const badKnockout = knockouts.find((k) => k.prompt.trim().length < 5);
    if (badKnockout) return setError('Every knockout question needs a prompt of at least 5 characters.');

    mutation.mutate({
      ...form,
      openings: Number(form.openings),
      minYearsExperience: Number(form.minYearsExperience),
      deadline: new Date(`${form.deadline}T23:59:00`).toISOString(),
      criteria: criteria.map((c) => ({ ...c, weight: Number(c.weight) })),
      knockoutQuestions: knockouts.map((k) => ({
        type: k.type,
        prompt: k.prompt,
        options: KNOCKOUT_TYPES.find((t) => t.value === k.type)!.options,
        config: k.config,
      })),
    });
  };

  const updateCriterion = (index: number, patch: Partial<CriterionDraft>) => {
    setCriteria((current) => current.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  };

  const changeCriterionType = (index: number, type: CriterionType) => {
    const key = LIST_KEY[type];
    const config: Record<string, unknown> = {};
    if (key) config[key] = [];
    if (type === 'DEGREE_LEVEL') config.minLevel = 'BSC';
    if (type === 'DEGREE_CLASS') config.minClass = 'SECOND_LOWER';
    if (type === 'EXPERIENCE') config.minYears = 0;
    updateCriterion(index, { type, config });
  };

  const changeKnockoutType = (index: number, type: KnockoutType) => {
    const definition = KNOCKOUT_TYPES.find((k) => k.value === type)!;
    setKnockouts((current) =>
      current.map((k, i) =>
        i === index
          ? {
              ...k,
              type,
              prompt: k.prompt || definition.prompt,
              config: type === 'DEGREE_CLASS' ? { minClass: 'SECOND_LOWER' } : type === 'LOCATION' ? { acceptedLocations: ['Lagos'], relocation: true } : {},
            }
          : k,
      ),
    );
  };

  if (isEdit && detail.isLoading) return <PageLoader label="Loading job…" />;
  if (isEdit && detail.isError) return <Alert tone="bad">{(detail.error as Error).message}</Alert>;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={isEdit ? 'Edit job' : 'Post a job'}
        description="Criteria weights drive the score. Knockout questions flag candidates — they never delete or auto-reject anyone."
        action={
          <Button variant="ghost" onClick={() => navigate('/recruiter/jobs')}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to jobs
          </Button>
        }
      />

      {error && (
        <Alert tone="bad" className="mb-4">
          {error}
        </Alert>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.5fr,1fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Role details" />
            <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
              <Field label="Job title" htmlFor="title" className="sm:col-span-2">
                <Input id="title" value={form.title} maxLength={160} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </Field>
              <Field label="Location" htmlFor="location">
                <Input id="location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
              </Field>
              <Field label="Employment type" htmlFor="employmentType">
                <Select
                  id="employmentType"
                  value={form.employmentType}
                  onChange={(e) => setForm({ ...form, employmentType: e.target.value })}
                >
                  <option value="FULL_TIME">Full time</option>
                  <option value="PART_TIME">Part time</option>
                  <option value="CONTRACT">Contract</option>
                  <option value="INTERNSHIP">Internship</option>
                  <option value="NYSC">NYSC</option>
                </Select>
              </Field>
              <Field label="Openings" htmlFor="openings">
                <Input
                  id="openings"
                  type="number"
                  min={1}
                  max={500}
                  value={form.openings}
                  onChange={(e) => setForm({ ...form, openings: Number(e.target.value) })}
                />
              </Field>
              <Field label="Minimum years of experience" htmlFor="minYears">
                <Input
                  id="minYears"
                  type="number"
                  min={0}
                  max={30}
                  value={form.minYearsExperience}
                  onChange={(e) => setForm({ ...form, minYearsExperience: Number(e.target.value) })}
                />
              </Field>
              <Field label="Application deadline" htmlFor="deadline" hint="closes 23:59">
                <Input
                  id="deadline"
                  type="date"
                  value={form.deadline}
                  onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                />
              </Field>
              <Field label="Status" htmlFor="status">
                <Select id="status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as JobStatusValue })}>
                  <option value="DRAFT">Draft</option>
                  <option value="OPEN">Open</option>
                  <option value="CLOSED">Closed</option>
                </Select>
              </Field>
              <Field label="Description" htmlFor="description" className="sm:col-span-2" hint="min. 40 characters">
                <Textarea
                  id="description"
                  rows={6}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Scoring criteria"
              subtitle={`Weights must total 100%. Currently ${totalWeight}%.`}
              action={
                <Badge tone={totalWeight === 100 ? 'good' : 'warn'}>{totalWeight}%</Badge>
              }
            />
            <div className="space-y-4 px-5 py-4">
              {criteria.map((criterion, index) => {
                const listKey = LIST_KEY[criterion.type];
                return (
                  <div key={index} className="rounded-xl border border-line p-4">
                    <div className="grid gap-3 sm:grid-cols-[1fr,1fr,96px,auto]">
                      <Field label={`Criterion ${index + 1} label`}>
                        <Input
                          value={criterion.label}
                          placeholder="e.g. Data analysis with SQL"
                          onChange={(e) => updateCriterion(index, { label: e.target.value })}
                        />
                      </Field>
                      <Field label="Type">
                        <Select
                          value={criterion.type}
                          onChange={(e) => changeCriterionType(index, e.target.value as CriterionType)}
                        >
                          {CRITERION_TYPES.map((type) => (
                            <option key={type.value} value={type.value}>
                              {type.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Weight %">
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          value={criterion.weight}
                          onChange={(e) => updateCriterion(index, { weight: Number(e.target.value) })}
                        />
                      </Field>
                      <div className="flex items-start pt-6">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Remove criterion ${index + 1}`}
                          onClick={() => setCriteria((current) => current.filter((_, i) => i !== index))}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Field label="Kind">
                        <Select
                          value={criterion.kind}
                          onChange={(e) => updateCriterion(index, { kind: e.target.value as CriterionKind })}
                        >
                          <option value="MUST_HAVE">Must have</option>
                          <option value="NICE_TO_HAVE">Nice to have</option>
                        </Select>
                      </Field>

                      {listKey && (
                        <Field label="Accepted values" hint="comma separated">
                          <Input
                            value={listValue(criterion.config, listKey)}
                            placeholder={criterion.type === 'SKILL' ? 'SQL, Excel, Power BI' : 'Accounting'}
                            onChange={(e) =>
                              updateCriterion(index, {
                                config: { ...criterion.config, [listKey]: parseList(e.target.value) },
                              })
                            }
                          />
                        </Field>
                      )}

                      {criterion.type === 'DEGREE_LEVEL' && (
                        <Field label="Minimum degree">
                          <Select
                            value={String(criterion.config.minLevel ?? 'BSC')}
                            onChange={(e) => updateCriterion(index, { config: { ...criterion.config, minLevel: e.target.value } })}
                          >
                            <option value="SSCE">SSCE</option>
                            <option value="OND">OND</option>
                            <option value="HND">HND</option>
                            <option value="BSC">BSc</option>
                            <option value="MSC">MSc</option>
                            <option value="PHD">PhD</option>
                          </Select>
                        </Field>
                      )}

                      {criterion.type === 'DEGREE_CLASS' && (
                        <Field label="Minimum class">
                          <Select
                            value={String(criterion.config.minClass ?? 'SECOND_LOWER')}
                            onChange={(e) => updateCriterion(index, { config: { ...criterion.config, minClass: e.target.value } })}
                          >
                            <option value="FIRST">First class</option>
                            <option value="SECOND_UPPER">Second class upper</option>
                            <option value="SECOND_LOWER">Second class lower</option>
                            <option value="THIRD">Third class</option>
                            <option value="PASS">Pass</option>
                          </Select>
                        </Field>
                      )}

                      {criterion.type === 'EXPERIENCE' && (
                        <Field label="Minimum years">
                          <Input
                            type="number"
                            min={0}
                            max={30}
                            value={Number(criterion.config.minYears ?? 0)}
                            onChange={(e) =>
                              updateCriterion(index, { config: { ...criterion.config, minYears: Number(e.target.value) } })
                            }
                          />
                        </Field>
                      )}
                    </div>
                  </div>
                );
              })}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button variant="secondary" size="sm" onClick={() => setCriteria((current) => [...current, newCriterion()])}>
                  <Plus className="h-4 w-4" aria-hidden="true" /> Add criterion
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const remaining = 100 - totalWeight;
                    const last = criteria.length - 1;
                    if (last < 0 || remaining === 0) return;
                    updateCriterion(last, { weight: Number(criteria[last].weight) + remaining });
                  }}
                >
                  Balance weights to 100%
                </Button>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Knockout questions"
              subtitle="Flags are shown to recruiters with the answer. Nothing is deleted or rejected automatically."
              action={
                <Button variant="secondary" size="sm" onClick={() => setKnockouts((current) => [...current, newKnockout()])}>
                  <Plus className="h-4 w-4" aria-hidden="true" /> Add question
                </Button>
              }
            />
            <div className="space-y-4 px-5 py-4">
              {!knockouts.length && <p className="text-sm text-muted">No knockout questions. Candidates are ranked on criteria alone.</p>}
              {knockouts.map((knockout, index) => (
                <div key={index} className="rounded-xl border border-line p-4">
                  <div className="grid gap-3 sm:grid-cols-[1fr,1fr,auto]">
                    <Field label="Question">
                      <Input
                        value={knockout.prompt}
                        onChange={(e) =>
                          setKnockouts((current) => current.map((k, i) => (i === index ? { ...k, prompt: e.target.value } : k)))
                        }
                      />
                    </Field>
                    <Field label="Type">
                      <Select value={knockout.type} onChange={(e) => changeKnockoutType(index, e.target.value as KnockoutType)}>
                        {KNOCKOUT_TYPES.map((type) => (
                          <option key={type.value} value={type.value}>
                            {type.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <div className="flex items-start pt-6">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove question ${index + 1}`}
                        onClick={() => setKnockouts((current) => current.filter((_, i) => i !== index))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {knockout.type === 'DEGREE_CLASS' && (
                    <Field label="Required class" className="mt-3 max-w-xs">
                      <Select
                        value={String(knockout.config.minClass ?? 'SECOND_LOWER')}
                        onChange={(e) =>
                          setKnockouts((current) =>
                            current.map((k, i) => (i === index ? { ...k, config: { ...k.config, minClass: e.target.value } } : k)),
                          )
                        }
                      >
                        <option value="FIRST">First class</option>
                        <option value="SECOND_UPPER">Second class upper</option>
                        <option value="SECOND_LOWER">Second class lower</option>
                        <option value="THIRD">Third class</option>
                        <option value="PASS">Pass</option>
                      </Select>
                    </Field>
                  )}

                  {knockout.type === 'LOCATION' && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Field label="Accepted locations" hint="comma separated">
                        <Input
                          value={Array.isArray(knockout.config.acceptedLocations) ? (knockout.config.acceptedLocations as string[]).join(', ') : ''}
                          onChange={(e) =>
                            setKnockouts((current) =>
                              current.map((k, i) =>
                                i === index ? { ...k, config: { ...k.config, acceptedLocations: parseList(e.target.value) } } : k,
                              ),
                            )
                          }
                        />
                      </Field>
                      <div className="pt-6">
                        <Checkbox
                          checked={knockout.config.relocation !== false}
                          label="Willingness to relocate passes this question"
                          onChange={(e) =>
                            setKnockouts((current) =>
                              current.map((k, i) =>
                                i === index ? { ...k, config: { ...k.config, relocation: e.target.checked } } : k,
                              ),
                            )
                          }
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Fairness settings" />
            <div className="space-y-4 px-5 py-4">
              <Toggle
                checked={form.blindScreening}
                onChange={(value) => setForm({ ...form, blindScreening: value })}
                label="Blind screening (recommended)"
                description="Names, emails, phone numbers and locations are removed from the recruiter view until an explicit, audited reveal at shortlist."
              />
              <Toggle
                checked={form.hideUniversityBlind}
                onChange={(value) => setForm({ ...form, hideUniversityBlind: value })}
                label="Hide university while blind"
                description="Nigerian university pedigree is a known proxy. Hiding it keeps the first review on skills and evidence."
              />
              <Toggle
                checked={form.biasDemoMode}
                onChange={(value) => setForm({ ...form, biasDemoMode: value })}
                label="Bias demo rule (development only)"
                description="Applies a federal-university premium so the audit can demonstrate flagged adverse impact. Refused by the API when the server flag is off."
              />
            </div>
          </Card>

          <Card className="border-forest-200 bg-forest-50/60 p-5 text-xs leading-relaxed text-forest-900/80">
            <ShieldCheck className="h-5 w-5 text-forest-700" aria-hidden="true" />
            <p className="mt-2 text-sm font-semibold text-forest-900">What scoring can see</p>
            <p className="mt-1">
              Only the CV evidence that matches your criteria. Identity fields are stripped before scoring. Changing criteria rescores existing
              applications in the background, and every decision keeps the model and rubric version that produced it.
            </p>
          </Card>

          <div className="flex gap-2">
            <Button className="flex-1" loading={mutation.isPending} onClick={submit}>
              {isEdit ? 'Save changes' : 'Create job'}
            </Button>
            <Button variant="secondary" onClick={() => navigate('/recruiter/jobs')}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
