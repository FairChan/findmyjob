import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { StoreProvider } from './store'
import { ToastProvider } from './components/toast'
import { DemoBar, PublicShell, RequireRole, ScrollToTop } from './components/shell'
import Home from './pages/public/Home'
import Jobs, { JobDetail } from './pages/public/Jobs'
import { Companies, CompanyPage, Login, Partners } from './pages/public/Other'
import Resume from './pages/student/Resume'
import Onboarding from './pages/student/Onboarding'
import Invite from './pages/student/Invite'
import Safety from './pages/public/Safety'
import { Applications, Invitations, Notifications, Privacy, Saved, StudentLayout } from './pages/student/Student'
import { Applicants, Billing, Dashboard, EmployerJobs, EmployerLayout, JobNew } from './pages/employer/Employer'
import { Favorites, TalentDetail, TalentSearch } from './pages/employer/Talent'
import { AdminAudit, AdminCompanies, AdminDashboard, AdminJobs, AdminLayout, AdminPartners, AdminSettings, AdminStudents } from './pages/admin/Admin'

// HashRouter：打包成单个 HTML 后双击打开也能正常跳转
export default function App() {
  return (
    <HashRouter>
      <ToastProvider>
        <StoreProvider>
          <ScrollToTop />
          <Routes>
            <Route element={<PublicShell />}>
              <Route index element={<Home />} />
              <Route path="jobs" element={<Jobs />} />
              <Route path="jobs/:id" element={<JobDetail />} />
              <Route path="companies" element={<Companies />} />
              <Route path="companies/:id" element={<CompanyPage />} />
              <Route path="partners" element={<Partners />} />
              <Route path="login" element={<Login />} />
              <Route path="safety" element={<Safety />} />
              <Route path="s/onboarding" element={<RequireRole role="student"><Onboarding /></RequireRole>} />
              <Route path="s" element={<RequireRole role="student"><StudentLayout /></RequireRole>}>
                <Route index element={<Navigate to="resume" replace />} />
                <Route path="resume" element={<Resume />} />
                <Route path="applications" element={<Applications />} />
                <Route path="invitations" element={<Invitations />} />
                <Route path="saved" element={<Saved />} />
                <Route path="privacy" element={<Privacy />} />
                <Route path="notifications" element={<Notifications />} />
                <Route path="invite" element={<Invite />} />
              </Route>
            </Route>
            <Route path="e" element={<RequireRole role="employer"><EmployerLayout /></RequireRole>}>
              <Route index element={<Dashboard />} />
              <Route path="talent" element={<TalentSearch />} />
              <Route path="talent/:id" element={<TalentDetail />} />
              <Route path="favorites" element={<Favorites />} />
              <Route path="jobs" element={<EmployerJobs />} />
              <Route path="jobs/new" element={<JobNew />} />
              <Route path="applicants" element={<Applicants />} />
              <Route path="billing" element={<Billing />} />
            </Route>
            <Route path="admin" element={<RequireRole role="admin"><AdminLayout /></RequireRole>}>
              <Route index element={<AdminDashboard />} />
              <Route path="companies" element={<AdminCompanies />} />
              <Route path="jobs" element={<AdminJobs />} />
              <Route path="students" element={<AdminStudents />} />
              <Route path="partners" element={<AdminPartners />} />
              <Route path="settings" element={<AdminSettings />} />
              <Route path="audit" element={<AdminAudit />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <DemoBar />
        </StoreProvider>
      </ToastProvider>
    </HashRouter>
  )
}
