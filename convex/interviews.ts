import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { APP_URL, assertJobAccess, fail, requireUser, type AuthContext } from '../shared/authz';
import { buildIcs } from '../shared/domain';
import { notify, writeAudit } from '../shared/shared';

const CANDIDATE_CUTOFF_HOURS = 12;

function whenLabel(ms: number) {
  return new Date(ms).toLocaleString('en-NG', {
    timeZone: 'Africa/Lagos',
    dateStyle: 'full',
    timeStyle: 'short',
  });
}

function requireCutoff(startsAt: number) {
  if ((startsAt - Date.now()) / 3600_000 < CANDIDATE_CUTOFF_HOURS) {
    fail('BAD_REQUEST', `Changes close ${CANDIDATE_CUTOFF_HOURS} hours before the interview. Contact the recruiter directly.`);
  }
}

async function loadInterviewForUser(ctx: QueryCtx | MutationCtx, auth: AuthContext, id: Id<'interviews'>) {
  const interview = await ctx.db.get(id);
  if (!interview) fail('NOT_FOUND', 'Interview not found');
  const application = await ctx.db.get(interview.applicationId);
  if (!application) fail('NOT_FOUND', 'Application not found');
  const job = await ctx.db.get(application.jobId);
  if (!job) fail('NOT_FOUND', 'Job not found');
  const isCandidate = application.candidateId === auth.user._id;
  const isRecruiter = auth.role === 'ADMIN' || (auth.role === 'RECRUITER' && job.organisationId === auth.orgId);
  if (!isCandidate && !isRecruiter) fail('FORBIDDEN', 'You do not have access to this interview.');
  return { interview, application, job, isCandidate, isRecruiter };
}

async function interviewPayload(ctx: any, interview: Doc<'interviews'>) {
  const application = await ctx.db.get(interview.applicationId);
  const job = application ? await ctx.db.get(application.jobId) : null;
  const organisation = job ? await ctx.db.get(job.organisationId) : null;
  const slot = await ctx.db.get(interview.slotId);
  const candidate = application ? await ctx.db.get(application.candidateId) : null;
  return {
    ...interview,
    id: interview._id,
    slot,
    application: application
      ? {
          ...application,
          id: application._id,
          job: job ? { id: job._id, title: job.title, organisation: organisation ? { name: organisation.name } : null } : null,
          candidate: candidate
            ? application.identityRevealedAt
              ? { fullName: candidate.fullName, email: candidate.email }
              : { fullName: application.publicRef, email: null }
            : null,
        }
      : null,
  };
}

/** Candidate: bookable slots for one of their applications. */
export const slotsForApplication = query({
  args: { token: v.string(), applicationId: v.id('applications') },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const application = await ctx.db.get(args.applicationId);
    if (!application || application.candidateId !== auth.user._id) fail('NOT_FOUND', 'Application not found');

    if (!['SHORTLISTED', 'INTERVIEW', 'OFFER', 'HIRED'].includes(application.stage)) {
      return { slots: [], reason: 'Interview slots open once you are shortlisted.', cutoffHours: CANDIDATE_CUTOFF_HOURS };
    }
    const all = await ctx.db
      .query('interviewSlots')
      .withIndex('by_job', (q) => q.eq('jobId', application.jobId))
      .collect();
    const free = all
      .filter((slot) => !slot.applicationId && slot.startsAt > Date.now())
      .sort((a, b) => a.startsAt - b.startsAt)
      .slice(0, 100);
    const slots = [];
    for (const slot of free) {
      const window = await ctx.db.get(slot.windowId);
      slots.push({
        ...slot,
        id: slot._id,
        window: window
          ? {
              interviewType: window.interviewType,
              location: window.location ?? null,
              timezone: window.timezone,
              slotMinutes: window.slotMinutes,
            }
          : null,
      });
    }
    const existing = await ctx.db
      .query('interviews')
      .withIndex('by_application', (q) => q.eq('applicationId', application._id))
      .collect();
    return {
      slots,
      currentInterviewId: existing.find((i) => i.status === 'SCHEDULED')?._id ?? null,
      cutoffHours: CANDIDATE_CUTOFF_HOURS,
    };
  },
});

