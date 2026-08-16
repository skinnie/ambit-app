// ─── ViewModeToggle ───────────────────────────────────────────────────────────
// The map/list view control for the top of a list screen (Activities/Routes/POIs). Moved out
// of Settings onto the screens themselves (André, 2026-08-16). Originally a two-segment pill,
// but to match the desktop it is now a text dropdown "as the other stuff" (André, 2026-08-16):
// a pill styled like the metric-column pills that opens a small themed menu (Map / List). On the
// Activities screen it is placed as the first item of the column row, far left, on the same line
// as the metric dropdowns - mirroring desktop. The choice still persists (the screen wires it).

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, StyleSheet } from 'react-native';
import { useV3Theme } from '../../theme/v3';
import Icon from './Icon';
import { ViewMode } from '../../services/ListViewPrefs';
import { t } from '../../i18n';

export function ViewModeToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  const theme = useV3Theme();
  const styles = createStyles(theme);
  const [open, setOpen] = useState(false);

  return (
    <>
      <TouchableOpacity style={styles.pill} onPress={() => setOpen(true)} activeOpacity={0.7}>
        <Text style={styles.pillText}>{mode === 'list' ? t.viewList : t.viewMap}</Text>
        <Text style={styles.caret}>▾</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          {/* Stop propagation so taps inside the card don't dismiss it. */}
          <Pressable style={styles.card} onPress={() => {}}>
            {(['map', 'list'] as ViewMode[]).map(m => {
              const checked = m === mode;
              return (
                <Pressable key={m} style={styles.row} onPress={() => { onChange(m); setOpen(false); }}>
                  <View style={styles.checkSlot}>
                    {checked && <Icon name="check" size={15} color={theme.primary} />}
                  </View>
                  <Icon name={m === 'map' ? 'map' : 'list'} size={15} color={checked ? theme.primary : theme.text} />
                  <Text style={[styles.rowText, checked && { color: theme.primary, fontWeight: '700' }]}>
                    {m === 'map' ? t.viewMap : t.viewList}
                  </Text>
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const createStyles = (t: ReturnType<typeof useV3Theme>) => StyleSheet.create({
  // Matches LogListScreen's colPill so the view dropdown reads as one of the header dropdowns.
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: t.card,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: t.mutedText + '33',
  },
  pillText: { fontSize: 12.5, color: t.text, fontWeight: '500' },
  caret: { fontSize: 11, color: t.mutedText },

  backdrop: {
    flex: 1, backgroundColor: '#00000066',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  card: {
    width: '100%', maxWidth: 280,
    backgroundColor: t.card, borderRadius: 16,
    borderWidth: 1, borderColor: t.mutedText + '55',
    paddingVertical: 8,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 12, paddingHorizontal: 16,
  },
  checkSlot: { width: 15, alignItems: 'center' },
  rowText: { fontSize: 14, color: t.text },
});
