import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Icon from './ui/Icon';
import { useV3Theme } from '../theme/v3';
import { Display } from '../services/CustomModesReader';

export type LayoutType = '1row' | '2rows' | '3rows' | 'graph' | 'map' | 'builtin';

// Real, 2026-08-09 (v3.0 UI port, "replicate the desktop version feature wise") - direct RN
// port of desktop/qml/components/WatchFacePreview.qml: a circular mockup matching
// SuuntoLink's own real screen-preview (assets/ambit3 pcap/v2/screens sports modes/
// 8displaysmax.JPG, displaytype.JPG) - row *position* (numbered, or a small graph glyph),
// not real field content, same as SuuntoLink's own mockup and for the same reason (no live
// sample values to show honestly).
export function WatchFacePreview({
  layoutType, selected = false, diameter = 100,
}: { layoutType: LayoutType; selected?: boolean; diameter?: number }) {
  const t = useV3Theme();
  const rowCount = layoutType === '1row' ? 1 : layoutType === '2rows' ? 2 : layoutType === '3rows' ? 3 : 0;

  return (
    <View
      style={[
        styles.circle,
        {
          width: diameter, height: diameter, borderRadius: diameter / 2,
          backgroundColor: t.background,
          borderWidth: selected ? 3 : 1,
          borderColor: selected ? t.primary : t.mutedText,
        },
      ]}
    >
      {rowCount > 0 && (
        <View style={{ width: diameter * 0.6, gap: diameter * 0.06 }}>
          {Array.from({ length: rowCount }).map((_, i) => (
            <Text key={i} style={[styles.rowText, { fontSize: diameter * 0.16, color: t.text }]}>
              {i + 1}
            </Text>
          ))}
        </View>
      )}

      {layoutType === 'graph' && (
        <View style={{ width: diameter * 0.7, alignItems: 'center', gap: diameter * 0.05 }}>
          <Svg width={diameter * 0.7} height={diameter * 0.28} viewBox="0 0 100 100" preserveAspectRatio="none">
            <Path
              d="M0,70 L25,20 L50,60 L75,10 L100,50"
              stroke={t.primary}
              strokeWidth={3}
              fill="none"
            />
          </Svg>
          <Text style={[styles.rowText, { fontSize: diameter * 0.14, color: t.text }]}>1</Text>
        </View>
      )}

      {layoutType === 'map' && <Icon name="route" size={diameter * 0.32} color={t.mutedText} />}
      {layoutType === 'builtin' && <Icon name="watch" size={diameter * 0.32} color={t.mutedText} />}
    </View>
  );
}

// Same real classification as SportModesPage.qml's own displayLayoutType() - a display's
// isBuiltIn/template/fields.length decide the mockup shape, ported field-for-field.
export function displayLayoutType(display: Display): LayoutType {
  if (display.isBuiltIn) {
    return display.templateName === 'PID_RUNNER_GPS_TEMPLATE_50_MAP_DRAW' ? 'map' : 'builtin';
  }
  if (display.templateName.indexOf('GRAPH') >= 0) return 'graph';
  const n = display.fields.length;
  return n === 1 ? '1row' : n === 2 ? '2rows' : '3rows';
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
  rowText: { fontWeight: '700', textAlign: 'center' },
});