export const book = mutation({
  args: { token: v.string(), applicationId: v.id('applications'), slotId: v.id('interviewSlots'), notes: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    if (auth.role !== 'CANDIDATE') fail('FORBIDDEN', 'Only candidates can book their own interview');

    const application = await ctx.db.get(args.applicationId);
    if (!application || application.candidateId !== auth.user._id) fail('NOT_FOUND', 'Application not found');
    if (!['SHORTLISTED', 'INTERVIEW', 'OFFER'].includes(application.stage)) {
      fail('BAD_REQUEST', 'Interviews can be booked once you are shortlisted.');
    }
    const slot = await ctx.db.get(args.slotId);
    if (!slot || slot.jobId !== application.jobId) fail('NOT_FOUND', 'That slot is not available for this job.');
    if (slot.startsAt < Date.now()) fail('BAD_REQUEST', 'That slot has already passed.');
    if (slot.applicationId) fail('CONFLICT', 'Someone just booked that slot. Please pick another time.');

    const window = await ctx.db.get(slot.windowId);
    if (!window) fail('NOT_FOUND', 'That slot is not available.');

    // Release any existing booking first, then claim the new slot.
    const existingInterviews = await ctx.db
      .query('interviews')
      .withIndex('by_application', (q) => q.eq('applicationId', application._id))
      .collect();
    for (const previous of existingInterviews.filter((i) => i.status === 'SCHEDULED')) {
      await ctx.db.patch(previous._id, {
        status: 'CANCELLED',
        cancelledAt: Date.now(),
        cancelReason: 'Replaced by a new booking',
        updatedAt: Date.now(),
      });
      await ctx.db.patch(previous.slotId, { applicationId: undefined });
    }

    await ctx.db.patch(slot._id, { applicationId: application._id });

    const job = await ctx.db.get(application.jobId);
    const candidate = await ctx.db.get(application.candidateId);
    const now = Date.now();
    const interviewId = await ctx.db.insert('interviews', {
      slotId: slot._id,
      applicationId: application._id,
      status: 'SCHEDULED',
      type: window.interviewType,
      location: window.location,
      meetingLink:
        window.interviewType === 'VIDEO'
          ? `https://meet.example.com/${application.publicRef.toLowerCase()}`
          : undefined,
      interviewerIds: [],
      icsUid: `${application._id}-${now.toString(36)}@ise`,
      createdAt: now,
      updatedAt: now,
    } as never);

    if (application.stage === 'SHORTLISTED') {
      await ctx.db.patch(application._id, { stage: 'INTERVIEW', updatedAt: now });
      await ctx.db.insert('statusHistory', {
        applicationId: application._id,
        fromStage: 'SHORTLISTED',
        toStage: 'INTERVIEW',
        actorId: auth.user._id,
        reason: 'Interview booked by candidate',
        createdAt: now,
      });
    }
    await writeAudit(ctx, { id: auth.user._id, role: 'CANDIDATE' }, 'INTERVIEW_BOOKED', 'Interview', interviewId, {
      applicationId: application._id,
      slotId: slot._id,
      startsAt: slot.startsAt,
    });

    const when = whenLabel(slot.startsAt);
    const candidateName = candidate?.fullName.split(' ')[0] ?? 'there';
    await notify(ctx, {
      userId: application.candidateId,
      type: 'INTERVIEW_SCHEDULED',
      title: 'Interview scheduled',
      body: `Hello ${candidateName}, your interview for ${job?.title ?? 'the role'} is scheduled for ${when}. You can reschedule or cancel from your dashboard, subject to the cut-off rules.`,
      data: { interviewId, applicationId: application._id },
    });
    if (job) {
      await notify(ctx, {
        userId: job.recruiterId,
        type: 'INTERVIEW_SCHEDULED',
        title: 'Interview booked',
        body: `A candidate booked an interview for ${job.title} on ${when}.`,
        data: { interviewId, applicationId: application._id },
      });
    }

    return { id: interviewId, startsAt: slot.startsAt, endsAt: slot.endsAt };
  },
});

