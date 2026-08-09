import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Switch,
  StyleSheet, Alert, ScrollView, ActivityIndicator, Modal, FlatList,
} from 'react-native';
import { ExerciseMode, FIELD_TYPES, fieldTypeLabel } from '../services/CustomModesReader';
import {
  readCustomModes, renameCustomMode, writeCustomModeField, writeCustomModeDisplayField,
} from '../services/CustomModesService';
import { t } from '../i18n';
import { useV3Theme, v3Spacing, v3Type } from '../theme/v3';
import { Card } from '../components/ui/Card';
import Icon from '../components/ui/Icon';
import { WatchFacePreview, displayLayoutType } from '../components/WatchFacePreview';

// v3.0 UI port (2026-08-09, "replicate the desktop version feature wise, design wise") -
// full List<->Detail rework matching desktop's own SportModesPage.qml Phase 2 redesign
// (9d4c7be, "full SuuntoLink-style redesign"), not just a recolor: mode list -> tap a mode
// -> detail view with a watch-face filmstrip (WatchFacePreview.tsx, same layout-type
// classification as desktop's own displayLayoutType()) instead of the old inline-expand
// card. Every read/write handler below is unchanged from the previous version of this
// screen - only the JSX changed.
//
// Real, hardware-confirmed pod bits (UseHw bitmask) - see custom_modes_andre.md. 0x0004
// stays unconfirmed and is deliberately left out, same as the desktop page.
const PODS: { bit: number; label: string }[] = [
  { bit: 0x0001, label: 'HR belt' },
  { bit: 0x0100, label: 'Foot pod' },
  { bit: 0x0800, label: 'Bike pod' },
  { bit: 0x0040, label: 'Power pod' },
];

// Real, from SuuntoLink's own real JS source (getMaxDisplays()) - Traverse/Traverse Alpha
// cap at 4, every other variant in this family caps at 8 (see custom_modes.py's own
// _MAX_DISPLAYS_BY_VARIANT). Not wired to the connected device's real variant here yet -
// this screen doesn't currently know which watch is connected (no DeviceCapabilities
// equivalent plumbed in) - hardcoded to the default 8, a real, explicit simplification, not
// a silent gap.
const MAX_DISPLAYS = 8;

type Phase = 'idle' | 'connecting' | 'reading' | 'done' | 'error';

interface PickerTarget { mode: string; display: number; field: number }

