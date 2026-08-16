// ─── DemoDevicePicker ─────────────────────────────────────────────────────────
// Testing mode's "choose a device to simulate" sheet (port of desktop DemoDevicePicker). A
// themed rounded-card Modal listing the watches the app understands; picking one drives the
// pretend-connected Home. The current one is checked.

import React from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useV3Theme } from '../../theme/v3';
import Icon from './Icon';
import { DEMO_DEVICES } from '../../services/DemoDevices';
import { t } from '../../i18n';

export function DemoDevicePicker({
  visible, currentVariant, onPick, onClose,
}: {
  visible: boolean;
  currentVariant: string;
  onPick: (variant: string) => void;
  onClose: () => void;
}) {
  const theme = useV3Theme();
  const styles = createStyles(theme);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.heading}>{t.demoPickTitle}</Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {DEMO_DEVICES.map(d => {
              const checked = d.variant === currentVariant;
              return (
                <Pressable key={d.variant} style={styles.row} onPress={() => { onPick(d.variant); onClose(); }}>
                  <View style={styles.checkSlot}>
                    {checked && <Icon name="check" size={16} color={theme.primary} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.name, checked && { color: theme.primary }]}>{d.name}</Text>
                    <Text style={styles.sub}>fw {d.fwVersion} · {d.battery}%</Text>
                  </View>
                  <Icon name="watch" size={18} color={theme.mutedText} />
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const createStyles = (t: ReturnType<typeof useV3Theme>) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000066', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: {
    width: '100%', maxWidth: 380, maxHeight: '80%',
    backgroundColor: t.card, borderRadius: 16, borderWidth: 1, borderColor: t.mutedText + '55',
    paddingVertical: 10,
  },
  heading: {
    fontSize: 11.5, color: t.mutedText, fontWeight: '700', textTransform: 'uppercase',
    paddingHorizontal: 16, paddingBottom: 6,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 16 },
  checkSlot: { width: 16, alignItems: 'center' },
  name: { fontSize: 14.5, color: t.text, fontWeight: '600' },
  sub: { fontSize: 11.5, color: t.mutedText, marginTop: 1 },
});
