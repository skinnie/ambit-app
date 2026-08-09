import React from 'react';
import {
  View, Text, TextInput, TextInputProps, TouchableOpacity, ActivityIndicator, ViewStyle,
  useWindowDimensions,
} from 'react-native';
import { useTheme } from '../../theme/useTheme';
import Icon, { IconName } from './Icon';

// Shared presentational kit for the v2.5.0 black/white/grey UI. No colors are
// hardcoded here — everything comes from useTheme() so every component works
// in both light and dark automatically. The single `alert` token is only
// ever passed in for errors and destructive actions (see tone="alert").

// ── Section — a bordered card with an optional title/description ──────────
export function Section({
  title, description, children, style,
}: { title?: string; description?: string; children?: React.ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return (
    <View style={[{
      backgroundColor: t.surface, borderColor: t.outline, borderWidth: 1,
      borderRadius: 16, padding: 16, marginBottom: 16,
    }, style]}>
      {!!title && (
        <Text style={{ fontSize: 16, fontWeight: '700', color: t.text, marginBottom: description ? 6 : 0 }}>
          {title}
        </Text>
      )}
      {!!description && (
        <Text style={{ fontSize: 13, color: t.textMuted, lineHeight: 19, marginBottom: 4 }}>
          {description}
        </Text>
      )}
      {children}
    </View>
  );
}

// ── Button — filled (primary) / outline (secondary) / text (tertiary) ─────
type ButtonVariant = 'filled' | 'outline' | 'text';
export function Button({
  label, onPress, disabled, loading, icon, variant = 'filled', tone = 'default', grow = true, style,
}: {
  label: string; onPress: () => void; disabled?: boolean; loading?: boolean;
  icon?: IconName; variant?: ButtonVariant; tone?: 'default' | 'alert'; grow?: boolean; style?: ViewStyle;
}) {
  const t = useTheme();
  const isAlert = tone === 'alert';
  let bg = 'transparent';
  let fg = t.text;
  let borderColor: string | undefined;

  if (variant === 'filled') {
    bg = isAlert ? t.alert : t.primary;
    fg = isAlert ? '#ffffff' : t.onPrimary;
  } else if (variant === 'outline') {
    borderColor = isAlert ? t.alert : t.outline;
    fg = isAlert ? t.alert : t.text;
  } else {
    fg = isAlert ? t.alert : t.textMuted;
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.75}
      style={[
        {
          flexGrow: grow ? 1 : 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
          paddingVertical: variant === 'text' ? 9 : 12, paddingHorizontal: 16, borderRadius: 10,
          backgroundColor: bg, borderColor, borderWidth: borderColor ? 1.4 : 0,
          opacity: disabled || loading ? 0.5 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <>
          {!!icon && <Icon name={icon} size={16} color={fg} />}
          <Text style={{ color: fg, fontWeight: '600', fontSize: 14 }}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

// ── StatusLine — replaces the old colored dot + text pattern ──────────────
export function StatusLine({ text, tone = 'muted' }: { text: string; tone?: 'muted' | 'alert' }) {
  const t = useTheme();
  const color = tone === 'alert' ? t.alert : t.textMuted;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 10 }}>
      <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: color, flexShrink: 0 }} />
      <Text style={{ fontSize: 12, fontWeight: '600', color, flexShrink: 1 }}>{text}</Text>
    </View>
  );
}

// ── WarningNote — neutral bordered caution box (no amber) ─────────────────
export function WarningNote({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{
      flexDirection: 'row', gap: 8, alignItems: 'flex-start',
      backgroundColor: t.surfaceHigh, borderColor: t.outline, borderWidth: 1,
      borderRadius: 10, padding: 12, marginTop: 8,
    }}>
      <Icon name="warning" size={15} color={t.textMuted} />
      <Text style={{ flex: 1, fontSize: 12, color: t.textMuted, lineHeight: 17 }}>{children}</Text>
    </View>
  );
}

// ── Chip — small bordered pill, e.g. "Connected" ───────────────────────────
export function Chip({ label, icon }: { label: string; icon?: IconName }) {
  const t = useTheme();
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
      backgroundColor: t.surfaceHigh, borderColor: t.outline, borderWidth: 1,
      borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10, marginTop: 8,
    }}>
      {!!icon && <Icon name={icon} size={12} color={t.text} />}
      <Text style={{ fontSize: 11, fontWeight: '600', color: t.text }}>{label}</Text>
    </View>
  );
}

