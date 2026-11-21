import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CalendarPlus, Download, MapPin, Trash2, Users, Video } from 'lucide-react';
import { download, qs, request, type Paginated } from '../../lib/api';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  PageHeader,
  PageLoader,
  Select,
  StatusBadge,
  Tabs,
} from '../../components/ui';
import { STAGE_LABELS, STAGE_TONE, formatDateTime } from '../../lib/utils';

interface InterviewRow {
  id: string;
  status: string;
  type: string;
  location: string | null;
  meetingLink: string | null;
  slot: { startsAt: string; endsAt: string };
  application: {
    id: string;
    publicRef: string;
    stage: string;
    job: { id: string; title: string };
    candidate: { fullName: string; email: string | null };
  };
}

interface JobOption {
  id: string;
  title: string;
  status: string;
}

interface AvailabilityWindow {
  id: string;
  startsAt: string;
  endsAt: string;
  slotMinutes: number;
  bufferMinutes: number;
  interviewType: string;
  location: string | null;
  slots: { id: string; startsAt: string; applicationId: string | null; interview: { id: string; status: string } | null }[];
}

export default function RecruiterInterviewsPage() {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<'upcoming' | 'all'>('upcoming');
  const [jobId, setJobId] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('13:00');
  const [slotMinutes, setSlotMinutes] = useState(30);
  const [bufferMinutes, setBufferMinutes] = useState(10);
  const [interviewType, setInterviewType] = useState('VIDEO');
  const [location, setLocation] = useState('');

  const interviews = useQuery({
    queryKey: ['recruiter', 'interviews', scope],
    queryFn: () => request<Paginated<InterviewRow>>(`/recruiter/interviews${qs({ pageSize: 60, upcoming: scope === 'upcoming' })}`),
  });

  const jobs = useQuery({
    queryKey: ['recruiter', 'jobs', 'options'],
    queryFn: () => request<Paginated<JobOption>>(`/recruiter/jobs${qs({ pageSize: 100 })}`),
  });

  const windows = useQuery({
    queryKey: ['recruiter', 'availability', jobId],
    queryFn: () => request<AvailabilityWindow[]>(`/recruiter/jobs/${jobId}/availability`),
    enabled: Boolean(jobId),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['recruiter'] });

  const createWindow = useMutation({
    mutationFn: () => {
      const startsAt = new Date(`${date}T${startTime}:00`);
      const endsAt = new Date(`${date}T${endTime}:00`);
      return request(`/recruiter/jobs/${jobId}/availability`, {
        method: 'POST',
        body: {
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          slotMinutes: Number(slotMinutes),
          bufferMinutes: Number(bufferMinutes),
          timezone: 'Africa/Lagos',
          interviewType,
          location: location || undefined,
        },
      });
    },
    onSuccess: async () => {
      setActionError(null);
      await refresh();
    },
    onError: (error) => setActionError((error as Error).message),
  });

  const deleteWindow = useMutation({
    mutationFn: (windowId: string) => request(`/recruiter/availability/${windowId}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError: (error) => setActionError((error as Error).message),
  });

  const updateInterview = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      request(`/interviews/${id}`, { method: 'PATCH', body: { status } }),
    onSuccess: refresh,
    onError: (error) => setActionError((error as Error).message),
  });

  const openJobs = useMemo(() => (jobs.data?.data ?? []).filter((job) => job.status !== 'CLOSED'), [jobs.data]);
  const rows = interviews.data?.data ?? [];

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Interviews"
        description="Publish availability windows, watch bookings arrive, and record outcomes. Candidates can move their slot until 12 hours before it starts."
      />

      {actionError && (
        <Alert tone="bad" className="mb-4">
          {actionError}
        </Alert>
      )}

      <div className="mb-4">
        <Tabs
          value={scope}
          onChange={(value) => setScope(value as 'upcoming' | 'all')}
          tabs={[
            { value: 'upcoming', label: 'Upcoming' },
            { value: 'all', label: 'All interviews' },
          ]}
        />
      </div>

      {interviews.isLoading && <PageLoader label="Loading interviews…" />}
      {interviews.isError && <Alert tone="bad">{(interviews.error as Error).message}</Alert>}

      {!interviews.isLoading && !rows.length && (
        <EmptyState
          icon={<CalendarClock className="h-5 w-5" />}
          title="No interviews booked"
          description="Publish an availability window below; shortlisted candidates can then pick a slot themselves."
        />
      )}

      <div className="grid gap-3">
        {rows.map((interview) => (
          <Card key={interview.id} className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{interview.application.candidate.fullName}</p>
                  <StatusBadge status={STAGE_LABELS[interview.status] ?? interview.status} tone={STAGE_TONE[interview.status] ?? 'neutral'} />
                  <Badge tone={interview.type === 'VIDEO' ? 'info' : 'neutral'}>
                    {interview.type === 'VIDEO' ? <Video className="h-3 w-3" aria-hidden="true" /> : <MapPin className="h-3 w-3" aria-hidden="true" />}
                    {interview.type.toLowerCase()}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  {interview.application.job.title} · {interview.application.publicRef}
                  {interview.application.candidate.email ? ` · ${interview.application.candidate.email}` : ''}
                </p>
                <p className="mt-1 text-sm">{formatDateTime(interview.slot.startsAt)}</p>
                {interview.meetingLink && (
                  <a href={interview.meetingLink} target="_blank" rel="noreferrer" className="text-xs font-medium text-forest-700 hover:underline">
                    {interview.meetingLink}
                  </a>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => download(`/interviews/${interview.id}/ics`, `ise-interview-${interview.id}.ics`)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium hover:bg-forest-50"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" /> ICS
                </button>
                {interview.status === 'SCHEDULED' && (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => updateInterview.mutate({ id: interview.id, status: 'COMPLETED' })}>
                      Completed
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => updateInterview.mutate({ id: interview.id, status: 'NO_SHOW' })}>
                      No show
                    </Button>
                  </>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="mt-8 grid gap-5 xl:grid-cols-[1fr,1fr]">
        <Card>
          <CardHeader title="Publish availability" subtitle="Slots are single-booked atomically, so two candidates can never take the same time." />
          <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
            <Field label="Job" htmlFor="availJob" className="sm:col-span-2">
              <Select id="availJob" value={jobId} onChange={(e) => setJobId(e.target.value)}>
                <option value="">Select a job…</option>
                {openJobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Date" htmlFor="availDate">
              <Input id="availDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Interview type" htmlFor="availType">
              <Select id="availType" value={interviewType} onChange={(e) => setInterviewType(e.target.value)}>
                <option value="VIDEO">Video</option>
                <option value="PHONE">Phone</option>
                <option value="IN_PERSON">In person</option>
              </Select>
            </Field>
            <Field label="Start (Africa/Lagos)" htmlFor="availStart">
              <Input id="availStart" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </Field>
            <Field label="End" htmlFor="availEnd">
              <Input id="availEnd" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </Field>
            <Field label="Slot length (minutes)" htmlFor="availSlot">
              <Input
                id="availSlot"
                type="number"
                min={10}
                max={240}
                value={slotMinutes}
                onChange={(e) => setSlotMinutes(Number(e.target.value))}
              />
            </Field>
            <Field label="Buffer between slots (minutes)" htmlFor="availBuffer">
              <Input
                id="availBuffer"
                type="number"
                min={0}
                max={120}
                value={bufferMinutes}
                onChange={(e) => setBufferMinutes(Number(e.target.value))}
              />
            </Field>
            <Field label="Location or meeting note" htmlFor="availLocation" className="sm:col-span-2" hint="optional">
              <Input id="availLocation" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Lagos office, 3rd floor" />
            </Field>
            <div className="sm:col-span-2">
              <Button
                loading={createWindow.isPending}
                disabled={!jobId || !date}
                onClick={() => createWindow.mutate()}
              >
                <CalendarPlus className="h-4 w-4" aria-hidden="true" /> Publish window
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Availability windows" subtitle={jobId ? 'Slots for the selected job' : 'Select a job to see its windows'} />
          <div className="divide-y divide-line">
            {!jobId && <p className="px-5 py-6 text-sm text-muted">Choose a job above.</p>}
            {jobId && windows.isLoading && <p className="px-5 py-6 text-sm text-muted">Loading…</p>}
            {jobId && windows.data?.length === 0 && <p className="px-5 py-6 text-sm text-muted">No upcoming availability windows.</p>}
            {windows.data?.map((window) => {
              const booked = window.slots.filter((slot) => slot.applicationId).length;
              return (
                <div key={window.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{formatDateTime(window.startsAt)}</p>
                    <p className="text-xs text-muted">
                      Ends {formatDateTime(window.endsAt)} · {window.slotMinutes} min slots · {window.interviewType.toLowerCase()}
                    </p>
                    <p className="mt-1 flex items-center gap-1 text-xs text-muted">
                      <Users className="h-3 w-3" aria-hidden="true" /> {booked} booked of {window.slots.length} slot(s)
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Delete availability window"
                    loading={deleteWindow.isPending}
                    onClick={() => deleteWindow.mutate(window.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
