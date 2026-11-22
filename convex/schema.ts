import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

// Iṣẹ́ data model — Convex.
// Demographic self-declarations live in their own table, encrypted with
// AES-256-GCM and never joined by the scoring or recruiting code paths.

const role = v.union(v.literal('CANDIDATE'), v.literal('RECRUITER'), v.literal('ADMIN'));
const applicationStage = v.union(
  v.literal('APPLIED'),
  v.literal('SCREENED'),
  v.literal('SHORTLISTED'),
  v.literal('INTERVIEW'),
  v.literal('OFFER'),
  v.literal('HIRED'),
  v.literal('REJECTED'),
);

export default defineSchema({
  organisations: defineTable({
    name: v.string(),
    slug: v.string(),
    sector: v.optional(v.string()),
    size: v.optional(v.string()),
    website: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_slug', ['slug']),

  users: defineTable({
    email: v.string(),
    passwordHash: v.string(),
    fullName: v.string(),
    role,
    phone: v.optional(v.string()),
    organisationId: v.optional(v.id('organisations')),
    emailVerifiedAt: v.optional(v.number()),
    isActive: v.boolean(),
    lastLoginAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_email', ['email'])
    .index('by_organisation', ['organisationId'])
    .index('by_role', ['role']),

  sessions: defineTable({
    userId: v.id('users'),
    tokenHash: v.string(),
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
    createdAt: v.number(),
    userAgent: v.optional(v.string()),
    ip: v.optional(v.string()),
  })
    .index('by_token', ['tokenHash'])
    .index('by_user', ['userId'])
    .index('by_expiry', ['expiresAt']),

  emailTokens: defineTable({
    userId: v.id('users'),
    type: v.union(v.literal('VERIFY_EMAIL'), v.literal('RESET_PASSWORD')),
    tokenHash: v.string(),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_token', ['tokenHash'])
    .index('by_user_type', ['userId', 'type']),

  candidateProfiles: defineTable({
    userId: v.id('users'),
    headline: v.optional(v.string()),
    summary: v.optional(v.string()),
    location: v.optional(v.string()),
    phone: v.optional(v.string()),
    linkedinUrl: v.optional(v.string()),
    portfolioUrl: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_user', ['userId']),

  jobs: defineTable({
    organisationId: v.id('organisations'),
    recruiterId: v.id('users'),
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
    deadline: v.number(),
    openings: v.number(),
    status: v.union(v.literal('DRAFT'), v.literal('OPEN'), v.literal('CLOSED')),
    minYearsExperience: v.number(),
    blindScreening: v.boolean(),
    hideUniversityBlind: v.boolean(),
    biasDemoMode: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
    closedAt: v.optional(v.number()),
  })
    .index('by_slug', ['slug'])
    .index('by_organisation_status', ['organisationId', 'status'])
    .index('by_recruiter', ['recruiterId'])
    .index('by_status_deadline', ['status', 'deadline']),

  jobCriteria: defineTable({
    jobId: v.id('jobs'),
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
    order: v.number(),
  }).index('by_job', ['jobId', 'order']),

  knockoutQuestions: defineTable({
    jobId: v.id('jobs'),
    type: v.union(
      v.literal('NYSC'),
      v.literal('DEGREE_CLASS'),
      v.literal('LOCATION'),
      v.literal('AVAILABILITY'),
      v.literal('WORK_AUTH'),
    ),
    prompt: v.string(),
    options: v.any(),
    config: v.any(),
    order: v.number(),
  }).index('by_job', ['jobId', 'order']),

  applications: defineTable({
    jobId: v.id('jobs'),
    candidateId: v.id('users'),
    publicRef: v.string(),
    coverLetter: v.optional(v.string()),
    stage: applicationStage,
    knockoutPassed: v.boolean(),
    knockoutFlags: v.any(),
    score: v.optional(v.number()),
    scoredAt: v.optional(v.number()),
    aiRecommendedStage: v.optional(applicationStage),
    identityRevealedAt: v.optional(v.number()),
    identityRevealedBy: v.optional(v.id('users')),
    rejectionReason: v.optional(v.string()),
    overrideReason: v.optional(v.string()),
    shortlistedAt: v.optional(v.number()),
    humanReviewRequestedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_job', ['jobId'])
    .index('by_job_stage', ['jobId', 'stage'])
    .index('by_candidate', ['candidateId'])
    .index('by_job_candidate', ['jobId', 'candidateId'])
    .index('by_public_ref', ['publicRef']),

  cvFiles: defineTable({
    applicationId: v.optional(v.id('applications')),
    candidateId: v.id('users'),
    filename: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    storageId: v.optional(v.id('_storage')),
    storageKey: v.string(),
    checksum: v.string(),
    extractionStatus: v.union(
      v.literal('PENDING'),
      v.literal('PROCESSING'),
      v.literal('COMPLETED'),
      v.literal('FAILED'),
    ),
    extractedText: v.optional(v.string()),
    extractionError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_application', ['applicationId'])
    .index('by_candidate', ['candidateId']),

  parsedCvs: defineTable({
    applicationId: v.id('applications'),
    cvFileId: v.optional(v.id('cvFiles')),
    data: v.any(),
    corrections: v.optional(v.any()),
    parserModel: v.string(),
    promptVersion: v.string(),
    reviewStatus: v.union(v.literal('PARSED'), v.literal('CORRECTED'), v.literal('MANUAL_TEXT')),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_application', ['applicationId']),

  scores: defineTable({
    applicationId: v.id('applications'),
    total: v.number(),
    breakdown: v.any(),
    explanation: v.string(),
    model: v.string(),
    promptVersion: v.string(),
    rubricVersion: v.string(),
    createdAt: v.number(),
  })
    .index('by_application', ['applicationId'])
    .index('by_total', ['total']),

  knockoutAnswers: defineTable({
    applicationId: v.id('applications'),
    questionId: v.id('knockoutQuestions'),
    value: v.any(),
    passed: v.boolean(),
    createdAt: v.number(),
  })
    .index('by_application', ['applicationId'])
    .index('by_question', ['questionId']),

  demographicDeclarations: defineTable({
    userId: v.id('users'),
    payload: v.string(),
    keyVersion: v.number(),
    consentVersion: v.string(),
    declaredAt: v.number(),
    updatedAt: v.number(),
  }).index('by_user', ['userId']),

  statusHistory: defineTable({
    applicationId: v.id('applications'),
    fromStage: v.optional(applicationStage),
    toStage: applicationStage,
    actorId: v.optional(v.id('users')),
    reason: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_application', ['applicationId', 'createdAt']),

  notes: defineTable({
    applicationId: v.id('applications'),
    authorId: v.id('users'),
    body: v.string(),
    createdAt: v.number(),
  }).index('by_application', ['applicationId']),

  availabilityWindows: defineTable({
    jobId: v.id('jobs'),
    recruiterId: v.id('users'),
    startsAt: v.number(),
    endsAt: v.number(),
    slotMinutes: v.number(),
    bufferMinutes: v.number(),
    timezone: v.string(),
    interviewType: v.union(v.literal('IN_PERSON'), v.literal('PHONE'), v.literal('VIDEO')),
    location: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_job', ['jobId', 'startsAt']),

  interviewSlots: defineTable({
    windowId: v.id('availabilityWindows'),
    jobId: v.id('jobs'),
    startsAt: v.number(),
    endsAt: v.number(),
    applicationId: v.optional(v.id('applications')),
    createdAt: v.number(),
  })
    .index('by_window', ['windowId', 'startsAt'])
    .index('by_job', ['jobId', 'startsAt'])
    .index('by_application', ['applicationId']),

  interviews: defineTable({
    slotId: v.id('interviewSlots'),
    applicationId: v.id('applications'),
    status: v.union(
      v.literal('SCHEDULED'),
      v.literal('COMPLETED'),
      v.literal('CANCELLED'),
      v.literal('NO_SHOW'),
    ),
    type: v.union(v.literal('IN_PERSON'), v.literal('PHONE'), v.literal('VIDEO')),
    location: v.optional(v.string()),
    meetingLink: v.optional(v.string()),
    notes: v.optional(v.string()),
    interviewerIds: v.array(v.string()),
    icsUid: v.string(),
    reminder24SentAt: v.optional(v.number()),
    reminder1SentAt: v.optional(v.number()),
    googleEventId: v.optional(v.string()),
    cancelledAt: v.optional(v.number()),
    cancelReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_slot', ['slotId'])
    .index('by_application', ['applicationId'])
    .index('by_status', ['status']),

  notifications: defineTable({
    userId: v.id('users'),
    type: v.union(
      v.literal('APPLICATION_RECEIVED'),
      v.literal('SCORED'),
      v.literal('SHORTLISTED'),
      v.literal('INTERVIEW_SCHEDULED'),
      v.literal('INTERVIEW_CHANGED'),
      v.literal('INTERVIEW_CANCELLED'),
      v.literal('REMINDER_24H'),
      v.literal('REMINDER_1H'),
      v.literal('OUTCOME'),
      v.literal('BIAS_ALERT'),
      v.literal('SYSTEM'),
    ),
    title: v.string(),
    body: v.string(),
    data: v.any(),
    readAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index('by_user', ['userId', 'createdAt']),

  notificationPreferences: defineTable({
    userId: v.id('users'),
    email: v.boolean(),
    sms: v.boolean(),
    whatsapp: v.boolean(),
    inApp: v.boolean(),
    updatedAt: v.number(),
  }).index('by_user', ['userId']),

  auditLogs: defineTable({
    actorId: v.optional(v.id('users')),
    actorRole: v.string(),
    action: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    metadata: v.any(),
    ip: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_created', ['createdAt'])
    .index('by_entity', ['entityType', 'entityId'])
    .index('by_action', ['action']),

  biasReports: defineTable({
    jobId: v.optional(v.id('jobs')),
    organisationId: v.optional(v.id('organisations')),
    generatedById: v.id('users'),
    summary: v.any(),
    findings: v.any(),
    flagCount: v.number(),
    methodology: v.string(),
    sampleSize: v.number(),
    createdAt: v.number(),
  })
    .index('by_job', ['jobId'])
    .index('by_organisation', ['organisationId', 'createdAt']),

  counterfactualRuns: defineTable({
    jobId: v.id('jobs'),
    createdById: v.id('users'),
    baseCv: v.any(),
    variants: v.any(),
    results: v.any(),
    maxDelta: v.number(),
    threshold: v.number(),
    flagged: v.boolean(),
    createdAt: v.number(),
  }).index('by_job', ['jobId', 'createdAt']),

  consentRecords: defineTable({
    userId: v.id('users'),
    purpose: v.string(),
    version: v.string(),
    grantedAt: v.number(),
    withdrawnAt: v.optional(v.number()),
    ip: v.optional(v.string()),
  }).index('by_user', ['userId', 'purpose']),

  dataRequests: defineTable({
    userId: v.id('users'),
    type: v.union(v.literal('EXPORT'), v.literal('DELETE')),
    status: v.union(v.literal('PENDING'), v.literal('COMPLETED'), v.literal('REJECTED')),
    note: v.optional(v.string()),
    requestedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index('by_user', ['userId'])
    .index('by_status', ['status']),

  settings: defineTable({
    key: v.string(),
    value: v.any(),
    updatedAt: v.number(),
  }).index('by_key', ['key']),
});
