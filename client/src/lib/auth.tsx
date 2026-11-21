import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { request, setToken } from './api';

export type Role = 'CANDIDATE' | 'RECRUITER' | 'ADMIN';

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  organisationId: string | null;
  emailVerified: boolean;
  phone?: string | null;
  organisation?: { id: string; name: string; slug: string } | null;
  profile?: {
    headline?: string | null;
    summary?: string | null;
    location?: string | null;
    linkedinUrl?: string | null;
    portfolioUrl?: string | null;
  } | null;
}

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<SessionUser>;
  register: (payload: RegisterPayload) => Promise<{ user: SessionUser; message?: string }>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
  setUser: (user: SessionUser | null) => void;
}

export interface RegisterPayload {
  fullName: string;
  email: string;
  password: string;
  role: 'CANDIDATE' | 'RECRUITER';
  phone?: string;
  organisationName?: string;
  sector?: string;
  acceptedAiNotice: true;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    try {
      const data = await request<{ user: SessionUser }>('/auth/me', { retryOnAuth: true });
      setUser({
        ...data.user,
        emailVerified: Boolean((data.user as unknown as { emailVerifiedAt?: string }).emailVerifiedAt) || data.user.emailVerified,
      });
    } catch {
      setUser(null);
      setToken(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('ise.access') : null;
      if (token) await loadMe();
      setLoading(false);
    })();
  }, [loadMe]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await request<{ user: SessionUser; accessToken: string }>('/auth/login', {
      method: 'POST',
      body: { email, password },
      retryOnAuth: false,
    });
    setToken(data.accessToken);
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (payload: RegisterPayload) => {
    const data = await request<{ user: SessionUser; accessToken: string }>('/auth/register', {
      method: 'POST',
      body: payload,
      retryOnAuth: false,
    });
    setToken(data.accessToken);
    setUser(data.user);
    return { user: data.user, message: 'Account created. Check your email to verify your address.' };
  }, []);

  const logout = useCallback(async () => {
    await request('/auth/logout', { method: 'POST', headers: { 'X-Ise-Request': 'web' }, retryOnAuth: false }).catch(
      () => undefined,
    );
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, register, logout, reload: loadMe, setUser }),
    [user, loading, login, register, logout, loadMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

export function homeForRole(role?: Role | null) {
  switch (role) {
    case 'ADMIN':
      return '/admin';
    case 'RECRUITER':
      return '/recruiter';
    case 'CANDIDATE':
      return '/candidate';
    default:
      return '/';
  }
}
