import { NativeModules, Platform } from 'react-native';

// ─── Détection locale ─────────────────────────────────────────────────────────

function deviceLocale(): string {
  // Intl est disponible dans Hermes (RN 0.70+) et respecte la locale système
  try {
    const intlLocale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (intlLocale) return intlLocale;
  } catch {}
  // Fallback NativeModules (Old Architecture)
  if (Platform.OS === 'android') {
    return NativeModules.I18nManager?.localeIdentifier ?? 'en';
  }
  return (
    NativeModules.SettingsManager?.settings?.AppleLocale ??
    NativeModules.SettingsManager?.settings?.AppleLanguages?.[0] ??
    'en'
  );
}

export const locale   = deviceLocale();
export const isFrench = locale.toLowerCase().startsWith('fr');
export const dateLocale = isFrench ? 'fr-FR' : 'en-GB';

// ─── Traductions ──────────────────────────────────────────────────────────────

const fr = {
  // HomeScreen
  sync:         'SYNC',
  synced:       'SYNC OK',
  retry:        'RÉESSAYER',
  conn:         'CONN…',
  read:         'LECTURE…',
  save:         'ENREG…',
  idle:         'En attente',
  connecting:   'Connexion à la montre…',
  fetching:     'Lecture des logs…',
  writing:      'Enregistrement…',
  done:         (n: number) => `${n} log${n !== 1 ? 's' : ''} importé${n !== 1 ? 's' : ''}`,
  error:        'Erreur',
  unknownError: 'Erreur inconnue',
  viewActivities: 'Voir les activités',

  // LogListScreen
  all:          'Toutes',
  loadError:    'Erreur chargement',
  deleteTitle:  'Supprimer',
  deleteMsg:    (date: string) =>
    `Supprimer l'activité du ${date} ?\n\nElle ne sera pas rechargée lors des prochaines synchronisations.`,
  cancel:       'Annuler',
  delete:       'Supprimer',
  noActivities: 'Aucune activité synchronisée',
  connectHint:  'Connectez la montre et lancez une synchronisation',
  noFilter:     'Aucune activité pour ce filtre',
  deleteHint:   'Appui long sur une activité pour la supprimer',
  unknownDate:  'Date inconnue',

  // MapScreen
  loading:        'Chargement du parcours…',
  noGps:          'Aucun point GPS dans ce fichier GPX',
  readError:      'Impossible de lire le fichier GPX\n',
  liveloxTitle:   'Connexion Livelox',
  liveloxMsg:     "Vous allez être redirigé vers Livelox pour autoriser l'accès. Revenez ensuite dans l'app.",
  connect:        'Se connecter',
  liveloxError:   'Erreur Livelox',
  liveloxSuccess: 'Activité importée !',
  close:          'Fermer',
  viewOnLivelox:  'Voir sur Livelox',
  noApiKey:       'Clé API manquante',
  noApiKeyMsg:    'Configurez votre clé API Runalyze dans les Paramètres.',
  settings:       'Paramètres',
  runalyzeOk:     (id: string | number) =>
    `Activité importée ! (ID : ${id})\n\nPour l'envoyer vers Suunto : runalyze.com → activité → Partager → Suunto`,
  runalyzeError:  'Erreur Runalyze',
  savedOk:        'Enregistré',
  savedMsg:       (name: string) => `Fichier copié dans Téléchargements :\n${name}`,
  saveError:      "Impossible d'enregistrer\n",
  shareError:     'Impossible de partager le fichier\n',
  shareGpx:       '📤 Partager GPX',
  saveDownloads:  '💾 Enregistrer (Téléchargements)',
  uploadRunalyze: '📊 Upload Runalyze',
  uploadLivelox:  '🔴 Upload Livelox',
  uploadStrava:   '🟠 Upload Strava',
  distance:       'Distance',
  duration:       'Durée',
  avgSpeed:       'Vitesse',
  pace:           'Allure',
  departure:      'Départ',
  arrival:        'Arrivée',
  replayTime:     'Replay (temps)',
  replayDist:     'Replay (distance)',

  // SettingsScreen — Strava
  stravaSection:         'Strava',
  stravaSettingsDesc:    'Connectez votre compte Strava pour exporter vos activités. La connexion utilise OAuth2.',
  stravaConnectedStatus: 'Compte Strava connecté',
  stravaDisconnectBtn:   'Se déconnecter de Strava',
  stravaDisconnected:    'Déconnecté de Strava.',
  stravaConnected:       'Connexion réussie ! Vous pouvez maintenant exporter vers Strava.',
  stravaError:           'Erreur Strava',
  stravaNotConnected:    'Connectez d\'abord Strava dans les Paramètres.',
  viewOnStrava:          'Voir sur Strava',
  stravaSuccess:         'Activité uploadée sur Strava !',

  // SettingsScreen — Livelox
  liveloxSettingsDesc: "Connectez votre compte Livelox pour exporter vos parcours. La connexion utilise OAuth2 PKCE.",
  liveloxConnectedStatus: 'Compte Livelox connecté',
  liveloxDisconnectBtn: 'Se déconnecter de Livelox',
  liveloxDisconnected: 'Déconnecté de Livelox.',

  // SettingsScreen — Runalyze
  emptyKey:       'Clé vide',
  emptyKeyMsg:    'Entrez votre clé API Runalyze.',
  keySaved:       'Clé API Runalyze sauvegardée.',
  keyDeleted:     'Clé API Runalyze supprimée.',
  deleted:        'Supprimé',
  runalyzeSection: 'Runalyze',
  runalyzeDesc:   "Runalyze est une plateforme d'analyse d'entraînement open source et gratuite. Vos activités seront importées dans votre compte Runalyze.",
  runalyzeApiHint: 'Générez votre clé API sur ',
  runalyzeApiLink: 'runalyze.com → Account → API access',
  apiKey:          'Clé API',
  apiKeyPlaceholder: 'Collez votre clé API ici',
  saveBtn:         'Enregistrer',
  deleteBtn:       'Supprimer',
  keyStored:       'Clé enregistrée',

  // App.tsx — mise à jour
  updateTitle:    'Mise à jour disponible',
  updateMsg:      'Une nouvelle version de l\'app est disponible.',
  updateLater:    'Plus tard',
  updateDownload: 'Télécharger',

  // App.tsx
  logListTitle:  'Activités',
  mapFallback:   'Parcours',
  settingsTitle: 'Paramètres',
  liveloxConnected: "Connexion réussie ! Vous pouvez maintenant exporter vos activités.",
  oauthMissingCode: 'Code OAuth manquant dans le callback',
};

