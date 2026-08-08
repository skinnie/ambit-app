# Steps / daily activity: retrieving from the Ambit3 and syncing to intervals.icu

Researched 2026-08-05. Off-topic from the core route/POI reverse-engineering, kept as its own
note rather than folded into `HANDOFF_ANDRE.md`. Prompted by a real regression: during the
Movescount -> Suunto app transition, daily step/activity sync for the Ambit3 broke and was
never restored.

## Where the old feature lived

The Movescount Android app (`assets/APK/movescountapp/sources/com/suunto/movescount/
activitytrend/`) has a full local caching layer for this:
`CachedDailyActivityModel.java` stores per-device, per-hour `Steps` and `Energy` values,
30 days of history, with merge/garbage-collection logic (`mergeSteps`, `mergeEnergy`,
`carbageCollect`). This is the client-side cache, not the device-read code - it's evidence
the feature was real and reasonably built out, not a proof of the wire format.

## Confirmed: the watch itself stores this, and it's reachable with tooling this project already has

The Ambit3's own SBEM0102 schema dictionary (`assets/descr+<SERIAL>+2.4.17`, already used
throughout this project via `tools/sbem_schema.py`) documents it directly:

```
0x96  QUERY  sml.DeviceHistory.Histories.History.ActivityTracking
        +DailyRecovery, +DailyActivity, +WeeklyActivity, +TotalWeeklyActivity   (uint16, kcal-scaled, <MOD>4184*x)
0x12f QUERY  sml.DeviceHistory.Histories.History.ActivitySummary.LastDays.Steps
        +Value   (uint32)
```

Both are marked as independently queryable objects, the same category as `sml.DeviceLogBook`
(`0x8d`), which `write_nav.py` already queries via `CMD_LOG_HEADERS` (`0x1200`).

**Live-tested, read-only, safe:** sent a `0x1200` request for object `0x96` using the exact
same request shape `write_nav.py`'s `LOGBOOK_REQUEST` already uses for `0x8d`
(`[00000000][u16 count=1][u16 len][SBEM0102][entry_id][len]`), just swapping the entry ID.
**It worked on the first try** - real, correctly-decoded data came back from a part of the
watch this project has never touched before, and each returned entry maps 1:1 onto the four
`ActivityTracking` sub-fields, confirmed against the schema's own ordering (`0x8e/0x92`,
`0x8f/0x93`, `0x90/0x94`, `0x91/0x95`):

```
entry 0x92 [20 bytes] = DailyRecovery       (all zero; likely a multi-value array, not yet decoded further)
entry 0x93 [2 bytes]  = DailyActivity   = 0x0000 = 0     (<MOD>4184*x -> 0 kcal)
entry 0x94 [4 bytes]  = WeeklyActivity  = 0x00000000 = 0 (<MOD>4184*x -> 0 kcal)
entry 0x95 [2 bytes]  = TotalWeeklyActivity = 0x064f = 1615 (<MOD>4184*x -> ~1615 kcal, plausible)
```

**Important: `DailyActivity` here (`0x8f`/entry `0x93`) is fully solved and needs no further
work at all** - it fits the ordinary single-byte ID scheme (no encoding mystery, unlike
`0x12f` below), and this test already read it live, successfully. It happened to read `0`,
which is a real decoded value (this reference watch may see little real-world wear), not a
failure. **Do not confuse this field with `TimelinePart.Samples.Sample.Events.DailyActivity.Sum`
(`0x120`)** - a same-named but structurally different, per-move-embedded field discussed
further down; that one is not this one, and figuring that out cost real time below.

## What's still open: literal step COUNTS specifically - dug into thoroughly, 2026-08-05

To be precise about scope, since "DailyActivity" above resolves the *energy* half: the only
literal `Steps` field anywhere in the schema is `ActivitySummary.LastDays.Steps` (`0x12f`).
Everything below is about that field specifically, not about `DailyActivity` (solved above).

`0x96` (150 decimal) fits in the single-byte entry-ID scheme the existing `0x1200` request
format uses. `0x12f` (303 decimal) does not - it needs some kind of extended encoding. Two
quick live guesses didn't land (truncating to the low byte got a real but unrelated response;
a naive 2-byte little-endian extension got the identical wrong response, meaning the guess was
wrong, not merely unlucky). Rather than keep guessing against the live watch, spent real time
tracing `libkomposti-ng.so.c` (49 MB decompile) - here's the full trace, including the dead
ends, since they're worth not re-walking next time.

