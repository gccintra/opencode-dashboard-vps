import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import AppLayout from './components/layout/AppLayout';
import LoginPage from './pages/Login';
import DashboardPage from './pages/Dashboard';
import ProjectsPage from './pages/Projects';
import ProjectDetailPage from './pages/ProjectDetail';
import SessionTerminalPage from './pages/SessionTerminal';
import EmergencyPage from './pages/Emergency';
import KanbanPage from './pages/Kanban';
import SessionsPage from './pages/Sessions';

function RootRedirect() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0f]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#af0] border-t-transparent" />
      </div>
    );
  }

  return <Navigate to={isAuthenticated ? '/projects' : '/login'} replace />;
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="flex min-h-[calc(100vh-0px)] items-center justify-center bg-[#0a0a0f]">
      <p className="font-['Inter'] text-[16px] text-[#889]">{title} — coming soon</p>
    </div>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginPage />} />

      {/* Global sidebar layout for all pages except project detail */}
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/emergency" element={<EmergencyPage />} />
        <Route path="/sessions" element={<SessionsPage />} />
        <Route path="/tasks" element={<KanbanPage />} />
        <Route path="/settings" element={<PlaceholderPage title="Settings" />} />
      </Route>

      {/* Project detail: full-screen layout — no global sidebar. */}
      <Route
        path="/projects/:id"
        element={
          <ProtectedRoute>
            <ProjectDetailPage />
          </ProtectedRoute>
        }
      />

      {/* Session terminal: opened from Sessions hub — full-screen, back → /sessions */}
      <Route
        path="/session/:projectId/:sessionId"
        element={
          <ProtectedRoute>
            <SessionTerminalPage />
          </ProtectedRoute>
        }
      />
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
