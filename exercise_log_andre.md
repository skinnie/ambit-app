# ExerciseLog (recorded moves -> GPX/FIT): already solved upstream, now verified on hardware

## The question that started this

While scoping AmbitConnect/AmbitSync (two third-party Android APKs sitting unopened in
`assets/APK/`, per `history.md`) as a possible next reverse-engineering target for watch ->
GPX/FIT export, André asked the obvious question first: doesn't `opensportsync`
(`github.com/guiguoz/opensportsync`, this project's own base fork) already do this?

Answer: **yes, completely** - not a stub, a real, working, Ambit3-specific implementation,
already sitting in `assets/opensportsync-main.zip`. No need to open AmbitConnect/AmbitSync
for this particular capability.

## What's actually there

`opensportsync` vendors `libambit` (from `openambit`, the mature Linux/cable Ambit project),
under `android/app/src/main/cpp/libambit/`:

- **`device_support.c`** explicitly registers `"Emu"` (Suunto Ambit3 Peak - this exact watch)
  against `ambit_device_driver_ambit3`.
- **`pmem20.c`** ("PMEM" = the on-flash magic tag each recorded move starts with) implements
  the full binary protocol: a region-level master index (`entries`/`first_entry`/`last_entry`/
  `next_free_address`, 16 bytes at the region base), then a linked list of entries (`PMEM` +
  `next`/`prev` addresses + a periodic-sample-field spec + a ~130+-byte header + a stream of
  `[u16 len][u8 type][...]`-framed samples), plus a `correct_samples()` post-processing pass
  that turns raw deltas into real positions and times.
- **`libambit.h`** defines every sample type this format can carry: GPS in three precisions
  (`gps_base` = absolute lat/lon, `gps_small`/`gps_tiny` = successively finer deltas off the
  last fix), periodic samples (a per-move field spec: HR, speed, altitude, cadence, up to five
  "ruleoutput" slots for Suunto Apps, etc.), laps, swimming turns/strokes, firmware info.
- **`jni_bridge.cpp`**'s `convertEntryToGpx()` is the actual GPX writer: walks samples, tracks
  current GPS position across all three precision levels, deliberately does NOT let periodic
  barometric altitude overwrite GPS altitude (a comment there explains why - they diverge and
  cause "delirious" elevation gain), emits a real GPX track with duration/distance/ascent/
  sport-type extensions.

None of this is guessed reverse-engineering by this project - it's `openambit`'s own
multi-year, community-verified work, just not yet checked against this specific watch's real
bytes by this project until now.

## Built: `tools/exercise_log.py`, a line-for-line Python port

Following this project's standing practice (verify vendored/decompiled code against real
captures, never trust it as-is - see `tools/README.md`, `custom_modes_andre.md`), ported
`pmem20.c` + the relevant parts of `libambit.h` + `jni_bridge.cpp`'s GPX conversion to Python,
function for function:

- `parse_master_header()` - the region's own 16-byte index.
- `parse_log_header()` - the ~130-byte per-move header (date/time, duration, distance,
  ascent/descent, HR/altitude/temperature/cadence min-max-with-timestamps, activity name,
  battery, etc.), including the Ambit3-specific `UNKNOWN2_PADDING_48` field layout
  (`device_driver_ambit3.c` always sets this flag for full entry reads on this watch -
  hardcoded here to match, not offered as a toggle).
- `parse_sample()` - every sample type in the format: periodic (field-spec-driven, with a
  byte-width/signedness table taken directly from each union member's C type in
  `ambit_log_sample_periodic_value_s`) and episodic (GPS in all three precisions, laps,
  activity markers, swimming, firmware info, time-compensated samples).
- `correct_samples()` - accumulates time from periodic onto episodic samples, applies signed
  time compensators (swimming), delta-decodes `gps_small`/`gps_tiny` off the last fix
  (`x*10 + last`, exactly as the C source does it), applies the altitude-source pressure/
  altitude offset correction (preserving the C code's own odd "only samples before the
  altitude_source's own index" rule rather than "fixing" it), and re-sorts by time.
- `to_gpx()` - the same walk `convertEntryToGpx()` does: GPS position tracking across
  precision levels, periodic lat/lon override, GPX emission.
- `walk_entries()` - self-contained: walks the on-flash linked list directly from a raw dump,
  no live NSP query needed (unlike `device_driver_ambit3.c`'s own address-based read path,
  which gets entry addresses from a separate live SBEM `log_header` query - this project's
  `write_nav.py logbook` already exposes that data too, if ever needed for a partial/paged
  region read instead of a full dump).

Caught and fixed during the port, before ever running it against real data: three periodic
sample field types (`time`, `abspressure`, `temperature`) had the wrong byte width/signedness
in the first draft - `time`/`abspressure` are `uint32_t` in the C union, not the `uint16_t`
default; `temperature` is a signed `int16_t`, not unsigned. Fixed by building an explicit
per-type format table (`PERIODIC_TYPE_FORMATS`) straight from `ambit_log_sample_periodic_value_s`
(`libambit.h:272-309`) instead of eyeballing each `switch` case.

## Verified on hardware, 2026-08-05

The watch's logbook was empty when this started (`entries=0`, confirmed both via a live
`write_nav.py logbook` query and zero `"PMEM"` markers anywhere in a full raw dump) - so
André recorded a short real run before this could be tested at all.

