import { MapProvider, MAP_PROVIDER_LABELS } from './MapProviderService';

// Shared by MapScreen.tsx (activity replay map) and TrackMapScreen.tsx (route/POI
// preview map) - both real Leaflet WebViews, same three tile hosts/attribution text as
// desktop's own qml/MapService.qml (plus IGN, Android-only - see MapProviderService.ts's
// header comment). Pulled out so both screens share one real tile/provider-switcher
// implementation instead of two copies drifting apart.
//
// collapsed:false - real, 2026-08-09 ("no button to change provider") - Leaflet's default
// collapsed layer control is a small, easy-to-miss icon in the corner; expanded makes it a
// real, obviously-tappable set of buttons, closer to what "a button to change provider"
// actually asked for than the control that was already technically there.
//
// baselayerchange -> postMessage: mirrors desktop's own MapService.provider = "..." write
// on click (SettingsPage.qml) - switching the provider from inside the map itself also
// persists as the new default, not just a one-time in-session override.
export function mapTileLayersJs(defaultProvider: MapProvider): string {
  return `
  var ign = L.tileLayer(
    'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
    '&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png' +
    '&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
    { maxZoom: 18, attribution: '© IGN Géoplateforme' }
  );
  var osm = L.tileLayer(
    'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxZoom: 19, attribution: '© OpenStreetMap contributors' }
  );
  var cyclosm = L.tileLayer(
    'https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
    { maxZoom: 20, attribution: '© OpenStreetMap contributors, CyclOSM' }
  );
  var _layers = { ign: ign, osm: osm, cyclosm: cyclosm };
  (_layers['${defaultProvider}'] || ign).addTo(map);
  L.control.layers({
    '${MAP_PROVIDER_LABELS.ign}': ign,
    '${MAP_PROVIDER_LABELS.osm}': osm,
    '${MAP_PROVIDER_LABELS.cyclosm}': cyclosm,
  }, null, { position: 'topright', collapsed: false }).addTo(map);
  var _layerNameToKey = {
    '${MAP_PROVIDER_LABELS.ign}': 'ign',
    '${MAP_PROVIDER_LABELS.osm}': 'osm',
    '${MAP_PROVIDER_LABELS.cyclosm}': 'cyclosm',
  };
  map.on('baselayerchange', function(e) {
    var key = _layerNameToKey[e.name];
    if (key && window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'MAP_PROVIDER_CHANGE', provider: key }));
    }
  });
  `;
}
