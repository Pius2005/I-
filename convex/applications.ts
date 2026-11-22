import { mutation, query } from './_generated/server';
import { internalRefs } from '../shared/refs';
import { v } from 'convex/values';
import type { MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { APP_SECRET, fail, requireUser } from '../shared/authz';
import { anonymousRef } from '../shared/crypto';
import { notify, paginate, pagination, writeAudit } from '../shared/shared';
import { evaluateKnockouts, parseCvHeuristically, type ParsedCVData } from '../shared/domain';
import { scoreAndStore } from '../shared/evaluate';
import { ALLOWED_MIME, MAX_CV_BYTES } from './files';

export const apply = mutation({
  args: {
    token: v.string(),
    jobId: v.id('jobs'),
    storageId: v.id('_storage'),
    filename: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    coverLetter: v.optional(v.string()),
    knockoutAnswers: v.optional(v.record(v.string(), v.any())),
    acceptedAiNotice: v.boolean(),
  },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    if (auth.role !== 'CANDIDATE') fail('FORBIDDEN', 'Only candidates can apply');
    if (!args.acceptedAiNotice) fail('BAD_REQUEST', 'You must acknowledge the AI-use notice before applying.');

    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== 'OPEN') fail('BAD_REQUEST', 'This job is not accepting applications.');
    if (job.deadline < Date.now()) fail('BAD_REQUEST', 'The application deadline has passed.');

    const existing = await ctx.db
      .query('applications')
      .withIndex('by_job_candidate', (q) => q.eq('jobId', job._id).eq('candidateId', auth.user._id))
      .unique();
    if (existing) fail('CONFLICT', 'You have already applied to this job.');

    if (args.sizeBytes > MAX_CV_BYTES) fail('BAD_REQUEST', 'Your CV must be 4 MB or smaller.');
    const isDocx = /\.docx$/i.test(args.filename);
    const isDoc = /\.doc$/i.test(args.filename);
    const isPdf = /\.pdf$/i.test(args.filename);
    if (!ALLOWED_MIME.includes(args.mimeType) && !isDocx && !isDoc && !isPdf) {
      fail('BAD_REQUEST', 'Upload a PDF or Word (.docx) CV.');
    }

    const consent = await ctx.db
      .query('consentRecords')
      .withIndex('by_user', (q) => q.eq('userId', auth.user._id))
      .collect();
    if (!consent.some((c) => c.purpose === 'ai_screening' && !c.withdrawnAt)) {
      fail('BAD_REQUEST', 'Accept the AI-use notice in your profile before applying.');
    }

    const questions = await ctx.db
      .query('knockoutQuestions')
      .withIndex('by_job', (q) => q.eq('jobId', job._id))
      .collect();
    const knockout = evaluateKnockouts(
      questions
        .sort((a, b) => a.order - b.order)
        .map((q) => ({ id: q._id, type: q.type, prompt: q.prompt, options: q.options, config: q.config })),
      args.knockoutAnswers ?? {},
    );

    const now = Date.now();
    const applicationId = await ctx.db.insert('applications', {
      jobId: job._id,
      candidateId: auth.user._id,
      publicRef: 'pending',
      coverLetter: args.coverLetter?.trim() || undefined,
      stage: 'APPLIED',
      knockoutPassed: knockout.passed,
      knockoutFlags: knockout.flags,
      createdAt: now,
      updatedAt: now,
    });
    const ref = anonymousRef(applicationId, APP_SECRET());
    await ctx.db.patch(applicationId, { publicRef: ref });

    const cvFileId = await ctx.db.insert('cvFiles', {
      applicationId,
      candidateId: auth.user._id,
      filename: args.filename.slice(0, 200),
      mimeType: args.mimeType,
      sizeBytes: args.sizeBytes,
      storageId: args.storageId,
      storageKey: `cvs/${auth.user._id}/${applicationId}`,
      checksum: '',
      extractionStatus: 'PENDING',
      createdAt: now,
      updatedAt: now,
    });

    for (const answer of knockout.answers) {
      await ctx.db.insert('knockoutAnswers', {
        applicationId,
        questionId: answer.questionId as never,
        value: answer.value,
        passed: answer.passed,
        createdAt: now,
      });
    }
    await ctx.db.insert('statusHistory', {
      applicationId,
      toStage: 'APPLIED',
      actorId: auth.user._id,
      reason: 'Application submitted',
      createdAt: now,
    });
    await writeAudit(ctx, { id: auth.user._id, role: 'CANDIDATE' }, 'APPLICATION_SUBMITTED', 'Application', applicationId, {
      jobId: job._id,
      knockoutPassed: knockout.passed,
    });

    await notify(ctx, {
      userId: auth.user._id,
      type: 'APPLICATION_RECEIVED',
      title: 'Application received',
      body: `We received your application for ${job.title}. AI helps the hiring team review it against the published criteria. A human always makes the final decision, and you can request human review at any time.`,
      data: { applicationId, jobId: job._id },
    });
    await notify(ctx, {
      userId: job.recruiterId,
      type: 'APPLICATION_RECEIVED',
      title: 'New application',
      body: `A new application was submitted for ${job.title}.`,
      data: { jobId: job._id, applicationId },
    });

    await ctx.scheduler.runAfter(0, internalRefs.extract.processCv, { applicationId });

    return {
      id: applicationId,
      publicRef: ref,
      knockoutPassed: knockout.passed,
      knockoutFlags: knockout.flags,
      cvFileId,
    };
  },
});

