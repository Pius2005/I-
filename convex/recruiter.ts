import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import {
  APP_URL,
  assertApplicationAccess,
  assertJobAccess,
  fail,
  requireUser,
  type AuthContext,
} from '../shared/authz';
import { buildBlindView, type ParsedCVData } from '../shared/domain';
import { notify, paginate, pagination, writeAudit } from '../shared/shared';
import { scoreAndStore } from '../shared/evaluate';

const STAGES = ['APPLIED', 'SCREENED', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED'] as const;

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70);
}

async function jobIdsFor(ctx: any, auth: AuthContext) {
  if (auth.role === 'ADMIN') {
    return (await ctx.db.query('jobs').collect()).map((j: Doc<'jobs'>) => j._id);
  }
  if (!auth.orgId) return [];
  const jobs = await ctx.db
    .query('jobs')
    .withIndex('by_organisation_status', (q: any) => q.eq('organisationId', auth.orgId))
    .collect();
  return jobs.map((j: Doc<'jobs'>) => j._id);
}

async function applicationsForJobs(ctx: any, jobIds: Id<'jobs'>[]) {
  const rows: Doc<'applications'>[] = [];
  for (const jobId of jobIds) {
    rows.push(
      ...(await ctx.db
        .query('applications')
        .withIndex('by_job', (q: any) => q.eq('jobId', jobId))
        .collect()),
    );
  }
  return rows;
}

// --- Dashboard --------------------------------------------------------------

export const dashboard = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    if (auth.role === 'CANDIDATE') fail('FORBIDDEN', 'Recruiters only.');
    const jobIds = await jobIdsFor(ctx, auth);
    const jobs = (await Promise.all(jobIds.map((id: Id<'jobs'>) => ctx.db.get(id)))).filter(Boolean) as Doc<'jobs'>[];
    jobs.sort((a, b) => b.createdAt - a.createdAt);

    const applications = await applicationsForJobs(ctx, jobIds);
    const byStage: Record<string, number> = {};
    for (const application of applications) byStage[application.stage] = (byStage[application.stage] ?? 0) + 1;

    const allInterviews = await ctx.db.query('interviews').collect();
    const upcoming = [];
    for (const interview of allInterviews) {
      if (interview.status !== 'SCHEDULED') continue;
      const application = await ctx.db.get(interview.applicationId);
      if (!application || !jobIds.includes(application.jobId)) continue;
      const slot = await ctx.db.get(interview.slotId);
      if (slot && slot.startsAt >= Date.now()) upcoming.push(interview);
    }

    const recent = applications.sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);
    const recentApplications = await Promise.all(
      recent.map(async (application) => {
        const job = await ctx.db.get(application.jobId);
        const candidate = await ctx.db.get(application.candidateId);
        return {
          id: application._id,
          publicRef: application.publicRef,
          stage: application.stage,
          score: application.score ?? null,
          createdAt: application.createdAt,
          identityRevealedAt: application.identityRevealedAt ?? null,
          knockoutPassed: application.knockoutPassed,
          job: job ? { id: job._id, title: job.title } : null,
          name: application.identityRevealedAt ? candidate?.fullName ?? application.publicRef : application.publicRef,
        };
      }),
    );

    const scored = applications.filter((a) => typeof a.score === 'number');
    const distribution = Array.from({ length: 10 }, (_, i) => ({
      bucket: `${i * 10}-${i * 10 + 9}`,
      count: scored.filter((a) => (a.score ?? 0) >= i * 10 && (a.score ?? 0) < i * 10 + 10).length,
    }));
    const shortlisted = applications.filter((a) => a.shortlistedAt);
    const avgDays = shortlisted.length
      ? shortlisted.reduce((sum, a) => sum + (a.shortlistedAt! - a.createdAt) / 86_400_000, 0) / shortlisted.length
      : null;

    return {
      jobs: jobs.slice(0, 10).map((job) => ({
        id: job._id,
        title: job.title,
        status: job.status,
        deadline: job.deadline,
        openings: job.openings,
        createdAt: job.createdAt,
      })),
      jobCount: jobs.length,
      openJobs: jobs.filter((j) => j.status === 'OPEN').length,
      applications: applications.length,
      byStage,
      upcomingInterviews: upcoming.length,
      recentApplications,
      scoreDistribution: distribution,
      avgDaysToShortlist: avgDays ? Number(avgDays.toFixed(1)) : null,
    };
  },
});

// --- Jobs -------------------------------------------------------------------

