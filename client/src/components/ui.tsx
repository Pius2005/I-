import {
  forwardRef,
  useEffect,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from 'lucide-react';
import { cn } from '../lib/utils';

// --- Button -----------------------------------------------------------------
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold';
type ButtonSize = 'sm' | 'md' | 'lg';

const buttonStyles: Record<ButtonVariant, string> = {
  primary: 'bg-forest-600 text-white hover:bg-forest-700 border border-transparent shadow-sm',
  secondary: 'bg-white text-forest-800 hover:bg-forest-50 border border-line',
  ghost: 'bg-transparent text-ink/80 hover:bg-forest-50 border border-transparent',
  danger: 'bg-white text-ink hover:bg-ink hover:text-white border border-ink font-semibold',
  gold: 'bg-forest-600 text-white hover:bg-forest-700 border border-transparent font-semibold',
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'text-sm px-3 py-1.5 gap-1.5',
  md: 'text-sm px-4 py-2.5 gap-2',
  lg: 'text-base px-5 py-3 gap-2',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean }) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        buttonStyles[variant],
        buttonSizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

// --- Card -------------------------------------------------------------------
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('rounded-2xl border border-line bg-white shadow-card', className)}>{children}</div>;
}

export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div>
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

// --- Badge ------------------------------------------------------------------
export type Tone = 'neutral' | 'info' | 'good' | 'warn' | 'bad';

const toneStyles: Record<Tone, string> = {
  neutral: 'bg-stone-100 text-stone-700 border-stone-200',
  info: 'bg-forest-50 text-forest-700 border-forest-200',
  good: 'bg-zinc-100 text-zinc-900 border-zinc-300 font-medium',
  warn: 'bg-stone-100 text-stone-900 border-stone-400 font-medium',
  bad: 'bg-ink text-white border-ink font-medium',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        toneStyles[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status, tone }: { status: string; tone: Tone }) {
  const label = status
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
  return <Badge tone={tone}>{label}</Badge>;
}

// --- Form fields ------------------------------------------------------------
export function Label({ htmlFor, children, hint }: { htmlFor?: string; children: ReactNode; hint?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-ink">
      {children}
      {hint && <span className="ml-1 font-normal text-muted">({hint})</span>}
    </label>
  );
}

const fieldBase =
  'w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink placeholder:text-muted/70 transition focus:border-forest-500';

// React Hook Form registers fields through a ref, so these must forward it.
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(fieldBase, className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} className={cn(fieldBase, 'min-h-24', className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <select ref={ref} className={cn(fieldBase, 'pr-8', className)} {...props}>
      {children}
    </select>
  );
});

export function FormError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p className="mt-1.5 text-xs font-semibold text-ink" role="alert">
      {children}
    </p>
  );
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label: ReactNode;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor} hint={hint}>
        {label}
      </Label>
      {children}
      <FormError>{error}</FormError>
    </div>
  );
}

// React Hook Form registers fields through a ref, so the checkbox must forward it too:
// without the ref the field is never registered and its changes are dropped.
export const Checkbox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }>(
  function Checkbox({ label, ...props }, ref) {
    const id = useId();
    return (
      <div className="flex items-start gap-2.5">
        <input
          ref={ref}
          id={props.id ?? id}
          type="checkbox"
          className="mt-1 h-4 w-4 rounded border-line text-forest-600 focus:ring-forest-500"
          {...props}
        />
        <label htmlFor={props.id ?? id} className="text-sm leading-relaxed text-ink/90">
          {label}
        </label>
      </div>
    );
  },
);

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-ink">{label}</p>
        {description && <p className="mt-0.5 text-xs leading-relaxed text-muted">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50',
          checked ? 'bg-forest-600' : 'bg-stone-300',
        )}
      >
        <span
          className={cn(
            'inline-block h-4 w-4 transform rounded-full bg-white shadow transition',
            checked ? 'translate-x-6' : 'translate-x-1',
          )}
        />
      </button>
    </div>
  );
}

