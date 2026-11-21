import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Briefcase, CalendarClock, FileSearch, ShieldCheck, UserRound } from 'lucide-react';
import { request } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Alert, Badge, Button, Card, CardHeader, PageHeader, PageLoader, ScoreRing, StatCard, StatusBadge } from '../../components/ui';
import { STAGE_LABELS, STAGE_TONE, formatDateTime } from '../../lib/utils';

interface DashboardData {
  applications: { id: string; stage: string; score: number | null; createdAt: string; job: { id: string; title: string; organisation: { name: string } } }[];
  upcomingInterviews: { id: string; slot: { startsAt: string }; application: { job: { title: string } } }[];
  unreadNotifications: number;
  totalApplications: number;
  profileComplete: boolean;
}

export default function CandidateDashboard() {
  const { user } = useAuth();
  const query = useQuery({ queryKey: ['candidate', 'dashboard'], queryFn: () => request<DashboardData>('/candidate/dashboard') });

  if (query.isLoading) return <PageLoader />;
  if (query.isError) return <Alert tone="bad">{(query.error as Error).message}</Alert>;
  const data = query.data!;
  const firstName = user?.fullName.split(' ')[0] ?? 'there';
  const shortlisted = data.applications.filter((a) => ['SHORTLISTED', 'INTERVIEW', 'OFFER', 'HIRED'].includes(a.stage)).length;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={`Welcome, ${firstName}`}
        description="Your applications, explained. Every score shows its reasoning, and a person makes the final call."
        action={
          <Link to="/candidate/jobs">
            <Button>
              <Briefcase className="h-4 w-4" aria-hidden="true" /> Find jobs
            </Button>
          </Link>
        }
      />

      {!data.profileComplete && (
        <Alert tone="warn" title="Finish your profile" className="mb-5">
          Add a headline and location so recruiters understand your focus. Your CV is what gets scored — your profile is context.
          <Link to="/candidate/profile" className="ml-1 font-semibold underline">
            Complete profile
          </Link>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Applications" value={data.totalApplications} icon={<FileSearch className="h-5 w-5" />} hint="Across all employers" />
        <StatCard label="In progress" value={shortlisted} icon={<ShieldCheck className="h-5 w-5" />} tone="good" hint="Shortlisted or further" />
        <StatCard
          label="Upcoming interviews"
          value={data.upcomingInterviews.length}
          icon={<CalendarClock className="h-5 w-5" />}
          tone="warn"
          hint={data.upcomingInterviews[0] ? formatDateTime(data.upcomingInterviews[0].slot.startsAt) : 'None scheduled'}
        />
        <StatCard label="Unread updates" value={data.unreadNotifications} icon={<UserRound className="h-5 w-5" />} hint="In-app notifications" />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1.4fr,1fr]">
        <Card>
          <CardHeader
            title="Recent applications"
            subtitle="Status and score, with the recruiters’ human decisions recorded."
            action={
              <Link to="/candidate/applications" className="text-sm font-medium text-forest-700 hover:underline">
                View all
              </Link>
            }
          />
          <div className="divide-y divide-line">
            {!data.applications.length && (
              <div className="px-5 py-10 text-center text-sm text-muted">
                No applications yet.{' '}
                <Link to="/candidate/jobs" className="font-medium text-forest-700 underline">
                  Browse open roles
                </Link>
                .
              </div>
            )}
            {data.applications.map((application) => (
              <Link
                key={application.id}
                to={`/candidate/applications/${application.id}`}
                className="flex items-center gap-4 px-5 py-4 transition hover:bg-forest-50/40"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{application.job.title}</p>
                  <p className="truncate text-sm text-muted">{application.job.organisation.name}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <StatusBadge status={STAGE_LABELS[application.stage] ?? application.stage} tone={STAGE_TONE[application.stage] ?? 'neutral'} />
                    <span className="text-xs text-muted">Applied {formatDateTime(application.createdAt)}</span>
                  </div>
                </div>
                <div className="hidden sm:block">
                  <ScoreRing score={application.score} size={62} />
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Upcoming interviews" />
            <div className="divide-y divide-line">
              {!data.upcomingInterviews.length && <p className="px-5 py-6 text-sm text-muted">No interviews booked yet.</p>}
              {data.upcomingInterviews.map((interview) => (
                <div key={interview.id} className="px-5 py-4">
                  <p className="text-sm font-medium">{interview.application.job.title}</p>
                  <p className="mt-1 text-sm text-muted">{formatDateTime(interview.slot.startsAt)}</p>
                  <Link to={`/candidate/applications/${(interview as unknown as { application: { id: string } }).application.id}`} className="mt-2 inline-block text-xs font-semibold text-forest-700 hover:underline">
                    Manage interview
                  </Link>
                </div>
              ))}
            </div>
          </Card>

          <Card className="border-forest-200 bg-forest-50/60 p-5">
            <ShieldCheck className="h-5 w-5 text-forest-700" aria-hidden="true" />
            <p className="mt-2 text-sm font-semibold text-forest-900">AI assists. People decide.</p>
            <p className="mt-1 text-xs leading-relaxed text-forest-900/80">
              Your score is a recommendation with an explanation. It never rejects you. If AI helped screen your application,
              you can request human review from the application page.
            </p>
            <Badge tone="info" className="mt-3">
              NDPA 2023 rights
            </Badge>
          </Card>
        </div>
      </div>
    </div>
  );
}
