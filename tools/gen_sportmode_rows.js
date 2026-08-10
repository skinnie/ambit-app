#!/usr/bin/env node
/**
 * Generate assets/sportmode_rows.json - the catalogue behind the sport-mode row editor.
 *
 * WHY THIS EXISTS. Which values you may put on a display row is not something we get to
 * decide, and it is not derivable from the captures either: a capture only shows what Andre
 * happened to pick, never the full menu he picked from. SuuntoLink already knows the whole
 * answer, keyed by watch variant, display type, which row, and the sport mode's activity -
 * so we ask IT instead of guessing, the same way assets/activity_types.json is generated
 * rather than hand-written.
 *
 * HOW. SuuntoLink 4.1.15's own `ambit/sport_mode.js` is required directly out of the
 * unpacked install in assets/. Two things stand in its way and both get stubbed here:
 * `electron` (absent outside the app) and `localization` (needs a DOM through jQuery). The
 * localization stub returns each translation KEY unchanged, which we then resolve against
 * SuuntoLink's own translations/en.json - so every label in the output is Suunto's, not ours.
 *
 * Nothing here is invented. Every id, grouping, order and label comes out of that module.
 *
 *   node tools/gen_sportmode_rows.js            # writes assets/sportmode_rows.json
 *   node tools/gen_sportmode_rows.js --check    # exit 1 if the file is stale, write nothing
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const LINK = path.join(REPO, 'assets', 'WIndows apps', 'Suuntolink', 'suuntoapp_local');
const OUT = path.join(REPO, 'assets', 'sportmode_rows.json');

// The watch this project targets. 'Emu' is AMBIT3_P in SuuntoLink's own Variant table, and
// is exactly the codename our tools already use for the Ambit3 Peak.
const VARIANT = 'Emu';

function stubElectron() {
  const shim = path.join(REPO, 'tools', '.node_shim', 'node_modules', 'electron');
  fs.mkdirSync(shim, { recursive: true });
  fs.writeFileSync(path.join(shim, 'index.js'),
    'const os=require("os"),p=require("path"),n=()=>{};\n' +
    'module.exports={app:{getPath:()=>p.join(os.tmpdir(),"suuntolink-shim"),' +
    'getLocale:()=>"en-US",getName:()=>"SuuntoLink",getVersion:()=>"4.1.15",on:n},' +
    'ipcRenderer:{on:n,send:n,invoke:async()=>undefined},ipcMain:{on:n,handle:n},' +
    'shell:{openExternal:n}};\n');
  process.env.NODE_PATH = path.join(REPO, 'tools', '.node_shim', 'node_modules') +
    path.delimiter + (process.env.NODE_PATH || '');
  require('module').Module._initPaths();
}

function stubLocalization() {
  // Return the key itself so getRowDescription() hands us something we can resolve against
  // en.json ourselves. Loading the real one drags in jQuery, which needs a browser DOM.
  const p = require.resolve(path.join(LINK, 'localization.js'));
  require.cache[p] = {
    id: p, filename: p, loaded: true, exports: {
      value: k => k, help: k => k, currentLanguage: () => 'en',
      setup: () => {}, changeLanguage: () => {}, asBcp47: () => 'en-US',
      languageCode: () => 'en', httpLanguageCode: () => 'en',
      availableLanguages: () => ['en'],
    },
  };
}

function main() {
  if (!fs.existsSync(LINK)) {
    console.error(`SuuntoLink install not found at:\n  ${LINK}`);
    process.exit(2);
  }
  stubElectron();
  stubLocalization();

  const sm = require(path.join(LINK, 'ambit', 'sport_mode.js'));
  const en = require(path.join(LINK, 'translations', 'en.json'));
  const text = key => {
    const v = en[key];
    if (v === undefined) return null;
    return typeof v === 'object' ? v.string : (typeof v === 'string' ? v : null);
  };
  const label = (key, what) => {
    const s = text(key);
    if (s === null) throw new Error(`no English text for ${what} key ${key}`);
    return s;
  };

  // --- every row value SuuntoLink knows, with its own label and wire triple -------------
  const rowIds = Object.keys(sm.DisplayRow)
    .filter(k => !Number.isNaN(Number(k))).map(Number).sort((a, b) => a - b);
  const rows = {};
  for (const id of rowIds) {
    rows[id] = {
      name: sm.DisplayRow[id],
      label: label(sm.getRowDescription(id), `row ${id}`),
      // What actually gets serialised for this row. The wire's numeric field Type is
      // derived from this triple, NOT from the id above - SuuntoLink's DisplayRow numbering
      // is its own UI enum and does not match the watch's field ids.
      rowData: sm.createRowDataFromString(sm.DisplayRow[id]),
    };
  }

  const categories = {};
  for (const [k, v] of Object.entries(sm.DisplayRowCategory)) {
    if (Number.isNaN(Number(k))) continue;
    categories[k] = { name: v, label: label(sm.getRowCategoryDescription(Number(k)),
                                            `category ${k}`) };
  }

  // --- which of them are offered, per activity / display type / row --------------------
  // Keyed by activity because SuuntoLink filters the menu by the mode's sport: a swimming
  // mode is not offered cycling power. Identical menus are shared by reference in the JSON
  // via a table of unique groupings, since most activities repeat the same few sets.
  const activities = JSON.parse(
    fs.readFileSync(path.join(REPO, 'assets', 'activity_types.json'), 'utf8'));
  const activityIds = (Array.isArray(activities) ? activities : activities.activities)
    .map(a => a.id).sort((a, b) => a - b);

  const menus = [];                       // unique [[catId, [rowId...]], ...] groupings
  const menuIndex = new Map();            // serialised grouping -> index into `menus`
  const intern = grouping => {
    const key = JSON.stringify(grouping);
    if (!menuIndex.has(key)) { menuIndex.set(key, menus.length); menus.push(grouping); }
    return menuIndex.get(key);
  };

  const availability = {};
  for (const activityId of activityIds) {
    const perType = {};
    for (const [typeName, type] of Object.entries(sm.DisplayType)) {
      const perRow = {};
      for (const [rowName, rowId] of Object.entries(sm.FieldId)) {
        let menu;
        try {
          menu = sm.getDisplayRows(VARIANT, type, rowId, activityId);
        } catch (e) {
          continue;                        // this row does not exist for this display type
        }
        if (!menu || menu.size === 0) continue;
        perRow[rowName] = intern([...menu].map(([cat, ids]) => [cat, ids]));
      }
      if (Object.keys(perRow).length) perType[typeName] = perRow;
    }
    availability[activityId] = perType;
  }

  const out = {
    _comment: 'GENERATED by tools/gen_sportmode_rows.js from SuuntoLink 4.1.15 - do not ' +
              'edit by hand. Every id, order and label here is SuuntoLink\'s own.',
    source: 'assets/WIndows apps/Suuntolink/suuntoapp_local (SuuntoLink 4.1.15)',
    variant: VARIANT,
    limits: {
      maxDisplays: sm.getMaxDisplays(VARIANT),
      maxSuuntoApps: sm.getMaxSuuntoApps(VARIANT),
      // The bottom row of a 2-field or graph display is multi-value: the watch cycles
      // between the chosen values on a button press. SuuntoLink's editor caps the
      // checkbox selection at 5 (sport_mode_display_editor.js).
      maxValuesPerMultiRow: 5,
    },
    displayTypes: sm.DisplayType,
    fieldIds: sm.FieldId,
    categories,
    rows,
    menus,
    availability,
  };

  const json = JSON.stringify(out, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    const same = fs.existsSync(OUT) && fs.readFileSync(OUT, 'utf8') === json;
    console.log(same ? 'assets/sportmode_rows.json is up to date'
                     : 'assets/sportmode_rows.json is STALE - re-run without --check');
    process.exit(same ? 0 : 1);
  }
  fs.writeFileSync(OUT, json);
  console.log(`wrote ${path.relative(REPO, OUT)}: ${Object.keys(rows).length} rows, ` +
              `${Object.keys(categories).length} categories, ${menus.length} distinct menus, ` +
              `${activityIds.length} activities`);
}

main();
