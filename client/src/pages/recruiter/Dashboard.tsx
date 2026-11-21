import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, Briefcase, CalendarClock, FileSearch, ShieldCheck, Timer, Users } from 'lucide-react';
import { request } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, PageHeader, PageLoader, StatCard, StatusBadge } from '../../components/ui';
import { STAGE_LABELS, STAGE_TONE, formatDate, formatDateTime, scoreTone } from '../../lib/utils';

interface DashboardData {
  jobs: { id: string; title: string; status: string; deadline: string; openings: number; createdAt: string }[];
  jobCount: number;
  openJobs: number;
  applications: number;
  byStage: Record<string, number>;
  upcomingInterviews: number;
  recentApplications: {
    id: string;
    publicRef: string;
    stage: string;
    score: number | null;
    createdAt: string;
    identityRevealedAt: string | null;
    knockoutPassed: boolean;
    job: { id: string; title: string };
    name: string;
  }[];
  scoreDistribution: { bucket: string; count: number }[];
  avgDaysToShortlist: number | null;
}

const PIPELINE_STAGES = ['APPLIED', 'SCREENED', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED'];

export default function RecruiterDashboard() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ['recruiter', 'dashboard'],
    queryFn: () => request<DashboardData>('/recruiter/dashboard'),
  });

  if (query.isLoading) return <PageLoader label="Loading your hiring overview…" />;
  if (query.isError) return <Alert tone="bad">{(query.error as Error).message}</Alert>;

  const data = query.data!;
  const firstName = user?.fullName.split(' ')[0] ?? 'there';
  const shortlisted =
    (data.byStage.SHORTLISTED ?? 0) + (data.byStage.INTERVIEW ?? 0) + (data.byStage.OFFER ?? 0) + (data.byStage.HIRED ?? 0);
  const knockoutFlags = data.recentApplications.filter((a) => !a.knockoutPassed).length;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={`Good to see you, ${firstName}`}
        description="Screening statistics, live roles and the human decisions behind each stage. AI scores are recommendations only."
        action={
          <div className="flex flex-wrap gap-2">
            <Link to="/recruiter/jobs/new">
              <Button variant="gold">
                <Briefcase className="h-4 w-4" aria-hidden="true" /> Post a job
              </Button>
            </Link>
            <Link to="/recruiter/audit">
              <Button variant="secondary">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Bias audit
              </Button>
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Open roles"
          value={data.openJobs}
          hint={`${data.jobCount} role(s) in total`}
          icon={<Briefcase className="h-5 w-5" />}
        />
        <StatCard label="Applications" value={data.applications} hint="Across every role" icon={<FileSearch className="h-5 w-5" />} />
        <StatCard label="In progress" value={shortlisted} hint="Shortlisted or further" tone="good" icon={<Users className="h-5 w-5" />} />
        <StatCard
          label="Upcoming interviews"
          value={data.upcomingInterviews}
          hint="Scheduled and confirmed"
          tone="warn"
          icon={<CalendarClock className="h-5 w-5" />}
        />
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.35fr,1fr]">
        <Card>
          <CardHeader
            title="Live roles"
            subtitle="Open a pipeline to review blind-screened candidates and record decisions."
            action={
              <Link to="/recruiter/jobs" className="text-sm font-medium text-forest-700 hover:underline">
                All jobs
              </Link>
            }
          />
          <div className="divide-y divide-line">
            {!data.jobs.length && (
              <EmptyState
                title="No jobs yet"
                description="Post your first graduate role with weighted criteria so screening has a rubric."
                action={
                  <Link to="/recruiter/jobs/new">
                    <Button>Post a job</Button>
                  </Link>
                }
              />
            )}
            {data.jobs.map((job) => (
              <div key={job.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <Link to={`/recruiter/jobs/${job.id}/pipeline`} className="font-medium hover:text-forest-700 hover:underline">
                    {job.title}
                  </Link>
                  <p className="mt-0.5 text-xs text-muted">
                    {job.openings} opening(s) · Deadline {formatDate(job.deadline)}
                  </p>
                </div>
                <StatusBadge status={STAGE_LABELS[job.status] ?? job.status} tone={STAGE_TONE[job.status] ?? 'neutral'} />
                <Link to={`/recruiter/jobs/${job.id}/pipeline`}>
                  <Button variant="secondary" size="sm">
                    Pipeline
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Score distribution" subtitle="AI recommendation scores, 0–100" />
          <div className="h-64 px-3 py-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.scoreDistribution} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee9dc" vertical={false} />
                <XAxis dataKey="bucket" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval={1} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ borderRadius: 12, borderColor: '#e2ddcd', fontSize: 12 }}
                  formatter={(value) => [`${value} candidate(s)`, 'Applications']}
                  labelFormatter={(label) => `Score ${label}`}
                />
                <Bar dataKey="count" fill="#0b5d3b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="border-t border-line px-5 py-3 text-xs text-muted">
            Average time to shortlist:{' '}
            <span className="font-medium text-ink">{data.avgDaysToShortlist ?? '—'} day(s)</span>
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.35fr,1fr]">
        <Card>
          <CardHeader title="Recent applications" subtitle="Identity stays hidden until you shortlist and reveal." />
          <div className="divide-y divide-line">
            {!data.recentApplications.length && <p className="px-5 py-8 text-sm text-muted">No applications yet.</p>}
            {data.recentApplications.map((application) => (
              <Link
                key={application.id}
                to={`/recruiter/applications/${application.id}`}
                className="flex items-center gap-3 px-5 py-3.5 transition hover:bg-forest-50/40"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{application.name}</p>
                  <p className="truncate text-xs text-muted">{application.job.title}</p>
                </div>
                {!application.knockoutPassed && (
                  <Badge tone="warn">
                    <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Knockout
                  </Badge>
                )}
                <Badge tone={scoreTone(application.score)}>{application.score ?? '—'}</Badge>
                <StatusBadge
                  status={STAGE_LABELS[application.stage] ?? application.stage}
                  tone={STAGE_TONE[application.stage] ?? 'neutral'}
                />
              </Link>
            ))}
          </div>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Pipeline by stage" subtitle="Where candidates currently sit" />
            <div className="space-y-2.5 px-5 py-4">
              {PIPELINE_STAGES.map((stage) => {
                const count = data.byStage[stage] ?? 0;
                const width = data.applications ? Math.round((count / data.applications) * 100) : 0;
                return (
                  <div key={stage}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-ink/80">{STAGE_LABELS[stage]}</span>
                      <span className="tabular-nums text-muted">{count}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-stone-200">
                      <div
                        className={stage === 'REJECTED' ? 'h-full rounded-full bg-red-400' : 'h-full rounded-full bg-forest-600'}
                        style={{ width: `${width}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="border-forest-200 bg-forest-50/60 p-5">
            <ShieldCheck className="h-5 w-5 text-forest-700" aria-hidden="true" />
            <p className="mt-2 text-sm font-semibold text-forest-900">Bias checks run alongside hiring</p>
            <p className="mt-1 text-xs leading-relaxed text-forest-900/80">
              Selection rates, four-fifths adverse impact, proxy detection and override patterns are calculated per job. Flags are
              prompts for human investigation, not findings of discrimination.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link to="/recruiter/audit">
                <Button size="sm" variant="secondary">
                  Open audit
                </Button>
              </Link>
              {knockoutFlags > 0 && (
                <Badge tone="warn">
                  <Timer className="h-3 w-3" aria-hidden="true" /> {knockoutFlags} knockout flag(s) to review
                </Badge>
              )}
            </div>
          </Card>

          {data.recentApplications[0] && (
            <Card className="p-5">
              <p className="text-xs uppercase tracking-wide text-muted">Latest application</p>
              <p className="mt-1 text-sm font-medium">{data.recentApplications[0].job.title}</p>
              <p className="mt-0.5 text-xs text-muted">{formatDateTime(data.recentApplications[0].createdAt)}</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
