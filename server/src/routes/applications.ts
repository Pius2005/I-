import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { asyncHandler } from '../lib/async.js';
import { ApiError } from '../lib/errors.js';
import { paginated, paginationSchema, validate } from '../lib/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { writeAudit } from '../middleware/audit.js';
import { anonymousRef } from '../lib/crypto.js';
import { assertCvFile, MAX_CV_BYTES, ALLOWED_CV_MIME } from '../services/extraction.js';
import { cvStorageKey, storage } from '../services/storage.js';
import { evaluateKnockouts } from '../services/knockouts.js';
import { enqueue } from '../services/queue.js';
import { notify } from '../services/notifications.js';
import { renderTemplate } from '../services/templates.js';
import { parseCvHeuristically } from '../services/cv-parser.js';
import { scoreAndStore } from '../services/pipeline.js';

const router = Router();
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CV_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const okType = ALLOWED_CV_MIME.includes(file.mimetype);
    const okExt = /\.(pdf|docx?|PDF|DOCX?)$/.test(file.originalname);
    if (!okType && !okExt) return cb(new Error('Only PDF or Word CVs are accepted'));
    cb(null, true);
  },
});

async function candidateApplication(id: string, candidateId: string) {
  const application = await prisma.application.findFirst({
    where: { id, candidateId },
    include: {
      job: {
        select: {
          id: true,
          title: true,
          slug: true,
          blindScreening: true,
          location: true,
          employmentType: true,
          organisation: { select: { name: true } },
        },
      },
      cvFile: {
        select: { id: true, filename: true, sizeBytes: true, extractionStatus: true, extractionError: true, createdAt: true },
      },
      parsedCV: true,
      scores: { orderBy: { createdAt: 'desc' }, take: 3 },
      knockoutAnswers: { include: { question: { select: { prompt: true, type: true } } } },
      statusHistory: { orderBy: { createdAt: 'asc' } },
      interviews: {
        where: { status: { not: 'CANCELLED' } },
        include: { slot: true },
        orderBy: { slot: { startsAt: 'asc' } },
      },
      _count: { select: { interviews: true } },
    },
  });
  if (!application) throw ApiError.notFound('Application not found');
  return application;
}

