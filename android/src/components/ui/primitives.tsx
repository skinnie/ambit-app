import React from 'react';
import {
  View, Text, TextInput, TextInputProps, TouchableOpacity, ActivityIndicator, ViewStyle,
  useWindowDimensions,
} from 'react-native';
import { useV3Theme, v3Radius, v3Spacing, v3Type } from '../../theme/v3';
import { Card } from './Card';
import Icon, { IconName } from './Icon';

// v3.0 UI port (2026-08-09, "go all the way to the new theming") - this was the v2.5.0
// black/white/grey UI's shared kit; every screen that imports from here now gets desktop's
// real teal palette instead, the same way HomeScreen did first as the proof of concept.
// tokens.ts/useTheme() still exist (nothing here deletes them) but nothing in this file
// reads them anymore - every color below comes from useV3Theme(), so a future palette tweak
// in theme/v3.ts (or in Theme.qml, which this is copied from) changes every screen at once.
//
// Desktop has no literal counterpart for several of these (Chip/Badge/ActionTile/IconBadge/
// WarningNote don't exist in qml/components/ - QML's real components are Card/RoundedButton/
// RoundedSwitch/etc.) so those get a *faithful-in-spirit*, not pixel-copied, v3 treatment:
// same palette, spacing and radius tokens, same "rounded surfaces + shadow, not borders"
// design language as Card.qml's own header comment describes, applied to shapes desktop
// doesn't have a specific answer for.

// ── Section — a Card with an optional title/description ────────────────────
export function Section({
  title, description, children, style,
}: { title?: string; description?: string; children?: React.ReactNode; style?: ViewStyle }) {
  const t = useV3Theme();
  return (
    <Card style={[{ marginBottom: v3Spacing.medium }, style]}>
      {!!title && (
        <Text style={{ fontSize: v3Type.heading, fontWeight: '700', color: t.text, marginBottom: description ? 6 : 0 }}>
          {title}
        </Text>
      )}
      {!!description && (
        <Text style={{ fontSize: v3Type.body, color: t.mutedText, lineHeight: 19, marginBottom: 4 }}>
          {description}
        </Text>
      )}
      {children}
    </Card>
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
  const t = useV3Theme();
  const isAlert = tone === 'alert';
  let bg = 'transparent';
  let fg = t.text;
  let borderColor: string | undefined;

  if (variant === 'filled') {
    bg = isAlert ? t.error : t.primary;
    // Real, ported from desktop/qml/components/RoundedButton.qml's own contentItem: text on
    // a filled/checked button is Theme.card (the surface color), not a separate "on-primary"
    // token invented for RN - card is always legible against primary in both light and dark.
    fg = isAlert ? '#ffffff' : t.card;
  } else if (variant === 'outline') {
    borderColor = isAlert ? t.error : t.primary;
    fg = isAlert ? t.error : t.text;
  } else {
    fg = isAlert ? t.error : t.mutedText;
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.75}
      style={[
        {
          flexGrow: grow ? 1 : 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
          paddingVertical: variant === 'text' ? 9 : 12, paddingHorizontal: v3Spacing.medium, borderRadius: v3Radius.small,
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
          <Text style={{ color: fg, fontWeight: '600', fontSize: v3Type.bodyLarge }}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

// ── StatusLine — replaces the old colored dot + text pattern ──────────────
export function StatusLine({ text, tone = 'muted' }: { text: string; tone?: 'muted' | 'alert' }) {
  const t = useV3Theme();
  const color = tone === 'alert' ? t.error : t.mutedText;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 10 }}>
      <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: color, flexShrink: 0 }} />
      <Text style={{ fontSize: v3Type.label, fontWeight: '600', color, flexShrink: 1 }}>{text}</Text>
    </View>
  );
}

// ── WarningNote — neutral surface, warning-colored icon ────────────────────
export function WarningNote({ children }: { children: React.ReactNode }) {
  const t = useV3Theme();
  return (
    <View style={{
      flexDirection: 'row', gap: 8, alignItems: 'flex-start',
      backgroundColor: t.card, borderRadius: v3Radius.small, padding: 12, marginTop: 8,
    }}>
      <Icon name="warning" size={15} color={t.warning} />
      <Text style={{ flex: 1, fontSize: v3Type.label, color: t.mutedText, lineHeight: 17 }}>{children}</Text>
    </View>
  );
}