export const jobs = query({
  args: {
    token: v.string(),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    status: v.optional(v.string()),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    if (auth.role === 'CANDIDATE') fail('FORBIDDEN', 'Recruiters only.');
    const { page, pageSize, skip } = pagination(args);
    const ids = await jobIdsFor(ctx, auth);
    const search = args.search?.trim().toLowerCase();

    const rows = ((await Promise.all(ids.map((id: Id<'jobs'>) => ctx.db.get(id)))).filter(Boolean) as Doc<'jobs'>[])
      .filter((job) => (args.status ? job.status === args.status : true))
      .filter((job) => (search ? job.title.toLowerCase().includes(search) : true))
      .sort((a, b) => b.createdAt - a.createdAt);

    const slice = rows.slice(skip, skip + pageSize);
    const items = await Promise.all(
      slice.map(async (job) => {
        const organisation = await ctx.db.get(job.organisationId);
        const applications = await ctx.db
          .query('applications')
          .withIndex('by_job', (q) => q.eq('jobId', job._id))
          .collect();
        const criteria = await ctx.db
          .query('jobCriteria')
          .withIndex('by_job', (q) => q.eq('jobId', job._id))
          .collect();
        return {
          ...job,
          id: job._id,
          organisation: organisation ? { name: organisation.name } : null,
          _count: { applications: applications.length },
          criteriaWeightTotal: criteria.reduce((sum, c) => sum + c.weight, 0),
        };
      }),
    );
    return paginate(items, rows.length, page, pageSize);
  },
});

const criteriaValidator = v.array(
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
    config: v.optional(v.any()),
  }),
);

const knockoutValidator = v.array(
  v.object({
    type: v.union(
      v.literal('NYSC'),
      v.literal('DEGREE_CLASS'),
      v.literal('LOCATION'),
      v.literal('AVAILABILITY'),
      v.literal('WORK_AUTH'),
    ),
    prompt: v.string(),
    options: v.optional(v.array(v.string())),
    config: v.optional(v.any()),
  }),
);

function assertWeights(criteria: { weight: number }[]) {
  if (!criteria.length) fail('BAD_REQUEST', 'Add at least one criterion so scoring has a rubric.');
  const total = criteria.reduce((sum, c) => sum + c.weight, 0);
  if (total !== 100) fail('BAD_REQUEST', `Criterion weights must total 100% (currently ${total}%).`);
}

export const createJob = mutation({
  args: {
    token: v.string(),
    title: v.string(),
    description: v.string(),
    location: v.string(),
    employmentType: v.union(
      v.literal('FULL_TIME'),
      v.literal('PART_TIME'),
      v.literal('CONTRACT'),
      v.literal('INTERNSHIP'),
      v.literal('NYSC'),
    ),
    deadline: v.number(),
    openings: v.number(),
    minYearsExperience: v.number(),
    blindScreening: v.boolean(),
    hideUniversityBlind: v.boolean(),
    biasDemoMode: v.boolean(),
    status: v.union(v.literal('DRAFT'), v.literal('OPEN'), v.literal('CLOSED')),
    criteria: criteriaValidator,
    knockoutQuestions: knockoutValidator,
  },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    if (auth.role === 'CANDIDATE') fail('FORBIDDEN', 'Recruiters only.');
    if (!auth.orgId) fail('BAD_REQUEST', 'Your account is not linked to an organisation.');
    if (args.title.trim().length < 3 || args.description.trim().length < 40) {
      fail('BAD_REQUEST', 'Give the role a title and a description of at least 40 characters.');
    }
    assertWeights(args.criteria);
    if (args.biasDemoMode && process.env.ALLOW_BIAS_DEMO === 'false') {
      fail('BAD_REQUEST', 'The bias demo rule is disabled on this server.');
    }

    const base = slugify(args.title) || 'job';
    let slug = base;
    let attempt = 1;
    while (
      await ctx.db
        .query('jobs')
        .withIndex('by_slug', (q) => q.eq('slug', slug))
        .unique()
    ) {
      slug = `${base}-${attempt}`;
      attempt += 1;
    }

    const now = Date.now();
    const jobId = await ctx.db.insert('jobs', {
      organisationId: auth.orgId,
      recruiterId: auth.user._id,
      title: args.title.trim(),
      slug,
      description: args.description.trim(),
      location: args.location.trim(),
      employmentType: args.employmentType,
      deadline: args.deadline,
      openings: args.openings,
      status: args.status,
      minYearsExperience: args.minYearsExperience,
      blindScreening: args.blindScreening,
      hideUniversityBlind: args.hideUniversityBlind,
      biasDemoMode: args.biasDemoMode,
      createdAt: now,
      updatedAt: now,
    });

    for (const [index, criterion] of args.criteria.entries()) {
      await ctx.db.insert('jobCriteria', {
        jobId,
        kind: criterion.kind,
        type: criterion.type,
        label: criterion.label,
        weight: criterion.weight,
        config: criterion.config ?? {},
        order: index,
      });
    }
    for (const [index, question] of args.knockoutQuestions.entries()) {
      await ctx.db.insert('knockoutQuestions', {
        jobId,
        type: question.type,
        prompt: question.prompt,
        options: question.options ?? [],
        config: question.config ?? {},
        order: index,
      });
    }
    await writeAudit(ctx, { id: auth.user._id, role: auth.role }, 'JOB_CREATED', 'Job', jobId, {
      title: args.title,
      status: args.status,
    });
    return await ctx.db.get(jobId);
  },
});

