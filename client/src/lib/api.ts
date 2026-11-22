import { ConvexHttpClient } from 'convex/browser';
import { anyApi, makeFunctionReference } from 'convex/server';

/**
 * The app talks to Convex directly. `request()` keeps the call shape the pages
 * already use (path + method + body) and maps each route onto a Convex query,
 * mutation or action, so no page needed rewriting.
 */

const TOKEN_KEY = 'ise.access';
const api = anyApi as any;

const convexUrl = (import.meta.env.VITE_CONVEX_URL as string | undefined) ?? '';
const client = new ConvexHttpClient(convexUrl || 'http://127.0.0.1:3210');

/** `module.function` → the `module:function` reference Convex expects. */
function ref<T extends 'query' | 'mutation' | 'action'>(kind: T, path: string) {
  return makeFunctionReference<T, any, any>(path.replace('.', ':'));
}

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

function token(): string {
  return getToken() ?? '';
}

function parseError(error: unknown): never {
  const raw = error instanceof Error ? error.message : String(error);
  // ConvexError payloads arrive as a JSON string.
  const start = raw.indexOf('{');
  if (start !== -1) {
    try {
      const parsed = JSON.parse(raw.slice(start)) as { code?: string; message?: string; details?: unknown };
      if (parsed.message) {
        const status =
          parsed.code === 'UNAUTHORIZED' ? 401 : parsed.code === 'FORBIDDEN' ? 403 : parsed.code === 'NOT_FOUND' ? 404 : 400;
        throw new ApiError(status, parsed.code ?? 'ERROR', parsed.message, parsed.details);
      }
    } catch (parseFailure) {
      if (parseFailure instanceof ApiError) throw parseFailure;
    }
  }
  throw new ApiError(500, 'ERROR', raw || 'Something went wrong');
}

async function query(path: string, args: Record<string, unknown>): Promise<any> {
  try {
    return await client.query(ref('query', path), args as never);
  } catch (error) {
    parseError(error);
  }
}

async function mutation(path: string, args: Record<string, unknown>): Promise<any> {
  try {
    return await client.mutation(ref('mutation', path), args as never);
  } catch (error) {
    parseError(error);
  }
}

async function action(path: string, args: Record<string, unknown>): Promise<any> {
  try {
    return await client.action(ref('action', path), args as never);
  } catch (error) {
    parseError(error);
  }
}

function search(query: unknown): Record<string, string> {
  return query && typeof query === 'object' ? (query as Record<string, string>) : {};
}

