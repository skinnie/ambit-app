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
import { useV3Theme } from '../theme/v3';
import { ActivityThumbnail } from '../components/ActivityThumbnail';
import Icon, { IconName } from '../components/ui/Icon';
import { SortBar } from '../components/ui/SortBar';
import {
  getViewMode, sortItems, sortKeysFor, SortKey, ViewMode,
} from '../services/ListViewPrefs';

type Nav = NativeStackNavigationProp<RootStackParamList, 'LogList'>;

const ALL = t.all;

export default function LogListScreen() {
  const theme = useV3Theme();
  const styles = createStyles(theme);
  const navigation = useNavigation<Nav>();
  const [activities, setActivities] = useState<ActivityRecord[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string>(ALL);
  // View mode (map/list) is the persisted Settings preference; re-read on focus so a change
  // in Settings takes effect when the user returns here. Sort is an in-page control.
  const [viewMode, setViewMode] = useState<ViewMode>('map');
  const [sortKey, setSortKey] = useState<SortKey>('uploaded');
  useFocusEffect(useCallback(() => { getViewMode('activities').then(setViewMode); }, []));

  // Calendar + Totals are activity-analytics views (desktop TotalsPage/CalendarPage parity).
  // On Android they're reached from here, the Activities screen, rather than the Home nav
  // shell: the phone's bottom tab row is already full, and these three (list / calendar /
  // totals) are one family of "what have I done" views, so grouping them is the adaptive
  // choice (rule 2, "UI evolutive according to the device").
  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => navigation.navigate('Calendar')} hitSlop={8}>
            <Icon name="calendar" size={22} color={theme.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Totals')} hitSlop={8}>
            <Icon name="chart" size={22} color={theme.text} />
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation, theme, styles]);

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

  const filtered = useMemo(() => {
    const base = activeFilter === ALL
      ? activities
      : activities.filter(a => a.activity_type === activeFilter);
    // Sort via the shared comparator (maps ActivityRecord onto the generic Sortable fields).
    const withKeys = base.map(a => ({
      a, uploadedAt: a.synced_at, name: a.activity_type, distanceM: a.distance_m, ascentM: a.d_plus,
    }));
    return sortItems(withKeys, sortKey).map(x => x.a);
  }, [activities, activeFilter, sortKey]);

  // ─── Rendu ──────────────────────────────────────────────────────────────────

  if (activities.length === 0) {
    return (
      <View style={styles.empty}>
        {/* 2026-08-11 (André, A1): was a raw mailbox emoji, which Android renders
            in full colour (orange) and no style can tint. */}
        <Icon name="list" size={44} color={theme.mutedText} />
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
                  <Icon
                    name={activityIconName(type)}
                    size={14}
                    color={active ? theme.primary : theme.mutedText}
                  />
                )}
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {type === ALL ? type : capitalize(type)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* Sort control (in-page, per André). Last uploaded / name / distance / ascent. */}
      <SortBar keys={sortKeysFor('activities')} value={sortKey} onChange={setSortKey} />

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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.text} />}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => navigation.navigate('Map', { activity: item })}
            onLongPress={() => confirmDelete(item)}
            activeOpacity={0.75}
          >
            {viewMode === 'map' && !!item.gpx_path && (
              <View style={styles.cardThumb}>
                <ActivityThumbnail gpxPath={item.gpx_path} height={72} />
              </View>
            )}
            <View style={styles.cardRow}>
              <View style={styles.cardLeft}>
                <Text style={styles.cardDate}>{formatDate(item.date)}</Text>
                {!!item.activity_type && (
                  <View style={styles.cardTypeRow}>
                    <Icon name={activityIconName(item.activity_type)} size={12} color={theme.mutedText} />
                    <Text style={styles.cardType}>{capitalize(item.activity_type)}</Text>
                  </View>
                )}
                <Text style={styles.cardSub}>{formatDuration(item.duration_s)} · {formatDist(item.distance_m)}</Text>
              </View>
              <View style={styles.cardRight}>
                <Text style={styles.cardDPlus}>▲ {item.d_plus} m</Text>
                <Text style={styles.cardArrow}>›</Text>
              </View>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

