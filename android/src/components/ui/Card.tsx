import React from 'react';
import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { useV3Theme, v3Radius, v3Spacing } from '../../theme/v3';

// Real, 2026-08-09 (v3.0 UI port) - the RN equivalent of desktop/qml/components/Card.qml:
// "the base surface every content card in the app builds on... one implementation, so a
// future design tweak changes every card at once." Same radius/shadow-strength reasoning,
// ported via RN's elevation (Android) / shadow* (iOS) instead of QML's MultiEffect.
export function Card({
  children,
  padding = v3Spacing.medium,
  style,
}: {
  children: React.ReactNode;
  padding?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useV3Theme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: t.card, borderRadius: v3Radius.card, padding },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    // Matches Card.qml's MultiEffect (shadowBlur 0.5, verticalOffset 2, no horizontal) as
    // closely as RN's two separate shadow models allow.
    elevation: 3,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.14,
    shadowRadius: 6,
  },
});