// --- Candidate: apply -------------------------------------------------------
router.post(
  '/',
  upload.single('cv'),
  asyncHandler(async (req, res) => {
    if (req.user!.role !== 'CANDIDATE') throw ApiError.forbidden('Only candidates can apply');
    const input = validate(
      z.object({
        jobId: z.string().min(1),
        coverLetter: z.string().max(8000).optional(),
        knockoutAnswers: z.string().optional(),
        acceptedAiNotice: z.enum(['true', 'false']).transform((v) => v === 'true'),
      }),
      req.body,
    );
    if (!input.acceptedAiNotice) {
      throw ApiError.badRequest('You must acknowledge the AI-use notice before applying.');
    }

    const job = await prisma.job.findUnique({
      where: { id: input.jobId },
      include: { knockoutQuestions: { orderBy: { order: 'asc' } } },
    });
    if (!job || job.status !== 'OPEN') throw ApiError.badRequest('This job is not accepting applications.');
    if (job.deadline < new Date()) throw ApiError.badRequest('The application deadline has passed.');

    const existing = await prisma.application.findUnique({
      where: { jobId_candidateId: { jobId: job.id, candidateId: req.user!.id } },
    });
    if (existing) throw ApiError.conflict('You have already applied to this job.');

    if (!req.file) throw ApiError.badRequest('Attach your CV as a PDF or Word document (max 5 MB).');
    assertCvFile({ mimetype: req.file.mimetype, size: req.file.size, originalname: req.file.originalname });

    // Require the candidate to have accepted the AI notice on their account too.
    const consent = await prisma.consentRecord.findFirst({
      where: { userId: req.user!.id, purpose: 'ai_screening', withdrawnAt: null },
    });
    if (!consent) throw ApiError.badRequest('Accept the AI-use notice in your profile before applying.');

    let answers: Record<string, unknown> = {};
    if (input.knockoutAnswers) {
      try {
        answers = JSON.parse(input.knockoutAnswers);
      } catch {
        throw ApiError.badRequest('Knockout answers must be valid JSON.');
      }
    }
    const knockout = evaluateKnockouts(
      job.knockoutQuestions.map((q) => ({ id: q.id, type: q.type, prompt: q.prompt, options: q.options, config: q.config })),
      answers,
    );

    const applicationId = crypto.randomUUID();
    const storageKey = cvStorageKey(req.user!.id, req.file.originalname);
    await storage.put(storageKey, req.file.buffer, req.file.mimetype);

    const application = await prisma.$transaction(async (tx) => {
      const created = await tx.application.create({
        data: {
          id: applicationId,
          jobId: job.id,
          candidateId: req.user!.id,
          publicRef: anonymousRef(applicationId),
          coverLetter: input.coverLetter,
          knockoutPassed: knockout.passed,
          knockoutFlags: knockout.flags as unknown as object,
          cvFile: {
            create: {
              candidateId: req.user!.id,
              filename: req.file!.originalname.slice(0, 200),
              mimeType: req.file!.mimetype,
              sizeBytes: req.file!.size,
              storageKey,
              checksum: crypto.createHash('sha256').update(req.file!.buffer).digest('hex'),
            },
          },
          knockoutAnswers: {
            create: knockout.answers.map((a) => ({
              questionId: a.questionId,
              value: (a.value ?? null) as object,
              passed: a.passed,
            })),
          },
          statusHistory: { create: { toStage: 'APPLIED', reason: 'Application submitted' } },
        },
        include: { cvFile: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user!.id,
          actorRole: 'CANDIDATE',
          action: 'APPLICATION_SUBMITTED',
          entityType: 'Application',
          entityId: created.id,
          metadata: { jobId: job.id, knockoutPassed: knockout.passed },
          ip: req.ip,
        },
      });
      return created;
    });

    const template = renderTemplate(
      'APPLICATION_RECEIVED',
      { candidateName: req.user!.email.split('@')[0], jobTitle: job.title, organisation: '' },
      req.user!.email,
    );
    await notify({
      userId: req.user!.id,
      type: 'APPLICATION_RECEIVED',
      title: template.title,
      body: template.body.replace(' at the hiring team', ''),
      data: { applicationId: application.id, jobId: job.id },
      email: template.email
        ? {
            subject: template.email.subject,
            paragraphs: [
              `We received your application for ${job.title}.`,
              'AI helps the hiring team review it against the published criteria. A human always makes the final decision, and you can request human review at any time.',
            ],
            cta: { label: 'View application', url: `${env.APP_URL}/candidate/applications/${application.id}` },
          }
        : null,
      sms: template.sms,
    });
    const recruiter = await prisma.job.findUnique({ where: { id: job.id }, select: { recruiterId: true } });
    if (recruiter) {
      await notify({
        userId: recruiter.recruiterId,
        type: 'APPLICATION_RECEIVED',
        title: 'New application',
        body: `A new application was submitted for ${job.title}.`,
        data: { jobId: job.id, applicationId: application.id },
      });
    }

    await enqueue('cv.process', { applicationId: application.id });

    res.status(201).json({
      data: {
        id: application.id,
        publicRef: application.publicRef,
        knockoutPassed: knockout.passed,
        knockoutFlags: knockout.flags,
      },
      message: 'Application submitted. We are reading your CV now.',
    });
  }),
);