function num(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function dateMs(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const ms = new Date(String(value)).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

function bool(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  return value === 'true';
}

async function uploadCv(file: File): Promise<string> {
  const url = await mutation('files.generateUploadUrl', { token: token() });
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
  if (!response.ok) throw new ApiError(500, 'UPLOAD_FAILED', 'Your CV could not be uploaded. Please try again.');
  const body = (await response.json()) as { storageId: string };
  return body.storageId;
}

function downloadBlob(content: BlobPart, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ---------------------------------------------------------------------------
// Route table
// ---------------------------------------------------------------------------

async function dispatch(path: string, method: string, body: any, q: Record<string, string>): Promise<any> {
  // --- auth -----------------------------------------------------------------
  if (path === '/auth/register' && method === 'POST') return action('auth.register', body);
  if (path === '/auth/login' && method === 'POST') return action('auth.login', body);
  if (path === '/auth/logout' && method === 'POST') return mutation('auth.logout', { token: token() });
  if (path === '/auth/me' && method === 'GET') return query('auth.me', { token: token() });
  if (path === '/auth/me' && method === 'PATCH') return mutation('auth.updateMe', { token: token(), ...body });
  if (path === '/auth/verify-email' && method === 'POST') return mutation('auth.verifyEmail', { token: body.token });
  if (path === '/auth/resend-verification' && method === 'POST') return mutation('auth.resendVerification', { token: token() });
  if (path === '/auth/forgot-password' && method === 'POST') return mutation('auth.forgotPassword', body);
  if (path === '/auth/reset-password' && method === 'POST') return action('auth.resetPassword', body);
  if (path === '/auth/sessions' && method === 'GET') return query('auth.sessions', { token: token() });
  const sessionMatch = path.match(/^\/auth\/sessions\/([^/]+)$/);
  if (sessionMatch && method === 'DELETE') return mutation('auth.revokeSession', { token: token(), id: sessionMatch[1] });

  // --- public ---------------------------------------------------------------
  if (path === '/public/meta') return query('public.meta', {});
  if (path === '/public/jobs') {
    return query('public.jobs', {
      page: num(q.page),
      pageSize: num(q.pageSize),
      search: q.search || undefined,
      location: q.location || undefined,
      type: q.type || undefined,
    });
  }
  if (path === '/public/privacy') return query('public.privacy', {});
  const publicJobMatch = path.match(/^\/public\/jobs\/([^/]+)$/);
  if (publicJobMatch) {
    const job = await query('public.jobBySlug', { slug: decodeURIComponent(publicJobMatch[1]) });
    if (!job) throw new ApiError(404, 'NOT_FOUND', 'That job could not be found.');
    return job;
  }

  // --- candidate ------------------------------------------------------------
  if (path === '/candidate/profile' && method === 'GET') return query('candidate.profile', { token: token() });
  if (path === '/candidate/profile' && method === 'PUT') return mutation('candidate.updateProfile', { token: token(), ...body });
  if (path === '/candidate/demographics' && method === 'GET') return action('secure.getDemographics', { token: token() });
  if (path === '/candidate/demographics' && method === 'PUT') {
    return action('secure.setDemographics', { token: token(), payload: body });
  }
  if (path === '/candidate/demographics' && method === 'DELETE') return action('secure.withdrawDemographics', { token: token() });
  if (path === '/candidate/consent' && method === 'GET') return query('candidate.consent', { token: token() });
  if (path === '/candidate/consent' && method === 'POST') return mutation('candidate.grantConsent', { token: token(), purpose: body.purpose });
  const consentMatch = path.match(/^\/candidate\/consent\/([^/]+)$/);
  if (consentMatch && method === 'DELETE') return mutation('candidate.withdrawConsent', { token: token(), id: consentMatch[1] });
  if (path === '/candidate/data-requests' && method === 'GET') return query('candidate.dataRequests', { token: token() });
  if (path === '/candidate/data-requests' && method === 'POST') {
    if (body?.type === 'EXPORT') return action('secure.exportData', { token: token() });
    return mutation('candidate.requestDeletion', { token: token() });
  }
  if (path === '/candidate/dashboard') return query('candidate.dashboard', { token: token() });
  if (path === '/candidate/applications-count') return query('candidate.applicationsCount', { token: token() });

  // --- applications ---------------------------------------------------------
  if (path === '/applications' && method === 'POST') {
    if (body instanceof FormData) {
      const file = body.get('cv') as File | null;
      if (!file) throw new ApiError(400, 'BAD_REQUEST', 'Attach your CV as a PDF or Word document.');
      const storageId = await uploadCv(file);
      let answers: Record<string, unknown> = {};
      const rawAnswers = body.get('knockoutAnswers');
      if (typeof rawAnswers === 'string' && rawAnswers) {
        try {
          answers = JSON.parse(rawAnswers) as Record<string, unknown>;
        } catch {
          throw new ApiError(400, 'BAD_REQUEST', 'Knockout answers must be valid JSON.');
        }
      }
      return mutation('applications.apply', {
        token: token(),
        jobId: body.get('jobId'),
        storageId,
        filename: file.name,
        mimeType: file.type || 'application/pdf',
        sizeBytes: file.size,
        coverLetter: (body.get('coverLetter') as string) || undefined,
        knockoutAnswers: answers,
        acceptedAiNotice: body.get('acceptedAiNotice') === 'true',
      });
    }
    return mutation('applications.apply', { token: token(), ...body });
  }
  if (path === '/applications' && method === 'GET') {
    return query('applications.mine', { token: token(), page: num(q.page), pageSize: num(q.pageSize), stage: q.stage || undefined });
  }
  const appCvTextMatch = path.match(/^\/applications\/([^/]+)\/cv-text$/);
  if (appCvTextMatch && method === 'POST') {
    return mutation('applications.submitCvText', { token: token(), id: appCvTextMatch[1], text: body.text });
  }
  const appParsedMatch = path.match(/^\/applications\/([^/]+)\/parsed-cv$/);
  if (appParsedMatch && method === 'PUT') {
    return mutation('applications.updateParsedCv', { token: token(), id: appParsedMatch[1], cv: body });
  }
  const appReviewMatch = path.match(/^\/applications\/([^/]+)\/request-human-review$/);
  if (appReviewMatch && method === 'POST') {
    return mutation('applications.requestHumanReview', {
      token: token(),
      id: appReviewMatch[1],
      note: body?.note ?? undefined,
    });
  }
  const appMatch = path.match(/^\/applications\/([^/]+)$/);
  if (appMatch && method === 'GET') return query('applications.detail', { token: token(), id: appMatch[1] });

  // --- interviews -----------------------------------------------------------
  const slotsMatch = path.match(/^\/interviews\/applications\/([^/]+)\/slots$/);
  if (slotsMatch) return query('interviews.slotsForApplication', { token: token(), applicationId: slotsMatch[1] });
  const bookMatch = path.match(/^\/interviews\/applications\/([^/]+)\/interview$/);
  if (bookMatch && method === 'POST') {
    return mutation('interviews.book', {
      token: token(),
      applicationId: bookMatch[1],
      slotId: body.slotId,
      notes: body.notes ?? undefined,
    });
  }
  const rescheduleMatch = path.match(/^\/interviews\/([^/]+)\/reschedule$/);
  if (rescheduleMatch && method === 'PATCH') {
    return mutation('interviews.reschedule', { token: token(), id: rescheduleMatch[1], slotId: body.slotId });
  }
  const cancelMatch = path.match(/^\/interviews\/([^/]+)\/cancel$/);
  if (cancelMatch && method === 'PATCH') {
    return mutation('interviews.cancel', { token: token(), id: cancelMatch[1], reason: body.reason });
  }
  const interviewIcsMatch = path.match(/^\/interviews\/([^/]+)\/ics$/);
  if (interviewIcsMatch) {
    const file = await query('interviews.downloadIcs', { token: token(), id: interviewIcsMatch[1] });
    downloadBlob(file.content, file.filename, 'text/calendar;charset=utf-8');
    return { ok: true };
  }
  const interviewMatch = path.match(/^\/interviews\/([^/]+)$/);
  if (interviewMatch && method === 'PATCH') return mutation('interviews.update', { token: token(), id: interviewMatch[1], ...body });

  // --- recruiter ------------------------------------------------------------
  if (path === '/recruiter/dashboard') return query('recruiter.dashboard', { token: token() });
  if (path === '/recruiter/interviews') {
    return query('recruiter.interviewsForOrg', {
      token: token(),
      page: num(q.page),
      pageSize: num(q.pageSize),
    });
  }
  if (path === '/recruiter/jobs' && method === 'GET') {
    return query('recruiter.jobs', {
      token: token(),
      page: num(q.page),
      pageSize: num(q.pageSize),
      status: q.status || undefined,
      search: q.search || undefined,
    });
  }
  if (path === '/recruiter/jobs' && method === 'POST') {
    return mutation('recruiter.createJob', {
      token: token(),
      title: body.title,
      description: body.description,
      location: body.location,
      employmentType: body.employmentType ?? 'FULL_TIME',
      deadline: dateMs(body.deadline),
      openings: num(body.openings) ?? 1,
      minYearsExperience: num(body.minYearsExperience) ?? 0,
      blindScreening: bool(body.blindScreening) ?? true,
      hideUniversityBlind: bool(body.hideUniversityBlind) ?? true,
      biasDemoMode: bool(body.biasDemoMode) ?? false,
      status: body.status ?? 'DRAFT',
      criteria: (body.criteria ?? []).map((c: Record<string, unknown>) => ({
        kind: c.kind,
        type: c.type,
        label: c.label,
        weight: num(c.weight) ?? 0,
        config: c.config ?? {},
      })),
      knockoutQuestions: (body.knockoutQuestions ?? []).map((k: Record<string, unknown>) => ({
        type: k.type,
        prompt: k.prompt,
        options: Array.isArray(k.options) ? k.options : [],
        config: k.config ?? {},
      })),
    });
  }
  const recruiterJobStatusMatch = path.match(/^\/recruiter\/jobs\/([^/]+)\/status$/);
  if (recruiterJobStatusMatch && method === 'POST') {
    return mutation('recruiter.setJobStatus', { token: token(), id: recruiterJobStatusMatch[1], status: body.status });
  }
  const recruiterJobPipelineMatch = path.match(/^\/recruiter\/jobs\/([^/]+)\/pipeline$/);
  if (recruiterJobPipelineMatch) return query('recruiter.pipeline', { token: token(), jobId: recruiterJobPipelineMatch[1] });
  const recruiterJobApplicationsMatch = path.match(/^\/recruiter\/jobs\/([^/]+)\/applications$/);
  if (recruiterJobApplicationsMatch) {
    return query('recruiter.jobApplications', {
      token: token(),
      jobId: recruiterJobApplicationsMatch[1],
      page: num(q.page),
      pageSize: num(q.pageSize),
      stage: q.stage || undefined,
      sort: q.sort || undefined,
      search: q.search || undefined,
      knockout: q.knockout || undefined,
    });
  }
  const recruiterJobCompareMatch = path.match(/^\/recruiter\/jobs\/([^/]+)\/compare$/);
  if (recruiterJobCompareMatch) {
    return query('recruiter.compare', { token: token(), jobId: recruiterJobCompareMatch[1], ids: q.ids ?? '' });
  }
  const recruiterJobAvailabilityMatch = path.match(/^\/recruiter\/jobs\/([^/]+)\/availability$/);
  if (recruiterJobAvailabilityMatch && method === 'GET') {
    return query('interviews.availabilityForJob', { token: token(), jobId: recruiterJobAvailabilityMatch[1] });
  }
  if (recruiterJobAvailabilityMatch && method === 'POST') {
    return mutation('interviews.createAvailability', {
      token: token(),
      jobId: recruiterJobAvailabilityMatch[1],
      startsAt: dateMs(body.startsAt) ?? 0,
      endsAt: dateMs(body.endsAt) ?? 0,
      slotMinutes: num(body.slotMinutes),
      bufferMinutes: num(body.bufferMinutes),
      timezone: body.timezone,
      interviewType: body.interviewType,
      location: body.location,
    });
  }
  const recruiterJobBulkMatch = path.match(/^\/recruiter\/jobs\/([^/]+)\/bulk$/);
  if (recruiterJobBulkMatch && method === 'POST') {
    return mutation('recruiter.bulkStage', { token: token(), jobId: recruiterJobBulkMatch[1], ...body });
  }
  const recruiterAvailabilityMatch = path.match(/^\/recruiter\/availability\/([^/]+)$/);
  if (recruiterAvailabilityMatch && method === 'DELETE') {
    return mutation('interviews.deleteAvailability', { token: token(), id: recruiterAvailabilityMatch[1] });
  }
  const recruiterStageMatch = path.match(/^\/recruiter\/applications\/([^/]+)\/stage$/);
  if (recruiterStageMatch) return mutation('recruiter.setStage', { token: token(), id: recruiterStageMatch[1], ...body });
  const recruiterRevealMatch = path.match(/^\/recruiter\/applications\/([^/]+)\/reveal$/);
  if (recruiterRevealMatch) return mutation('recruiter.reveal', { token: token(), id: recruiterRevealMatch[1], reason: body.reason });
  const recruiterNoteMatch = path.match(/^\/recruiter\/applications\/([^/]+)\/notes$/);
  if (recruiterNoteMatch) return mutation('recruiter.addNote', { token: token(), id: recruiterNoteMatch[1], body: body.body });
  const recruiterRescoreMatch = path.match(/^\/recruiter\/applications\/([^/]+)\/rescore$/);
  if (recruiterRescoreMatch) return mutation('recruiter.rescore', { token: token(), id: recruiterRescoreMatch[1] });
  const recruiterCvMatch = path.match(/^\/recruiter\/applications\/([^/]+)\/cv$/);
  if (recruiterCvMatch) {
    const file = await query('files.cvUrl', { token: token(), applicationId: recruiterCvMatch[1] });
    const response = await fetch(file.url);
    downloadBlob(await response.blob(), file.filename, file.mimeType);
    return { ok: true };
  }
  const recruiterAppMatch = path.match(/^\/recruiter\/applications\/([^/]+)$/);
  if (recruiterAppMatch) return query('recruiter.applicationDetail', { token: token(), id: recruiterAppMatch[1] });
  const recruiterJobMatch = path.match(/^\/recruiter\/jobs\/([^/]+)$/);
  if (recruiterJobMatch && method === 'GET') return query('recruiter.job', { token: token(), id: recruiterJobMatch[1] });
  if (recruiterJobMatch && method === 'PATCH') {
    const payload: Record<string, unknown> = {};
    for (const key of ['title', 'description', 'location', 'employmentType', 'openings', 'minYearsExperience', 'status'] as const) {
      if (body[key] !== undefined) payload[key] = key === 'openings' || key === 'minYearsExperience' ? num(body[key]) : body[key];
    }
    for (const key of ['blindScreening', 'hideUniversityBlind', 'biasDemoMode'] as const) {
      if (body[key] !== undefined) payload[key] = bool(body[key]);
    }
    if (body.deadline !== undefined) payload.deadline = dateMs(body.deadline);
    if (body.criteria !== undefined) {
      payload.criteria = body.criteria.map((c: Record<string, unknown>) => ({
        kind: c.kind,
        type: c.type,
        label: c.label,
        weight: num(c.weight) ?? 0,
        config: c.config ?? {},
      }));
    }
    if (body.knockoutQuestions !== undefined) {
      payload.knockoutQuestions = body.knockoutQuestions.map((k: Record<string, unknown>) => ({
        type: k.type,
        prompt: k.prompt,
        options: Array.isArray(k.options) ? k.options : [],
        config: k.config ?? {},
      }));
    }
    return mutation('recruiter.updateJob', { token: token(), id: recruiterJobMatch[1], ...payload });
  }

  // --- audit ----------------------------------------------------------------
  if (path === '/audit/snapshot') {
    return action('audit.snapshot', { token: token(), jobId: q.jobId || undefined });
  }
  if (path === '/audit/overview') return query('auditQueries.overview', { token: token() });
  if (path === '/audit/reports' && method === 'POST') {
    return action('audit.createReport', { token: token(), jobId: body?.jobId || undefined });
  }
  if (path === '/audit/reports' && method === 'GET') {
    return query('auditQueries.reports', {
      token: token(),
      page: num(q.page),
      pageSize: num(q.pageSize),
      jobId: q.jobId || undefined,
    });
  }
  const auditCounterfactualMatch = path.match(/^\/audit\/jobs\/([^/]+)\/counterfactual$/);
  if (auditCounterfactualMatch && method === 'POST') {
    return action('audit.runCounterfactual', {
      token: token(),
      jobId: auditCounterfactualMatch[1],
      applicationId: body?.applicationId || undefined,
      cv: body?.cv ?? undefined,
    });
  }
  if (auditCounterfactualMatch && method === 'GET') {
    return query('auditQueries.counterfactualRuns', { token: token(), jobId: auditCounterfactualMatch[1] });
  }

  // --- admin ----------------------------------------------------------------
  if (path === '/admin/dashboard') return query('admin.dashboard', { token: token() });
  if (path === '/admin/organisations' && method === 'GET') {
    return query('admin.organisations', { token: token(), page: num(q.page), pageSize: num(q.pageSize), search: q.search || undefined });
  }
  if (path === '/admin/organisations' && method === 'POST') return mutation('admin.createOrganisation', { token: token(), ...body });
  const adminOrgMatch = path.match(/^\/admin\/organisations\/([^/]+)$/);
  if (adminOrgMatch && method === 'PATCH') return mutation('admin.updateOrganisation', { token: token(), id: adminOrgMatch[1], ...body });
  if (path === '/admin/users' && method === 'GET') {
    return query('admin.users', {
      token: token(),
      page: num(q.page),
      pageSize: num(q.pageSize),
      role: q.role || undefined,
      search: q.search || undefined,
      organisationId: q.organisationId || undefined,
    });
  }
  if (path === '/admin/users' && method === 'POST') return mutation('admin.createUser', { token: token(), ...body });
  const adminUserMatch = path.match(/^\/admin\/users\/([^/]+)$/);
  if (adminUserMatch && method === 'PATCH') return mutation('admin.updateUser', { token: token(), id: adminUserMatch[1], ...body });
  if (path === '/admin/settings' && method === 'GET') return query('admin.settings', { token: token() });
  if (path === '/admin/settings' && method === 'PUT') return mutation('admin.updateSettings', { token: token(), ...body });
  if (path === '/admin/audit-logs') {
    if (q.format === 'csv') {
      const result = await mutation('admin.exportAuditLogs', { token: token() });
      downloadBlob(result.csv, 'ise-audit-log.csv', 'text/csv;charset=utf-8');
      return { ok: true };
    }
    return query('admin.auditLogs', {
      token: token(),
      page: num(q.page),
      pageSize: num(q.pageSize),
      action: q.action || undefined,
      entityType: q.entityType || undefined,
    });
  }
  if (path === '/admin/data-requests' && method === 'GET') {
    return query('admin.dataRequests', {
      token: token(),
      page: num(q.page),
      pageSize: num(q.pageSize),
      status: q.status || undefined,
    });
  }
  const adminDataRequestMatch = path.match(/^\/admin\/data-requests\/([^/]+)\/complete$/);
  if (adminDataRequestMatch) {
    return mutation('admin.completeDataRequest', { token: token(), id: adminDataRequestMatch[1], action: body.action });
  }

  // --- notifications --------------------------------------------------------
  if (path === '/notifications' && method === 'GET') {
    return query('notifications.list', {
      token: token(),
      page: num(q.page),
      pageSize: num(q.pageSize),
      unreadOnly: bool(q.unreadOnly),
    });
  }
  if (path === '/notifications/read-all') return mutation('notifications.markAllRead', { token: token() });
  if (path === '/notifications/preferences' && method === 'GET') return query('notifications.preferences', { token: token() });
  if (path === '/notifications/preferences' && method === 'PUT') {
    return mutation('notifications.updatePreferences', { token: token(), ...body });
  }
  const notificationReadMatch = path.match(/^\/notifications\/([^/]+)\/read$/);
  if (notificationReadMatch) return mutation('notifications.markRead', { token: token(), id: notificationReadMatch[1] });

  throw new ApiError(404, 'NOT_FOUND', `No Convex endpoint for ${method} ${path}`);
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  retryOnAuth?: boolean;
}

export async function rawRequest(path: string, options: RequestOptions = {}): Promise<Response> {
  const result = await request<unknown>(path, options);
  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const [rawPath, rawQuery] = path.split('?');
  const params = new URLSearchParams(rawQuery ?? '');
  const q: Record<string, string> = {};
  params.forEach((value, key) => {
    q[key] = value;
  });
  const result = await dispatch(rawPath, method, options.body, q);
  return result as T;
}

export async function download(path: string, filename: string) {
  const [rawPath] = path.split('?');
  const cvMatch = rawPath.match(/^\/applications\/([^/]+)\/cv$/);
  if (cvMatch) {
    const file = await query('files.cvUrl', { token: token(), applicationId: cvMatch[1] });
    const response = await fetch(file.url);
    downloadBlob(await response.blob(), filename || file.filename, file.mimeType);
    return;
  }
  if (rawPath.endsWith('/ics')) {
    await request(rawPath);
    return;
  }
  const reportMatch = rawPath.match(/^\/audit\/reports\/([^/]+)\/pdf$/);
  if (reportMatch) {
    const report = await query('auditQueries.reportById', { token: token(), id: reportMatch[1] });
    const { renderBiasReportPdf } = await import('./reportPdf');
    const blob = await renderBiasReportPdf(report);
    downloadBlob(blob, filename, 'application/pdf');
    return;
  }
  if (rawPath === '/admin/audit-logs') {
    await request(path);
    return;
  }
  await request(path);
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