**Dead ends, ruled out concretely:**
- `Komposti::MobileService::TransferSteps` - a red herring. It's JSON string-key constants
  (`"Steps"`, `"Energy"`, `"Timestamp"`) for an internal SDS event layer, alongside `"suunto"`,
  `"sds"`, `"eventlistener"` - nothing to do with pedometer counts.
- `TimelineSQLService::DailyActivityEvent` - a local SQLite caching layer (`getTable()` just
  looks up a cached table by name), the C++ desktop equivalent of the Android app's
  `CachedDailyActivityModel.java`. Not the wire code.
- `sml.DeviceHistory` string-path builders (multiple call sites, e.g. line ~783221) - real code,
  but for a completely different purpose: building outgoing SML/XML documents (`<xmlattr>`
  namespace attributes, `LongestDive.Time`, `DeepestDive.Depth`) for **cloud upload of a dive
  computer's** move-history summary. This shared SDK covers Suunto's whole product line, and
  this particular thread belongs to a different device family entirely.

**The real transport layer, found and confirmed to match this project's own tooling exactly:**
`Task::NSP::PathGet` (`Task::NSP::PathBaseTask` base class). Its constructor:
`NspCommandTask::NspCommandTask(this, 0x12, 0, device)` - NSP message ID **`0x12`**, sub-ID
**`0`**. `(0x12 << 8) | 0x00 = 0x1200` - exactly `write_nav.py`'s `CMD_LOG_HEADERS`. Its
`preparePacket()` builds the outgoing body as: `[4 bytes from a member field][u16 = 1][u16 =
length of "path"][the "path" bytes themselves]` - byte-for-byte the same envelope shape as
`LOGBOOK_REQUEST` (`[00000000][u16 count=1][u16 len][SBEM0102 magic][entry_id][len]`). So the
architecture this project already independently reverse-engineered is confirmed correct at the
source level, not just by working captures.

