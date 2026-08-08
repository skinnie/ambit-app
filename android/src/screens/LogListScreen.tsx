import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, RefreshControl, Alert, ScrollView,
} from 'react-native';

import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import {
  ActivityRecord, getAllActivities, markActivitySynced,
  deleteActivity, updateActivityType, isActivityDeleted,
} from '../database/db';
import { readGpxFile, listGpxFiles } from '../services/GpxService';
import { extractGpxMetadata } from '../services/GpxParser';
import RNFS from 'react-native-fs';
import { t, dateLocale } from '../i18n';

type Nav = NativeStackNavigationProp<RootStackParamList, 'LogList'>;

const ALL = t.all;

export default function LogListScreen() {
  const navigation = useNavigation<Nav>();
  const [activities, setActivities] = useState<ActivityRecord[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string>(ALL);

  const load = useCallback(async () => {
    try {
      // 1. Reconstruire depuis GPX orphelins — en ignorant la liste noire
      const [gpxPaths, existing] = await Promise.all([listGpxFiles(), getAllActivities()]);
      const dbIds = new Set(existing.map(a => a.id));
      for (const path of gpxPaths) {
        const id = path.split('/').pop()?.replace('.gpx', '') ?? '';
        if (!id || dbIds.has(id)) continue;
        if (await isActivityDeleted(id)) continue;   // ← liste noire
        try {
          const xml  = await readGpxFile(path);
          const meta = extractGpxMetadata(xml);
          await markActivitySynced({
            id,
            synced_at: Date.now(),
            gpx_path: path,
            date:       meta.date,
            duration_s: meta.durationS,
            distance_m: meta.distanceM,
            d_plus:     meta.dPlus,
            activity_type: meta.activityType,
          });
        } catch (_) {}
      }
      // 2. Charger + réparer les activity_type manquants
      const data = await getAllActivities();
      for (const a of data) {
        if (a.activity_type) continue;
        try {
          const xml  = await readGpxFile(a.gpx_path);
          const meta = extractGpxMetadata(xml);
          if (meta.activityType) {
            await updateActivityType(a.id, meta.activityType);
            a.activity_type = meta.activityType;
          }
        } catch (_) {}
      }
      setActivities([...data]);
    } catch (e) {
      Alert.alert(t.loadError, String(e));
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function confirmDelete(item: ActivityRecord) {
    Alert.alert(
      t.deleteTitle,
      t.deleteMsg(formatDate(item.date)),
      [
        { text: t.cancel, style: 'cancel' },
        {
          text: t.delete,
          style: 'destructive',
          onPress: async () => {
            await deleteActivity(item.id);           // ajoute à la liste noire
            if (item.gpx_path) {
              await RNFS.unlink(item.gpx_path).catch(() => {});
            }
            await load();
          },
        },
      ]
    );
  }

  // ─── Filtres ────────────────────────────────────────────────────────────────

  const filterTypes = useMemo(() => {
    const types = new Set(activities.map(a => a.activity_type).filter(Boolean));
    return [ALL, ...Array.from(types).sort()];
  }, [activities]);

  const filtered = useMemo(
    () => activeFilter === ALL
      ? activities
      : activities.filter(a => a.activity_type === activeFilter),
    [activities, activeFilter]
  );

  // ─── Rendu ──────────────────────────────────────────────────────────────────

  if (activities.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyIcon}>📭</Text>
        <Text style={styles.emptyText}>{t.noActivities}</Text>
        <Text style={styles.emptyHint}>{t.connectHint}</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* Barre de filtres */}
      {filterTypes.length > 2 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterBar}
          contentContainerStyle={styles.filterBarContent}
        >
          {filterTypes.map(type => {
            const active = activeFilter === type;
            return (
              <TouchableOpacity
                key={type}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setActiveFilter(type)}
                activeOpacity={0.7}
              >
                {type !== ALL && (
                  <Text style={styles.chipIcon}>{activityIcon(type)} </Text>
                )}
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {type === ALL ? type : capitalize(type)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      <FlatList
        style={styles.list}
        data={filtered}
        keyExtractor={item => item.id}
        ListEmptyComponent={
          <View style={styles.emptyFilter}>
            <Text style={styles.emptyFilterText}>{t.noFilter}</Text>
          </View>
        }
        ListFooterComponent={
          <Text style={styles.deleteHint}>{t.deleteHint}</Text>
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#fff" />}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => navigation.navigate('Map', { activity: item })}
            onLongPress={() => confirmDelete(item)}
            activeOpacity={0.75}
          >
            <View style={styles.cardLeft}>
              <Text style={styles.cardDate}>{formatDate(item.date)}</Text>
              {!!item.activity_type && (
                <Text style={styles.cardType}>
                  {activityIcon(item.activity_type)} {capitalize(item.activity_type)}
                </Text>
              )}
              <Text style={styles.cardSub}>{formatDuration(item.duration_s)} · {formatDist(item.distance_m)}</Text>
            </View>
            <View style={styles.cardRight}>
              <Text style={styles.cardDPlus}>▲ {item.d_plus} m</Text>
              <Text style={styles.cardArrow}>›</Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

// ─── Helpers d'affichage ──────────────────────────────────────────────────────

const ACTIVITY_ICONS: Record<string, string> = {
  'orientation':          '🧭',
  'course à pied':        '🏃',
  'cyclisme':             '🚴',
  'vtt':                  '🚵',
  'randonnée':            '🥾',
  'marche':               '🚶',
  'natation':             '🏊',
  'trail':                '🏔',
  'ski alpin':            '⛷',
  'ski de fond':          '⛷',
  'ski de randonnée':     '⛷',
  'snowboard':            '🏂',
  'patinage':             '⛸',
  'patinage sur glace':   '⛸',
  'alpinisme':            '🧗',
  'orienteering':         '🧭',
  'running':              '🏃',
  'cycling':              '🚴',
  'mountain biking':      '🚵',
  'trekking':             '🥾',
  'hiking':               '🥾',
  'swimming':             '🏊',
  'trail running':        '🏔',
  'skiing':               '⛷',
  'cross country skiing': '⛷',
};

function activityIcon(type: string): string {
  return ACTIVITY_ICONS[type.toLowerCase()] ?? '🏅';
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatDate(iso: string): string {
  if (!iso) return t.unknownDate;
  return new Date(iso).toLocaleDateString(dateLocale, {
    weekday: 'short', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function formatDuration(seconds: number): string {
  if (!seconds) return '--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}`;
  return `${m}m${String(s).padStart(2, '0')}`;
}

function formatDist(meters: number): string {
  if (!meters) return '--';
  return meters >= 1000
    ? `${(meters / 1000).toFixed(2)} km`
    : `${meters} m`;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#16213e' },
  list: { flex: 1, padding: 12 },
  filterBar: { maxHeight: 52, backgroundColor: '#16213e' },
  filterBarContent: { paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f3460',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipActive: {
    backgroundColor: '#00e5ff22',
    borderColor: '#00e5ff',
  },
  chipIcon: { fontSize: 13 },
  chipText: { fontSize: 13, color: '#8899aa', fontWeight: '500' },
  chipTextActive: { color: '#00e5ff', fontWeight: '700' },
  empty: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#16213e', padding: 32,
  },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyText: { fontSize: 18, color: '#fff', fontWeight: '600', marginBottom: 8 },
  emptyHint: { fontSize: 13, color: '#8899aa', textAlign: 'center' },
  emptyFilter: { paddingVertical: 40, alignItems: 'center' },
  emptyFilterText: { color: '#8899aa', fontSize: 14 },
  deleteHint: { fontSize: 11, color: '#555', textAlign: 'center', marginTop: 8, marginBottom: 16 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f3460',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
  },
  cardLeft: { flex: 1 },
  cardDate: { fontSize: 15, color: '#fff', fontWeight: '600', marginBottom: 2 },
  cardType: { fontSize: 12, color: '#7ec8e3', marginBottom: 3 },
  cardSub: { fontSize: 13, color: '#8899aa' },
  cardRight: { alignItems: 'flex-end' },
  cardDPlus: { fontSize: 13, color: '#4caf50', marginBottom: 4 },
  cardArrow: { fontSize: 22, color: '#8899aa' },
});
