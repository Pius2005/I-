import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  Briefcase,
  Building2,
  CalendarClock,
  ChartNoAxesColumn,
  FileSearch,
  Gauge,
  LayoutDashboard,
  LogOut,
  Menu,
  ScrollText,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  User,
  Users,
  X,
} from 'lucide-react';
import { useAuth, type Role } from '../lib/auth';
import { request, qs } from '../lib/api';
import { cn, formatDateTime } from '../lib/utils';
import { Alert, Avatar, Button, Spinner } from './ui';

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
  type: string;
}

const navByRole: Record<Role, { to: string; label: string; icon: typeof Gauge; end?: boolean }[]> = {
  CANDIDATE: [
    { to: '/candidate', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/candidate/jobs', label: 'Find jobs', icon: Briefcase },
    { to: '/candidate/applications', label: 'My applications', icon: FileSearch },
    { to: '/candidate/profile', label: 'Profile & privacy', icon: User },
  ],
  RECRUITER: [
    { to: '/recruiter', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/recruiter/jobs', label: 'Jobs', icon: Briefcase },
    { to: '/recruiter/interviews', label: 'Interviews', icon: CalendarClock },
    { to: '/recruiter/audit', label: 'Bias audit', icon: ShieldCheck },
  ],
  ADMIN: [
    { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/admin/organisations', label: 'Organisations', icon: Building2 },
    { to: '/admin/users', label: 'Users', icon: Users },
    { to: '/admin/audit', label: 'Bias audit', icon: ShieldCheck },
    { to: '/admin/logs', label: 'System logs', icon: ScrollText },
    { to: '/admin/settings', label: 'Settings', icon: SlidersHorizontal },
  ],
};

function Brand({ compact }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex items-center" aria-label="Iṣẹ́ home">
      <span className="font-display text-xl font-bold tracking-tight text-ink">
        Iṣẹ́{!compact && <span className="ml-2 hidden text-xs font-normal text-muted sm:inline">fair graduate hiring</span>}
      </span>
    </Link>
  );
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { data, refetch } = useQuery({
    queryKey: ['notifications', 'recent'],
    queryFn: () => request<{ data: NotificationItem[]; meta: { unread: number } }>(`/notifications${qs({ pageSize: 6 })}`),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const unread = data?.meta?.unread ?? 0;

  const markAll = async () => {
    await request('/notifications/read-all', { method: 'POST' });
    await queryClient.invalidateQueries({ queryKey: ['notifications'] });
    await refetch();
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-lg p-2 text-ink/70 hover:bg-forest-50"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-forest-600 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 animate-fade-in overflow-hidden rounded-xl border border-line bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-sm font-semibold">Notifications</p>
            {unread > 0 && (
              <button onClick={markAll} className="text-xs font-medium text-forest-700 hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {!data?.data?.length && <p className="px-4 py-6 text-center text-sm text-muted">You are all caught up.</p>}
            {data?.data?.map((item) => (
              <button
                key={item.id}
                onClick={async () => {
                  await request(`/notifications/${item.id}/read`, { method: 'POST' }).catch(() => undefined);
                  await queryClient.invalidateQueries({ queryKey: ['notifications'] });
                }}
                className={cn('block w-full border-b border-line/60 px-4 py-3 text-left hover:bg-forest-50/50', !item.readAt && 'bg-forest-50/40')}
              >
                <p className="text-sm font-medium">{item.title}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted">{item.body}</p>
                <p className="mt-1 text-[11px] text-muted/80">{formatDateTime(item.createdAt)}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const nav = user ? navByRole[user.role] : [];

  useEffect(() => setMobileOpen(false), [location.pathname]);

  if (!user) return <Outlet />;

  const navLinks = (
    <nav className="space-y-1" aria-label="Main navigation">
      {nav.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
              isActive ? 'bg-forest-600 text-white shadow-sm' : 'text-ink/75 hover:bg-forest-50 hover:text-forest-800',
            )
          }
        >
          <item.icon className="h-4.5 w-4.5" aria-hidden="true" />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-cream">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      {/* Mobile header */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-cream/95 px-4 py-3 backdrop-blur lg:hidden">
        <Brand />
        <div className="flex items-center gap-1">
          <NotificationBell />
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-2 text-ink/70 hover:bg-forest-50"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setMobileOpen(false)} aria-hidden="true" />
          <div className="absolute left-0 top-0 h-full w-72 max-w-[85%] overflow-y-auto bg-cream p-4 shadow-xl">
            <div className="mb-6 flex items-center justify-between">
              <Brand />
              <button onClick={() => setMobileOpen(false)} className="rounded-lg p-2 hover:bg-forest-50" aria-label="Close menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            {navLinks}
            <div className="mt-6 border-t border-line pt-4">
              <p className="px-3 text-xs uppercase tracking-wide text-muted">{user.organisation?.name ?? user.role.toLowerCase()}</p>
              <p className="mt-1 px-3 text-sm font-medium">{user.fullName}</p>
              <button
                onClick={async () => {
                  await logout();
                  navigate('/');
                }}
                className="mt-3 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink/70 hover:bg-forest-50"
              >
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto flex max-w-[1400px] gap-6 px-0 lg:px-6">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line/60 py-6 lg:flex">
          <div className="mb-8 px-3">
            <Brand />
          </div>
          {navLinks}
          <div className="mt-auto border-t border-line pt-4">
            <div className="flex items-center gap-3 px-3 py-2">
              <Avatar name={user.fullName} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{user.fullName}</p>
                <p className="truncate text-xs text-muted">{user.organisation?.name ?? user.role.toLowerCase()}</p>
              </div>
            </div>
            <button
              onClick={async () => {
                await logout();
                navigate('/');
              }}
              className="mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink/70 hover:bg-forest-50"
            >
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>
        </aside>

        <div className="min-w-0 flex-1 pb-16">
          <div className="sticky top-0 z-20 hidden items-center justify-end gap-3 border-b border-line/60 bg-cream/95 px-1 py-3 backdrop-blur lg:flex">
            <NotificationBell />
            <span className="text-sm text-muted">{user.email}</span>
          </div>
          <main id="main" className="px-4 py-6 sm:px-6 lg:px-2">
            {!user.emailVerified && (
              <Alert tone="warn" title="Verify your email" className="mb-5">
                Some actions, such as applying or posting a job, need a verified email. Check your inbox for the verification link.
              </Alert>
            )}
            <Outlet />
          </main>
          <footer className="mt-12 border-t border-line px-4 py-6 text-xs leading-relaxed text-muted sm:px-6">
            <p className="flex items-center gap-2 font-medium text-forest-800">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" /> AI assists. People decide.
            </p>
            <p className="mt-1 max-w-3xl">
              Iṣẹ́ never rejects a candidate automatically. Scores are recommendations with a written explanation, and every
              recruitment decision is recorded with a human actor and reason. Statistical bias flags indicate possible bias and
              require human investigation.
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
}

export function PublicShell() {
  return (
    <div className="min-h-screen bg-cream">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-cream/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Brand />
          <nav className="flex items-center gap-1 text-sm sm:gap-3" aria-label="Public navigation">
            <Link to="/privacy" className="hidden rounded-lg px-3 py-2 text-ink/70 hover:bg-forest-50 sm:block">
              Privacy
            </Link>
            <Link to="/ai-use" className="hidden rounded-lg px-3 py-2 text-ink/70 hover:bg-forest-50 sm:block">
              AI &amp; fairness
            </Link>
            <Link to="/login" className="rounded-lg px-3 py-2 font-medium text-forest-800 hover:bg-forest-50">
              Sign in
            </Link>
            <Link
              to="/register"
              className="rounded-lg bg-forest-600 px-4 py-2 font-medium text-white hover:bg-forest-700"
            >
              Create account
            </Link>
          </nav>
        </div>
      </header>
      <main id="main">
        <Outlet />
      </main>
      <footer className="border-t border-line bg-white/60">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 text-sm sm:grid-cols-3 sm:px-6">
          <div>
            <p className="font-display text-lg font-semibold text-forest-800">Iṣẹ́</p>
            <p className="mt-1 text-muted">Work, fairly matched. Built for Nigerian graduate hiring.</p>
          </div>
          <div className="space-y-1 text-muted">
            <p className="font-medium text-ink">Trust</p>
            <Link to="/privacy" className="block hover:text-forest-700">Privacy notice (NDPA 2023)</Link>
            <Link to="/ai-use" className="block hover:text-forest-700">AI use &amp; fairness statement</Link>
          </div>
          <div className="text-muted">
            <p className="font-medium text-ink">A note on compliance</p>
            <p className="mt-1 text-xs leading-relaxed">
              Iṣẹ́ is built with NDPA 2023 principles in mind, but legal compliance must be reviewed by a qualified Nigerian
              data-protection professional before production use.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
