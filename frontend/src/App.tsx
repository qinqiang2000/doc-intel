import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./components/layout/AppShell";
import LoginPage from "./pages/auth/LoginPage";
import RegisterPage from "./pages/auth/RegisterPage";
import EvaluatePage from "./pages/EvaluatePage";
import ProjectCreatePage from "./pages/ProjectCreatePage";
import ProjectDocumentsPage from "./pages/ProjectDocumentsPage";
import ProjectListPage from "./pages/ProjectListPage";
import ProjectSettingsPage from "./pages/ProjectSettingsPage";
import PublishPage from "./pages/PublishPage";
import WorkspaceCreatePage from "./pages/WorkspaceCreatePage";
import WorkspacePage from "./pages/WorkspacePage";
import WorkspaceSettingsPage from "./pages/WorkspaceSettingsPage";
import { useAuthStore } from "./stores/auth-store";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RootRedirect() {
  const token = useAuthStore((s) => s.token);
  return <Navigate to={token ? "/dashboard" : "/login"} replace />;
}

export default function App() {
  const refreshMe = useAuthStore((s) => s.refreshMe);
  const token = useAuthStore((s) => s.token);

  useEffect(() => {
    if (token) {
      void refreshMe();
    }
  }, [token, refreshMe]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        <Route
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        >
          <Route path="/dashboard" element={<ProjectListPage />} />
          <Route path="/workspaces/new" element={<WorkspaceCreatePage />} />
          <Route path="/workspaces/:slug" element={<ProjectListPage />} />
          <Route
            path="/workspaces/:slug/settings"
            element={<WorkspaceSettingsPage />}
          />
          <Route path="/workspaces/:slug/projects/new" element={<ProjectCreatePage />} />
          <Route path="/workspaces/:slug/projects/:pid" element={<ProjectDocumentsPage />} />
          <Route
            path="/workspaces/:slug/projects/:pid/workspace"
            element={<WorkspacePage />}
          />
          <Route path="/workspaces/:slug/projects/:pid/settings" element={<ProjectSettingsPage />} />
          <Route path="/workspaces/:slug/projects/:pid/evaluate" element={<EvaluatePage />} />
          <Route path="/workspaces/:slug/projects/:pid/api" element={<PublishPage />} />
        </Route>

        <Route path="*" element={<RootRedirect />} />
      </Routes>
    </BrowserRouter>
  );
}
