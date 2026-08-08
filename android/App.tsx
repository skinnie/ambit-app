import React, { useEffect } from 'react';
import { Alert, Linking, StatusBar } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useTheme } from './src/theme/useTheme';
import { ThemeModeProvider, useThemeMode } from './src/theme/ThemeModeContext';
import HomeScreen from './src/screens/HomeScreen';
import LogListScreen from './src/screens/LogListScreen';
import MapScreen from './src/screens/MapScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import PoiScreen from './src/screens/PoiScreen';
import RouteScreen from './src/screens/RouteScreen';
import GarminRouteScreen from './src/screens/GarminRouteScreen';
import GarminPoiScreen from './src/screens/GarminPoiScreen';
import BackupScreen from './src/screens/BackupScreen';
import SportModesScreen from './src/screens/SportModesScreen';
import type { GarminConnectResult } from './src/native/GarminModule';
import { ActivityRecord } from './src/database/db';
import { handleOAuthCallback as handleLiveloxCallback } from './src/services/ApiLivelox';
import { handleOAuthCallback as handleStravaCallback } from './src/services/ApiStrava';
import { t, dateLocale } from './src/i18n';

// ─── Types de navigation ──────────────────────────────────────────────────────

export type RootStackParamList = {
  Home: undefined;
  LogList: undefined;
  Map: { activity: ActivityRecord };
  Settings: undefined;
  Poi: undefined;
  Route: undefined;
  // v2.3.2 beta: HomeScreen connects to the Garmin device itself (see its
  // connecting-flow state machine) and hands the already-fetched info over
  // here — neither screen has its own Connect step. Activities sync runs
  // inline from Home (no screen — see GarminActivityService.ts), so there's
  // no "Garmin" route anymore, just these two, mirroring the Ambit Route/Poi
  // screens per André's feedback.
  GarminRoute: { info: GarminConnectResult };
  GarminPoi: { info: GarminConnectResult };
  Backup: undefined;
  // Real, 2026-08-08 - Ambit3-only (Kailash's own memory map has no CustomModes region),
  // HomeScreen only routes here for that device type - see SportModesScreen.tsx.
  SportModes: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// ─── Handler deep link OAuth2 ─────────────────────────────────────────────────

const LIVELOX_OAUTH_PREFIX = 'opensportsync://oauth/livelox';
const STRAVA_OAUTH_PREFIX  = 'opensportsync://oauth/strava';

async function processOAuthUrl(url: string | null) {
  if (!url) return;
  try {
    const code = new URL(url).searchParams.get('code');
    if (!code) throw new Error(t.oauthMissingCode);

    if (url.startsWith(LIVELOX_OAUTH_PREFIX)) {
      await handleLiveloxCallback(code);
      Alert.alert('Livelox', t.liveloxConnected);
    } else if (url.startsWith(STRAVA_OAUTH_PREFIX)) {
      await handleStravaCallback(code);
      Alert.alert('Strava', t.stravaConnected);
    }
  } catch (e: any) {
    Alert.alert(t.error, e?.message);
  }
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <ThemeModeProvider>
      <AppShell />
    </ThemeModeProvider>
  );
}

function AppShell() {
  const { isDark } = useThemeMode();
  const theme = useTheme();

  useEffect(() => {
    // App ouverte depuis un deep link (app déjà lancée)
    const sub = Linking.addEventListener('url', ({ url }) => processOAuthUrl(url));
    // App lancée via le deep link (app froide)
    Linking.getInitialURL().then(processOAuthUrl);
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={theme.background}
      />
      <NavigationContainer>
        <Stack.Navigator
          initialRouteName="Home"
          screenOptions={{
            headerStyle: { backgroundColor: theme.surface },
            headerTintColor: theme.text,
            headerTitleStyle: { fontWeight: '700' },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: theme.background },
          }}
        >
          <Stack.Screen
            name="Home"
            component={HomeScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="LogList"
            component={LogListScreen}
            options={{ title: t.logListTitle }}
          />
          <Stack.Screen
            name="Map"
            component={MapScreen}
            options={({ route }) => ({
              title: route.params.activity.date
                ? new Date(route.params.activity.date).toLocaleDateString(dateLocale)
                : t.mapFallback,
            })}
          />
          <Stack.Screen
            name="Settings"
            component={SettingsScreen}
            options={{ title: t.settingsTitle }}
          />
          <Stack.Screen
            name="Poi"
            component={PoiScreen}
            options={{ title: t.poiScreenTitle }}
          />
          <Stack.Screen
            name="Route"
            component={RouteScreen}
            options={{ title: t.routeScreenTitle }}
          />
          <Stack.Screen
            name="GarminRoute"
            component={GarminRouteScreen}
            options={{ title: t.garminRouteScreenTitle }}
          />
          <Stack.Screen
            name="GarminPoi"
            component={GarminPoiScreen}
            options={{ title: t.garminPoiScreenTitle }}
          />
          <Stack.Screen
            name="Backup"
            component={BackupScreen}
            options={{ title: t.backupScreenTitle }}
          />
          <Stack.Screen
            name="SportModes"
            component={SportModesScreen}
            options={{ title: t.sportModesScreenTitle }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
