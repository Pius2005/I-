import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { asyncHandler } from '../lib/async.js';
import { ApiError } from '../lib/errors.js';
import { validate } from '../lib/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { writeAudit } from '../middleware/audit.js';
import { buildIcs } from '../domain/ics.js';
import { notify } from '../services/notifications.js';
import { renderTemplate } from '../services/templates.js';
import { enqueue } from '../services/queue.js';

const router = Router();
router.use(requireAuth);

const CANDIDATE_CUTOFF_HOURS = 12;

async function interviewWithAccess(id: string, userId: string, role: string, orgId: string | null) {
  const interview = await prisma.interview.findUnique({
    where: { id },
    include: {
      slot: true,
      application: {
        include: {
          candidate: { select: { id: true, fullName: true, email: true } },
          job: {
            select: {
              id: true,
              title: true,
              organisationId: true,
              organisation: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!interview) throw ApiError.notFound('Interview not found');
  const isCandidate = interview.application.candidateId === userId;
  const isRecruiter = role === 'ADMIN' || (role === 'RECRUITER' && interview.application.job.organisationId === orgId);
  if (!isCandidate && !isRecruiter) throw ApiError.forbidden();
  return { interview, isCandidate, isRecruiter };
}

function requireCutoff(interview: { slot: { startsAt: Date } }) {
  const hours = (interview.slot.startsAt.getTime() - Date.now()) / 3600_000;
  if (hours < CANDIDATE_CUTOFF_HOURS) {
    throw ApiError.badRequest(
      `Changes close ${CANDIDATE_CUTOFF_HOURS} hours before the interview. Contact the recruiter directly.`,
    );
  }
}

// --- Candidate: available slots for an application -------------------------
router.get(
  '/applications/:id/slots',
  asyncHandler(async (req, res) => {
    const application = await prisma.application.findUnique({
      where: { id: req.params.id },
      select: { id: true, candidateId: true, jobId: true, stage: true, interviews: { where: { status: 'SCHEDULED' }, select: { id: true } } },
    });
    if (!application || application.candidateId !== req.user!.id) throw ApiError.notFound('Application not found');
    const eligible = ['SHORTLISTED', 'INTERVIEW', 'OFFER', 'HIRED'].includes(application.stage);
    if (!eligible) {
      return res.json({ data: { slots: [], reason: 'Interview slots open once you are shortlisted.' } });
    }
    const slots = await prisma.interviewSlot.findMany({
      where: { jobId: application.jobId, applicationId: null, startsAt: { gt: new Date() } },
      orderBy: { startsAt: 'asc' },
      include: { window: { select: { interviewType: true, location: true, timezone: true, slotMinutes: true } } },
      take: 100,
    });
    res.json({
      data: {
        slots,
        currentInterviewId: application.interviews[0]?.id ?? null,
        cutoffHours: CANDIDATE_CUTOFF_HOURS,
      },
    });
  }),
);

// --- Candidate: book --------------------------------------------------------
router.post(
  '/applications/:id/interview',
  asyncHandler(async (req, res) => {
    if (req.user!.role !== 'CANDIDATE') throw ApiError.forbidden('Only candidates can book their own interview');
    const input = validate(
      z.object({
        slotId: z.string().min(1),
        notes: z.string().max(1000).optional(),
      }),
      req.body,
    );
    const application = await prisma.application.findUnique({
      where: { id: req.params.id },
      include: {
        candidate: { select: { id: true, fullName: true, email: true } },
        job: { select: { id: true, title: true, organisation: { select: { name: true } } } },
        interviews: { where: { status: 'SCHEDULED' } },
      },
    });
    if (!application || application.candidateId !== req.user!.id) throw ApiError.notFound('Application not found');
    if (!['SHORTLISTED', 'INTERVIEW', 'OFFER'].includes(application.stage)) {
      throw ApiError.badRequest('Interviews can be booked once you are shortlisted.');
    }

    const slot = await prisma.interviewSlot.findUnique({
      where: { id: input.slotId },
      include: { window: true },
    });
    if (!slot || slot.jobId !== application.jobId) throw ApiError.notFound('That slot is not available for this job.');
    if (slot.startsAt < new Date()) throw ApiError.badRequest('That slot has already passed.');

    let createdId: string | null = null;
    try {
      await prisma.$transaction(async (tx) => {
        // Release the application's current booking first: a slot's applicationId
        // is unique, so claiming a second slot while the old one is still held
        // would violate that constraint. This all rolls back if the claim fails.
        for (const existing of application.interviews) {
          await tx.interview.update({
            where: { id: existing.id },
            data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'Replaced by a new booking' },
          });
          await tx.interviewSlot.updateMany({
            where: { id: existing.slotId, applicationId: application.id },
            data: { applicationId: null },
          });
        }

        // Atomic claim: only one transaction can set applicationId where it is null.
        const claimed = await tx.interviewSlot.updateMany({
          where: { id: slot.id, applicationId: null },
          data: { applicationId: application.id },
        });
        if (claimed.count !== 1) throw ApiError.conflict('Someone just booked that slot. Please pick another time.');

        const interview = await tx.interview.create({
          data: {
            slotId: slot.id,
            applicationId: application.id,
            type: slot.window.interviewType,
            location: slot.window.location,
            meetingLink: slot.window.interviewType === 'VIDEO' ? `https://meet.example.com/${application.publicRef.toLowerCase()}` : null,
            interviewerIds: [],
            // A replacement booking is a new calendar event, so it needs its own
            // UID; icsUid is unique and the cancelled interview keeps the old one.
            icsUid: `${application.id}-${Date.now().toString(36)}@ise`,
          },
        });
        await tx.application.update({
          where: { id: application.id },
          data: {
            stage: application.stage === 'SHORTLISTED' ? 'INTERVIEW' : application.stage,
          },
        });
        await tx.statusHistory.create({
          data: {
            applicationId: application.id,
            fromStage: application.stage,
            toStage: 'INTERVIEW',
            actorId: req.user!.id,
            reason: 'Interview booked by candidate',
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: req.user!.id,
            actorRole: 'CANDIDATE',
            action: 'INTERVIEW_BOOKED',
            entityType: 'Interview',
            entityId: interview.id,
            metadata: { applicationId: application.id, slotId: slot.id, startsAt: slot.startsAt.toISOString() },
            ip: req.ip,
          },
        });
        createdId = interview.id;
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if ((error as { code?: string }).code === 'P2002') {
        throw ApiError.conflict('Someone just booked that slot. Please pick another time.');
      }
      throw error;
    }

    const when = slot.startsAt.toLocaleString('en-NG', { timeZone: 'Africa/Lagos', dateStyle: 'full', timeStyle: 'short' });
    const template = renderTemplate(
      'INTERVIEW_SCHEDULED',
      { candidateName: application.candidate.fullName.split(' ')[0], jobTitle: application.job.title, organisation: application.job.organisation.name, date: `${when} (Africa/Lagos)` },
      application.candidate.email,
    );
    await notify({
      userId: application.candidate.id,
      type: 'INTERVIEW_SCHEDULED',
      title: template.title,
      body: template.body,
      data: { interviewId: createdId, applicationId: application.id },
      email: template.email ? { subject: template.email.subject, paragraphs: [template.body], cta: { label: 'View interview', url: `${env.APP_URL}/candidate/applications/${application.id}` } } : null,
      sms: template.sms,
    });
    const jobInfo = await prisma.job.findUnique({ where: { id: application.jobId }, select: { recruiterId: true } });
    if (jobInfo) {
      await notify({
        userId: jobInfo.recruiterId,
        type: 'INTERVIEW_SCHEDULED',
        title: 'Interview booked',
        body: `A candidate booked an interview for ${application.job.title} on ${when}.`,
        data: { interviewId: createdId, applicationId: application.id },
      });
    }
    if (createdId) await enqueue('interview.calendar', { interviewId: createdId });

    res.status(201).json({ data: { id: createdId, startsAt: slot.startsAt, endsAt: slot.endsAt } });
  }),
);

// --- Reschedule -------------------------------------------------------------
router.patch(
  '/:id/reschedule',
  asyncHandler(async (req, res) => {
    const { interview, isCandidate } = await interviewWithAccess(req.params.id, req.user!.id, req.user!.role, req.user!.orgId);
    const { slotId } = validate(z.object({ slotId: z.string().min(1) }), req.body);
    if (interview.status !== 'SCHEDULED') throw ApiError.badRequest('Only scheduled interviews can be moved.');
    if (isCandidate) requireCutoff(interview);

    const slot = await prisma.interviewSlot.findUnique({ where: { id: slotId }, include: { window: true } });
    if (!slot || slot.jobId !== interview.application.jobId) throw ApiError.notFound('That slot is not available.');
    if (slot.startsAt < new Date()) throw ApiError.badRequest('That slot has already passed.');

    const oldStart = interview.slot.startsAt;
    try {
      await prisma.$transaction(async (tx) => {
        const claimed = await tx.interviewSlot.updateMany({
          where: { id: slot.id, applicationId: null },
          data: { applicationId: interview.applicationId },
        });
        if (claimed.count !== 1) throw ApiError.conflict('Someone just booked that slot. Please pick another time.');
        await tx.interviewSlot.updateMany({
          where: { id: interview.slotId, applicationId: interview.applicationId },
          data: { applicationId: null },
        });
        await tx.interview.update({
          where: { id: interview.id },
          data: {
            slotId: slot.id,
            status: 'SCHEDULED',
            type: slot.window.interviewType,
            location: slot.window.location,
            reminder24SentAt: null,
            reminder1SentAt: null,
            cancelledAt: null,
            cancelReason: null,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: req.user!.id,
            actorRole: req.user!.role,
            action: 'INTERVIEW_RESCHEDULED',
            entityType: 'Interview',
            entityId: interview.id,
            metadata: { from: oldStart.toISOString(), to: slot.startsAt.toISOString() },
            ip: req.ip,
          },
        });
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if ((error as { code?: string }).code === 'P2002') throw ApiError.conflict('That slot was just taken.');
      throw error;
    }

    const when = slot.startsAt.toLocaleString('en-NG', { timeZone: 'Africa/Lagos', dateStyle: 'full', timeStyle: 'short' });
    const template = renderTemplate(
      'INTERVIEW_CHANGED',
      { candidateName: interview.application.candidate.fullName.split(' ')[0], jobTitle: interview.application.job.title, date: `${when} (Africa/Lagos)` },
      interview.application.candidate.email,
    );
    await notify({
      userId: interview.application.candidate.id,
      type: 'INTERVIEW_CHANGED',
      title: template.title,
      body: template.body,
      data: { interviewId: interview.id, applicationId: interview.applicationId },
      email: template.email ? { subject: template.email.subject, paragraphs: [template.body], cta: { label: 'View interview', url: `${env.APP_URL}/candidate/applications/${interview.applicationId}` } } : null,
      sms: template.sms,
    });
    await enqueue('interview.calendar', { interviewId: interview.id });
    res.json({ data: { ok: true, startsAt: slot.startsAt } });
  }),
);

// --- Cancel ----------------------------------------------------------------
router.patch(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const { interview, isCandidate } = await interviewWithAccess(req.params.id, req.user!.id, req.user!.role, req.user!.orgId);
    const { reason } = validate(z.object({ reason: z.string().min(3).max(1000) }), req.body);
    if (interview.status !== 'SCHEDULED') throw ApiError.badRequest('Only scheduled interviews can be cancelled.');
    if (isCandidate) requireCutoff(interview);

    await prisma.$transaction([
      prisma.interview.update({
        where: { id: interview.id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason },
      }),
      prisma.interviewSlot.updateMany({
        where: { id: interview.slotId, applicationId: interview.applicationId },
        data: { applicationId: null },
      }),
      prisma.auditLog.create({
        data: {
          actorId: req.user!.id,
          actorRole: req.user!.role,
          action: 'INTERVIEW_CANCELLED',
          entityType: 'Interview',
          entityId: interview.id,
          metadata: { reason },
          ip: req.ip,
        },
      }),
    ]);

    const template = renderTemplate(
      'INTERVIEW_CANCELLED',
      {
        candidateName: interview.application.candidate.fullName.split(' ')[0],
        jobTitle: interview.application.job.title,
        date: interview.slot.startsAt.toLocaleString('en-NG', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' }),
        reason,
      },
      interview.application.candidate.email,
    );
    await notify({
      userId: interview.application.candidate.id,
      type: 'INTERVIEW_CANCELLED',
      title: template.title,
      body: template.body,
      data: { interviewId: interview.id, applicationId: interview.applicationId },
      email: template.email ? { subject: template.email.subject, paragraphs: [template.body] } : null,
      sms: template.sms,
    });
    res.json({ data: { ok: true } });
  }),
);

// --- Recruiter: update interview outcome / details -------------------------
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { interview, isRecruiter } = await interviewWithAccess(req.params.id, req.user!.id, req.user!.role, req.user!.orgId);
    if (!isRecruiter) throw ApiError.forbidden();
    const input = validate(
      z.object({
        status: z.enum(['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']).optional(),
        notes: z.string().max(4000).optional(),
        meetingLink: z.string().url().max(500).nullable().optional(),
        location: z.string().max(300).nullable().optional(),
      }),
      req.body,
    );
    const updated = await prisma.interview.update({
      where: { id: interview.id },
      data: {
        ...input,
        ...(input.status === 'CANCELLED' ? { cancelledAt: new Date() } : {}),
      },
    });
    if (input.status === 'CANCELLED') {
      await prisma.interviewSlot.updateMany({
        where: { id: interview.slotId },
        data: { applicationId: null },
      });
    }
    await writeAudit(req, 'INTERVIEW_UPDATED', 'Interview', interview.id, { fields: Object.keys(input) });
    res.json({ data: updated });
  }),
);

// --- ICS download ----------------------------------------------------------
router.get(
  '/:id/ics',
  asyncHandler(async (req, res) => {
    const { interview } = await interviewWithAccess(req.params.id, req.user!.id, req.user!.role, req.user!.orgId);
    const ics = buildIcs({
      uid: interview.icsUid,
      start: interview.slot.startsAt,
      end: interview.slot.endsAt,
      summary: `Interview — ${interview.application.job.title}`,
      description: `${interview.application.job.organisation.name} interview scheduled via Iṣẹ́.\nInterview type: ${interview.type}.\n${interview.meetingLink ?? interview.location ?? ''}`,
      location: interview.meetingLink ?? interview.location,
      organiserEmail: env.EMAIL_FROM.match(/<(.+)>/)?.[1] ?? 'no-reply@ise.example',
      attendeeEmail: interview.application.candidate.email,
      cancelled: interview.status === 'CANCELLED',
    });
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ise-interview-${interview.id}.ics"`);
    res.send(ics);
  }),
);

export default router;
