import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Briefcase, CheckCircle2, FileText, MapPin, Search, ShieldCheck, Upload } from 'lucide-react';
import { request, qs } from '../../lib/api';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  PageHeader,
  PageLoader,
  Pagination,
  Select,
  Textarea,
} from '../../components/ui';
import { formatDate } from '../../lib/utils';

interface JobListItem {
  id: string;
  title: string;
  slug: string;
  location: string;
  employmentType: string;
  deadline: string;
  openings: number;
  organisation: { name: string; sector: string | null };
  _count: { applications: number };
  criteria: { id: string; kind: string; label: string; weight: number }[];
}

interface JobDetail extends Omit<JobListItem, '_count' | 'organisation'> {
  description: string;
  status: string;
  blindScreening: boolean;
  minYearsExperience: number;
  organisation: { name: string; sector: string | null; website: string | null };
  knockoutQuestions: { id: string; type: string; prompt: string; options: string[]; config: Record<string, unknown> }[];
  _count: { applications: number };
}

const TYPE_LABELS: Record<string, string> = {
  FULL_TIME: 'Full time',
  PART_TIME: 'Part time',
  CONTRACT: 'Contract',
  INTERNSHIP: 'Internship',
  NYSC: 'NYSC',
};

export default function CandidateJobsPage() {
  const [search, setSearch] = useState('');
  const [location, setLocation] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ['public', 'jobs', { search, location, type, page }],
    queryFn: () =>
      request<{ data: JobListItem[]; meta: { total: number; page: number; totalPages: number } }>(
        `/public/jobs${qs({ search, location, type, page, pageSize: 9 })}`,
      ),
    placeholderData: (previous) => previous,
  });

  return (
    <div className="animate-fade-in">
      <PageHeader title="Find a fair employer" description="Every role shows its weighted criteria and knockout questions before you apply. No hidden requirements." />

      <Card className="mb-5 p-4">
        <form
          className="grid gap-3 sm:grid-cols-[1.4fr,1fr,0.8fr,auto]"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            query.refetch();
          }}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted" aria-hidden="true" />
            <Input
              className="pl-9"
              placeholder="Search role, skill or employer"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search jobs"
            />
          </div>
          <Input placeholder="Location" value={location} onChange={(event) => setLocation(event.target.value)} aria-label="Filter by location" />
          <Select value={type} onChange={(event) => setType(event.target.value)} aria-label="Filter by employment type">
            <option value="">All types</option>
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Button type="submit">Search</Button>
        </form>
      </Card>

      {query.isLoading ? (
        <PageLoader label="Finding open roles…" />
      ) : query.isError ? (
        <Alert tone="bad">{(query.error as Error).message}</Alert>
      ) : !query.data?.data.length ? (
        <Card className="p-10 text-center">
          <Briefcase className="mx-auto h-7 w-7 text-forest-600" aria-hidden="true" />
          <p className="mt-3 font-semibold">No roles match those filters</p>
          <p className="mt-1 text-sm text-muted">Try a broader search, or clear the filters.</p>
          <Button variant="secondary" className="mt-4" onClick={() => { setSearch(''); setLocation(''); setType(''); }}>
            Clear filters
          </Button>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {query.data.data.map((job) => (
              <Card key={job.id} className="flex flex-col p-5 transition hover:border-forest-300">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted">{job.organisation.name}</p>
                    <h2 className="mt-1 text-lg font-semibold leading-snug">{job.title}</h2>
                  </div>
                  <Badge tone="info">{TYPE_LABELS[job.employmentType] ?? job.employmentType}</Badge>
                </div>
                <p className="mt-2 flex items-center gap-1.5 text-sm text-muted">
                  <MapPin className="h-4 w-4" aria-hidden="true" /> {job.location}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(job.criteria ?? []).slice(0, 3).map((criterion) => (
                    <span key={criterion.id} className="rounded-md bg-forest-50 px-2 py-1 text-xs text-forest-800">
                      {criterion.label}
                    </span>
                  ))}
                  {(job.criteria?.length ?? 0) > 3 && (
                    <span className="px-1 py-1 text-xs text-muted">+{(job.criteria?.length ?? 0) - 3} more</span>
                  )}
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-xs text-muted">
                  <span>Closes {formatDate(job.deadline)}</span>
                  <Link to={`/candidate/jobs/${job.slug}`} className="inline-flex items-center gap-1 font-semibold text-forest-700 hover:underline">
                    View &amp; apply <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </div>
              </Card>
            ))}
          </div>
          <Pagination page={query.data.meta.page} totalPages={query.data.meta.totalPages} onChange={setPage} />
          <p className="mt-3 text-xs text-muted">{query.data.meta.total} open role(s)</p>
        </>
      )}
    </div>
  );
}

