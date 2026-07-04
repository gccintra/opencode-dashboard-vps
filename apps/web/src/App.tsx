import { BrowserRouter, Routes, Route, Navigate, Outlet, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { CommandPalette } from './components/ui';
import AppLayout from './components/layout/AppLayout';
import LoginPage from './pages/Login';
import DashboardPage from './pages/Dashboard';
import ProjectsPage from './pages/Projects';
import ProjectDetailPage from './pages/ProjectDetail';
import SessionTerminalPage from './pages/SessionTerminal';
import EmergencyPage from './pages/Emergency';
import KanbanPage from './pages/Kanban';
import TaskDetailPage from './pages/TaskDetail';
import FilesPage from './pages/FilesPage';
import HarnessesPage from './pages/HarnessesPage';
import HarnessManagerPage from './pages/HarnessManagerPage';

function RootRedirect() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0f]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#5e6ad2] border-t-transparent" />
      </div>
    );
  }

  return <Navigate to={isAuthenticated ? '/projects' : '/login'} replace />;
}

/** Legacy /session/:projectId/:sessionId → new /sessions/:projectId/:sessionId */
function LegacySessionRedirect() {
  const { projectId, sessionId } = useParams<{ projectId: string; sessionId: string }>();
  return <Navigate to={`/sessions/${projectId}/${sessionId}`} replace />;
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="flex min-h-[calc(100vh-0px)] items-center justify-center bg-[#0a0a0f]">
      <p className="text-[16px] text-[#9aa3ad]">{title} — coming soon</p>
    </div>
  );
}

/**
 * RootShell — wraps every authenticated screen (sidebar layout AND the
 * full-screen project/session routes) so the ⌘K command palette is mounted
 * once and reachable from anywhere. It lives under ProtectedRoute, so the
 * palette's session/project/task fetches only run when authenticated.
 */
function RootShell() {
  return (
    <CommandPalette>
      <Outlet />
    </CommandPalette>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginPage />} />

      {/* Everything below requires auth and shares the global command palette. */}
      <Route
        element={
          <ProtectedRoute>
            <RootShell />
          </ProtectedRoute>
        }
      >
        {/* Global sidebar layout for all pages except project/session detail */}
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/emergency" element={<EmergencyPage />} />
          <Route path="/tasks" element={<KanbanPage />} />
          <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
          <Route path="/files" element={<FilesPage />} />
          <Route path="/templates" element={<HarnessesPage />} />
          <Route path="/templates/:id" element={<HarnessManagerPage />} />
          <Route path="/settings" element={<PlaceholderPage title="Settings" />} />
        </Route>

        {/* Project detail: full-screen layout — no global sidebar. */}
        <Route path="/projects/:id" element={<ProjectDetailPage />} />

        {/* Sessions workspace: master-detail terminal — full-screen, no global sidebar.
            Both the bare /sessions landing and a selected session render the same
            workspace (rail + canvas always available, no need to enter a session first). */}
        <Route path="/sessions" element={<SessionTerminalPage />} />
        <Route path="/sessions/:projectId/:sessionId" element={<SessionTerminalPage />} />
      </Route>

      {/* Legacy redirect: old isolated session route → workspace under /sessions. */}
      <Route path="/session/:projectId/:sessionId" element={<LegacySessionRedirect />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
