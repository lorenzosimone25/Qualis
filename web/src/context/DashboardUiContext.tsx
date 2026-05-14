import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type ThemeMode = 'dark' | 'light';

type DashboardUiState = {
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
  toggleTheme: () => void;
  selectedState: string;
  setSelectedState: (code: string) => void;
};

const DashboardUiContext = createContext<DashboardUiState | null>(null);

export function DashboardUiProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [selectedState, setSelectedState] = useState('CA');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      toggleTheme,
      selectedState,
      setSelectedState,
    }),
    [theme, toggleTheme, selectedState],
  );

  return <DashboardUiContext.Provider value={value}>{children}</DashboardUiContext.Provider>;
}

export function useDashboardUi(): DashboardUiState {
  const ctx = useContext(DashboardUiContext);
  if (!ctx) throw new Error('useDashboardUi must be used within DashboardUiProvider');
  return ctx;
}
