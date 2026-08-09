# Training plan / workout creation: two generations found, only one relevant to this watch, structurally understood but NOT byte-verified

## The starting point

From `history.md`'s list of features lost in the Movescount -> Suunto app migration:
"Training plan creation." André pointed at two sources to dig into: the decompiled
Movescount/Moveslink2 assets, and marguslt's gist
(`gist.github.com/marguslt/a79ea204f99b45ab015b6ed1ff7529a4`).

## Finding 1: the gist shows the *old* mechanism - training plans are Suunto Apps in disguise

The gist (`#mc-workouts.sh-session`, a real, working shell transcript against
`uiservices.movescount.com`, dated 2020-09-30) shows the complete cloud-side workflow:

1. A workout is authored as JSON, base64-encoded, and substituted into a **Rule** template
   (`RULE_SRC`/`RULE_NAME` placeholders) - the same `RuleID`/`Category`/`Source` REST
   structure this project already reverse-engineered for Suunto Apps this session, though
   (see Finding 5 below) `Source` turns out to hold something different for a `guidance` rule
   than it does for a display-value app.
2. `POST rules/` creates it - tagged `Category: "guidance"`, `Type: "guidance"`,
   `OutputFormat: "onedecimal"` (a pacing/target-value display hint) - distinct from a normal
   display-value app only by that tag, not by mechanism.
3. **Creating the rule alone does nothing to the device** - confirmed explicitly in the
   transcript ("adding a rule does not change device settings").
4. Activating it needs a second call: `PUT userdevices/<serial>/` with
   `resetchangedsettings=true` and a `RULE_ID_LIST` naming which rule(s) are active - this is
   what actually gets synced down to the watch.

So in the Movescount/Ambit1-2-era model, a "training plan" **is** a Suunto App (a compiled
rule-engine script), just categorized `guidance` rather than a generic display value, pushed
through the exact same `userdevices` record this project already knows clobbers/gets synced
by any SuuntoLink/BLE sync (`ambit_app_suuntolink_clobber.md`).

## Finding 2: that's not what the Ambit3 Peak actually uses

Two things rule the "guidance Rule" mechanism out as *the* answer for this watch specifically:

- **The watch declares a dedicated `TrainingProgram` flash region**, separate from `Apps` and
  `CustomModes` - confirmed live via `0x0b21`: `base=0x001000 size=3072`. If training plans
  were just Suunto Apps, there'd be no reason for a distinct region.
- **This project's own SuuntoLink SBEM schema dictionary** (`assets/descr+8A153C5111000900+
  2.4.17`, the same one that fully names every Settings/POI/Logbook field) **has zero
  `TrainingProgram` entries** - ruling out the generic SML/`0x1100`-query mechanism too.

What the decompiled `SDSApplicationServer.exe.c` (the modern Suunto app/SuuntoLink backend)
actually has is a dedicated, purpose-built converter:
`BinaryArea/TrainingProgramAreaConverter.cpp` (`createBinary`, `parse`, `getDataPosition`) -
a real, separate binary format, not SBEM, not the `IAMRULE`/Rule mechanism. Suunto evidently
redesigned this at some point between the Movescount-era "guidance Rule" hack and whatever
generation the Ambit3 Peak's firmware/backend actually targets - unsurprising, this project
has already seen unlabeled protocol evolution once this session (`EXERCISE_MODES_APP_META`,
not in any decompiled dictionary either).

`Moveslink2`'s `BLLWrapper.dll` (strings only, no Ghidra project for it) confirms the older
generation still exists there too: `Arrest::HandleTrainingProgram::trainingProgramToSML`,
`.../plannedtrainingprogram/plannedtrainingprogrammoves` XML paths - almost certainly the
*old* guidance-Rule path (or an even earlier XML-local-settings variant), not evidence the
Ambit3 Peak uses it. Not chased further since the live memory-map + empty schema already
settle which mechanism is actually relevant here.

## Finding 3: the binary format, from source - structurally solid, NOT byte-verified

**No real capture exists to check this against.** Scanned all 9 real captures in
`assets/ambit3 pcap/` for any `0x0b16`/`0x0b17`/`0x0b18` message whose address falls inside
`[0x001000, 0x001000+3072)` - zero hits, in every capture. `TrainingProgram` also reads back
entirely `0xFF` (erased/empty) on the reference watch (confirmed earlier this session during
the steps investigation, `/tmp/dump_TrainingProgram.bin`). So unlike every other format this
session (`CustomModes`, `ExerciseLog`, `GpsSGEE`), there is no ground truth to check a decoder
against - what follows is read from `TrainingProgramAreaConverter`'s decompiled logic alone.

**Cross-confirmed from two independent code paths** (`createBinary`'s write-side arithmetic
and `getDataPosition`'s read-side arithmetic agree exactly - high confidence):

```
[12-byte header]
  offset 0-7:  unclear (hash/version-derived, not chased further)
  offset 8:    uint16, item count
  offset 10-11: unclear (padding, or part of the same value)
[item_count x 40-byte (0x28) item records, starting at offset 12]
```

Both `createBinary` (building the header) and `getDataPosition`
(`*(ushort*)(*data + 8) * 0x28`) and `parse` (starts reading items at offset `0xc`, steps by
`0x28`) agree on the 40-byte stride and the offset-8 count field independently - not a single
reading, a structural fact confirmed twice.

**Medium confidence** (field names and order from `createBinary`'s write loop, which builds
each item from a named property lookup - `FUN_0042bb70(...,"fieldname",len)` before each
value read, in this exact order; NOT independently confirmed against `parse`, which reads the
same names but in a different order while building a property-tree rather than doing literal
offset reads, so it doesn't pin down byte positions the way it did for `CustomModes`):

| Field | Type (inferred) | Notes |
|---|---|---|
| `startTime` | date/time, 1 byte in the packed struct | passed through a conversion function before storage - likely days-since-epoch or similar, not a raw calendar date |
| `completed` | 1 byte, bool-like | |
| `activityId` | uint16 | same `ActivityID` space as `CustomModes`/`SuuntoAppZoneDeveloperManual.pdf`'s enum, presumably |
| `moveId` | uint32 | links to a specific recorded Move once completed |
| `distance` | uint32 | meters, by convention elsewhere in this project |
| `duration` | int16 | stored as **minutes**, truncated from a `/60.0` division on write - sub-minute precision is lost |
| `intensity` | 1 byte | |
| `activityName` | fixed string, ~23-24 bytes | `strncpy(..., 0x17)` = 23 bytes copied |

Summing the confidently-typed fields (1+1+2+4+4+2+1+~23/24 = 38-39 bytes) lands close to the
confirmed 40-byte stride but not exactly - consistent with minor padding or one field being a
byte or two wider than estimated, not with a wrong field list. `0xFF` is used throughout as
the "unset/invalid" sentinel (every field pre-filled to all-`0xFF` before being overwritten in
`createBinary`; `parse` explicitly checks for an all-`0xFF` item as "empty/end of list").

## Finding 4: confirmed orphaned, not a contradiction of "training program was lost for Ambit3"

André's recollection - training programs were specifically lost for the Ambit3 in the
Movescount -> Suunto app transition - is correct, and doesn't conflict with Finding 3 above.
It explains it.

Checked directly: **`TrainingProgram` appears nowhere in SuuntoLink 4.1.15's current JS
layer** - not in `messages.js` (the file that defines every REST endpoint this project has
traced all session: `getSgee`, `postPOIs`, `getLogBookData`, `getSportModeDisplays`, all of
it), not anywhere else in the app's resources. Grepped the whole thing; zero hits.

So the picture is: the compiled `SDSApplicationServer.exe` backend - a shared codebase across
Suunto's whole product line, not Ambit3-specific software - still *contains*
`TrainingProgramAreaConverter` and Ambit3-specific (`EmuDevice::handleMCServiceTrainingPrograms`)
training-program code, and the watch's own firmware still declares the flash region. Both are
leftovers from the Movescount era, when this genuinely worked. But **nothing in the current
application's UI or REST layer calls any of it** - no button, no endpoint, nothing reachable.
The low-level plumbing (device driver code, on-device region) was never stripped out; the
feature that used to drive it was removed at the application layer. That's precisely what
"lost in the transition" looks like from the software's own remains, not a contradiction of
it.

**Correction, 2026-08-05 (see Finding 9 below)**: "no Training/Workout menu exists" was checked
against the *current* (post-Movescount) `Suunto_Ambit3_Peak_UserGuide_EN.pdf`. The
Movescount-era edition of the exact same manual, for the exact same watch, documents both a
`WORKOUT` options-menu entry and a full on-watch planned-move flow in detail. The menu existed;
it was removed from the manual (and, per Finding 4's own JS grep, from the application) later,
consistent with - not contradicting - "lost in the transition."

## Finding 5: a real community source list changes the picture - `trainingplan_gpt.md`

André pointed at `trainingplan_gpt.md` (a pre-collected source list: official Suunto
tutorials, Reddit threads, forum posts, and - most valuably - `openambitproject/openambit`
issue #257, "Enhancement: Structured Workouts Sync"). Read the issue and its 7 comments (real
people who did this in 2020, while Movescount was still alive) and two more of marguslt's
collaborator's gists it links. Several things change:

**The real JSON schema, from two independent live examples** (one from a comment showing an
actually-downloaded workout, one from `dgvalde`'s own gist,
`gist.github.com/dgvalde/9e00a590388224122bd7d295f886bced`) - not a guess, an exact structure
seen twice:

```json
{
  "name": "Power Intervals",
  "workoutDescription": "8x2min intervals with power",
  "steps": [
    {"type": {"typeName": "warmup"},
     "duration": {"durationName": "time", "value": 60.0},
     "target": {"targetName": "power", "valueRange": {"min": 210.0, "max": 240.0}},
     "text": "Warmup at 225w"},
    {"type": {"typeName": "repeatStart", "value": 8}},
    {"type": {"typeName": "interval"}, "duration": {...}, "target": {...}, "text": "..."},
    {"type": {"typeName": "recovery"}, "duration": {...}, "target": {...}, "text": "..."},
    {"type": {"typeName": "repeatEnd"}},
    {"type": {"typeName": "cooldown"}, "duration": {...}, "target": {...}, "text": "..."}
  ]
}
```

`durationName`: `time` / `distance` / `hr_below` (an implicit-end condition: "until HR drops
below X"). `targetName`: `hr` / `pace` / `power` / `none`. A real, TrainingPeaks-shaped
structured-workout format - warmup/interval/recovery/cooldown steps plus a repeat block, each
with its own duration and target range.

**A correction to what `Source` actually holds, confirmed exactly, not assumed**:
`dgvalde`'s `download_workout.sh` does `... | jq -rc .Source | base64 -d | jq -r .` - decoding
`.Source` and getting valid JSON straight back out. So for a `guidance` rule, `Source` is the
**raw JSON workout itself**, not compiled bytecode. Every download/list script in this gist
explicitly `del(.Binary, .Source)`s before printing - the actual on-device bytecode lives in
the separate `.Binary` field, and nobody in that whole 2020 thread ever needed to look at it,
because **Movescount's own server did the JSON -> device-bytecode compilation**, invisibly,
server-side, on every `POST rules/`. This project has no access to that compiler - it never
shipped in any client (APK/EXE) this project has decompiled, only in Movescount's backend.

**Movescount's service is confirmed dead, unlike the AGPS host.** Checked directly, 2026-08-05:
`uiservices.movescount.com` still resolves in DNS (the CloudFront distribution is still
configured) but returns `502 "CloudFront wasn't able to resolve the origin domain name"` -
the origin server behind it is gone. `www.movescount.com` doesn't respond at all (connection
timeout). Unlike `devices.suunto-operations.com` (`sgee_andre.md`), there is no live service
left to fetch a real compiled example from, or to compile a new one with.

**Workouts were genuinely Ambit3-exclusive**, confirmed directly by marguslt in the issue
thread ("workouts are only available for Ambit3" - not Ambit1/2, and confirmed separately not
on Suunto 9 either). That's real, first-hand confirmation this was a genuine, working,
Ambit3-specific feature - not evidence pointing at some other device sharing the backend
codebase, as Finding 3 above had left open as a possibility.

**Where it actually surfaced**, per `dgvalde`: "I can only see the structured workouts on the
Android Movescount application. Nothing on the Movescount web" - a "Workouts" tab alongside
"Sports modes" and "Settings" in the phone app's device-management screen, when syncing a
paired watch. Consistent with this project's own finding that the Ambit3 Peak's user manual
never mentions a training/workout menu: the authoring and viewing UI lived entirely on the
phone, not on the watch.

**How this reconciles with `TrainingProgramAreaConverter` (Finding 3)**: `trainingplan_gpt.md`
distinguishes "Workout Planner" (the rich, per-workout interval structure above) from
"Training Programs" (a higher-level weekly/calendar scheduling layer - "Planned Moves").
That maps plausibly onto two separate mechanisms: the rich structure -> compiled into a
`guidance` rule's `.Binary` (Movescount's dead compiler, Finding 5); the lighter
schedule-only metadata (which activity, which day, planned duration/intensity, which
recorded Move it corresponds to once done) -> `TrainingProgramAreaConverter`'s dedicated
flash region (Finding 3, still only structurally understood, still unverified). Plausible,
not proven - nothing found ties the two together explicitly.

## Finding 6: the simple-App compiler was ported by the community; the workout compiler wasn't

André's own hypothesis, checked directly and confirmed: `forum.suunto.com/topic/7592/
ambit-apps-compilation` (pavel.samokha, February 2022) documents a community-built
replacement for the *simple* App Zone compiler - single `RESULT = ...;` scripts, the same
language `SuuntoAppZoneDeveloperManual.pdf` documents and this project already fully solved
this session (`custom_modes_andre.md`'s `IAMRULE` format, verified live by installing "Climb
counter"). **Still live and working, checked 2026-08-05**:

```
UI:  https://ambitapps.z6.web.core.windows.net/  (static, unchanged since 2022-02-15)
API: POST https://ambitappscompiler.azurewebsites.net/api/compile
     header x-functions-key: qakj8vb/... (public - embedded directly in the UI's own
     client-side JS, the same "app-level key, not a personal account" pattern as the
     GpsSGEE/AGPS host in sgee_andre.md)
     body: raw App Zone script source, Content-Type: text/plain
```

Tested directly with the manual's own first example, `RESULT = 100;`:

```json
{"ruleId":0,"name":"Ambit App","categoryId":0,"activityId":1,"userCount":1,
 "binary":[73,65,77,82,85,76,69,0, ...],
 "compatibleVariants":["Bluebird","Colibri","Duck","Emu",...]}