export const mine = query({
  args: { token: v.string(), page: v.optional(v.number()), pageSize: v.optional(v.number()), stage: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    if (auth.role !== 'CANDIDATE') fail('FORBIDDEN', 'Only candidates have applications.');
    const { page, pageSize, skip } = pagination(args);

    const all = await ctx.db
      .query('applications')
      .withIndex('by_candidate', (q) => q.eq('candidateId', auth.user._id))
      .collect();
    const filtered = all.filter((a) => (args.stage ? a.stage === args.stage : true)).sort((a, b) => b.createdAt - a.createdAt);
    const slice = filtered.slice(skip, skip + pageSize);

    const items = await Promise.all(
      slice.map(async (application) => {
        const job = await ctx.db.get(application.jobId);
        const organisation = job ? await ctx.db.get(job.organisationId) : null;
        const cvFile = await ctx.db
          .query('cvFiles')
          .withIndex('by_application', (q) => q.eq('applicationId', application._id))
          .unique();
        const interviews = await ctx.db
          .query('interviews')
          .withIndex('by_application', (q) => q.eq('applicationId', application._id))
          .collect();
        const scheduled = interviews.filter((i) => i.status === 'SCHEDULED');
        const slot = scheduled[0] ? await ctx.db.get(scheduled[0].slotId) : null;
        return {
          id: application._id,
          stage: application.stage,
          score: application.score ?? null,
          knockoutPassed: application.knockoutPassed,
          createdAt: application.createdAt,
          updatedAt: application.updatedAt,
          job: job
            ? {
                id: job._id,
                title: job.title,
                slug: job.slug,
                location: job.location,
                organisation: organisation ? { name: organisation.name } : null,
              }
            : null,
          cvFile: cvFile
            ? { extractionStatus: cvFile.extractionStatus, extractionError: cvFile.extractionError ?? null }
            : null,
          interviews: scheduled[0] ? [{ id: scheduled[0]._id, slot: slot ? { startsAt: slot.startsAt } : null }] : [],
        };
      }),
    );

    return paginate(items, filtered.length, page, pageSize);
  },
});

async function loadCandidateApplication(ctx: MutationCtx, token: string, id: Id<'applications'>) {
  const auth = await requireUser(ctx, token);
  const application = await ctx.db.get(id);
  if (!application || application.candidateId !== auth.user._id) fail('NOT_FOUND', 'Application not found');
  return { auth, application };
}

