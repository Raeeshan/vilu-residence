import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { colorsByScheme, radii, spacing, typography, type ColorScheme, type ColorTokens } from './tokens';

export interface Theme {
  scheme: ColorScheme;
  colors: ColorTokens;
  spacing: typeof spacing;
  radii: typeof radii;
  typography: typeof typography;
}

const ThemeContext = createContext<Theme | undefined>(undefined);

/**
 * Dark/light compatibility is architectural from the start: this reads the
 * OS scheme via useColorScheme() and re-renders automatically when it
 * changes (Settings toggle, scheduled dark mode, etc.) — screens never
 * branch on scheme themselves, only ever read theme.colors.*.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const scheme: ColorScheme = systemScheme === 'dark' ? 'dark' : 'light';

  const theme = useMemo<Theme>(
    () => ({ scheme, colors: colorsByScheme[scheme], spacing, radii, typography }),
    [scheme],
  );

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme() must be used within <ThemeProvider>');
  return ctx;
}