```

Real, working, `HTTP 200`. The wrapper matches this project's own `IAMRULE` decode exactly -
same magic, same field layout, even the same `?prefix`/`?postfix`/`?title` string table shape
already seen in "Climb counter". Bonus: this is small enough to read the actual VM bytecode
for the first time - the tail bytes end `... 90 00 00 c8 42 15 01 00 0d 04 00 13 1f`, and
`00 00 c8 42` as an IEEE754 float32 is exactly `100.0` - `0x90` reads as a "push float
constant" opcode, directly traceable back to the source script. Not pursued further (out of
scope for training plans), but a real, ready foothold if this project ever wants to compile
*its own* Suunto Apps from source rather than only installing pre-compiled catalog ones.

**This is exactly what André predicted, not a surprise it confirmed after the fact**: the
simple, single-value App language got a community-built replacement, because it's small and
self-contained. The rich, multi-step structured-workout compiler - a real translation layer
from the JSON schema in Finding 5 into VM bytecode, effectively its own small compiler
project plus the UI to drive it - never got rebuilt. Consistent with the forum thread's own
framing of the simple compiler as a minimal, "AS IS," barely-tested stopgap: rebuilding the
much bigger workout compiler was never going to happen for a lightly-used feature on an
increasingly old device, especially in the pre-LLM-assisted-reverse-engineering era this
project itself is now demonstrating an alternative to.

## What was actually tried: a real test-write, 2026-08-05

With André's explicit go-ahead, built `training` as a new action, initially inside
`tools/write_nav.py` (`build_training_item()`/`build_training_program()`) from Finding 3's
structural understanding, dry-ran it, then wrote one real test item (`activityId=3` "Running",
`duration=30` min, `intensity=3`, `name="TEST123"`) to the reference watch. Read the region
back afterward: **byte-for-byte identical to what was sent**, confirmed via direct
comparison - the write mechanism itself (chunked `0x0b16` + `0x0b18` tail, same family as
every other write this session) worked cleanly at the flash level. `selftest.py` unaffected,
still 25/25 (this experimental path isn't in it - no ground truth to regression-test against).

**Moved to its own file same day**: André correctly pointed out that folding `training` (and
`sgee`) into `write_nav.py` broke this project's own established pattern -
`custom_modes.py`/`apps.py`/`exercise_log.py` all got dedicated files, importing `Link`
from `write_nav.py` for transport rather than merging their logic in. Split out to
`tools/training_program.py` (and `tools/sgee.py`) for consistency - same behavior, same
functions, just relocated. Current usage:

```
./tools/training_program.py --name "Long run" --duration 60 --intensity 3
./tools/training_program.py --name "Long run" --duration 60 --write
```

What that write does *not* establish: whether the watch's firmware recognizes these bytes as
a valid training program at all. The planned verification (check the watch's own Training
menu) turned out to rest on an assumption that doesn't hold - see Finding 4: there is no such
menu documented anywhere in the Ambit3 Peak's own user guide. Finding 5 now suggests why: if
this on-device region only ever held the *schedule* layer (which activity, which day - see
the reconciliation above), not the rich interval structure a user would actually want to see,
there may never have been a dedicated on-watch screen for it to check in the first place - the
authoring/viewing UI lived on the phone. So the practical status of the test-write is
genuinely unresolved: bytes landed correctly, but there's currently no known way to confirm
whether the watch did anything with them.

## Finding 7: `assets/Intervals` has real, sophisticated, working interval-training apps - and the whole pipeline was just proven end to end

André pointed at `assets/Intervals`, not previously examined in detail. It contains a
complete, published community project (`forum.suunto.com/user/sebchastang`, maintained
through Movescount's actual 2022 shutdown): six real App Zone scripts -
`IntervalCounter`/`IntervalCounterTime`/`IntervalRun`/`IntervalSpeed`/`IntervalSerie`/
`IntervalAIO` (plus "Light" variants) - each a genuine structured-interval-training state
machine, written entirely in the *simple* App Zone language this project already has a
working compiler for (Finding 6).

**These are real, not toy examples.** `IntervalAIO`'s source computes interval pace/HR targets
from actual sports formulas (`Suunto.round(Suunto.pow(SUUNTO_USER_MAX_HR,5.26)/1103550000)` -
a real VO2max-style pace estimate), tracks phase state (warmup -> fast -> slow -> recovery ->
next series -> cooldown) across lap-button presses (`SUUNTO_LAP_NUMBER`), changes the
on-screen `prefix`/`postfix` text live ("Fast" / "Slow" / "Walk" / "Cool"), and fires
`Suunto.alarmBeep()`/`Suunto.light()` on every phase transition. A real "2 x (8 x 30s fast /
30s slow) - 150s recovery" interval session, fully implemented.

**The configuration problem - "how does a user set series count/duration without Movescount"
- was already solved by the original author, and it's clever**: per the bundled
`SUUNTO - Custom apps - November 2021 update.docx`, once Movescount's App Designer could no
longer edit app variables, the apps were reworked to read their parameters from the watch's
own **personal/profile settings** instead - `SERIE_COUNT` off `SUUNTO_USER_HEIGHT`,
`INTERVAL_COUNT` off `SUUNTO_USER_AGE`, fast/slow pace off `SUUNTO_USER_MAX_HR`/
`SUUNTO_USER_REST_HR`, and so on. `ValueMapping.xlsx` (also bundled) is the exact reference
table: `Max HR`/`Rest HR`/`Age`/`Weight`/`Height`/`Activity class` -> `Fast`/`Slow`/
`Repetition`/`Serie`/`Interserie`/`Phase`. A user reconfigures their next interval session by
changing profile fields - directly on the watch, or via SuuntoLink's ordinary watch-settings
sync - never touching Movescount or a compiler at all.

**Proved the whole chain end to end, 2026-08-05**: took `IntervalRun` verbatim from
`assets/Intervals`, found the compiler's real header syntax from its own UI bundle's default
example (`/***HEADER***/`, no semicolons, one `NAME = value` per line, `/***ENDHEADER***/`
before the script body - not documented anywhere, reverse-engineered from `main.js`),
compiled it through the still-live community compiler (Finding 6) - **HTTP 200, a valid
`IAMRULE` binary, `Emu` (this project's own reference watch) in `compatibleVariants`**. As an
unforced bonus correctness check: the compiler's own compatibility detection *excluded* Kaka
(Ambit3 Vertical) from that list - exactly matching the docx's own documented caveat
("Suunto.round() ... no longer compatible with Ambit3 Vertical"), independent confirmation
the compiler and this understanding of it are both right.

**So every piece of the pipeline is now independently proven, using only what this project
already has working:**

1. Real, sophisticated interval-workout source -> `assets/Intervals` (found, read).
2. Source -> compiled `IAMRULE` binary -> the community compiler, live, proven today.
3. Compiled binary -> installed on the watch -> the exact mechanism verified on real hardware
   this session (`sgee_andre.md`'s "Climb counter" install).
4. Per-user workout configuration -> personal/profile settings fields, per `ValueMapping.xlsx`
   - readable today (`write_nav.py settings`); *writing* them isn't built yet, but would follow
   the same already-proven SBEM0102 write pattern this project used for POIs.

**What this does not give back**: fully free-form workout composition (arbitrary step
sequences with independent per-step targets, the rich JSON schema in Finding 5) - these are a
fixed menu of parametrized *templates* (a handful of interval shapes), not a general
composer. For most real-world interval training this is likely enough - "N x (fast/slow),
M series, recovery duration" covers the common case - but it is a smaller, more honest scope
than "rebuild the Movescount Workout Planner," and worth being upfront about which one a GUI
would actually be promising.

## What actually "getting this feature back" would take

Two separate problems, given Finding 5's split:

- **The schedule layer** (`TrainingProgramAreaConverter`, this project's own structural
  decode): the transport is already proven (today's test-write), but there's no known way to
  observe the result on-device, and no real capture exists to check the byte layout itself
  against. Verifying this further would need either a way to *see* whatever effect it has
  (unknown right now), or a real capture of it happening some other way.
- **The rich interval-workout structure** (`guidance` rules, Finding 5): this project already
  has everything needed to *push* a compiled rule to the watch - the exact same `IAMRULE`
  mechanism verified working this session for Suunto Apps (`sgee_andre.md`'s "Climb counter"
  install is proof this path works end to end). What's missing is the **compiler**: turning
  the real JSON schema above into whatever bytecode `IAMRULE` actually expects for a
  multi-step guided workout (repeat blocks, per-step targets) rather than the single-value
  `RESULT = ...;` scripts `SuuntoAppZoneDeveloperManual.pdf` documents. That compiler ran
  server-side on Movescount, which is dead, and never shipped in any client this project has
  decompiled - confirmed further by Finding 6: even the community's own 2022 effort only
  rebuilt the *simple* App compiler, not this one. Two ways forward if this matters enough to
  pursue: (a) find a real, already-compiled `.Binary` example somewhere (the 2020 openambit
  thread's participants, an archived Movescount export, anyone who saved one before the
  service died) and reverse-engineer the compiler the same way every other format in this
  project got solved - from real bytes, not guesswork; (b) accept a smaller scope and
  hand-encode simple guided-workout `IAMRULE` apps directly against the already-solved App
  Zone bytecode format - concretely buildable right now, since Finding 6 confirmed a live
  compiler for exactly that language (`ambitappscompiler.azurewebsites.net`) - more limited
  (probably no rich repeat-block support), but no longer purely theoretical. **Finding 8 below
  refines this path further**: source generation, not hand-encoding, and no profile-field
  reuse at all.

## Finding 8: a real GUI is buildable without Seb's profile-field trade-off - generate source per workout, don't configure a fixed template

André flagged a real problem with Finding 7's approach before pursuing it further: the
`ValueMapping.xlsx` scheme reconfigures a workout by writing fake values into
`SUUNTO_USER_HEIGHT`/`AGE`/`WEIGHT`/`MAX_HR`/`REST_HR` - fields this project already knows
aren't decorative. Earlier this session, this project confirmed the watch computes calories
via the Mifflin-St Jeor formula (uses weight/height/age directly) and derives HR zones off
`220-age`-style conventions. So while an interval app configured Seb's way is active, those
other on-watch calculations are silently wrong, for as long as the hack is in place - a real
trade-off, not a hypothetical one. André also wants something that's actually a GUI, not
"pure programation" - closer to what Movescount's own Workout Planner offered.

**Reference example, at André's pointer**: `wanarun.net/suunto-ambit/en/new-workout.php`, an
independent (non-Suunto) workout builder for these watches. Fetched and reviewed, 2026-08-05.
Its model is a plain step list, not a template picker: each step has a duration type
(`Time in seconds`/`Time in minutes`/`Distance in meters`/`Distance in kilometers`/
`Ascent in meters`/`Lap Button press`) and a target type (`No Target`/`Heart Rate Zone`/
`Speed`/`Pace`/`Vertical Speed`), steps can be grouped into named, repeat-count loops, and the
whole thing gets a name and description. Structurally the same shape as Finding 5's real JSON
schema (`steps[]` with `duration`/`target`/repeat blocks) - independent confirmation from a
second, unrelated source that this is what a real workout-builder UI is supposed to look like,
not Seb's fixed fast/slow template.

**The profile-field reuse turns out to be an artifact of Seb's constraint, not a requirement
of the App Zone format itself.** Re-read `IntervalRun` and `IntervalAIO` closely (full text,
not excerpted): the `SUUNTO_USER_*` reads only ever appear inside one guarded block,
`if (SUUNTO_DURATION <= 10) { if (SERIE_COUNT <= 0) { SERIE_COUNT = SUUNTO_USER_HEIGHT-100; } ... }`
- a one-time seed of each own-variable's *default*, run once at the start of an exercise, only
because the variable's compiled-in initial value is otherwise always `0`
(`IntervalRun_variables` declares every own-variable starting at `0`). Seb needed this because
Movescount's App Designer - the only thing that could ever bake a *different* default into the
compiled binary - was gone. **This project doesn't have that constraint: it has a live
compiler** (Finding 6, confirmed working today). Nothing requires reading `SUUNTO_USER_HEIGHT`
at all - a GUI can bake the real chosen values directly into freshly generated source before
compiling:

```
if (SERIE_COUNT <= 0) {SERIE_COUNT = 6;}
if (INTERVAL_FAST <= 0) {INTERVAL_FAST = 12;}
```

in place of

```
if (SERIE_COUNT <= 0) {SERIE_COUNT = SUUNTO_USER_HEIGHT-100;}
if (INTERVAL_FAST <= 0) {INTERVAL_FAST = Suunto.round(Suunto.pow(SUUNTO_USER_MAX_HR,5.26)/1103550000);}
```

Every other line - the whole `PHASE`/lap-driven state machine, `Suunto.alarmBeep()`,
live `prefix`/`postfix` field text - is unchanged. Zero personal-settings fields read or
written, ever. This isn't a new capability to build; it's deleting six lines from a template
this project already has real, working examples of, then compiling the result through the
same live endpoint already proven in Finding 6.

**A real ceiling, checked against all six scripts, not just one**: `IntervalCounter`/
`IntervalCounterTime`/`IntervalRun`/`IntervalSpeed`/`IntervalSerie`/`IntervalAIO` are all
variations on the same fixed fast/slow/rest phase-machine, built entirely on flat scalar
own-variables - no array or indexed-variable syntax appears anywhere across any of them (nor
in `SuuntoAppZoneDeveloperManual.pdf`'s language spec). That means simply *filling in* one of
these fixed templates can't represent wanarun's fully free step list (arbitrary step count,
independent duration-type/target-type per step) - template-filling alone caps out at Seb's
shape (repeating fast/slow/rest), regardless of how the defaults get set.

**But since a compiler is in the loop, this project isn't limited to template-filling.** A
generic N-step workout can be represented as *generated* source, not a filled-in template:
emit one unrolled `PHASE == k` branch per step (each with its own literal duration-type,
target-type, duration, and target values, and its own `prefix`/`postfix` display text),
chained the same way `IntervalAIO`'s own `PHASE` transitions already are by hand. This is
straightforward code generation (JSON workout schema, the same shape as Finding 5 and
wanarun's model, in - App Zone source text out), not a new on-device mechanism - the compiler
and installer are both already proven (Findings 6 and 7).

**The realistic shape of the feature, given everything found this session**:

```
GUI (wanarun-style step builder)
  -> App Zone source generator (new, small - not yet built)
  -> live community compiler (ambitappscompiler.azurewebsites.net, proven, Finding 6)
  -> IAMRULE install (proven on real hardware, Finding 7 / sgee_andre.md's "Climb counter")
```

No Movescount dependency, no dead compiler to reverse-engineer, no profile-field corruption.
Smaller than Finding 5's rich schema in one respect (implicit-end conditions like
`hr_below` aren't obviously expressible as a fixed lap-driven phase machine - not chased
further) but otherwise a real, free-form step-sequence builder, not a fixed menu of
parametrized templates like Finding 7 landed on. Not yet built: the source generator itself,
and a UI. Both are new work, not new reverse-engineering - every underlying mechanism they'd
drive is already proven.

## Finding 9: the Movescount-era manual for this exact watch documents both on-watch UIs directly - and raises a real open question about Finding 8's plan

André pointed at `assets/manuals/movescount era/` - not previously examined; this session had
only checked the *current* `assets/manuals/Suunto_Ambit3_Peak_UserGuide_EN.pdf`. It holds an
older edition of the same Ambit3 Peak guide (plus Ambit3 Sport's, same content), from while
Movescount was still alive. Both "3.18 Interval workouts" and "3.39 Training programs" are
documented there in full, with real on-watch screen mockups - direct, primary-source
confirmation of both mechanisms Findings 3-5 had only reconstructed from decompiled code and a
2020 community thread.

**Interval workouts (the rich, per-step structured-workout side, Finding 5's `guidance`
rules), on-watch flow, verbatim from the manual**:

> After you create the workouts and re-sync your watch with the app, the workouts are
> available under the options menu while in a sport mode.
> 1. While you are in a sport mode, keep [Next] pressed to access the options menu.
> 2. Press [Next] to select WORKOUT.
> 3. Scroll through the available workouts ... and select with [Next].
> 4. Press [Start Stop] to start your exercise recording. The guidance starts when the
>    recording starts. The interval workout display is shown as the last display of the
>    selected sport mode.

The live guidance display itself, also verbatim:

> Top row: current measurement according to segment target ... Graph: a complete picture of
> the current segment. The top and bottom of the graph are the upper and lower limits for the
> segment. The left and right ends of the graph are the start and end of the segment. The line
> drawn in the graph shows your current effort relative to the segment duration and limits.
> Bottom row: remaining time, distance or calories left before the segment is completed ...
> Segment step [shown as "3/8"] / Duration / Target limits [shown as "4'30 - 4'00"]

**This is a real, dedicated, graph-rendering guided-workout screen** - a live line plotted
against upper/lower bounds over the segment's duration, a segment counter ("3/8"), automatic
insertion as the sport mode's last display, and an automatic `END WORKOUT` options-menu entry.
Materially richer than the plain numeric `prefix`/`postfix`/`RESULT` text field Seb's App Zone
scripts (Findings 6-8) actually produce.

**Training programs / planned moves (the schedule layer, Finding 3's `TrainingProgramAreaConverter`),
on-watch flow, verbatim**:

> Plan individual moves under MY MOVES or use (or create) a training program under
> PLAN & CREATE in Movescount.com and add the program to your planned moves. Resync ... to
> download planned moves to your watch ... Store up to 60 planned moves in your watch.
> Press [Next] to check your watch to see if you have a planned target for the day. If you
> have multiple planned moves for the day, press [View] to see each move target.

Screen mockups show `Today 1/2` / `Today 2/2` with `75 min` / `30 km`, activity name
(`Running`), and duration (`240 min`) all on one screen - direct, real-world confirmation that
Finding 3's medium-confidence field guesses for `TrainingProgramAreaConverter`
(`distance`/`duration`/`activityName`/`activityId`) are the right fields, not just a plausible
decompiled-code reading. Guidance during the move is speed- or HR-based (`79bpm` / `189bpm`
shown as low/high target), with 50%/100%-complete indicators, and future targets roll forward
by weekday or by date. `startTime` and `completed` (Finding 3's other two guessed fields) map
cleanly onto the weekday/date rollover and the "planned vs done" state this flow implies.

**The open question this raises for Finding 8's plan**: grepped this project's full decompiled
backend (`assets/`, `full-assets/`) for `interval`, `guidedworkout`, `workoutdisplay` and
close variants - zero hits anywhere. That graph-with-bounds display doesn't obviously
correspond to anything in `EXERCISE_MODES_DISPLAY`/`DISP_FIELD` (this session's own decoded
`CustomModes` format, `custom_modes_andre.md`) - which only describes plain text/numeric
fields (`DISP_FIELD_SHORTCUT`, a 2-byte field id), nothing resembling a bounded live graph or
an auto-inserted "last display of the sport mode" slot. The working hypothesis, **not
confirmed**: this graph screen is a dedicated native firmware display type, driven directly by
structured step/target data from a `guidance` rule's `.Binary`, entirely separate from the
generic App-Zone display mechanism Seb's scripts (and Finding 8's proposed source generator)
actually use. If true, Finding 8's plan would still produce a real, useful guided-interval
feature - but with Seb's plain numeric text display, not this native bounded-graph screen. Not
chased further this session; would need either a real `.Binary` example to check against, or
closer study of how firmware picks what to render as a sport mode's "last display."

## Finding 10: Suunto's own tutorial confirms "just a GUI for a Suunto App" is right about the mechanism, wrong about the payload

André asked directly whether the Movescount Workout Planner is "just a GUI for a suunto app
underneath," pointing at Suunto's own French tutorial
(`suunto.com/fr-fr/.../Tutoriel-le-planificateur-dentrainement`). Fetched and reviewed,
2026-08-05. It independently confirms Finding 5's schema from a third, official source (after
the openambit issue's real downloads and wanarun.net's independent builder): a workout is
"un nom, une description et un ou plusieurs segments," each segment defined by type/duration/
objective (time/distance/HR-threshold/calories/lap-based; speed/pace/cadence/power/HR-or-none
target), with an optional free-text field shown "au début du segment," and repeat blocks
(up to 99x, drag-and-drop nesting). Sync requires internet, three-step flow (plan in
Movescount -> sync -> select during exercise). The tutorial never uses the words "app," "rule,"
or "code" - purely a planning-metaphor GUI.

**Answer: right about the mechanism, not quite right about the payload.** Finding 5 already
established that server-side, a workout *is* delivered as the same `RuleID`/`Category`
(`"guidance"`)/`Source`/`Binary` object as a normal Suunto App - same container, same
`userdevices`-sync activation path already reverse-engineered this session. So yes, packaging
and delivery-wise, it's the same "Suunto App" mechanism with a nicer GUI in front and a
server-side JSON-to-bytecode compiler in between. But Finding 9's real graph-based on-watch
display (bounded live graph, segment counter, auto-inserted guidance text at segment start) is
richer than anything the *simple* App-Zone language (Finding 6's live-compiler target,
`RESULT = ...;`) can render - strongly suggesting `.Binary` for a `guidance` rule is a
different, richer bytecode format than the simple one, compiled only by Movescount's own (dead)
server, not merely the same language run through a friendlier UI.

**One new concrete fact, independent confirmation the two mechanisms are genuinely separate
systems (not just conceptually, per Finding 5, but with independently-enforced limits)**: the
tutorial states a hard cap of **5 workouts max on the Ambit3** - distinct from Finding 9's "60
planned moves" cap for the schedule layer. Two different storage budgets for two different
on-device mechanisms.

## Finding 11: the two mechanisms in plain terms, the "5" cap confirmed as the Suunto Apps slot limit, and marguslt's own architecture description

André restated the split precisely: "planned moves" is a simple daily target ("you have to run
today" - the schedule layer, Finding 3/9), "workouts" is a structured segment sequence ("3x10s
sprint, 5s recovery" - the `guidance`-rule layer, Finding 5/9/10), and guessed the 5-workout cap
(Finding 10) was really the Ambit3's general Suunto Apps limit, not a workout-specific figure.

**Checked directly, confirmed exactly**: the Movescount-era manual's own "3.35 Suunto Apps"
section states *"You can add up to five Suunto Apps to each sport mode"* - the identical number
Finding 10's tutorial gives for workouts. Real, concrete evidence for André's hypothesis, not
just a coincidence: workouts consume the same per-sport-mode Suunto App slot budget as any
other app, exactly consistent with Finding 5's REST-level finding that a `guidance` rule *is*
a Suunto App/Rule object, not a separate resource type with its own limit.

**André also quoted marguslt directly** (from the same openambit issue #257 thread as Finding
5), describing the real Movescount-era architecture precisely:

> SuuntoLink is indeed able to sync workouts to A3, but workout builder itself is only
> accessible from Movescount mobile app... It's a really weird design - all the smart bits are
> hosted by Movescount service, MC mobile app only provides graphical interface for workouts.
> Once you are finished with that tool on your phone, it just sends your creation to Movescount
> service where it gets stored and compiled into binary rule, binary is sent back to your
> mobile and synced to the watch. So there shouldn't be any technical reasons *not* to have
> this in Movescount web.

Two things this confirms, precisely, not just in spirit:

- **The mobile app was a dumb GUI; SuuntoLink (desktop/cable) could resync already-compiled
  workouts even though it could never build one.** This matches Finding 1's own mechanism
  exactly: once compiled, a workout is just another entry in the device's active-rules list
  (`RULE_ID_LIST` on the `userdevices` record) - any resync channel that pulls that record,
  cable or BLE, restores it, because by that point it's indistinguishable from any other
  installed Suunto App. Nothing GUI-specific about *restoring* one, only about *building* one.
- **The compiler was genuinely, unconditionally server-side** - "all the smart bits are hosted
  by Movescount service" - not partially client-side, not something bundled in the mobile app's
  own binary that this project's decompiled assets might still contain. Consistent with Finding
  5's own conclusion (never found in any client this project has decompiled) from an
  independent, first-hand source. marguslt's closing line - no technical reason the web client
  couldn't have had it too, purely a product decision to keep it mobile-only - reinforces that
  the actual gap is exactly one thing: that dead server-side compiler, not some additional
  mobile-specific mechanism this project hasn't found yet.

## Finding 12: searched for a real compiled workout `.Binary` example - none exists anywhere this project can reach

André asked directly for a real `.Binary` example to reverse-engineer (path (a) from the "what
would it take" section). Searched exhaustively, 2026-08-05, both local and external:

**Local, not previously fully explored**: `assets/APK/movescountapp/` turned out to hold a
full decompiled Movescount **mobile** app (Java sources + a Ghidra-decompiled native library,
`libkomposti-ng.so.c`, 1.5M lines) - the exact client marguslt described (Finding 11) as
"purely a GUI." `WorkoutSyncer.java` confirms this precisely: `uploadWorkout()` only ever sends
`Name`/`Type=guidance`/`Source`(JSON)/`OutputFormat` to the server - never a `Binary`. The
`Rule` model class declares a `Binary` field, but grepping the entire Java source tree for any
read of `rule.Binary` turns up zero hits outside this declaration - the Android UI layer never
touches it. Checked for any bundled demo/seed data (`res/raw`, the APK's own `assets/`
directory, any local `.db`/`.sqlite`/`.realm`) - nothing workout-shaped, just KML samples,
fonts, and unrelated JSON specs (`activities_specification.json` etc). No HTTP-layer capture
(`.pcap`/`.har`) exists anywhere in `assets/`/`full-assets/` - only USB/BLE device-protocol
captures against the Ambit3 itself, never a session against `uiservices.movescount.com`.

**External**: re-read all 7 comments on `openambitproject/openambit` issue #257 via the GitHub
API directly (not just the rendered page) - no raw bytes, hex, or byte arrays anywhere. Checked
both of dgvalde's gists' raw script content directly: `download_workout.sh` explicitly
`jq del(.Binary)`s the server response before ever touching it, keeping only `.Source`; checked
the gist's own revision history too (`power_workout_template.json`, 2 revisions) - template
data only, no binary field in either. Server-side retrieval is moot regardless: `uiservices.
movescount.com` is confirmed dead (Finding 5, 502, origin gone) - even the exact endpoint that
used to return it (`GET rules/{id}?type=guidance`) can't be queried live anymore.

**One real, useful thing did turn up along the way, not a full substitute but worth keeping**:
`Komposti::SmlServiceBase::handleRuleBinaryNode` in `libkomposti-ng.so.c` - the function that
decodes `Binary`'s actual wire representation. It's a per-byte integer array in the raw SML/XML
(`<Binary><item>73</item><item>65</item>...</Binary>`), reassembled into a byte vector and then
Base64-re-encoded for the Java layer. **The same shape the still-live simple compiler emits
today** (`"binary":[73,65,77,82,85,76,69,0,...]`, Finding 6's `RESULT=100` test - `73,65,77,82,
85,76,69` spells `IAMRULE`). More significantly: this function is completely generic - it
doesn't branch on `Rule.Type`, so it applies identically whether the rule is a guidance workout
or an ordinary app. Real (if indirect) evidence the same compiled-binary *container* format is
shared across both, which tempers Finding 9's "maybe it's a wholly separate bytecode" framing
toward "same container, quite possibly an extended opcode set for the richer display" rather
than "unrelated format" - still not proof, since the function only shows the wrapper is generic,
not that the VM instructions inside are identical.

**Conclusion: path (a) (reverse-engineer the compiler from a real example) is a dead end with
what's currently reachable.** Not for lack of searching - every plausible local and external
source has now been checked and ruled out specifically, not just assumed empty. Path (b) from
the "what would it take" section, refined into Finding 8's source-generation plan, remains the
only concretely buildable route: it doesn't need a `.Binary` example at all, since it targets
the already-solved simple App-Zone language directly rather than reverse-engineering
Movescount's dead compiler.

## Finding 13: the source generator (Finding 8's plan) is built and proven - a real, structured, N-step workout compiles end to end

André asked to start prototyping. Built `tools/workout.py`, following this project's own "one
file per format" convention (`ambit_app_one_file_per_format.md`) - a new file, not a branch
tacked onto an existing one.

**What it does**: takes a JSON workout (the exact schema from Finding 5/10 - `name`/`steps[]`,
each step a `type`/`duration`/`target`, plus `repeatStart`(`value`=count)/`repeatEnd` blocks),
unrolls any repeat blocks at generation time (App Zone has no arrays or loops over data -
confirmed empirically against all six of `assets/Intervals`' real scripts, Finding 8), and
emits one literal `PHASE == k` branch per expanded step - each phase auto-advances on its own
duration condition (`time`/`distance`/`ascent`, compared against the matching real built-in
variable - `SUUNTO_DURATION`/`SUUNTO_DISTANCE`/`SUUNTO_ASCENT`, confirmed to exist by name in
`SuuntoAppZoneDeveloperManual.pdf`) or waits for a lap-button press (`SUUNTO_LAP_NUMBER`,
matching wanarun.net's own duration-type menu, Finding 9), then POSTs the result to the live
community compiler (Finding 6).

**A real, previously-undocumented compiler quirk found and worked around, not guessed at**:
the first full-workout compile attempt failed (`HTTP 400 COMPILATION_FAILED`). Isolated with
minimal test cases directly against the live endpoint: `prefix = "Warm";` and `prefix =
"Warm X";` both compile fine, but `prefix = "Warm140";` and even `prefix = "Warm 120";` (a
plain space plus digits, no arithmetic) both fail. **The compiler's string-literal lexer
rejects any digit character inside a quoted string** - not documented anywhere in the manual,
found by bisecting on the live service itself, this project's usual method applied to a new
target. Original plan was to embed each phase's numeric target range directly in its display
label (e.g. `"Warm 120-140"`); reworked to plain type-word labels only (`"Warm"`/`"Fast"`/
`"Rec"`/`"Cool"`) - which is also, unforced, exactly how Seb's own real, compiler-verified
`IntervalAIO` labels its phases (never a number in `prefix`). No loss versus the honest
baseline already set in Finding 9: the numeric target range was never going to render as a
live bounded value either way, since that needs the native graph display this project hasn't
found a way to drive from App-Zone source.

**Proven end to end, twice, against genuinely different workout shapes, not just the one
example**:

1. A 12-phase workout (10-min HR warmup, 5x[3-min power interval / 90s recovery], 5-min
   cooldown - the exact shape from Finding 5's real JSON example) - compiled clean,
   `binary_length=1838`, `IAMRULE` magic confirmed byte-for-byte in the response, `Emu` (this
   project's own reference watch) in `compatibleVariants`.
2. A second workout deliberately exercising every duration type and most target types this
   tool supports in one script (`lap`-triggered warmup, distance-based pace intervals,
   time-based HR recovery, ascent-based vertical-speed cooldown, wrapped in a `repeatStart(4)`
   block) - compiled clean, `binary_length=1782`, same `compatibleVariants`.

Both used `zero` personal-settings fields - `SUUNTO_USER_HEIGHT`/`AGE`/`WEIGHT`/`MAX_HR`/
`REST_HR` appear nowhere in either generated script, closing the loop on the concern that
started Finding 8.

**What this doesn't do yet, stated plainly**: install anything. Building `workout.py` surfaced
a correction to this document's own earlier framing - the "IAMRULE install: proven on real
hardware" claim in Finding 7/8 was checked again while writing this section and doesn't hold up
as stated. The one real install this project has ever observed ("Climb counter",
`custom_modes_andre.md`) was performed by real SuuntoLink software; this project's own tooling
(`apps.py`) only *decodes* the result, it never wrote anything. So the actual remaining gap in
the pipeline isn't the compiler (solved, Finding 6) or the generator (solved here) - it's a
genuine, not-yet-attempted writer: appending a compiled `IAMRULE` blob (with its `[u16][u16]
[u32][u32 total_length]` + 32-byte name wrapper, `apps.py`'s docstring) into the `Apps` flash
region, *and* wiring a `CustomModes` `EXERCISE_MODES_RULE`/`EXERCISE_MODES_APP_META` entry so
some sport mode's display slot actually points at it - both real, both understood structurally
from this session's own decodes, neither built.

## Finding 14: a real local GUI on top of the generator - `tools/workout_gui.py`

André asked, reasonably, "compiler, generator, installer... where and how do I actually create
the interval?" - correct: nothing before this point let anyone type a workout in without
hand-writing JSON. Given a straight choice between a quick CLI helper, a plain-text format, or
starting a real GUI, André asked for the real GUI. Checked first whether there's an app to add
a screen to: **there isn't** - `assets/opensportsync-main.zip` (the base fork this project's
larger goal points at) has never been unpacked into this repo; everything built all session is
Python CLI tooling. Flagged that directly, and narrowed to a small local web GUI rather than
scaffolding the full mobile app from scratch (a much bigger, multi-session undertaking whose
BLE/device-write layer isn't wired up yet regardless).

**`tools/workout_gui.py`**: a single stdlib-only file (`http.server`, no framework, no build
step - matches this project's existing tool style), embedding a wanarun.net-style step-builder
page - add steps, pick phase type/duration type/value/target, insert repeat-start/repeat-end
markers, reorder, export/import as JSON - plus "Generate source" and "Compile" buttons that
call straight into `workout.py`'s already-proven `generate_source()`/`compile_source()`
through two small API routes (`/api/generate`, `/api/compile`). No duplicated logic - the GUI
is purely a front end on the same generator and compiler client Finding 13 already verified.

**Tested at the API layer directly**: `POST /api/generate` on André's own example ("Warm 400s,
Run 300s") returns the exact same generated source `workout.py` produces standalone;
`POST /api/compile` on the same input returns a real compiled `IAMRULE` binary (`HTTP 200`,
724 bytes, `Emu` in `compatibleVariants`) through the live server round-trip end to end. Found
and fixed one real bug while testing: path routing happened *after* the generate/compile logic
ran, so an unknown POST path never actually reached its intended 404 - any path would silently
behave like `/api/generate` as long as the body parsed as workout JSON. Fixed by checking
`self.path` before touching the body at all; confirmed both the 404 case and the valid case
independently afterward.

**Honest limitation**: this project has no way to drive an actual browser, so the on-screen
form itself (dropdowns, step reordering, repeat markers rendering correctly) hasn't been
visually verified - only the API layer underneath it has. Same standing limitation as
`workout.py`: produces a compiled binary, installs nothing (Finding 13's writer still doesn't
exist).

**First real usage feedback, same day, three fixes**: André actually used it and reported back
directly. (1) Duration input only took raw seconds - added a unit dropdown (seconds/minutes for
`time`, meters/kilometers for `distance`; `ascent` stays meters-only, matching wanarun.net's own
menu) that converts to the base units the generator expects entirely client-side, no backend
change needed. (2) Pace input took a bare decimal ("6.5") - checked
`SuuntoAppZoneDeveloperManual.pdf` directly for `SUUNTO_PACE`'s real unit (confirmed: decimal
minutes/km, range ~30 down to 0.05) and added `mm:ss` text parsing/formatting on top of that
same canonical value, so typing "6:30" now round-trips correctly to `6.5` under the hood - no
unit was actually wrong, just unfriendly to type. Flagged honestly, not fixed here: the target
range (pace/HR/etc.) still isn't read by the generated script's own logic at all - the
generator only ever checks duration-completion and shows remaining time/distance (Finding 13);
wiring live target-checking into the generated `PHASE` branches is real, separate work. (3)
André asked which of three buttons an average user should even click - fair, there wasn't a
clear answer. Collapsed to one primary action, "Create App" (compiles, which already generates
internally); moved source preview and JSON export/import behind an "Advanced" disclosure; added
a "History" section (browser `localStorage`, nothing server-side) that records every successful
compile with a timestamp, lets you reload it back into the editor, or re-download the compiled
result - directly answering the "logs" part of the ask.

**Same day: target-checking wired up for real, `workout.py`'s biggest remaining gap since
Finding 13.** Until now, `target.valueRange` was accepted by the generator but never actually
read by the generated script - purely decorative. Added a second generated block: whenever a
phase has a real target (`hr`/`pace`/`speed`/`vertical_speed`/`power`), the script now watches
the matching live built-in every tick (`SUUNTO_HR`/`SUUNTO_PACE`/`SUUNTO_SPEED`/
`SUUNTO_VERTICAL_SPD`/`SUUNTO_BIKE_POWER` - all real, confirmed in the manual, not repurposed
personal-settings fields) and fires one `Suunto.alarmBeep()` the moment it leaves
`valueRange`, debounced by a shared `OUT_OF_RANGE` own-variable so it beeps once per excursion,
not continuously. Deliberately left the live numeric display alone (still remaining
time/distance) rather than swapping it for the target value - App Zone's single `RESULT` field
can't show both, and an audible alert is the more actionable signal of the two anyway; the
target range's meaning was never going to be visually legible either way given Finding 9's
native-graph-display caveat.

**Verified against the live compiler, not just read for plausibility**: generated and compiled
a workout with both an HR-targeted phase and a pace-targeted phase - `HTTP 200`, real `IAMRULE`
binary, and (same check applied to `Run_compiled.json` above) confirmed `SUUNTO_HR` and
`SUUNTO_PACE` both appear by name in the compiled binary's own string table alongside the phase
labels - direct proof the compiler accepted and wired in the range-check logic, not merely
tolerated unused dead code.

**Same day, small follow-up**: `Suunto.alarmBeep()`/`Suunto.light()` on phase transitions were
hardcoded on since the first version of the generator. Added an optional per-step `"notify":
{"beep": bool, "light": bool}` (both default `true`, so every workout generated before this
change still behaves identically), governing the alert fired on *entering* that step -
`tools/workout_gui.py` now has a Beep/Light checkbox pair per step. Verified the conditional
emission directly against generated source for a step with `{beep:false,light:false}` and one
with `{beep:true,light:false}` - each correctly omits exactly the disabled call.

## Finding 15: a real installer path exists already - SuuntoLink's own private-apps mechanism, not a writer this project needs to build

André connected two things: (1) a new marguslt gist,
`gist.github.com/marguslt/45285960eeea849ac8576bbb89e2233d` ("RescuingSuuntoApps"), and (2) his
own recollection that Suunto Apps live somewhere inside SuuntoLink's own local install, since
Seb (the Intervals author) documented replacing them with his own apps without ever touching
Movescount.

**The gist, fetched directly** (a Colab/Jupyter notebook, saved 2020 while Movescount was
dying): a working, credentialed script that pulls a user's *private* Movescount apps/rules via
`GET uiservices.movescount.com/rules/private/`, and writes them out in the exact shape
SuuntoLink's own bundled catalog uses (`ruleId`/`categoryId`/`activityId`/`name`/
`description`/`compatibleVariants`/`userCount`/`binary`), meant to **replace SuuntoLink's local
catalog file directly**: `%localappdata%\Suuntolink\app-4.0.5\resources\app\suunto-apps\
index.json` - this project's own bundled Windows capture even has the identical file at the
identical relative path (`assets/WIndows apps/suuntoapp_local/suunto-apps/index.json`,
confirmed: a flat JSON array, 13,104 real entries, exact same field set, `ruleId`s ranging
31-13,709,263 with zero duplicates). No beep/light/notification fields anywhere in this
notebook - separate ask, answered above, not this gist.

**Better than the gist's own approach - found by reading SuuntoLink's real, current code
(`ambit/suunto_apps.js`, `parameters.js`, both in this project's own decompiled assets), not
guessed**: replacing that whole 28MB catalog file (as the 2020 notebook does, aimed at an older
SuuntoLink build) isn't actually how this current version works. It loads that big file
read-only at startup (`loadApps(path.join(__dirname, '../suunto-apps/index.json'))`), but keeps
a **separate, small, user-writable file specifically for private/custom apps**:
`getPrivateApps()` reads (and `savePrivateApps()` writes) `suunto-apps.json` (no `index` prefix
- a different, smaller file) inside `parameters.getDataDirectory()` - an Electron
`app.getPath('userData')`-style per-user data directory, **not** inside the application bundle
itself. Each private entry is even simpler than a catalog entry - just
`{"name": ..., "compatibleVariants": [...], "binary": [...]}` - which is *exactly* the shape
`workout.py`'s `compile_source()` already returns a superset of. `savePrivateApps` is real,
live code, called from `view_model.js` (SuuntoLink's own UI layer), not dead/unused - this is
the sanctioned mechanism, not a hack.

**What this means for Finding 13's open gap**: this project may not need to build an `Apps`
flash-region writer or `CustomModes` rule-wiring at all. If a compiled workout is appended to
this private-apps file, SuuntoLink's own already-proven "Add Suunto App to a sport mode" flow
(the exact one used for "Climb counter" this session) should pick it up and do the real device
write itself - reusing existing, working vendor software instead of reimplementing it. This
would fully close the "installer" gap this project has been carrying since Finding 13, without
this project ever needing to touch the flash protocol at that level.

**Not yet done, and deliberately not rushed**: two real things need pinning down first. (1) The
exact path is only confirmed for Windows (matches this project's own bundled capture); the
macOS equivalent (André's actual daily machine) is a reasoned inference from Electron's
per-platform `userData` convention and this project's own evidence that the product name is
"Suuntolink" (`suuntolink_roaming` in this project's own Windows capture) - almost certainly
`~/Library/Application Support/Suuntolink/suunto-apps.json`, but not confirmed against a real
Mac. (2) `compile_source()`'s `ruleId` is always the same placeholder (`11000001`) across every
compile - harmless for the private-apps file (which doesn't use `ruleId` at all, per the schema
above), but worth knowing before this project builds anything that writes a `ruleId` anywhere
else. This touches André's real, installed SuuntoLink data - the honest next step is confirming
the real macOS path directly (and backing up the real file before writing to it), not guessing
and writing blind.

**Closed the same day - real installer path, wrong direction for this project.** Checked
`assets/mac/index.json` (a real macOS capture André provided): byte-for-byte identical (same
MD5) to the Windows catalog already in `assets/`, confirming the bundle-relative path
(`Suuntolink.app/Contents/Resources/app/suunto-apps/index.json`) but nothing new about the
*private*-apps mechanism - it's the same big, official, read-only catalog. André checked
`~/Library/Application Support/Suuntolink/` directly on his real Mac (the path
`parameters.js`'s `getDataDirectory()` computes, confirmed via safe direct string-search this
time, not the pathological regex that had timed out earlier - `electron.app.getPath('userData')`,
package.json's real `name` field is `"Suuntolink"`) - **no such folder exists at all**. Tracing
`savePrivateApps`'s call site in `view_model.js` further (obfuscated, only partial context
recovered) turned up string-array neighbors suggesting a sync-flow trigger
(`device_connected_asko_logged_in`, `WatchSettingsShown`) - real evidence this file gets
populated by SuuntoLink *reading private apps off a connected watch*, not the reverse. That
would mean Finding 15's core hypothesis (write an entry, SuuntoLink installs it) was likely
backwards - a genuine correction, not confirmed either way by proof, just by the direction the
evidence pointed.

**André declined to test it further, for the right reason, not because the investigation
stalled**: using SuuntoLink's own local cache as an install vehicle would make this project
newly *dependent* on SuuntoLink's software being present and behaving a certain way - directly
against this whole project's reason for existing (account-free, server-free, and by extension
vendor-software-free interoperability, `project_ambit_app.md`'s own stated goal). Right call,
independent of whether the mechanism would even have worked. André copied a real, complete
macOS SuuntoLink.app bundle into `assets/mac/Contents` while investigating (code signature,
real bundle structure, Squirrel auto-update framework, Helper processes) - kept as a general
reference asset, not pursued further as an installer path.

**Where this leaves things**: Finding 13's original framing stands, unweakened - the actual
installer (appending a compiled `IAMRULE` into the `Apps` flash region, wiring a `CustomModes`
`EXERCISE_MODES_RULE`/`EXERCISE_MODES_APP_META` entry) is still real, not-yet-built work, and
now clearly the *only* on-brand path forward - not a fallback after a shortcut, but the correct
target this project's own principles were always going to land on.

## Finding 16: the real writer, tested on real hardware - CustomModes fully proven, a real out-of-bounds Apps write caught and fixed

André asked to actually build and test the writer. Built `tools/workout_install.py` (Apps
append + CustomModes wiring), verified `install_app_into_mode()` byte-exact against both real
clean captures from Finding 15's follow-up work (Mountaineering and Indoor training) before
ever touching hardware, then ran it for real.

**CustomModes: fully proven, first try, on real hardware.** Installed `Run_compiled.json` onto
`Running`'s display[0]/field[0]. Read back afterward: `RuleIdx=3` (correct, next in the global
sequence), a fresh `AppMeta` timestamp, and `FT_SHORTCUT` field showing `Type=51` - exactly
right, matching the verified encoder precisely. The write mechanism inferred for this region
(whole-region rewrite, `HASH_PADDED`, closed with `CMD_NAV_COMMIT`) turned out correct.

**Apps: a real out-of-bounds write happened, caught, root-caused, and fixed - not swept under
the rug.** The same run's Apps-region append computed offset `0x1f163e` - over two million
bytes into a 200,000-byte region - and actually sent it. Root cause, found by reading the real
Apps region rather than guessing: it now holds **three** real entries (`Climb counter`,
`Current incline`, and one never installed by this project, `Downhill Stats` - presumably
André's Mountaineering-mode addition, name unknown to this project until now), not the single
example `apps.py` was ever verified against. `apps.py`'s `total_length` field turned out to
mean something different than assumed: **a running watermark of total bytes used in the whole
region so far, not that entry's own size** - confirmed directly (the first entry's
`total_length`, 2402, exactly equals the true end of all real data now that two more apps
exist). Harmless with one entry, silently wrong with more than one - and `workout_install.py`
trusted it blindly for the append offset.

**Read back and confirmed no harm done, not just assumed**: dumped 4KB centered on the bad
write address. 1024 bytes before it and everything checked after it: pure `0xFF`, genuinely
blank/erased flash - our own 1324 written bytes sit cleanly in open space, nothing before or
after disturbed. André confirmed the watch shows no anomalies. Left the stray entry in place
rather than risk a second blind write to "clean" it - it's inert, unreferenced, in dead space.

**Fixed properly, not just worked around**: `find_apps_free_offset()` no longer trusts
`apps.py`'s per-entry arithmetic at all - it scans directly for the true end of real data (the
last non-`0xFF` byte), the same empirical method used to diagnose the incident, plus a hard
bounds check in `workout_install.py` that refuses to proceed if a computed offset would run
past the region regardless of how it was computed. `apps.py` itself got the same honest fix:
`total_length`/`binary` are only ever reported when exactly one entry is present (correct,
regression-tested against the original single-entry dump); with more than one, they're clearly
flagged as unreliable rather than guessed at again. Name extraction was *also* wrong for the
2nd/3rd entries (a stray byte or two of garbage prefix) - fixed with a more robust backward-scan
method (through null padding, then through the printable name itself), verified clean against
all three real names. Both fixes re-verified against the real 3-entry region and the original
single-entry capture, no regressions.

**Status now**: CustomModes writer fully proven on real hardware. Apps writer's dangerous bug
is fixed and dry-run-verified against the real current region, but hasn't yet been retried for
a real write - that's the natural next step.

## Finding 17: retried on real hardware - a real, hard 3-slot limit found, and a pre-existing, unrelated issue ruled out carefully rather than assumed

André retried the install with the fixed offset logic. The Apps write landed correctly this
time (offset `0xe8e`, verified in-bounds and read back matching exactly what was written). But
the actual watch screen showed **"app error"** on `Running`'s field - so did Cycling's
pre-existing "Climb counter", freshly reinstalled via real SuuntoLink for a clean control test.

**Ruled out systematically, not assumed, that this was something this project broke**:
restored both `Apps` and `CustomModes` to their exact pre-experiment byte content (confirmed
identical both times, one false-negative comparison along the way turned out to be a transient
read glitch, resolved by re-reading) - "Climb counter" *still* errored. A completely fresh
reinstall via real SuuntoLink *also* still errored, while the other two real apps ("Current
incline," "Downhill Stats") rendered fine. That two-part control (byte-exact revert +
independent vendor reinstall, both failing to fix it) is real evidence this is a pre-existing
condition specific to that one app, not anything from today's work - not an assumption made to
move on.

**The real cause of *our own* app's error, found from the dictionary, not guesswork**: checked
`custom_modes.py`'s `FIELD_TYPES` directly - only `FT_RULE_ENGINE_0`/`_1`/`_2` exist anywhere in
it, nothing beyond. `RuleIdx` isn't an unlimited global counter after all (Finding 16's
assumption) - **the watch has exactly three rule-engine slots, period**, and all three were
already occupied (Climb counter=0, Current incline=1, Downhill Stats=2). Our install correctly
computed the "next" index as 3 - a slot that doesn't exist. The encoding accepted it silently
(nothing about a BXml tag or the wrapper format inherently limits `RuleIdx`'s range), but the
watch's actual rule-engine firmware has nowhere to route it, hence the error - a real hardware
ceiling, not a bug in the byte-level encoding, which is otherwise proven correct (Finding 16).

**Reverted again** (byte-exact, confirmed) and **fixed properly**: `next_rule_idx()` now raises
a clear error rather than silently handing back an index past `RULE_ENGINE_SLOTS = 3`, naming
which slots are already taken.

**Where this actually leaves the writer**: fully proven, byte-exact, on real hardware - both
regions, verified via independent read-back, confirmed reversible via backup/restore twice
today. The one thing it cannot do on *this* watch right now is add a 4th app, because there
genuinely isn't a 4th slot - not a limitation of this project's tooling, a real property of the
device. Testing a fresh install successfully would need one of the three existing slots freed
first (Climb counter, already broken and unused, is the obvious candidate) - not attempted
today.

## Finding 18: a real slot freed via SuuntoLink's own removal - new understanding of the format, but the underlying "app error" persists even with everything else provably correct

André removed "Climb counter" from Cycling via real SuuntoLink, giving this project a genuinely
new kind of real example (a removal, not an install) - and a real, if incomplete, resolution to
Finding 17's dead end.

**What removal actually does, confirmed from real before/after bytes, not assumed**: it's not a
targeted delete - it's a **full compaction**. In `CustomModes`, Cycling's `EXERCISE_MODES_RULES`
tag disappeared entirely (not just its one `RULE` zeroed out), its freed display field's `Type`
reverted from `51` to `65534` (`0xFFFE`, `MT_NONE` in this project's own `FIELD_TYPES` dict - a
new, clean, confirmed finding: that's the real "no app assigned" sentinel, the reverse of `51`),
and - critically - **every other mode's `RuleIdx` renumbered down to close the gap** (Indoor
training 1->0, Mountaineering 2->1). In the `Apps` region, the same thing happened to the raw
bytes: `Current incline` and `Downhill Stats` both shifted to earlier offsets, and "Climb
counter" was gone entirely - a real compaction, not a tombstone/gap. `next_rule_idx()` was
fixed accordingly: it now searches for the lowest free slot in `range(3)`, not "one past the
highest used," since removal frees a specific slot rather than shrinking a range from the top.

**A real, sobering architectural consequence, confirmed rather than theorized**: this project's
own appended `Apps` entry - added by writing directly to raw flash, entirely outside
SuuntoLink's own bookkeeping - got silently corrupted by SuuntoLink's compaction (read back
afterward as `'t App'` instead of `'Ambit App'`, missing its first several characters). SuuntoLink
has no idea this project's entries exist; anything appended this way is fragile against *any*
subsequent SuuntoLink app-management action, install or removal alike. Worth remembering before
relying on this pipeline for anything durable.

**Rebuilt fresh against the now-compacted region and reinstalled** - offset and `RuleIdx`
(now `2`, correctly the new free slot) both verified correct via read-back, matching the fixed
encoder exactly, same rigor as every prior attempt.

**Still "app error."** Three real attempts now, with a different root cause ruled out each
time (wrong offset; invalid `RuleIdx`; and now, everything provably correct at every level this
project can verify - offset, bounds, slot validity, tag order, encoding - yet still failing to
render). Reverted cleanly again (confirmed byte-exact via read-back). The two remaining live
hypotheses, neither confirmed: (1) the Apps-region wrapper's `field_a`/`field_b`/`field_c`
values have only ever been copied verbatim from "Climb counter" - which is itself broken, so
this project may have been reproducing a bad reference's wrapper fields the whole time,
without ever having reliable access to a *working* entry's actual header bytes to compare
against (attempted directly - a fixed 12-bytes-before-name assumption produces nonsensical
values for "Current incline"/"Downhill Stats," the same dead end Finding 16 already hit); or
(2) something about the community compiler's output (Finding 6) itself isn't fully compatible
with this specific firmware's rule-engine runtime in a way that doesn't show up in static byte
inspection - `Climb counter`/`Current incline`/`Downhill Stats` all came from SuuntoLink's own
official bundled catalog, not this project's compiler, so a working real vs. community-compiled
comparison hasn't actually been done. Genuinely unresolved - flagged rather than guessed at a
third time.

## Finding 19: the compiler is ruled out, definitively - the problem is in this project's own wrapper construction

André pushed for a cleaner test: install our own compiled workout in *two* places at once
(Running's top field and Cycling's newly-freed middle field, both sharing one `RuleIdx` since
it's the same app) - "app error" on both, identically, checked with a GPS fix, mid-recording,
and after quitting and restarting the mode. That rules out every timing/recording-state
confound directly rather than by assumption: same result regardless of GPS state, recording
state, or app restart.

**The decisive diagnostic**: installed a real, known-good app straight from SuuntoLink's own
official bundled catalog - `ruleId=41 "Downhills"` (same activity family as the already-working
"Downhill Stats," explicitly listed as `Emu`-compatible) - through this project's *own* writer,
completely unchanged from how it installs a community-compiled app. Same result: **"app
error."** That's decisive, not just suggestive: a binary proven to render correctly when
SuuntoLink installs it *also* fails when this project's writer installs it. The community
compiler (Finding 6) is now ruled out entirely as a cause - the problem is specific to how this
project constructs the `Apps` wrapper or wires `CustomModes`, not the bytecode it's installing.

**Where suspicion concentrates now**: the wrapper's `field_a`/`field_b`/`field_c` have only
ever been copied verbatim from "Climb counter" - the one entry this project has real byte
access to, and (per Finding 17/18) itself broken. Every attempt to locate a *working* entry's
real header bytes independently has hit the same wall (Finding 16/18): the fixed
"12-bytes-immediately-before-the-name" assumption produces nonsensical values for any entry
after the first, and no alternative offset rule has been found. Reverted cleanly (confirmed
byte-exact, same as every prior test today).

**Not yet tried**: computing `field_c` (or any of the three) as a function of the binary itself
(a checksum/CRC over the entry, matching how other regions this session use `region_hash()`) -
plausible given embedded formats commonly checksum their own payload, and would explain why a
constant `12` copied from one binary breaks for every other one. Genuinely the next thing to
try, not attempted this session.

**Tried, both failed.** Checked for a dedicated "install app" command distinct from the generic
flash-write mechanism first - real evidence found (`0x0B1B write_start`, sent once before a
real write-heavy sync phase in `orbitsync`, never replicated by this project's own tools), but
it carries no payload at all, so it can't be where `field_c` comes from; the Apps region's own
base address also doesn't appear anywhere in the decompiled client as a literal constant,
consistent with the watch's firmware managing placement/compaction internally rather than a
client computing raw offsets - but neither observation pins down the wrapper fields themselves.
Tested the CRC16 hypothesis directly and empirically instead (`field_c =
crc16_ccitt_false(binary)` for "Downhills," `50038`, keeping the wrapper otherwise identical to
the already-proven-correct encoding): still "app error." Reverted cleanly, confirmed byte-exact.

**Honest status**: two real, concrete guesses at `field_c` (a constant copied from a broken
reference; a CRC16 of the binary) have both been ruled out on real hardware. The one thing this
project has never actually done for this format - unlike every other one it's solved - is
capture the *real USB wire protocol* of a working install. Every byte of understanding here
comes from diffing flash dumps before/after (the result), never from a packet capture of the
actual install messages SuuntoLink sends (the process) - because the original "Climb counter"
install (and neither of the other two apps now on this watch) was ever captured that way.
Genuinely getting past this would most likely need exactly that: a real USBPcap capture of
SuuntoLink installing a *known-working* app, analyzed the same way `orbitsync`/`route12km`/etc.
already were - this project's own established, successful method for every other format, not
yet applied to this one. Not attempted this session; flagged as the real next step rather than
continuing to guess field values on live hardware.

## Correction to "what actually getting this feature back would take": both paths now have a real primary source to check work against

Finding 9 changes the "no ground truth" framing in Finding 3 and the earlier "What was actually
tried" section for the schedule layer specifically: the manual's own screen mockups (field
names, values, and the 50%/100%/weekday-rollover behavior) are now a real, if informal, source
to sanity-check any future decode against - better than decompiled code alone, though still not
a byte-level capture. For the rich interval-workout side, Finding 9 doesn't produce a compiler
or a capture, but it does clarify precisely what the *authentic* on-watch experience looked
like, which matters for being honest with André about what Finding 8's generator would and
wouldn't reproduce.

## Finding 20: stepped back from the flash writer, built the documented community path instead - packaged as a standalone app

André chose not to keep chasing Finding 19's open question for now, and asked instead for a
version of this that just produces the compiled JSON the way `forum.suunto.com/topic/7592`'s
first post describes - "grab the response, it has the same format as used by SuuntoLink,"
appended into SuuntoLink's own bundled `suunto-apps/index.json` so SuuntoLink's own,
already-working "Add Suunto App" flow does the install. This sidesteps Finding 19's dead end
entirely - it was never a `workout.py` problem, only `workout_install.py`'s flash writer, which
this doesn't touch.

`tools/workout_gui.py` already did the generate+compile half unchanged; added the other half,
`tools/suuntolink_catalog.py` - auto-detects the real `index.json` path per OS (confirmed exact
paths from the forum post), backs it up before every write, assigns a fresh collision-free
`ruleId` (the compiler always returns the same placeholder, `11000001`, which would collide on
a second use), and appends. Found and fixed a real bug while testing it against a real catalog
file directly: the backup filename used `int(time.time())`, 1-second resolution - two adds in
the same second silently overwrote the first backup with the second's already-modified state.
Fixed with `time.time_ns()`; re-verified two sequential adds keep two genuinely distinct
backups.

**Packaged as an actual standalone app**, per André's ask (Windows, and Mac Intel+ARM from one
machine via a universal2 build), using PyInstaller - straightforward since both files are
pure standard library, no third-party dependencies to bundle. Verified for real, not just
written: built and ran the packaged executable on this machine (Linux, the mechanism is
identical cross-platform, only the Windows/macOS binaries themselves need building on those
OSes) - it served the page and completed a live compile through the network from inside the
frozen executable. Caught and fixed a second real mistake before it shipped: PyInstaller mostly
ignores CLI build flags once handed an existing `.spec` file, so `--target-architecture
universal2` on the command line would have silently done nothing - fixed by reading the target
architecture from an environment variable inside the spec file itself, confirmed correct
against PyInstaller's own generated reference spec for that flag.

Also documented the honest path toward the third ask, Android/React-Native integration - not
built, since this project's own installer question is still unresolved and there's nothing
concrete to integrate yet, but `workout.py` was already architecturally ready for it (zero
OS/GUI dependency) and the realistic next step is porting its ~250 lines to TypeScript, not
embedding Python. Full detail: `tools/packaging/README.md`.

**Same day, follow-up: Linux added as a fourth target, and actually built (not just
scripted).** André asked for Linux too and to build all of them now. Linux is the one this
project's own environment can build directly - `tools/packaging/build_linux.sh` added, and
`dist/linux/Ambit3 Workout Builder` is a real, finished build, verified the same way as the
mechanism-check earlier (served the page, completed a live compile over the network from the
frozen executable). Windows and Mac remain genuinely blocked on cross-compilation - PyInstaller
cannot produce either from this Linux environment - so those two still need running their
respective scripts on their own OSes; nothing new there technically, just made explicit rather
than implied. One Linux-specific honesty note added to `packaging/README.md`: SuuntoLink has no
Linux build at all, so "Add to SuuntoLink" will always correctly report "not found" there -
`suuntolink_catalog.py` already says so rather than searching pointlessly; the compile half
works identically to every other platform.

**Same day, further follow-up: five real refinements, each verified, not just implemented.**
(1) All three build scripts now detect Python/PyInstaller themselves - missing PyInstaller
installs into a throwaway local venv (`tools/packaging/.build-venv`), sidestepping Debian/
Ubuntu's "externally managed environment" pip restriction entirely rather than fighting it;
missing Python prints the right install command (Linux/Mac) or tries `winget` then falls back
to opening the download page (Windows) - rebuilt the real Linux app through this exact new
script and reverified it end to end. (2) Linux's install-side button is now "Open .json folder"
and does only that - no doomed SuuntoLink attempt at all, since SuuntoLink doesn't exist there;
a new `/api/open-folder` route plus a `~/AmbitWorkouts` save-on-every-compile folder (all three
OSes) is what it opens - verified for real (file genuinely lands on disk, folder genuinely
opens). (3) Windows/Mac's SuuntoLink backup naming changed to the requested `index_old.json`
form (one generation, overwritten each write, by explicit request rather than the earlier
timestamped scheme) - re-verified against a fake catalog file. (4) Confirmed and hardened
offline behavior: the page itself was already fully self-contained (checked directly - zero
external resources), and `compile_source()` now catches connection failures specifically
(`urllib.error.URLError`, previously only HTTP-level errors were caught) so an offline compile
attempt fails with a plain message instead of an unhandled exception. (5) Researched, not
guessed, the real OS floor: SuuntoLink's own `Info.plist` states macOS 10.11, but PyInstaller's
own current requirement is 10.15 - higher, so that's the real number; SuuntoLink's real Windows
installer script bundles the Universal C Runtime for pre-Windows-10 systems (real evidence of
old-Windows support), but PyInstaller's own floor is Windows 8 - within what SuuntoLink already
tolerates, so that's what binds. Full detail in `packaging/README.md`'s new "Supported
operating systems" section.

**Same day, one more real gap found and closed**: André asked, reasonably, whether a `.json`
compiled on the Linux build could actually be used on a Windows SuuntoLink install. The honest
answer was "not yet" - History (browser `localStorage`) doesn't carry over between machines, so
a file compiled on Linux and copied to Windows had nowhere to go once it arrived. Added "Import
compiled JSON" (Advanced section) to close that: load the file, get the same "Add to
SuuntoLink" button a fresh compile would show. Verified the full chain directly - a real
compiled JSON's shape matches what the import validates for, and feeding it through reaches the
same `/api/add-to-suuntolink` code path unchanged. Rebuilt and reverified the real Linux app
with this included.

**Same day, a real incident on André's actual Mac SuuntoLink install, root-caused precisely and
fixed at the source rather than patched around.** André manually replaced the real `index.json`
with a downloaded compiled file (not the app's own "Add to SuuntoLink" button) and SuuntoLink
broke: "unknown error," "apps not iterable," blank sport-mode screens. Confirmed the exact cause
directly from the original method's own author (re-fetched `forum.suunto.com/topic/7592`, Pavel
Samokha): "in index.json it's an JSON array, but compiler output is one json object with
assumption that user might want to add it to existing array of apps, not replacing it
completely with one" - precisely what happened. Checked `assets/Intervals` too, at André's
request, in case Seb's own materials said anything about this - zero mentions, his workaround
never touched `index.json` at all. Confirms this project's own `add_entry()` was never wrong
(it already reads-appends-writes the real array, never replaces the file) - the break happened
specifically from bypassing the tool. André's own `_old` backup got him back to working
immediately, which is exactly what it's there for. Given a real user hit this exact danger once
already, added an explicit, prominent warning in the app's own UI and in
`packaging/README.md` rather than leaving it as something only the source code protects
against - rebuilt and reverified the real Linux app with the new warning present.

**Same day, one more Linux refinement following directly from that incident.** André asked, a
better idea than the plain "Open .json folder": since Linux has no automated path to
SuuntoLink at all, the button should open real instructions, not just an unexplained folder of
files. Replaced it with "Open instructions" - opens a real README written into
`~/AmbitWorkouts` (refreshed on every compile) spelling out the copy-to-Windows/Mac,
Import-compiled-JSON, Add-to-SuuntoLink workflow explicitly, plus the same "never replace
index.json by hand" warning from the incident above. Addressed André's own Wine question
honestly rather than building around it untested: Electron apps (which SuuntoLink is) are
historically unreliable under Wine, so it's noted as a real possibility nobody has tried here,
not something this project treats as a supported path. Rebuilt and reverified the real Linux
app end to end with the new behavior.

**Same day, first real Mac build attempt: four issues found from actually using it, three
fixed directly, one left as a real open question.** André built and ran the packaged app on
his own Mac for the first time.

1. `tools/packaging/.build-venv` (a Python venv built here on Linux while testing) had never
   been added to `.gitignore` and traveled along with the repo copy to his Mac - venvs bake in
   absolute paths of the machine that created them, so his `build_mac.sh` failed with "bad
   interpreter: No such file or directory" pointing at a Linux path. Fixed by adding
   `tools/packaging/.build-venv/` and `build/` to `.gitignore`; André unblocked himself by
   deleting the stale folder so the script rebuilt a real venv with his own Python (a second
   attempt hit the identical error only because the `rm -rf` was run from inside
   `tools/packaging` itself, so the given relative path pointed nowhere and deleted nothing -
   resolved once run from the right directory).
2. Double-clicking the built `.app` did nothing visible, while running it from Terminal worked
   - almost certainly first-launch Gatekeeper blocking an unsigned/unnotarized app silently
   (no dialog most people notice) rather than a real code bug, but the spec's `console=False`
   means *any* startup failure is completely invisible either way. Added defensive logging
   (`main()` now catches a startup `OSError`/exception and writes it to `~/AmbitWorkouts/
   app.log`, and opens the browser at the existing instance instead of dying if the port's
   already bound - most likely cause of a silent "double-clicked twice") plus explicit
   Gatekeeper right-click-Open instructions in `packaging/README.md`. Also had `build_mac.sh`
   copy the built `.app` straight into `/Applications` automatically, since that's where André
   expected it and PyInstaller's own `dist/mac/` output isn't an obvious location otherwise.
3. `compatibleVariants` in the compiled-app result showed Suunto's internal engineering
   codenames (Duck, Emu, Colibri...) instead of names anyone would recognize. Mapped using
   `history.md`'s own confirmed codename table (Bluebird=Ambit, Duck=Ambit2, Colibri=Ambit2 S,
   Greentit=Ambit2 R, Emu=Ambit3 Peak, Finch=Ambit3 Sport, Ibisbill=Ambit3 Run, Kaka=Ambit3
   Vertical, Jabiru=Traverse, Loon=Traverse Alpha) - client-side JS translation only, the
   compiler's own response is untouched.
4. **Real, unresolved**: "Add to SuuntoLink" failed on his actual Mac with "index.json doesn't
   look like a JSON array - refusing to touch it" - `suuntolink_catalog.add_entry()`'s existing
   safety check (never blind-write into something that isn't the expected shape, same standing
   principle as the flash-writer bounds-check lesson, Finding 16) correctly refused rather than
   guessing. Real cause not yet known: could be a SuuntoLink auto-update since this project's
   captures were taken changing the schema, or something left over from the original manual
   `index.json` replacement incident above. Asked André for a safe, read-only diagnostic
   (`python3 -c` one-liner printing the file's real top-level type/keys) rather than patching
   `add_entry()` blind against a live, already-once-corrupted file - answer pending.

Also added an explicit disclaimer, both in the app's own UI and in `packaging/README.md`: not
affiliated with/endorsed by Suunto, watch names used only to describe compatibility, provided
as-is with no warranty, not responsible for malfunction/data loss/damage from use, test
carefully. Requested directly by André after the real Mac issues above underscored it's worth
stating plainly.

## Finding 21: a pass through `tools/NewSources.md`'s community links, 2026-08-07 - a real new lead on the wrapper-bytes question, a cheaper repeat-encoding technique, and calibration data this project never had

André asked for the 11 links in `tools/NewSources.md` to be checked against everything this
project has found on apps/workouts/training plans, to see whether any of it is genuinely new
rather than already covered. Most of it confirms what's already here word-for-word (`wanarun.net`
and `runningsolidaire.net` both match Finding 8/9/10/11's description of the step/target model
almost exactly; `claha/suunto`, `follesoe/suunto-ambit-intervals`, `AdamHodgson/Suunto-Interval-
Training` and `hefler/SuuntoApps` are all pure App-Zone-language examples, consistent with the
already-solved `IAMRULE` layer). Four things are genuinely new.

**A real, previously-untried candidate for Finding 19's open wrapper-bytes question.** The
marguslt gist `gist.github.com/marguslt/a79ea204f99b45ab015b6ed1ff7529a4`, fetched in full
(not just the summary this project already had) rather than only its rendered page, shows every
Movescount `Rule` object - workout or plain app alike - carrying a field never seen in this
project's own captures: `TargetVirtualMachineVersion: "0.08, build 15.8.18.0"`, a VM/bytecode
version tag tracked separately from the compiled `Binary` itself. Finding 19 already ruled out
two concrete guesses at `field_c` (a constant copied from a broken reference; a CRC16 of the
binary) on real hardware - a VM-version-shaped value is a third, concrete, not-yet-tried
candidate, and it comes from a real API response rather than a guess. Worth testing directly the
next time the watch is available, same conservative protocol as before (read-compare-revert).

**The same gist also documents a device-scoped workout-listing endpoint this project didn't
have**: `GET userdevices/$AMBIT_SN/rules?type=guidance` - workouts already active on one specific
device, as opposed to the account-wide `rules/private` this project already knew from Finding 1.
Directly relevant to `unresolved_questions_for_devs.md` #1 (what `categoryId`/tag value means
"guidance" and whether anyone's confirmed it changes on-watch presentation): the `type=guidance`
query parameter is itself evidence the server side treats guidance-tagged rules as a first-class,
separately-filterable category, not just an untested tag value - still doesn't answer whether the
Ambit3 firmware itself special-cases it, but it's a firmer starting point than before. The
underlying write mechanism it reads back from (`PUT userdevices/.../?resetchangedsettings=true`
with `Settings.RuleIDs`) matches Finding 1 exactly - no surprise there.

**A cheaper repeat-block encoding technique, not currently used by `tools/workout.py`.**
`github.com/claha/suunto`'s Python generator encodes a repeat block as one conditional per
step-position using `Suunto.mod(STEP, N)` - `if (Suunto.mod(STEP,N) == (i+step)%N && STEP >
step-1 && STEP < step+N*count)` - rather than fully unrolling every repeat iteration into its own
set of branches. `tools/workout.py` currently unrolls. Since App Zone binaries have a hard
compiled-size ceiling (see next paragraph), this is a real, lower-code-size alternative worth
considering for workouts with high repeat counts, not yet tried here. The same repo's
elapsed-since-step-start pattern (`STEPTIME = SUUNTO_DURATION - STEPSTARTTIME`, reset when
`SUUNTO_DURATION==0`) is also cleaner than absolute-duration comparisons, for the same reason.

**Actual calibration numbers for the compiled-size ceiling this project only had described
qualitatively before.** `AdamHodgson/Suunto-Interval-Training` and `hefler/SuuntoApps` both give
real, historical compiled-size percentages for real installed App Zone scripts on real watches:
18-48% on Ambit3-family devices, up to 86% on an original Ambit for a 5-variable interval script.
First concrete numbers this project has for how much of the per-device size budget a realistic
structured workout actually consumes - useful context for deciding whether the unrolling-vs-
`Suunto.mod()` tradeoff above is worth pursuing now or only if a future workout hits the ceiling.
`hefler`'s own carbs-countdown app is marked explicitly incompatible with the original Ambit and
the Ambit3 Vertical, consistent with (not new beyond) the already-known `Suunto.round()`/
Ambit3-Vertical incompatibility.

**Two smaller, non-actionable corroborations**, both from dead infrastructure so informational
only: the dgvalde gist `gist.github.com/dgvalde/4bb9a9dc2162c27440a978b217c01b7e` gives a second,
distinct third-party Movescount API key and the real client User-Agent
(`Komposti/2.29.0 (Android=5.1.1) ArREST/1.0 libcurl/7.47.0`), independently corroborating
"Komposti" as the real product name behind `libkomposti-ng.so` already central to this project.
And fetching `RescuingSuuntoApps.ipynb`'s raw notebook JSON directly (its rendered page failed
locally before) shows its own catalog-building code only ever exports `rule['Type'] == 'generic'`
rules with `categoryId: 1` - it never attempts a `guidance`-type rule either, which is mild
supporting evidence (not proof) that nobody in the wider community has actually done what
`unresolved_questions_for_devs.md` #1 is asking, rather than this project having simply missed
where someone already did.

**Nothing here contradicts anything this document or `HANDOFF.md` already treats as settled.**

Sources for this section, all fetched 2026-08-07 from `tools/NewSources.md`:
`github.com/AdamHodgson/Suunto-Interval-Training`,
`github.com/openambitproject/openambit/issues/257`,
`github.com/openambitproject/openambit/issues/256`,
`gist.github.com/dgvalde/9e00a590388224122bd7d295f886bced`,
`gist.github.com/dgvalde/4bb9a9dc2162c27440a978b217c01b7e`,
`gist.github.com/marguslt/a79ea204f99b45ab015b6ed1ff7529a4`,
`gist.github.com/marguslt/45285960eeea849ac8576bbb89e2233d`,
`github.com/follesoe/suunto-ambit-intervals`, `github.com/claha/suunto`,
`github.com/hefler/SuuntoApps`, `www.wanarun.net/suunto-ambit/`,
`runningsolidaire.net/post/114791440029/suunto-ambit-workout-planner-movescount-app`.

## Finding 22: the real Apps-region wrapper is not what `apps.py`/`workout_install.py` assumed - a whole field is missing, and the "hard 3-slot" limit (Finding 17) was very likely a misdiagnosis of the same Finding 19 wrapper bug

André asked to get back to the workout thread and test Finding 21's `TargetVirtualMachineVersion`
guess for `field_c` on real hardware. Before writing anything, a read-only pass over the current
live watch (2026-08-08) turned up a real, richer Apps region than any previous capture - 6 raw
entries where earlier sessions only ever saw 1-3 - and decoding them properly changes the plan.

**CustomModes now has 5 real `RuleIdx` assignments (0-4), not 3**, spread across 4 sport modes
(Cycling has 2, Run a route/Trekking/Indoor training have 1 each). This directly contradicts
`workout_install.py`'s `RULE_ENGINE_SLOTS = 3` - which was never a firmware fact, just an artifact
of `custom_modes.py`'s `FIELD_TYPES` dictionary happening to only have names for
`FT_RULE_ENGINE_0/1/2` (nothing higher was ever seen before). The movescount-era manual's own
text (3.35 Suunto Apps, re-verified directly this session) says "you can add up to five Suunto
Apps to **each sport mode**" - not a whole-watch total, and not three. Since Finding 19 already
proved definitively that the real "app error" is caused by wrapper construction, not slot count,
Finding 17's "RuleIdx=3 causes app error, therefore only 3 slots exist" conclusion was almost
certainly the same wrapper bug misattributed to a slot limit, tested before the real cause was
known. `RULE_ENGINE_SLOTS` should be treated as unconfirmed/likely-too-low from here on, not as a
hard ceiling.

**Decoding the 6 raw entries exposed that `apps.py`'s "44 bytes back from the IAMRULE magic"
header heuristic only produces sane values for one entry - the one this project's own writer
made.** `'Downhills'` (a leftover from Finding 19's test-write, never actually cleaned out of the
Apps region even though its CustomModes wiring was reverted - it's inert but still physically
there) decodes to field_a=1/field_b=3/field_c=12 exactly because that's the hardcoded default
`build_apps_entry()` writes - circular, not independent confirmation. The other 5 entries, all
real SuuntoLink installs, decode to nonsense at that fixed offset (duplicated, physically
impossible values like a `total_length` of 521338884) - the heuristic is landing inside the
*previous* entry's binary, not a real header.

**Only 3 of the 6 entries are genuinely distinct apps - the other 2 are exact, byte-identical
duplicates**, confirmed by diffing the actual compiled binaries (not just names):
`Sunrise/Sunset` and `Heart Rate Zones1-5` each appear twice; `Current incline` once. That's
consistent with SuuntoLink assigning the same catalog app to two different sport modes and
writing a fresh physical copy each time rather than deduping - and it maps exactly onto the 5
real `RuleIdx` slots (2+2+1=5).

**Using the duplicate pairs as a differential probe found the real binary lengths precisely**,
without guessing: since two copies of the identical binary are each followed by a *different*
next entry, the byte offset where the two copies stop matching is the true end of that shared
binary. `Sunrise/Sunset` = 1518 bytes, `Heart Rate Zones1-5` = 365 bytes.

**Right at that boundary, every real entry has a small structured field immediately before its
name that `build_apps_entry()` never emits at all**: a 2-byte value that matches the app's real
`activityId` from the actual SuuntoLink catalog (checked against
`assets/issue_workout_builder_windows/index.json`: 1 for `Sunrise/Sunset`, 3 for both
`Heart Rate Zones1-5` and `Current incline`, both real matches), followed by a 1-byte marker
(0x76/0x78/0xc9 respectively - not yet decoded, possibly a checksum or per-install tag) then the
name. This is present on every real entry checked and absent from every entry this project's own
writer produces. It's a materially more concrete candidate for the persistent "app error" than
Finding 21's `field_c` guess: not a wrong constant, but a missing field in the wrapper shape
itself. Further back in each entry's preamble there's also what looks like floating-point data
that differs between the two installations of the same app (e.g. HR Zones' two copies have
different preceding bytes) - not yet decoded, plausibly per-mode configuration, genuinely open.

**Net effect on Finding 21's plan**: testing the `TargetVirtualMachineVersion` guess for
`field_c` on hardware now would be testing the wrong layer. Real next step, not yet done: decode
the rest of the real preamble (the activityId field's own neighbors, the marker byte, and the
floating-point-looking block further back) well enough to make `build_apps_entry()` emit the real
shape, before attempting another live install test.

## Finding 23: RuleIdx is the app's own position in the Apps-region listing, not a slot count - confirmed cleanly on a real 11-entry region; the "marker byte" theory from Finding 22 did NOT survive more data and is retracted

André installed several more real apps via SuuntoLink between sessions (asked for a count,
"considering the 5-per-mode limit" he'd independently confirmed from the manual). Re-reading the
live watch found the Apps region had grown from 6 to 11 entries and CustomModes now shows 6
`RuleIdx` assignments: 0, 1 (Cycling's two apps), 7 (Run a route), 8 (Pool swimming, newly
assigned), 9 (Trekking), 10 (Indoor training).

**Cross-referencing those two numbers directly settles what `RuleIdx` actually is.**
`apps.decode()`'s entries, in physical order, are: 0=Sunrise/Sunset, 1=Heart Rate Zones1-5,
2=Cooper estimate, 3=PYRAMID INTERVALS, 4=Half-marathon time, 5=Real Temerature,
6=Marathon/halfM/10k/5k time estimation, 7=Heart Rate Zones1-5 (2nd copy), 8=25m Swimming pool
counter, 9=Sunrise/Sunset (2nd copy), 10=Current incline. Every single real `RuleIdx` in use
(0, 1, 7, 8, 9, 10) matches that app's own 0-based index in this list, exactly, no exceptions.
**`RuleIdx` is simply "this app's position in the Apps region's current physical entry order"** -
not a small enumerated hardware slot at all, and not per-mode. It keeps growing with the whole
region's install history (already at 10 here, with each individual mode still only holding 1-2
apps) - fully explaining why it kept jumping around across sessions (2,3,4 -> 7,9,10) as more
apps were added in between: it's recomputed from current physical order, not a stable persistent
ID. `next_rule_idx()`/`check_mode_app_limit()` in `workout_install.py` are rewritten around this:
the new RuleIdx is just `len(apps.decode(current_apps))`, and the real, separate, per-mode 5-app
cap (3.35 Suunto Apps) is checked against that specific mode's own `Rules` count instead.

**Retraction**: with 6 new real entries to check the "activityId + 1-byte marker" theory
against, it didn't hold up. `Cooper estimate` and `Real Temerature` have clean names with no
separate marker byte at all (unlike `Sunrise/Sunset`/`Heart Rate Zones1-5`/`Current incline`,
which do), and `25m Swimming pool counter`'s leading "2" is real app-name text (a pool length),
not a marker - a naive re-application of the same backward-scan wrongly ate it as one, which is
exactly what exposed the mistake. The apparent "activityId" 2-byte match for the original 3
samples was very likely coincidental, not a real fixed field. Standing conclusion, confirmed
harder now: `apps.py`'s "N bytes back from magic" approach cannot be generalized into a real
per-entry header no matter how it's tuned - **the actual C++ struct needs to come from the
decompiled source directly** (grep `SDSApplicationServer.exe.c`/`libkomposti-ng.so.c` for
whatever builds this on-device entry), or from a genuine USB capture of a real SuuntoLink
install (never obtained - Finding 19's "genuine gap" still stands), not from further flash-diff
guessing against installed apps whose own on-flash layout this project doesn't independently
control.

## Finding 24: real evidence training_program.py's start_time=0 default is invalid - fixed

While hunting the Apps-wrapper struct in the real iOS Suunto app binary (André's own
`assets/mac/suunto app ios`, added this session), found a literal validation string:
`TrainingProgramAreaConverter::createBinary: no valid start time`. This is the real class this
project's own `training_program.py` targets (Finding 2/3) - direct evidence `start_time=0`
(the tool's original default) is treated as invalid/unset by the real client, not a safe
placeholder. The 2026-08-05 test-write using 0 "landing correctly" only proved the flash-write
round-trips byte-exact - it never proved real client/firmware logic would accept the item, and
this string says it wouldn't. Fixed: default changed to 1, and `build_training_item()` now
raises outright on `start_time=0` rather than silently sending a value now known to be rejected.
The *correct* non-zero encoding (day-of-month? days-from-today? something else entirely - it's
a single byte, max 255) is still unknown - 1 is the simplest non-zero placeholder, not a
verified date encoding. `--start-time` is now a CLI flag rather than hardcoded, so a real test
can try different values without editing the file.

## Finding 25: the Apps-region wrapper is SOLVED - real USBPcap captures of SuuntoLink actually installing apps, the "genuine gap" from Finding 19, turned out to already exist in assets/

André had real captures of exactly this operation the whole time
(`assets/ambit3 pcap/v2/{ambit3addapptoexistingsportmode,installappontrekking,
installcyclingappmiddlescreenheartzone1-5,appstopscreensunrisunset}`) - the missing real
capture Finding 19 spent real effort trying to get via Ghidra decompilation of the Windows
binary, then the iOS/Mac Suunto app binary (both dead ends - see below), then a proposed
Wireshark USB capture that was about to be walked through by hand. Checking `assets/` for
existing pcaps first would have shortcut all of that.

**The real format, decoded byte-exact from 4 independent real installs plus a real live
11-entry region, zero exceptions across ~20 real entries checked:**

    [u16 num_entries][u16 unknown2][u32 entry_offset]*num_entries [u32 total_length]
    then, per entry, back to back starting at its own entry_offset:
        [u8 reserved=0][u8 activityId][u8 marker][name, null-padded to 29 bytes]
        [8-byte "IAMRULE\0" magic][binary bytes, up to the next entry_offset or total_length]

A real, self-describing directory - not the flat guessed-header-per-entry shape this project
had assumed since Finding 16. `num_entries` matches the real entry count in every sample.
`table[0]` always equals the directory's own byte size exactly (4 + 4*(num_entries+1)) - a real
structural invariant, not a coincidence. `activityId` matches the app's real catalog
`activityId` for every entry with a catalog match (checked against
`assets/issue_workout_builder_windows/index.json`). `total_length` (the table's last value)
always equals the real write's own total length exactly. **The whole region - directory plus
every existing entry - is rewritten on every single install, not appended to**: this alone
explains every earlier "the header fields look inconsistent across entries" observation
(Findings 22/23) without needing any per-entry-format theory - those were reads of different
full-region-rewrite generations, not an unstable format.

**Also confirmed from the same captures: `HASH_WRITTEN`/SHA256 is exactly right for the Apps
region's commit hash** - computed SHA256 over just the real written bytes of one capture
matches its real captured `0x0b18` tail hash exactly. `ambit_format.py` already assumed this by
analogy; now independently confirmed.

**Correction to Finding 23's retraction**: the "activityId + marker" theory (Finding 22) was
right. Finding 23 called it wrong after testing it against 6 new real entries, but that test used
a backward-scan-from-magic heuristic to *find* each entry - the same kind of heuristic every
earlier version of this format's decoder used and which this whole investigation's history
(Findings 16-19, 22, 23) kept tripping over. With the real fixed-offset block location (known
from the directory table, no scanning needed), those same "disproving" entries (`Cooper
estimate`, `Real Temerature`, `25m Swimming pool counter`) decode cleanly with correct
`activityId` values. The theory wasn't wrong; the method checking it was.

**Still open**: `unknown2` (varies 1, 1, 6, 7, 9 across the 5 real samples checked - not entry
count, not a direct RuleIdx match) and `marker` (consistent for a given real app across every
capture checked - e.g. `Sunrise/Sunset` is always `0x76`, `Heart Rate Zones1-5` always `0x78` -
but the rule assigning it isn't determined; two different apps have been seen sharing the same
marker, ruling out "hash of the name" cleanly). `apps.py` and `workout_install.py` are rewritten
around the real format; both new writer functions are tested by round-tripping a real 3-entry
capture through `build_apps_region()` and confirming the 3 original entries survive byte-exact
alongside a correctly-appended 4th - genuinely new coverage, not present before.

**What this makes obsolete, for anyone reading this project's history in order**: the entire
Ghidra detour (installing Ghidra, analyzing the decompiled Windows `SDSApplicationServer.exe`,
then the iOS/Mac `Suunto` binary - both hit real dead ends: `IAMRULE` appears in zero client-side
code across Windows/Android/iOS, meaning the wrapper is firmware-side and was never going to be
in a client decompile; the iOS binary's own Ghidra analysis got stuck twice on real Ghidra
limitations with obfuscated Swift, `VarnodeContext: out of address spaces` and a switch-analyzer
infinite retry) and the proposed Frida/CoreBluetooth-hook plan (wrong target entirely - Ambit3's
sport-mode/Apps configuration only ever syncs over USB cable via SuuntoLink, never over BLE via
the modern mobile/Mac Suunto app, which is the whole reason this project exists) were all real
effort spent looking for something that was already sitting in `assets/`. Worth remembering:
check what real captures already exist before reaching for static/dynamic analysis of client
software as a way to infer a wire format.

## Finding 26: slot-Type bug fixed - FT_RULE_ENGINE_0/1/2 are three distinct display slots, not one "51" sentinel

First real hardware install attempt (2026-08-09, myworkout onto Walk display 0). A trivial
second app (`RESULT = 100;`, zero dependencies) was then installed to Walk display 0 field 1 to
get a GPS/recording-independent readout - and read back as TWO fields both of Type 51. Root
cause: `install_app_into_mode()` hardcoded Type 51 for every field. Real CustomModes has three
distinct app-display slot Types - `FT_RULE_ENGINE_0/1/2` = 51/52/53 ("Suunto App Slot 1/2/3" in
custom_modes.py's own FIELD_TYPE_LABELS). Fixed: `next_app_slot_type()` picks the lowest unused
of 51/52/53 for the target mode. This is DISTINCT from SPORT_MODE_APP_LIMIT (5): a mode may have
up to 5 apps *assigned* (rules) but only 3 can be *shown* on display fields, since only 3 slot
Types exist. Confirmed on hardware: reverted the duplicate cleanly, reinstalled to slot 52,
read back correct (51 + 52 side by side).

## Finding 27: the real defect was never the wrapper bytes - it's the write FINALIZATION. Our writer sent a spurious nav-DB commit (0x0b04); real SuuntoLink never does, for these regions

The install read back byte-exact every time, yet the watch kept ending up in a bad state:
first "connect to Moveslink" (full-screen, needs restart), and after a restart, `err:62` on
EVERY sport mode (including Cycling, which only holds real SuuntoLink-catalog apps) - i.e. the
firmware rejecting the whole CustomModes region on a cold-boot parse. Byte-exact readback but
cold-boot rejection = the data is fine, the write *mechanism*/finalization is not.

Decoded all 4 real `assets/ambit3 pcap/v2/` app-install captures for their finalization
sequence. Findings, all byte-verified:
- **The 0x0b18 tail is a SHA256 of the written span** - matches all 6 real tails exactly, and
  our own tool's computed hash matched too. This IS the real per-region commit.
- **Real SuuntoLink NEVER sends 0x0b04 (CMD_NAV_COMMIT) for the Apps or CustomModes regions** -
  zero occurrences across all 4 captures. 0x0b04 is specifically the *navigation database*
  (routes/waypoints) commit. This project's `workout_install.py` sent it anyway (commit=True) -
  the ONE command we emitted that real SuuntoLink never does for these regions.
- Real SuuntoLink writes each region ~3 times per session with different intermediate data
  (its own internal staging); the final state + SHA256 tail is what persists.
- The 0x0b18 "extra" u32 varies wildly across captures (including 0, our value) - the watch
  does not validate it.

Causal chain that fits ALL observed symptoms: firing 0x0b04 after an Apps/CustomModes write
tells the watch "the nav DB changed, revalidate it" - but the nav DB was untouched, so it finds
a stale/inconsistent state -> "connect to Moveslink". A real nav write+0x0b04 (the `write_nav.py
restore`) is exactly what CLEARED it each time - broke on apps-write+nav-commit, fixed by
nav-write+nav-commit. Fix applied: `workout_install.py` now sends `commit=False` for BOTH
Apps and CustomModes (no 0x0b04); the 0x0b18 SHA256 tail is the only finalization, matching
the real captures.

**Still UNPROVEN and important**: even byte-identical, our single-pass write had never faced a
cold boot until this session, and the cold boot produced err:62 across all modes. So it is NOT
yet established that our write mechanism (single-pass + SHA256 tail, even with the 0x0b04 fix)
survives a reboot the way SuuntoLink's multi-pass write does. The err:62 recovery was done via
a full SuuntoLink resync on the Mac (its own proven multi-pass write), NOT via this project's
tooling. Open question for next session: whether the 0x0b04 removal alone makes our writes
cold-boot-durable, or whether the multi-pass staging is also required. Do not retry a real
install without a guaranteed SuuntoLink-resync recovery path on hand.

## Finding 28: the REAL err:62 root cause - CustomModes hashed over the full padded region instead of its used BXML extent. Fixed and proven byte-exact against real captures.

The 0x0b04 removal (Finding 27) was correct but was NOT the whole story, and Finding 27's
"single-pass unproven across cold boot" framing was imprecise. The decisive bug, found by
decoding the 4 real SuuntoLink app-install captures (assets/ambit3 pcap/v2/) that were in
assets/ all along:

**CustomModes must be written and hashed as ONLY its used BXML extent (4 + the DEVICE_CUSTOM
root tag's length, ~5.9 KB), not the full 12288-byte region.** ambit_format.py had CustomModes
as HASH_PADDED (hash of the whole 12288, unwritten bytes as 0xFF) - an unverified "by analogy
with Routes/Waypoints" guess. It was wrong. Proven three independent ways:
- All 4 captures write CustomModes over exactly `4 + root_len` bytes (5940/5964/5954/5836),
  matching the BXML extent to the byte, and the closing 0x0b18 hashes exactly that span.
- SHA256(used extent) == the hash the WATCH ITSELF reports for CustomModes in its 0x0b21
  memory-map reply (e.g. EDF772C7... for the trekking capture). SHA256(full padded 12288) does
  not. So the firmware stores and re-validates the used-extent hash.
- Same holds for Apps (already HASH_WRITTEN over total_length - correct; the watch-reported
  Apps hash 72DF... == SHA256 of the 2332-byte used extent).

This is why installs worked LIVE but died on a cold boot: the live firmware uses the just-
written bytes, but a cold boot re-reads flash and recomputes the used-extent hash - which never
matched this project's full-region hash -> "err:62 on all sport modes". It is almost certainly
the true root cause of the entire Findings 16-19 "app error" saga, not the wrapper bytes,
field_c, the compiler, or anything else chased there - every CustomModes write this project
ever made stored a hash the watch would reject on reboot.

Fixes applied:
- `ambit_format.py`: CustomModes REGIONS entry PADDED -> WRITTEN, with the evidence in a comment.
- `custom_modes.py`: new `used_extent(data)` = 4 + DEVICE_CUSTOM root length.
- `workout_install.py`: both the install path and `--restore` now write only
  `new_custom_modes[:used_extent]` (so the WRITTEN hash covers exactly the extent the firmware
  re-hashes), and both use commit=False (no 0x0b04, Finding 27).
- `restore_apps_custommodes.py`: new dedicated recovery tool - restores a known-good
  Apps+CustomModes backup pair with the correct write shape, backs up first, and verifies
  readback + cross-region rule<->app consistency.

Self-check (all offline, no watch needed - the watch was on the Mac): our fixed writer now
reproduces every one of the 4 real captures' Apps AND CustomModes writes BYTE-EXACT, both the
written span and the closing SHA256 hash. All 27 selftests still pass.

Recovery status at time of writing: the watch was not on this machine's USB bus (on the Mac,
where a SuuntoLink resync had failed with "unknown error" - plausibly because SuuntoLink choked
on this project's own wrong-hash CustomModes state). A background waiter
(scratchpad/await_and_recover.sh, log at backups/AUTO_RECOVERY.log) will run
restore_apps_custommodes.py the moment the Ambit3 reappears on the Linux bus, restoring the
pristine pre-session before_walk_install pair with the corrected write shape. If that recovery
also fails a cold boot (it should not - it writes byte-identical to what SuuntoLink writes), the
firmware reflash remains as the user's fallback.

## Finding 29: deep investigation of the two lost Movescount features (guided workouts + planned moves/training plans), 2026-08-09

André asked to genuinely try to revive the two features Movescount took away, using only the
repo's assets (no USB/BLE sniff possible - the authoring server is dead). Full investigation
below. Two related external sources checked (nothing new published): openambit (the only serious
community RE, supports Ambit3 Vertical/Traverse; no training-program/guidance binary format in
it) and the5krunner/forum articles (user-facing only). **Conclusion up front: this project's
decompile-based work is the most advanced reverse-engineering of these specific Ambit3 formats
that exists anywhere reachable.** One feature is now genuinely buildable; the other is promising
but blocked on a format that can't be verified without a live Movescount.

### Bonus, solved along the way: the last two unknowns in the Apps format (Finding 25/22)

openambit's `src/libambit/sport_mode_serialize.c` (`calculate_app_rule_checksum`,
`serialize_app_data`) is real community prior art for the Ambit app-rule format and closed both
remaining gaps:
- The header's second u16 = `num_entries ^ 0x02` (verified 11^2=9, 3^2=1, 5^2=7, 4^2=6).
- The per-entry `marker` byte = `XOR(MAGIC+binary) ^ (len(MAGIC+binary) & 0xff)` - openambit's
  exact checksum formula applied to MAGIC+binary. Verified byte-exact against all 26 real
  entries this project has (live 11-entry region + all 4 v2 captures), zero exceptions.
`apps.entry_checksum()` added; `build_apps_region()` now computes both. **Our writer now
reproduces SuuntoLink's real Apps-region write BYTE-FOR-BYTE** (full region incl. directory
header, every marker, offsets, total_length) on all captures - the Apps format is 100% solved.

### Feature A - "Guided workouts" (the browsable WORKOUT menu, section 3.18)

What it is (manual 3.18, confirmed): structured interval workouts authored in the Movescount
*App*, synced to the watch, then **browsable and selectable from the sport-mode options menu
(WORKOUT -> scroll -> select)** - explicitly NOT pinned to a display slot the way an App-Zone
app is. On-watch it uses a native graph display: `PID_RUNNER_GPS_TEMPLATE_GUIDANCE` (found in the
decompiled backend) - bounded upper/lower limit graph, segment counter (3/8), target row.

How it's really stored (from the decompiled `CustomModesAreaConverter::convertRule`): a workout
is a CustomModes **rule with a type** - the backend has rule types `"generic"`, `"display"`,
`"guidance"`, `"interval"` (distinct from a plain app). A guidance/interval rule carries a
declarative **Triggers** structure: `LimitMetric` (which sensor - speed/pace/HR/power/cadence),
upper/lower limits, `ActionsOnRise`/`ActionsOnFall` (what to do when you cross a limit -
beep/light), `Enabled`, `FilterWithBufferedInput`. **This is a declarative native rule-engine
construct, NOT App-Zone bytecode.** That is the important discovery: guided workouts never
needed the App-Zone `.Binary` compiler at all - they're structured trigger rules the firmware
interprets natively. That's also why they get the rich native graph display that App-Zone
scripts (Seb's, this project's workout.py output) can't reproduce.

Why it's still hard to revive: the Trigger/guidance-rule **byte encoding inside the CustomModes
BXML** exists only in the decompile - there is NO capturable real sync to verify it against
(Movescount authoring is dead, and no v2 capture contains a guidance rule - the v2
`intervaltimer*` captures are the watch's *built-in* interval timer, a different feature stored
in the SETTING_FIELDS interval slots, not Trigger rules). So reconstructing it means
decompile-only inference + hardware trial-and-error - and this session showed how unforgiving
that is (err:62 from a single wrong hash). It's a real, bounded RE target now that we understand
the write finalization, but it needs careful work and a watch with a guaranteed recovery path.

Two concrete revival paths, honest trade-offs:
1. **Reconstruct the declarative guidance/interval Trigger rule** from `convertRule` and write it
   into a sport mode's CustomModes with a `PID_RUNNER_GPS_TEMPLATE_GUIDANCE` display. If the
   firmware then lists it in the WORKOUT menu with the native graph, this fully revives the
   feature - the real prize. High RE effort, needs hardware iteration.
2. **Fallback already in hand**: App-Zone script workouts (workout.py) compiled via the live
   community compiler and installed via the now-fully-working installer. This gives structured
   guidance but pinned to a sport-mode field with a plain numeric display, not the browsable
   menu or native graph. Lesser feature, but real and working today.

### Feature B - "Planned moves / training programs" (section 3.39) - BUILDABLE NOW

What it is: up to 60 planned moves, each a target (duration/distance) for a specific activity on
a specific day, browsed from TIME mode ("Today 1/2" screens), with on-watch guidance and 50%/
100% completion indication; future targets shown by weekday/date. This is the dedicated
`TrainingProgram` flash region (0x001000, 3072 B), separate from everything else.

Format, now decoded from `TrainingProgramAreaConverter::{createBinary,parse,getDataPosition}`
(medium-high confidence - decompile-derived, still no real capture to verify):

    HEADER (12 bytes):
      off 0  u32   base date (encoded from the EARLIEST move's startTime; exact date packing
                   still TBD, but it is the reference date the watch counts day-offsets from)
      off 4  u32   preserved verbatim from whatever u32 is already at the region start
      off 8  u16   item count
      off 10 u16   (unconfirmed; 0)
    ITEM (40 bytes each, back to back from offset 12; a 0xFFFFFFFF at an item start = end):
      off 0  u8    DAY OFFSET from the header's base date (parse does day_offset * 24h) - this
                   is the whole "Today / Friday / 13.10" scheduling model
      off 1  u8    completed (0/1)
      off 2  u16   activityId
      off 4  u32   moveId
      off 8  u32   distance (metres)
      off 12 u16   duration (MINUTES; createBinary divides the JSON seconds by 60)
      off 14 u8    intensity (1-5: Easy/Moderate/Hard/VeryHard/Maximal per ServiceAdapter Plan)
      off 15 u8    (padding, 0)
      off 16 23B   activityName (ISO-8859, null-padded/truncated - strncpy 0x17)
      off 39 u8    (padding)

This corrects the earlier training_program.py layout in two real ways: offset 0 is a
day-offset-from-base, not a raw timestamp (which is why start_time=0 is rejected - Finding 24 -
and why a base date lives in the header), and the name field starts at offset 16 (23 bytes),
not offset 15. The `Plan` SBEM tree in ServiceAdapter.xml
(ID/Date/DailyOrdinal/Duration/Distance/Intensity/Activity.ID/Notes) is the transport format
that `TrainingProgramAreaConverter` compiles into this binary - it corroborates the field set.

Why B is buildable now where it wasn't before: the write finalization is solved (Finding 28) -
`TrainingProgram` is HASH_WRITTEN, and training_program.py already sends no 0x0b04. So a real,
cold-boot-durable write is achievable. The one genuine unknown is the header's base-date
packing; everything else is pinned. Next step (needs André + watch, with the recovery tool
ready): write one planned move dated "today", read back, and visually check whether the watch's
TIME-mode [Next] shows a "Today" target. That is the only way to confirm the firmware acts on
the region and to nail the base-date encoding - and it's now a safe experiment (non-firmware,
recoverable).

### Net

- Feature B (planned moves) is the realistic near-term win: format decoded, write path proven,
  one hardware trial from confirmation.
- Feature A (guided workouts) is a real but larger RE target: the mechanism is understood
  (declarative guidance/interval Trigger rules + native graph template, no dead compiler
  needed), but the byte encoding needs decompile reconstruction + hardware iteration.

## Finding 30: planned-moves hardware trials, 2026-08-09 - format writes cleanly but the watch won't surface the moves; honest wall reached

Ran real hardware trials of the decoded planned-moves format (Finding 29). All writes applied
and read back byte-exact; none produced a visible target on the watch (TIME -> [Next]).

- Trial 1: single move, day_offset 0, base_date = Unix seconds of today. Nothing shown.
- Confirmed the watch clock was wrong (leftover from the err:62 episodes); André fixed it to
  the correct date. Still nothing.
- Trial 2: three moves (today/tomorrow/+2), base_date = HOURS since Unix epoch (the decompile's
  `day_offset * 0x18` hinted an hours base). Nothing shown - not even the future moves as
  weekday/date targets, which is the telling part: a merely-wrong date should still surface
  future targets, so "nothing at all" points at either a malformed item or the watch not
  re-parsing the region.
- Checked the DeviceSettings tree live: `0x2c sml.DeviceSettings.Sports.Plans.Source = 1` is
  ALREADY set, so the plans-enabled flag is not the blocker. `saveTrainingProgram` in the
  decompile is just WritePmemRaw(0x0b16)+WritePmemRawFinalize(0x0b18) - no separate refresh/
  commit command exists to replicate, and no 0x0b04.
- Region restored to its pre-trial state afterward; watch left clean.

New structural facts learned (real, from openambit + the live watch):
- Planned moves are referenced in DeviceSettings as `sml.DeviceSettings.Sports.Plans.Source`
  (entry 0x2c) and completed moves link back via `DeviceLogBook...Header.PlannedMove.Id/
  Completeness` (schema). `UseTrainingProgram`/`TrainingProgram` is a personal-settings flag
  (openambit logstore) - 0 in openambit's test capture.
- openambit's test-settings show no embedded plan binary, so still no ground-truth example.

Honest conclusion: the storage FORMAT is decoded and a durable write works, but making the
firmware actually DISPLAY a planned move needs one or more of {the exact base-date encoding, the
exact item layout offset-15-vs-16, a non-zero moveId, a settings-write refresh of
`Plans.Source` via 0x1101}, and these can't be disambiguated by blind hardware guess-and-check
in a reasonable number of tries with no ground-truth capture (Movescount is dead; no sniff
possible). This is the genuine wall André flagged from the start. The one remaining
in-repo avenue not yet tried: a careful raw 0x1101 settings re-write of entry 0x2c
`Plans.Source` as the app-triggered "refresh" - deliberately NOT attempted here because a
hand-rolled raw settings write risks hitting the wrong entry ID (the exact bug settings_write.py
was built to prevent), and it needs the curated-table approach extended to that entry first.

## Finding 31: planned-moves - date encoding confirmed correct, problem isolated to item rejection; asset+online avenues exhausted (2026-08-09)

Continued the planned-moves trials per André (rules: RE assets, then search online).

- **Date encoding CONFIRMED** (not guessed): `DAT_00a010c8`'s initializer is
  `FUN_00434470(_, 0x7b2=1970, 1, 1)` * 1000000 = the Unix epoch (1970-01-01) in microseconds.
  With parse's `day_offset * 0x18`, the header base_date is hours since the Unix epoch - exactly
  what trial 2 wrote. So the date is right.
- **Plans.Source** is enum 0=Off/1=Manual, already =1; toggled 1->0->1 (each confirmed by
  read-back) to force the app-style refresh André described. Checked both plugged and UNPLUGGED
  (out of computer mode). Watch clock confirmed corrected by André. Still nothing.
- **Decisive**: three moves at day_offset 0/1/2 were written; +1 and +2 should appear as future
  weekday targets per manual 3.39 even if "today" were filtered. None appeared => the watch is
  REJECTING THE ITEM, not mis-dating it. Remaining suspects are inside the 40-byte record: a
  required non-zero `moveId` (by analogy with the confirmed `startTime`-must-be-valid rule), or
  the activityName offset (decompile says 16; this project's own older write used 15).
- **Assets exhausted**: training_lab.js is a 1.3KB obfuscated feature-flag stub (no plan logic);
  the Movescount mobile APK confirms `SYNCING_PLANNED_MOVES` but is obfuscated and only ever held
  the JSON model (the binary layout was always server/desktop-side = the C++ converter already
  RE'd). **Online exhausted**: no one has published the TrainingProgram binary format or a real
  region dump anywhere (openambit, forums) - no ground truth obtainable (Movescount dead, no
  sniff possible, per André's constraint from the start).
- Protocol path double-checked and correct: saveTrainingProgram = WritePmemRaw(0x0b16) +
  WritePmemRawFinalize(0x0b18), no 0x0b04 - exactly what write_nav/send_plan(commit=False) does.

Only remaining path to confirm feature B: a small BOUNDED empirical sweep of the item's
uncertain fields (moveId non-zero; activityName at offset 15 vs 16) - the one place guessing is
now warranted, since every non-guessing avenue is exhausted. Region was left with the 3-move
test program; can be blanked/restored on request.

## Finding 32: planned-moves content sweep exhausted; likely structurally coupled to workouts (2026-08-09)

Per André, tested one-at-a-time on real hardware (watch unplugged for each check):
Run-today-30min (duration only), Run-today-30min+4km (both), Run-today-4km (distance only) -
all Running, today, moveId non-zero. Every one: nothing on TIME -> [Next].

Combined with Finding 31, the full eliminated set is now: date encoding (confirmed via the
1970-epoch/microsecond constant), activation flag (`Sports.Plans.Source`=Manual - and the schema
confirms that is the ONLY training-plan DeviceSettings field on this 2.4.17 firmware; no separate
`UseTrainingProgram` gate exists here), refresh (Plans.Source toggle), clock, computer-mode
(plugged vs unplugged), moveId (0 and non-zero), activityName offset (15 and 16), and
duration/distance/both. The pmem write is byte-exact every time. The watch never surfaces a move.

`sml.DeviceLogBook...Header.PlannedMove.Id`/`.Completeness` confirm the firmware DOES track
planned moves (recorded moves link back to a planned-move Id), so the feature exists in this
firmware - it just isn't loading our region into the "Today" UI.

Leading remaining hypothesis (André's, and the best fit): a planned move is not standalone - it
**references a move/workout that must already exist on the watch** (matching Movescount's own
"MY MOVES"/"PLAN & CREATE" UX and the logbook back-reference). If a planned move must bind to a
real workout/move template and none exists, the watch has nothing to display. That would make
feature B (planned moves) dependent on feature A (workouts). Cannot be confirmed without a real
Movescount-era capture of a planned-move sync, which is unobtainable (Movescount dead, no sniff).

Status: planned-moves storage format is fully decoded and written byte-exact; the load/display
trigger has one unresolved structural unknown that needs ground truth we cannot obtain. Region
restored to pre-trial state after testing. Recommended next direction: feature A (guided
workouts / declarative guidance-interval Trigger rules) - which feature B likely depends on
anyway.

## Finding 33: guided workouts are DECLARATIVE CustomModes Trigger rules - buildable without the dead compiler (2026-08-09)

Pivoted to feature A (guided workouts / browsable WORKOUT menu) per André. Key architectural
finding from the decompiled backend:

The guided/interval-workout logic - `Triggers` (each with `LimitMetric` = which sensor,
`Enabled`, upper/lower limits, `ActionsOnRise`/`ActionsOnFall` = alert on crossing, and
`FilterWithBufferedInput`) - is handled by `CustomModesAreaConverter::convertBXmlGroups`
(decompile ~832000-832850, nearest owner confirmed). i.e. **it is stored declaratively inside
the CustomModes flash region** and converted to/from JSON by that converter - NOT compiled
bytecode in the Apps region. This means a guided workout can be constructed and written by this
project directly into CustomModes, with NO dependency on Movescount's dead server-side compiler.

Rule types are `generic`/`display`/`guidance`/`interval` (convertRule). A guidance/interval rule
carries the Triggers structure above; a generic/display rule is just the RULEIDX->app-slot
pointer this project already writes. The on-watch native graph display is
`PID_RUNNER_GPS_TEMPLATE_GUIDANCE`.

Scope confirmed by two period reviews (endomorfun.fr, trailandrunning.com): the Ambit planner
only ever did SIMPLE time/distance/HR-limit workouts ("10x100m at 85% FCM impossible") - exactly
what a declarative Trigger rule (one metric limit + alert actions per segment) expresses. So the
achievable target and the mechanism match.

Remaining RE to build it: the numeric BXml tag IDs for the Trigger/Limit/Action sub-structure
inside a CustomModes rule (the string keys Triggers/LimitMetric/etc. are the JSON view; the
binary uses numeric BXml tags not yet in custom_modes.py's BXML_TAGS). Next step: read
convertBXmlGroups' Trigger section for those tag IDs, then extend custom_modes.py to
decode/encode them, verify by round-tripping any real capture that contains a rule, and build a
minimal guided-workout writer. No compiler needed - this is pure declarative CustomModes work,
the same region/write-path already proven this session.

## Finding 34: three distinct interval/workout mechanisms - one is buildable NOW with ground truth (2026-08-09)

Refining Finding 33 with real capture evidence. There are THREE related but distinct things:

1. **Built-in interval timer** (on-watch ACTIVATE menu -> Interval timer On). Stored in the 6
   interval slots of the CustomModes SETTING_NAME_LEN64 block that this project ALREADY
   decodes (IntTimerFlags/IntTimerCount + slot Flags/Type/MaxLimit/MinLimit/Len). CONFIRMED
   against real capture ground truth: `intervaltimerhigh02'05low06'30` decodes to slot0 Len=125
   (2'05=125s) and slot2 MaxLimit=390 (6'30=390s). **This is buildable NOW** - real bytes,
   real capture, same CustomModes write-path already proven. Gives real high/low interval
   guidance on-watch; activated via the ACTIVATE menu, not browsable.

2. **Guided interval workouts** (Movescount WORKOUT menu, browsable, native graph display
   PID_RUNNER_GPS_TEMPLATE_GUIDANCE). The richer `Triggers` structure (LimitMetric +
   upper/lower + ActionsOnRise/ActionsOnFall + Enabled + FilterWithBufferedInput). Confirmed
   DECLARATIVE and part of the CustomModes structure: its writer `FUN_007f1310` is called from
   inside the custom-mode builder alongside ACTIVITYID/USEHW/AUTOLAP/HeartRateLimits (not from
   an Apps/IAMRULE path) - so NO dead compiler needed. BUT the exact numeric BXml tag encoding
   of the Trigger sub-structure is decompile-only and obfuscated; no real capture contains a
   guidance rule (the reference watch only has 6-byte simple app-slot rules), so it's not yet
   byte-pinned. This is the browsable feature André wants; it needs more focused BXml-encoding
   RE before a build.

3. **Planned moves / training programs** (Today, TIME mode). Feature B - Findings 30-32,
   format decoded, likely depends on #2.

Correction to Finding 33's confidence: "declarative in CustomModes, no compiler" is now BETTER
supported (the trigger writer lives in the custom-mode builder), but "buildable" applies today
only to mechanism #1 (interval timer, ground-truthed). Mechanism #2 (the browsable WORKOUT
guided workout) is declarative but its exact encoding still needs pinning.

Recommendation: mechanism #1 is a real, low-risk, ground-truthed interval-guidance win buildable
immediately (new tool importing the proven CustomModes write-path). Mechanism #2 remains the
target for the browsable UX and is the next RE focus (pin the Trigger BXml tag IDs).

## Finding 35: CORRECTION to Findings 33/34 - the "Triggers" are the API view of ordinary per-mode settings, NOT a stored browsable workout (2026-08-09)

Continued RE (André: interval timer already built in custom_modes_write.py; continue). Read
CustomModesAreaConverter::convertBXmlGroups in full. It branches on ordinary mode SETTING names
- ACTIVITYID, AUTOLAP, HRHIGH, HRLOW, HRLIMITSUSE, RECORDINGINTERVAL, USEHW, AUTOPAUSE,
AUTOSCROLLING, ALTIBAROMODE, GPSPOWERMODE, CMIDHIGH/CMIDLOW, etc. - and SYNTHESIZES the
`Triggers`/`LimitMetric`/`Enabled`/`ActionsOnRise`/`ActionsOnFall` JSON from them (e.g. AUTOLAP
and the HR high/low limits each become a "Trigger"). i.e. **"Triggers" is just the
DeviceSettings-API representation of ordinary per-mode settings this project already decodes and
can write** (HrHigh/HrLow/HrLimitsUse/Autolap/interval slots) - NOT a separately-stored,
browsable guided-workout entity.

**This retracts Findings 33/34's claim** that the browsable guided workout is "declarative in
CustomModes, no compiler needed." That conflated two different things:
- DeviceSettings "Triggers" = per-mode autolap + HR limits + interval timer. Real, already
  writable (custom_modes_write.py). Gives genuine HR-limit / interval guidance, but it is
  per-mode settings, NOT the browsable multi-segment WORKOUT with the native segment graph.
- The browsable Movescount interval WORKOUT (WORKOUT options menu, multi-segment,
  PID_RUNNER_GPS_TEMPLATE_GUIDANCE graph) is a compiled `guidance`-category Rule (`.Binary`) -
  per Findings 5/10 this was produced by Movescount's dead server-side compiler.

Accurate state of the three mechanisms:
1. Built-in interval timer - BUILT (custom_modes_write.py), ground-truthed.
2. Per-mode HR-limit / autolap guidance - writable now via ordinary settings (custom_modes_write
   / settings). Real guidance, not browsable multi-segment.
3. Browsable multi-segment guided WORKOUT (the graph, the WORKOUT menu) - a compiled guidance
   rule. Needs a compiler. The live community App-Zone compiler (workout.py) can produce interval
   SCRIPTS but as generic apps pinned to a display field, not confirmed to produce a
   guidance-category rule that the firmware lists in the browsable WORKOUT menu with the native
   graph.

Real remaining unknown for the browsable feature (unresolved_questions #1, still open): how the
firmware decides a rule/app is a browsable "guidance" WORKOUT vs a pinned display app - i.e.
where the guidance category/type is encoded (compiled binary header? a CustomModes rule field?
the catalog entry's categoryId?). That is the next RE thread if the browsable UX is the goal.

## Finding 36: the browsable guided WORKOUT ceiling - no on-device category field; browsability is display-template + compiled binary (2026-08-09)

Examined the on-device IAMRULE binary header of real apps: it's the VM/bytecode header
(own-var count, string-table offsets) with NO category/type field. The Movescount
`Category:"guidance"` was a SERVER REST attribute, not stored on the watch. So on-device a
"guidance workout" and a "generic display app" are structurally the same kind of IAMRULE binary
wired into a sport mode - the browsable-WORKOUT-vs-pinned-display distinction is NOT a stored
flag we can toggle. It comes from the display TEMPLATE the rule is wired to
(PID_RUNNER_GPS_TEMPLATE_GUIDANCE = the segment graph, backend ref at 757245) and how the
firmware enumerates guidance-graph-wired rules, plus the compiled binary actually producing the
segment/limit data the graph needs.

Consequence: producing the browsable multi-segment WORKOUT with the native graph needs a
compiled guidance binary that drives that graph (segment count, upper/lower limits, current
value). The live community App-Zone compiler produces generic display output (a single RESULT
value), not guidance-graph segment data. So the exact browsable-graph feature remains gated on
capability the dead Movescount server compiler had - consistent with this project's long-
standing Finding 5/10/12 conclusion that the dead server compiler is the one real gap.

One concrete experiment still open (speculative): wire a compiled App-Zone interval app to the
guidance-graph display template and see if the firmware lists it in the WORKOUT menu - but the
graph would likely not render meaningfully without real guidance segment data, so this is
low-confidence.

Realistic, achievable interval-guidance revival (no dead compiler), in order of fidelity:
1. Built-in interval timer - DONE (custom_modes_write.py), ground-truthed.
2. Per-mode HR-limit / autolap guidance - writable now via ordinary settings.
3. App-Zone interval workouts (workout.py -> live community compiler -> workout_install.py,
   now with the corrected Apps/CustomModes format) - real on-watch interval guidance with
   beeps, as a pinned sport-mode app (not the browsable WORKOUT menu, not the native graph).

Net: the browsable native-graph WORKOUT is not reproducible without the dead server compiler;
the interval-guidance CAPABILITY is revivable today via paths 1-3.

## Finding 37: Wayback Machine (web.archive.org) checked - App-Zone source corpus found; native workout/plan data confirmed unarchivable (2026-08-09)

André's idea: try the Internet Archive for Movescount. Results (via the CDX API; web.archive.org
is only reachable by curl here, not WebFetch):

- **uiservices.movescount.com (REST API host)**: only static/heatmap/robots endpoints archived.
  The authenticated endpoints (rules/, userdevices/, apps/) were never crawlable, so no real
  guidance-rule `.Binary`, no `userdevices` plan data.
- **Planned moves / training-program planner / workout planner**: every archived URL is a
  `?signin&redirect_uri=%2F..%2Fplannedmoves` / `..%2Ftools%2Ftrainingprogramplanner` login
  redirect - authenticated, so NO actual data was archived. The archive cannot provide
  planned-move or workout-planner ground truth. (Confirms Feature B / native Feature A remain
  gated exactly where we said.)
- **App Zone**: ~2,468 archived public app pages (`www.movescount.com/apps/app{ruleId}-{name}`),
  each embedding the full app model JSON: `Source` (the App-Zone script), own-variables
  (Name/Value), `ActivityID`, `CategoryID`. NO compiled `Binary` (generated server-side). Even
  interval/HR-alert apps are `CategoryID:0` (generic App Zone), confirming public apps were never
  `Category:"guidance"` native workouts.

Net: the archive does NOT crack the native browsable guided workout or planned moves (both were
authenticated) - but it IS a large, real corpus of interval/HR-training App-Zone SOURCE
(e.g. "HR Interval training (with alert)" ActivityID 82, CategoryID 0, real Source with
Suunto.alarmBeep and HR-zone own-variables). Since the live community compiler recompiles
source, this corpus is directly usable for path 3 (App-Zone interval workouts installed as
pinned apps via the corrected workout.py -> compiler -> workout_install.py pipeline). ~2,468
apps are harvestable if we want a built-in workout library.

### Finding 37 addendum: corpus harvested (2026-08-09)

Built the harvester (`tools/harvest_appzone.py`, resumable, retry/backoff) and query tool
(`tools/appzone_corpus.py`). Captured ~1,301 of ~2,086 archived App Zone apps into
`appzone_corpus/appzone_corpus.jsonl`: 848 with usable advanced-mode text source, 99 in
simple-mode AST form, 354 official/hidden-source. Rich real interval corpus (Pyramid-Interval,
10-20-30, Tabata Beep, IntervalRecovery, Interval 200m-30s, CARDIO TRAINER PRO, ...). The
remaining ~785 hit archive.org rate-limiting; harvester is resumable to fill them after a
cooldown. Confirms no guidance/planned-move data exists publicly (authenticated-only). Corpus is
directly usable for path 3 (compile via community compiler -> install via workout_install.py).

## Finding 38: guided-workout Source schema = workout.py's schema, confirmed against real Movescount ground truth (2026-08-09)

André pointed at marguslt's gists. `9e00a590...`/power_workout_template.json is a REAL Movescount
guidance-workout Source, and `4bb9a9dc...`/rule_template.json is the Rule wrapper. Findings:

- A guided workout's authoring format is `{name, workoutDescription, steps[]}`, each step
  `{duration:{durationName, value}, target:{targetName, valueRange:{min,max}}, text,
  type:{typeName: warmup|interval|recovery|cooldown|repeatStart{value:N}|repeatEnd}}`. This is
  BYTE-FOR-BYTE the schema `tools/workout.py` already implements - the real power-intervals JSON
  round-trips through `workout.py --print-source` to valid App-Zone source (8x repeat unrolled
  into PHASE branches with alarmBeep/light on transitions). Saved as
  `reference/movescount_workouts/power_intervals.example.json`.
- The wrapper: this JSON is base64'd into a Rule's `Source`, `Category/Type:"guidance"`,
  `OutputFormat:"onedecimal"`; the server compiled Source->Binary. From marguslt's own notebook
  (gist 45285960...), rules split by `Type`: `generic`(=app) vs `guidance`(=workout), both are
  IAMRULE binaries on the SAME VM version (0.08). `Category` is a separate App-Zone grouping
  label. cell 5 builds the SuuntoLink app list from `Type==generic` only (workouts excluded).

Net for B: the AUTHORING half is fully in hand - real Movescount schema == workout.py, feeding
the live community compiler + the corrected workout_install.py. That produces a working
structured workout with per-segment target-range beep guidance, as a pinned app. What is NOT
reproduced is the native browsable WORKOUT-menu + segment graph: that needs the guidance-TYPE
IAMRULE binary the dead server compiled (or confirmation the community compiler can emit one) AND
the on-device rendering that lists a guidance rule in the WORKOUT menu with the graph. The one
missing ground-truth artifact is a real guidance `Binary` (the gists carry Source, not Binary).

## Finding 39: IAMRULE header decoded; the guidance binary is ordinary -> the native WORKOUT graph is on-device WIRING, not the binary (2026-08-09)

Chasing the native browsable-WORKOUT + graph (André's pick). Decoded the IAMRULE binary header
from real on-watch apps + the gist's guidance binary:
- after the 8-byte "IAMRULE\0" magic: [u32 field0=8 or 6][u32 field1][u32 field2=1]
  [u32 field3 = RuleID][u32 field4 = string-table offset][u32 field5 = hash], then VM data.
  field3=RuleID confirmed (10000003=Sunrise, 6833=HR Zones, 39=Cooper, ... all match).
- **field1 tracks OutputFormatID**: field1=1 <-> OFID 0; field1=10 <-> OFID 1 ("onedecimal");
  field1=255 <-> OFID 3. The gist GUIDANCE workout has field1=10 = OutputFormat "onedecimal" =
  OFID 1 - identical to HR Zones, an ordinary generic app.

**Conclusion: a guidance workout's IAMRULE binary is structurally ORDINARY** - same header, same
output format as a generic single-value app. The binary does NOT encode "I am a workout / draw a
graph." So the browsable-WORKOUT-menu + segment graph is decided by ON-DEVICE WIRING, not the
binary - which means it's reachable through this project's existing install path, not gated on a
special compiler output.

Two convergent leads for the on-device switch:
1. **The graph is an appended SYSTEM screen.** Manual 3.18: the workout graph "is shown as the
   last display of the selected sport mode." custom_modes.py already identified an invariant
   appended last system screen (0x0127) plus the guidance template
   PID_RUNNER_GPS_TEMPLATE_GUIDANCE (backend, resolved via a runtime name->id table). So the
   graph is likely firmware-appended when a workout is active, not a user-wired display.
2. **A workout = a guidance rule present but NOT wired to a display-field slot.** An app is an
   EXERCISE_MODES_RULE whose RuleIdx is wired to a display field (Type 51/52/53 = rule-engine
   slot). A browsable workout is selected from the WORKOUT menu and only then activated - i.e.
   it is likely a rule that exists for the mode but is not pinned to a display field. This
   project's installer always wires to a field (=> pinned app); NOT wiring it (rule present,
   no field slot) is the concrete, testable hypothesis for making it a browsable WORKOUT.

Concrete next experiment (declarative, no compiler, our existing tools): install a workout
IAMRULE (workout.py -> live compiler) as a rule in a mode's RULES WITHOUT assigning it to a
display-field slot, and see whether it appears in the on-watch WORKOUT options menu. Safe/
recoverable (CustomModes write, backups + restore in place).

## Finding 40: DISPROVED - an unwired guidance rule is NOT a browsable WORKOUT (hardware test, 2026-08-09)

Ran Finding 39's experiment on real hardware (André approved compile+install): compiled a small
real workout (workout.py -> live community compiler -> IAMRULE "TestWkt", 1512 B), installed it
into Running as a rule in RULES with `--as-workout` (NOT wired to a display-field slot). Verified
byte-exact readback: Apps entry 11 = TestWkt, Running rules [2,3,4,5,6,11], display slots still
[51,52] (the new rule genuinely unwired).

Result on the watch: **no WORKOUT entry appeared in the options menu**, and the rule showed as a
"--" in a display middle row anyway. So:
- The "unwired rule = browsable workout" hypothesis is WRONG.
- Adding a rule to RULES auto-surfaces it on a display slot even without explicit field wiring -
  i.e. there is no "present-but-unwired app" state; every EXERCISE_MODES_RULE becomes a pinned
  display app. So the native browsable WORKOUT is NOT the rule-engine/app mechanism at all - it
  is a genuinely separate on-device concept we have no example of.

Reverted cleanly (restore_apps_custommodes.py; byte-exact verified, one transient read-glitch
false-mismatch on the first attempt, clean on re-run).

Consolidated conclusion for the native browsable WORKOUT + graph: it is a distinct on-device
mechanism, not the IAMRULE-app/rule wiring we fully control, and we have zero ground-truth of its
on-device form. Reproducing it needs the real capture / spec named in SUUNTO_DEV_REQUESTS.md (a
real Category:guidance sync, or the on-device workout structure). The ACHIEVABLE revival remains:
author structured workouts (real Movescount schema == workout.py) -> live compiler -> install as
a pinned sport-mode app with real per-segment target-range beep/light guidance (Finding 38).

## Finding 41: DEFINITIVE - our install works; the COMMUNITY COMPILER's binaries don't execute on this Ambit3 Peak (hardware, 2026-08-09)

Clean end-to-end validation on real hardware (André driving the watch). Sequence, all on Walk:
- Community-compiled interval workout (TestWkt, time-based): installs with NO app error (format
  fix Findings 25-28 holds), hash cold-boot-safe, wired to display field (Type 51). On watch:
  shows "--" both idle AND while recording.
- Community-compiled `RESULT = 100;` (Fixed100, a constant - must show 100 regardless of
  GPS/recording): also "--". No error, just no output.
- **Discriminator**: the watch's OWN official "Real Temerature" binary, extracted from its Apps
  region and re-installed by THIS PROJECT's writer onto the same Walk field -> renders the
  temperature correctly.

Conclusion, cleanly isolated:
- **This project's install mechanism is fully correct** - an official IAMRULE binary installed by
  our tooling executes and renders. Findings 25-28 (Apps/CustomModes format, used-extent hash,
  no 0x0b04) are validated end-to-end on hardware.
- **The community App-Zone compiler (ambitappscompiler.azurewebsites.net) produces binaries this
  Ambit3 Peak firmware ACCEPTS but does NOT execute** (even a constant RESULT=100 -> "--"). This
  is the real, final blocker for AUTHORED workouts/apps - separate from, and downstream of, every
  format bug fixed earlier. It explains every prior "--" (myworkout, TestWkt, Fixed100).
  Structural tell: the community binary carries an embedded RuleID field of 0 (official binaries
  carry a real ruleId) and its VM bytecode isn't run; the compiler likely targets Ambit(1/2) and
  its output isn't executed by Ambit3 (Emu) firmware despite claiming Emu compatibility.

Net effect on the whole feature:
- Installing OFFICIAL catalog apps via this project's tooling: WORKS (proven).
- Authoring our OWN workouts/apps: blocked NOT by our tools but by the lack of a compiler whose
  output executes on Ambit3. The authoring front-end (workout.py == real Movescount schema) and
  the installer are both correct; the missing piece is a working Ambit3 App-Zone compiler.
- The Wayback App Zone corpus (Finding 37) has real SOURCE for ~2000 apps but the compiled
  Binary was always server-side; those sources would need a working Ambit3 compiler too.

Watch restored to clean pre-experiment state (byte-exact verified) after testing.

### Finding 41 addendum: the RuleID-patch lead is disproved (2026-08-09)

Tested André's-approved cheap lead: patched the community binary's embedded RuleID field
(offset 20, 0 -> 11000001) and installed. Still "--" on the watch. So the non-execution is NOT
a single header field (RuleID) - it's a genuine compiler/VM-bytecode incompatibility: the
community App-Zone compiler's output is not run by this Ambit3 Peak firmware, full stop. Authored
apps/workouts stay blocked on a compiler whose output executes on Ambit3. Watch restored clean.
