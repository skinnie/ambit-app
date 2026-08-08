# Open questions worth putting in front of marguslt / other community devs

Real, specific technical gaps this project has hit and not been able to close on its own -
each one is something a developer with more Movescount-era/Ambit3 protocol experience could
plausibly help settle. Not a general project overview - see `HANDOFF.md` for that.

## 1. Workouts (the interval/structured-workout builder)

**What's confirmed:** a rich, step-based structured workout (warmup/interval/recovery/
cooldown, repeat blocks, HR/pace/power targets) compiles into a real Suunto App/Rule binary
through the still-live community compiler (`ambitappscompiler.azurewebsites.net`). Getting
that binary onto a watch via SuuntoLink's own catalog file works and is verified on real
hardware.

**What's NOT confirmed:** the old Movescount-era UX let you select a workout via the **Next
button during an activity** (a browsable library), not by cable-swapping which app occupies a
sport-mode display slot. Real evidence points at this being the *same* underlying App/Rule
mechanism, just tagged `Category: "guidance"` (an old community gist documents this tag; a
period manual's "up to five Suunto Apps per sport mode" line matches the old workout
tutorial's "5 workouts" cap exactly, suggesting workouts share the same slot budget as
ordinary apps, not a separate pool). **Nobody has ever actually set that category on a
compiled app and confirmed the watch then offers it through the Next-button workout list.**

**Concrete question for a dev:** what numeric `categoryId` value means "guidance" in the
compiler's output / the catalog entry format, and can you confirm (or has anyone already
confirmed) that tagging an app this way changes how the Ambit3 firmware presents it on-watch?

**2026-08-07 addendum:** a marguslt gist documents a device-scoped
`GET userdevices/$SN/rules?type=guidance` endpoint, distinct from the account-wide
`rules/private` this project already uses - server-side evidence "guidance" is a real,
filterable category, though it still doesn't confirm the firmware itself special-cases it.
Separately, `RescuingSuuntoApps.ipynb`'s real catalog-building code only ever exports
`type=='generic'`/`categoryId: 1` rules - mild evidence nobody in that community has actually
tried this either, rather than this project having missed a known answer. See
`training_program_andre.md` Finding 21.

## 2. Training plans (schedule-a-workout-for-a-specific-day)