const en: typeof fr = {
  sync:         'SYNC',
  synced:       'SYNCED',
  retry:        'RETRY',
  conn:         'CONN…',
  read:         'READ…',
  save:         'SAVE…',
  idle:         'Idle',
  connecting:   'Connecting to watch…',
  fetching:     'Reading logs…',
  writing:      'Saving…',
  done:         (n: number) => `${n} log${n !== 1 ? 's' : ''} imported`,
  error:        'Error',
  unknownError: 'Unknown error',
  viewActivities: 'View activities',

  all:          'All',
  loadError:    'Load error',
  deleteTitle:  'Delete',
  deleteMsg:    (date: string) =>
    `Delete activity from ${date}?\n\nIt won't be re-imported on next sync.`,
  cancel:       'Cancel',
  delete:       'Delete',
  noActivities: 'No synced activities',
  connectHint:  'Connect the watch and start a sync',
  noFilter:     'No activities for this filter',
  deleteHint:   'Long press on an activity to delete it',
  unknownDate:  'Unknown date',

  loading:        'Loading track…',
  noGps:          'No GPS points in this GPX file',
  readError:      'Cannot read GPX file\n',
  liveloxTitle:   'Livelox Login',
  liveloxMsg:     'You will be redirected to Livelox to authorize access. Come back to the app afterwards.',
  connect:        'Log in',
  liveloxError:   'Livelox Error',
  liveloxSuccess: 'Activity imported!',
  close:          'Close',
  viewOnLivelox:  'View on Livelox',
  noApiKey:       'API key missing',
  noApiKeyMsg:    'Configure your Runalyze API key in Settings.',
  settings:       'Settings',
  runalyzeOk:     (id: string | number) =>
    `Activity imported! (ID: ${id})\n\nTo send to Suunto: runalyze.com → activity → Share → Suunto`,
  runalyzeError:  'Runalyze Error',
  savedOk:        'Saved',
  savedMsg:       (name: string) => `File saved to Downloads:\n${name}`,
  saveError:      'Cannot save file\n',
  shareError:     'Cannot share file\n',
  shareGpx:       '📤 Share GPX',
  saveDownloads:  '💾 Save to Downloads',
  uploadRunalyze: '📊 Upload to Runalyze',
  uploadLivelox:  '🔴 Upload to Livelox',
  uploadStrava:   '🟠 Upload to Strava',
  distance:       'Distance',
  duration:       'Duration',
  avgSpeed:       'Speed',
  pace:           'Pace',
  departure:      'Start',
  arrival:        'Finish',
  replayTime:     'Replay (time)',
  replayDist:     'Replay (distance)',

  liveloxSettingsDesc: 'Connect your Livelox account to export your tracks. The connection uses OAuth2 PKCE.',
  liveloxConnectedStatus: 'Livelox account connected',
  liveloxDisconnectBtn: 'Disconnect from Livelox',
  liveloxDisconnected: 'Disconnected from Livelox.',

  emptyKey:       'Empty key',
  emptyKeyMsg:    'Enter your Runalyze API key.',
  keySaved:       'Runalyze API key saved.',
  keyDeleted:     'Runalyze API key deleted.',
  deleted:        'Deleted',
  runalyzeSection: 'Runalyze',
  runalyzeDesc:   'Runalyze is a free, open-source training analysis platform. Your activities will be imported into your Runalyze account.',
  runalyzeApiHint: 'Generate your API key at ',
  runalyzeApiLink: 'runalyze.com → Account → API access',
  apiKey:          'API key',
  apiKeyPlaceholder: 'Paste your API key here',
  saveBtn:         'Save',
  deleteBtn:       'Delete',
  keyStored:       'Key saved',

  updateTitle:    'Update available',
  updateMsg:      'A new version of the app is available.',
  updateLater:    'Later',
  updateDownload: 'Download',

  logListTitle:  'Activities',
  mapFallback:   'Track',
  settingsTitle: 'Settings',
  liveloxConnected: 'Connected! You can now export your activities.',
  oauthMissingCode: 'OAuth code missing in callback',

  stravaSection:         'Strava',
  stravaSettingsDesc:    'Connect your Strava account to export your activities. The connection uses OAuth2.',
  stravaConnectedStatus: 'Strava account connected',
  stravaDisconnectBtn:   'Disconnect from Strava',
  stravaDisconnected:    'Disconnected from Strava.',
  stravaConnected:       'Connected! You can now export activities to Strava.',
  stravaError:           'Strava Error',
  stravaNotConnected:    'Connect Strava first in Settings.',
  viewOnStrava:          'View on Strava',
  stravaSuccess:         'Activity uploaded to Strava!',
};

export const t = isFrench ? fr : en;