Live logbook query (`write_nav.py logbook --all`), independent of everything below - a
completely different code path (SuuntoLink's own SBEM schema decode):

```
Time='2026-08-05T10:39:04'  Header.Activity='Running'  Header.Duration=3214
Header.Distance=451  MemArea.StartAddress1=2600018  MemArea.EndAddress1=2612064
```

`tools/exercise_log.py --from /tmp/dump_ExerciseLog_move1.bin --gpx-out /tmp/moves`:

```
entry 1: 'Running' 2026-08-05 10:39  duration=321s distance=451m samples=432 (parsed 432)
  91 GPS-position sample(s)
```

Cross-checked against the independent SBEM query, exactly:
- `duration=321s` == `Header.Duration=3214` x 0.1s = 321.4s (rounds to 321s)
- `distance=451m` == `Header.Distance=451` **exact**
- `'Running'` == `Header.Activity='Running'` **exact**
- same timestamp, `2026-08-05T10:39:04`
- all 432 samples parsed with zero errors/unknown-type fallbacks

**Then a second, independent check the logbook query can't provide by itself**: summed the
decoded GPX track's own point-to-point (haversine) distance across all 91 GPS-position
samples - **454 m**, against the watch's own independently-computed **451 m**. 0.7%
agreement. This isn't just "the header parses" - the actual position-delta-decoding chain
(`gps_base` -> `gps_small` -> `gps_tiny`, the trickiest part of `correct_samples()`) produces
real, internally-consistent coordinates. Opened the GPX directly, too: real coordinates
(50.62 N, 3.05 E - the Calais/Stomer area, matching where this project's own test GPX
route lives), smooth continuous movement point to point, elevation 21-27 m, sane.

## FIT export: also ported and verified, same day

`opensportsync`'s FIT writer (`src/services/FitExport.ts`) is a separate, self-contained
module - pure TypeScript, unrelated to `libambit`/`pmem20`. It builds a FIT file from a GPX
track plus activity metadata: a 14-byte header, Definition+Data message pairs (`file_id`,
`activity`, `session`, `lap`, then one `record` per GPS point), and a Garmin CRC-16 over both
the header and the data section. Ported message-for-message as `to_fit()` in
`tools/exercise_log.py`, reusing the same `extract_track_points()` walk `to_gpx()` uses
rather than round-tripping through GPX text (equivalent to what the TS version gets after its
own `GpxParser` re-reads the GPX `generateFitFile()` is handed).

Verified against a real, independent FIT reader (`fitparse`, installed into a throwaway venv
for this check only, not left in the system Python): parsed clean, 95 messages -
`file_id + activity + session + lap + 91 records`, exactly as expected. Cross-checks:
`session.sport = 'running'` (correctly mapped from `'Running'` via the ported
`toFitSport()`), `total_distance = 451.0` and `total_elapsed_time = 321.4` (exact match to
the watch's own header), and the FIT's own cumulative `distance` field ends at **454.5 m** -
independently landing on the same ~454 m the GPX-side haversine check found, this time via a
totally different code path (planar approximation inside `to_fit()` itself, read back by a
third-party parser).

**Timestamp handling, corrected then properly fixed, same day.** First pass: record
timestamps came back as `08:39:04` instead of the watch's own `10:39:04` - a clean 2-hour
shift. Initially reported as a bug ("off by 2 hours"), which was imprecise: this machine's
timezone is `Europe/Paris` (CEST, UTC+2, confirmed via `timedatectl`), and `10:39:04` local
French time in August genuinely equals `08:39:04` UTC - the conversion was *correct*, not
broken. What was actually true, once framed properly: both the original `jni_bridge.cpp`
(`mktime()` on `header.date_time`) and this port's first draft (`.timestamp()` on a naive
Python datetime) get the right answer only because the decoding machine's system timezone
happened to match the watch's - true here, not guaranteed for someone traveling, a CI/server
machine, or a DST-boundary edge case.

André asked for the real fix rather than parity-with-the-flaw: `gps_base` samples carry their
own genuine `utc_base_time` field (from the GPS constellation, not the watch's clock), and
`pmem20.c`'s own `correct_samples()` already computes a proper per-sample `utc_time` from it
(`add_time(&utcbase, samples[i].time, &samples[i].utc_time)`) that neither `opensportsync`'s
GPX writer nor FIT writer actually uses. Ported that piece too - `correct_samples()` now
anchors on the first `gps_base` sample's `utc_base_time` (timezone-aware Python
`datetime`s throughout, so `.timestamp()` can't silently reinterpret them via the system
clock), and both `to_gpx()`/`to_fit()` consume the resulting real `utc_time` per sample.

Proof it's actually timezone-independent now, not just "still happens to work here": decoded
the same real move three times, once each under `TZ=Europe/Paris` (the machine's real
setting), `TZ=America/New_York`, and `TZ=Asia/Tokyo` - **byte-for-byte identical GPX output
all three times**, and the Tokyo-generated FIT file still parses clean via `fitparse` with the
same `08:39:04` UTC timestamps. This is a genuine improvement over the reference
implementation, not just a faithful copy of it - deliberately, on request.

## What this settles

- `tools/README.md`'s and `HANDOFF.md`/`HANDOFF_new.md`'s open item ("Decoding a move's
  samples is a separate job, not started") is done, on real hardware, cross-validated two
  independent ways for GPX and a third for FIT.
- AmbitConnect/AmbitSync do not need to be opened for watch -> GPX/FIT export specifically -
  `opensportsync`'s own vendored `libambit` (GPX) and `FitExport.ts` (FIT) already cover it,
  and both are now confirmed correct for the Ambit3 Peak rather than just assumed correct
  because they're "mature"/"already written." They may still be worth checking for anything
  *else* they do that opensportsync doesn't (per `history.md`'s original framing) - not
  evaluated here.
- Timestamps in both GPX and FIT output are anchored on GPS-derived UTC, not the decoding
  machine's system clock - an improvement over both reference implementations (which get the
  right answer only when decoder and watch share a timezone), confirmed genuinely
  timezone-independent by decoding the same move under three different `TZ` settings.