**What's confirmed:** the Ambit3 Peak has its own dedicated flash region for this
(`TrainingProgram`, 12-byte header + item count + 40-byte records), structurally decoded from
decompiled desktop software (`SDSApplicationServer.exe`'s `TrainingProgramAreaConverter`).
This is a genuinely separate thing from #1 - no shared mechanism.

**What's NOT confirmed:** the exact per-item field layout is medium-confidence only - it was
never checked against a **real USB capture**, because none of this project's 9 real pcaps
happen to contain a training-plan write. A test-write (this project's own guess at the format)
read back byte-exact, but there's no way to confirm the watch's firmware actually *does*
anything with it. Also completely absent from current SuuntoLink's software - orphaned since
the Movescount-era client generation.

**Concrete question for a dev:** does anyone have a real packet capture (or old Movescount
client source/decompile) of a training plan actually being written to an Ambit3/Ambit2/
Traverse? That's the only way to verify the field layout for real.

## 3. Daily step counts (wellness/activity sync)

**What's confirmed:** kcal-based daily/weekly activity totals are readable and decoded
(`TotalWeeklyActivity` verified exact against the watch's own screen). The general NSP
request architecture (`0x1200`-family "path get" queries) is confirmed correct at the source
level via decompiled desktop code.

**What's NOT confirmed:** the literal step-count field (`ActivitySummary.LastDays.Steps`,
schema ID `0x12f`) has never been successfully queried. Real, fairly deep finding: **this
schema entry doesn't exist anywhere in either Movescount-era client's code** (checked two
independent binaries sharing the same underlying SDK - the Android app and the Windows
Moveslink2/`BLLWrapper.dll`) - zero references to the entry, its ID, or the `SBEM0102` magic
bytes needed to build the query. Most likely explanation: step-count querying is a capability
added in a *later* generation of Suunto's software (their modern app's `libmds.so`, not
currently in this project's assets), after the Movescount-era client this project has been
reverse-engineering was built.

**Concrete question for a dev:** does anyone have `libmds.so` (the current Suunto mobile
app's native library) decompiled/symbol-dumped, or a live USB/BLE capture of the *current*
Suunto app requesting daily step data from any Ambit/Traverse-family watch? Either would
reveal the real request-ID encoding directly.

## 4. Direct flash-write "app error" (this project's own installer, not the SuuntoLink route)

**Update, 2026-08-07 - the leading hypothesis changed, see `V3_CHANGELOG.md`:** a real
hardware test confirmed `CustomModes` needs the full Routes/Waypoints-style write sequence
(chunked `CMD_DATA_WRITE` + a padded-region-SHA256 `CMD_DATA_TAIL` + `CMD_NAV_COMMIT`) -
`workout_install.py`'s original write never sent a commit at all. That's now the more likely
root cause of "app error," ahead of the wrapper-bytes theory below. **Real next step: retry
`workout_install.py` with the commit sequence added, on real hardware, before assuming a
capture is still needed.**

**What's confirmed:** the compiled App binary itself is correct - proven by installing a
known-good *official* SuuntoLink-catalog app through this project's own writer unchanged, and
it *still* threw "app error." So the bug is specifically in how this project constructs the
`Apps`-region wrapper around a binary, or in the write sequence, not in the binary itself.

**What's NOT confirmed:** a handful of wrapper header bytes (informally `field_a/b/c`) whose
real meaning is unknown - only ever copied from one existing catalog entry that turned out to
itself be a broken/errored one. A CRC16-over-the-binary guess for one of them didn't work
either. **This is now the fallback question, only worth a capture if the commit-sequence
retry above doesn't fix it.**

**Concrete question for a dev, if the retry above doesn't resolve it:** has anyone captured
the real USB wire protocol of SuuntoLink installing an app (not just diffed before/after
flash contents, an actual packet-level trace of the live install conversation)? That's the
one thing this project has never done for this specific format, unlike every other format
here, and it's very possibly where those wrapper bytes actually get set. (The other capture
this section used to ask for - a plain `CustomModes` edit with no app involved, to confirm
the write-mechanism/commit question - is no longer needed: that's what the 2026-08-07 real
hardware test above already answered.)

**2026-08-07 addendum, a third candidate for the wrapper bytes, not yet tried on hardware:** a
marguslt gist (`gist.github.com/marguslt/a79ea204f99b45ab015b6ed1ff7529a4`) shows every
Movescount `Rule` object carrying a `TargetVirtualMachineVersion` field ("0.08, build
15.8.18.0") never seen in this project's own captures, tracked separately from the compiled
`Binary`. Two other guesses at `field_c` (a copied constant, a CRC16 of the binary) are already
ruled out on real hardware - this is a concrete third one, from a real API response rather than
a guess, worth trying with the same read-compare-revert protocol. Also independently confirmed
openambit itself has never implemented an Ambit3 app/sport-mode write at all
(`device_driver_ambit3.c`'s vtable has both `sport_mode_write` and `app_data_write` as `NULL`),
so there's no upstream reference implementation to diff against for this specific format. See
`custom_modes_andre.md`'s "Cross-checked against openambit's live upstream source" section and
`training_program_andre.md` Finding 21.

## 5. GLONASS orbital data placement

**What's confirmed:** the AGPS/orbital ephemeris write mechanism (`GpsSGEE`) is fully solved
and verified end-to-end on real hardware, including a live, unauthenticated data source still
online today.

**What's NOT confirmed:** where GLONASS data (a separate blob from GPS orbital data) lands in
the flash region - the reference Ambit3 Peak used for this project has no GLONASS receiver at
all, so the real capture used to solve this format never contains a GLONASS write to learn
from.

**Concrete question for a dev:** does anyone have a Traverse, Traverse Alpha, or Ambit3
Vertical (the three models with a GLONASS receiver) they could capture a real orbital sync
from?

## Not open anymore, but worth a sanity-check with someone who's done it before

**BLE data operations** (route/POI/orbital/activity sync over Bluetooth, not cable) - this
*was* thought blocked on an unsolved NSP login token, but a real HCI capture on 2026-08-06
overturned that: the actual issue was a missed GATT "Service Changed" re-discovery step after
connecting, not a login requirement. Real path forward now identified, but genuinely unbuilt
and untested end-to-end - if anyone's actually done a full BLE route/POI write on this watch
family before, confirming there isn't some other gate waiting past this one would save real
time.