const KNOCKOUT_HELP: Record<string, string> = {
  NYSC: 'Your National Youth Service status.',
  DEGREE_CLASS: 'The class you graduated with.',
  LOCATION: 'Where you are based, and whether you can relocate.',
  AVAILABILITY: 'When you can start.',
  WORK_AUTH: 'Whether you can legally work in Nigeria.',
};

const ANSWER_OPTIONS: Record<string, { value: string; label: string }[]> = {
  NYSC: [
    { value: 'COMPLETED', label: 'NYSC completed' },
    { value: 'SERVING', label: 'Currently serving' },
    { value: 'EXEMPTED', label: 'Exempted' },
    { value: 'NOT_YET', label: 'Not yet served' },
  ],
  DEGREE_CLASS: [
    { value: 'FIRST', label: 'First Class' },
    { value: 'SECOND_UPPER', label: 'Second Class Upper' },
    { value: 'SECOND_LOWER', label: 'Second Class Lower' },
    { value: 'THIRD', label: 'Third Class' },
    { value: 'PASS', label: 'Pass' },
  ],
  WORK_AUTH: [
    { value: 'Yes', label: 'Yes' },
    { value: 'No', label: 'No' },
  ],
  AVAILABILITY: [
    { value: 'IMMEDIATE', label: 'Immediately' },
    { value: 'WITHIN_30_DAYS', label: 'Within 30 days' },
    { value: 'WITHIN_90_DAYS', label: 'Within 90 days' },
    { value: 'LATER', label: 'More than 90 days' },
  ],
};

