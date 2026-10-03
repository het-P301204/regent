import { lazy, Suspense } from 'react'
import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router'
import { SessionProvider, useSession } from './lib/session'
import { ErrorState, LoadingState, ToastProvider } from './ui/feedback'
import { Shell } from './shell/Shell'

const Landing = lazy(() => import('./pages/Landing'))
const SignIn = lazy(() => import('./pages/SignIn'))
const Docs = lazy(() => import('./pages/Docs'))
const CommandCenter = lazy(() => import('./pages/CommandCenter'))
const Chains = lazy(() => import('./pages/Chains'))
const ChainDetail = lazy(() => import('./pages/ChainDetail'))
const Findings = lazy(() => import('./pages/Findings'))
const FindingDetail = lazy(() => import('./pages/FindingDetail'))
const Identities = lazy(() => import('./pages/Identities'))
const IdentityDetail = lazy(() => import('./pages/IdentityDetail'))
const Delegations = lazy(() => import('./pages/Delegations'))
const DelegationDetail = lazy(() => import('./pages/DelegationDetail'))
const Credentials = lazy(() => import('./pages/Credentials'))
const PolicyEngine = lazy(() => import('./pages/PolicyEngine'))
const Scenarios = lazy(() => import('./pages/Scenarios'))
const Builder = lazy(() => import('./pages/Builder'))
const Import = lazy(() => import('./pages/Import'))
const ActionTime = lazy(() => import('./pages/ActionTime'))
const TimeTravel = lazy(() => import('./pages/TimeTravel'))
const ChainDiff = lazy(() => import('./pages/ChainDiff'))
const Investigate = lazy(() => import('./pages/Investigate'))
const Grc = lazy(() => import('./pages/Grc'))
const Reports = lazy(() => import('./pages/Reports'))
const Learn = lazy(() => import('./pages/Learn'))
const Standards = lazy(() => import('./pages/Standards'))
const Settings = lazy(() => import('./pages/Settings'))
const RunHistory = lazy(() => import('./pages/RunHistory'))
const NotFound = lazy(() => import('./pages/NotFound'))

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useSession()
  const loc = useLocation()
  if (loading) return <LoadingState label="Restoring session" className="min-h-screen" />
  if (!session) return <ErrorState error={new Error('Session check failed')} retry={() => window.location.reload()} />
  if (!session.authenticated) return <Navigate to={`/signin?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  return <>{children}</>
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <SessionProvider>
          <Suspense fallback={<LoadingState className="min-h-screen" />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/signin" element={<SignIn />} />
              <Route path="/docs" element={<Docs />} />
              <Route path="/docs/:section" element={<Docs />} />
              <Route
                path="/app"
                element={
                  <RequireAuth>
                    <Shell />
                  </RequireAuth>
                }
              >
                <Route index element={<CommandCenter />} />
                <Route path="chains" element={<Chains />} />
                <Route path="chains/:id" element={<ChainDetail />} />
                <Route path="findings" element={<Findings />} />
                <Route path="findings/:id" element={<FindingDetail />} />
                <Route path="identities" element={<Identities />} />
                <Route path="identities/:id" element={<IdentityDetail />} />
                <Route path="delegations" element={<Delegations />} />
                <Route path="delegations/:id" element={<DelegationDetail />} />
                <Route path="credentials" element={<Credentials />} />
                <Route path="policy" element={<PolicyEngine />} />
                <Route path="scenarios" element={<Scenarios />} />
                <Route path="builder" element={<Builder />} />
                <Route path="import" element={<Import />} />
                <Route path="action-time" element={<ActionTime />} />
                <Route path="time-travel" element={<TimeTravel />} />
                <Route path="diff" element={<ChainDiff />} />
                <Route path="investigate" element={<Investigate />} />
                <Route path="investigate/:event" element={<Investigate />} />
                <Route path="grc" element={<Grc />} />
                <Route path="reports" element={<Reports />} />
                <Route path="learn" element={<Learn />} />
                <Route path="standards" element={<Standards />} />
                <Route path="settings" element={<Settings />} />
                <Route path="activity" element={<RunHistory />} />
                <Route path="*" element={<NotFound />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </SessionProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}
