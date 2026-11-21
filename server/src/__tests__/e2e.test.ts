import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../db.js';

describe('Iṣẹ́ Platform End-to-End (E2E) Test Suite', () => {
  const app = createApp();
  let candidateToken: string;
  let recruiterToken: string;
  let adminToken: string;
  let testJobId: string;
  let testApplicationIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // 1. Health & Public Discovery Endpoints
  describe('Public & System Health API', () => {
    it('GET /api/health returns status ok', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('ok');
    });

    it('GET /api/public/meta returns platform stats and AI notice version', async () => {
      const res = await request(app).get('/api/public/meta');
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Iṣẹ́');
      expect(res.body.data.stats).toBeDefined();
      expect(res.body.data.stats.openJobs).toBeGreaterThan(0);
    });

    it('GET /api/public/jobs lists active jobs with pagination metadata', async () => {
      const res = await request(app).get('/api/public/jobs');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.total).toBeGreaterThan(0);
      expect(res.body.data.length).toBeGreaterThan(0);
      testJobId = res.body.data[0].id;
    });

    it('GET /api/public/jobs/:slug retrieves full details for a public job', async () => {
      const jobsRes = await request(app).get('/api/public/jobs');
      const firstJobSlug = jobsRes.body.data[0].slug;

      const res = await request(app).get(`/api/public/jobs/${firstJobSlug}`);
      expect(res.status).toBe(200);
      expect(res.body.data.slug).toBe(firstJobSlug);
      expect(res.body.data.organisation).toBeDefined();
    });
  });

  // 2. Authentication & Authorization Flow
  describe('Authentication & Access Control', () => {
    it('POST /api/auth/login rejects invalid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'candidate@ise.test', password: 'WrongPassword999!' });
      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    });

    it('POST /api/auth/login logs in Candidate successfully', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'candidate@ise.test', password: 'CandidatePass123' });
      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.user.role).toBe('CANDIDATE');
      candidateToken = res.body.data.accessToken;
    });

    it('POST /api/auth/login logs in Recruiter successfully', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'recruiter@federaltech.test', password: 'Password123' });
      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.user.role).toBe('RECRUITER');
      recruiterToken = res.body.data.accessToken;
    });

    it('POST /api/auth/login logs in Admin successfully', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'admin@ise.test', password: 'Password123' });
      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.user.role).toBe('ADMIN');
      adminToken = res.body.data.accessToken;
    });

    it('Enforces strict RBAC: Candidate cannot access recruiter dashboard', async () => {
      const res = await request(app)
        .get('/api/recruiter/dashboard')
        .set('Authorization', `Bearer ${candidateToken}`);
      expect(res.status).toBe(403);
    });

    it('Enforces strict RBAC: Recruiter cannot access admin dashboard', async () => {
      const res = await request(app)
        .get('/api/admin/dashboard')
        .set('Authorization', `Bearer ${recruiterToken}`);
      expect(res.status).toBe(403);
    });

    it('Enforces auth: unauthenticated request to /api/candidate/profile is 401', async () => {
      const res = await request(app).get('/api/candidate/profile');
      expect(res.status).toBe(401);
    });
  });

  // 3. Candidate End-to-End User Journey
  describe('Candidate Journey', () => {
    it('GET /api/candidate/profile retrieves candidate profile and contact details', async () => {
      const res = await request(app)
        .get('/api/candidate/profile')
        .set('Authorization', `Bearer ${candidateToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe('candidate@ise.test');
    });

    it('PUT /api/candidate/profile updates candidate profile', async () => {
      const res = await request(app)
        .put('/api/candidate/profile')
        .set('Authorization', `Bearer ${candidateToken}`)
        .send({
          headline: 'Software Engineer & Nigerian Graduate',
          location: 'Lagos, Nigeria',
        });
      expect(res.status).toBe(200);
      expect(res.body.data.headline).toBe('Software Engineer & Nigerian Graduate');
    });

    it('GET /api/applications lists submitted applications for candidate', async () => {
      const res = await request(app)
        .get('/api/applications')
        .set('Authorization', `Bearer ${candidateToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.meta).toBeDefined();
    });

    it('GET /api/notifications retrieves candidate notifications', async () => {
      const res = await request(app)
        .get('/api/notifications')
        .set('Authorization', `Bearer ${candidateToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
    });

    it('GET /api/candidate/demographics retrieves encrypted demographic self-declaration', async () => {
      const res = await request(app)
        .get('/api/candidate/demographics')
        .set('Authorization', `Bearer ${candidateToken}`);
      expect(res.status).toBe(200);
    });
  });

  // 4. Recruiter End-to-End User Journey
  describe('Recruiter Journey', () => {
    it('GET /api/recruiter/dashboard retrieves recruiter metrics and pipelines', async () => {
      const res = await request(app)
        .get('/api/recruiter/dashboard')
        .set('Authorization', `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.jobs).toBeDefined();
      expect(res.body.data.byStage).toBeDefined();
    });

    it('GET /api/recruiter/jobs lists jobs belonging to recruiter organization', async () => {
      const res = await request(app)
        .get('/api/recruiter/jobs')
        .set('Authorization', `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      testJobId = res.body.data[0].id;
    });

    it('GET /api/recruiter/jobs/:id/pipeline loads kanban pipeline with blind screening status', async () => {
      const res = await request(app)
        .get(`/api/recruiter/jobs/${testJobId}/pipeline`)
        .set('Authorization', `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.stages).toBeDefined();
      expect(res.body.data.job.id).toBe(testJobId);

      // Collect candidate application IDs for comparison test
      for (const stage of Object.keys(res.body.data.stages)) {
        for (const item of res.body.data.stages[stage].items) {
          testApplicationIds.push(item.id);
          if (testApplicationIds.length >= 2) break;
        }
        if (testApplicationIds.length >= 2) break;
      }
    });

    it('GET /api/recruiter/jobs/:id/compare retrieves candidate comparison matrix', async () => {
      expect(testApplicationIds.length).toBeGreaterThanOrEqual(2);
      const res = await request(app)
        .get(`/api/recruiter/jobs/${testJobId}/compare?ids=${testApplicationIds.slice(0, 2).join(',')}`)
        .set('Authorization', `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(2);
      expect(res.body.data[0].anonymousRef).toBeDefined();
      expect(res.body.data[0].skills).toBeDefined();
    });

    it('GET /api/audit/snapshot calculates bias audit & AIR for recruiter job', async () => {
      const res = await request(app)
        .get(`/api/audit/snapshot?jobId=${testJobId}`)
        .set('Authorization', `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.scope.jobId).toBe(testJobId);
      expect(res.body.data.sampleSize).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(res.body.data.stages)).toBe(true);
      expect(Array.isArray(res.body.data.flags)).toBe(true);
    });
  });

  // 5. Admin & Compliance User Journey
  describe('Admin & Compliance Journey', () => {
    it('GET /api/admin/dashboard retrieves system overview', async () => {
      const res = await request(app)
        .get('/api/admin/dashboard')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.users).toBeGreaterThan(0);
      expect(res.body.data.organisations).toBeGreaterThan(0);
      expect(res.body.data.byRole).toBeDefined();
    });

    it('GET /api/admin/organisations lists all platform organizations', async () => {
      const res = await request(app)
        .get('/api/admin/organisations')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it('GET /api/admin/users lists all users with role filtering', async () => {
      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it('GET /api/admin/settings retrieves audit thresholds & retention policy', async () => {
      const res = await request(app)
        .get('/api/admin/settings')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.threshold).toBeDefined();
      expect(res.body.data.minGroupSize).toBeDefined();
      expect(res.body.data.retentionDays).toBeDefined();
    });

    it('GET /api/admin/audit-logs retrieves platform audit logs', async () => {
      const res = await request(app)
        .get('/api/admin/audit-logs')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('GET /api/admin/data-requests lists NDPA export/deletion requests', async () => {
      const res = await request(app)
        .get('/api/admin/data-requests')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('GET /api/audit/snapshot retrieves global bias overview for admin', async () => {
      const res = await request(app)
        .get('/api/audit/snapshot')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.sampleSize).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(res.body.data.stages)).toBe(true);
      expect(Array.isArray(res.body.data.findings)).toBe(true);
    });
  });
});
