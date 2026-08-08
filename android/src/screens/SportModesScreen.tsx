import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Switch,
  StyleSheet, Alert, ScrollView, ActivityIndicator, Modal, FlatList,
} from 'react-native';
import { ExerciseMode, FIELD_TYPES } from '../services/CustomModesReader';
import {
  readCustomModes, renameCustomMode, writeCustomModeField, writeCustomModeDisplayField,
} from '../services/CustomModesService';
import { t } from '../i18n';

// Real, 2026-08-08 - mirrors the desktop app's own SportModesPage.qml feature set exactly
// (rename, autolap, HR limits, external-sensor pods, per-display field type), against the
// same real, hardware-confirmed CustomModes write mechanism (see CustomModesWriter.ts's own
// header comment). Ambit3-only - App.tsx/HomeScreen.tsx only route here when the connected
// watch isn't Kailash (its own memory map has no CustomModes region at all).
//
// The native write path itself (writeCustomModesRaw()) is NOT yet hardware-confirmed on
// Android - see that function's own doc comment in native/AmbitUsbModule.ts. Every write
// here re-reads the whole region afterward and only reports success once the watch's own
// reply matches, the same "prove it" contract AmbitSettingsWriter.ts already established -
// so a broken native composition would show up as a write that doesn't stick, not a silent
// false "done".

// Real, confirmed pod bits (UseHw bitmask) - see custom_modes_andre.md. 0x0004 stays
// unconfirmed and is deliberately left out of this UI, same as the desktop page.
const PODS: { bit: number; label: string }[] = [
  { bit: 0x0001, label: 'HR belt' },
  { bit: 0x0100, label: 'Foot pod' },
  { bit: 0x0800, label: 'Bike pod' },
  { bit: 0x0040, label: 'Power pod' },
];

type Phase = 'idle' | 'connecting' | 'reading' | 'done' | 'error';

interface PickerTarget { mode: string; display: number; field: number }