// ── Badge — tiny uppercase-ish label pill, e.g. "Experimental" ─────────────
export function Badge({ label }: { label: string }) {
  const t = useTheme();
  return (
    <Text style={{
      fontSize: 10, fontWeight: '700', letterSpacing: 0.3, color: t.textMuted,
      backgroundColor: t.surfaceHigh, borderColor: t.outline, borderWidth: 1,
      borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden',
    }}>
      {label}
    </Text>
  );
}

// ── IconBadge — circular icon container, e.g. card headers ─────────────────
export function IconBadge({ icon, size = 34 }: { icon: IconName; size?: number }) {
  const t = useTheme();
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: t.surfaceHigh, borderColor: t.outline, borderWidth: 1,
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Icon name={icon} size={size * 0.5} color={t.text} />
    </View>
  );
}

// ── FieldRow — icon-prefixed text input ─────────────────────────────────────
export function FieldRow({ icon, style, ...inputProps }: { icon: IconName } & TextInputProps) {
  const t = useTheme();
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: t.surfaceHigh, borderColor: t.outline, borderWidth: 1,
      borderRadius: 10, paddingHorizontal: 12, marginTop: 10,
    }}>
      <Icon name={icon} size={15} color={t.textMuted} />
      <TextInput
        placeholderTextColor={t.textMuted}
        style={[{ flex: 1, color: t.text, fontSize: 14, paddingVertical: 10 }, style]}
        {...inputProps}
      />
    </View>
  );
}

// ── ActionTile — flat bordered square used on Home's action grid ───────────
export function ActionTile({
  icon, label, progress, onPress, disabled, busy, basis,
}: {
  icon: IconName; label: string; progress?: string; onPress: () => void; disabled?: boolean; busy?: boolean;
  // Column width as a flex-basis. When omitted it adapts to the screen: two columns on
  // phones, three on roomy/landscape/tablet widths. flexGrow 0 keeps a lone trailing tile
  // at its column width (centered by the row) rather than stretching full-width. The row
  // is width-capped upstream, so this stays clean from phones to tablets.
  basis?: string | number;
}) {
  const t = useTheme();
  const { width, height } = useWindowDimensions();
  // Column count adapts to the screen (row is width-capped upstream: ~560 portrait,
  // ~960 landscape), targeting ~170 px tiles:
  //   landscape/roomy → ~5 across   ·   portrait tablet → 3 across   ·   phone → 2.
  // Orientation-based (not width-only) so a portrait tablet — wide but tall — stays a
  // 3-column column layout, matching the pre-landscape look.
  const roomy = width > height && width >= 700;
  const effectiveBasis = basis ?? (roomy ? '18%' : width < 480 ? '48%' : '30%');
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.75}
      style={{
        flexBasis: effectiveBasis, flexGrow: 0, minWidth: 84,
        backgroundColor: t.surfaceHigh, borderColor: busy ? t.text : t.outline, borderWidth: busy ? 1.4 : 1,
        borderRadius: 14, paddingVertical: 14, paddingHorizontal: 6,
        alignItems: 'center', justifyContent: 'center', gap: 6,
        opacity: disabled && !busy ? 0.5 : 1,
      }}
    >
      {busy ? <ActivityIndicator size="small" color={t.text} /> : <Icon name={icon} size={20} color={t.text} />}
      <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 0.3, color: t.text, textAlign: 'center' }} numberOfLines={2}>
        {label}
      </Text>
      {/* Always rendered (space when idle) so every tile reserves the same
          height whether or not it's currently showing progress — otherwise
          the busy tile grows a line taller than its neighbors. */}
      <Text style={{ fontSize: 9, color: t.textMuted }}>{progress ?? ' '}</Text>
    </TouchableOpacity>
  );
}

// ── Logo — mountain mark + optional "AmbitApp" wordmark ────────────────────
export function Logo({ size = 64, wordmark = true }: { size?: number; wordmark?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center' }}>
      <Icon name="mountain" size={size} color={t.text} />
      {wordmark && (
        <Text style={{ marginTop: 3, fontSize: Math.round(size * 0.26), fontWeight: '800', color: t.text, letterSpacing: 0.4 }}>
          AmbitApp
        </Text>
      )}
    </View>
  );
}

// ── ExportedFileRow — filename + a share link, used by the Garmin screens ──
export function ExportedFileRow({
  fileName, onShare, shareLabel,
}: { fileName: string; onShare: () => void; shareLabel: string }) {
  const t = useTheme();
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: t.outline,
    }}>
      <Text style={{ color: t.textMuted, fontSize: 12, flex: 1, marginRight: 10 }} numberOfLines={1}>
        {fileName}
      </Text>
      <TouchableOpacity onPress={onShare}>
        <Text style={{ color: t.text, fontSize: 12, fontWeight: '700' }}>{shareLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}
