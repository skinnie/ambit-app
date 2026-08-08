// v2.5.0 UI redesign — sober, flat, grayscale. No accent hue; the single
// `alert` tone exists only for errors and destructive actions (deleting a
// stored credential, a failed sync) — never for a normal connected/done
// state, which stays neutral. See the approved mockup this was built from
// for the full rationale.

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceHigh: string;
  text: string;
  textMuted: string;
  outline: string;
  primary: string;
  onPrimary: string;
  alert: string;
}

export const lightColors: ThemeColors = {
  background:  '#ffffff',
  surface:     '#f6f6f6',
  surfaceHigh: '#ececec',
  text:        '#111111',
  textMuted:   '#6e6e6e',
  outline:     '#dcdcdc',
  primary:     '#111111',
  onPrimary:   '#ffffff',
  alert:       '#9c3b2e',
};

export const darkColors: ThemeColors = {
  background:  '#1a1a1a',
  surface:     '#242424',
  surfaceHigh: '#2e2e2e',
  text:        '#f2f2f2',
  textMuted:   '#9a9a9a',
  outline:     '#3a3a3a',
  primary:     '#f2f2f2',
  onPrimary:   '#1a1a1a',
  alert:       '#d97a63',
};
