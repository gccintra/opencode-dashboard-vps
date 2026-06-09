import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { apiFetch, getToken, saveToken, clearToken, type ApiError } from '../lib/api';

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (password: string) => Promise<{ success: true } | { success: false; error: string }>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Verify token on mount
  useEffect(() => {
    const verify = async () => {
      const token = getToken();
      if (!token) {
        setIsLoading(false);
        return;
      }

      try {
        await apiFetch('/api/auth/verify');
        setIsAuthenticated(true);
      } catch {
        clearToken();
      } finally {
        setIsLoading(false);
      }
    };

    verify();
  }, []);

  // Listen for forced logout events (e.g., 401 from API)
  useEffect(() => {
    const handleForcedLogout = () => {
      setIsAuthenticated(false);
    };

    window.addEventListener('auth:logout', handleForcedLogout);
    return () => window.removeEventListener('auth:logout', handleForcedLogout);
  }, []);

  const login = useCallback(async (password: string) => {
    try {
      const data = await apiFetch<{ token: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });

      saveToken(data.token);
      setIsAuthenticated(true);
      return { success: true as const };
    } catch (err) {
      const apiError = err as ApiError;
      return {
        success: false as const,
        error: apiError.message || 'Connection failed',
      };
    }
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setIsAuthenticated(false);
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
