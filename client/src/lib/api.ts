const TOKEN_KEY = 'ise.access';
const REFRESH_LOCK = { running: false, waiters: [] as (() => void)[] };

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage can be unavailable in private mode */
  }
}

async function refreshAccessToken(): Promise<string | null> {
  const res = await fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-Ise-Request': 'web' },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { data?: { accessToken?: string } };
  return body.data?.accessToken ?? null;
}

async function ensureRefreshed(): Promise<string | null> {
  if (REFRESH_LOCK.running) {
    await new Promise<void>((resolve) => REFRESH_LOCK.waiters.push(resolve));
    return getToken();
  }
  REFRESH_LOCK.running = true;
  try {
    const token = await refreshAccessToken();
    setToken(token);
    return token;
  } finally {
    REFRESH_LOCK.running = false;
    REFRESH_LOCK.waiters.splice(0).forEach((resolve) => resolve());
  }
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  retryOnAuth?: boolean;
}

export async function rawRequest(path: string, options: RequestOptions = {}): Promise<Response> {
  const { body, retryOnAuth = true, headers, ...rest } = options;
  const token = getToken();
  const isForm = body instanceof FormData;
  const response = await fetch(`/api${path}`, {
    ...rest,
    credentials: 'include',
    headers: {
      ...(isForm ? {} : body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers as Record<string, string>),
    },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });

  if (response.status === 401 && retryOnAuth && !path.startsWith('/auth/')) {
    const refreshed = await ensureRefreshed();
    if (refreshed) {
      return rawRequest(path, { ...options, retryOnAuth: false });
    }
    setToken(null);
  }
  return response;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await rawRequest(path, options);
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    if (!response.ok) {
      throw new ApiError(response.status, 'ERROR', 'The server returned an unexpected response.');
    }
    return (await response.text()) as unknown as T;
  }
  const body = (await response.json()) as { data?: T; meta?: unknown; error?: { code: string; message: string; details?: unknown } };
  if (!response.ok) {
    throw new ApiError(
      response.status,
      body.error?.code ?? 'ERROR',
      body.error?.message ?? 'Something went wrong',
      body.error?.details,
    );
  }
  if ('meta' in body && body.meta !== undefined) {
    return body as unknown as T;
  }
  return body.data as T;
}

export async function download(path: string, filename: string) {
  const response = await rawRequest(path, { retryOnAuth: true });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(
      response.status,
      (body as { error?: { code?: string } }).error?.code ?? 'ERROR',
      (body as { error?: { message?: string } }).error?.message ?? 'Download failed',
    );
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export interface Paginated<T> {
  data: T[];
  meta: { total: number; page: number; pageSize: number; totalPages: number; hasMore: boolean; unread?: number };
}

export function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const str = search.toString();
  return str ? `?${str}` : '';
}
