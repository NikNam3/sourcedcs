import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

type Theme = 'pro' | 'movie';

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeState>({ theme: 'pro', setTheme: () => {} });
export const useTheme = () => useContext(ThemeContext);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    try { return (localStorage.getItem('sdcs-theme') as Theme) || 'pro'; } catch { return 'pro'; }
  });

  useEffect(() => {
    document.documentElement.classList.toggle('movie', theme === 'movie');
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try { localStorage.setItem('sdcs-theme', t); } catch {}
    document.documentElement.classList.toggle('movie', t === 'movie');
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}
