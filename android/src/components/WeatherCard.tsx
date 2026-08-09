import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card } from './ui/Card';
import { useV3Theme, v3Spacing, v3Type } from '../theme/v3';
import { useWeather, weatherEmoji } from '../services/WeatherService';
import { t } from '../i18n';

// Same real WMO code ranges as WeatherService.ts's own weatherEmoji() / desktop's
// WeatherViewModel.qml labelFor() - kept here (not in WeatherService.ts) so it can use this
// screen's own i18n strings directly instead of threading the whole `t` object through a
// generic-record parameter.
function weatherLabel(code: number): string {
  if (code === 0) return t.weatherClear;
  if (code === 1) return t.weatherMainlyClear;
  if (code === 2) return t.weatherPartlyCloudy;
  if (code === 3) return t.weatherOvercast;
  if (code === 45 || code === 48) return t.weatherFog;
  if (code >= 51 && code <= 57) return t.weatherDrizzle;
  if (code >= 61 && code <= 67) return t.weatherRain;
  if (code >= 80 && code <= 82) return t.weatherRainShowers;
  if (code === 71 || code === 73 || code === 75 || code === 77) return t.weatherSnow;
  if (code === 85 || code === 86) return t.weatherSnowShowers;
  if (code === 95 || code === 96 || code === 99) return t.weatherThunderstorm;
  return t.weatherUnknown;
}

// Real, 2026-08-09 (v3.0 UI port, "replicate the desktop version feature wise") - ports
// desktop/qml/components/WeatherCard.qml's exact layout: hidden until hasFetchedOnce, then
// either a friendly offline message or the real current-conditions row (icon/place/temp/
// label, wind + high/low) plus a 3-day forecast row. Same real "don't show an error, just a
// plain offline message" rule as the QML original.
export function WeatherCard() {
  const theme = useV3Theme();
  const weather = useWeather();

  if (!weather.hasFetchedOnce) return null;

  return (
    <Card style={styles.card}>
      {!weather.available || !weather.data ? (
        <View style={styles.offlineRow}>
          <Text style={styles.offlineEmoji}>☁️</Text>
          <Text style={[styles.offlineText, { color: theme.mutedText }]}>{t.weatherOffline}</Text>
        </View>
      ) : (
        <View style={{ gap: v3Spacing.medium }}>
          <View style={styles.mainRow}>
            <Text style={styles.mainEmoji}>{weatherEmoji(weather.data.currentWeatherCode)}</Text>
            <View style={styles.mainInfo}>
              {!!weather.placeName && (
                <Text style={[styles.placeName, { color: theme.mutedText }]}>{weather.placeName}</Text>
              )}
              <Text style={[styles.temp, { color: theme.text }]}>
                {Math.round(weather.data.currentTemperature)}°
              </Text>
              <Text style={[styles.condLabel, { color: theme.mutedText }]}>
                {weatherLabel(weather.data.currentWeatherCode)}
              </Text>
            </View>
            <View style={styles.sideInfo}>
              <Text style={[styles.sideLine, { color: theme.mutedText }]}>
                {t.weatherWind(Math.round(weather.data.windSpeed))}
              </Text>
              <Text style={[styles.sideLine, { color: theme.mutedText }]}>
                {t.weatherHighLow(Math.round(weather.data.todayHigh), Math.round(weather.data.todayLow))}
              </Text>
            </View>
          </View>

          <View style={styles.forecastRow}>
            {weather.data.forecast.map((day, i) => (
              <View key={day.date} style={styles.forecastCol}>
                <Text style={[styles.forecastDay, { color: theme.mutedText }]}>
                  {i === 0 ? t.weatherToday : new Date(day.date).toLocaleDateString(undefined, { weekday: 'short' })}
                </Text>
                <Text style={styles.forecastEmoji}>{weatherEmoji(day.code)}</Text>
                <Text style={[styles.forecastTemp, { color: theme.text }]}>
                  {t.weatherHighLowShort(Math.round(day.high), Math.round(day.low))}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { width: '100%' },
  offlineRow: { flexDirection: 'row', alignItems: 'center', gap: v3Spacing.medium },
  offlineEmoji: { fontSize: 28 },
  offlineText: { flex: 1, fontSize: v3Type.bodyLarge },
  mainRow: { flexDirection: 'row', alignItems: 'center', gap: v3Spacing.medium },
  mainEmoji: { fontSize: 40 },
  mainInfo: { gap: 2 },
  placeName: { fontSize: v3Type.label },
  temp: { fontSize: v3Type.display, fontWeight: '800' },
  condLabel: { fontSize: v3Type.bodyLarge },
  sideInfo: { marginLeft: 'auto', gap: 2, alignItems: 'flex-end' },
  sideLine: { fontSize: v3Type.label },
  forecastRow: { flexDirection: 'row', justifyContent: 'space-around' },
  forecastCol: { alignItems: 'center', gap: 4 },
  forecastDay: { fontSize: v3Type.label },
  forecastEmoji: { fontSize: 22 },
  forecastTemp: { fontSize: v3Type.label, fontWeight: '600' },
});