export const job = query({
  args: { token: v.string(), id: v.id('jobs') },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const record = await assertJobAccess(ctx, auth, args.id);
    const criteria = await ctx.db
      .query('jobCriteria')
      .withIndex('by_job', (q) => q.eq('jobId', record._id))
      .collect();
    const knockouts = await ctx.db
      .query('knockoutQuestions')
      .withIndex('by_job', (q) => q.eq('jobId', record._id))
      .collect();
    const organisation = await ctx.db.get(record.organisationId);
    const applications = await ctx.db
      .query('applications')
      .withIndex('by_job', (q) => q.eq('jobId', record._id))
      .collect();
    const byStage: Record<string, number> = {};
    for (const application of applications) byStage[application.stage] = (byStage[application.stage] ?? 0) + 1;
    const interviews = await ctx.db.query('interviews').collect();
    let interviewCount = 0;
    for (const interview of interviews) {
      if (interview.status !== 'SCHEDULED') continue;
      const application = await ctx.db.get(interview.applicationId);
      if (application?.jobId === record._id) interviewCount += 1;
    }
    return {
      ...record,
      id: record._id,
      organisation: organisation ? { id: organisation._id, name: organisation.name, slug: organisation.slug } : null,
      criteria: criteria.sort((a, b) => a.order - b.order).map((c) => ({ ...c, id: c._id })),
      knockoutQuestions: knockouts.sort((a, b) => a.order - b.order).map((q) => ({ ...q, id: q._id })),
      stats: {
        totalApplications: applications.length,
        byStage,
        interviews: interviewCount,
      },
    };
  },
});

