import { lightColors, darkColors, ThemeColors } from './tokens';
import { useThemeMode } from './ThemeModeContext';

export function useTheme(): ThemeColors {
  const { isDark } = useThemeMode();
  return isDark ? darkColors : lightColors;
}
