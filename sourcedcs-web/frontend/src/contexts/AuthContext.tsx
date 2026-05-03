import React, { createContext, useContext, useState, useCallback } from 'react';
import { useConfig } from './ConfigContext';

function decodeJwt(token: string) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch { return null; }
}

function getRoles(token: string): string[] {
  const payload = decodeJwt(token);
  if (!payload) return [];
  const roles: unknown[] = payload.roles || [];
  return roles.map(r => (typeof r === 'string' ? r : (r as { name?: string }).name || ''));
}

interface AuthState {
  token: string | null;
  user: { name: string; email: string } | null;
  isAdmin: boolean;
  isSkillAdmin: boolean;
  hasRole: boolean;
  login: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState>({
  token: null, user: null, isAdmin: false, isSkillAdmin: false, hasRole: false,
  login: () => {}, logout: () => {},
});
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const config = useConfig();
  const [token] = useState<string | null>(() => {
    try { return localStorage.getItem('sdcs-token'); } catch { return null; }
  });
  const [user] = useState<{ name: string; email: string } | null>(() => {
    try { return JSON.parse(localStorage.getItem('sdcs-user') || 'null'); } catch { return null; }
  });

  const roles = token ? getRoles(token) : [];
  const isAdmin = roles.includes('admin');
  const isSkillAdmin = roles.some(r => (config.skillAdminRoles || ['admin']).includes(r));
  const hasRole = roles.length > 0;

  const login = useCallback(() => {
    try { localStorage.setItem('sdcs-return-url', window.location.href); } catch {}
    const ru = encodeURIComponent(window.location.origin + '/auth-callback');
    const st = Math.random().toString(36).slice(2);
    try { sessionStorage.setItem('sdcs-oauth-state', st); } catch {}
    window.location.href = `${config.casdoorEndpoint}/login/oauth/authorize?client_id=${config.casdoorClientId}&redirect_uri=${ru}&response_type=code&scope=openid+profile&state=${st}`;
  }, [config]);

  const logout = useCallback(() => {
    try { localStorage.removeItem('sdcs-token'); localStorage.removeItem('sdcs-user'); } catch {}
    window.location.reload();
  }, []);

  return (
    <AuthContext.Provider value={{ token, user, isAdmin, isSkillAdmin, hasRole, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