export const updateJob = mutation({
  args: {
    token: v.string(),
    id: v.id('jobs'),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    location: v.optional(v.string()),
    employmentType: v.optional(
      v.union(
        v.literal('FULL_TIME'),
        v.literal('PART_TIME'),
        v.literal('CONTRACT'),
        v.literal('INTERNSHIP'),
        v.literal('NYSC'),
      ),
    ),
    deadline: v.optional(v.number()),
    openings: v.optional(v.number()),
    minYearsExperience: v.optional(v.number()),
    blindScreening: v.optional(v.boolean()),
    hideUniversityBlind: v.optional(v.boolean()),
    biasDemoMode: v.optional(v.boolean()),
    status: v.optional(v.union(v.literal('DRAFT'), v.literal('OPEN'), v.literal('CLOSED'))),
    criteria: v.optional(criteriaValidator),
    knockoutQuestions: v.optional(knockoutValidator),
  },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const existing = await assertJobAccess(ctx, auth, args.id);
    if (args.criteria) assertWeights(args.criteria);
    if (args.biasDemoMode && process.env.ALLOW_BIAS_DEMO === 'false') {
      fail('BAD_REQUEST', 'The bias demo rule is disabled on this server.');
    }

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const key of [
      'title',
      'description',
      'location',
      'employmentType',
      'deadline',
      'openings',
      'minYearsExperience',
      'blindScreening',
      'hideUniversityBlind',
      'biasDemoMode',
      'status',
    ] as const) {
      if (args[key] !== undefined) patch[key] = args[key];
    }
    if (args.status === 'CLOSED') patch.closedAt = Date.now();
    await ctx.db.patch(existing._id, patch);

    if (args.criteria) {
      const current = await ctx.db
        .query('jobCriteria')
        .withIndex('by_job', (q) => q.eq('jobId', existing._id))
        .collect();
      for (const criterion of current) await ctx.db.delete(criterion._id);
      for (const [index, criterion] of args.criteria.entries()) {
        await ctx.db.insert('jobCriteria', {
          jobId: existing._id,
          kind: criterion.kind,
          type: criterion.type,
          label: criterion.label,
          weight: criterion.weight,
          config: criterion.config ?? {},
          order: index,
        });
      }
    }

    if (args.knockoutQuestions) {
      const current = await ctx.db
        .query('knockoutQuestions')
        .withIndex('by_job', (q) => q.eq('jobId', existing._id))
        .collect();
      const answered = new Set<string>();
      const applications = await ctx.db
        .query('applications')
        .withIndex('by_job', (q) => q.eq('jobId', existing._id))
        .collect();
      for (const application of applications) {
        const answers = await ctx.db
          .query('knockoutAnswers')
          .withIndex('by_application', (q) => q.eq('applicationId', application._id))
          .collect();
        for (const answer of answers) answered.add(answer.questionId);
      }

      const stable = (value: unknown): string => {
        if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
        if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
        const entries = Object.entries(value as Record<string, unknown>)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => a.localeCompare(b));
        return `{${entries.map(([k, val]) => `${JSON.stringify(k)}:${stable(val)}`).join(',')}}`;
      };

      const locked = current.filter((q) => answered.has(q._id));
      for (const question of locked) {
        const replacement = args.knockoutQuestions[question.order];
        const unchanged =
          replacement &&
          replacement.type === question.type &&
          replacement.prompt === question.prompt &&
          stable(replacement.config ?? {}) === stable(question.config ?? {});
        if (!unchanged) {
          fail(
            'BAD_REQUEST',
            'A knockout question already has candidate answers, so it cannot be edited or removed. Add a new question instead.',
          );
        }
      }

      for (const question of current) {
        if (answered.has(question._id)) continue;
        const answers = await ctx.db
          .query('knockoutAnswers')
          .withIndex('by_question', (q) => q.eq('questionId', question._id))
          .collect();
        for (const answer of answers) await ctx.db.delete(answer._id);
        await ctx.db.delete(question._id);
      }
      const lockedOrders = new Set(locked.map((q) => q.order));
      for (const [index, question] of args.knockoutQuestions.entries()) {
        if (lockedOrders.has(index)) continue;
        await ctx.db.insert('knockoutQuestions', {
          jobId: existing._id,
          type: question.type,
          prompt: question.prompt,
          options: question.options ?? [],
          config: question.config ?? {},
          order: index,
        });
      }
    }

    await writeAudit(ctx, { id: auth.user._id, role: auth.role }, 'JOB_UPDATED', 'Job', existing._id, {
      changes: Object.keys(args).filter((k) => k !== 'token'),
      criteriaReplaced: Boolean(args.criteria),
    });

    if (args.criteria) {
      const applications = await ctx.db
        .query('applications')
        .withIndex('by_job', (q) => q.eq('jobId', existing._id))
        .collect();
      for (const application of applications) {
        const parsed = await ctx.db
          .query('parsedCvs')
          .withIndex('by_application', (q) => q.eq('applicationId', application._id))
          .unique();
        if (parsed) await scoreAndStore(ctx, application._id, { cv: parsed.data as ParsedCVData, source: 'pipeline' });
      }
    }
    return await ctx.db.get(existing._id);
  },
});

export const setJobStatus = mutation({
  args: { token: v.string(), id: v.id('jobs'), status: v.union(v.literal('DRAFT'), v.literal('OPEN'), v.literal('CLOSED')) },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const existing = await assertJobAccess(ctx, auth, args.id);
    await ctx.db.patch(existing._id, {
      status: args.status,
      updatedAt: Date.now(),
      ...(args.status === 'CLOSED' ? { closedAt: Date.now() } : {}),
    });
    await writeAudit(ctx, { id: auth.user._id, role: auth.role }, 'JOB_STATUS_CHANGED', 'Job', existing._id, {
      from: existing.status,
      to: args.status,
    });
    return await ctx.db.get(existing._id);
  },
});

// --- Pipeline ---------------------------------------------------------------

