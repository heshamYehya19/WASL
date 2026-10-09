import { lazy, useEffect } from "react"
import { Route, Routes, useLocation } from "react-router-dom"
import { PublicLayout } from "./components/layout/PublicLayout"
import { AppShell } from "./components/layout/AppShell"

import Landing from "./pages/public/Landing"
import About from "./pages/public/About"
import HowItWorks from "./pages/public/HowItWorks"
import ForStudents from "./pages/public/ForStudents"
import ForCompanies from "./pages/public/ForCompanies"
import DemoLogin from "./pages/public/DemoLogin"
import NotFound from "./pages/NotFound"

// Per-role pages are lazy-loaded: they are only reached after signing in, so splitting them out keeps the public pages' first
// paint small.
const StudentDashboard = lazy(() => import("./pages/student/StudentDashboard"))
const ChallengeBrowser = lazy(() => import("./pages/student/ChallengeBrowser"))
const ChallengeView = lazy(() => import("./pages/student/ChallengeView"))
const PracticeLab = lazy(() => import("./pages/student/PracticeLab"))
const MyWork = lazy(() => import("./pages/student/MyWork"))
const WorkOverview = lazy(() => import("./pages/student/WorkOverview"))
const PhaseWorkspace = lazy(() => import("./pages/student/PhaseWorkspace"))
const Improve = lazy(() => import("./pages/student/Improve"))
const GapPage = lazy(() => import("./pages/student/GapPage"))
const Profile = lazy(() => import("./pages/student/Profile"))

const CompanyDashboard = lazy(() => import("./pages/company/CompanyDashboard"))
const CompanyChallenges = lazy(() => import("./pages/company/CompanyChallenges"))
const NewChallenge = lazy(() => import("./pages/company/NewChallenge"))
const ManageChallenge = lazy(() => import("./pages/company/ManageChallenge"))
const ParticipantPage = lazy(() => import("./pages/company/ParticipantPage"))
const TalentSearch = lazy(() => import("./pages/company/TalentSearch"))
const TalentProfile = lazy(() => import("./pages/company/TalentProfile"))
const Shortlist = lazy(() => import("./pages/company/Shortlist"))

/** New page, new scroll position — React Router doesn't reset it on its own. */
function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" })
  }, [pathname])
  return null
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route element={<PublicLayout />}>
          <Route path="/" element={<Landing />} />
          <Route path="/about" element={<About />} />
          <Route path="/how-it-works" element={<HowItWorks />} />
          <Route path="/for-students" element={<ForStudents />} />
          <Route path="/for-companies" element={<ForCompanies />} />
          <Route path="/login" element={<DemoLogin />} />
        </Route>

        <Route path="/student" element={<AppShell role="student" />}>
          <Route index element={<StudentDashboard />} />
          <Route path="challenges" element={<ChallengeBrowser />} />
          <Route path="challenges/:id" element={<ChallengeView />} />
          <Route path="practice" element={<PracticeLab />} />
          <Route path="work" element={<MyWork />} />
          <Route path="work/:runId" element={<WorkOverview />} />
          <Route path="work/:runId/:key" element={<PhaseWorkspace />} />
          <Route path="learning" element={<Improve />} />
          <Route path="learning/:gapId" element={<GapPage />} />
          <Route path="profile" element={<Profile />} />
        </Route>

        <Route path="/company" element={<AppShell role="company" />}>
          <Route index element={<CompanyDashboard />} />
          <Route path="challenges" element={<CompanyChallenges />} />
          <Route path="challenges/new" element={<NewChallenge />} />
          <Route path="challenges/:id" element={<ManageChallenge />} />
          <Route path="challenges/:id/candidates/:runId" element={<ParticipantPage />} />
          <Route path="talent" element={<TalentSearch />} />
          <Route path="talent/:id" element={<TalentProfile />} />
          <Route path="shortlist" element={<Shortlist />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  )
}
