import { mutation } from './_generated/server';
import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { parseCvHeuristically, type ParsedCVData } from '../shared/domain';
import { scoreAndStore } from '../shared/evaluate';
import { notify, writeAudit } from '../shared/shared';

/**
 * Demo seeding. Every entry point requires SEED_TOKEN to be set on the
 * deployment and passed back in, so these mutations are inert in production
 * unless an operator deliberately enables them.
 */

function assertSeed(token: string) {
  const secret = process.env.SEED_TOKEN;
  if (!secret || token !== secret) {
    throw new Error(JSON.stringify({ code: 'FORBIDDEN', message: 'Seeding is not enabled on this deployment.' }));
  }
}

async function clearAll(ctx: any) {
  for (const table of [
    'applications',
    'cvFiles',
    'parsedCvs',
    'scores',
    'knockoutAnswers',
    'statusHistory',
    'notes',
    'interviews',
    'interviewSlots',
    'availabilityWindows',
    'notifications',
    'notificationPreferences',
    'auditLogs',
    'biasReports',
    'counterfactualRuns',
    'consentRecords',
    'dataRequests',
    'demographicDeclarations',
    'emailTokens',
    'sessions',
    'candidateProfiles',
    'jobs',
    'jobCriteria',
    'knockoutQuestions',
    'users',
    'organisations',
    'settings',
  ] as const) {
    const rows = await ctx.db.query(table).collect();
    for (const row of rows) await ctx.db.delete(row._id);
  }
}

export const reset = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    assertSeed(args.token);
    await clearAll(ctx);
    return { ok: true };
  },
});