// --- Feedback ---------------------------------------------------------------
export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const icons = { neutral: Info, info: Info, good: CheckCircle2, warn: AlertTriangle, bad: AlertTriangle };
  const Icon = icons[tone];
  const styles: Record<Tone, string> = {
    neutral: 'border-stone-200 bg-stone-50 text-stone-800',
    info: 'border-forest-200 bg-forest-50 text-forest-900',
    good: 'border-zinc-300 bg-zinc-100 text-zinc-900',
    warn: 'border-stone-300 border-l-4 border-l-stone-900 bg-stone-50 text-stone-900',
    bad: 'border-stone-300 border-l-4 border-l-ink bg-white text-ink',
  };
  return (
    <div className={cn('flex gap-3 rounded-xl border p-4 text-sm', styles[tone], className)} role={tone === 'bad' ? 'alert' : 'status'}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title ? 'mt-1' : '', 'leading-relaxed')}>{children}</div>}
      </div>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-forest-600', className)} aria-label="Loading" />;
}

export function PageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-muted" role="status">
      <Spinner />
      {label}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-stone-200/70', className)} aria-hidden="true" />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-white/60 px-6 py-12 text-center">
      {icon && <div className="mb-3 rounded-full bg-forest-50 p-3 text-forest-700">{icon}</div>}
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'We could not load this. Please try again.';
  return (
    <div className="rounded-2xl border border-stone-300 bg-stone-50 p-5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-ink" aria-hidden="true" />
        <div className="flex-1">
          <p className="font-semibold text-ink">Something went wrong</p>
          <p className="mt-1 text-sm text-ink/80">{message}</p>
          {onRetry && (
            <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Layout helpers ---------------------------------------------------------
export function PageHeader({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'info',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: Tone;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-ink">{value}</p>
          {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
        </div>
        {icon && <div className={cn('rounded-xl border p-2', toneStyles[tone])}>{icon}</div>}
      </div>
    </Card>
  );
}

export function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav className="mt-4 flex items-center justify-between gap-3 text-sm" aria-label="Pagination">
      <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Previous
      </Button>
      <span className="text-muted">
        Page {page} of {totalPages}
      </span>
      <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        Next
      </Button>
    </nav>
  );
}

export function Tabs({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: string; label: string; count?: number }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-white p-1" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          role="tab"
          aria-selected={value === tab.value}
          onClick={() => onChange(tab.value)}
          className={cn(
            'whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition',
            value === tab.value ? 'bg-forest-600 text-white' : 'text-ink/70 hover:bg-forest-50',
          )}
        >
          {tab.label}
          {typeof tab.count === 'number' && (
            <span className={cn('ml-1.5 rounded-full px-1.5 py-0.5 text-xs', value === tab.value ? 'bg-white/20' : 'bg-stone-100')}>
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// --- Modal ------------------------------------------------------------------
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl',
          wide ? 'sm:max-w-3xl' : 'sm:max-w-lg',
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-stone-100" aria-label="Close dialog">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}

// --- Data visual bits -------------------------------------------------------
export function ScoreRing({ score, size = 84 }: { score: number | null | undefined; size?: number }) {
  const value = score ?? 0;
  const radius = (size - 10) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;
  const color = score === null || score === undefined ? '#d4d4d8' : value >= 70 ? '#09090b' : value >= 50 ? '#a1a1aa' : '#a1a1aa';
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e4e4e7" strokeWidth={8} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute text-center">
        <span className="text-xl font-semibold tabular-nums">{score ?? '—'}</span>
        <span className="block text-[10px] uppercase tracking-wide text-muted">/ 100</span>
      </div>
    </div>
  );
}

export function ScoreBar({ value, label }: { value: number; label?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const color = value >= 0.8 ? 'bg-forest-600' : value >= 0.5 ? 'bg-gold-500' : 'bg-amber-700';
  return (
    <div>
      {label && <div className="mb-1 flex justify-between text-xs text-muted"><span>{label}</span><span>{Math.round(pct)}%</span></div>}
      <div className="h-2 w-full overflow-hidden rounded-full bg-stone-200" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Avatar({ name, size = 'md' }: { name?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-12 w-12 text-base' };
  const label = name
    ? name
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join('')
    : 'IS';
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center rounded-full bg-forest-100 font-semibold text-forest-800', sizes[size])} aria-hidden="true">
      {label}
    </span>
  );
}