// --- Candidate: my applications --------------------------------------------
router.get(
  '/',
  asyncHandler(async (req, res) => {
    if (req.user!.role !== 'CANDIDATE') throw ApiError.forbidden();
    const query = validate(paginationSchema.extend({ stage: z.string().optional() }), req.query);
    const where = {
      candidateId: req.user!.id,
      ...(query.stage ? { stage: query.stage as never } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.application.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          stage: true,
          score: true,
          knockoutPassed: true,
          createdAt: true,
          updatedAt: true,
          job: { select: { id: true, title: true, slug: true, location: true, organisation: { select: { name: true } } } },
          cvFile: { select: { extractionStatus: true, extractionError: true } },
          interviews: {
            where: { status: 'SCHEDULED' },
            select: { id: true, slot: { select: { startsAt: true } } },
            take: 1,
          },
        },
      }),
      prisma.application.count({ where }),
    ]);
    res.json(paginated(items, total, query.page, query.pageSize));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const application = await candidateApplication(req.params.id, req.user!.id);
    const history = await prisma.statusHistory.findMany({
      where: { applicationId: application.id },
      orderBy: { createdAt: 'asc' },
      select: { toStage: true, reason: true, createdAt: true },
    });
    // The candidate view explains the score with the same breakdown recruiters
    // see, so the latest score row is flattened onto the response.
    const latestScore = application.scores[0] ?? null;
    res.json({
      data: {
        ...application,
        statusHistory: history,
        breakdown: latestScore?.breakdown ?? [],
        explanation: latestScore?.explanation ?? null,
        scoreMeta: latestScore
          ? {
              model: latestScore.model,
              promptVersion: latestScore.promptVersion,
              rubricVersion: latestScore.rubricVersion,
              createdAt: latestScore.createdAt,
            }
          : null,
      },
    });
  }),
);

