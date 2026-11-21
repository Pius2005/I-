import { Route, Routes } from 'react-router-dom';
import { AppShell, PublicShell } from './components/Layout';
import { RedirectIfAuthed, RequireAuth } from './components/RequireAuth';
import Landing from './pages/Landing';
import { ForgotPasswordPage, LoginPage, NotFoundPage, RegisterPage, ResetPasswordPage, VerifyEmailPage } from './pages/Auth';
import PrivacyPage, { AiUsePage } from './pages/Privacy';
import CandidateDashboard from './pages/candidate/Dashboard';
import CandidateProfile from './pages/candidate/Profile';
import CandidateJobsPage, { JobDetailPage } from './pages/candidate/Jobs';
import CandidateApplicationsPage, { CandidateApplicationDetailPage } from './pages/candidate/Applications';
import RecruiterDashboard from './pages/recruiter/Dashboard';
import RecruiterJobsPage, { JobEditorPage } from './pages/recruiter/Jobs';
import PipelinePage, { ComparePage } from './pages/recruiter/Pipeline';
import RecruiterApplicationDetail from './pages/recruiter/ApplicationDetail';
import RecruiterInterviewsPage from './pages/recruiter/Interviews';
import AuditOverviewPage, { JobAuditPage } from './pages/recruiter/Audit';
import {
  AdminDashboard,
  AdminDataRequests,
  AdminLogs,
  AdminOrganisations,
  AdminSettings,
  AdminUsers,
} from './pages/admin/Admin';

export default function App() {
  return (
    <Routes>
      <Route element={<PublicShell />}>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<RedirectIfAuthed><LoginPage /></RedirectIfAuthed>} />
        <Route path="/register" element={<RedirectIfAuthed><RegisterPage /></RedirectIfAuthed>} />
        <Route path="/forgot-password" element={<RedirectIfAuthed><ForgotPasswordPage /></RedirectIfAuthed>} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/ai-use" element={<AiUsePage />} />
      </Route>

      <Route element={<RequireAuth roles={['CANDIDATE', 'RECRUITER', 'ADMIN']} />}>
        <Route element={<AppShell />}>
          <Route element={<RequireAuth roles={['CANDIDATE']} />}>
            <Route path="/candidate" element={<CandidateDashboard />} />
            <Route path="/candidate/jobs" element={<CandidateJobsPage />} />
            <Route path="/candidate/jobs/:slug" element={<JobDetailPage />} />
            <Route path="/candidate/applications" element={<CandidateApplicationsPage />} />
            <Route path="/candidate/applications/:id" element={<CandidateApplicationDetailPage />} />
            <Route path="/candidate/profile" element={<CandidateProfile />} />
          </Route>

          <Route element={<RequireAuth roles={['RECRUITER', 'ADMIN']} />}>
            <Route path="/recruiter" element={<RecruiterDashboard />} />
            <Route path="/recruiter/jobs" element={<RecruiterJobsPage />} />
            <Route path="/recruiter/jobs/new" element={<JobEditorPage />} />
            <Route path="/recruiter/jobs/:id/edit" element={<JobEditorPage />} />
            <Route path="/recruiter/jobs/:id/pipeline" element={<PipelinePage />} />
            <Route path="/recruiter/jobs/:id/compare" element={<ComparePage />} />
            <Route path="/recruiter/jobs/:id/audit" element={<JobAuditPage />} />
            <Route path="/recruiter/applications/:id" element={<RecruiterApplicationDetail />} />
            <Route path="/recruiter/interviews" element={<RecruiterInterviewsPage />} />
            <Route path="/recruiter/audit" element={<AuditOverviewPage />} />
          </Route>

          <Route element={<RequireAuth roles={['ADMIN']} />}>
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/organisations" element={<AdminOrganisations />} />
            <Route path="/admin/users" element={<AdminUsers />} />
            <Route path="/admin/settings" element={<AdminSettings />} />
            <Route path="/admin/logs" element={<AdminLogs />} />
            <Route path="/admin/data-requests" element={<AdminDataRequests />} />
            <Route path="/admin/audit" element={<AuditOverviewPage global />} />
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
