import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Check, Download, FileSearch, Plus, ScrollText, ShieldCheck, Trash2, Users } from 'lucide-react';
import { download, qs, request, type Paginated } from '../../lib/api';
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
  Modal,
  PageHeader,
  PageLoader,
  Select,
  StatCard,
  StatusBadge,
  Tabs,
  Toggle,
} from '../../components/ui';
import { STAGE_LABELS, STAGE_TONE, formatDateTime } from '../../lib/utils';

const ROLE_TONE: Record<string, 'info' | 'good' | 'warn'> = { ADMIN: 'warn', RECRUITER: 'info', CANDIDATE: 'good' };

// --- Dashboard --------------------------------------------------------------
interface AdminDashboardData {
  organisations: number;
  users: number;
  jobs: number;
  applications: number;
  interviews: number;
  reports: number;
  flaggedReports: number;
  pendingDataRequests: number;
  byRole: Record<string, number>;
  recentLogs: { id: string; action: string; entityType: string; actorRole: string; createdAt: string; actor: { fullName: string } | null }[];
}

export function AdminDashboard() {
  const query = useQuery({ queryKey: ['admin', 'dashboard'], queryFn: () => request<AdminDashboardData>('/admin/dashboard') });
  if (query.isLoading) return <PageLoader label="Loading system overview…" />;
  if (query.isError) return <Alert tone="bad">{(query.error as Error).message}</Alert>;
  const data = query.data!;

  return (
    <div className="animate-fade-in">
      <PageHeader title="System overview" description="Every organisation, account and audited action across Iṣẹ́." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Organisations" value={data.organisations} icon={<Building2 className="h-5 w-5" />} />
        <StatCard label="Active users" value={data.users} icon={<Users className="h-5 w-5" />} hint={`${data.byRole.RECRUITER ?? 0} recruiters · ${data.byRole.CANDIDATE ?? 0} candidates`} />
        <StatCard label="Jobs" value={data.jobs} hint={`${data.applications} applications`} icon={<FileSearch className="h-5 w-5" />} />
        <StatCard label="Interviews" value={data.interviews} icon={<ScrollText className="h-5 w-5" />} />
        <StatCard label="Bias reports" value={data.reports} tone="info" icon={<ShieldCheck className="h-5 w-5" />} />
        <StatCard label="Flagged reports" value={data.flaggedReports} tone={data.flaggedReports ? 'warn' : 'good'} />
        <StatCard
          label="Pending data requests"
          value={data.pendingDataRequests}
          tone={data.pendingDataRequests ? 'warn' : 'good'}
          hint="NDPA 2023 — export or erasure"
        />
        <StatCard label="Admins" value={data.byRole.ADMIN ?? 0} />
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.3fr,1fr]">
        <Card>
          <CardHeader
            title="Recent audited actions"
            subtitle="The audit log is append-only."
            action={
              <Link to="/admin/logs" className="text-sm font-medium text-forest-700 hover:underline">
                Full log
              </Link>
            }
          />
          <div className="divide-y divide-line">
            {!data.recentLogs.length && <p className="px-5 py-6 text-sm text-muted">No actions recorded yet.</p>}
            {data.recentLogs.map((log) => (
              <div key={log.id} className="flex flex-wrap items-center gap-2 px-5 py-3">
                <Badge tone="neutral">{log.action.replace(/_/g, ' ').toLowerCase()}</Badge>
                <span className="text-xs text-muted">{log.entityType}</span>
                <span className="ml-auto text-xs text-muted">
                  {log.actor?.fullName ?? log.actorRole} · {formatDateTime(log.createdAt)}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Manage" />
            <div className="grid gap-2 px-5 py-4 sm:grid-cols-2">
              {[
                { to: '/admin/organisations', label: 'Organisations', icon: Building2 },
                { to: '/admin/users', label: 'Users', icon: Users },
                { to: '/admin/audit', label: 'Bias audit', icon: ShieldCheck },
                { to: '/admin/data-requests', label: 'Data requests', icon: FileSearch },
                { to: '/admin/logs', label: 'System logs', icon: ScrollText },
                { to: '/admin/settings', label: 'Settings', icon: ShieldCheck },
              ].map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="flex items-center gap-2 rounded-lg border border-line px-3 py-2.5 text-sm hover:bg-forest-50"
                >
                  <item.icon className="h-4 w-4 text-forest-700" aria-hidden="true" /> {item.label}
                </Link>
              ))}
            </div>
          </Card>
          <Card className="border-amber-200 bg-amber-50 p-5 text-xs leading-relaxed text-amber-950">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            <p className="mt-2 text-sm font-semibold">NDPA 2023 obligations</p>
            <p className="mt-1">
              Handle subject access and erasure requests within the statutory window. Erasure anonymises the account while keeping the
              decision records needed for audit. Personal data must not be exported outside an approved process.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}

// --- Organisations ----------------------------------------------------------
interface Organisation {
  id: string;
  name: string;
  slug: string;
  sector: string | null;
  website: string | null;
  createdAt: string;
  _count: { users: number; jobs: number };
}

export function AdminOrganisations() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [sector, setSector] = useState('');
  const [website, setWebsite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const query = useQuery({
    queryKey: ['admin', 'organisations', search],
    queryFn: () => request<Paginated<Organisation>>(`/admin/organisations${qs({ pageSize: 60, search })}`),
  });

  const create = useMutation({
    mutationFn: () =>
      request('/admin/organisations', { method: 'POST', body: { name, sector: sector || undefined, website: website || undefined } }),
    onSuccess: async () => {
      setOpen(false);
      setName('');
      setSector('');
      setWebsite('');
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err) => setError((err as Error).message),
  });

  const rows = query.data?.data ?? [];

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Organisations"
        description="Employers using Iṣẹ́. Recruiters must belong to one organisation."
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" /> New organisation
          </Button>
        }
      />

      <div className="mb-4 max-w-sm">
        <Input placeholder="Search organisations" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search organisations" />
      </div>

      {query.isLoading && <PageLoader />}
      {query.isError && <Alert tone="bad">{(query.error as Error).message}</Alert>}
      {!query.isLoading && !rows.length && <EmptyState title="No organisations" description="Create the first employer account." />}

      <div className="grid gap-3">
        {rows.map((organisation) => (
          <Card key={organisation.id} className="flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{organisation.name}</p>
              <p className="text-xs text-muted">
                {organisation.sector ?? 'No sector'} · {organisation._count.users} user(s) · {organisation._count.jobs} job(s) · joined{' '}
                {formatDateTime(organisation.createdAt)}
              </p>
            </div>
            <Badge tone="neutral">{organisation.slug}</Badge>
          </Card>
        ))}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New organisation"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={create.isPending} disabled={name.trim().length < 2} onClick={() => create.mutate()}>
              Create
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Name" htmlFor="orgName">
            <Input id="orgName" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Sector" htmlFor="orgSector" hint="optional">
            <Input id="orgSector" value={sector} onChange={(e) => setSector(e.target.value)} />
          </Field>
          <Field label="Website" htmlFor="orgWebsite" hint="optional">
            <Input id="orgWebsite" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
          </Field>
          {error && <Alert tone="bad">{error}</Alert>}
        </div>
      </Modal>
    </div>
  );
}

