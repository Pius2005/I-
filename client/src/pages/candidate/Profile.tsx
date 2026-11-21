import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Download, Lock, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { rawRequest, request } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import {
  AGE_BANDS,
  GENDER_OPTIONS,
  NIGERIAN_STATES,
  cn,
  formatDateTime,
} from '../../lib/utils';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  Field,
  Input,
  PageHeader,
  PageLoader,
  Select,
  Tabs,
  Textarea,
} from '../../components/ui';

const profileSchema = z.object({
  fullName: z.string().min(2, 'Enter your full name').max(120),
  phone: z.string().max(30).optional(),
  headline: z.string().max(160).optional(),
  location: z.string().max(120).optional(),
  summary: z.string().max(2000).optional(),
  linkedinUrl: z.string().url('Enter a full URL').or(z.literal('')).optional(),
  portfolioUrl: z.string().url('Enter a full URL').or(z.literal('')).optional(),
});

type ProfileForm = z.infer<typeof profileSchema>;

interface DataRequestItem {
  id: string;
  type: 'EXPORT' | 'DELETE';
  status: string;
  requestedAt: string;
  completedAt: string | null;
  note: string | null;
}

export default function CandidateProfile() {
  const { user, reload } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('profile');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const profileQuery = useQuery({
    queryKey: ['candidate', 'profile'],
    queryFn: () =>
      request<{
        fullName?: string;
        email?: string;
        headline?: string | null;
        summary?: string | null;
        location?: string | null;
        phone?: string | null;
        linkedinUrl?: string | null;
        portfolioUrl?: string | null;
      }>('/candidate/profile'),
  });
  const prefsQuery = useQuery({
    queryKey: ['notifications', 'preferences'],
    queryFn: () => request<{ email: boolean; sms: boolean; whatsapp: boolean; inApp: boolean }>('/notifications/preferences'),
  });
  const demographicsQuery = useQuery({
    queryKey: ['candidate', 'demographics'],
    queryFn: () =>
      request<{
        gender?: string;
        ageBand?: string;
        stateOfOrigin?: string | null;
        universityType?: string;
        disabilityStatus?: string;
        declaredAt?: string;
        region?: string;
      } | null>('/candidate/demographics'),
  });
  const requestsQuery = useQuery({
    queryKey: ['candidate', 'data-requests'],
    queryFn: () => request<DataRequestItem[]>('/candidate/data-requests'),
  });
  const consentQuery = useQuery({
    queryKey: ['candidate', 'consent'],
    queryFn: () => request<{ id: string; purpose: string; version: string; grantedAt: string; withdrawnAt: string | null }[]>('/candidate/consent'),
  });

  const profileForm = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    values: {
      fullName: profileQuery.data?.fullName ?? user?.fullName ?? '',
      phone: profileQuery.data?.phone ?? user?.phone ?? '',
      headline: profileQuery.data?.headline ?? '',
      location: profileQuery.data?.location ?? '',
      summary: profileQuery.data?.summary ?? '',
      linkedinUrl: profileQuery.data?.linkedinUrl ?? '',
      portfolioUrl: profileQuery.data?.portfolioUrl ?? '',
    },
  });

  const saveProfile = profileForm.handleSubmit(async (values) => {
    setError(null);
    try {
      await request('/candidate/profile', {
        method: 'PUT',
        body: {
          headline: values.headline ?? null,
          summary: values.summary ?? null,
          location: values.location ?? null,
          phone: values.phone ?? null,
          linkedinUrl: values.linkedinUrl || null,
          portfolioUrl: values.portfolioUrl || null,
        },
      });
      if (values.fullName !== user?.fullName) {
        await request('/auth/me', { method: 'PATCH', body: { fullName: values.fullName, phone: values.phone || null } });
      }
      await reload();
      await queryClient.invalidateQueries({ queryKey: ['candidate', 'profile'] });
      setNotice('Profile saved.');
    } catch (err) {
      setError((err as Error).message);
    }
  });

  // --- demographics (voluntary) -------------------------------------------
  const demoForm = useForm<{
    gender?: string;
    ageBand?: string;
    stateOfOrigin?: string;
    universityType?: string;
    disabilityStatus?: string;
  }>({
    values: {
      gender: demographicsQuery.data?.gender ?? 'PREFER_NOT_TO_SAY',
      ageBand: demographicsQuery.data?.ageBand ?? 'PREFER_NOT_TO_SAY',
      stateOfOrigin: demographicsQuery.data?.stateOfOrigin ?? '',
      universityType: demographicsQuery.data?.universityType ?? 'PREFER_NOT_TO_SAY',
      disabilityStatus: demographicsQuery.data?.disabilityStatus ?? 'PREFER_NOT_TO_SAY',
    },
  });

  const saveDemographics = demoForm.handleSubmit(async (values) => {
    setError(null);
    try {
      await request('/candidate/demographics', {
        method: 'PUT',
        body: { ...values, stateOfOrigin: values.stateOfOrigin || null, consentVersion: '2026-02-v1' },
      });
      await queryClient.invalidateQueries({ queryKey: ['candidate', 'demographics'] });
      setNotice('Demographic declaration saved. Thank you — it powers the aggregate bias audit only.');
    } catch (err) {
      setError((err as Error).message);
    }
  });

  const withdrawDemographics = useMutation({
    mutationFn: () => request('/candidate/demographics', { method: 'DELETE' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['candidate', 'demographics'] });
      setNotice('Declaration withdrawn. You are no longer included in group statistics.');
    },
  });

  // --- notifications -------------------------------------------------------
  const prefsMutation = useMutation({
    mutationFn: (body: Record<string, boolean>) => request('/notifications/preferences', { method: 'PUT', body }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['notifications', 'preferences'] });
      setNotice('Notification preferences updated.');
    },
  });

  const downloadExport = async () => {
    setError(null);
    try {
      const response = await rawRequest('/candidate/data-requests', { method: 'POST', body: { type: 'EXPORT' } });
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'ise-data-export.json';
      anchor.click();
      URL.revokeObjectURL(url);
      await queryClient.invalidateQueries({ queryKey: ['candidate', 'data-requests'] });
      setNotice('Your data export has been downloaded.');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const requestDeletion = useMutation({
    mutationFn: () => request('/candidate/data-requests', { method: 'POST', body: { type: 'DELETE' } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['candidate', 'data-requests'] });
      setNotice('Deletion request recorded. An administrator will process it after identity review.');
    },
    onError: (err) => setError((err as Error).message),
  });

  if (profileQuery.isLoading) return <PageLoader />;

  return (
    <div className="animate-fade-in">
      <PageHeader title="Profile & privacy" description="Your details, your voluntary declaration, and your data rights — all in one place." />

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

      <div className="mb-5">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'profile', label: 'Profile' },
            { value: 'demographics', label: 'Voluntary declaration' },
            { value: 'notifications', label: 'Notifications' },
            { value: 'privacy', label: 'Privacy & data' },
          ]}
        />
      </div>

      {tab === 'profile' && (
        <div className="grid gap-5 lg:grid-cols-[1.4fr,1fr]">
          <Card>
            <CardHeader title="Your details" subtitle="Used for correspondence. Not scored." />
            <form onSubmit={saveProfile} className="space-y-4 p-5" noValidate>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Full name" htmlFor="fullName" error={profileForm.formState.errors.fullName?.message}>
                  <Input id="fullName" {...profileForm.register('fullName')} />
                </Field>
                <Field label="Phone" htmlFor="phone" hint="optional">
                  <Input id="phone" inputMode="tel" {...profileForm.register('phone')} />
                </Field>
              </div>
              <Field label="Professional headline" htmlFor="headline" hint="e.g. BSc Economics graduate — data analyst">
                <Input id="headline" {...profileForm.register('headline')} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Location" htmlFor="location">
                  <Input id="location" {...profileForm.register('location')} />
                </Field>
                <Field label="Email" htmlFor="email">
                  <Input id="email" value={user?.email ?? ''} disabled readOnly />
                </Field>
              </div>
              <Field label="Short summary" htmlFor="summary">
                <Textarea id="summary" rows={4} {...profileForm.register('summary')} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="LinkedIn URL" htmlFor="linkedinUrl" error={profileForm.formState.errors.linkedinUrl?.message}>
                  <Input id="linkedinUrl" placeholder="https://linkedin.com/in/…" {...profileForm.register('linkedinUrl')} />
                </Field>
                <Field label="Portfolio URL" htmlFor="portfolioUrl" error={profileForm.formState.errors.portfolioUrl?.message}>
                  <Input id="portfolioUrl" placeholder="https://" {...profileForm.register('portfolioUrl')} />
                </Field>
              </div>
              <Button type="submit" loading={profileForm.formState.isSubmitting}>
                Save profile
              </Button>
            </form>
          </Card>

          <Card className="h-fit p-5">
            <UserRound className="h-5 w-5 text-forest-700" aria-hidden="true" />
            <p className="mt-2 font-semibold">Your CV is the scored document</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              Each application carries its own CV. You can review and correct what the parser extracted before the recruiter
              sees it, and the score is recomputed from your corrections.
            </p>
            <div className="mt-4 rounded-xl border border-line bg-stone-50 p-3 text-xs leading-relaxed text-muted">
              Blind screening hides your name, contact details, gender, age, origin and university name from recruiters until you
              are shortlisted. Your demographic declaration is never part of that view.
            </div>
          </Card>
        </div>
      )}

      {tab === 'demographics' && (
        <div className="grid gap-5 lg:grid-cols-[1.4fr,1fr]">
          <Card>
            <CardHeader
              title="Voluntary self-declaration"
              subtitle="Used only in aggregate to check whether screening treats groups differently."
            />
            <form onSubmit={saveDemographics} className="space-y-4 p-5">
              <Alert tone="info">
                This is optional and can be withdrawn at any time. It is encrypted, stored separately, never sent to the AI
                scorer, and never shown to a recruiter at an individual level.
              </Alert>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Gender" htmlFor="gender">
                  <Select id="gender" {...demoForm.register('gender')}>
                    {GENDER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Age band" htmlFor="ageBand">
                  <Select id="ageBand" {...demoForm.register('ageBand')}>
                    {AGE_BANDS.map((band) => (
                      <option key={band} value={band}>
                        {band === 'PREFER_NOT_TO_SAY' ? 'Prefer not to say' : band}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="State of origin" htmlFor="stateOfOrigin" hint="optional">
                  <Select id="stateOfOrigin" {...demoForm.register('stateOfOrigin')}>
                    <option value="">Prefer not to say</option>
                    {NIGERIAN_STATES.map((state) => (
                      <option key={state} value={state}>
                        {state}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="University type" htmlFor="universityType">
                  <Select id="universityType" {...demoForm.register('universityType')}>
                    {['FEDERAL', 'STATE', 'PRIVATE', 'POLYTECHNIC', 'PREFER_NOT_TO_SAY'].map((value) => (
                      <option key={value} value={value}>
                        {value === 'PREFER_NOT_TO_SAY' ? 'Prefer not to say' : value[0] + value.slice(1).toLowerCase()}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Disability status" htmlFor="disabilityStatus">
                  <Select id="disabilityStatus" {...demoForm.register('disabilityStatus')}>
                    <option value="NONE">No disability</option>
                    <option value="DECLARED">I have a disability</option>
                    <option value="PREFER_NOT_TO_SAY">Prefer not to say</option>
                  </Select>
                </Field>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button type="submit" loading={demoForm.formState.isSubmitting}>
                  Save declaration
                </Button>
                {demographicsQuery.data && (
                  <Button type="button" variant="secondary" loading={withdrawDemographics.isPending} onClick={() => withdrawDemographics.mutate()}>
                    Withdraw declaration
                  </Button>
                )}
              </div>
              {demographicsQuery.data?.declaredAt && (
                <p className="text-xs text-muted">Last declared {formatDateTime(demographicsQuery.data.declaredAt)}</p>
              )}
            </form>
          </Card>
          <Card className="h-fit p-5">
            <Lock className="h-5 w-5 text-forest-700" aria-hidden="true" />
            <p className="mt-2 font-semibold">Why we ask</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              Nigeria’s hiring risks include ethnic signals in names, polytechnic prejudice and state-of-origin bias. Group
              statistics let an employer detect a pattern before it becomes a rejected candidate. Without voluntary data, that
              pattern stays invisible.
            </p>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              Groups smaller than five people are suppressed in reports so nobody can be identified. You can withdraw at any time
              and stay in every hiring process.
            </p>
          </Card>
        </div>
      )}

      {tab === 'notifications' && (
        <Card className="max-w-2xl">
          <CardHeader title="Notification channels" subtitle="Choose how Iṣẹ́ reaches you. In-app notifications are always available." />
          <div className="space-y-4 p-5">
            {[
              { key: 'email' as const, label: 'Email', description: 'Application updates, interview confirmations and reminders.' },
              { key: 'sms' as const, label: 'SMS', description: 'Short reminders and interview changes by text.' },
              { key: 'whatsapp' as const, label: 'WhatsApp', description: 'Optional WhatsApp reminders through our Nigerian provider.' },
              { key: 'inApp' as const, label: 'In-app', description: 'The notification centre in your dashboard.' },
            ].map((channel) => (
              <label key={channel.key} className="flex items-start justify-between gap-4 rounded-xl border border-line p-4">
                <span>
                  <span className="block text-sm font-medium">{channel.label}</span>
                  <span className="mt-0.5 block text-xs text-muted">{channel.description}</span>
                </span>
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 rounded border-line text-forest-600"
                  checked={Boolean(prefsQuery.data?.[channel.key])}
                  onChange={(event) => prefsMutation.mutate({ [channel.key]: event.target.checked })}
                  aria-label={channel.label}
                />
              </label>
            ))}
            <p className="text-xs text-muted">Preferences save immediately. Critical account messages are always emailed.</p>
          </div>
        </Card>
      )}

      {tab === 'privacy' && (
        <div className="grid gap-5 lg:grid-cols-[1.3fr,1fr]">
          <div className="space-y-5">
            <Card>
              <CardHeader title="Download your data" subtitle="A JSON copy of your account, applications, parsed CVs and declarations." />
              <div className="p-5">
                <Button variant="secondary" onClick={downloadExport}>
                  <Download className="h-4 w-4" aria-hidden="true" /> Download data export
                </Button>
              </div>
            </Card>

            <Card>
              <CardHeader title="Request deletion" subtitle="Erasure is human-reviewed so your decision record stays auditable." />
              <div className="space-y-3 p-5">
                <Alert tone="warn">
                  Deleting removes your profile, CVs, parsed data, demographic declaration and notifications. The hiring record is
                  anonymised rather than erased, because employers must retain evidence of fair decisions.
                </Alert>
                <Button
                  variant="danger"
                  onClick={() => requestDeletion.mutate()}
                  loading={requestDeletion.isPending}
                  disabled={requestsQuery.data?.some((r) => r.type === 'DELETE' && r.status === 'PENDING')}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" /> Request account deletion
                </Button>
              </div>
            </Card>

            <Card>
              <CardHeader title="Your requests" />
              <div className="divide-y divide-line">
                {!requestsQuery.data?.length && <p className="px-5 py-5 text-sm text-muted">No requests yet.</p>}
                {requestsQuery.data?.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <div>
                      <p className="font-medium">{item.type === 'EXPORT' ? 'Data export' : 'Account deletion'}</p>
                      <p className="text-xs text-muted">Requested {formatDateTime(item.requestedAt)}</p>
                    </div>
                    <Badge tone={item.status === 'COMPLETED' ? 'good' : item.status === 'REJECTED' ? 'bad' : 'warn'}>{item.status}</Badge>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="space-y-5">
            <Card className="p-5">
              <ShieldCheck className="h-5 w-5 text-forest-700" aria-hidden="true" />
              <p className="mt-2 font-semibold">Consent records</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">Every consent you have given, with its version and date.</p>
              <ul className="mt-3 space-y-2 text-sm">
                {consentQuery.data?.map((record) => (
                  <li key={record.id} className={cn('rounded-lg border border-line p-3', record.withdrawnAt && 'opacity-60')}>
                    <p className="font-medium capitalize">{record.purpose.replace(/_/g, ' ')}</p>
                    <p className="text-xs text-muted">
                      v{record.version} · {formatDateTime(record.grantedAt)}
                      {record.withdrawnAt ? ` · withdrawn ${formatDateTime(record.withdrawnAt)}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="p-5">
              <Checkbox label="I understand my rights under the NDPA 2023: access, correction, deletion, objection." checked readOnly disabled />
              <p className="mt-2 text-xs text-muted">Read the full privacy notice from the footer of any public page.</p>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
