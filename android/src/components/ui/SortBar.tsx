// ─── SortBar ────────────────────────────────────────────────────────────────
// The in-page "Sort:" control at the top of each list screen (Activities, Routes, POIs) -
// a small horizontal chip row, one chip per sort key the surface offers. In-page state (not
// persisted), per André's "on each list page" choice. Styled to match LogListScreen's own
// filter chips so the two rows read as one toolbar.

import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useV3Theme } from '../../theme/v3';
import { t } from '../../i18n';
import { SortKey } from '../../services/ListViewPrefs';

const LABELS: Record<SortKey, () => string> = {
  uploaded: () => t.sortUploaded,
  name: () => t.sortName,
  distance: () => t.sortDistance,
  ascent: () => t.sortAscent,
};

export function SortBar({
  keys, value, onChange,
}: {
  keys: SortKey[];
  value: SortKey;
  onChange: (key: SortKey) => void;
}) {
  const theme = useV3Theme();
  const styles = createStyles(theme);
  if (keys.length < 2) return null; // nothing to choose (e.g. POIs = name only)
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.bar}
      contentContainerStyle={styles.content}
    >
      <Text style={styles.label}>{t.sortBy}</Text>
      {keys.map(key => {
        const active = value === key;
        return (
          <TouchableOpacity
            key={key}
            style={[styles.chip, active && styles.chipActive]}
            onPress={() => onChange(key)}
            activeOpacity={0.7}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{LABELS[key]()}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const createStyles = (t: ReturnType<typeof useV3Theme>) => StyleSheet.create({
  bar: { maxHeight: 48, backgroundColor: t.background },
  content: { paddingHorizontal: 12, paddingVertical: 6, gap: 8, alignItems: 'center' },
  label: { fontSize: 12.5, color: t.mutedText, fontWeight: '600', marginRight: 2 },
  chip: {
    backgroundColor: t.card,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: t.mutedText + '33',
  },
  chipActive: { backgroundColor: t.primary + '1F', borderColor: t.primary },
  chipText: { fontSize: 12.5, color: t.mutedText, fontWeight: '500' },
  chipTextActive: { color: t.primary, fontWeight: '700' },
});
