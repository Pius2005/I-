import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Building2, CheckCircle2, Eye, EyeOff, ShieldCheck, UserRound } from 'lucide-react';
import { useAuth, homeForRole } from '../lib/auth';
import { request } from '../lib/api';
import { Alert, Button, Card, Checkbox, Field, Input } from '../components/ui';
import { cn } from '../lib/utils';

function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-5xl items-center px-4 py-12 sm:px-6">
      <div className="grid w-full gap-10 lg:grid-cols-2 lg:items-center">
        <div className="hidden lg:block">
          <p className="text-sm font-semibold uppercase tracking-widest text-gold-600">Iṣẹ́</p>
          <h2 className="mt-3 text-4xl font-semibold leading-tight">
            Fair graduate hiring starts with <span className="text-forest-700">evidence</span>, not a hunch.
          </h2>
          <ul className="mt-6 space-y-3 text-sm text-muted">
            {[
              'Explainable scores against job-related criteria',
              'Blind screening on by default',
              'A bias audit you can export and defend',
              'Humans make every final decision',
            ].map((item) => (
              <li key={item} className="flex gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-forest-600" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-8 rounded-xl border border-line bg-white/70 p-4 text-xs leading-relaxed text-muted">
            <ShieldCheck className="mb-1 inline h-3.5 w-3.5 text-forest-600" aria-hidden="true" /> Demographic self-declaration is
            voluntary, encrypted and never used to score you.
          </p>
        </div>
        <Card className="p-6 sm:p-8">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </Card>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const form = useForm<{ email: string; password: string }>({
    resolver: zodResolver(z.object({ email: z.string().email('Enter a valid email'), password: z.string().min(1, 'Enter your password') })),
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const user = await login(values.email, values.password);
      const from = params.get('from');
      navigate(from && from.startsWith('/') ? from : homeForRole(user.role), { replace: true });
    } catch (err) {
      setError((err as Error).message);
    }
  });

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your Iṣẹ́ account.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert tone="bad">{error}</Alert>}
        <Field label="Email address" htmlFor="email" error={form.formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
        </Field>
        <Field label="Password" htmlFor="password" error={form.formState.errors.password?.message}>
          <div className="relative">
            <Input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" {...form.register('password')} />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted hover:text-ink"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>
        <div className="flex items-center justify-between text-sm">
          <Link to="/forgot-password" className="font-medium text-forest-700 hover:underline">
            Forgot password?
          </Link>
          <Link to="/register" className="text-muted hover:text-forest-700">
            Create account
          </Link>
        </div>
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          Sign in
        </Button>
        <p className="text-center text-xs text-muted">
          By signing in you accept our{' '}
          <Link to="/privacy" className="underline">privacy notice</Link> and the{' '}
          <Link to="/ai-use" className="underline">AI-use statement</Link>.
        </p>
      </form>
    </AuthLayout>
  );
}

const registerSchema = z
  .object({
    fullName: z.string().min(2, 'Enter your full name').max(120),
    email: z.string().email('Enter a valid email'),
    password: z
      .string()
      .min(10, 'Use at least 10 characters')
      .regex(/[a-zA-Z]/, 'Include a letter')
      .regex(/\d/, 'Include a number'),
    phone: z.string().max(30).optional(),
    role: z.enum(['CANDIDATE', 'RECRUITER']),
    organisationName: z.string().max(160).optional(),
    sector: z.string().max(80).optional(),
    acceptedAiNotice: z.literal(true),
  })
  .superRefine((values, ctx) => {
    if (values.role === 'RECRUITER' && (!values.organisationName || values.organisationName.length < 2)) {
      ctx.addIssue({ code: 'custom', path: ['organisationName'], message: 'Tell us the organisation you recruit for' });
    }
  });