export const createWorld = mutation({
  args: {
    token: v.string(),
    admin: v.object({ email: v.string(), passwordHash: v.string(), fullName: v.string() }),
    organisations: v.array(v.object({ name: v.string(), slug: v.string(), sector: v.optional(v.string()) })),
    users: v.array(
      v.object({
        email: v.string(),
        passwordHash: v.string(),
        fullName: v.string(),
        role: v.union(v.literal('RECRUITER'), v.literal('CANDIDATE')),
        organisationSlug: v.optional(v.string()),
      }),
    ),
    jobs: v.array(
      v.object({
        organisationSlug: v.string(),
        title: v.string(),
        slug: v.string(),
        description: v.string(),
        location: v.string(),
        employmentType: v.union(
          v.literal('FULL_TIME'),
          v.literal('PART_TIME'),
          v.literal('CONTRACT'),
          v.literal('INTERNSHIP'),
          v.literal('NYSC'),
        ),
        deadlineDays: v.number(),
        openings: v.number(),
        status: v.union(v.literal('DRAFT'), v.literal('OPEN'), v.literal('CLOSED')),
        blindScreening: v.boolean(),
        hideUniversityBlind: v.boolean(),
        biasDemoMode: v.boolean(),
        criteria: v.array(
          v.object({
            kind: v.union(v.literal('MUST_HAVE'), v.literal('NICE_TO_HAVE')),
            type: v.union(
              v.literal('SKILL'),
              v.literal('DEGREE_LEVEL'),
              v.literal('DEGREE_CLASS'),
              v.literal('FIELD_OF_STUDY'),
              v.literal('EXPERIENCE'),
              v.literal('CERTIFICATION'),
              v.literal('LANGUAGE'),
            ),
            label: v.string(),
            weight: v.number(),
            config: v.any(),
          }),
        ),
        knockouts: v.array(
          v.object({
            type: v.union(
              v.literal('NYSC'),
              v.literal('DEGREE_CLASS'),
              v.literal('LOCATION'),
              v.literal('AVAILABILITY'),
              v.literal('WORK_AUTH'),
            ),
            prompt: v.string(),
            config: v.any(),
          }),
        ),
      }),
    ),
  },
  handler: async (ctx, args) => {
    assertSeed(args.token);
    const now = Date.now();

    const orgIds = new Map<string, Id<'organisations'>>();
    for (const org of args.organisations) {
      orgIds.set(
        org.slug,
        await ctx.db.insert('organisations', {
          name: org.name,
          slug: org.slug,
          sector: org.sector,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }

    const adminId = await ctx.db.insert('users', {
      email: args.admin.email,
      passwordHash: args.admin.passwordHash,
      fullName: args.admin.fullName,
      role: 'ADMIN',
      isActive: true,
      emailVerifiedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const userIds: { id: Id<'users'>; email: string; role: string; fullName: string }[] = [];
    for (const user of args.users) {
      const organisationId = user.organisationSlug ? orgIds.get(user.organisationSlug) : undefined;
      const id = await ctx.db.insert('users', {
        email: user.email,
        passwordHash: user.passwordHash,
        fullName: user.fullName,
        role: user.role,
        organisationId,
        isActive: true,
        emailVerifiedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      if (user.role === 'CANDIDATE') {
        await ctx.db.insert('candidateProfiles', { userId: id, createdAt: now, updatedAt: now });
      }
      await ctx.db.insert('consentRecords', {
        userId: id,
        purpose: 'ai_screening',
        version: '2026-02-v1',
        grantedAt: now,
      });
      await ctx.db.insert('notificationPreferences', {
        userId: id,
        email: true,
        sms: false,
        whatsapp: false,
        inApp: true,
        updatedAt: now,
      });
      userIds.push({ id, email: user.email, role: user.role, fullName: user.fullName });
    }

    const jobIds: { id: Id<'jobs'>; title: string; slug: string; organisationId: Id<'organisations'> }[] = [];
    for (const job of args.jobs) {
      const organisationId = orgIds.get(job.organisationSlug)!;
      const recruiter = userIds.find((u) => u.role === 'RECRUITER');
      if (!organisationId || !recruiter) throw new Error('Seed job has no organisation or recruiter.');
      const jobId = await ctx.db.insert('jobs', {
        organisationId,
        recruiterId: recruiter.id,
        title: job.title,
        slug: job.slug,
        description: job.description,
        location: job.location,
        employmentType: job.employmentType,
        deadline: now + job.deadlineDays * 86_400_000,
        openings: job.openings,
        status: job.status,
        minYearsExperience: 0,
        blindScreening: job.blindScreening,
        hideUniversityBlind: job.hideUniversityBlind,
        biasDemoMode: job.biasDemoMode,
        createdAt: now,
        updatedAt: now,
      });
      for (const [index, criterion] of job.criteria.entries()) {
        await ctx.db.insert('jobCriteria', {
          jobId,
          kind: criterion.kind,
          type: criterion.type,
          label: criterion.label,
          weight: criterion.weight,
          config: criterion.config,
          order: index,
        });
      }
      for (const [index, knockout] of job.knockouts.entries()) {
        await ctx.db.insert('knockoutQuestions', {
          jobId,
          type: knockout.type,
          prompt: knockout.prompt,
          options: [],
          config: knockout.config,
          order: index,
        });
      }
      jobIds.push({ id: jobId, title: job.title, slug: job.slug, organisationId });
    }

    return {
      adminId,
      users: userIds,
      jobs: jobIds,
      organisations: args.organisations.map((org) => ({ ...org, id: orgIds.get(org.slug) })),
    };
  },
});

/** Attaches a rendered CV to an application and scores it immediately. */
export const attachApplication = mutation({
  args: {
    token: v.string(),
    candidateId: v.id('users'),
    jobId: v.id('jobs'),
    storageId: v.id('_storage'),
    filename: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    text: v.string(),
    createdAt: v.number(),
    knockoutPassed: v.boolean(),
  },
  handler: async (ctx, args) => {
    assertSeed(args.token);
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error('Seed job missing.');
    const parsed = parseCvHeuristically(args.text);
    const ref = `ANON-${args.candidateId.slice(-6).toUpperCase()}`;
    const now = args.createdAt;

    const applicationId = await ctx.db.insert('applications', {
      jobId: args.jobId,
      candidateId: args.candidateId,
      publicRef: ref,
      coverLetter: undefined,
      stage: 'APPLIED',
      knockoutPassed: args.knockoutPassed,
      knockoutFlags: args.knockoutPassed
        ? []
        : [{ questionId: 'seed', prompt: 'Are you available to start immediately?', answer: 'Within 90 days', reason: 'Stated availability is later than the role requires.' }],
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert('cvFiles', {
      applicationId,
      candidateId: args.candidateId,
      filename: args.filename,
      mimeType: args.mimeType,
      sizeBytes: args.sizeBytes,
      storageId: args.storageId,
      storageKey: `cvs/${args.candidateId}/${applicationId}`,
      checksum: '',
      extractionStatus: 'COMPLETED',
      extractedText: args.text.slice(0, 200_000),
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert('parsedCvs', {
      applicationId,
      data: parsed as ParsedCVData,
      parserModel: 'heuristic-v1',
      promptVersion: 'deterministic-rubric',
      reviewStatus: 'PARSED',
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert('statusHistory', {
      applicationId,
      toStage: 'APPLIED',
      actorId: args.candidateId,
      reason: 'Application submitted',
      createdAt: now,
    });
    await scoreAndStore(ctx, applicationId, { cv: parsed as ParsedCVData, source: 'pipeline' });
    return { applicationId };
  },
});

/** Shortlists a share of screened applications so the pipeline is not empty. */
export const shortlistSome = mutation({
  args: { token: v.string(), jobId: v.id('jobs'), percentile: v.number(), limit: v.number() },
  handler: async (ctx, args) => {
    assertSeed(args.token);
    const applications = await ctx.db
      .query('applications')
      .withIndex('by_job', (q) => q.eq('jobId', args.jobId))
      .collect();
    const scored = applications.filter((a) => typeof a.score === 'number').sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const take = Math.min(args.limit, Math.floor((scored.length * args.percentile) / 100));
    const now = Date.now();
    for (const application of scored.slice(0, take)) {
      await ctx.db.patch(application._id, { stage: 'SHORTLISTED', shortlistedAt: now, updatedAt: now });
      await ctx.db.insert('statusHistory', {
        applicationId: application._id,
        fromStage: application.stage,
        toStage: 'SHORTLISTED',
        reason: 'Shortlisted by the hiring panel after human review',
        createdAt: now,
      });
    }
    return { shortlisted: take };
  },
});

/** Creates an availability window, books one candidate and adds an interview. */
export const scheduleInterview = mutation({
  args: { token: v.string(), jobId: v.id('jobs'), recruiterId: v.id('users'), inDays: v.number() },
  handler: async (ctx, args) => {
    assertSeed(args.token);
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error('Seed job missing.');
    const shortlisted = (
      await ctx.db
        .query('applications')
        .withIndex('by_job_stage', (q) => q.eq('jobId', args.jobId).eq('stage', 'SHORTLISTED'))
        .collect()
    ).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    if (!shortlisted.length) return { ok: false };

    const start = new Date();
    start.setDate(start.getDate() + args.inDays);
    start.setHours(9, 0, 0, 0);
    const startsAt = start.getTime();
    const endsAt = startsAt + 4 * 3600_000;
    const now = Date.now();

    const windowId = await ctx.db.insert('availabilityWindows', {
      jobId: args.jobId,
      recruiterId: args.recruiterId,
      startsAt,
      endsAt,
      slotMinutes: 30,
      bufferMinutes: 10,
      timezone: 'Africa/Lagos',
      interviewType: 'VIDEO',
      location: 'Google Meet',
      createdAt: now,
    });

    const slotIds: Id<'interviewSlots'>[] = [];
    for (let t = startsAt; t + 30 * 60_000 <= endsAt; t += 40 * 60_000) {
      slotIds.push(
        await ctx.db.insert('interviewSlots', {
          windowId,
          jobId: args.jobId,
          startsAt: t,
          endsAt: t + 30 * 60_000,
          createdAt: now,
        }),
      );
    }

    const application = shortlisted[0];
    await ctx.db.patch(application._id, { stage: 'INTERVIEW', updatedAt: now });
    await ctx.db.patch(slotIds[0], { applicationId: application._id });
    await ctx.db.insert('interviews', {
      slotId: slotIds[0],
      applicationId: application._id,
      status: 'SCHEDULED',
      type: 'VIDEO',
      location: 'Google Meet',
      meetingLink: `https://meet.example.com/${application.publicRef.toLowerCase()}`,
      interviewerIds: [],
      icsUid: `${application._id}-${now.toString(36)}@ise`,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert('statusHistory', {
      applicationId: application._id,
      fromStage: 'SHORTLISTED',
      toStage: 'INTERVIEW',
      reason: 'Interview booked',
      createdAt: now,
    });
    await notify(ctx, {
      userId: application.candidateId,
      type: 'INTERVIEW_SCHEDULED',
      title: 'Interview scheduled',
      body: 'Your interview has been scheduled. Open your dashboard for the time and calendar file.',
      data: { applicationId: application._id, jobId: args.jobId },
    });
    await writeAudit(ctx, { id: args.recruiterId, role: 'RECRUITER' }, 'INTERVIEW_BOOKED', 'Interview', `${slotIds[0]}`, {
      seeded: true,
    });
    return { ok: true, applicationId: application._id };
  },
});

export const summarise = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    assertSeed(args.token);
    const users = await ctx.db.query('users').collect();
    const applications = await ctx.db.query('applications').collect();
    const jobs = await ctx.db.query('jobs').collect();
    return {
      users: users.length,
      candidates: users.filter((u) => u.role === 'CANDIDATE').length,
      jobs: jobs.length,
      applications: applications.length,
      scored: applications.filter((a) => typeof a.score === 'number').length,
      shortlisted: applications.filter((a) => a.stage === 'SHORTLISTED').length,
    };
  },
});