export function JobDetailPage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [coverLetter, setCoverLetter] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['public', 'job', slug],
    queryFn: () => request<JobDetail>(`/public/jobs/${slug}`),
  });

  const apply = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Attach your CV as a PDF or Word document.');
      if (file.size > 5 * 1024 * 1024) throw new Error('Your CV must be 5 MB or smaller.');
      if (!accepted) throw new Error('Acknowledge the AI-use notice to continue.');
      const body = new FormData();
      body.append('jobId', query.data!.id);
      body.append('cv', file);
      if (coverLetter) body.append('coverLetter', coverLetter);
      body.append('knockoutAnswers', JSON.stringify(answers));
      body.append('acceptedAiNotice', 'true');
      return request<{ id: string; knockoutPassed: boolean }>('/applications', { method: 'POST', body });
    },
    onSuccess: (data) => navigate(`/candidate/applications/${data.id}`),
    onError: (err) => setError((err as Error).message),
  });

  if (query.isLoading) return <PageLoader />;
  if (query.isError) return <Alert tone="bad">{(query.error as Error).message}</Alert>;
  const job = query.data!;
  const mustHaves = (job.criteria ?? []).filter((c) => c.kind === 'MUST_HAVE');
  const niceToHaves = (job.criteria ?? []).filter((c) => c.kind !== 'MUST_HAVE');

  return (
    <div className="animate-fade-in">
      <Link to="/candidate/jobs" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-forest-700">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All jobs
      </Link>

      <div className="grid gap-6 lg:grid-cols-[1.5fr,1fr] lg:items-start">
        <div className="space-y-5">
          <Card className="p-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">{TYPE_LABELS[job.employmentType] ?? job.employmentType}</Badge>
              {job.blindScreening && (
                <Badge tone="good">
                  <ShieldCheck className="h-3 w-3" aria-hidden="true" /> Blind screening
                </Badge>
              )}
              <span className="text-xs text-muted">Closes {formatDate(job.deadline)}</span>
            </div>
            <h1 className="mt-3 text-2xl font-semibold sm:text-3xl">{job.title}</h1>
            <p className="mt-1 text-sm text-muted">
              {job.organisation.name} · {job.location} · {job.openings} opening{job.openings > 1 ? 's' : ''}
            </p>
            <div className="prose-ise mt-5 text-sm">
              {job.description.split('\n').filter(Boolean).map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="How you will be assessed" subtitle="The exact criteria the score uses, and how much each counts." />
            <div className="space-y-5 p-5">
              {[
                { title: 'Must-have', items: mustHaves, tone: 'info' as const },
                { title: 'Nice-to-have', items: niceToHaves, tone: 'neutral' as const },
              ].map((group) => (
                <div key={group.title}>
                  <h3 className="text-sm font-semibold">
                    {group.title} <span className="font-normal text-muted">({group.items.reduce((s, c) => s + c.weight, 0)}% of the score)</span>
                  </h3>
                  <ul className="mt-2 space-y-2">
                    {group.items.map((criterion) => (
                      <li key={criterion.id} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-sm">
                        <span>{criterion.label}</span>
                        <Badge tone={group.tone}>{criterion.weight}%</Badge>
                      </li>
                    ))}
                    {!group.items.length && <li className="text-sm text-muted">None listed.</li>}
                  </ul>
                </div>
              ))}
              <Alert tone="info">
                University prestige, gender, age, state of origin, religion and marital status are never scored. The AI produces
                a score and explanation; a person makes every shortlisting decision.
              </Alert>
            </div>
          </Card>
        </div>

        <Card className="lg:sticky lg:top-20">
          <CardHeader title="Apply for this role" subtitle="One CV per application. You can correct the parsed details afterwards." />
          <form
            className="space-y-4 p-5"
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);
              apply.mutate();
            }}
          >
            {error && <Alert tone="bad">{error}</Alert>}

            <div>
              <label
                htmlFor="cv"
                className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-line bg-stone-50/60 px-4 py-8 text-center transition hover:border-forest-400"
              >
                <Upload className="h-6 w-6 text-forest-600" aria-hidden="true" />
                <span className="mt-2 text-sm font-medium">{file ? file.name : 'Upload your CV'}</span>
                <span className="mt-0.5 text-xs text-muted">PDF or DOCX · max 5 MB</span>
                <input
                  id="cv"
                  type="file"
                  accept=".pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="sr-only"
                  onChange={(event) => {
                    const selected = event.target.files?.[0] ?? null;
                    setFileError(null);
                    if (selected && selected.size > 5 * 1024 * 1024) {
                      setFileError('Your CV must be 5 MB or smaller.');
                      setFile(null);
                      return;
                    }
                    setFile(selected);
                  }}
                />
              </label>
              {fileError && <p className="mt-1.5 text-xs font-medium text-ink">{fileError}</p>}
            </div>

            <Field label="Cover letter" htmlFor="coverLetter" hint="optional">
              <Textarea id="coverLetter" rows={4} value={coverLetter} onChange={(event) => setCoverLetter(event.target.value)} placeholder="A short note on why this role fits you." />
            </Field>

            {(job.knockoutQuestions?.length ?? 0) > 0 && (
              <fieldset className="space-y-3 rounded-xl border border-line bg-stone-50/50 p-3">
                <legend className="px-1 text-sm font-semibold">Knockout questions</legend>
                <p className="text-xs leading-relaxed text-muted">
                  These check basic eligibility. A failed answer flags your application for a human — it never deletes it.
                </p>
                {(job.knockoutQuestions ?? []).map((question) => (
                  <Field key={question.id} label={question.prompt} htmlFor={`q-${question.id}`} hint={KNOCKOUT_HELP[question.type]}>
                    {ANSWER_OPTIONS[question.type] ? (
                      <Select
                        id={`q-${question.id}`}
                        value={answers[question.id] ?? ''}
                        onChange={(event) => setAnswers((prev) => ({ ...prev, [question.id]: event.target.value }))}
                        required
                      >
                        <option value="">Select an answer</option>
                        {ANSWER_OPTIONS[question.type].map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Input
                        id={`q-${question.id}`}
                        value={answers[question.id] ?? ''}
                        onChange={(event) => setAnswers((prev) => ({ ...prev, [question.id]: event.target.value }))}
                        required
                      />
                    )}
                  </Field>
                ))}
              </fieldset>
            )}

            <div className="rounded-xl border border-forest-200 bg-forest-50/60 p-3">
              <label className="flex items-start gap-2.5 text-xs leading-relaxed text-forest-950">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-forest-300 text-forest-600"
                  checked={accepted}
                  onChange={(event) => setAccepted(event.target.checked)}
                  required
                />
                <span>
                  I understand AI will help screen this application against the published criteria, that a human makes the final
                  decision, and that I can request human review at any time.
                </span>
              </label>
            </div>

            <Button type="submit" className="w-full" loading={apply.isPending} disabled={!job.status || job.status !== 'OPEN'}>
              <FileText className="h-4 w-4" aria-hidden="true" /> Submit application
            </Button>
            <p className="flex items-center justify-center gap-1.5 text-xs text-muted">
              <CheckCircle2 className="h-3.5 w-3.5 text-forest-600" aria-hidden="true" /> You can track every stage after applying.
            </p>
          </form>
        </Card>
      </div>
    </div>
  );
}
