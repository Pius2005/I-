export function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

export function formatDate(value: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = {}) {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', ...opts }).format(date);
}

export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Lagos',
  }).format(date);
}

export function relativeTime(value: string | Date) {
  const date = typeof value === 'string' ? new Date(value) : value;
  const diff = date.getTime() - Date.now();
  const minutes = Math.round(diff / 60_000);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour');
  return formatter.format(Math.round(hours / 24), 'day');
}

export const STAGES = ['APPLIED', 'SCREENED', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<string, string> = {
  APPLIED: 'Applied',
  SCREENED: 'Screened',
  SHORTLISTED: 'Shortlisted',
  INTERVIEW: 'Interview',
  OFFER: 'Offer',
  HIRED: 'Hired',
  REJECTED: 'Rejected',
  DRAFT: 'Draft',
  OPEN: 'Open',
  CLOSED: 'Closed',
  SCHEDULED: 'Scheduled',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No show',
  PENDING: 'Pending',
  PROCESSING: 'Processing',
  FAILED: 'Failed',
  NONE: 'Not uploaded',
};

export const STAGE_TONE: Record<string, 'neutral' | 'info' | 'good' | 'warn' | 'bad'> = {
  APPLIED: 'neutral',
  SCREENED: 'info',
  SHORTLISTED: 'good',
  INTERVIEW: 'good',
  OFFER: 'good',
  HIRED: 'good',
  REJECTED: 'bad',
  OPEN: 'good',
  DRAFT: 'neutral',
  CLOSED: 'neutral',
  FAILED: 'bad',
  PENDING: 'warn',
  PROCESSING: 'warn',
  COMPLETED: 'good',
  SCHEDULED: 'good',
  CANCELLED: 'bad',
};

export function scoreTone(score: number | null | undefined) {
  if (score === null || score === undefined) return 'neutral' as const;
  if (score >= 70) return 'good' as const;
  if (score >= 50) return 'warn' as const;
  return 'bad' as const;
}

export function percent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

export function initials(name?: string | null) {
  if (!name) return 'IS';
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export const GENDER_OPTIONS = [
  { value: 'FEMALE', label: 'Female' },
  { value: 'MALE', label: 'Male' },
  { value: 'NON_BINARY', label: 'Non-binary' },
  { value: 'PREFER_NOT_TO_SAY', label: 'Prefer not to say' },
];

export const AGE_BANDS = ['18-24', '25-29', '30-34', '35-39', '40+', 'PREFER_NOT_TO_SAY'];

export const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta',
  'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT (Abuja)', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina',
  'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers',
  'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
];
