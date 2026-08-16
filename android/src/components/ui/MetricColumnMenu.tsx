// ─── MetricColumnMenu ─────────────────────────────────────────────────────────
// The dropdown for one configurable Activities column (port of desktop ThemedMenu). A themed
// rounded-card popup (rounded corners, app card colour, teal check) with: sort asc/desc,
// the metric list to change the column (already-used metrics are filtered out by the caller,
// so no duplicates), and remove. Rendered as a centred Modal - RN has no native menu, and a
// centred sheet is the phone-friendly equivalent of the desktop menu.

import React from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useV3Theme } from '../../theme/v3';
import Icon from './Icon';
import { MetricDef } from '../../services/ActivityMetrics';
import { t } from '../../i18n';

export function MetricColumnMenu({
  visible, currentKey, metrics, canRemove, onSort, onPick, onRemove, onClose,
}: {
  visible: boolean;
  currentKey: string;
  metrics: MetricDef[];
  canRemove: boolean;
  onSort: (desc: boolean) => void;
  onPick: (key: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const theme = useV3Theme();
  const styles = createStyles(theme);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Stop propagation so taps inside the card don't dismiss it. */}
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.heading}>{t.sortBy}</Text>
          <Pressable style={styles.row} onPress={() => { onSort(false); onClose(); }}>
            <Text style={[styles.arrow, { color: theme.text }]}>↑</Text>
            <Text style={styles.rowText}>{t.colSortAsc}</Text>
          </Pressable>
          <Pressable style={styles.row} onPress={() => { onSort(true); onClose(); }}>
            <Text style={[styles.arrow, { color: theme.text }]}>↓</Text>
            <Text style={styles.rowText}>{t.colSortDesc}</Text>
          </Pressable>

          <View style={styles.divider} />
          <Text style={styles.heading}>{t.colShow}</Text>
          <ScrollView style={styles.metricsScroll} showsVerticalScrollIndicator={false}>
            {metrics.map(m => {
              const checked = m.key === currentKey;
              return (
                <Pressable key={m.key} style={styles.row} onPress={() => { onPick(m.key); onClose(); }}>
                  <View style={styles.checkSlot}>
                    {checked && <Icon name="check" size={15} color={theme.primary} />}
                  </View>
                  <Text style={[styles.rowText, checked && { color: theme.primary, fontWeight: '700' }]}>
                    {m.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {canRemove && (
            <>
              <View style={styles.divider} />
              <Pressable style={styles.row} onPress={() => { onRemove(); onClose(); }}>
                <Icon name="delete" size={15} color={theme.error} />
                <Text style={[styles.rowText, { color: theme.error }]}>{t.colRemove}</Text>
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const createStyles = (t: ReturnType<typeof useV3Theme>) => StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#00000066',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    maxHeight: '80%',
    backgroundColor: t.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.mutedText + '55',
    paddingVertical: 8,
  },
  heading: {
    fontSize: 11.5,
    color: t.mutedText,
    fontWeight: '700',
    textTransform: 'uppercase',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 16,
  },
  checkSlot: { width: 15, alignItems: 'center' },
  arrow: { fontSize: 16, width: 16, textAlign: 'center' },
  rowText: { fontSize: 14, color: t.text },
  metricsScroll: { flexGrow: 0 },
  divider: { height: 1, backgroundColor: t.mutedText + '33', marginVertical: 4, marginHorizontal: 8 },
});