Two constructors exist: one takes raw bytes directly (a pre-built blob, presumably built
elsewhere the same way this project's own Python code builds it), one takes a plain
`std::string` and copies its raw characters into the same "path" field with **no visible
conversion** - meaning `PathGet` itself doesn't care what's in "path"; whatever built the blob
for a *known-working* query (like `0x96`) did so somewhere else, not in this class.

**The actual conclusive finding: that "somewhere else" doesn't exist in this library for this
object.** `grep -c "ActivitySummary"` → **0** hits, anywhere, in any form. `grep -c
"SBEM0102"` (the literal magic string) → **0** hits too - the byte sequence isn't built from a
readable string literal anywhere in this binary. Compare to `"TimelinePart"`, which *does*
appear (80 hits) but exclusively in a completely different context - loading/saving downloaded
move files to local cache (`loadTimelinePartFromFile`, `saveTimelinePartInFile`), not a live
device query for `DeviceHistory.Histories.History.ActivitySummary.LastDays.Steps`.

**Conclusion: this specific schema entry was never queried by this generation of code at
all.** The most likely explanation: `DeviceHistory.ActivitySummary.LastDays.Steps` (and
probably `TimelinePart` as a live NSP query, ID `0x12c`, also >0xFF) is a firmware/protocol
addition from *after* this Movescount-era library was built - daily-activity/step tracking
became a much bigger feature in Suunto's later app generations. The code that actually knows
how to query it almost certainly lives in `libmds.so`, the modern Suunto app's native library -
already flagged elsewhere in this project (`HANDOFF.md`'s BLE section) as a
"symbol-bearing descendant of `libkomposti-ng.so`," not currently in this project's assets.

**Next step, when picked back up:** either get `libmds.so` decompiled/symbol-dumped (same
target already identified for the unrelated BLE login-token question - `nm -D
--defined-only libmds.so | c++filt`), or get a live USB/HCI capture of the *current* Suunto
app or SuuntoLink actually requesting daily activity data - either would show the real ID
encoding directly instead of requiring more decompile archaeology in a library that, as now
established, doesn't contain this code path at all.

**Checked Moveslink2 too, 2026-08-05 - same absence, on a second independent binary.**
André asked whether this watch simply never having synced with the Movescount *app*
specifically could explain the absence, and whether Moveslink2 (the separate Windows desktop
client, `assets/WIndows apps/moveslink2/`) might have its own implementation worth checking -
not yet looked at until now. It's a genuinely different app from the Android one: `Moveslink2.exe`
is a Mono/.NET assembly (a thin GUI shell - `monodis`/`ikdasm` are available locally to
disassemble it properly if ever needed), and the actual device/business logic lives in
`BLLWrapper.dll`, a native PE32 DLL.

`BLLWrapper.dll` turns out to share the *same* underlying Komposti C++ SDK as
`libkomposti-ng.so` - identical class names (`TimelineSQLService::DailyActivityEvent`,
`SyncServiceImplementation`), and it even reveals the local SQLite cache schema directly as a
plaintext string:

```sql
create table if not exists DailyActivity (timestamp INTEGER not NULL, isPendingUpload INTEGER
  not null, source TEXT not null, value INTEGER not null, sml TEXT not NULL,
  PRIMARY KEY(timestamp, source));
```

alongside sibling tables `ActivityPerformanceEstimated`, `StateOfRecoveryEstimated`,
`SleepQualityEstimated`, `RecoveryTime` - all per-move embedded events (matching
`TimelinePart.Samples.Sample.Events.*` in the schema), not a standalone daily-steps history.
And checked directly: `grep -c "ActivitySummary\|SBEM0102"` on this binary → **0**, same as
the Android library. No `Steps` SQL table, no `StepCount` reference, anywhere.

**So this isn't about this particular watch's history** - neither Movescount-era client
(Android app or Windows Moveslink2), across two independently-built binaries sharing one SDK,
ever contains code to query `DeviceHistory.Histories.History.ActivitySummary.LastDays.Steps`,
for *any* watch. There is nothing to have captured here even with live Movescount servers -
the capability genuinely isn't in this client generation. That also means the "servers are
dead so I can't capture anything" limitation doesn't cost anything for this specific
question - re-confirms `libmds.so` (the modern Suunto app) or a live capture of the *current*
ecosystem remain the only real paths forward, not anything achievable against Movescount/
Moveslink2 regardless of server availability.

## Confirmed: the sync destination side has no blocker at all

Checked live via the connected intervals.icu integration: `get_wellness` already returns a
populated `steps` field with real values (7626, 6585, 1025, 454, 637, 5252, 2448 across the
last week) - so intervals.icu's wellness model natively supports steps, and something is
already feeding it from another source. The specific MCP tool wrapper available here
(`update_wellness`) doesn't expose a `steps` parameter in its curated write interface, but
that's a limitation of this particular integration surface, not of intervals.icu's actual API
- their real wellness write endpoint clearly accepts the field already. Pushing watch-derived
step counts there would be a normal API write, not a research question.

## A known-plaintext attempt on raw flash, 2026-08-05 - inconclusive, but worth recording

André's suggestion: rather than keep guessing the `0x12f` request-ID encoding, dump the watch's
flash directly and search for the literal byte pattern of a known reference value (333 steps,
read off the watch that day) across every encoding (`u16`/`u32` LE/BE, ASCII). Full detail and
the region-by-region table in `steps_encodings_checked_andre.md` - short version: all five
non-nav flash regions were read and searched (`BlePairingInfo`, `TrainingProgram`,
`CustomModes`, `EventLog`, `ExerciseLog`, the last a 5.5 MB read taking ~3 minutes), and while a
few raw byte matches turned up in `ExerciseLog`, they sit inside what looks like compiled ARM
Thumb code (recognizable function prologue/epilogue opcodes right next to the match), not
structured data - judged coincidental, not real. **No plausible match for 333 anywhere.**
Doesn't overturn the `libmds.so`/live-capture conclusion below, but it was a cheap, worthwhile
check and rules out "it's just sitting in plain sight somewhere in flash" as an easy shortcut.

## Live polling of `ActivityTracking` (0x96) against the watch's own screen, 2026-08-05

Two live re-queries of `0x96` hours apart showed `DailyActivity` (entry `0x93`) growing from a
2-byte scalar (`0`) to a 10-byte array (`[0, 0, 14, 14, 14]`, u16LE) - real evidence it's an
appending buffer, not a single daily total. But a third query, taken right after André reported
the on-screen figure moving from 86 to 91 kcal, came back **byte-for-byte identical** to the
previous one - so this object updates on some periodic/batched cadence, not continuously; a
single point-in-time comparison won't necessarily land in the same window as the screen.

One clean, exact win regardless: `TotalWeeklyActivity` (entry `0x95`) read **1615**, matching
"weekly activity avg 1615 kcal" on the watch's own screen exactly. That field, at least, is
fully identified.

**Why no wrist HR matters for interpreting any of this** - André's point, and it's the right
one: this is a 2015 Ambit3 with no optical HR sensor, so any kcal figure on it cannot be a
measured value - it has to be a formula estimate from the user's profile (weight, height,
activity level) combined with activity type and duration, the classic MET-based approach.
Confirmed the profile side is real and populated, read live via the already-working `0x1100`
settings query:

| Field | Raw | Value |
|---|---|---|
| `Personal.Gender` | 1 | Male |
| `Personal.Weight` | 7500 | 75.00 kg (`<MOD>(1/100)*x`) |
| `Personal.Height` | 180 | 1.80 m / 180 cm (`<MOD>(1/100)*x`) |
| `Personal.MaxHR` | 180 | 180 bpm (raw already sensible, no transform applied) |
| `Personal.RestHR` | 60 | 60 bpm |
| `Personal.ActivityLevel` | 50 | 50, or 5 on a 1-10 scale (`<MOD>(1/10)*x`) |
| `Personal.BirthDay` | `1973-01-01` | Possibly an uncustomized placeholder (Jan 1 default), not necessarily real |

`ActivityLevel` being real and populated (not a nil sentinel) directly supports the
no-HR-so-it-must-be-a-formula reasoning. Once enough polling data points exist to see
`DailyActivity`'s raw buffer change alongside a known kcal delta on screen, these profile
values are the right inputs to try reverse-engineering the actual formula against (weight ×
some MET-like per-activity-type factor × duration, calibrated against `ActivityLevel`).

**In progress:** three scheduled checks of `0x96`, 15 minutes apart (in practice the second
landed ~5h50m after the first, due to wakeup-scheduling drift - not a data problem, and
actually useful, see below), correlating raw byte changes against on-screen kcal at each point.

Check 1 -> 2: `DailyActivity`'s buffer grew from 6 to 30 entries (24 new ones) over ~350
minutes - 350/24 = 14.6 min/entry, a clean confirmation the epoch length really is close to 15
minutes. But **every one of the 28 non-zero entries reads exactly `14`, with zero variation**,
across nearly 6 hours during which the on-screen kcal figure moved a lot (86 -> 91 -> ~115).
`WeeklyActivity`/`TotalWeeklyActivity` didn't move at all in the same window either.

**Revised conclusion: `DailyActivity` (`0x93`) is very likely not the source of the visible
"activity today" kcal figure.** A constant value repeated in every single epoch, with no
variation at all despite real elapsed time and changing on-screen totals, looks like a fixed
basal/resting-rate constant being logged per period (plausibly BMR-per-15-min for this profile,
which would rightly be near-constant) - not a genuine, varying activity measurement. Whatever
actually drives the displayed kcal total is some other, still-unlocated mechanism. This
narrows rather than solves the question: the periodic-buffer structure and epoch length are
now well-established facts about this object, but it looks like the wrong object for the
number actually shown on screen.

**Checked whether the actual formula lives anywhere in the decompiled assets - it doesn't, and
that's an answer in itself.** Searched the Android app sources, the native library, and the
Windows SuuntoLink JS (`route.js`/`poi.js`/`navigation.js`) for MET/calorie/basal-metabolic
terms. The only real hit: `libkomposti-ng.so.c:933374`, where `ActivityLevel` (alongside
`Gender`/`Height`/`Weight`/`RestHR`/`MaxHR`) appears purely as a **field-name mapping** -
converting the local `personal.xxx` settings into the `sml.*` tree sent to the watch. No
computation, anywhere client-side. The `ActivityTrendGraph` UI widget bundle (1.9 MB,
`assets/APK/movescountapp/resources/assets/widgets/ActivityTrendGraph/
ActivityTrendInsightElement.bundle.js`) only turned up unrelated localized help text for a
different (HR-based lap) feature.

**Conclusion: the kcal-estimation formula runs in the watch's own firmware, not in any client
this project has decompiled.** The watch computes and displays "activity today" and "weekly
activity avg" with no phone connected, so it has to be on-device - and the firmware binary
itself isn't part of this project's assets, only the protocol/schema and the clients that talk
to it. This isn't a dead end so much as it reframes the live-polling approach already underway
as the *right* method rather than a fallback: without firmware to disassemble, fitting an
empirical model from raw-buffer-vs-screen-kcal data points (using the real profile numbers
above as the model's inputs) is the only way to actually recover this formula from what's
available.

## Final summary of the 3-check `0x96` poll, 2026-08-05

| Check | Time | Gap since last | `DailyActivity` (`0x93`) entries | New entries (all `14`) | `0x95` |
|---|---|---|---|---|---|
| 1 | 01:29:15 | (baseline was ~hours earlier) | 6 | +1 | 1615 |
| 2 | 07:19:57 | ~5h50m | 30 | +24 (~14.6 min/entry) | 1615 |
| 3 | 07:37:15 | ~17.3 min | 31 | +1 (~17.3 min/entry) | 1615 |

Both real gaps (the long one and the short, precise one) land close to a **~15-minute epoch
length** for `DailyActivity`'s buffer, and in all three checks, every single new entry was
exactly `14` - no variation ever observed, across a combined ~6h of real elapsed time and a
reported on-screen kcal figure that moved substantially (86 -> 91 -> ~115-116) in that same
window. `DailyRecovery` (`0x92`) grew in lockstep (same epoch cadence, one stray `1` staying
in place, rest zero). `WeeklyActivity`/`TotalWeeklyActivity` (`0x94`/`0x95`) never moved at all
across any of the three checks.

**Conclusion holds, now on stronger evidence: `DailyActivity`'s per-epoch `14` is a constant
reference value, not a real, varying activity signal, and is not the source of the on-screen
"activity today" kcal figure.** A genuine per-15-minute activity measurement would be expected
to vary with real movement over a 6-hour span; a value that never once changes, in any of three
independent checks spanning very different time gaps, is much better explained as a fixed
basal-rate constant being logged into every epoch regardless of what actually happened during
it. Combined with the BMR breakthrough below (`0x95` = an exact, unrounded Mifflin-St Jeor
calculation from the profile, not a measurement), the working hypothesis is that `0x93`'s `14`
is some related fixed-rate reference too - plausibly a portion of the same BMR figure
apportioned per epoch - rather than a step or movement counter.

**Recommendation: this specific object (`0x96`/`ActivityTracking`) has given what it's going to
give.** Two clean facts extracted (the epoch length, and the exact BMR formula for `0x95`), but
no path from here to the actual displayed activity total or to step counts specifically -
those still point back to the earlier conclusion: `libmds.so` (the modern Suunto app's
library) or a live capture of the current ecosystem remain the ways to close that out. Not
worth further polling of `0x96` itself; worth trying known TDEE/PAL-multiplier formulas against
the already-solid BMR figure and `ActivityLevel`, since that same "known era-appropriate
formula" approach just produced an exact hit once already.

## Breakthrough: `TotalWeeklyActivity` is an exact, textbook BMR formula - not measured, not a mystery constant

André's framing, and it's exactly the right one: this is a 2015 device from an era where most
"sport science" figures on watches were formula/theory-based, not measured (the same way
`220 - age` estimates max heart rate on countless devices of that generation, rather than
measuring it). Tested directly against the two standard, well-known BMR equations from that
era, using the real profile read live off this watch (`Weight=75kg`, `Height=180cm`,
`Gender=Male`, `BirthDay=1973-01-01` -> age 53 as of 2026-08-05):

```
Mifflin-St Jeor (1990, male): 10*75 + 6.25*180 - 5*53 + 5   = 1615.0
Harris-Benedict  (1984, male): 88.362 + 13.397*75 + 4.799*180 - 5.677*53 = 1656.08
Observed on watch (entry 0x95, "TotalWeeklyActivity"):        1615
```

**Exact match, to the decimal, with Mifflin-St Jeor - no rounding needed.** Harris-Benedict,
the older classic, misses by 41. This settles it: Suunto computed this field with the
Mifflin-St Jeor equation from the profile alone (weight/height/age/gender), not from any
sensor - fully consistent with a 2015, no-wrist-HR device, and a clean, confirmed, exact
result rather than an approximation.

Worth correcting the schema's own field name in light of this: despite being called
"TotalWeeklyActivity," 1615 is a **daily** BMR figure (a very ordinary, plausible one for this
profile), not a weekly sum - it is most likely a computed reference/baseline constant
(recalculated only if the profile changes), which is exactly why it never moved once across
all three polls spanning nearly 6 hours. The schema's naming may just reflect how Suunto's own
code organizes/labels this internally, not a literal description of the value.

**What this doesn't yet resolve:** `DailyActivity`'s constant `14`-per-epoch doesn't fall out
of a simple division of 1615 by an obvious epoch count (1615/96 epochs-per-day = 16.8,
1615/24 hours = 67.3 -> /4 for 15-min = 16.8 again - close to 14 but not exact). Either the
epoch-count assumption is slightly off, a different reference value feeds it (e.g. a resting
energy expenditure distinct from full BMR, or `RestHR`/`ActivityLevel` entering the formula
too), or it isn't meant to reconstruct the daily total via simple division at all. Worth
trying known Total-Daily-Energy-Expenditure formulas next (BMR x activity-factor, the classic
1.2-1.9 PAL multiplier scale) against `ActivityLevel` (raw 50, or 5 on a 1-10 scale) as the
activity-factor input, the same "known textbook formula" approach that just worked here.

### PAL/TDEE formula tried against the `14` constant - no clean match, honestly reported

Tried the standard next step: `TDEE = BMR x PAL`, PAL from the usual 1.2 (sedentary) to 1.9
(extra active) table, both as the full per-epoch share (`TDEE/96`) and as just the
"active" portion above BMR (`(TDEE-BMR)/96`):

```
                              per-epoch     per-epoch
PAL                  TDEE     (full share)  (active-only)
1.2   sedentary      1938.0   20.19         3.36
1.375 lightly active 2220.6   23.13         6.31
1.55  moderately act 2503.2   26.08         9.25
1.725 very active    2785.9   29.02         12.20
1.9   extra active    3068.5   31.96        15.14
```

`ActivityLevel` (raw 50, i.e. 5 on the schema's 1-10 scale) mapped linearly onto the 1.2-2.0
PAL range gives PAL=1.556, TDEE=2512, per-epoch=26.17 - none of these land on `14`. Solved
backwards, an exact `14` full-share would need PAL=0.832 (physically meaningless, PAL is
always >=1 by definition), and an exact `14` active-only share would need PAL=1.832 - closer to
the "very active"/"extra active" range but not a standard table value either.

**Honest conclusion: this specific approach doesn't crack `14` the way the same method cracked
`1615`.** Not forcing a near-miss into looking like a match. Either `14` isn't a BMR/PAL-derived
figure at all (plausibly a separate, unrelated bookkeeping constant, or even a
placeholder/default this older firmware doesn't fully populate per-profile), or it depends on
an input/formula this pass hasn't tried (e.g. `RestHR`, or a non-linear `ActivityLevel`
lookup table rather than a linear PAL mapping). Given `0x96` has already yielded its clean,
confirmable result (the BMR match) and further guessing here has diminishing returns, this
thread is best left here rather than continuing to force-fit round numbers.

## Overall verdict

Splits cleanly into two, and one half is already done:

- **Daily activity energy (kcal)**: solved outright. `ActivityTracking` (`0x96`) is live,
  working, single-byte-ID, no mystery left - `write_nav.py`-style tooling could read
  `DailyRecovery`/`DailyActivity`/`WeeklyActivity`/`TotalWeeklyActivity` today. Decoding
  `DailyRecovery`'s 20-byte array fully is the only loose end, and it's a small one.
- **Literal step counts**: still open, for real this time - `ActivitySummary.LastDays.Steps`
  (`0x12f`) has zero implementation in either Movescount-era client (Android or Moveslink2),
  confirmed by tracing two independent binaries sharing one SDK. `libmds.so` (the modern
  Suunto app) or a live capture of the current ecosystem remain the only paths forward for
  steps specifically.

Either way, the destination side (intervals.icu) has no blocker (below), and pushing
kcal/energy data there today would need mapping to whichever of its fields fits best -
`steps` itself still needs the `0x12f` piece.
