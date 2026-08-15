import React, { useEffect } from 'react';
import { Alert, Linking, StatusBar } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// v3.0 UI port (2026-08-09, "go all the way to the new theming") - the app shell itself
// (status bar, every native-stack header's background/tint) is the last real holdout;
// nothing in the app imports theme/useTheme.ts anymore after this.
import { useV3Theme } from './src/theme/v3';
import { ThemeModeProvider, useThemeMode } from './src/theme/ThemeModeContext';
import { ExperimentalProvider } from './src/config/ExperimentalContext';
import { DemoProvider } from './src/config/DemoContext';
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
import FirmwareScreen from './src/screens/FirmwareScreen';
import TotalsScreen from './src/screens/TotalsScreen';
import CalendarScreen from './src/screens/CalendarScreen';
import SmartSensorScreen from './src/screens/SmartSensorScreen';
import AppZoneScreen from './src/screens/AppZoneScreen';
import IntervalsScreen from './src/screens/IntervalsScreen';
import type { GarminConnectResult } from './src/native/GarminModule';
import { ActivityRecord } from './src/database/db';
import { handleOAuthCallback as handleStravaCallback } from './src/services/ApiStrava';
import { handleOAuthCallback as handleDropboxCallback } from './src/services/ApiDropbox';
import { handleOAuthCallback as handleGoogleDriveCallback } from './src/services/ApiGoogleDrive';
import { handleOAuthCallback as handleOneDriveCallback } from './src/services/ApiOneDrive';
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
  Firmware: undefined;
  // Activity-analytics views (2026-08-13, port of desktop TotalsPage/CalendarPage). Both are
  // derived purely from the local activity DB, so they're reachable any time (no device
  // needed) - launched from the Activities screen header, not the device-gated Home shell.
  Totals: undefined;
  Calendar: undefined;
  // Experimental (2026-08-14) - gated behind the Experimental flag (see ExperimentalContext),
  // reached from the Settings > Experimental section. App-Zone + Intervals write flash and are
  // unproven on Android hardware; Smart Sensor is a separate BLE peripheral (the HR belt).
  SmartSensor: undefined;
  AppZone: undefined;
  Intervals: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// ─── Handler deep link OAuth2 ─────────────────────────────────────────────────

const STRAVA_OAUTH_PREFIX      = 'opensportsync://oauth/strava';
const DROPBOX_OAUTH_PREFIX     = 'opensportsync://oauth/dropbox';
const GOOGLEDRIVE_OAUTH_PREFIX = 'opensportsync://oauth/googledrive';
const ONEDRIVE_OAUTH_PREFIX    = 'opensportsync://oauth/onedrive';

async function processOAuthUrl(url: string | null) {
  if (!url) return;
  try {
    const code = new URL(url).searchParams.get('code');
    if (!code) throw new Error(t.oauthMissingCode);

    if (url.startsWith(STRAVA_OAUTH_PREFIX)) {
      await handleStravaCallback(code);
      Alert.alert('Strava', t.stravaConnected);
    } else if (url.startsWith(DROPBOX_OAUTH_PREFIX)) {
      await handleDropboxCallback(code);
      Alert.alert('Dropbox', t.cloudConnected);
    } else if (url.startsWith(GOOGLEDRIVE_OAUTH_PREFIX)) {
      await handleGoogleDriveCallback(code);
      Alert.alert('Google Drive', t.cloudConnected);
    } else if (url.startsWith(ONEDRIVE_OAUTH_PREFIX)) {
      await handleOneDriveCallback(code);
      Alert.alert('OneDrive', t.cloudConnected);
    }
  } catch (e: any) {
    Alert.alert(t.error, e?.message);
  }
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <ThemeModeProvider>
      <ExperimentalProvider>
        <DemoProvider>
          <AppShell />
        </DemoProvider>
      </ExperimentalProvider>
    </ThemeModeProvider>
  );
}

function AppShell() {
  const { isDark } = useThemeMode();
  const theme = useV3Theme();

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
            headerStyle: { backgroundColor: theme.card },
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
          <Stack.Screen
            name="Firmware"
            component={FirmwareScreen}
            options={{ title: 'Firmware' }}
          />
          <Stack.Screen
            name="Totals"
            component={TotalsScreen}
            options={{ title: t.totalsScreenTitle }}
          />
          <Stack.Screen
            name="Calendar"
            component={CalendarScreen}
            options={{ title: t.calendarScreenTitle }}
          />
          <Stack.Screen
            name="SmartSensor"
            component={SmartSensorScreen}
            options={{ title: t.smartSensorScreenTitle }}
          />
          <Stack.Screen
            name="AppZone"
            component={AppZoneScreen}
            options={{ title: t.appZoneScreenTitle }}
          />
          <Stack.Screen
            name="Intervals"
            component={IntervalsScreen}
            options={{ title: t.intervalsScreenTitle }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
