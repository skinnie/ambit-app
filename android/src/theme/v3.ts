// v3.0 design tokens - real, 2026-08-09 ("implement the UI we have been ironing for desktop
// on the android and call it v3.0"). Deliberately a NEW, separate set of tokens rather than
// changing tokens.ts's existing lightColors/darkColors values in place: only 5 files read
// useTheme() today, but primitives.tsx (Section/Button/Chip/etc, used by every screen) reads
// it too, so changing those values in place would instantly re-skin the whole app the moment
// this file was touched - not what "one screen first as proof of concept" (2026-08-09 rollout
// decision) means. Screens migrate to useV3Theme()/Card/NavShell one at a time; tokens.ts
// stays exactly as it is for whichever screens haven't moved onto this yet.
//
// spacing/radius/type scale still copied by hand from desktop/qml/Theme.qml, same reasoning
// as before: one shared layout/type language across both apps. primary/accent are a real,
// deliberate exception to that, same day ("why we have this cyano blue? ... change to a
// nicer grey") - a real, explicit design choice to move Android off desktop's teal onto a
// slate grey instead, not a bug or a stale copy. success/warning/error/background/card/text/
// mutedText are unchanged (already neutral or real semantic status colors, not the "cyano
// blue" being asked about).

import { useThemeMode } from './ThemeModeContext';

export interface V3Colors {
  background: string;
  card: string;
  primary: string;
  secondary: string;
  accent: string;
  success: string;
  warning: string;
  error: string;
  text: string;
  mutedText: string;
}

export const v3Light: V3Colors = {
  background: '#F6F8F9',
  card:       '#FFFFFF',
  primary:    '#475569',
  secondary:  '#5B6270',
  accent:     '#64748B',
  success:    '#1A7F37',
  warning:    '#946200',
  error:      '#C0392B',
  text:       '#1A1D22',
  mutedText:  '#5B6270',
};

export const v3Dark: V3Colors = {
  background: '#14171C',
  card:       '#1B1F27',
  primary:    '#9CA3AF',
  secondary:  '#9AA3AF',
  accent:     '#CBD5E1',
  success:    '#4CAF6D',
  warning:    '#E0A73B',
  error:      '#E0655A',
  text:       '#E9EBEE',
  mutedText:  '#9AA3AF',
};

// Theme.qml's spacingSmall/Medium/Large and radiusSmall/radiusCard, unchanged.
export const v3Spacing = { small: 8, medium: 16, large: 24 };
export const v3Radius = { small: 8, card: 16 };

// Theme.qml's real type scale (10-24px named tokens, its own 2026-08-09 addition).
export const v3Type = {
  tiny: 10,
  caption: 11,
  label: 12,
  body: 13,
  bodyLarge: 14,
  subtitle: 15,
  heading: 16,
  title: 18,
  largeTitle: 20,
  display: 24,
};

export function useV3Theme(): V3Colors {
  const { isDark } = useThemeMode();
  return isDark ? v3Dark : v3Light;
}