export const detail = query({
  args: { token: v.string(), id: v.id('applications') },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const application = await ctx.db.get(args.id);
    if (!application || application.candidateId !== auth.user._id) fail('NOT_FOUND', 'Application not found');

    const job = await ctx.db.get(application.jobId);
    const organisation = job ? await ctx.db.get(job.organisationId) : null;
    const cvFile = await ctx.db
      .query('cvFiles')
      .withIndex('by_application', (q) => q.eq('applicationId', application._id))
      .unique();
    const parsed = await ctx.db
      .query('parsedCvs')
      .withIndex('by_application', (q) => q.eq('applicationId', application._id))
      .unique();
    const scores = await ctx.db
      .query('scores')
      .withIndex('by_application', (q) => q.eq('applicationId', application._id))
      .collect();
    const latestScore = scores.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
    const answers = await ctx.db
      .query('knockoutAnswers')
      .withIndex('by_application', (q) => q.eq('applicationId', application._id))
      .collect();
    const knockoutAnswers = [];
    for (const answer of answers) {
      const question = await ctx.db.get(answer.questionId);
      knockoutAnswers.push({
        prompt: question?.prompt ?? '',
        type: question?.type ?? '',
        value: answer.value,
        passed: answer.passed,
      });
    }
    const history = await ctx.db
      .query('statusHistory')
      .withIndex('by_application', (q) => q.eq('applicationId', application._id))
      .collect();
    const interviews = await ctx.db
      .query('interviews')
      .withIndex('by_application', (q) => q.eq('applicationId', application._id))
      .collect();
    const interviewItems = [];
    for (const interview of interviews.filter((i) => i.status !== 'CANCELLED')) {
      const slot = await ctx.db.get(interview.slotId);
      interviewItems.push({ ...interview, id: interview._id, slot });
    }

    return {
      ...application,
      id: application._id,
      job: job
        ? {
            id: job._id,
            title: job.title,
            slug: job.slug,
            blindScreening: job.blindScreening,
            location: job.location,
            employmentType: job.employmentType,
            organisation: organisation ? { name: organisation.name } : null,
          }
        : null,
      cvFile: cvFile
        ? {
            id: cvFile._id,
            filename: cvFile.filename,
            sizeBytes: cvFile.sizeBytes,
            extractionStatus: cvFile.extractionStatus,
            extractionError: cvFile.extractionError ?? null,
            createdAt: cvFile.createdAt,
          }
        : null,
      parsedCV: parsed ? { ...parsed, id: parsed._id } : null,
      knockoutAnswers,
      statusHistory: history.sort((a, b) => a.createdAt - b.createdAt),
      interviews: interviewItems,
      _count: { interviews: interviewItems.length },
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
    };
  },
});

/** Paste CV text when a scanned file cannot be read. */
export const submitCvText = mutation({
  args: { token: v.string(), id: v.id('applications'), text: v.string() },
  handler: async (ctx, args) => {
    const { auth, application } = await loadCandidateApplication(ctx, args.token, args.id);
    if (args.text.trim().length < 120) fail('BAD_REQUEST', 'Paste at least a few lines of your CV.');
    if (['HIRED', 'REJECTED'].includes(application.stage)) fail('BAD_REQUEST', 'This application is closed.');

    const text = args.text.slice(0, 60_000);
    const parsed = parseCvHeuristically(text);
    const now = Date.now();
    const key = `cvs/${auth.user._id}/pasted-${application._id}.txt`;

    const existing = await ctx.db
      .query('cvFiles')
      .withIndex('by_application', (q) => q.eq('applicationId', application._id))
      .unique();
    let cvFileId;
    if (existing) {
      await ctx.db.patch(existing._id, {
        filename: 'pasted-cv.txt',
        mimeType: 'text/plain',
        sizeBytes: text.length,
        storageKey: key,
        extractionStatus: 'COMPLETED',
        extractedText: text.slice(0, 200_000),
        extractionError: undefined,
        updatedAt: now,
      });
      cvFileId = existing._id;
    } else {
      cvFileId = await ctx.db.insert('cvFiles', {
        applicationId: application._id,
        candidateId: auth.user._id,
        filename: 'pasted-cv.txt',
        mimeType: 'text/plain',
        sizeBytes: text.length,
        storageKey: key,
        checksum: '',
        extractionStatus: 'COMPLETED',
        extractedText: text.slice(0, 200_000),
        createdAt: now,
        updatedAt: now,
      });
    }

    const parsedExisting = await ctx.db
      .query('parsedCvs')
      .withIndex('by_application', (q) => q.eq('applicationId', application._id))
      .unique();
    if (parsedExisting) {
      await ctx.db.patch(parsedExisting._id, {
        data: parsed,
        cvFileId,
        parserModel: 'heuristic-v1',
        promptVersion: 'deterministic-rubric',
        reviewStatus: 'MANUAL_TEXT',
        updatedAt: now,
      });
    } else {
      await ctx.db.insert('parsedCvs', {
        applicationId: application._id,
        cvFileId,
        data: parsed,
        parserModel: 'heuristic-v1',
        promptVersion: 'deterministic-rubric',
        reviewStatus: 'MANUAL_TEXT',
        createdAt: now,
        updatedAt: now,
      });
    }

    await scoreAndStore(ctx, application._id, { cv: parsed as ParsedCVData, source: 'pipeline' });
    await writeAudit(ctx, { id: auth.user._id, role: 'CANDIDATE' }, 'CV_TEXT_SUPPLIED', 'Application', application._id);
    return { ok: true, parsed };
  },
});

