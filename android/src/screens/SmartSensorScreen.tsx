import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Card } from '../components/ui/Card';
import Icon from '../components/ui/Icon';
import { useV3Theme } from '../theme/v3';
import { t } from '../i18n';
import {
  isSmartSensorAvailable, scanSmartSensor, forgetSmartSensor, SmartSensorStatus,
} from '../services/SmartSensorService';

// Smart Sensor (HR belt) - experimental, gated behind the Experimental flag. Phone↔belt BLE,
// independent of the watch/cable (the belt is its own peripheral). The screen degrades
// cleanly when the native BLE module isn't in the build yet (isSmartSensorAvailable()).
export default function SmartSensorScreen() {
  const theme = useV3Theme();
  const s = styles(theme);
  const available = isSmartSensorAvailable();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<SmartSensorStatus | null>(null);
  const [notFound, setNotFound] = useState(false);

  async function handleScan() {
    setBusy(true);
    setNotFound(false);
    try {
      const res = await scanSmartSensor();
      if (res.found) setStatus(res); else { setStatus(null); setNotFound(true); }
    } catch (e: any) {
      Alert.alert(t.error, e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleForget() {
    setBusy(true);
    try {
      await forgetSmartSensor();
      setStatus(null);
    } catch (e: any) {
      Alert.alert(t.error, e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  const rows: { label: string; value?: string }[] = status ? [
    { label: 'Manufacturer', value: status.manufacturer },
    { label: 'Model', value: status.model },
    { label: 'Serial', value: status.serial },
    { label: 'Firmware', value: status.fwRevision },
    { label: 'Hardware', value: status.hwRevision },
    { label: 'Software', value: status.swRevision },
  ] : [];

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <Card style={{ width: '100%' }}>
        <Text style={s.title}>{t.experimentalSmartSensor}</Text>
        <Text style={s.desc}>{t.experimentalSmartSensorDesc}</Text>

        {!available ? (
          <Text style={[s.desc, { color: theme.warning, marginTop: 12 }]}>{t.smartSensorNativeMissing}</Text>
        ) : (
          <>
            <TouchableOpacity style={[s.btn, busy && { opacity: 0.5 }]} disabled={busy} onPress={handleScan}>
              {busy ? <ActivityIndicator size="small" color={theme.primary} />
                : <Text style={s.btnText}>{t.smartSensorScanBtn}</Text>}
            </TouchableOpacity>
            {busy && <Text style={s.desc}>{t.smartSensorScanning}</Text>}
            {notFound && <Text style={[s.desc, { color: theme.warning }]}>{t.smartSensorNotFound}</Text>}
          </>
        )}
      </Card>

      {status && (
        <Card style={{ width: '100%' }}>
          <View style={s.metricRow}>
            <View style={s.metric}>
              <Icon name="battery" size={18} color={theme.mutedText} />
              <Text style={s.metricLabel}>{t.smartSensorBattery}</Text>
              <Text style={s.metricValue}>
                {status.batteryPercent != null && status.batteryPercent >= 0 ? `${status.batteryPercent}%` : '—'}
              </Text>
            </View>
            <View style={s.metric}>
              <Icon name="activity" size={18} color={theme.mutedText} />
              <Text style={s.metricLabel}>{t.smartSensorHeartRate}</Text>
              <Text style={s.metricValue}>
                {status.heartRateBpm != null && status.heartRateBpm >= 0 ? `${status.heartRateBpm} bpm` : t.smartSensorNoReading}
              </Text>
            </View>
          </View>

          {rows.filter(r => !!r.value).map(r => (
            <View key={r.label} style={s.infoRow}>
              <Text style={s.infoLabel}>{r.label}</Text>
              <Text style={s.infoValue}>{r.value}</Text>
            </View>
          ))}

          <TouchableOpacity style={[s.btn, s.forgetBtn, busy && { opacity: 0.5 }]} disabled={busy} onPress={handleForget}>
            <Text style={[s.btnText, { color: theme.error }]}>{t.smartSensorForgetBtn}</Text>
          </TouchableOpacity>
        </Card>
      )}
    </ScrollView>
  );
}

const styles = (th: ReturnType<typeof useV3Theme>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: th.background },
  content: { padding: 16, gap: 14 },
  title: { fontSize: 16, fontWeight: '800', color: th.text },
  desc: { fontSize: 12.5, color: th.mutedText, marginTop: 6, lineHeight: 18 },
  btn: {
    marginTop: 14, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, alignSelf: 'flex-start',
    backgroundColor: th.primary + '1F', borderWidth: 1, borderColor: th.primary,
  },
  btnText: { color: th.primary, fontWeight: '700', fontSize: 13 },
  forgetBtn: { backgroundColor: th.error + '14', borderColor: th.error, marginTop: 18 },
  metricRow: { flexDirection: 'row', gap: 12 },
  metric: {
    flex: 1, alignItems: 'center', gap: 4, paddingVertical: 14,
    borderRadius: 12, backgroundColor: th.primary + '10',
  },
  metricLabel: { fontSize: 11, color: th.mutedText },
  metricValue: { fontSize: 18, fontWeight: '800', color: th.text },
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: th.mutedText + '22',
  },
  infoLabel: { fontSize: 13, color: th.mutedText },
  infoValue: { fontSize: 13, color: th.text, fontWeight: '600' },
});
