import { BrowserRouter, Routes, Route, Outlet } from 'react-router-dom';

import { AppDependenciesProvider } from './frontend/app/providers/AppDependenciesProvider.tsx';
import { AuthProvider } from './frontend/app/providers/AuthProvider.tsx';
import { MainLayout } from './frontend/shared/layouts/MainLayout.tsx';
import { HomePage } from './frontend/pages/HomePage.tsx';
import { StandingsPage } from './frontend/pages/StandingsPage.tsx';
import { MatchesPage } from './frontend/pages/MatchesPage.tsx';
import { AdminPage } from './frontend/pages/AdminPage.tsx';
import { MatchManagementPage } from './frontend/pages/MatchManagementPage.tsx';
import { MatchViewPage } from './frontend/pages/MatchViewPage.tsx';
import { LoginPage } from './frontend/pages/LoginPage.tsx';
import { TeamsPage } from './frontend/pages/TeamsPage.tsx';
import { StatsPage } from './frontend/pages/StatsPage.tsx';
import { VocaliaPage } from './frontend/pages/VocaliaPage.tsx';
import { VocalAccessPage } from './frontend/pages/VocalAccessPage.tsx';
import { RequireAdminRoute } from './frontend/shared/components/RequireAdminRoute.tsx';
import { RequireAuthRoute } from './frontend/shared/components/RequireAuthRoute.tsx';
import { RequireVocaliaRoute } from './frontend/shared/components/RequireVocaliaRoute.tsx';
import { RequireVocalAccessRoute } from './frontend/shared/components/RequireVocalAccessRoute.tsx';
import { MailSystemAlertToast } from './frontend/shared/components/MailSystemAlertToast.tsx';
import { ReloadPrompt } from './frontend/shared/components/ReloadPrompt.tsx';
import { PresenceTracker } from './frontend/shared/components/PresenceTracker.tsx';
import { PrivacyConsentModal } from './frontend/shared/components/PrivacyConsentModal.tsx';

const MainLayoutShell = () => (
  <MainLayout>
    <Outlet />
  </MainLayout>
);

function App() {
  return (
    <AuthProvider>
      <AppDependenciesProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/vocal-access/:matchId" element={<VocalAccessPage />} />
            <Route
              path="/vocal/match/:matchId"
              element={(
                <RequireVocalAccessRoute>
                  <MatchManagementPage />
                </RequireVocalAccessRoute>
              )}
            />

            <Route element={<MainLayoutShell />}>
              <Route path="/" element={<RequireAuthRoute><HomePage /></RequireAuthRoute>} />
              <Route path="/teams" element={<RequireAuthRoute><TeamsPage /></RequireAuthRoute>} />
              <Route path="/standings" element={<RequireAuthRoute><StandingsPage /></RequireAuthRoute>} />
              <Route path="/matches" element={<RequireAuthRoute><MatchesPage /></RequireAuthRoute>} />
              <Route path="/stats" element={<RequireAuthRoute><StatsPage /></RequireAuthRoute>} />
              <Route path="/match/:matchId" element={<RequireAuthRoute><MatchViewPage /></RequireAuthRoute>} />
              <Route path="/login" element={<LoginPage />} />
              <Route
                path="/vocalia"
                element={(
                  <RequireAuthRoute>
                    <RequireVocaliaRoute>
                      <VocaliaPage />
                    </RequireVocaliaRoute>
                  </RequireAuthRoute>
                )}
              />
              <Route
                path="/admin"
                element={(
                  <RequireAdminRoute>
                    <AdminPage />
                  </RequireAdminRoute>
                )}
              />
              <Route
                path="/admin/match/:matchId"
                element={(
                  <RequireVocaliaRoute>
                    <MatchManagementPage />
                  </RequireVocaliaRoute>
                )}
              />
            </Route>
          </Routes>
          <PresenceTracker />
          <PrivacyConsentModal />
          <MailSystemAlertToast />
          <ReloadPrompt />
        </BrowserRouter>
      </AppDependenciesProvider>
    </AuthProvider>
  );
}

export default App;