// ─── Helpers d'affichage ──────────────────────────────────────────────────────

// Real, 2026-08-10 ("change the orange icons to something more aligned with our material
// design and colors") - was raw emoji (🚴🏃🥾...), full-color glyphs that can't be tinted
// and visibly clashed with the rest of this app's monochrome icon language. Maps onto
// Icon.tsx's own small set (cycling/running/walking are new; trail/ski/alpinisme types
// reuse the existing 'mountain' icon rather than drawing a one-off glyph for a handful of
// rarer types; anything else falls back to the existing generic 'activity' icon).
const ACTIVITY_ICON_NAMES: Record<string, IconName> = {
  'course à pied':        'running',
  'running':               'running',
  'trail running':         'running',
  'cyclisme':              'cycling',
  'cycling':               'cycling',
  'vtt':                   'cycling',
  'mountain biking':       'cycling',
  'randonnée':             'walking',
  'marche':                'walking',
  'trekking':              'walking',
  'hiking':                'walking',
  'trail':                 'mountain',
  'alpinisme':             'mountain',
  'ski alpin':             'mountain',
  'ski de fond':           'mountain',
  'ski de randonnée':      'mountain',
  'skiing':                'mountain',
  'cross country skiing':  'mountain',
  'snowboard':             'mountain',
};

function activityIconName(type: string): IconName {
  return ACTIVITY_ICON_NAMES[type.toLowerCase()] ?? 'activity';
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

const createStyles = (t: ReturnType<typeof useV3Theme>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.background },
  headerActions: { flexDirection: 'row', gap: 18, paddingRight: 4 },
  list: { flex: 1, padding: 12 },
  filterBar: { maxHeight: 52, backgroundColor: t.background },
  filterBarContent: { paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: t.card,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: t.mutedText + '33',
  },
  // v3.0 UI port - active filter chip picks up the same tinted-primary treatment as
  // primitives.tsx's own Chip (a real selected/status state, not just a color swap).
  chipActive: {
    backgroundColor: t.primary + '1F',
    borderColor: t.primary,
  },
  chipText: { fontSize: 13, color: t.mutedText, fontWeight: '500' },
  chipTextActive: { color: t.primary, fontWeight: '700' },
  empty: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.background, padding: 32,
  },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyText: { fontSize: 18, color: t.text, fontWeight: '600', marginBottom: 8 },
  emptyHint: { fontSize: 13, color: t.mutedText, textAlign: 'center' },
  emptyFilter: { paddingVertical: 40, alignItems: 'center' },
  emptyFilterText: { color: t.mutedText, fontSize: 14 },
  deleteHint: { fontSize: 11, color: t.mutedText, textAlign: 'center', marginTop: 8, marginBottom: 16 },
  // Card.qml's own real shadow values, applied here directly (not via the <Card> component,
  // since this is a TouchableOpacity row, not a plain surface) so the activity list matches
  // every other v3-themed surface in the app.
  card: {
    backgroundColor: t.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    elevation: 3,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.14,
    shadowRadius: 6,
  },
  // v3.0 UI port - real per-activity track preview (ActivitiesPage.qml parity), see
  // ActivityThumbnail.tsx's own comment on why it's a lightweight SVG shape, not a live map.
  cardThumb: { marginBottom: 10 },
  cardRow: { flexDirection: 'row', alignItems: 'center' },
  cardLeft: { flex: 1 },
  cardDate: { fontSize: 15, color: t.text, fontWeight: '600', marginBottom: 2 },
  cardTypeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 3 },
  cardType: { fontSize: 12, color: t.mutedText },
  cardSub: { fontSize: 13, color: t.mutedText },
  cardRight: { alignItems: 'flex-end' },
  cardDPlus: { fontSize: 13, color: t.mutedText, marginBottom: 4 },
  cardArrow: { fontSize: 22, color: t.mutedText },
});
