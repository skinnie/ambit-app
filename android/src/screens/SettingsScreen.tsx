import React, { useCallback, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Switch,
  StyleSheet, Alert, ScrollView, ActivityIndicator, Linking, Modal,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useThemeMode, ThemeMode } from '../theme/ThemeModeContext';
import Icon, { IconName } from '../components/ui/Icon';
import { CREDITS } from '../legal/credits';
import { DecodedSetting, SettingField } from '../services/AmbitSettingsReader';
import { readAmbitSettings, writeAmbitSetting } from '../services/AmbitSettingsService';
import {
  getRunalyzeApiKey, saveRunalyzeApiKey, removeRunalyzeApiKey,
} from '../services/ApiRunalyze';
import {
  getIntervalsIcuCredentials, saveIntervalsIcuCredentials, removeIntervalsIcuCredentials,
} from '../services/ApiIntervalsIcu';
import {
  isAuthenticated as liveloxIsAuth, getAuthorizationUrl, logout as liveloxLogout,
} from '../services/ApiLivelox';
import {
  isAuthenticated as stravaIsAuth, getAuthorizationUrl as stravaAuthUrl, logout as stravaLogout,
} from '../services/ApiStrava';
import { t } from '../i18n';
import { APP_VERSION } from '../config/version';
import { useV3Theme } from '../theme/v3';
import { Button, Chip, FieldRow, IconBadge, StatusLine } from '../components/ui/primitives';

const THEME_OPTIONS: { mode: ThemeMode; icon: IconName; label: () => string }[] = [
  { mode: 'light',  icon: 'sun',  label: () => t.themeLight },
  { mode: 'dark',   icon: 'moon', label: () => t.themeDark },
  { mode: 'system', icon: 'auto', label: () => t.themeSystem },
];

// Static, non-editable display of a settings value — used for the read-only Ambit 1/2 rows.
function readOnlyValue(row: DecodedSetting): string {
  if (row.kind === 'enum') return row.choices?.find(c => c.value === row.value)?.label ?? String(row.value);
  if (row.kind === 'bool') return row.value === 1 ? 'On' : 'Off';
  if (row.kind === 'coord') return row.value.toFixed(6);
  return String(row.value);
}

