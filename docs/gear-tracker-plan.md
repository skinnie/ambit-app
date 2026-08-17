# Gear tracker (v3) — implementation plan

Front-end to intervals.icu's gear model: bikes/shoes → components (parts) → maintenance
reminders, plus auto-assigning the right gear to each Ambit move on sync.

## Design decisions (André, 2026-08-17)
1. **Storage** — local-first SQLite gear DB, mirrored two-way to intervals.icu. Any divergence
   between local and remote **stops and asks the user** which to keep; it never auto-merges a
   genuine conflict.
2. **v1 scope** — gear/parts/reminders manager + auto-assign the default bike/shoes to each
   Ambit move as it syncs (per sport type), so part distances stay accurate hands-free.
3. **Platform** — Android (React Native/TS) and desktop (Qt/QML/C++) in lockstep.

## Schema corrected against live GET /gear (2026-08-17)
The first Android pass targeted the athlete-summary shape and was WRONG. Corrected to the real
`/gear` schema (docs/reference/intervals-gear-schema.md): free-form `type`, parent→child via
`component_ids` (no parentId), reminders with distance/time/days/activities + server
`percent_used`, and no `primary` in /gear (kept as a local-only flag). All gear files + the diff
test updated; 40/40 green, type-clean.

## Pivot: import-first, aim to ditch intervals.icu (André, 2026-08-18)
"First we get the info FROM intervals.icu, then we'll see — the aim is also to ditch intervals in
the future." So the local-first store becomes the eventual source of truth; intervals.icu is an
import source we can later drop.
- Added `importFromIntervals()` (GearMirrorService) — **pull-only**: brings gear + components +
  reminders down, remote as source, NO pushes/deletes. This is now the PRIMARY action in
  GearScreen ("Import from Intervals.icu"); two-way sync is demoted to a secondary ghost button.
- Extracted the pure model/normalisers to `GearRemoteModel.ts` (no RN deps) so the import parse
  is unit-tested: `GearRemoteModel.test.ts` parses a real-API-shaped fixture (parent/child from
  component_ids, reminder units, retired-null→false, meters). 45/45 green.
- Desktop D1-b (activity upload) is DEFERRED under "then we'll see" — not the current priority.

