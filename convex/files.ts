import { internalMutation, internalQuery, mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { fail, requireUser } from '../shared/authz';
import { parseCvHeuristically, type ParsedCVData } from '../shared/domain';
import { scoreAndStore } from '../shared/evaluate';

export const MAX_CV_BYTES = 4 * 1024 * 1024;

export const ALLOWED_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
];

export const generateUploadUrl = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireUser(ctx, args.token);
    return await ctx.storage.generateUploadUrl();
  },
});

export const generateUploadUrlAsSeed = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const secret = process.env.SEED_TOKEN;
    if (!secret || args.token !== secret) fail('FORBIDDEN', 'Seeding is not enabled on this deployment.');
    return await ctx.storage.generateUploadUrl();
  },
});

export const cvFileForApplication = internalQuery({
  args: { applicationId: v.id('applications') },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('cvFiles')
      .withIndex('by_application', (q) => q.eq('applicationId', args.applicationId))
      .unique();
  },
});

export const markExtraction = internalMutation({
  args: {
    cvFileId: v.id('cvFiles'),
    status: v.union(v.literal('PENDING'), v.literal('PROCESSING'), v.literal('COMPLETED'), v.literal('FAILED')),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.cvFileId, {
      extractionStatus: args.status,
      extractionError: args.error,
      updatedAt: Date.now(),
    });
  },
});

export const saveExtractedText = internalMutation({
  args: { cvFileId: v.id('cvFiles'), applicationId: v.id('applications'), text: v.string() },
  handler: async (ctx, args) => {
    const parsed = parseCvHeuristically(args.text);
    const now = Date.now();
    await ctx.db.patch(args.cvFileId, {
      extractionStatus: 'COMPLETED',
      extractedText: args.text,
      extractionError: undefined,
      updatedAt: now,
    });
    const existing = await ctx.db
      .query('parsedCvs')
      .withIndex('by_application', (q) => q.eq('applicationId', args.applicationId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        data: parsed,
        cvFileId: args.cvFileId,
        parserModel: 'heuristic-v1',
        promptVersion: 'deterministic-rubric',
        reviewStatus: 'PARSED',
        updatedAt: now,
      });
    } else {
      await ctx.db.insert('parsedCvs', {
        applicationId: args.applicationId,
        cvFileId: args.cvFileId,
        data: parsed,
        parserModel: 'heuristic-v1',
        promptVersion: 'deterministic-rubric',
        reviewStatus: 'PARSED',
        createdAt: now,
        updatedAt: now,
      });
    }
    await scoreAndStore(ctx, args.applicationId, { cv: parsed as ParsedCVData, source: 'pipeline' });
  },
});

/**
 * Download link for a CV. Candidates may always fetch their own; recruiters
 * only after an audited identity reveal while blind screening is on.
 */
export const cvUrl = query({
  args: { token: v.string(), applicationId: v.id('applications') },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const application = await ctx.db.get(args.applicationId);
    if (!application) fail('NOT_FOUND', 'No CV on this application');
    const job = await ctx.db.get(application.jobId);
    if (!job) fail('NOT_FOUND', 'Job not found');

    const isOwner = application.candidateId === auth.user._id;
    const isRecruiter = auth.role === 'ADMIN' || job.organisationId === auth.orgId;
    if (!isOwner && !isRecruiter) fail('FORBIDDEN', 'You do not have access to this CV.');
    if (!isOwner && job.blindScreening && !application.identityRevealedAt) {
      fail('FORBIDDEN', 'Blind screening is on: the original CV stays hidden until you reveal the candidate.');
    }

    const file = await ctx.db
      .query('cvFiles')
      .withIndex('by_application', (q) => q.eq('applicationId', application._id))
      .unique();
    if (!file?.storageId) fail('NOT_FOUND', 'No CV on this application');
    const url = await ctx.storage.getUrl(file.storageId);
    if (!url) fail('NOT_FOUND', 'This CV is no longer available.');
    return { url, filename: file.filename, mimeType: file.mimeType };
  },
});
