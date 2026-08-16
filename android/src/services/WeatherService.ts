import { useEffect, useRef, useState } from 'react';

// v3.0 UI port (2026-08-09, "replicate the desktop version feature wise") - ports
// desktop/src/services/weatherservice.cpp + qml/viewmodels/WeatherViewModel.qml byte-for-byte
// in intent: same Open-Meteo endpoint/params, same Nominatim reverse-geocode, same
// ip-api.com IP-based location fallback, same WMO weather-code -> icon/label mapping, same
// 10-minute auto-refresh, same "hide until hasFetchedOnce, then show a friendly offline
// message rather than an error" rule. No API key anywhere, matching AMBITAPP_SPEC.md's own
// "Open-Meteo (no API key)" choice - see weatherservice.h's own header comment.

export interface ForecastDay {
  date: string;
  high: number;
  low: number;
  code: number;
}

export interface WeatherData {
  currentTemperature: number;
  currentWeatherCode: number;
  windSpeed: number;
  todayHigh: number;
  todayLow: number;
  forecast: ForecastDay[];
}

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
// Same real "no location configured yet" placeholder as weatherservice.h's own
// m_latitude/m_longitude defaults - roughly central Europe, not 0,0 (the Gulf of Guinea).
const DEFAULT_LAT = 48.85;
const DEFAULT_LON = 2.35;

export async function fetchWeather(latitude: number, longitude: number): Promise<WeatherData | null> {
  // URLSearchParams + string concat, not `new URL()` - matches ApiStrava.ts's
  // own established pattern in this codebase (URL's own constructor isn't used anywhere
  // else here).
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,weather_code,wind_speed_10m',
    daily: 'temperature_2m_max,temperature_2m_min,weather_code',
    timezone: 'auto',
    forecast_days: '3',
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
  if (!res.ok) return null;
  const body = await res.json();
  const current = body?.current;
  const daily = body?.daily;
  if (!current || !daily?.time?.length) return null;

  const forecast: ForecastDay[] = daily.time.map((date: string, i: number) => ({
    date,
    high: daily.temperature_2m_max?.[i] ?? 0,
    low: daily.temperature_2m_min?.[i] ?? 0,
    code: daily.weather_code?.[i] ?? -1,
  }));

  return {
    currentTemperature: current.temperature_2m ?? 0,
    currentWeatherCode: current.weather_code ?? -1,
    windSpeed: current.wind_speed_10m ?? 0,
    todayHigh: forecast[0]?.high ?? 0,
    todayLow: forecast[0]?.low ?? 0,
    forecast,
  };
}

export async function fetchPlaceName(latitude: number, longitude: number): Promise<string> {
  const params = new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
    format: 'json',
    zoom: '10',
  });

  try {
    // Nominatim's usage policy requires a real identifying User-Agent - same real header
    // weatherservice.cpp's own fetchPlaceName() sends.
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, {
      headers: { 'User-Agent': 'Sommet/2.0' },
    });
    if (!res.ok) return '';
    const body = await res.json();
    const address = body?.address ?? {};
    for (const key of ['city', 'town', 'village', 'municipality', 'county']) {
      if (address[key]) return address[key];
    }
    return '';
  } catch {
    return '';
  }
}

export async function detectLocationFromIp(): Promise<{ latitude: number; longitude: number } | null> {
  try {
    // ip-api.com's free tier: no key, HTTP only (no HTTPS) - same real, commonly-used
    // service weatherservice.cpp's own detectLocationFromIp() calls. Approximate
    // (city-level from the IP's registered location, not true GPS).
    const res = await fetch('http://ip-api.com/json/');
    if (!res.ok) return null;
    const body = await res.json();
    if (body?.status !== 'success') return null;
    return { latitude: body.lat, longitude: body.lon };
  } catch {
    return null;
  }
}

// Real WMO weather-interpretation codes (open-meteo.com/en/docs, "WMO Weather interpretation
// codes") - same ranges as WeatherViewModel.qml's own iconFor()/labelFor(), emoji instead of
// this app's own Material-Symbols-subset Icon.tsx (which has no weather glyphs at all - see
// assets/fonts/NOTICE.md on why that font is deliberately small/subsetted; adding 7 new
// glyphs to it isn't worth it for a widget emoji already render natively).
export function weatherEmoji(code: number): string {
  if (code === 0) return '☀️';
  if (code === 1 || code === 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 51 && code <= 67) return '🌧️';
  if (code >= 80 && code <= 82) return '🌧️';
  if (code === 71 || code === 73 || code === 75 || code === 77) return '❄️';
  if (code === 85 || code === 86) return '❄️';
  if (code === 95 || code === 96 || code === 99) return '⛈️';
  return '🌤️';
}

interface WeatherState {
  loading: boolean;
  available: boolean;
  hasFetchedOnce: boolean;
  placeName: string;
  data: WeatherData | null;
}

// Component-scoped (not a module-level singleton like WeatherService.cpp's own QML
// singleton) - Home is the only real consumer right now, so a hook owning its own state +
// refresh timer for as long as Home is mounted is the simplest thing that's still correct;
// a shared singleton would only matter once a second screen needs the same live data.
export function useWeather() {
  const [state, setState] = useState<WeatherState>({
    loading: false, available: false, hasFetchedOnce: false, placeName: '', data: null,
  });
  const locationRef = useRef({ latitude: DEFAULT_LAT, longitude: DEFAULT_LON });

  async function refresh() {
    setState(s => ({ ...s, loading: true }));
    const { latitude, longitude } = locationRef.current;
    const [data, placeName] = await Promise.all([
      fetchWeather(latitude, longitude),
      fetchPlaceName(latitude, longitude),
    ]);
    setState({
      loading: false,
      available: data !== null,
      hasFetchedOnce: true,
      placeName,
      data,
    });
  }

  async function detectAndRefresh() {
    const loc = await detectLocationFromIp();
    if (loc) locationRef.current = loc;
    await refresh();
  }

  useEffect(() => {
    detectAndRefresh();
    const iv = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ...state, refresh };
}
