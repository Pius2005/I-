import { env } from '../env.js';
import { prisma } from '../db.js';
import { logger } from '../lib/logger.js';

/**
 * Optional Google Calendar sync.
 *
 * Uses a stored OAuth refresh token (configured by the platform owner). Absent
 * credentials, it is a no-op returning a documented reason — ICS download
 * always works and is the default path.
 */

let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string | null> {
  if (!env.GOOGLE_CALENDAR_ENABLED || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REFRESH_TOKEN) {
    return null;
  }
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    logger.warn('calendar.token_failed', { status: res.status });
    return null;
  }
  const payload = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: payload.access_token, expiresAt: Date.now() + payload.expires_in * 1000 };
  return cachedToken.value;
}

export async function syncInterviewToGoogle(interviewId: string): Promise<{ synced: boolean; reason?: string }> {
  if (!env.GOOGLE_CALENDAR_ENABLED) return { synced: false, reason: 'Google Calendar sync is disabled' };

  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    include: {
      slot: true,
      application: { include: { job: { select: { title: true } }, candidate: { select: { fullName: true, email: true } } } },
    },
  });
  if (!interview || interview.status !== 'SCHEDULED') return { synced: false, reason: 'Interview not schedulable' };

  const token = await accessToken();
  if (!token) return { synced: false, reason: 'Google Calendar credentials unavailable' };

  const body = {
    summary: `Interview: ${interview.application.job.title}`,
    description: `Candidate: ${interview.application.candidate.fullName}\nScheduled via Iṣẹ́.`,
    start: { dateTime: interview.slot.startsAt.toISOString(), timeZone: 'Africa/Lagos' },
    end: { dateTime: interview.slot.endsAt.toISOString(), timeZone: 'Africa/Lagos' },
    location: interview.meetingLink ?? interview.location ?? undefined,
    attendees: [{ email: interview.application.candidate.email }],
  };

  try {
    const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.GOOGLE_CALENDAR_ID)}/events`;
    const url = interview.googleEventId ? `${base}/${interview.googleEventId}` : base;
    const res = await fetch(url, {
      method: interview.googleEventId ? 'PATCH' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      logger.warn('calendar.sync_failed', { status: res.status });
      return { synced: false, reason: `Google returned ${res.status}` };
    }
    const event = (await res.json()) as { id?: string };
    if (event.id && !interview.googleEventId) {
      await prisma.interview.update({ where: { id: interview.id }, data: { googleEventId: event.id } });
    }
    return { synced: true };
  } catch (error) {
    logger.warn('calendar.sync_error', { message: (error as Error).message });
    return { synced: false, reason: (error as Error).message };
  }
}