export const jobApplications = query({
  args: {
    token: v.string(),
    jobId: v.id('jobs'),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    stage: v.optional(v.string()),
    sort: v.optional(v.string()),
    search: v.optional(v.string()),
    knockout: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const job = await assertJobAccess(ctx, auth, args.jobId);
    const { page, pageSize, skip } = pagination(args);
    const search = args.search?.trim().toLowerCase();

    let rows = (
      await ctx.db
        .query('applications')
        .withIndex('by_job', (q) => q.eq('jobId', job._id))
        .collect()
    ).filter((a) => (args.stage ? a.stage === args.stage : true));
    if (args.knockout === 'passed') rows = rows.filter((a) => a.knockoutPassed);
    if (args.knockout === 'flagged') rows = rows.filter((a) => !a.knockoutPassed);
    if (search) {
      const filtered = [];
      for (const row of rows) {
        let match = row.publicRef.toLowerCase().includes(search);
        if (!match && row.identityRevealedAt) {
          const candidate = await ctx.db.get(row.candidateId);
          match = candidate?.fullName.toLowerCase().includes(search) ?? false;
        }
        if (match) filtered.push(row);
      }
      rows = filtered;
    }

    rows.sort((a, b) => {
      switch (args.sort) {
        case 'score_desc':
          return (b.score ?? -1) - (a.score ?? -1);
        case 'score_asc':
          return (a.score ?? 101) - (b.score ?? 101);
        case 'oldest':
          return a.createdAt - b.createdAt;
        default:
          return b.createdAt - a.createdAt;
      }
    });

    const slice = rows.slice(skip, skip + pageSize);
    const items = await Promise.all(
      slice.map(async (application) => {
        const parsed = await ctx.db
          .query('parsedCvs')
          .withIndex('by_application', (q) => q.eq('applicationId', application._id))
          .unique();
        const cvFile = await ctx.db
          .query('cvFiles')
          .withIndex('by_application', (q) => q.eq('applicationId', application._id))
          .unique();
        const interviews = await ctx.db
          .query('interviews')
          .withIndex('by_application', (q) => q.eq('applicationId', application._id))
          .collect();
        const cv = (parsed?.data ?? null) as ParsedCVData | null;
        const flags = Array.isArray(application.knockoutFlags) ? application.knockoutFlags : [];
        const hideUniversity = job.hideUniversityBlind && job.blindScreening && !application.identityRevealedAt;
        return {
          id: application._id,
          anonymousRef: application.publicRef,
          stage: application.stage,
          score: application.score ?? null,
          knockoutPassed: application.knockoutPassed,
          knockoutFlagCount: flags.length,
          humanReviewRequestedAt: application.humanReviewRequestedAt ?? null,
          identityRevealed: Boolean(application.identityRevealedAt),
          createdAt: application.createdAt,
          interviewCount: interviews.length,
          cvStatus: cvFile?.extractionStatus ?? 'NONE',
          cvError: cvFile?.extractionError ?? null,
          topSkills: cv?.skills?.slice(0, 6) ?? [],
          education:
            cv?.education?.map((e) => ({
              degreeLevel: e.degreeLevel,
              degreeClass: e.degreeClass,
              course: e.course,
              institution: hideUniversity ? 'Hidden' : e.institution,
            })) ?? [],
        };
      }),
    );
    return paginate(items, rows.length, page, pageSize);
  },
});

export const pipeline = query({
  args: { token: v.string(), jobId: v.id('jobs') },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const job = await assertJobAccess(ctx, auth, args.jobId);
    const applications = await ctx.db
      .query('applications')
      .withIndex('by_job', (q) => q.eq('jobId', job._id))
      .collect();

    const stages: Record<string, { count: number; items: unknown[] }> = {};
    for (const stage of STAGES) stages[stage] = { count: 0, items: [] };

    const ordered = [...applications].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.createdAt - a.createdAt);
    for (const application of ordered.slice(0, 800)) {
      const parsed = await ctx.db
        .query('parsedCvs')
        .withIndex('by_application', (q) => q.eq('applicationId', application._id))
        .unique();
      const cv = (parsed?.data ?? null) as ParsedCVData | null;
      const bucket = stages[application.stage];
      if (!bucket) continue;
      bucket.count += 1;
      bucket.items.push({
        id: application._id,
        anonymousRef: application.publicRef,
        score: application.score ?? null,
        stage: application.stage,
        knockoutPassed: application.knockoutPassed,
        knockoutFlagCount: Array.isArray(application.knockoutFlags) ? application.knockoutFlags.length : 0,
        identityRevealed: Boolean(application.identityRevealedAt),
        createdAt: application.createdAt,
        humanReviewRequestedAt: application.humanReviewRequestedAt ?? null,
        headline: cv?.headline ?? null,
        skills: cv?.skills?.slice(0, 4) ?? [],
      });
    }

    return {
      job: {
        id: job._id,
        title: job.title,
        blindScreening: job.blindScreening,
        hideUniversityBlind: job.hideUniversityBlind,
        stages: STAGES,
      },
      stages,
      total: applications.length,
    };
  },
});

