import { MapProvider } from './MapProviderService';

// Real, 2026-08-09 ("I would prefer an immediate map view on this side") - a single static
// XYZ tile image per route/POI thumbnail (rendered via a plain RN <Image>, not a WebView).
// TrackPreview.tsx's own earlier header comment explains the real constraint this works
// around: N simultaneous live WebView+Leaflet instances in a list is the same
// hardware-confirmed crash risk desktop's own ActivitiesPage.qml documents for N live map
// widgets. Desktop's RoutesPage.qml/PoisPage.qml sidestep that by using MapView.qml, a
// cheap in-process tile renderer with no browser engine involved - this is the RN
// equivalent of "cheap enough not to need virtualization": one small cached image request
// per thumbnail, the same real cost as any photo grid, not a browser instance.

const TILE_SIZE = 256;

export function tileUrl(provider: MapProvider, z: number, x: number, y: number): string {
  switch (provider) {
    case 'ign':
      return 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
        `&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png` +
        `&TILEMATRIXSET=PM&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}`;
    case 'osm':
      return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
    case 'cyclosm':
    default:
      return `https://a.tile-cyclosm.openstreetmap.fr/cyclosm/${z}/${x}/${y}.png`;
  }
}

// Fractional (sub-tile-precision) Web Mercator tile coordinates - the same real formula
// every slippy map uses (MapView.qml's own header comment calls it "the same formula every
// slippy map uses"; IGN's WMTS TILEMATRIXSET=PM is the same Pseudo-Mercator XYZ scheme, see
// MapHtml.ts).
function latLonToTileFrac(lat: number, lon: number, z: number): { x: number; y: number } {
  const latRad = (lat * Math.PI) / 180;
  const n = 2 ** z;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  };
}

export interface FitTile {
  z: number;
  x: number;
  y: number;
  // Real lat/lon -> pixel coordinates in [0, TILE_SIZE] within this exact tile.
  project: (lat: number, lon: number) => { px: number; py: number };
}

function tileAt(tx: number, ty: number, z: number): FitTile {
  return {
    z, x: tx, y: ty,
    project: (lat, lon) => {
      const f = latLonToTileFrac(lat, lon, z);
      return { px: (f.x - tx) * TILE_SIZE, py: (f.y - ty) * TILE_SIZE };
    },
  };
}

// Highest zoom (most detail) at which every one of `points` still falls inside the SAME
// single 256px tile - one image request is enough, no stitching. z=0 (the whole world as
// one tile) always satisfies this, so the search never fails to find something.
export function bestSingleTile(points: { lat: number; lon: number }[], maxZoom = 16): FitTile {
  for (let z = maxZoom; z >= 0; z--) {
    const fracs = points.map(p => latLonToTileFrac(p.lat, p.lon, z));
    const tx = Math.floor(fracs[0].x);
    const ty = Math.floor(fracs[0].y);
    if (fracs.every(f => Math.floor(f.x) === tx && Math.floor(f.y) === ty)) {
      return tileAt(tx, ty, z);
    }
  }
  const f0 = latLonToTileFrac(points[0].lat, points[0].lon, 0);
  return tileAt(Math.floor(f0.x), Math.floor(f0.y), 0);
}

export { TILE_SIZE };
