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
// Kept in sync with the forced English `t` above (see note there).
export const dateLocale = 'en-GB';

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

  // HomeScreen — connecting flow (v2.3.2 beta)
  homeSearchingTitle: 'Recherche de votre appareil, veuillez patienter…',
  homeConnectLaterBtn: 'Connecter plus tard',
  homeNoDeviceTitle:
    "Aucun appareil détecté. Vérifiez le câble et l'appareil, ou utilisez l'app sans appareil.",
  homeConnectingAmbit: 'Connexion à la montre…',
  homeConnectRetryBtn: 'Réessayer',
  homeBleConnectBtn: 'Associer en Bluetooth (expérimental)',
  homeBleReadyTitle: 'Prêt à associer',
  homeBleReadyMsg:
    "Sur la montre : menu « Pair Mobile App » (première association) ou « Sync now » " +
    "(déjà associée) maintenant — la fenêtre Bluetooth de la montre ne reste " +
    "active que quelques secondes. Ambit3, Traverse et Kailash, expérimental.",
  homeBleReadyBtn: 'Prêt',
  homeConnectingBle: 'Connexion Bluetooth…',
  homeActivitiesBtn: 'ACTIVITÉS',
  homeRoutesBtn:     'ROUTES',
  homePoisBtn:       'POI',
  homeSyncActivitiesBtn: 'SYNC ACTIVITÉS',
  homeBatteryLabel: 'batterie',
  homeHwLabel:      'matériel',
  homeDeviceConnectedStatus: 'Connecté',

  // Kailash travel history (2026-08-08)
  homeKailashTravelTitle:     'Historique de voyage',
  homeKailashCitiesLabel:     'villes visitées',
  homeKailashCountriesLabel:  'pays visités',
  homeKailashTravelledLabel:  'distance parcourue',
  homeKailashFurthestLabel:   'plus loin de la maison',
  homeKailashLogbookLabel:    'sessions enregistrées',
  homeKailashTrackTitle:      'Activité GPS',
  homeKailashTrackPoints:     'points GPS',
  homeKailashTrackExport:     'Exporter la trace (GPX)',
  homeKailashExportDone:      'Trace exportée (%d points) vers Téléchargements',
  homeKailashExportEmpty:     'Aucune trace GPS à exporter',

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
  shareFit:       '📤 Partager FIT',
  saveFitDownloads: '💾 Enregistrer FIT (Téléchargements)',
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

  // SettingsScreen — Apparence
  appearanceSection:  'Apparence',
  appearanceDesc:     'Choisissez le thème clair, sombre, ou suivez le réglage du système.',
  themeLight:         'Clair',
  themeDark:          'Sombre',
  themeSystem:        'Système',

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

  // SettingsScreen — Intervals.icu
  intervalsSection:    'Intervals.icu',
  intervalsDesc:       "Connectez votre compte Intervals.icu pour y importer vos activités. Authentification par clé API personnelle (pas d'OAuth).",
  intervalsApiHint:    'Générez votre clé API sur ',
  intervalsApiLink:    'intervals.icu → Settings → Developer Settings',
  athleteId:           'ID Athlète',
  athleteIdPlaceholder: 'ex : i123456',
  emptyCreds:          'Champs manquants',
  emptyCredsMsg:       "Entrez votre ID athlète et votre clé API Intervals.icu.",
  credsSaved:          'Identifiants Intervals.icu sauvegardés.',
  credsDeleted:        'Identifiants Intervals.icu supprimés.',
  credsStored:         'Identifiants enregistrés',

  // MapScreen — Intervals.icu
  uploadIntervals:     '📈 Upload Intervals.icu',
  intervalsError:      'Erreur Intervals.icu',
  intervalsSuccess:    'Activité importée sur Intervals.icu !',
  viewOnIntervals:     'Voir sur Intervals.icu',
  noCreds:             'Identifiants manquants',
  noCredsMsg:          "Configurez votre ID athlète et votre clé API Intervals.icu dans les Paramètres.",


  // App.tsx
  logListTitle:  'Activités',
  mapFallback:   'Parcours',
  settingsTitle: 'Paramètres',
  liveloxConnected: "Connexion réussie ! Vous pouvez maintenant exporter vos activités.",
  oauthMissingCode: 'Code OAuth manquant dans le callback',

  // HomeScreen — bouton données GPS (SGEE/AGPS)
  gpsUpdate:          'GPS',
  gpsDone:            'GPS OK',
  gpsDownloading:      'DL…',
  gpsIdle:            'Données GPS',
  gpsDownloadingMsg:  'Téléchargement des données GPS…',
  gpsDoneMsg:         'Données GPS à jour',

  // HomeScreen — bouton envoyer une route
  sendRoute:          'ROUTE',
  routeDone:          'ENVOYÉ',
  routePicking:       'FICHIER…',
  routeParsing:       'LECTURE…',
  routeIdle:          'Envoyer une route',
  routePickingMsg:    'Choisissez un fichier GPX…',
  routeParsingMsg:    'Analyse du GPX…',
  routeWritingMsg:    'Écriture sur la montre…',
  routeDoneMsg: (name: string, points: number, waypoints: number) =>
    `« ${name} » envoyée (${points} points, ${waypoints} waypoint${waypoints !== 1 ? 's' : ''})`,
  sendRouteConfirmTitle: 'Envoyer une route',
  sendRouteConfirmMsg:
    "Ceci va remplacer toute route déjà présente sur la montre. Vos POIs sont préservés " +
    "automatiquement. Attention : cette route n'est pas permanente — la prochaine " +
    "synchronisation SuuntoLink, ou même la simple proximité Bluetooth de l'app Suunto, " +
    "la remplacera. C'est fait pour charger une route juste avant de partir, pas pour " +
    "la stocker durablement.",
  sendRouteConfirmBtn: 'Envoyer',
  routeScreenTitle:   'Route',
  routeSendSection:   'Envoyer une route',
  routeExportSection: 'Exporter depuis la montre',
  routeExportDesc:    'Lit les routes et waypoints présents sur la montre et les enregistre dans un fichier GPX (Téléchargements).',
  routeExportBtn:     'Exporter depuis la montre',
  routeExportReading: 'Lecture de la navigation…',
  navExportedTitle:   'Export terminé',
  navExportedMsg: (routes: number, waypoints: number) =>
    `${routes} route${routes !== 1 ? 's' : ''}, ${waypoints} waypoint${waypoints !== 1 ? 's' : ''} enregistrés dans Téléchargements.`,

  // RouteScreen — Bluetooth (expérimental, v0.3.0, Ambit3/Traverse uniquement)
  bleExperimentalBadge: 'EXPÉRIMENTAL',
  bleExperimentalDisclaimer:
    "Le transfert par Bluetooth est expérimental et n'a pas encore été vérifié sur du matériel réel — " +
    "utilisez le câble si possible. Réservé aux montres Ambit3 et Traverse. Vous devrez déclencher " +
    '"Sync now" sur la montre au bon moment (voir la fenêtre suivante).',
  sendRouteBleBtn:    'Envoyer (Bluetooth)',
  routeExportBleBtn:  'Exporter (Bluetooth)',
  bleScanning:        'Recherche de la montre…',
  bleConnecting:      'Connexion Bluetooth…',
  bleSyncNowTitle:    'Prêt à synchroniser',
  bleSyncNowMsg:
    'Sur la montre, déclenchez "Sync now" MAINTENANT, puis appuyez immédiatement sur "Prêt" ' +
    'ci-dessous — la fenêtre Bluetooth de la montre ne reste active que quelques secondes.',
  bleSyncNowReady:    'Prêt',

  // HomeScreen / PoiScreen
  poiButton:        'POI',
  poiScreenTitle:   'POI',
  poiImportSection: 'Importer depuis un GPX',
  poiImportDesc:    "Choisissez un fichier GPX : chaque <wpt> qu'il contient sera envoyé comme POI, en préservant ceux déjà sur la montre.",
  poiExportSection: 'Exporter vers un GPX',
  poiExportDesc:    'Lit tous les POI présents sur la montre et les enregistre dans un fichier GPX (Téléchargements).',
  poiExportBtn:     'Exporter depuis la montre',
  poiExportReading: 'Lecture des POI…',
  poiExportedTitle: 'POI exportés',
  poiExportedMsg: (n: number) => `${n} POI${n !== 1 ? 's' : ''} enregistré${n !== 1 ? 's' : ''} dans Téléchargements.`,

  // SettingsScreen — Ajouter un POI
  poiSection:    'Ajouter un POI',
  poiDesc:       "Envoie un point d'intérêt à la montre par câble, en préservant ceux déjà présents.",
  poiName:       'Nom',
  poiNamePlaceholder: 'ex : Sommet',
  poiLat:        'Latitude',
  poiLon:        'Longitude',
  poiAddBtn:     'Envoyer à la montre',
  poiWriting:    'Envoi du POI…',
  poiInvalid:    'Entrée invalide',
  poiNameRequired: 'Entrez un nom pour le POI.',
  poiCoordsInvalid: 'Latitude/longitude invalide (latitude -90 à 90, longitude -180 à 180).',
  poiAddedTitle: 'POI ajouté',
  poiAddedMsg: (name: string) => `« ${name} » a été envoyé à la montre.`,
  poiImportBtn:     'Importer depuis un GPX',
  poiImportPicking: 'Choisissez un fichier GPX…',
  poiImportParsing: 'Analyse du GPX…',
  poiImportWriting: (done: number, total: number) => `Envoi des POI… (${done}/${total})`,
  poiImportedTitle: 'POI importés',
  poiImportedMsg: (n: number) => `${n} POI${n !== 1 ? 's' : ''} envoyé${n !== 1 ? 's' : ''} à la montre.`,

  // SettingsScreen — Ambit3 Settings (2026-08-08)
  ambitSettingsSection: 'Réglages de la montre',
  kailashSettingsSection: 'Réglages Kailash',
  ambitSettingsTitle: (name: string) => `Réglages ${name}`,
  ambitSettingsDesc:
    'Réglages réels de la montre (langue, formats, luminosité, etc.), lus et modifiés par ' +
    'câble USB — confirmé sur du matériel réel le 8 août 2026.',
  ambitSettingsReadBtn: 'Lire les réglages',
  ambitSettingsRefreshBtn: 'Actualiser',
  ambitSettingsReading: 'Lecture des réglages…',

  // SportModesScreen — Ambit3 CustomModes (2026-08-08), Ambit3-only, pas disponible sur Kailash
  sportModesButton:      'MODES SPORT',
  sportModesScreenTitle: 'Modes sport',
  sportModesDesc:
    'Modifie les modes sport réels de la montre (noms, autolap, limites FC, capteurs, ' +
    'affichages) par câble USB — mécanisme confirmé sur le bureau, pas encore confirmé sur ' +
    'du matériel réel via Android.',
  sportModesReadBtn: 'Lire les modes sport',
  sportModesReading: 'Lecture des modes sport…',
  sportModesRefreshBtn: 'Actualiser',
  sportModesRenameBtn: 'Renommer',
  sportModesExpandBtn: 'Détails',
  sportModesCollapseBtn: 'Masquer',
  sportModesAutolapLabel: 'Autolap (m)',
  sportModesSetBtn: 'Appliquer',
  sportModesHrLimitsLabel: 'Limites FC',
  sportModesHrLowLabel: 'Basse',
  sportModesHrHighLabel: 'Haute',
  sportModesPodsLabel: 'Capteurs externes',
  sportModesDisplaysLabel: 'Affichages',
  sportModesChangeBtn: 'Changer',
  sportModesPickerTitle: 'Choisir le type de champ',
  sportModesCloseBtn: 'Fermer',
  sportModesWriteSentNotConfirmed: 'Écriture envoyée mais non confirmée par relecture.',

  // SettingsScreen — À propos / mentions légales
  aboutSection: 'À propos',
  aboutVersion: (v: string) => `AmbitApp v${v}`,
  aboutDisclaimer:
    "AmbitApp est un projet personnel, indépendant et open source. Il n'est ni affilié à, " +
    "ni approuvé, ni sponsorisé par Suunto Oy ou Garmin Ltd. Suunto, Ambit, Traverse, " +
    "Garmin, eTrex, ainsi que tout autre nom de produit ou marque mentionné dans " +
    "l'application, sont des marques déposées ou non déposées de leurs détenteurs " +
    "respectifs (Suunto Oy et Garmin Ltd.) ; elles ne sont utilisées ici que pour décrire " +
    "la compatibilité avec ces appareils. Tous droits réservés à leurs propriétaires " +
    "respectifs.",
  aboutCreditsSection: 'Remerciements',
  aboutCreditsIntro:
    "Ce projet s'appuie sur le travail réel d'autres personnes, sans qui la " +
    "rétro-ingénierie des protocoles utilisés ici aurait pris bien plus de temps :",

  // Garmin — shared (v2.3 beta, updated v2.3.2)
  garminButton:      'GARMIN',
  garminWaitingForMount: (secondsLeft: number) =>
    `En attente du montage de l'appareil… (jusqu'à 40s, ${secondsLeft}s restantes)`,
  garminUnknownModel: 'Modèle inconnu',
  garminFirmwareLabel: 'firmware',
  garminSdCardPresent: 'Carte SD détectée',
  garminSdCardAbsent:  'Aucune carte SD détectée',
  garminInternalMemoryWarning:
    "⚠️ Par sécurité, cette fonction n'écrit JAMAIS sur la mémoire interne de l'appareil. " +
    "Une carte SD doit être présente ; le fichier sera envoyé uniquement sur celle-ci " +
    "(SDCARD\\Garmin\\GPX).",
  garminNoSdCardMsg: "Fonction indisponible : aucune carte SD détectée dans l'appareil.",

  // Home — inline activity sync for Garmin (v2.3.2 beta, no sub-screen — see
  // GarminActivityService.ts)
  homeGarminSyncReading: 'Lecture des activités…',
  homeGarminSyncWriting: (current: number, total: number) => `Import… (${current}/${total})`,
  homeGarminSyncDone: (count: number) =>
    count === 0
      ? 'Aucune nouvelle activité à importer.'
      : `${count} activité${count !== 1 ? 's' : ''} importée${count !== 1 ? 's' : ''}.`,

  // GarminRouteScreen (v2.3.2 beta)
  garminRouteScreenTitle: 'Routes Garmin',
  garminRouteSendSection: 'Envoyer une route',
  garminRouteSendDesc: 'Envoie un fichier GPX (route) sur la carte SD de l\'appareil.',
  garminRouteSendBtn:  'Choisir un fichier GPX',
  garminRouteSendDone: 'Fichier envoyé sur la carte SD.',
  garminRouteExportSection: 'Exporter les routes',
  garminRouteExportDesc:
    "Lit les fichiers GPX enregistrés sur l'appareil (mémoire interne et carte SD) et les " +
    "enregistre dans Téléchargements.",
  garminRouteExportBtn: 'Exporter',
  garminRouteExportDone: (count: number) =>
    count === 0 ? 'Aucun fichier de route trouvé.' : `${count} fichier${count !== 1 ? 's' : ''} exporté${count !== 1 ? 's' : ''}.`,
  garminShareBtn: 'Partager…',

  // GarminPoiScreen (v2.3.2 beta)
  garminPoiScreenTitle: 'POI Garmin',
  garminPoiSendSection: 'Envoyer un POI',
  garminPoiSendDesc: 'Envoie un fichier GPX (waypoints) sur la carte SD de l\'appareil.',
  garminPoiSendBtn:  'Choisir un fichier GPX',
  garminPoiSendDone: 'Fichier envoyé sur la carte SD.',
  garminPoiRetrieveSection: 'Récupérer les POI',
  garminPoiRetrieveDesc:
    "Lit les fichiers Waypoints (créés par Garmin BaseCamp) sur l'appareil (mémoire interne " +
    "et carte SD) et les enregistre dans Téléchargements.",
  garminPoiRetrieveBtn: 'Récupérer',
  garminPoiRetrieveDone: (count: number) =>
    count === 0 ? 'Aucun fichier de POI trouvé.' : `${count} fichier${count !== 1 ? 's' : ''} récupéré${count !== 1 ? 's' : ''}.`,

  // BackupScreen (v2.3.2 beta) — Ambit firmware backup
  backupButton:      'Backup',
  backupScreenTitle: 'Backup firmware',
  backupWarning:
    "⚠️ Sauvegarde uniquement : ce fichier ne peut PAS être réinstallé sur la montre depuis " +
    "cette app. Pour mettre à jour le firmware, utilisez l'app officielle Suunto ou SuuntoLink.",
  backupCheckSection: 'Vérifier le firmware disponible',
  backupCheckDesc: "Interroge les serveurs Suunto pour connaître la dernière version de firmware disponible pour votre montre.",
  backupCheckBtn:  'Vérifier',
  backupReading:   'Lecture des informations de la montre…',
  backupChecking:  'Vérification auprès de Suunto…',
  backupLatestVersion: (v: string) => `Dernière version disponible : ${v}`,
  backupUploadDate: (d: string) => `Publiée le ${d}`,
  backupNoUpdateInfo: 'Aucune information de firmware disponible pour ce modèle/cette version matérielle.',
  backupDownloadSection: 'Télécharger une sauvegarde',
  backupDownloadDesc:
    "Télécharge le fichier de firmware tel quel, sans le modifier ni le décoder. Vous " +
    "pourrez choisir où l'enregistrer (Téléchargements par défaut).",
  backupDownloadBtn: 'Télécharger',
  backupDownloading: (pct: number) => `Téléchargement… ${pct}%`,
  backupDownloadDone: 'Sauvegarde enregistrée.',
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

  // HomeScreen — connecting flow (v2.3.2 beta)
  homeSearchingTitle: 'Searching for your device, please wait…',
  homeConnectLaterBtn: 'Connect device later',
  homeNoDeviceTitle:
    'No device detected, please check your cable and device or use app without it.',
  homeConnectingAmbit: 'Connecting to watch…',
  homeConnectRetryBtn: 'Retry',
  homeBleConnectBtn: 'Pair via Bluetooth (experimental)',
  homeBleReadyTitle: 'Ready to pair',
  homeBleReadyMsg:
    "On the watch: menu \"Pair Mobile App\" (first pairing) or \"Sync now\" (already " +
    "paired) now — the watch's Bluetooth window only stays open for a few " +
    "seconds. Ambit3, Traverse, and Kailash, experimental.",
  homeBleReadyBtn: 'Ready',
  homeConnectingBle: 'Connecting via Bluetooth…',
  homeActivitiesBtn: 'ACTIVITIES',
  homeRoutesBtn:     'ROUTES',
  homePoisBtn:       'POIS',
  homeSyncActivitiesBtn: 'SYNC ACTIVITIES',
  homeBatteryLabel: 'battery',
  homeHwLabel:      'hardware',
  homeDeviceConnectedStatus: 'Connected',

  // Kailash travel history (2026-08-08)
  homeKailashTravelTitle:     'Travel History',
  homeKailashCitiesLabel:     'cities visited',
  homeKailashCountriesLabel:  'countries visited',
  homeKailashTravelledLabel:  'travelled',
  homeKailashFurthestLabel:   'furthest from home',
  homeKailashLogbookLabel:    'recorded sessions',
  homeKailashTrackTitle:      'GPS activity',
  homeKailashTrackPoints:     'GPS points',
  homeKailashTrackExport:     'Export track (GPX)',
  homeKailashExportDone:      'Track exported (%d points) to Downloads',
  homeKailashExportEmpty:     'No GPS track to export',

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
  shareFit:       '📤 Share FIT',
  saveFitDownloads: '💾 Save FIT to Downloads',
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

  intervalsSection:    'Intervals.icu',
  intervalsDesc:       'Connect your Intervals.icu account to import your activities there. Authenticated with a personal API key (no OAuth).',
  intervalsApiHint:    'Generate your API key at ',
  intervalsApiLink:    'intervals.icu → Settings → Developer Settings',
  athleteId:           'Athlete ID',
  athleteIdPlaceholder: 'e.g. i123456',
  emptyCreds:          'Missing fields',
  emptyCredsMsg:       'Enter your Intervals.icu athlete ID and API key.',
  credsSaved:          'Intervals.icu credentials saved.',
  credsDeleted:        'Intervals.icu credentials deleted.',
  credsStored:         'Credentials saved',

  uploadIntervals:     '📈 Upload to Intervals.icu',
  intervalsError:      'Intervals.icu Error',
  intervalsSuccess:    'Activity imported to Intervals.icu!',
  viewOnIntervals:     'View on Intervals.icu',
  noCreds:             'Missing credentials',
  noCredsMsg:          'Configure your Intervals.icu athlete ID and API key in Settings.',


  logListTitle:  'Activities',
  mapFallback:   'Track',
  settingsTitle: 'Settings',
  liveloxConnected: 'Connected! You can now export your activities.',
  oauthMissingCode: 'OAuth code missing in callback',

  // SettingsScreen — Appearance
  appearanceSection:  'Appearance',
  appearanceDesc:     'Choose light or dark, or follow your system setting.',
  themeLight:         'Light',
  themeDark:          'Dark',
  themeSystem:        'System',

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

  gpsUpdate:          'GPS',
  gpsDone:            'GPS OK',
  gpsDownloading:      'DL…',
  gpsIdle:            'GPS data',
  gpsDownloadingMsg:  'Downloading GPS data…',
  gpsDoneMsg:         'GPS data up to date',

  sendRoute:          'ROUTE',
  routeDone:          'SENT',
  routePicking:       'FILE…',
  routeParsing:       'READING…',
  routeIdle:          'Send a route',
  routePickingMsg:    'Choose a GPX file…',
  routeParsingMsg:    'Parsing the GPX…',
  routeWritingMsg:    'Writing to the watch…',
  routeDoneMsg: (name: string, points: number, waypoints: number) =>
    `"${name}" sent (${points} points, ${waypoints} waypoint${waypoints !== 1 ? 's' : ''})`,
  sendRouteConfirmTitle: 'Send a route',
  sendRouteConfirmMsg:
    "This will replace any route already on the watch. Your POIs are preserved " +
    "automatically. Note: this route isn't permanent — the next SuuntoLink sync, or " +
    "even just the Suunto phone app coming into Bluetooth range, will replace it. " +
    "This is for loading a route right before you go, not for permanent storage.",
  sendRouteConfirmBtn: 'Send',
  routeScreenTitle:   'Route',
  routeSendSection:   'Send a route',
  routeExportSection: 'Export from watch',
  routeExportDesc:    'Reads the routes and waypoints on the watch and saves them to a GPX file (Downloads).',
  routeExportBtn:     'Export from watch',
  routeExportReading: 'Reading navigation data…',
  navExportedTitle:   'Export complete',
  navExportedMsg: (routes: number, waypoints: number) =>
    `${routes} route${routes !== 1 ? 's' : ''}, ${waypoints} waypoint${waypoints !== 1 ? 's' : ''} saved to Downloads.`,

  // RouteScreen — Bluetooth (experimental, v0.3.0, Ambit3/Traverse only)
  bleExperimentalBadge: 'EXPERIMENTAL',
  bleExperimentalDisclaimer:
    'Bluetooth transfer is experimental and has not yet been verified on real hardware — use the cable ' +
    'if you can. Ambit3 and Traverse watches only. You\'ll need to trigger "Sync now" on the watch at ' +
    'the right moment (see the next prompt).',
  sendRouteBleBtn:    'Send (Bluetooth)',
  routeExportBleBtn:  'Export (Bluetooth)',
  bleScanning:        'Scanning for the watch…',
  bleConnecting:      'Connecting over Bluetooth…',
  bleSyncNowTitle:    'Ready to sync',
  bleSyncNowMsg:
    'On the watch, trigger "Sync now" NOW, then tap "Ready" below immediately — the watch\'s ' +
    'Bluetooth window only stays open for a few seconds.',
  bleSyncNowReady:    'Ready',

  // HomeScreen / PoiScreen
  poiButton:        'POI',
  poiScreenTitle:   'POI',
  poiImportSection: 'Import from GPX',
  poiImportDesc:    'Choose a GPX file: every <wpt> in it is sent as a POI, preserving any already on the watch.',
  poiExportSection: 'Export to GPX',
  poiExportDesc:    'Reads every POI on the watch and saves them to a GPX file (Downloads).',
  poiExportBtn:     'Export from watch',
  poiExportReading: 'Reading POIs…',
  poiExportedTitle: 'POIs exported',
  poiExportedMsg: (n: number) => `${n} POI${n !== 1 ? 's' : ''} saved to Downloads.`,

  // SettingsScreen — Add POI
  poiSection:    'Add POI',
  poiDesc:       'Sends a point of interest to the watch over cable, preserving any already there.',
  poiName:       'Name',
  poiNamePlaceholder: 'e.g. Summit',
  poiLat:        'Latitude',
  poiLon:        'Longitude',
  poiAddBtn:     'Send to watch',
  poiWriting:    'Sending POI…',
  poiInvalid:    'Invalid input',
  poiNameRequired: 'Enter a name for the POI.',
  poiCoordsInvalid: 'Invalid latitude/longitude (latitude -90 to 90, longitude -180 to 180).',
  poiAddedTitle: 'POI added',
  poiAddedMsg: (name: string) => `"${name}" was sent to the watch.`,
  poiImportBtn:     'Import from GPX',
  poiImportPicking: 'Choose a GPX file…',
  poiImportParsing: 'Parsing the GPX…',
  poiImportWriting: (done: number, total: number) => `Sending POIs… (${done}/${total})`,
  poiImportedTitle: 'POIs imported',
  poiImportedMsg: (n: number) => `${n} POI${n !== 1 ? 's' : ''} sent to the watch.`,

  // SettingsScreen — Ambit3 Settings (2026-08-08)
  ambitSettingsSection: 'Watch settings',
  kailashSettingsSection: 'Kailash Settings',
  ambitSettingsTitle: (name: string) => `${name} Settings`,
  ambitSettingsDesc:
    'Real watch settings (language, formats, brightness, etc.), read and written over ' +
    'USB cable - confirmed working against real hardware 2026-08-08.',
  ambitSettingsReadBtn: 'Read Settings',
  ambitSettingsRefreshBtn: 'Refresh',
  ambitSettingsReading: 'Reading settings...',

  // SportModesScreen — Ambit3 CustomModes (2026-08-08), Ambit3-only, not available on Kailash
  sportModesButton:      'SPORT MODES',
  sportModesScreenTitle: 'Sport Modes',
  sportModesDesc:
    'Edits the watch\'s real sport modes (names, autolap, HR limits, sensors, displays) ' +
    'over USB cable - the write mechanism is confirmed working on desktop, not yet ' +
    'hardware-confirmed via Android.',
  sportModesReadBtn: 'Read Sport Modes',
  sportModesReading: 'Reading sport modes...',
  sportModesRefreshBtn: 'Refresh',
  sportModesRenameBtn: 'Rename',
  sportModesExpandBtn: 'Details',
  sportModesCollapseBtn: 'Hide',
  sportModesAutolapLabel: 'Autolap (m)',
  sportModesSetBtn: 'Set',
  sportModesHrLimitsLabel: 'HR limits',
  sportModesHrLowLabel: 'Low',
  sportModesHrHighLabel: 'High',
  sportModesPodsLabel: 'External sensors',
  sportModesDisplaysLabel: 'Displays',
  sportModesChangeBtn: 'Change',
  sportModesPickerTitle: 'Choose field type',
  sportModesCloseBtn: 'Close',
  sportModesWriteSentNotConfirmed: 'Write sent but not confirmed by re-read.',

  // SettingsScreen — About / legal
  aboutSection: 'About',
  aboutVersion: (v: string) => `AmbitApp v${v}`,
  aboutDisclaimer:
    "AmbitApp is an independent, open-source personal project. It is not affiliated " +
    "with, endorsed by, or sponsored by Suunto Oy or Garmin Ltd. Suunto, Ambit, Traverse, " +
    "Garmin, eTrex, and any other product name or trademark referenced in this app are " +
    "registered or unregistered trademarks of their respective owners (Suunto Oy and " +
    "Garmin Ltd.), used here only to describe compatibility with those devices. All " +
    "rights reserved to their respective owners.",
  aboutCreditsSection: 'Credits',
  aboutCreditsIntro:
    "This project stands on real prior work by other people, without which the protocol " +
    "reverse-engineering behind it would have taken far longer:",

  // Garmin — shared (v2.3 beta, updated v2.3.2)
  garminButton:      'GARMIN',
  garminWaitingForMount: (secondsLeft: number) =>
    `Waiting for the device to finish mounting… (can take up to 40s, ${secondsLeft}s left)`,
  garminUnknownModel: 'Unknown model',
  garminFirmwareLabel: 'firmware',
  garminSdCardPresent: 'SD card detected',
  garminSdCardAbsent:  'No SD card detected',
  garminInternalMemoryWarning:
    '⚠️ For safety, this feature NEVER writes to the device\'s internal memory. An SD ' +
    'card must be present; the file will only be sent there (SDCARD\\Garmin\\GPX).',
  garminNoSdCardMsg: 'Feature unavailable: no SD card detected in the device.',

  // Home — inline activity sync for Garmin (v2.3.2 beta, no sub-screen — see
  // GarminActivityService.ts)
  homeGarminSyncReading: 'Reading activities…',
  homeGarminSyncWriting: (current: number, total: number) => `Importing… (${current}/${total})`,
  homeGarminSyncDone: (count: number) =>
    count === 0
      ? 'No new activities to import.'
      : `${count} activit${count !== 1 ? 'ies' : 'y'} imported.`,

  // GarminRouteScreen (v2.3.2 beta)
  garminRouteScreenTitle: 'Garmin routes',
  garminRouteSendSection: 'Send a route',
  garminRouteSendDesc: "Sends a GPX file (route) to the device's SD card.",
  garminRouteSendBtn:  'Choose a GPX file',
  garminRouteSendDone: 'File sent to the SD card.',
  garminRouteExportSection: 'Export routes',
  garminRouteExportDesc:
    'Reads GPX files saved on the device (internal memory and SD card) and saves them to Downloads.',
  garminRouteExportBtn: 'Export',
  garminRouteExportDone: (count: number) =>
    count === 0 ? 'No route files found.' : `${count} file${count !== 1 ? 's' : ''} exported.`,
  garminShareBtn: 'Share…',

  // GarminPoiScreen (v2.3.2 beta)
  garminPoiScreenTitle: 'Garmin POI',
  garminPoiSendSection: 'Send a POI',
  garminPoiSendDesc: "Sends a GPX file (waypoints) to the device's SD card.",
  garminPoiSendBtn:  'Choose a GPX file',
  garminPoiSendDone: 'File sent to the SD card.',
  garminPoiRetrieveSection: 'Retrieve POIs',
  garminPoiRetrieveDesc:
    'Reads Waypoints files (created by Garmin BaseCamp) off the device (internal memory ' +
    'and SD card) and saves them to Downloads.',
  garminPoiRetrieveBtn: 'Retrieve',
  garminPoiRetrieveDone: (count: number) =>
    count === 0 ? 'No POI files found.' : `${count} file${count !== 1 ? 's' : ''} retrieved.`,

  // BackupScreen (v2.3.2 beta) — Ambit firmware backup
  backupButton:      'Backup',
  backupScreenTitle: 'Firmware backup',
  backupWarning:
    "⚠️ Backup only: this file CANNOT be flashed back onto the watch from this app. " +
    "To update the firmware, use the official Suunto app or SuuntoLink.",
  backupCheckSection: 'Check available firmware',
  backupCheckDesc: "Asks Suunto's servers for the latest firmware version available for your watch.",
  backupCheckBtn:  'Check',
  backupReading:   'Reading watch info…',
  backupChecking:  'Checking with Suunto…',
  backupLatestVersion: (v: string) => `Latest available version: ${v}`,
  backupUploadDate: (d: string) => `Released ${d}`,
  backupNoUpdateInfo: 'No firmware info available for this model/hardware version.',
  backupDownloadSection: 'Download a backup',
  backupDownloadDesc:
    "Downloads the firmware file as-is, without modifying or decoding it. You'll be asked " +
    "where to save it (Downloads by default).",
  backupDownloadBtn: 'Download',
  backupDownloading: (pct: number) => `Downloading… ${pct}%`,
  backupDownloadDone: 'Backup saved.',
};

// Forced to English regardless of device locale (was `isFrench ? fr : en`,
// which picked French because the device's system locale resolves to fr-*).
// Revert to `isFrench ? fr : en` to restore automatic locale detection.
export const t = en;