export const reschedule = mutation({
  args: { token: v.string(), id: v.id('interviews'), slotId: v.id('interviewSlots') },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const { interview, isCandidate } = await loadInterviewForUser(ctx, auth, args.id);
    if (interview.status !== 'SCHEDULED') fail('BAD_REQUEST', 'Only scheduled interviews can be moved.');
    const slot = await ctx.db.get(interview.slotId);
    if (isCandidate && slot) requireCutoff(slot.startsAt);

    const target = await ctx.db.get(args.slotId);
    if (!target) fail('NOT_FOUND', 'That slot is not available.');
    if (target.startsAt < Date.now()) fail('BAD_REQUEST', 'That slot has already passed.');
    const application = await ctx.db.get(interview.applicationId);
    if (!application || target.jobId !== application.jobId) fail('NOT_FOUND', 'That slot is not available.');
    if (target.applicationId) fail('CONFLICT', 'Someone just booked that slot. Please pick another time.');

    const window = await ctx.db.get(target.windowId);
    if (!window) fail('NOT_FOUND', 'That slot is not available.');

    await ctx.db.patch(target._id, { applicationId: interview.applicationId });
    await ctx.db.patch(interview.slotId, { applicationId: undefined });
    await ctx.db.patch(interview._id, {
      slotId: target._id,
      status: 'SCHEDULED',
      type: window.interviewType,
      location: window.location,
      reminder24SentAt: undefined,
      reminder1SentAt: undefined,
      cancelledAt: undefined,
      cancelReason: undefined,
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, { id: auth.user._id, role: auth.role }, 'INTERVIEW_RESCHEDULED', 'Interview', interview._id, {
      from: slot?.startsAt,
      to: target.startsAt,
    });

    const when = whenLabel(target.startsAt);
    const job = application ? await ctx.db.get(application.jobId) : null;
    const candidate = application ? await ctx.db.get(application.candidateId) : null;
    await notify(ctx, {
      userId: interview.applicationId ? (candidate?._id ?? auth.user._id) : auth.user._id,
      type: 'INTERVIEW_CHANGED',
      title: 'Interview rescheduled',
      body: `Hello ${candidate?.fullName.split(' ')[0] ?? 'there'}, your interview for ${job?.title ?? 'the role'} has been moved to ${when}.`,
      data: { interviewId: interview._id, applicationId: interview.applicationId },
    });
    return { ok: true, startsAt: target.startsAt };
  },
});

export const cancel = mutation({
  args: { token: v.string(), id: v.id('interviews'), reason: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const { interview, isCandidate, application, job } = await loadInterviewForUser(ctx, auth, args.id);
    if (interview.status !== 'SCHEDULED') fail('BAD_REQUEST', 'Only scheduled interviews can be cancelled.');
    const slot = await ctx.db.get(interview.slotId);
    if (isCandidate && slot) requireCutoff(slot.startsAt);
    if (args.reason.trim().length < 3) fail('BAD_REQUEST', 'Give a short reason for cancelling.');

    await ctx.db.patch(interview._id, {
      status: 'CANCELLED',
      cancelledAt: Date.now(),
      cancelReason: args.reason.trim(),
      updatedAt: Date.now(),
    });
    await ctx.db.patch(interview.slotId, { applicationId: undefined });
    await writeAudit(ctx, { id: auth.user._id, role: auth.role }, 'INTERVIEW_CANCELLED', 'Interview', interview._id, {
      reason: args.reason,
    });

    const candidate = await ctx.db.get(application.candidateId);
    await notify(ctx, {
      userId: application.candidateId,
      type: 'INTERVIEW_CANCELLED',
      title: 'Interview cancelled',
      body: `Hello ${candidate?.fullName.split(' ')[0] ?? 'there'}, your interview for ${job.title} has been cancelled. Reason: ${args.reason.trim()}. The hiring team can offer a new time.`,
      data: { interviewId: interview._id, applicationId: application._id },
    });
    return { ok: true };
  },
});