// ── Chip — small filled pill, e.g. "Connected" - tinted with the primary
// color (a real status pill, not a neutral bordered box) ───────────────────
export function Chip({ label, icon }: { label: string; icon?: IconName }) {
  const t = useV3Theme();
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
      backgroundColor: t.primary + '1F', borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10, marginTop: 8,
    }}>
      {!!icon && <Icon name={icon} size={12} color={t.primary} />}
      <Text style={{ fontSize: v3Type.label, fontWeight: '600', color: t.primary }}>{label}</Text>
    </View>
  );
}

// ── Badge — tiny neutral label pill, e.g. "v2.5.15" ─────────────────────────
export function Badge({ label }: { label: string }) {
  const t = useV3Theme();
  return (
    <Text style={{
      fontSize: v3Type.tiny, fontWeight: '700', letterSpacing: 0.3, color: t.mutedText,
      backgroundColor: t.mutedText + '1A',
      borderRadius: v3Radius.small - 2, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden',
    }}>
      {label}
    </Text>
  );
}

// ── IconBadge — circular icon container, e.g. card headers ─────────────────
export function IconBadge({ icon, size = 34 }: { icon: IconName; size?: number }) {
  const t = useV3Theme();
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: t.primary + '1A',
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Icon name={icon} size={size * 0.5} color={t.primary} />
    </View>
  );
}

// ── FieldRow — icon-prefixed text input ─────────────────────────────────────
export function FieldRow({ icon, style, ...inputProps }: { icon: IconName } & TextInputProps) {
  const t = useV3Theme();
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: t.card, borderColor: t.mutedText + '33', borderWidth: 1,
      borderRadius: v3Radius.small, paddingHorizontal: 12, marginTop: 10,
    }}>
      <Icon name={icon} size={15} color={t.mutedText} />
      <TextInput
        placeholderTextColor={t.mutedText}
        style={[{ flex: 1, color: t.text, fontSize: v3Type.bodyLarge, paddingVertical: 10 }, style]}
        {...inputProps}
      />
    </View>
  );
}

// ── ActionTile — Card-surfaced square used on Home's action grid ───────────
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
  const t = useV3Theme();
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
        backgroundColor: t.card, borderColor: busy ? t.primary : 'transparent', borderWidth: busy ? 1.4 : 0,
        borderRadius: v3Radius.card - 2, paddingVertical: 14, paddingHorizontal: 6,
        alignItems: 'center', justifyContent: 'center', gap: 6,
        opacity: disabled && !busy ? 0.5 : 1,
        elevation: 2, shadowColor: '#000000', shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1, shadowRadius: 4,
      }}
    >
      {busy ? <ActivityIndicator size="small" color={t.primary} /> : <Icon name={icon} size={20} color={t.text} />}
      <Text style={{ fontSize: v3Type.tiny, fontWeight: '700', letterSpacing: 0.3, color: t.text, textAlign: 'center' }} numberOfLines={2}>
        {label}
      </Text>
      {/* Always rendered (space when idle) so every tile reserves the same
          height whether or not it's currently showing progress — otherwise
          the busy tile grows a line taller than its neighbors. */}
      <Text style={{ fontSize: v3Type.tiny - 1, color: t.mutedText }}>{progress ?? ' '}</Text>
    </TouchableOpacity>
  );
}

// ── Logo — mountain mark + optional "AmbitApp" wordmark ────────────────────
export function Logo({ size = 64, wordmark = true }: { size?: number; wordmark?: boolean }) {
  const t = useV3Theme();
  return (
    <View style={{ alignItems: 'center' }}>
      <Icon name="mountain" size={size} color={t.primary} />
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
  const t = useV3Theme();
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: t.mutedText + '22',
    }}>
      <Text style={{ color: t.mutedText, fontSize: v3Type.label, flex: 1, marginRight: 10 }} numberOfLines={1}>
        {fileName}
      </Text>
      <TouchableOpacity onPress={onShare}>
        <Text style={{ color: t.primary, fontSize: v3Type.label, fontWeight: '700' }}>{shareLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}
