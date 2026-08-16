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
// as before: one shared layout/type language across both apps. As of 2026-08-15 the COLOR
// palette is fully mutualized with desktop too: dark mode was already the shared slate grey
// (the 2026-08-09 "change to a nicer grey" pass), and light mode is now back on desktop's
// teal (see v3Light below) after that pass had left the two apps mismatched in light mode.
// Every token here now equals its Theme.qml counterpart exactly, so the two apps render the
// same colors in both themes.

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
  // 2026-08-15 (André, full design-parity audit: "the android app should look 100%
  // identical to the desktop except the intervals. Desktop is our baseline"). Light-mode
  // primary/accent were a slate grey (#475569/#64748B) - a leftover from the 2026-08-09
  // "change to a nicer grey" pass, which only ever mutualized the DARK palette (both apps
  // are grey in dark mode, see v3Dark below and Theme.qml's _dark* block). Light mode was
  // never brought back into line: desktop stayed on its teal identity (Theme.qml's
  // _lightPrimary #167E6A / _lightAccent #2FA98C), Android was left grey - so the two apps
  // did not match in light mode. Restored to desktop's exact teal so they do.
  primary:    '#167E6A',
  secondary:  '#5B6270',
  accent:     '#2FA98C',
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
  // 2026-08-11 (André, S2): was #9AA3AF, which measures 6.5:1 on the dark card but is the
  // colour caption text uses - at that size antialiasing renders it noticeably dimmer than
  // the number suggests. #B4BDC9 is 8.7:1 and still a soft grey-blue, not white. Kept
  // identical to desktop/qml/Theme.qml's _darkMutedText on purpose.
  mutedText:  '#B4BDC9',
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
