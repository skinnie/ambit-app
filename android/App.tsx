import React, { useEffect } from 'react';
import { Alert, Linking, StatusBar } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import HomeScreen from './src/screens/HomeScreen';
import LogListScreen from './src/screens/LogListScreen';
import MapScreen from './src/screens/MapScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import { ActivityRecord } from './src/database/db';
import { handleOAuthCallback as handleLiveloxCallback } from './src/services/ApiLivelox';
import { handleOAuthCallback as handleStravaCallback } from './src/services/ApiStrava';
import { checkForUpdate } from './src/services/UpdateService';
import { t, dateLocale } from './src/i18n';

// ─── Types de navigation ──────────────────────────────────────────────────────

export type RootStackParamList = {
  Home: undefined;
  LogList: undefined;
  Map: { activity: ActivityRecord };
  Settings: undefined;
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
  useEffect(() => {
    // App ouverte depuis un deep link (app déjà lancée)
    const sub = Linking.addEventListener('url', ({ url }) => processOAuthUrl(url));
    // App lancée via le deep link (app froide)
    Linking.getInitialURL().then(processOAuthUrl);
    // Vérification de mise à jour
    checkForUpdate().then(({ available, downloadUrl }) => {
      if (available) {
        Alert.alert(
          t.updateTitle,
          t.updateMsg,
          [
            { text: t.updateLater, style: 'cancel' },
            { text: t.updateDownload, onPress: () => Linking.openURL(downloadUrl) },
          ]
        );
      }
    });
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#1a1a2e" />
      <NavigationContainer>
        <Stack.Navigator
          initialRouteName="Home"
          screenOptions={{
            headerStyle: { backgroundColor: '#1a1a2e' },
            headerTintColor: '#ffffff',
            headerTitleStyle: { fontWeight: 'bold' },
            contentStyle: { backgroundColor: '#16213e' },
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
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