export const update = mutation({
  args: {
    token: v.string(),
    id: v.id('interviews'),
    status: v.optional(v.union(v.literal('SCHEDULED'), v.literal('COMPLETED'), v.literal('CANCELLED'), v.literal('NO_SHOW'))),
    notes: v.optional(v.string()),
    meetingLink: v.optional(v.union(v.string(), v.null())),
    location: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const { interview, isRecruiter } = await loadInterviewForUser(ctx, auth, args.id);
    if (!isRecruiter) fail('FORBIDDEN', 'Only the hiring team can update an interview.');

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.status !== undefined) patch.status = args.status;
    if (args.notes !== undefined) patch.notes = args.notes;
    if (args.meetingLink !== undefined) patch.meetingLink = args.meetingLink ?? undefined;
    if (args.location !== undefined) patch.location = args.location ?? undefined;
    if (args.status === 'CANCELLED') {
      patch.cancelledAt = Date.now();
      await ctx.db.patch(interview.slotId, { applicationId: undefined });
    }
    await ctx.db.patch(interview._id, patch);
    await writeAudit(ctx, { id: auth.user._id, role: auth.role }, 'INTERVIEW_UPDATED', 'Interview', interview._id, {
      fields: Object.keys(patch),
    });
    return await interviewPayload(ctx, interview);
  },
});

export const downloadIcs = query({
  args: { token: v.string(), id: v.id('interviews') },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const { interview, application, job } = await loadInterviewForUser(ctx, auth, args.id);
    const slot = await ctx.db.get(interview.slotId);
    if (!slot) fail('NOT_FOUND', 'That interview has no time slot.');
    const organisation = await ctx.db.get(job.organisationId);
    const candidate = await ctx.db.get(application.candidateId);
    const ics = buildIcs({
      uid: interview.icsUid,
      start: slot.startsAt,
      end: slot.endsAt,
      summary: `Interview — ${job.title}`,
      description: `${organisation?.name ?? 'The hiring team'} interview scheduled via Iṣẹ́.\nInterview type: ${interview.type}.\n${interview.meetingLink ?? interview.location ?? ''}`,
      location: interview.meetingLink ?? interview.location,
      organiserEmail: process.env.EMAIL_FROM?.match(/<(.+)>/)?.[1] ?? 'no-reply@ise.example',
      attendeeEmail: candidate?.email,
      cancelled: interview.status === 'CANCELLED',
    });
    return {
      content: ics,
      filename: `ise-interview-${interview._id}.ics`,
      organisation: organisation?.name ?? null,
      appUrl: APP_URL(),
    };
  },
});

/** Recruiter / admin listing of interviews across the organisation. */
export const list = query({
  args: {
    token: v.string(),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    upcoming: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    if (auth.role === 'CANDIDATE') fail('FORBIDDEN', 'Recruiters only.');
    const page = Math.max(1, args.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, args.pageSize ?? 20));

    const all = await ctx.db.query('interviews').collect();
    const rows = [];
    for (const interview of all) {
      const application = await ctx.db.get(interview.applicationId);
      if (!application) continue;
      const job = await ctx.db.get(application.jobId);
      if (!job) continue;
      if (auth.role !== 'ADMIN' && job.organisationId !== auth.orgId) continue;
      const slot = await ctx.db.get(interview.slotId);
      if (args.upcoming && !(interview.status === 'SCHEDULED' && slot && slot.startsAt >= Date.now())) continue;
      rows.push(await interviewPayload(ctx, interview));
    }
    rows.sort((a, b) => (a.slot?.startsAt ?? 0) - (b.slot?.startsAt ?? 0));
    const total = rows.length;
    const items = rows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return { data: items, meta: { total, page, pageSize, totalPages, hasMore: page < totalPages } };
  },
});

export const forApplication = query({
  args: { token: v.string(), applicationId: v.id('applications') },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const application = await ctx.db.get(args.applicationId);
    if (!application) fail('NOT_FOUND', 'Application not found');
    const job = await ctx.db.get(application.jobId);
    if (!job) fail('NOT_FOUND', 'Job not found');
    if (auth.role !== 'ADMIN' && job.organisationId !== auth.orgId) fail('FORBIDDEN', 'You do not have access to this application.');
    const rows = await ctx.db
      .query('interviews')
      .withIndex('by_application', (q) => q.eq('applicationId', application._id))
      .collect();
    return Promise.all(rows.map((row) => interviewPayload(ctx, row)));
  },
});