export default function SettingsScreen() {
  const theme = useV3Theme();
  const styles = createStyles(theme);
  const { mode, setMode } = useThemeMode();

  const [runalyzeKey, setRunalyzeKey]     = useState('');
  const [savedKey, setSavedKey]           = useState<string | null>(null);
  const [saving, setSaving]               = useState(false);
  const [liveloxAuth, setLiveloxAuth]     = useState(false);
  const [stravaAuth, setStravaAuth]       = useState(false);

  const [intervalsAthleteId, setIntervalsAthleteId] = useState('');
  const [intervalsApiKey, setIntervalsApiKey]       = useState('');
  const [intervalsSaved, setIntervalsSaved]         = useState(false);
  const [savingIntervals, setSavingIntervals]       = useState(false);

  // v3.0 UI port (2026-08-09, "settings was completely reworked in our desktop app...
  // proceed") - desktop's real Connections card (SettingsPage.qml) is one compact card with
  // a status-dot row per service, tap-to-open a Dialog with that service's own form - not
  // four separate always-expanded full-height sections like this screen had. Same real
  // handlers/state above, this only changes which one is visible at a time.
  const [openConnection, setOpenConnection] = useState<'strava' | 'livelox' | 'runalyze' | 'intervals' | null>(null);

  // Real, 2026-08-08 ("Settings on ambit 3 - if they are already cracked to be changed by
  // cable, we will need to build a UI for it"). Not auto-loaded on focus like the API
  // credentials above - reading needs the watch actually connected via USB, which isn't
  // guaranteed just because this screen is open, so it's behind an explicit "Read
  // Settings" tap instead (same "explicit action, no surprise USB traffic" spirit as the
  // rest of this app's own on-demand connect/read/disconnect flows - see PoiService.ts).
  const [ambitSettings, setAmbitSettings] = useState<DecodedSetting[] | null>(null);
  const [ambitSettingsFields, setAmbitSettingsFields] = useState<SettingField[] | null>(null);
  // The connected watch's own name (from getDeviceInfo()'s device list), used to label
  // this section adaptively — "Suunto Kailash Settings" etc. — instead of a hardcoded
  // "Ambit3". Empty until the settings read connects and identifies the watch.
  const [ambitDeviceName, setAmbitDeviceName] = useState<string>('');
  // Ambit 1/2 family: settings are read-only (no write in libambit), so the rows render
  // their value statically and the write controls are hidden.
  const [ambitReadOnly, setAmbitReadOnly] = useState(false);
  const [ambitSettingsPhase, setAmbitSettingsPhase] =
    useState<'idle' | 'connecting' | 'reading' | 'done' | 'error'>('idle');
  const [ambitSettingsError, setAmbitSettingsError] = useState<string | undefined>();
  const [writingKey, setWritingKey] = useState<string | null>(null);
  // Free-text edit state for 'coord' rows (home_latitude/home_longitude) - a plain
  // TextInput needs its own string buffer, separate from the decoded numeric row.value,
  // the same pattern SportModesScreen.tsx already uses for its own numeric fields.
  const [coordEdits, setCoordEdits] = useState<Record<string, string>>({});

  async function handleReadAmbitSettings() {
    await readAmbitSettings(s => {
      setAmbitSettingsPhase(s.phase);
      if (s.settings) {
        setAmbitSettings(s.settings);
        const coords: Record<string, string> = {};
        for (const row of s.settings) {
          if (row.kind === 'coord') coords[row.key] = row.value.toFixed(6);
        }
        setCoordEdits(coords);
      }
      if (s.fields) setAmbitSettingsFields(s.fields);
      if (s.deviceName) setAmbitDeviceName(s.deviceName);
      setAmbitReadOnly(!!s.readOnly);
      setAmbitSettingsError(s.error);
    });
  }

  async function handleWriteAmbitSetting(key: string, value: number) {
    if (!ambitSettingsFields) return;
    setWritingKey(key);
    await writeAmbitSetting(key, value, ambitSettingsFields, s => {
      if (s.phase === 'done' || s.phase === 'error') {
        setWritingKey(null);
        if (s.error) Alert.alert(t.error, s.error);
      }
      if (s.result) {
        // Reflect the watch's own confirmed value, not blindly what was requested -
        // matches AmbitSettingsWriter.ts's own "prove it" contract.
        setAmbitSettings(prev => prev && prev.map(row =>
          row.key === key && s.result!.confirmedValue !== null
            ? { ...row, value: s.result!.confirmedValue as number }
            : row));
        if (s.result.confirmedValue !== null) {
          setCoordEdits(prev => ({ ...prev, [key]: (s.result!.confirmedValue as number).toFixed(6) }));
        }
      }
    });
  }

  // Real, hardware-independent range check, same bounds AmbitSettingsWriter.ts's own
  // writeSetting() (and settings_write.py's write_one() on the desktop side) enforce
  // again before ever sending a byte - this is just the earliest, UI-level catch for an
  // obviously-invalid typed value.
  function handleSetCoord(key: string) {
    const parsed = parseFloat(coordEdits[key] ?? '');
    if (!Number.isFinite(parsed)) {
      Alert.alert(t.error, `${key}: not a valid number`);
      return;
    }
    if (key === 'home_latitude' && (parsed < -90 || parsed > 90)) {
      Alert.alert(t.error, `${key}=${parsed} out of range [-90, 90]`);
      return;
    }
    if (key === 'home_longitude' && (parsed < -180 || parsed > 180)) {
      Alert.alert(t.error, `${key}=${parsed} out of range [-180, 180]`);
      return;
    }
    handleWriteAmbitSetting(key, parsed);
  }

  useFocusEffect(useCallback(() => {
    getRunalyzeApiKey().then(k => {
      setSavedKey(k);
      setRunalyzeKey(k ?? '');
    });
    liveloxIsAuth().then(setLiveloxAuth);
    stravaIsAuth().then(setStravaAuth);
    getIntervalsIcuCredentials().then(creds => {
      setIntervalsSaved(!!creds);
      setIntervalsAthleteId(creds?.athleteId ?? '');
      setIntervalsApiKey(creds?.apiKey ?? '');
    });
  }, []));

  async function handleSaveRunalyze() {
    if (!runalyzeKey.trim()) {
      Alert.alert(t.emptyKey, t.emptyKeyMsg);
      return;
    }
    setSaving(true);
    try {
      await saveRunalyzeApiKey(runalyzeKey.trim());
      setSavedKey(runalyzeKey.trim());
      Alert.alert(t.savedOk, t.keySaved);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveRunalyze() {
    await removeRunalyzeApiKey();
    setSavedKey(null);
    setRunalyzeKey('');
    Alert.alert(t.deleted, t.keyDeleted);
  }

  async function handleSaveIntervals() {
    if (!intervalsAthleteId.trim() || !intervalsApiKey.trim()) {
      Alert.alert(t.emptyCreds, t.emptyCredsMsg);
      return;
    }
    setSavingIntervals(true);
    try {
      await saveIntervalsIcuCredentials(intervalsAthleteId.trim(), intervalsApiKey.trim());
      setIntervalsSaved(true);
      Alert.alert(t.savedOk, t.credsSaved);
    } finally {
      setSavingIntervals(false);
    }
  }

  async function handleRemoveIntervals() {
    await removeIntervalsIcuCredentials();
    setIntervalsSaved(false);
    setIntervalsAthleteId('');
    setIntervalsApiKey('');
    Alert.alert(t.deleted, t.credsDeleted);
  }

  async function handleStravaConnect() {
    try {
      const url = stravaAuthUrl();
      await Linking.openURL(url);
    } catch (e: any) {
      Alert.alert(t.stravaError, e?.message ?? String(e));
    }
  }

  async function handleStravaDisconnect() {
    await stravaLogout();
    setStravaAuth(false);
    Alert.alert('Strava', t.stravaDisconnected);
  }

  async function handleLiveloxConnect() {
    try {
      const url = await getAuthorizationUrl();
      await Linking.openURL(url);
    } catch (e: any) {
      Alert.alert(t.liveloxError, e?.message ?? String(e));
    }
  }

  async function handleLiveloxDisconnect() {
    await liveloxLogout();
    setLiveloxAuth(false);
    Alert.alert('Livelox', t.liveloxDisconnected);
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>

      {/* ── Apparence ── */}
      <View style={styles.section}>
        <View style={styles.cardHead}>
          <IconBadge icon={mode === 'light' ? 'sun' : mode === 'dark' ? 'moon' : 'auto'} />
          <Text style={styles.cardTitle}>{t.appearanceSection}</Text>
        </View>
        <Text style={styles.sectionDesc}>{t.appearanceDesc}</Text>
        <View style={styles.themeRow}>
          {THEME_OPTIONS.map(opt => {
            const selected = mode === opt.mode;
            return (
              <TouchableOpacity
                key={opt.mode}
                onPress={() => setMode(opt.mode)}
                activeOpacity={0.75}
                style={[styles.themeOption, selected && styles.themeOptionSelected]}
              >
                <Icon name={opt.icon} size={17} color={selected ? theme.card : theme.text} />
                <Text style={[styles.themeOptionLabel, selected && styles.themeOptionLabelSelected]}>
                  {opt.label()}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* ── Watch Settings - real, 2026-08-08. Cable settings-write is confirmed working
          for both device types (see AmbitSettingsWriter.ts's own header comment: André
          confirmed on each watch's own screen that flipping display_dark visibly switched
          it Light -> Dark) - readAmbitSettings() detects which one is connected and picks
          the matching curated table (AmbitSettingsService.ts's own header comment), so
          this section works unmodified for either. ── */}
      <View style={styles.section}>
        <View style={styles.cardHead}>
          <IconBadge icon="watch" />
          <Text style={styles.cardTitle}>
            {ambitDeviceName ? t.ambitSettingsTitle(ambitDeviceName) : t.ambitSettingsSection}
          </Text>
        </View>
        <Text style={styles.sectionDesc}>{t.ambitSettingsDesc}</Text>
        {ambitReadOnly && <Text style={styles.sectionDesc}>{t.ambitSettingsReadOnly}</Text>}

        {!ambitSettings && ambitSettingsPhase !== 'connecting' && ambitSettingsPhase !== 'reading' && (
          <Button label={t.ambitSettingsReadBtn} icon="sync" onPress={handleReadAmbitSettings} style={{ marginTop: 10 }} />
        )}

        {(ambitSettingsPhase === 'connecting' || ambitSettingsPhase === 'reading') && (
          <View style={styles.statusRow}>
            <ActivityIndicator size="small" color={theme.text} />
            <Text style={[styles.sectionDesc, { marginLeft: 8, marginBottom: 0 }]}>
              {ambitSettingsPhase === 'connecting' ? t.connecting : t.ambitSettingsReading}
            </Text>
          </View>
        )}

        {ambitSettingsPhase === 'error' && ambitSettingsError && !ambitSettings && (
          <Text style={[styles.sectionDesc, { color: theme.error, marginTop: 10 }]}>
            {ambitSettingsError}
          </Text>
        )}

        {ambitSettings && ambitSettings.map(row => {
          const label = row.key.split('_')
            .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
            .join(' ');
          const busy = writingKey === row.key;
          return (
            <View key={row.key} style={styles.ambitSettingRow}>
              <Text style={styles.ambitSettingLabel}>{label}</Text>

              {ambitReadOnly && (
                <Text style={styles.ambitSettingValueRO}>{readOnlyValue(row)}</Text>
              )}

              {!ambitReadOnly && (<>
              {row.kind === 'bool' && (
                <Switch
                  value={row.value === 1}
                  onValueChange={v => handleWriteAmbitSetting(row.key, v ? 1 : 0)}
                  disabled={busy}
                  trackColor={{ false: theme.mutedText + '55', true: theme.primary + '88' }}
                  thumbColor={theme.card}
                />
              )}

              {row.kind === 'enum' && (
                <View style={styles.chipRow}>
                  {(row.choices ?? []).map(choice => (
                    <TouchableOpacity
                      key={choice.value}
                      style={[styles.chip, choice.value === row.value && styles.chipActive]}
                      disabled={busy}
                      onPress={() => handleWriteAmbitSetting(row.key, choice.value)}
                    >
                      <Text style={[styles.chipText, choice.value === row.value && styles.chipTextActive]}>
                        {choice.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {row.kind === 'number' && (
                <View style={styles.stepperRow}>
                  <TouchableOpacity
                    style={styles.stepperBtn}
                    disabled={busy}
                    onPress={() => handleWriteAmbitSetting(row.key, Math.max(0, row.value - 5))}
                  >
                    <Text style={styles.stepperBtnText}>-</Text>
                  </TouchableOpacity>
                  <Text style={styles.stepperValue}>{row.value}</Text>
                  <TouchableOpacity
                    style={styles.stepperBtn}
                    disabled={busy}
                    onPress={() => handleWriteAmbitSetting(row.key, Math.min(100, row.value + 5))}
                  >
                    <Text style={styles.stepperBtnText}>+</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Real, 2026-08-08, Kailash only (home_latitude/home_longitude) - found
                  from real BLE captures, confirmed byte-exact against the watch's own
                  real schema descriptor (entry 0x36, GROUP HomeLocation.Latitude/
                  Longitude - see AmbitSettingsReader.ts's own field comment and the
                  ambit_app_kailash_home_location_field memory). Free-text degrees input
                  rather than a stepper (unlike 'number' above) - a +-5 nudge makes no
                  sense for a GPS coordinate, and it needs to accept a leading "-". */}
              {row.kind === 'coord' && (
                <View style={styles.coordRow}>
                  <TextInput
                    style={styles.coordInput}
                    value={coordEdits[row.key] ?? row.value.toFixed(6)}
                    onChangeText={v => setCoordEdits(prev => ({ ...prev, [row.key]: v }))}
                    editable={!busy}
                    placeholderTextColor={theme.mutedText}
                  />
                  <TouchableOpacity
                    style={styles.coordSetBtn}
                    disabled={busy}
                    onPress={() => handleSetCoord(row.key)}
                  >
                    <Text style={styles.btnText}>{t.saveBtn}</Text>
                  </TouchableOpacity>
                </View>
              )}
              </>)}

              {busy && <ActivityIndicator size="small" color={theme.primary} style={{ marginLeft: 8 }} />}
            </View>
          );
        })}

        {ambitSettings && (
          <Button label={t.ambitSettingsRefreshBtn} icon="sync" onPress={handleReadAmbitSettings} style={{ marginTop: 14 }} />
        )}
      </View>

      {/* ── Connections - real, 2026-08-09 ("settings was completely reworked in our
          desktop app... proceed"). Ports SettingsPage.qml's real Connections card: one
          compact card, a status-dot row per service, tap opens that service's own form in
          a modal - not four always-expanded full-height sections. ── */}
      <View style={styles.section}>
        <View style={styles.cardHead}>
          <IconBadge icon="link" />
          <Text style={styles.cardTitle}>{t.connectionsSection}</Text>
        </View>

        <TouchableOpacity style={styles.connRow} activeOpacity={0.7} onPress={() => setOpenConnection('strava')}>
          <View style={[styles.connDot, { backgroundColor: stravaAuth ? theme.success : theme.mutedText }]} />
          <Text style={styles.connRowText}>
            {stravaAuth ? t.stravaConnectedStatus : `${t.stravaSection} — ${t.connect}`}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.connRow} activeOpacity={0.7} onPress={() => setOpenConnection('livelox')}>
          <View style={[styles.connDot, { backgroundColor: liveloxAuth ? theme.success : theme.mutedText }]} />
          <Text style={styles.connRowText}>
            {liveloxAuth ? t.liveloxConnectedStatus : `Livelox — ${t.connect}`}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.connRow} activeOpacity={0.7} onPress={() => setOpenConnection('runalyze')}>
          <View style={[styles.connDot, { backgroundColor: savedKey ? theme.success : theme.mutedText }]} />
          <Text style={styles.connRowText}>
            {savedKey ? `${t.runalyzeSection} — ${t.keyStored}` : `${t.runalyzeSection} — ${t.connect}`}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.connRow} activeOpacity={0.7} onPress={() => setOpenConnection('intervals')}>
          <View style={[styles.connDot, { backgroundColor: intervalsSaved ? theme.success : theme.mutedText }]} />
          <Text style={styles.connRowText}>
            {intervalsSaved ? `${t.intervalsSection} — ${t.credsStored}` : `${t.intervalsSection} — ${t.connect}`}
          </Text>
        </TouchableOpacity>
      </View>

      <Modal visible={openConnection === 'strava'} animationType="slide" transparent onRequestClose={() => setOpenConnection(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.cardTitle}>{t.stravaSection}</Text>
            <Text style={styles.sectionDesc}>{t.stravaSettingsDesc}</Text>
            {stravaAuth ? (
              <>
                <Chip icon="check" label={t.stravaConnectedStatus} />
                <View style={styles.row}>
                  <Button label={t.stravaDisconnectBtn} variant="text" grow={false} onPress={handleStravaDisconnect} />
                </View>
              </>
            ) : (
              <View style={styles.row}>
                <Button label={t.connect} variant="filled" onPress={handleStravaConnect} />
              </View>
            )}
            <Button label={t.closeBtn} variant="text" onPress={() => setOpenConnection(null)} style={{ marginTop: 12 }} />
          </View>
        </View>
      </Modal>

      <Modal visible={openConnection === 'livelox'} animationType="slide" transparent onRequestClose={() => setOpenConnection(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.cardTitle}>Livelox</Text>
            <Text style={styles.sectionDesc}>{t.liveloxSettingsDesc}</Text>
            {liveloxAuth ? (
              <>
                <Chip icon="check" label={t.liveloxConnectedStatus} />
                <View style={styles.row}>
                  <Button label={t.liveloxDisconnectBtn} variant="text" grow={false} onPress={handleLiveloxDisconnect} />
                </View>
              </>
            ) : (
              <View style={styles.row}>
                <Button label={t.connect} variant="filled" onPress={handleLiveloxConnect} />
              </View>
            )}
            <Button label={t.closeBtn} variant="text" onPress={() => setOpenConnection(null)} style={{ marginTop: 12 }} />
          </View>
        </View>
      </Modal>

      <Modal visible={openConnection === 'runalyze'} animationType="slide" transparent onRequestClose={() => setOpenConnection(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.cardTitle}>{t.runalyzeSection}</Text>
            <Text style={styles.sectionDesc}>{t.runalyzeDesc}</Text>
            <Text style={styles.sectionDesc}>
              {t.runalyzeApiHint}
              <Text style={styles.link}>{t.runalyzeApiLink}</Text>
            </Text>
            <FieldRow
              icon="key"
              value={runalyzeKey}
              onChangeText={setRunalyzeKey}
              placeholder={t.apiKeyPlaceholder}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <View style={styles.row}>
              <Button label={t.saveBtn} variant="filled" loading={saving} onPress={handleSaveRunalyze} />
              {!!savedKey && (
                <Button label={t.deleteBtn} icon="delete" variant="outline" tone="alert" grow={false} onPress={handleRemoveRunalyze} />
              )}
            </View>
            {!!savedKey && <StatusLine text={t.keyStored} />}
            <Button label={t.closeBtn} variant="text" onPress={() => setOpenConnection(null)} style={{ marginTop: 12 }} />
          </View>
        </View>
      </Modal>

      <Modal visible={openConnection === 'intervals'} animationType="slide" transparent onRequestClose={() => setOpenConnection(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.cardTitle}>{t.intervalsSection}</Text>
            <Text style={styles.sectionDesc}>{t.intervalsDesc}</Text>
            <Text style={styles.sectionDesc}>
              {t.intervalsApiHint}
              <Text style={styles.link}>{t.intervalsApiLink}</Text>
            </Text>
            <FieldRow
              icon="person"
              value={intervalsAthleteId}
              onChangeText={setIntervalsAthleteId}
              placeholder={t.athleteIdPlaceholder}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <FieldRow
              icon="key"
              value={intervalsApiKey}
              onChangeText={setIntervalsApiKey}
              placeholder={t.apiKeyPlaceholder}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <View style={styles.row}>
              <Button label={t.saveBtn} variant="filled" loading={savingIntervals} onPress={handleSaveIntervals} />
              {intervalsSaved && (
                <Button label={t.deleteBtn} icon="delete" variant="outline" tone="alert" grow={false} onPress={handleRemoveIntervals} />
              )}
            </View>
            {intervalsSaved && <StatusLine text={t.credsStored} />}
            <Button label={t.closeBtn} variant="text" onPress={() => setOpenConnection(null)} style={{ marginTop: 12 }} />
          </View>
        </View>
      </Modal>

      {/* ── About / disclaimer ── */}
      <View style={styles.section}>
        <View style={styles.cardHead}>
          <IconBadge icon="info" />
          <Text style={styles.cardTitle}>{t.aboutSection}</Text>
        </View>
        <Text style={styles.sectionDesc}>{t.aboutVersion(APP_VERSION)}</Text>
        <Text style={[styles.sectionDesc, { marginTop: 10 }]}>{t.aboutDisclaimer}</Text>

        <Text style={styles.creditsHeading}>{t.aboutCreditsSection}</Text>
        <Text style={styles.sectionDesc}>{t.aboutCreditsIntro}</Text>
        {CREDITS.map(c => (
          <TouchableOpacity
            key={c.name}
            style={styles.creditItem}
            disabled={!c.url}
            activeOpacity={0.6}
            onPress={() => c.url && Linking.openURL(c.url)}
          >
            <Text style={[styles.creditName, !!c.url && styles.link]}>{c.name}</Text>
            <Text style={styles.creditDesc}>{c.description}</Text>
          </TouchableOpacity>
        ))}
      </View>

    </ScrollView>
  );
}

const createStyles = (t: ReturnType<typeof useV3Theme>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.background },
  content: { padding: 20 },
  section: {
    backgroundColor: t.card,
    borderColor: t.mutedText + '33',
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: t.text },
  sectionDesc: { fontSize: 13, color: t.mutedText, marginBottom: 6, lineHeight: 19 },
  link: { color: t.text, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 10, marginTop: 12 },
  creditsHeading: {
    fontSize: 13, fontWeight: '700', color: t.text,
    marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: t.mutedText + '33',
  },
  creditItem: { marginTop: 10 },
  creditName: { fontSize: 13, fontWeight: '700', color: t.text },
  creditDesc: { fontSize: 12, color: t.mutedText, lineHeight: 17, marginTop: 2 },
  themeRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  themeOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.4,
    borderColor: t.mutedText + '33',
    backgroundColor: t.card,
  },
  themeOptionSelected: {
    backgroundColor: t.primary,
    borderColor: t.primary,
  },
  themeOptionLabel: { fontSize: 13, fontWeight: '600', color: t.text },
  themeOptionLabelSelected: { color: t.card },
  btnText: { color: t.card, fontWeight: '600', fontSize: 14 },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  ambitSettingRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 14,
  },
  ambitSettingLabel: { color: t.text, fontSize: 14, flex: 1, marginRight: 10 },
  // Read-only (Ambit 1/2) value display, right-aligned where the control would be.
  ambitSettingValueRO: { color: t.mutedText, fontSize: 14, fontWeight: '600', textAlign: 'right' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, flexShrink: 1, justifyContent: 'flex-end' },
  // Same tinted-primary pill treatment as primitives.tsx's own Chip - a real selected
  // state, not a neutral bordered box.
  chip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    borderWidth: 1, borderColor: t.mutedText + '33', backgroundColor: t.card,
  },
  chipActive: { borderColor: t.primary, backgroundColor: t.primary + '1F' },
  chipText: { color: t.mutedText, fontSize: 12 },
  chipTextActive: { color: t.primary, fontWeight: '600' },
  stepperRow: { flexDirection: 'row', alignItems: 'center' },
  stepperBtn: {
    width: 32, height: 32, borderRadius: 8, borderWidth: 1, borderColor: t.mutedText + '33',
    alignItems: 'center', justifyContent: 'center', backgroundColor: t.card,
  },
  stepperBtnText: { color: t.primary, fontSize: 18, fontWeight: '700' },
  stepperValue: { color: t.text, fontSize: 14, marginHorizontal: 10, minWidth: 30, textAlign: 'center' },
  coordRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  coordInput: {
    backgroundColor: t.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.mutedText + '33',
    paddingHorizontal: 10,
    paddingVertical: 6,
    color: t.text,
    fontSize: 13,
    width: 110,
    textAlign: 'right',
  },
  coordSetBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: t.primary + '1F',
    borderWidth: 1,
    borderColor: t.primary,
  },
  // ── Connections card - compact tap-to-open rows + modal (v3.0 UI port) ──
  connRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  connDot: { width: 8, height: 8, borderRadius: 4 },
  connRowText: { color: t.text, fontSize: 14, flex: 1 },
  modalOverlay: {
    flex: 1, backgroundColor: '#00000066', justifyContent: 'flex-end',
  },
  modalBox: {
    backgroundColor: t.background, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, maxHeight: '85%',
  },
});