### Independence step DONE (2026-08-18) — local gear-distance tally
Data reality found via live activities GET: the flat `gear_id` is null on ALL activities; the
assignment hides in an embedded `gear` object using the `b…` id namespace (disjoint from the
numeric `/gear` ids), and 88/224 activities have none. Reconstructing history from that is lossy
and would disagree with intervals' own totals. `/gear` already gives the AUTHORITATIVE lifetime
total (Carrera Scatto = 50 165 km, counts Strava rides the activity API doesn't expose).
So the tally is **baseline snapshot + local forward-count**, not history reconstruction:
- displayed gear distance = imported baseline (gear.distance_m at import) + sum of local ledger
  entries recorded AFTER import (assigned_at > gear.last_synced_at) — no double-count.
- `activity_gear` is now the local usage ledger (distance_m/time_s/date per synced move);
  SyncService attributes every synced move to its default-gear via `attributeMoveToGear`.
- `GearAutoAssign` split: `pushGearToIntervals` (upload tag) vs `attributeMoveToGear` (local ledger).
- Pure `GearTotals.computeGearTotals` + `GearTotals.test.ts`. GearScreen shows the tally with a
  "↑ N km tracked here" marker for locally-counted additions.

### Local reminder due-ness DONE (2026-08-18) — last independence gap closed
Reminder due-ness now computed LOCALLY, no longer from intervals' `percent_used`:
- captured the reset-baseline (`starting_distance`/`starting_time`/`starting_activities`/
  `last_reset`) on the reminder model, DB, and pull mapping.
- `GearTotals.reminderPercentUsed(reminder, gearNow, now)` = (gear total − starting)/interval,
  max across distance/time/days/activities units; distance/time exact, activities approximated by
  local added count. Snoozed reminders don't read as due until the snooze lapses.
- create/reset seed the baseline from the gear's current tracked total (`gearTotalNow`), and push
  the reset to intervals too.
- GearScreen `dueState` uses the local calc. 55/55 tests green, type-clean.

**Android gear tracker is now fully capable of standing alone from intervals.icu:** import
gear/parts/reminders, own them locally, tally distance from watch syncs, and compute reminder
due-ness locally. intervals.icu is now just an optional import source.

## Manual per-activity gear picker DONE (2026-08-18, Android)
`components/GearPicker.tsx` — bottom-sheet from MapScreen's export menu ("Gear used"): pick a
bike/shoe for THIS move (overrides the sport default) or clear it. Writes the local ledger
(recordActivityGear, keyed by activity id, idempotent) so the distance tally reflects the real
choice. gearDb: getActivityGear + clearActivityGear. Local-first (no intervals push here).
55/55 tests green, type-clean.

## Desktop port DONE — import + display (2026-08-18)
Parity with the Android import-first direction, built in the desktop's own idioms:
- `desktop/src/services/gearservice.{h,cpp}` — QML_SINGLETON. `importFromIntervals()` GETs
  /gear (QNetworkAccessManager, Basic auth; creds read straight from QSettings
  connections/intervals_icu/* like the app's own guidance says), stores into a local SQLite
  gear.db (gear + gear_reminder), exposes `gears` QVariantList. Parent/child rebuilt from
  `component_ids`; reminder due-ness computed LOCALLY (reminderPercent, same formula as TS).
- `desktop/qml/pages/GearPage.qml` — bikes/shoes → parts → reminders with due/soon coloring +
  an Import button; nav entry (NavRail "Gear", Icons.gear=directions_bike) + Main.qml route +
  CMake source/QML_FILES registration.
- Desktop v1 is import+display (read); two-way edit / manual picker / local tally follow the
  Android lead when wanted.

## Home maintenance-due summary DONE (2026-08-18, both platforms)
Surfaces due/soon service reminders on Home so they nag where the user looks.
- Pure `GearTotals.collectGearAlerts` (due >=100%, soon >=90%, snoozed excluded, most-worn first)
  + 2 tests. Android `services/GearAlerts.ts` assembles from the local store; HomeScreen shows a
  tappable banner (→ Gear) with `gearDueCount`/`gearSoonCount` i18n. 57/57 tests green, type-clean.
- Desktop: `GearService` exposes `dueCount`/`soonCount` (counted in loadFromDb); HomePage.qml's
  gear-alert banner (added in a parallel session) consumes them and navigates via NavBus. Built ✓.

## Desktop editing parity (2026-08-18) — write-through
Desktop gear is now a real MANAGER, not read-only. Edits are write-through (push to intervals.icu,
then re-import), which gives full edit without porting the conflict engine to C++.
- `GearService` Q_INVOKABLEs: addGear, addComponent (POST part → PUT parent component_ids),
  renameGear, setRetired, removeGear, addReminder, removeReminder. Shared `send(verb,path,body,onOk)`
  helper (import refactored onto it). Stores component_ids + exposes reminder id for edits.
- `GearPage.qml`: Add bike/shoes buttons; per-gear Rename/Retire/Add part/Add reminder/Delete;
  per-part Add reminder/Delete; per-reminder ×; name + reminder + delete-confirm dialogs.
- Built ✓ (exit 0, GearPage recompiled by qmlcache, binary relinked).
## Desktop tally + picker DONE (2026-08-18) — D2-c then D2-a (André)
D2-c (decode): the raw byte IS the Suunto activity id (exercise_log.py `activity_type=c.u8()`,
verified vs Suunto's manual), so it decodes via the existing `ActivityTypes.byId[raw].name` — no
RE, the activityservice.h "never decoded" note was only about icon-picking. D2-a (tally+picker):
- `GearService`: gear_assignment (sport→gearId) + activity_gear (activity_key→gear+distance)
  tables; `assignments` QVariantMap prop; setAssignment / defaultGearForSport / attributeActivity /
  clearActivity / activityGearId; gears model now carries baselineKm + addedKm + distanceKm
  (baseline+added).
- `GearPage.qml`: gear cards show "(+N here)" for locally-tracked km; a "Default gear per sport"
  section (ComboBox per sport, decoded names).
- `ActivityDetail.qml`: Overview tab "Gear used" ComboBox — key = activity.startTime, pre-selects
  the current pick or the sport default (sport decoded from sportTypeRaw via ActivityTypes),
  writes attributeActivity(distanceMeters,durationSeconds). Rebuild in flight.

**Desktop now at full Android parity** (import/own/due-ness/Home-alert/edit/tally/manual-picker),
except two-way conflict prompts (desktop uses write-through instead).

## Desktop direction: D1-b (André, 2026-08-17) — deferred, see pivot above
Build desktop **activity-upload to intervals.icu FIRST** (C++ service via QNetworkAccessManager,
key from ConnectionsService, wire ActivityDetail.qml's Upload tab), THEN the desktop gear feature
(manager + mirror + auto-assign) on top. Intervals.icu is fully two-way, so a later step can also
RETRIEVE activities/streams from it, not just upload.

## intervals.icu gear API (verified 2026-08-17)
- `GET/POST/PUT/DELETE /athlete/{id}/gear` — gear AND components (a part = child gear w/ parentId)
- `POST /gear/{id}/reminder`, `PUT/DELETE .../reminder/{rid}` — reminders (distance/time/date,
  `snoozeDays`, `reset`)
- `POST /gear/{id}/replace` — retire a worn part, spin up a fresh copy keeping its reminders
- `GET /gear/{id}/calc` — recalc stats
- Auth: HTTP Basic `API_KEY:<key>` (same as activity upload).
- Core gear shape confirmed from athlete payload: `{id,name,distance,primary}`; fuller `/gear`
  object (type/retired/time/parentId/reminders) + reminder field names to be confirmed against a
  live `GET /gear` before first real mirror.

## Build order
- [x] Plan doc
- [x] A. Android `ApiIntervalsIcuGear.ts` — typed gear+reminder CRUD client (+ setActivityGear)
- [x] B. Android gear DB (tables: gear, gear_reminder, gear_assignment, activity_gear) in db.ts
      + `gearDb.ts` data-access layer
- [x] C. Android `GearMirrorService.ts` — pull/diff/conflict-detect/apply/push + conflict resolver
- [x] D. `GearDiff.ts` pure engine + `GearDiff.test.ts` (10 tests, all green)
- [x] E. Android `GearScreen.tsx` + Home tile + nav registration (App.tsx) + i18n (fr/en)
- [x] F. Auto-assign wired into the intervals.icu upload (MapScreen `handleUploadIntervals`
      → `GearAutoAssign.autoAssignGear`)
- [~] G. Desktop Qt parity — see divergence below

Android status: type-clean (only the pre-existing project-wide untyped `btoa` global), full
jest suite 40/40 green.

## Desktop divergence (found 2026-08-17)
The desktop app does **not upload activities to intervals.icu yet** — ActivityDetail.qml's Upload
tab is an honest "not built yet" placeholder and connectionsservice stores the key but wires it
to nothing. So on desktop:
- the gear **manager + two-way mirror** CAN be built now (needs only the intervals key +
  QNetworkAccessManager), but
- **auto-assign has no upload path to hook into** until desktop gains activity upload.
Decision needed from André (🟣 D1): build the desktop gear manager now and defer desktop
auto-assign until desktop activity-upload exists, or build desktop activity-upload first.

## Verification still owed (needs André / hardware)
- 🟡 Confirm exact `/gear` + reminder JSON field names against a live `GET /gear` before the
  first real mirror (client reads leniently, but writes should match). Run with your key.
- 🟡 Real round-trip test (create/edit/mirror/conflict/auto-assign) against your intervals.icu
  account — no key is stored on this machine, so it couldn't be tested live here.

## Conflict rule
Track `last_synced_at` per row. On mirror: pull remote, compare to local.
- remote-only → add locally; local-only (never pushed) → create remote.
- differs but only ONE side changed since `last_synced_at` → auto-apply that side.
- differs AND both changed → CONFLICT → surface to UI resolver (keep-local / keep-remote).