export function RegisterPage() {
  const { register: registerUser } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      role: params.get('role') === 'candidate' ? 'CANDIDATE' : 'RECRUITER',
      acceptedAiNotice: undefined as unknown as true,
    },
  });
  const role = form.watch('role');

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await registerUser({
        fullName: values.fullName,
        email: values.email,
        password: values.password,
        phone: values.phone,
        role: values.role,
        organisationName: values.organisationName,
        sector: values.sector,
        acceptedAiNotice: true,
      });
      navigate(homeForRole(values.role), { replace: true });
    } catch (err) {
      setError((err as Error).message);
    }
  });

  return (
    <AuthLayout title="Create your account" subtitle="Recruit fairly, or find work on evidence.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert tone="bad">{error}</Alert>}
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Account type">
          {[
            { value: 'CANDIDATE', label: 'I am looking for work', icon: UserRound },
            { value: 'RECRUITER', label: 'I am hiring', icon: Building2 },
          ].map((option) => (
            <button
              type="button"
              key={option.value}
              role="radio"
              aria-checked={role === option.value}
              onClick={() => form.setValue('role', option.value as 'CANDIDATE' | 'RECRUITER')}
              className={cn(
                'flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left text-sm transition',
                role === option.value ? 'border-forest-600 bg-forest-50 text-forest-900' : 'border-line bg-white hover:border-forest-300',
              )}
            >
              <option.icon className="h-5 w-5" aria-hidden="true" />
              <span className="font-medium">{option.label}</span>
            </button>
          ))}
        </div>

        <Field label="Full name" htmlFor="fullName" error={form.formState.errors.fullName?.message}>
          <Input id="fullName" autoComplete="name" {...form.register('fullName')} />
        </Field>
        <Field label="Email address" htmlFor="email" error={form.formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Password" htmlFor="password" hint="10+ chars" error={form.formState.errors.password?.message}>
            <Input id="password" type="password" autoComplete="new-password" {...form.register('password')} />
          </Field>
          <Field label="Phone" htmlFor="phone" hint="optional" error={form.formState.errors.phone?.message}>
            <Input id="phone" inputMode="tel" autoComplete="tel" {...form.register('phone')} />
          </Field>
        </div>

        {role === 'RECRUITER' && (
          <div className="grid gap-4 rounded-xl border border-line bg-stone-50/70 p-3 sm:grid-cols-2">
            <Field label="Organisation" htmlFor="organisationName" error={form.formState.errors.organisationName?.message}>
              <Input id="organisationName" {...form.register('organisationName')} />
            </Field>
            <Field label="Sector" htmlFor="sector" hint="optional">
              <Input id="sector" {...form.register('sector')} />
            </Field>
          </div>
        )}

        <div>
          <Checkbox
            label={
              <span>
                I understand that AI assists screening, that a human always makes the final decision, and I accept the{' '}
                <Link to="/ai-use" className="font-medium text-forest-700 underline" target="_blank">
                  AI-use and fairness statement
                </Link>{' '}
                and{' '}
                <Link to="/privacy" className="font-medium text-forest-700 underline" target="_blank">
                  privacy notice
                </Link>
                .
              </span>
            }
            {...form.register('acceptedAiNotice')}
          />
          {form.formState.errors.acceptedAiNotice && (
            <p className="mt-1.5 text-xs font-medium text-red-700" role="alert">
              You must accept the AI-use notice to continue.
            </p>
          )}
        </div>

        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          Create account
        </Button>
        <p className="text-center text-xs text-muted">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-forest-700 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<{ email: string }>({ resolver: zodResolver(z.object({ email: z.string().email('Enter a valid email') })) });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await request('/auth/forgot-password', { method: 'POST', body: values, retryOnAuth: false });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    }
  });

  return (
    <AuthLayout title="Reset your password" subtitle="We will email you a secure, one-hour link.">
      {sent ? (
        <Alert tone="good" title="Check your inbox">
          If that email is registered, a reset link is on its way. The link expires in one hour.
        </Alert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && <Alert tone="bad">{error}</Alert>}
          <Field label="Email address" htmlFor="email" error={form.formState.errors.email?.message}>
            <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
          </Field>
          <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
            Send reset link
          </Button>
        </form>
      )}
      <Link to="/login" className="mt-4 inline-flex items-center gap-1.5 text-sm text-forest-700 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to sign in
      </Link>
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const form = useForm<{ password: string; confirm: string }>({
    resolver: zodResolver(
      z
        .object({
          password: z.string().min(10, 'Use at least 10 characters').regex(/[a-zA-Z]/, 'Include a letter').regex(/\d/, 'Include a number'),
          confirm: z.string(),
        })
        .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' }),
    ),
  });

  if (!token) {
    return (
      <AuthLayout title="Reset link missing">
        <Alert tone="bad">This page needs a reset token. Request a new link from the sign-in page.</Alert>
        <Link to="/forgot-password" className="mt-4 inline-block text-sm font-medium text-forest-700 hover:underline">
          Request a new link
        </Link>
      </AuthLayout>
    );
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await request('/auth/reset-password', { method: 'POST', body: { token, password: values.password }, retryOnAuth: false });
      setDone(true);
      setTimeout(() => navigate('/login'), 2200);
    } catch (err) {
      setError((err as Error).message);
    }
  });

  return (
    <AuthLayout title="Choose a new password" subtitle="Resetting signs you out of every device.">
      {done ? (
        <Alert tone="good" title="Password changed">
          You can now sign in with your new password.
        </Alert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && <Alert tone="bad">{error}</Alert>}
          <Field label="New password" htmlFor="password" error={form.formState.errors.password?.message}>
            <Input id="password" type="password" autoComplete="new-password" {...form.register('password')} />
          </Field>
          <Field label="Confirm password" htmlFor="confirm" error={form.formState.errors.confirm?.message}>
            <Input id="confirm" type="password" autoComplete="new-password" {...form.register('confirm')} />
          </Field>
          <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
            Update password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { reload } = useAuth();
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const token = params.get('token');

  const verify = async () => {
    if (!token) return;
    setState('working');
    try {
      const data = await request<{ accessToken?: string; user?: unknown }>('/auth/verify-email', {
        method: 'POST',
        body: { token },
        retryOnAuth: false,
      });
      if (data?.accessToken) {
        localStorage.setItem('ise.access', data.accessToken);
        await reload();
      }
      setState('done');
      setTimeout(() => navigate('/login'), 2500);
    } catch (err) {
      setMessage((err as Error).message);
      setState('error');
    }
  };

  return (
    <AuthLayout title="Verify your email" subtitle="One quick step to activate your account.">
      {!token ? (
        <Alert tone="warn">This page needs a verification token from your email.</Alert>
      ) : state === 'done' ? (
        <Alert tone="good" title="Email verified">
          You are all set. Redirecting you to sign in…
        </Alert>
      ) : (
        <div className="space-y-4">
          {state === 'error' && <Alert tone="bad">{message}</Alert>}
          <p className="text-sm text-muted">
            We will confirm the token in your link and activate your account. If it has expired, sign in and request a new one.
          </p>
          <Button onClick={verify} loading={state === 'working'} className="w-full">
            Verify my email
          </Button>
        </div>
      )}
    </AuthLayout>
  );
}

export function NotFoundPage() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-4 text-center">
      <p className="font-display text-6xl font-semibold text-forest-700">404</p>
      <h1 className="mt-3 text-2xl font-semibold">This page could not be found</h1>
      <p className="mt-2 text-sm text-muted">The link may be old, or you may not have access to that area.</p>
      <Link to="/" className="mt-6 rounded-xl bg-forest-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-forest-700">
        Back home
      </Link>
    </div>
  );
}

export function RequireTokenHint() {
  const { token } = useParams();
  return <p>{token}</p>;
}