export const applicationDetail = query({
  args: { token: v.string(), id: v.id('applications') },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    if (auth.role === 'CANDIDATE') fail('FORBIDDEN', 'Recruiters only.');
    const { application } = await assertApplicationAccess(ctx, auth, args.id);
    const job = await ctx.db.get(application.jobId);
    if (!job) fail('NOT_FOUND', 'Job not found');
    const organisation = await ctx.db.get(job.organisationId);
    const candidate = await ctx.db.get(application.candidateId);
    const profile = candidate
      ? await ctx.db
          .query('candidateProfiles')
          .withIndex('by_user', (q) => q.eq('userId', candidate._id))
          .unique()
      : null;
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
    const criteria = await ctx.db
      .query('jobCriteria')
      .withIndex('by_job', (q) => q.eq('jobId', job._id))
      .collect();

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

    const notes = await ctx.db
      .query('notes')
      .withIndex('by_application', (q) => q.eq('applicationId', application._id))
      .collect();
    const noteItems = [];
    for (const note of notes.sort((a, b) => b.createdAt - a.createdAt)) {
      const author = await ctx.db.get(note.authorId);
      noteItems.push({ ...note, id: note._id, author: { fullName: author?.fullName ?? 'Unknown' } });
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
    for (const interview of interviews) {
      interviewItems.push({ ...interview, id: interview._id, slot: await ctx.db.get(interview.slotId) });
    }
    const interviewSlots = await ctx.db
      .query('interviewSlots')
      .withIndex('by_application', (q) => q.eq('applicationId', application._id))
      .collect();

    const revealed = Boolean(application.identityRevealedAt);
    const blind = job.blindScreening && !revealed;
    const cv = (parsed?.data ?? null) as ParsedCVData | null;
    const blindView = buildBlindView({
      anonymousRef: application.publicRef,
      identityRevealed: !blind,
      candidate: {
        name: candidate?.fullName,
        email: candidate?.email,
        phone: candidate?.phone,
        location: profile?.location,
      },
      cv,
      cvText: blind ? null : cvFile?.extractedText ?? null,
      hideUniversity: job.hideUniversityBlind,
    });
    const stageIndex = ['APPLIED', 'SCREENED', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'HIRED'].indexOf(application.stage);

    return {
      id: application._id,
      job: {
        id: job._id,
        title: job.title,
        blindScreening: job.blindScreening,
        hideUniversityBlind: job.hideUniversityBlind,
        organisation: organisation?.name ?? '',
        criteria: criteria.sort((a, b) => a.order - b.order).map((c) => ({ ...c, id: c._id })),
        deadline: job.deadline,
      },
      stage: application.stage,
      score: application.score ?? null,
      scoredAt: application.scoredAt ?? null,
      aiRecommendedStage: application.aiRecommendedStage ?? null,
      aiRecommendationNote:
        'AI only recommends. Move, shortlist or reject candidates yourself; a written reason is required for overrides and rejections.',
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
      coverLetter: application.coverLetter ?? null,
      knockoutPassed: application.knockoutPassed,
      knockoutFlags: application.knockoutFlags,
      knockoutAnswers,
      cvStatus: cvFile?.extractionStatus ?? 'NONE',
      cvError: cvFile?.extractionError ?? null,
      cvFilename: cvFile?.filename ?? null,
      cv: blindView.cv,
      cvText: blindView.cvText,
      identityRevealed: revealed,
      identity: blindView.candidate ?? null,
      anonymousRef: application.publicRef,
      canReveal: job.blindScreening && !revealed && stageIndex >= 2,
      humanReviewRequestedAt: application.humanReviewRequestedAt ?? null,
      rejectionReason: application.rejectionReason ?? null,
      overrideReason: application.overrideReason ?? null,
      notes: noteItems,
      statusHistory: history.sort((a, b) => b.createdAt - a.createdAt),
      interviews: interviewItems,
      interviewSlots,
      createdAt: application.createdAt,
    };
  },
});