/** Candidate reviews and corrects the parsed CV; the score is recomputed. */
export const updateParsedCv = mutation({
  args: { token: v.string(), id: v.id('applications'), cv: v.any() },
  handler: async (ctx, args) => {
    const { auth, application } = await loadCandidateApplication(ctx, args.token, args.id);
    if (['HIRED', 'REJECTED'].includes(application.stage)) fail('BAD_REQUEST', 'This application is closed.');
    const cv = args.cv as ParsedCVData;
    if (!Array.isArray(cv.skills)) fail('BAD_REQUEST', 'Skills must be a list.');

    const now = Date.now();
    const existing = await ctx.db
      .query('parsedCvs')
      .withIndex('by_application', (q) => q.eq('applicationId', application._id))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        data: cv,
        corrections: cv,
        parserModel: 'candidate-corrected',
        promptVersion: 'deterministic-rubric',
        reviewStatus: 'CORRECTED',
        updatedAt: now,
      });
    } else {
      await ctx.db.insert('parsedCvs', {
        applicationId: application._id,
        data: cv,
        corrections: cv,
        parserModel: 'candidate-corrected',
        promptVersion: 'deterministic-rubric',
        reviewStatus: 'CORRECTED',
        createdAt: now,
        updatedAt: now,
      });
    }
    await scoreAndStore(ctx, application._id, { cv, source: 'candidate_edit' });
    await writeAudit(ctx, { id: auth.user._id, role: 'CANDIDATE' }, 'PARSED_CV_CORRECTED', 'Application', application._id);
    return { ok: true };
  },
});

/** Right to request human review of AI-assisted screening. */
export const requestHumanReview = mutation({
  args: { token: v.string(), id: v.id('applications'), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { auth, application } = await loadCandidateApplication(ctx, args.token, args.id);
    if (application.humanReviewRequestedAt) return { ok: true, alreadyRequested: true };

    await ctx.db.patch(application._id, { humanReviewRequestedAt: Date.now(), updatedAt: Date.now() });
    await writeAudit(ctx, { id: auth.user._id, role: 'CANDIDATE' }, 'HUMAN_REVIEW_REQUESTED', 'Application', application._id, {
      note: args.note,
    });

    const job = await ctx.db.get(application.jobId);
    if (job) {
      const organisation = await ctx.db.get(job.organisationId);
      const recipients = new Set<string>([job.recruiterId]);
      if (organisation) {
        const users = await ctx.db
          .query('users')
          .withIndex('by_organisation', (q) => q.eq('organisationId', organisation._id))
          .collect();
        for (const user of users) if (user.role === 'ADMIN') recipients.add(user._id);
      }
      for (const userId of recipients) {
        await notify(ctx, {
          userId: userId as never,
          type: 'SYSTEM',
          title: 'Human review requested',
          body: `A candidate requested human review for ${job.title}. Review the application manually and record your reasoning.`,
          data: { applicationId: application._id, jobId: job._id },
        });
      }
    }

    await notify(ctx, {
      userId: auth.user._id,
      type: 'SYSTEM',
      title: 'Human review requested',
      body: `Your request for human review of your application for ${job?.title ?? 'this role'} has been recorded. A recruiter will review your application manually.`,
      data: { applicationId: application._id },
    });
    return { ok: true };
  },
});