export default function SportModesScreen() {
  const [modes, setModes] = useState<ExerciseMode[] | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | undefined>();
  const [writingMode, setWritingMode] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [picker, setPicker] = useState<PickerTarget | null>(null);

  const [nameEdits, setNameEdits] = useState<Record<string, string>>({});
  const [autolapEdits, setAutolapEdits] = useState<Record<string, string>>({});
  const [hrLowEdits, setHrLowEdits] = useState<Record<string, string>>({});
  const [hrHighEdits, setHrHighEdits] = useState<Record<string, string>>({});
  const [hrLimitsEdits, setHrLimitsEdits] = useState<Record<string, boolean>>({});

  function applyModes(loaded: ExerciseMode[]) {
    setModes(loaded);
    const names: Record<string, string> = {};
    const autolaps: Record<string, string> = {};
    const hrLows: Record<string, string> = {};
    const hrHighs: Record<string, string> = {};
    const hrLimits: Record<string, boolean> = {};
    for (const m of loaded) {
      names[m.settings.name] = m.settings.name;
      autolaps[m.settings.name] = String(m.settings.autolap);
      hrLows[m.settings.name] = String(m.settings.hrLow);
      hrHighs[m.settings.name] = String(m.settings.hrHigh);
      hrLimits[m.settings.name] = m.settings.hrLimitsUse !== 0;
    }
    setNameEdits(names);
    setAutolapEdits(autolaps);
    setHrLowEdits(hrLows);
    setHrHighEdits(hrHighs);
    setHrLimitsEdits(hrLimits);
  }

  async function handleRead() {
    await readCustomModes(s => {
      setPhase(s.phase);
      setError(s.error);
      if (s.modes) applyModes(s.modes);
    });
  }

  async function withWrite(modeName: string, action: () => Promise<{ ok: boolean; error?: string } | undefined>) {
    setWritingMode(modeName);
    const result = await action();
    setWritingMode(null);
    if (result && !result.ok && result.error) Alert.alert(t.error, result.error);
    await handleRead();
  }

  function handleRename(originalName: string) {
    const newName = (nameEdits[originalName] ?? '').trim();
    if (!newName || newName === originalName) return;
    withWrite(originalName, () =>
      renameCustomMode(originalName, newName, () => {}));
  }

  function handleSetAutolap(modeName: string) {
    const value = parseInt(autolapEdits[modeName] ?? '', 10);
    if (!Number.isFinite(value)) return;
    withWrite(modeName, () =>
      writeCustomModeField(modeName, { Autolap: value }, () => {}));
  }

  function handleSetHrLimits(modeName: string) {
    const low = parseInt(hrLowEdits[modeName] ?? '', 10);
    const high = parseInt(hrHighEdits[modeName] ?? '', 10);
    if (!Number.isFinite(low) || !Number.isFinite(high)) return;
    withWrite(modeName, () =>
      writeCustomModeField(modeName, {
        HrLow: low, HrHigh: high, HrLimitsUse: hrLimitsEdits[modeName] ? 1 : 0,
      }, () => {}));
  }

  function handleTogglePod(modeName: string, currentUseHw: number, bit: number, enabled: boolean) {
    const newUseHw = enabled ? (currentUseHw | bit) : (currentUseHw & ~bit);
    withWrite(modeName, () =>
      writeCustomModeField(modeName, { UseHw: newUseHw }, () => {}));
  }

  function handleSelectFieldType(typeName: string) {
    if (!picker) return;
    const { mode, display, field } = picker;
    setPicker(null);
    withWrite(mode, () =>
      writeCustomModeDisplayField(mode, display, field, undefined, typeName, () => {}));
  }

  function toggleExpanded(modeName: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(modeName)) next.delete(modeName); else next.add(modeName);
      return next;
    });
  }

  const busy = phase === 'connecting' || phase === 'reading';

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.sectionDesc}>{t.sportModesDesc}</Text>

        {!modes && !busy && (
          <TouchableOpacity style={[styles.btn, styles.btnPrimary, { marginTop: 10 }]} onPress={handleRead}>
            <Text style={styles.btnText}>{t.sportModesReadBtn}</Text>
          </TouchableOpacity>
        )}

        {busy && (
          <View style={styles.statusRow}>
            <ActivityIndicator size="small" color="#00e5ff" />
            <Text style={[styles.statusText, { color: '#8899aa', marginLeft: 8 }]}>
              {phase === 'connecting' ? t.connecting : t.sportModesReading}
            </Text>
          </View>
        )}

        {phase === 'error' && error && !modes && (
          <Text style={[styles.sectionDesc, { color: '#f44336', marginTop: 10 }]}>{error}</Text>
        )}

        {modes && (
          <TouchableOpacity style={[styles.btn, styles.btnPrimary, { marginTop: 10 }]} onPress={handleRead} disabled={busy}>
            <Text style={styles.btnText}>{t.sportModesRefreshBtn}</Text>
          </TouchableOpacity>
        )}
      </View>

      {modes && modes.map(mode => {
        const name = mode.settings.name;
        const isExpanded = expanded.has(name);
        const isWriting = writingMode === name;
        return (
          <View key={name} style={styles.section}>
            <View style={styles.modeHeaderRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={nameEdits[name] ?? name}
                onChangeText={v => setNameEdits(prev => ({ ...prev, [name]: v }))}
                placeholderTextColor="#4a5a7a"
                editable={!isWriting}
              />
              <TouchableOpacity
                style={[styles.smallBtn, styles.btnPrimary]}
                disabled={isWriting || (nameEdits[name] ?? name) === name}
                onPress={() => handleRename(name)}
              >
                <Text style={styles.btnText}>{t.sportModesRenameBtn}</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.expandRow} onPress={() => toggleExpanded(name)}>
              <Text style={styles.expandText}>
                {isExpanded ? t.sportModesCollapseBtn : t.sportModesExpandBtn}
              </Text>
            </TouchableOpacity>

            {isWriting && (
              <View style={styles.statusRow}>
                <ActivityIndicator size="small" color="#00e5ff" />
              </View>
            )}

            {isExpanded && (
              <View>
                {/* Autolap */}
                <Text style={styles.label}>{t.sportModesAutolapLabel}</Text>
                <View style={styles.row}>
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    value={autolapEdits[name] ?? ''}
                    onChangeText={v => setAutolapEdits(prev => ({ ...prev, [name]: v }))}
                    keyboardType="numeric"
                    editable={!isWriting}
                  />
                  <TouchableOpacity
                    style={[styles.smallBtn, styles.btnPrimary]}
                    disabled={isWriting}
                    onPress={() => handleSetAutolap(name)}
                  >
                    <Text style={styles.btnText}>{t.sportModesSetBtn}</Text>
                  </TouchableOpacity>
                </View>

                {/* HR limits */}
                <Text style={styles.label}>{t.sportModesHrLimitsLabel}</Text>
                <View style={styles.row}>
                  <Switch
                    value={hrLimitsEdits[name] ?? false}
                    onValueChange={v => setHrLimitsEdits(prev => ({ ...prev, [name]: v }))}
                    disabled={isWriting}
                    trackColor={{ false: '#1a4a7a', true: '#00e5ff88' }}
                    thumbColor="#fff"
                  />
                  <TextInput
                    style={[styles.input, { flex: 1, marginLeft: 10 }]}
                    value={hrLowEdits[name] ?? ''}
                    onChangeText={v => setHrLowEdits(prev => ({ ...prev, [name]: v }))}
                    placeholder={t.sportModesHrLowLabel}
                    placeholderTextColor="#4a5a7a"
                    keyboardType="numeric"
                    editable={!isWriting}
                  />
                  <TextInput
                    style={[styles.input, { flex: 1, marginLeft: 10 }]}
                    value={hrHighEdits[name] ?? ''}
                    onChangeText={v => setHrHighEdits(prev => ({ ...prev, [name]: v }))}
                    placeholder={t.sportModesHrHighLabel}
                    placeholderTextColor="#4a5a7a"
                    keyboardType="numeric"
                    editable={!isWriting}
                  />
                  <TouchableOpacity
                    style={[styles.smallBtn, styles.btnPrimary, { marginLeft: 10 }]}
                    disabled={isWriting}
                    onPress={() => handleSetHrLimits(name)}
                  >
                    <Text style={styles.btnText}>{t.sportModesSetBtn}</Text>
                  </TouchableOpacity>
                </View>

                {/* Pods */}
                <Text style={styles.label}>{t.sportModesPodsLabel}</Text>
                <View style={styles.chipRow}>
                  {PODS.map(pod => {
                    const active = (mode.settings.useHw & pod.bit) !== 0;
                    return (
                      <TouchableOpacity
                        key={pod.bit}
                        style={[styles.chip, active && styles.chipActive]}
                        disabled={isWriting}
                        onPress={() => handleTogglePod(name, mode.settings.useHw, pod.bit, !active)}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>{pod.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Displays */}
                <Text style={styles.label}>{t.sportModesDisplaysLabel}</Text>
                {mode.displays.map((display, di) => (
                  <View key={di} style={styles.displayBlock}>
                    <Text style={styles.displayTitle}>[{di}] {display.templateName}</Text>
                    {display.fields.map((field, fi) => (
                      <View key={fi} style={styles.fieldRow}>
                        <Text style={styles.fieldText} numberOfLines={1}>{field.typeName}</Text>
                        <TouchableOpacity
                          style={[styles.smallBtn, styles.btnPrimary]}
                          disabled={isWriting}
                          onPress={() => setPicker({ mode: name, display: di, field: fi })}
                        >
                          <Text style={styles.btnText}>{t.sportModesChangeBtn}</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            )}
          </View>
        );
      })}

      <Modal visible={!!picker} animationType="slide" transparent onRequestClose={() => setPicker(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.sectionTitle}>{t.sportModesPickerTitle}</Text>
            <FlatList
              data={FIELD_TYPES}
              keyExtractor={item => String(item.value)}
              style={{ maxHeight: 400 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.pickerRow} onPress={() => handleSelectFieldType(item.name)}>
                  <Text style={styles.pickerRowText}>{item.name}</Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={[styles.btn, styles.btnDanger, { marginTop: 10 }]} onPress={() => setPicker(null)}>
              <Text style={styles.btnText}>{t.sportModesCloseBtn}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#16213e' },
  content: { padding: 20 },
  section: {
    backgroundColor: '#0f3460',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: '#00e5ff', marginBottom: 8 },
  sectionDesc: { fontSize: 13, color: '#8899aa', marginBottom: 6, lineHeight: 19 },
  label: { fontSize: 13, color: '#8899aa', marginTop: 12, marginBottom: 4 },
  input: {
    backgroundColor: '#16213e',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1a4a7a',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 14,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  modeHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  expandRow: { marginTop: 10 },
  expandText: { color: '#00e5ff', fontSize: 13, fontWeight: '600' },
  btn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { backgroundColor: '#00e5ff22', borderWidth: 1, borderColor: '#00e5ff' },
  btnDanger:  { backgroundColor: '#f4433622', borderWidth: 1, borderColor: '#f44336' },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  statusText: { color: '#4caf50', fontSize: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  chip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    borderWidth: 1, borderColor: '#1a4a7a', backgroundColor: '#16213e',
  },
  chipActive: { borderColor: '#00e5ff', backgroundColor: '#00e5ff22' },
  chipText: { color: '#8899aa', fontSize: 12 },
  chipTextActive: { color: '#00e5ff', fontWeight: '600' },
  displayBlock: { marginTop: 8, backgroundColor: '#16213e', borderRadius: 10, padding: 10 },
  displayTitle: { color: '#8899aa', fontSize: 12, marginBottom: 6 },
  fieldRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 4,
  },
  fieldText: { color: '#fff', fontSize: 13, flex: 1, marginRight: 8 },
  modalOverlay: { flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: '#0f3460', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16 },
  pickerRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1a4a7a' },
  pickerRowText: { color: '#fff', fontSize: 14 },
});