// Download your own CV.
router.get(
  '/:id/cv',
  asyncHandler(async (req, res) => {
    const application = await candidateApplication(req.params.id, req.user!.id);
    if (!application.cvFile) throw ApiError.notFound('No CV on this application');
    const file = await prisma.cVFile.findUnique({ where: { id: application.cvFile.id } });
    if (!file) throw ApiError.notFound('No CV on this application');
    const buffer = await storage.get(file.storageKey);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename.replace(/"/g, '')}"`);
    res.send(buffer);
  }),
);

// Paste CV text when a scanned file cannot be read.
router.post(
  '/:id/cv-text',
  asyncHandler(async (req, res) => {
    const { text } = validate(z.object({ text: z.string().min(120).max(60_000) }), req.body);
    const application = await candidateApplication(req.params.id, req.user!.id);
    if (['HIRED', 'REJECTED'].includes(application.stage)) throw ApiError.badRequest('This application is closed.');

    const key = `cvs/${req.user!.id}/pasted-${application.id}.txt`;
    await storage.put(key, Buffer.from(text, 'utf8'), 'text/plain');
    const cvFile = await prisma.cVFile.upsert({
      where: { applicationId: application.id },
      create: {
        applicationId: application.id,
        candidateId: req.user!.id,
        filename: 'pasted-cv.txt',
        mimeType: 'text/plain',
        sizeBytes: Buffer.byteLength(text),
        storageKey: key,
        checksum: crypto.createHash('sha256').update(text).digest('hex'),
        extractionStatus: 'COMPLETED',
        extractedText: text.slice(0, 200_000),
      },
      update: {
        filename: 'pasted-cv.txt',
        mimeType: 'text/plain',
        sizeBytes: Buffer.byteLength(text),
        storageKey: key,
        extractionStatus: 'COMPLETED',
        extractedText: text.slice(0, 200_000),
        extractionError: null,
      },
    });

    const parsed = parseCvHeuristically(text);
    await prisma.parsedCV.upsert({
      where: { applicationId: application.id },
      create: {
        applicationId: application.id,
        cvFileId: cvFile.id,
        data: parsed as unknown as object,
        parserModel: 'heuristic-v1',
        promptVersion: env.PROMPT_VERSION,
        reviewStatus: 'MANUAL_TEXT',
      },
      update: {
        data: parsed as unknown as object,
        reviewStatus: 'MANUAL_TEXT',
        parserModel: 'heuristic-v1',
        promptVersion: env.PROMPT_VERSION,
      },
    });
    await enqueue('cv.score', { applicationId: application.id });
    await writeAudit(req, 'CV_TEXT_SUPPLIED', 'Application', application.id);
    res.json({ data: { ok: true, parsed } });
  }),
);

// Candidate reviews/corrects the parsed CV, then the score is recomputed.
router.put(
  '/:id/parsed-cv',
  asyncHandler(async (req, res) => {
    const application = await candidateApplication(req.params.id, req.user!.id);
    if (application.stage === 'HIRED' || application.stage === 'REJECTED') {
      throw ApiError.badRequest('This application is closed.');
    }
    const schema = z.object({
      name: z.string().max(120).nullable().optional(),
      email: z.string().max(160).nullable().optional(),
      phone: z.string().max(40).nullable().optional(),
      location: z.string().max(120).nullable().optional(),
      headline: z.string().max(200).nullable().optional(),
      summary: z.string().max(4000).nullable().optional(),
      skills: z.array(z.string().max(80)).max(80),
      education: z
        .array(
          z.object({
            institution: z.string().max(200),
            institutionType: z.enum(['FEDERAL', 'STATE', 'PRIVATE', 'POLYTECHNIC', 'UNKNOWN']).optional(),
            course: z.string().max(160).optional(),
            degreeLevel: z.enum(['SSCE', 'OND', 'HND', 'BSC', 'MSC', 'PHD']).optional(),
            degreeClass: z.enum(['FIRST', 'SECOND_UPPER', 'SECOND_LOWER', 'THIRD', 'PASS', 'NONE']).optional(),
            startYear: z.number().int().min(1970).max(2100).nullable().optional(),
            endYear: z.number().int().min(1970).max(2100).nullable().optional(),
          }),
        )
        .max(8),
      experience: z
        .array(
          z.object({
            title: z.string().max(160),
            organisation: z.string().max(160).optional(),
            startYear: z.number().int().min(1970).max(2100).nullable().optional(),
            endYear: z.number().int().min(1970).max(2100).nullable().optional(),
            description: z.string().max(2000).optional(),
            isInternship: z.boolean().optional(),
          }),
        )
        .max(20),
      projects: z.array(z.object({ name: z.string().max(160), description: z.string().max(1000).optional() })).max(20),
      certifications: z.array(z.string().max(160)).max(30),
      languages: z.array(z.string().max(60)).max(20),
    });
    const corrected = validate(schema, req.body);

    await prisma.parsedCV.upsert({
      where: { applicationId: application.id },
      create: {
        applicationId: application.id,
        data: corrected as unknown as object,
        corrections: corrected as unknown as object,
        parserModel: 'candidate-corrected',
        promptVersion: env.PROMPT_VERSION,
        reviewStatus: 'CORRECTED',
      },
      update: {
        data: corrected as unknown as object,
        corrections: corrected as unknown as object,
        reviewStatus: 'CORRECTED',
      },
    });
    await scoreAndStore(application.id, { cv: corrected as never, source: 'candidate_edit' });
    await writeAudit(req, 'PARSED_CV_CORRECTED', 'Application', application.id);
    res.json({ data: { ok: true } });
  }),
);

// Right to request human review of AI-assisted screening.
router.post(
  '/:id/request-human-review',
  asyncHandler(async (req, res) => {
    const application = await candidateApplication(req.params.id, req.user!.id);
    if (application.humanReviewRequestedAt) {
      return res.json({ data: { ok: true, alreadyRequested: true } });
    }
    const note = validate(z.object({ note: z.string().max(2000).optional() }), req.body ?? {});
    await prisma.application.update({
      where: { id: application.id },
      data: { humanReviewRequestedAt: new Date() },
    });
    await writeAudit(req, 'HUMAN_REVIEW_REQUESTED', 'Application', application.id, { note: note.note });
    const job = await prisma.job.findUnique({
      where: { id: application.jobId },
      select: { title: true, recruiterId: true, organisation: { select: { users: { where: { role: 'ADMIN' }, select: { id: true } } } } },
    });
    if (job) {
      const recipients = new Set([job.recruiterId, ...job.organisation.users.map((u) => u.id)]);
      for (const userId of recipients) {
        await notify({
          userId,
          type: 'SYSTEM',
          title: 'Human review requested',
          body: `A candidate requested human review for ${job.title}. Review the application manually and record your reasoning.`,
          data: { applicationId: application.id, jobId: application.jobId },
        });
      }
    }
    const template = renderTemplate('HUMAN_REVIEW_ACK', { jobTitle: application.job.title }, req.user!.email);
    await notify({
      userId: req.user!.id,
      type: 'SYSTEM',
      title: template.title,
      body: template.body,
      data: { applicationId: application.id },
    });
    res.json({ data: { ok: true } });
  }),
);

export default router;