export const availabilityForJob = query({
  args: { token: v.string(), jobId: v.id('jobs') },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    await assertJobAccess(ctx, auth, args.jobId);
    const windows = await ctx.db
      .query('availabilityWindows')
      .withIndex('by_job', (q) => q.eq('jobId', args.jobId))
      .collect();
    const result = [];
    for (const window of windows) {
      const slots = await ctx.db
        .query('interviewSlots')
        .withIndex('by_window', (q) => q.eq('windowId', window._id))
        .collect();
      result.push({
        ...window,
        id: window._id,
        slots: slots
          .sort((a, b) => a.startsAt - b.startsAt)
          .map((slot) => ({ ...slot, id: slot._id })),
      });
    }
    return result.sort((a, b) => a.startsAt - b.startsAt);
  },
});

export const createAvailability = mutation({
  args: {
    token: v.string(),
    jobId: v.id('jobs'),
    startsAt: v.number(),
    endsAt: v.number(),
    slotMinutes: v.optional(v.number()),
    bufferMinutes: v.optional(v.number()),
    timezone: v.optional(v.string()),
    interviewType: v.optional(v.union(v.literal('IN_PERSON'), v.literal('PHONE'), v.literal('VIDEO'))),
    location: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const job = await assertJobAccess(ctx, auth, args.jobId);
    if (args.endsAt <= args.startsAt) fail('BAD_REQUEST', 'The window must end after it starts.');
    if (args.startsAt < Date.now() - 60_000) fail('BAD_REQUEST', 'Pick a future availability window.');

    const slotMinutes = args.slotMinutes ?? 30;
    const bufferMinutes = args.bufferMinutes ?? 10;
    const step = (slotMinutes + bufferMinutes) * 60_000;
    const slots = [];
    for (let t = args.startsAt; t + slotMinutes * 60_000 <= args.endsAt; t += step) {
      slots.push({ startsAt: t, endsAt: t + slotMinutes * 60_000 });
    }
    if (!slots.length) fail('BAD_REQUEST', 'That window is too short for the chosen slot length.');

    const now = Date.now();
    const windowId = await ctx.db.insert('availabilityWindows', {
      jobId: job._id,
      recruiterId: auth.user._id,
      startsAt: args.startsAt,
      endsAt: args.endsAt,
      slotMinutes,
      bufferMinutes,
      timezone: args.timezone ?? 'Africa/Lagos',
      interviewType: args.interviewType ?? 'VIDEO',
      location: args.location,
      createdAt: now,
    });
    for (const slot of slots) {
      await ctx.db.insert('interviewSlots', {
        windowId,
        jobId: job._id,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        createdAt: now,
      });
    }
    await writeAudit(ctx, { id: auth.user._id, role: auth.role }, 'AVAILABILITY_CREATED', 'Job', job._id, {
      windowId,
      slots: slots.length,
    });
    const window = await ctx.db.get(windowId);
    return { ...window, id: windowId, slots: slots.map((slot, i) => ({ ...slot, id: `${windowId}-${i}` })) };
  },
});

export const deleteAvailability = mutation({
  args: { token: v.string(), id: v.id('availabilityWindows') },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const window = await ctx.db.get(args.id);
    if (!window) fail('NOT_FOUND', 'Availability window not found');
    const job = await ctx.db.get(window.jobId);
    if (!job) fail('NOT_FOUND', 'Job not found');
    if (auth.role !== 'ADMIN' && job.organisationId !== auth.orgId) fail('FORBIDDEN', 'You do not have access to that window.');
    const slots = await ctx.db
      .query('interviewSlots')
      .withIndex('by_window', (q) => q.eq('windowId', window._id))
      .collect();
    if (slots.some((slot) => slot.applicationId)) {
      fail('CONFLICT', 'This window has booked interviews. Cancel them first.');
    }
    for (const slot of slots) await ctx.db.delete(slot._id);
    await ctx.db.delete(window._id);
    await writeAudit(ctx, { id: auth.user._id, role: auth.role }, 'AVAILABILITY_DELETED', 'Job', job._id, {
      windowId: window._id,
    });
    return { ok: true };
  },
});