export const reveal = mutation({
  args: { token: v.string(), id: v.id('applications'), reason: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const { application, job } = await assertApplicationAccess(ctx, auth, args.id);
    if (args.reason.trim().length < 5) fail('BAD_REQUEST', 'Record why you need to see the candidate’s identity.');
    if (application.identityRevealedAt) return { ok: true, alreadyRevealed: true };
    const rank = ['APPLIED', 'SCREENED', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'HIRED'].indexOf(application.stage);
    if (rank < 2 && auth.role !== 'ADMIN') {
      fail('BAD_REQUEST', 'Identity is revealed only after a candidate is shortlisted.');
    }
    await ctx.db.patch(application._id, {
      identityRevealedAt: Date.now(),
      identityRevealedBy: auth.user._id,
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, { id: auth.user._id, role: auth.role }, 'IDENTITY_REVEALED', 'Application', application._id, {
      reason: args.reason,
      jobId: job._id,
      blindScreening: job.blindScreening,
    });
    return { ok: true };
  },
});

async function decideStage(
  ctx: any,
  auth: AuthContext,
  applicationId: Id<'applications'>,
  input: { stage: string; reason?: string; overrideReason?: string },
) {
  const application = await ctx.db.get(applicationId);
  if (!application) fail('NOT_FOUND', 'Application not found');
  const job = await ctx.db.get(application.jobId);
  if (!job) fail('NOT_FOUND', 'Job not found');
  if (auth.role !== 'ADMIN' && job.organisationId !== auth.orgId) fail('FORBIDDEN', 'You do not have access to that application.');

  const isRejection = input.stage === 'REJECTED';
  const aiSaidShortlist = application.aiRecommendedStage === 'SHORTLISTED';
  const movingToShortlist = input.stage === 'SHORTLISTED';
  const isOverride =
    (isRejection && aiSaidShortlist) || (movingToShortlist && application.aiRecommendedStage === 'SCREENED');

  if (isRejection && !input.reason?.trim()) fail('BAD_REQUEST', 'A written reason is required when rejecting a candidate.');
  if (isOverride && !input.overrideReason?.trim()) {
    fail(
      'BAD_REQUEST',
      'You are overriding the AI recommendation. Record why before continuing — the decision and reason are audited.',
    );
  }

  const now = Date.now();
  await ctx.db.patch(applicationId, {
    stage: input.stage,
    ...(movingToShortlist && !application.shortlistedAt ? { shortlistedAt: now } : {}),
    ...(isRejection ? { rejectionReason: input.reason } : {}),
    ...(isOverride ? { overrideReason: input.overrideReason } : {}),
    updatedAt: now,
  });
  await ctx.db.insert('statusHistory', {
    applicationId,
    fromStage: application.stage,
    toStage: input.stage,
    actorId: auth.user._id,
    reason: input.overrideReason || input.reason || null,
    createdAt: now,
  });
  await writeAudit(ctx, { id: auth.user._id, role: auth.role }, 'HUMAN_DECISION', 'Application', applicationId, {
    from: application.stage,
    to: input.stage,
    aiRecommendedStage: application.aiRecommendedStage,
    override: isOverride,
    reason: input.overrideReason || input.reason || null,
    jobId: application.jobId,
  });

  const candidate = await ctx.db.get(application.candidateId);
  if (input.stage === 'SHORTLISTED') {
    await notify(ctx, {
      userId: application.candidateId,
      type: 'SHORTLISTED',
      title: 'You have been shortlisted',
      body: `Hello ${candidate?.fullName.split(' ')[0] ?? 'there'}, you have been shortlisted for ${job.title}. The hiring team will contact you with interview options. Shortlisting is a human decision; the AI score informed but did not decide it.`,
      data: { applicationId, jobId: job._id },
    });
  } else if (isRejection || input.stage === 'HIRED') {
    await notify(ctx, {
      userId: application.candidateId,
      type: 'OUTCOME',
      title: 'Update on your application',
      body: `Hello ${candidate?.fullName.split(' ')[0] ?? 'there'}, there is an update on your application for ${job.title}: ${input.stage
        .replace('_', ' ')
        .toLowerCase()}. ${isRejection ? `Note from the team: ${input.reason}.` : ''} You can request human review of any AI-assisted screening from your application page.`,
      data: { applicationId, jobId: job._id },
    });
  }
  return await ctx.db.get(applicationId);
}

export const setStage = mutation({
  args: {
    token: v.string(),
    id: v.id('applications'),
    stage: v.union(
      v.literal('APPLIED'),
      v.literal('SCREENED'),
      v.literal('SHORTLISTED'),
      v.literal('INTERVIEW'),
      v.literal('OFFER'),
      v.literal('HIRED'),
      v.literal('REJECTED'),
    ),
    reason: v.optional(v.string()),
    overrideReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    return await decideStage(ctx, auth, args.id, args);
  },
});

export const bulkStage = mutation({
  args: {
    token: v.string(),
    jobId: v.id('jobs'),
    applicationIds: v.array(v.id('applications')),
    stage: v.union(
      v.literal('SCREENED'),
      v.literal('SHORTLISTED'),
      v.literal('INTERVIEW'),
      v.literal('OFFER'),
      v.literal('HIRED'),
      v.literal('REJECTED'),
    ),
    reason: v.optional(v.string()),
    overrideReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const job = await assertJobAccess(ctx, auth, args.jobId);
    if (args.stage === 'REJECTED' && !args.reason?.trim()) {
      fail('BAD_REQUEST', 'A written reason is required for bulk rejection.');
    }
    if (args.applicationIds.length > 100) fail('BAD_REQUEST', 'Select at most 100 applications at a time.');

    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of args.applicationIds) {
      try {
        const application = await ctx.db.get(id);
        if (!application || application.jobId !== job._id) throw new Error('Application is not part of this job');
        await decideStage(ctx, auth, id, args);
        results.push({ id, ok: true });
      } catch (error) {
        results.push({ id, ok: false, error: (error as Error).message });
      }
    }
    return {
      results,
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    };
  },
});