// --- Users ------------------------------------------------------------------
interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  isActive: boolean;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  organisation: { id: string; name: string } | null;
  _count: { applications: number };
}

export function AdminUsers() {
  const queryClient = useQueryClient();
  const [role, setRole] = useState('ALL');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ fullName: '', email: '', role: 'RECRUITER', organisationId: '' });
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['admin', 'users', role, search],
    queryFn: () =>
      request<Paginated<AdminUser>>(
        `/admin/users${qs({ pageSize: 60, role: role === 'ALL' ? undefined : role, search: search || undefined })}`,
      ),
  });

  const organisations = useQuery({
    queryKey: ['admin', 'organisations', 'all'],
    queryFn: () => request<Paginated<Organisation>>(`/admin/organisations${qs({ pageSize: 100 })}`),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin'] });

  const create = useMutation({
    mutationFn: () =>
      request('/admin/users', {
        method: 'POST',
        body: {
          fullName: form.fullName,
          email: form.email,
          role: form.role,
          organisationId: form.role === 'RECRUITER' ? form.organisationId : null,
        },
      }),
    onSuccess: async () => {
      setOpen(false);
      setForm({ fullName: '', email: '', role: 'RECRUITER', organisationId: '' });
      await refresh();
    },
    onError: (err) => setError((err as Error).message),
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      request(`/admin/users/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: refresh,
    onError: (err) => setError((err as Error).message),
  });

  const rows = query.data?.data ?? [];

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Users"
        description="Accounts are created with a reset link. Deactivating a user revokes their sessions immediately."
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" /> New user
          </Button>
        }
      />

      {error && (
        <Alert tone="bad" className="mb-4">
          {error}
        </Alert>
      )}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Tabs
          value={role}
          onChange={setRole}
          tabs={[
            { value: 'ALL', label: 'All' },
            { value: 'CANDIDATE', label: 'Candidates' },
            { value: 'RECRUITER', label: 'Recruiters' },
            { value: 'ADMIN', label: 'Admins' },
          ]}
        />
        <div className="w-64">
          <Input placeholder="Search name or email" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search users" />
        </div>
      </div>

      {query.isLoading && <PageLoader />}
      {query.isError && <Alert tone="bad">{(query.error as Error).message}</Alert>}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Organisation</th>
                <th className="px-4 py-3">Verified</th>
                <th className="px-4 py-3">Last login</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {!rows.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted">
                    No users in this view.
                  </td>
                </tr>
              )}
              {rows.map((user) => (
                <tr key={user.id} className={user.isActive ? '' : 'opacity-60'}>
                  <td className="px-4 py-3">
                    <p className="font-medium">{user.fullName}</p>
                    <p className="text-xs text-muted">{user.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={ROLE_TONE[user.role] ?? 'neutral'}>{user.role.toLowerCase()}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">{user.organisation?.name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <Badge tone={user.emailVerifiedAt ? 'good' : 'warn'}>{user.emailVerifiedAt ? 'Verified' : 'Pending'}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'Never'}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Select
                        aria-label={`Change role for ${user.email}`}
                        className="w-32 text-xs"
                        value={user.role}
                        onChange={(event) => update.mutate({ id: user.id, patch: { role: event.target.value } })}
                      >
                        <option value="CANDIDATE">Candidate</option>
                        <option value="RECRUITER">Recruiter</option>
                        <option value="ADMIN">Admin</option>
                      </Select>
                      <Button
                        size="sm"
                        variant={user.isActive ? 'ghost' : 'secondary'}
                        loading={update.isPending}
                        onClick={() => update.mutate({ id: user.id, patch: { isActive: !user.isActive } })}
                      >
                        {user.isActive ? 'Deactivate' : 'Reactivate'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Create an account"
        description="The user receives an email with a link to set their own password."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={create.isPending}
              disabled={form.fullName.length < 2 || !form.email.includes('@') || (form.role === 'RECRUITER' && !form.organisationId)}
              onClick={() => create.mutate()}
            >
              Create user
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Full name" htmlFor="userName">
            <Input id="userName" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          </Field>
          <Field label="Email" htmlFor="userEmail">
            <Input id="userEmail" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Role" htmlFor="userRole">
            <Select id="userRole" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="CANDIDATE">Candidate</option>
              <option value="RECRUITER">Recruiter</option>
              <option value="ADMIN">Admin</option>
            </Select>
          </Field>
          {form.role === 'RECRUITER' && (
            <Field label="Organisation" htmlFor="userOrg">
              <Select id="userOrg" value={form.organisationId} onChange={(e) => setForm({ ...form, organisationId: e.target.value })}>
                <option value="">Select an organisation…</option>
                {(organisations.data?.data ?? []).map((organisation) => (
                  <option key={organisation.id} value={organisation.id}>
                    {organisation.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      </Modal>
    </div>
  );
}

// --- Settings ---------------------------------------------------------------
interface Settings {
  minGroupSize: number;
  threshold: number;
  counterfactualThreshold: number;
  retentionDays: number;
  blindScreeningDefault: boolean;
}

export function AdminSettings() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const query = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => request<Settings>('/admin/settings') });
  const [draft, setDraft] = useState<Settings | null>(null);

  const settings = draft ?? query.data ?? null;

  const save = useMutation({
    mutationFn: (body: Settings) => request('/admin/settings', { method: 'PUT', body }),
    onSuccess: async () => {
      setSaved(true);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
    },
    onError: (err) => setError((err as Error).message),
  });

  if (query.isLoading) return <PageLoader />;
  if (query.isError) return <Alert tone="bad">{(query.error as Error).message}</Alert>;
  if (!settings) return null;

  const set = (patch: Partial<Settings>) => {
    setSaved(false);
    setDraft({ ...settings, ...patch });
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Settings"
        description="Audit thresholds apply to new reports and live alerts without a restart."
        action={
          <Button loading={save.isPending} onClick={() => save.mutate(settings)}>
            <Check className="h-4 w-4" aria-hidden="true" /> Save settings
          </Button>
        }
      />

      {saved && (
        <Alert tone="good" className="mb-4">
          Settings saved.
        </Alert>
      )}
      {error && (
        <Alert tone="bad" className="mb-4">
          {error}
        </Alert>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Audit thresholds" subtitle="Smaller groups are suppressed to protect privacy." />
          <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
            <Field label="Minimum group size" htmlFor="minGroup">
              <Input
                id="minGroup"
                type="number"
                min={2}
                max={100}
                value={settings.minGroupSize}
                onChange={(e) => set({ minGroupSize: Number(e.target.value) })}
              />
            </Field>
            <Field label="Four-fifths threshold" htmlFor="threshold" hint="0.8 is the standard">
              <Input
                id="threshold"
                type="number"
                step="0.01"
                min={0.1}
                max={1}
                value={settings.threshold}
                onChange={(e) => set({ threshold: Number(e.target.value) })}
              />
            </Field>
            <Field label="Counterfactual delta threshold" htmlFor="cfThreshold" hint="points">
              <Input
                id="cfThreshold"
                type="number"
                min={0}
                max={50}
                value={settings.counterfactualThreshold}
                onChange={(e) => set({ counterfactualThreshold: Number(e.target.value) })}
              />
            </Field>
            <Field label="Data retention (days)" htmlFor="retention">
              <Input
                id="retention"
                type="number"
                min={30}
                max={3650}
                value={settings.retentionDays}
                onChange={(e) => set({ retentionDays: Number(e.target.value) })}
              />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Fairness defaults" />
          <div className="px-5 py-4">
            <Toggle
              checked={settings.blindScreeningDefault}
              onChange={(value) => set({ blindScreeningDefault: value })}
              label="Blind screening on by default"
              description="New jobs start with identity and university hidden from recruiters until shortlist and reveal."
            />
          </div>
        </Card>
      </div>
    </div>
  );
}

// --- Audit logs -------------------------------------------------------------
interface AuditLogRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorRole: string;
  ip: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  actor: { fullName: string; email: string } | null;
}

export function AdminLogs() {
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ['admin', 'logs', action, entityType, page],
    queryFn: () =>
      request<Paginated<AuditLogRow>>(
        `/admin/audit-logs${qs({ page, pageSize: 30, action: action || undefined, entityType: entityType || undefined })}`,
      ),
  });

  const rows = query.data?.data ?? [];

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="System logs"
        description="Append-only record of authentication, decisions, reveals, exports and administrative changes."
        action={
          <Button
            variant="secondary"
            onClick={() =>
              download(
                `/admin/audit-logs${qs({ format: 'csv', action: action || undefined, entityType: entityType || undefined })}`,
                'ise-audit-log.csv',
              )
            }
          >
            <Download className="h-4 w-4" aria-hidden="true" /> Export CSV
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="w-56">
          <Input placeholder="Filter by action" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} aria-label="Filter by action" />
        </div>
        <div className="w-56">
          <Select value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }} aria-label="Filter by entity type">
            <option value="">All entity types</option>
            {['Application', 'Job', 'User', 'Organisation', 'BiasReport', 'Interview', 'DataRequest', 'AuditLog', 'Setting', 'System'].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {query.isLoading && <PageLoader />}
      {query.isError && <Alert tone="bad">{(query.error as Error).message}</Alert>}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-sm">
            <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Entity</th>
                <th className="px-4 py-3">Metadata</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {!rows.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted">
                    No log entries for these filters.
                  </td>
                </tr>
              )}
              {rows.map((log) => (
                <tr key={log.id}>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">{formatDateTime(log.createdAt)}</td>
                  <td className="px-4 py-3 text-xs">
                    <p className="font-medium">{log.actor?.fullName ?? log.actorRole}</p>
                    <p className="text-muted">{log.actor?.email ?? log.actorRole.toLowerCase()}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone="neutral">{log.action.replace(/_/g, ' ').toLowerCase()}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <StatusBadge status={log.entityType} tone="info" />
                  </td>
                  <td className="max-w-xs px-4 py-3">
                    <code className="line-clamp-2 break-all text-[11px] text-muted">{JSON.stringify(log.metadata)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {query.data && query.data.meta.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-xs text-muted">
            <span>
              Page {query.data.meta.page} of {query.data.meta.totalPages}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                Previous
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={page >= query.data.meta.totalPages}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

// --- Data requests ----------------------------------------------------------
interface DataRequest {
  id: string;
  type: string;
  status: string;
  note: string | null;
  requestedAt: string;
  completedAt: string | null;
  user: { id: string; email: string; fullName: string; role: string };
}

export function AdminDataRequests() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('PENDING');
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['admin', 'data-requests', status],
    queryFn: () => request<Paginated<DataRequest>>(`/admin/data-requests${qs({ pageSize: 60, status: status === 'ALL' ? undefined : status })}`),
  });

  const complete = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'COMPLETE' | 'REJECT' }) =>
      request(`/admin/data-requests/${id}/complete`, { method: 'POST', body: { action } }),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err) => setError((err as Error).message),
  });

  const rows = query.data?.data ?? [];

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Data requests"
        description="Subject access and erasure requests under NDPA 2023. Erasure anonymises the person but keeps decision records for accountability."
      />

      {error && (
        <Alert tone="bad" className="mb-4">
          {error}
        </Alert>
      )}

      <div className="mb-4">
        <Tabs
          value={status}
          onChange={setStatus}
          tabs={[
            { value: 'PENDING', label: 'Pending' },
            { value: 'COMPLETED', label: 'Completed' },
            { value: 'REJECTED', label: 'Rejected' },
            { value: 'ALL', label: 'All' },
          ]}
        />
      </div>

      {query.isLoading && <PageLoader />}
      {query.isError && <Alert tone="bad">{(query.error as Error).message}</Alert>}

      {!query.isLoading && !rows.length && (
        <EmptyState
          icon={<ShieldCheck className="h-5 w-5" />}
          title="No requests in this view"
          description="Candidates raise export and erasure requests from their privacy page."
        />
      )}

      <div className="grid gap-3">
        {rows.map((dataRequest) => (
          <Card key={dataRequest.id} className="p-4">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{dataRequest.user.fullName}</p>
                  <Badge tone={dataRequest.type === 'DELETE' ? 'bad' : 'info'}>{dataRequest.type.toLowerCase()}</Badge>
                  <Badge tone={dataRequest.status === 'PENDING' ? 'warn' : dataRequest.status === 'COMPLETED' ? 'good' : 'neutral'}>
                    {dataRequest.status.toLowerCase()}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  {dataRequest.user.email} · requested {formatDateTime(dataRequest.requestedAt)}
                  {dataRequest.completedAt ? ` · handled ${formatDateTime(dataRequest.completedAt)}` : ''}
                </p>
                {dataRequest.note && <p className="mt-1 text-xs text-ink/80">{dataRequest.note}</p>}
              </div>
              {dataRequest.status === 'PENDING' && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    loading={complete.isPending}
                    onClick={() => complete.mutate({ id: dataRequest.id, action: 'COMPLETE' })}
                  >
                    {dataRequest.type === 'DELETE' ? (
                      <>
                        <Trash2 className="h-4 w-4" aria-hidden="true" /> Erase personal data
                      </>
                    ) : (
                      'Mark export complete'
                    )}
                  </Button>
                  <Button size="sm" variant="ghost" loading={complete.isPending} onClick={() => complete.mutate({ id: dataRequest.id, action: 'REJECT' })}>
                    Reject
                  </Button>
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
