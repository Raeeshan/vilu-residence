/**
 * Vilu Residence brand tokens for mobile — a South Ari Atoll / Maldives
 * palette (deep lagoon teal + warm sand, not a copy-paste of the desktop
 * CSS custom properties), defined once and consumed via useTheme(), never
 * hardcoded hex values scattered through screens.
 */
export type ColorScheme = 'light' | 'dark';

export interface ColorTokens {
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  textInverse: string;
  accent: string;
  accentMuted: string;
  success: string;
  warning: string;
  danger: string;
}

const lagoon = '#0e7c86';
const lagoonDeep = '#0a5c63';
const sand = '#f4ede1';

export const lightColors: ColorTokens = {
  background: '#fbfaf7',
  surface: '#ffffff',
  surfaceAlt: sand,
  border: '#e4ddce',
  textPrimary: '#1c2b2c',
  textSecondary: '#5b6a6b',
  textInverse: '#ffffff',
  accent: lagoon,
  accentMuted: '#d8ece9',
  success: '#1e8a4c',
  warning: '#b7791f',
  danger: '#c23b3b',
};

export const darkColors: ColorTokens = {
  background: '#0b1516',
  surface: '#132325',
  surfaceAlt: '#1b2f31',
  border: '#283c3e',
  textPrimary: '#f2efe7',
  textSecondary: '#a9b8b8',
  textInverse: '#0b1516',
  accent: '#3fb6bd',
  accentMuted: '#173538',
  success: '#4fbf7c',
  warning: '#e0a94f',
  danger: '#e2685f',
};

export const colorsByScheme: Record<ColorScheme, ColorTokens> = {
  light: lightColors,
  dark: darkColors,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const typography = {
  displaySize: 28,
  titleSize: 20,
  bodySize: 16,
  captionSize: 13,
  fontWeightBold: '700' as const,
  fontWeightSemibold: '600' as const,
  fontWeightRegular: '400' as const,
};

/** WCAG-minimum touch target, per the accessibility foundation requirement. */
export const MIN_TOUCH_TARGET = 44;

export const brand = {
  name: 'Vilu Residence',
  lagoon,
  lagoonDeep,
  sand,
};