export const addNote = mutation({
  args: { token: v.string(), id: v.id('applications'), body: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const { application } = await assertApplicationAccess(ctx, auth, args.id);
    if (args.body.trim().length < 2) fail('BAD_REQUEST', 'Write a note before saving.');
    const noteId = await ctx.db.insert('notes', {
      applicationId: application._id,
      authorId: auth.user._id,
      body: args.body.trim(),
      createdAt: Date.now(),
    });
    await writeAudit(ctx, { id: auth.user._id, role: auth.role }, 'NOTE_ADDED', 'Application', application._id);
    const note = await ctx.db.get(noteId);
    return { ...note, id: noteId, author: { fullName: auth.user.fullName } };
  },
});

export const compare = query({
  args: { token: v.string(), jobId: v.id('jobs'), ids: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const job = await assertJobAccess(ctx, auth, args.jobId);
    const ids = args.ids
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 5);
    if (ids.length < 2) fail('BAD_REQUEST', 'Select two or more candidates to compare.');

    const result = [];
    for (const id of ids) {
      const application = await ctx.db.get(id as Id<'applications'>);
      if (!application || application.jobId !== job._id) continue;
      const parsed = await ctx.db
        .query('parsedCvs')
        .withIndex('by_application', (q) => q.eq('applicationId', application._id))
        .unique();
      const scores = await ctx.db
        .query('scores')
        .withIndex('by_application', (q) => q.eq('applicationId', application._id))
        .collect();
      const latest = scores.sort((a, b) => b.createdAt - a.createdAt)[0];
      const cv = (parsed?.data ?? null) as ParsedCVData | null;
      const hideUniversity = job.hideUniversityBlind && job.blindScreening && !application.identityRevealedAt;
      result.push({
        id: application._id,
        anonymousRef: application.publicRef,
        score: application.score ?? null,
        stage: application.stage,
        knockoutPassed: application.knockoutPassed,
        skills: cv?.skills ?? [],
        education:
          cv?.education?.map((e) => ({
            ...e,
            institution: hideUniversity ? 'Hidden' : e.institution,
          })) ?? [],
        breakdown: latest?.breakdown ?? [],
        explanation: latest?.explanation ?? null,
      });
    }
    return result;
  },
});

export const rescore = mutation({
  args: { token: v.string(), id: v.id('applications') },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const { application } = await assertApplicationAccess(ctx, auth, args.id);
    const result = await scoreAndStore(ctx, application._id, { source: 'manual' });
    if (!result) fail('BAD_REQUEST', 'This application has no parsed CV yet.');
    await writeAudit(ctx, { id: auth.user._id, role: auth.role }, 'MANUAL_RESCORE', 'Application', application._id, {
      total: result.total,
      model: result.model,
    });
    return result;
  },
});

export const interviewsForOrg = query({
  args: { token: v.string(), page: v.optional(v.number()), pageSize: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    if (auth.role === 'CANDIDATE') fail('FORBIDDEN', 'Recruiters only.');
    const { page, pageSize, skip } = pagination(args);
    const all = await ctx.db.query('interviews').collect();
    const rows = [];
    for (const interview of all) {
      const application = await ctx.db.get(interview.applicationId);
      if (!application) continue;
      const job = await ctx.db.get(application.jobId);
      if (!job) continue;
      if (auth.role !== 'ADMIN' && job.organisationId !== auth.orgId) continue;
      const slot = await ctx.db.get(interview.slotId);
      const candidate = await ctx.db.get(application.candidateId);
      rows.push({
        ...interview,
        id: interview._id,
        slot,
        application: {
          id: application._id,
          publicRef: application.publicRef,
          stage: application.stage,
          identityRevealedAt: application.identityRevealedAt ?? null,
          job: { id: job._id, title: job.title },
          candidate: application.identityRevealedAt
            ? { fullName: candidate?.fullName ?? '', email: candidate?.email ?? null }
            : { fullName: application.publicRef, email: null },
        },
      });
    }
    rows.sort((a, b) => (a.slot?.startsAt ?? 0) - (b.slot?.startsAt ?? 0));
    return paginate(rows.slice(skip, skip + pageSize), rows.length, page, pageSize);
  },
});

export const appLinks = query({
  args: { token: v.string(), id: v.id('applications') },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const { application } = await assertApplicationAccess(ctx, auth, args.id);
    return { url: `${APP_URL()}/recruiter/applications/${application._id}` };
  },
});