export default function SportModesScreen() {
  const theme = useV3Theme();
  const [modes, setModes] = useState<ExerciseMode[] | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | undefined>();
  const [writingMode, setWritingMode] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [selectedDisplayIndex, setSelectedDisplayIndex] = useState(0);
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
    setSelectedName(newName);
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

  const busy = phase === 'connecting' || phase === 'reading';
  const selectedMode = modes?.find(m => m.settings.name === selectedName) ?? null;

  // ── Detail view ──
  if (selectedMode) {
    const name = selectedMode.settings.name;
    const isWriting = writingMode === name;
    const realDisplays = selectedMode.displays.filter(d => !d.isBuiltIn);
    const currentDisplay = selectedMode.displays[selectedDisplayIndex] ?? null;

    return (
      <ScrollView style={styles(theme).root} contentContainerStyle={styles(theme).content}>
        <TouchableOpacity style={styles(theme).backRow} onPress={() => { setSelectedName(null); setSelectedDisplayIndex(0); }}>
          <Icon name="chevronLeft" size={18} color={theme.text} />
          <Text style={[styles(theme).backText]}>{t.sportModesBackBtn}</Text>
        </TouchableOpacity>
        <Text style={styles(theme).modeTitle}>{name}</Text>

        <Card style={{ width: '100%' }}>
          <Text style={styles(theme).label}>{t.sportModesNameLabel}</Text>
          <View style={styles(theme).row}>
            <TextInput
              style={[styles(theme).input, { flex: 1 }]}
              value={nameEdits[name] ?? name}
              onChangeText={v => setNameEdits(prev => ({ ...prev, [name]: v }))}
              placeholderTextColor={theme.mutedText}
              editable={!isWriting}
            />
            <TouchableOpacity
              style={styles(theme).smallBtn}
              disabled={isWriting || (nameEdits[name] ?? name) === name}
              onPress={() => handleRename(name)}
            >
              <Text style={styles(theme).smallBtnText}>{t.sportModesRenameBtn}</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles(theme).label}>{t.sportModesAutolapLabel}</Text>
          <View style={styles(theme).row}>
            <TextInput
              style={[styles(theme).input, { flex: 1 }]}
              value={autolapEdits[name] ?? ''}
              onChangeText={v => setAutolapEdits(prev => ({ ...prev, [name]: v }))}
              keyboardType="numeric"
              editable={!isWriting}
            />
            <TouchableOpacity style={styles(theme).smallBtn} disabled={isWriting} onPress={() => handleSetAutolap(name)}>
              <Text style={styles(theme).smallBtnText}>{t.sportModesSetBtn}</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles(theme).label}>{t.sportModesHrLimitsLabel}</Text>
          <View style={styles(theme).row}>
            <Switch
              value={hrLimitsEdits[name] ?? false}
              onValueChange={v => setHrLimitsEdits(prev => ({ ...prev, [name]: v }))}
              disabled={isWriting}
              trackColor={{ false: theme.mutedText + '55', true: theme.primary + '88' }}
              thumbColor={theme.card}
            />
            <TextInput
              style={[styles(theme).input, { flex: 1, marginLeft: 10 }]}
              value={hrLowEdits[name] ?? ''}
              onChangeText={v => setHrLowEdits(prev => ({ ...prev, [name]: v }))}
              placeholder={t.sportModesHrLowLabel}
              placeholderTextColor={theme.mutedText}
              keyboardType="numeric"
              editable={!isWriting}
            />
            <TextInput
              style={[styles(theme).input, { flex: 1, marginLeft: 10 }]}
              value={hrHighEdits[name] ?? ''}
              onChangeText={v => setHrHighEdits(prev => ({ ...prev, [name]: v }))}
              placeholder={t.sportModesHrHighLabel}
              placeholderTextColor={theme.mutedText}
              keyboardType="numeric"
              editable={!isWriting}
            />
            <TouchableOpacity style={[styles(theme).smallBtn, { marginLeft: 10 }]} disabled={isWriting} onPress={() => handleSetHrLimits(name)}>
              <Text style={styles(theme).smallBtnText}>{t.sportModesSetBtn}</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles(theme).label}>{t.sportModesPodsLabel}</Text>
          <View style={styles(theme).chipRow}>
            {PODS.map(pod => {
              const active = (selectedMode.settings.useHw & pod.bit) !== 0;
              return (
                <TouchableOpacity
                  key={pod.bit}
                  style={[styles(theme).chip, active && styles(theme).chipActive]}
                  disabled={isWriting}
                  onPress={() => handleTogglePod(name, selectedMode.settings.useHw, pod.bit, !active)}
                >
                  <Text style={[styles(theme).chipText, active && styles(theme).chipTextActive]}>{pod.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {isWriting && (
            <View style={styles(theme).statusRow}>
              <ActivityIndicator size="small" color={theme.primary} />
            </View>
          )}
        </Card>

        <Card style={{ width: '100%' }}>
          <Text style={styles(theme).cardTitle}>
            {t.sportModesDisplaysCount(realDisplays.length, MAX_DISPLAYS)}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: v3Spacing.small }}>
            <View style={{ flexDirection: 'row', gap: v3Spacing.small }}>
              {selectedMode.displays.map((display, i) => (
                <TouchableOpacity key={i} onPress={() => setSelectedDisplayIndex(i)} style={{ alignItems: 'center' }}>
                  <WatchFacePreview layoutType={displayLayoutType(display)} selected={i === selectedDisplayIndex} diameter={80} />
                  <Text style={[styles(theme).filmLabel, { color: i === selectedDisplayIndex ? theme.primary : theme.mutedText }]}>
                    {display.isBuiltIn ? t.sportModesBuiltInShort : String(display.screenNumber)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          {currentDisplay && (
            <View style={{ marginTop: v3Spacing.medium }}>
              {currentDisplay.isBuiltIn ? (
                <Text style={styles(theme).sectionDesc}>
                  {t.sportModesBuiltInMsg(currentDisplay.templateLabel)}
                </Text>
              ) : (
                <>
                  <Text style={styles(theme).label}>{t.sportModesScreenLabel(currentDisplay.screenNumber ?? 0)}</Text>
                  {currentDisplay.fields.map((field, fi) => (
                    <View key={fi} style={styles(theme).fieldRow}>
                      <Text style={styles(theme).fieldText} numberOfLines={1}>{field.typeLabel}</Text>
                      <TouchableOpacity
                        style={styles(theme).smallBtn}
                        disabled={isWriting}
                        onPress={() => setPicker({ mode: name, display: selectedDisplayIndex, field: fi })}
                      >
                        <Text style={styles(theme).smallBtnText}>{t.sportModesChangeBtn}</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </>
              )}
            </View>
          )}
        </Card>

        <Modal visible={!!picker} animationType="slide" transparent onRequestClose={() => setPicker(null)}>
          <View style={styles(theme).modalOverlay}>
            <View style={styles(theme).modalBox}>
              <Text style={styles(theme).cardTitle}>{t.sportModesPickerTitle}</Text>
              <FlatList
                data={FIELD_TYPES}
                keyExtractor={item => String(item.value)}
                style={{ maxHeight: 400 }}
                renderItem={({ item }) => (
                  <TouchableOpacity style={styles(theme).pickerRow} onPress={() => handleSelectFieldType(item.name)}>
                    <Text style={styles(theme).pickerRowText}>{fieldTypeLabel(item.name)}</Text>
                  </TouchableOpacity>
                )}
              />
              <TouchableOpacity style={[styles(theme).smallBtn, { marginTop: 10, alignSelf: 'center' }]} onPress={() => setPicker(null)}>
                <Text style={styles(theme).smallBtnText}>{t.sportModesCloseBtn}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </ScrollView>
    );
  }

  // ── List view ──
  return (
    <ScrollView style={styles(theme).root} contentContainerStyle={styles(theme).content}>
      <Card style={{ width: '100%' }}>
        <Text style={styles(theme).sectionDesc}>{t.sportModesDesc}</Text>

        {!modes && !busy && (
          <TouchableOpacity style={[styles(theme).smallBtn, { marginTop: 10, alignSelf: 'flex-start' }]} onPress={handleRead}>
            <Text style={styles(theme).smallBtnText}>{t.sportModesReadBtn}</Text>
          </TouchableOpacity>
        )}

        {busy && (
          <View style={styles(theme).statusRow}>
            <ActivityIndicator size="small" color={theme.primary} />
            <Text style={[styles(theme).sectionDesc, { marginLeft: 8, marginBottom: 0 }]}>
              {phase === 'connecting' ? t.connecting : t.sportModesReading}
            </Text>
          </View>
        )}

        {phase === 'error' && error && !modes && (
          <Text style={[styles(theme).sectionDesc, { color: theme.error, marginTop: 10 }]}>{error}</Text>
        )}

        {modes && (
          <TouchableOpacity style={[styles(theme).smallBtn, { marginTop: 10, alignSelf: 'flex-start' }]} onPress={handleRead} disabled={busy}>
            <Text style={styles(theme).smallBtnText}>{t.sportModesRefreshBtn}</Text>
          </TouchableOpacity>
        )}
      </Card>

      {modes && modes.map(mode => {
        const name = mode.settings.name;
        const realCount = mode.displays.filter(d => !d.isBuiltIn).length;
        return (
          <TouchableOpacity key={name} onPress={() => setSelectedName(name)} activeOpacity={0.7}>
            <Card style={{ width: '100%' }}>
              <View style={styles(theme).listRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles(theme).cardTitle}>{name}</Text>
                  <Text style={styles(theme).sectionDesc}>
                    {t.sportModesDisplaysCount(realCount, MAX_DISPLAYS)}
                  </Text>
                </View>
                <Icon name="chevronRight" size={20} color={theme.mutedText} />
              </View>
            </Card>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = (t: ReturnType<typeof useV3Theme>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.background },
  content: { padding: v3Spacing.medium, gap: v3Spacing.medium },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backText: { color: t.text, fontSize: v3Type.bodyLarge, fontWeight: '600' },
  modeTitle: { fontSize: v3Type.largeTitle, fontWeight: '800', color: t.text, marginBottom: 4 },
  cardTitle: { fontSize: v3Type.heading, fontWeight: '700', color: t.text },
  sectionDesc: { fontSize: v3Type.body, color: t.mutedText, marginBottom: 6, lineHeight: 19 },
  label: { fontSize: v3Type.body, color: t.mutedText, marginTop: 12, marginBottom: 4 },
  input: {
    backgroundColor: t.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.mutedText + '33',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: t.text,
    fontSize: v3Type.bodyLarge,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  smallBtn: {
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8,
    backgroundColor: t.primary + '1F', borderWidth: 1, borderColor: t.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  smallBtnText: { color: t.primary, fontWeight: '600', fontSize: v3Type.label },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  chip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    borderWidth: 1, borderColor: t.mutedText + '33', backgroundColor: t.background,
  },
  chipActive: { borderColor: t.primary, backgroundColor: t.primary + '1F' },
  chipText: { color: t.mutedText, fontSize: v3Type.label },
  chipTextActive: { color: t.primary, fontWeight: '600' },
  filmLabel: { fontSize: v3Type.tiny, fontWeight: '700', marginTop: 4, textAlign: 'center' },
  fieldRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6,
  },
  fieldText: { color: t.text, fontSize: v3Type.body, flex: 1, marginRight: 8 },
  listRow: { flexDirection: 'row', alignItems: 'center' },
  modalOverlay: { flex: 1, backgroundColor: '#00000066', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: t.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '85%' },
  pickerRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: t.mutedText + '22' },
  pickerRowText: { color: t.text, fontSize: v3Type.bodyLarge },
});
