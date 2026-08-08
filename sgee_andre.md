# AGPS/orbital data (GpsSGEE): write path built, live data source found, verified end to end on hardware

Follows on from `ORBITAL_DATA_ANALYSIS.md` (tracked, not edited here to avoid the same
concurrent-edit risk `HANDOFF.md` hit earlier this session - this file is the personal
companion, same convention as `HANDOFF_ANDRE.md`). That file correctly identified the region
(`0x000704e0`, confirmed) and the general shape (SGEE = ephemeris, `orbitsync2` = a
verification-only check) from packet counts alone; everything below is the byte-level
follow-through, done against `assets/ambit3 pcap/orbitsync` directly rather than inferred.

## Part 1: the write mechanism, built and byte-exact verified against a real capture

`assets/ambit3 pcap/orbitsync` (330,358 bytes) is a full sync session - routes, POIs, logs
and the SGEE write all mixed together, not an SGEE-only recording. Isolating just the
SGEE-region traffic (`0x0b16`/`0x0b18` messages whose own address falls inside
`[0x704e0, 0x704e0+140000)`):

- **73 `0x0b16` (`data_write`) messages**: 72 chunks of 1024 bytes, one final chunk of 62
  bytes. Total 73,790 bytes written, starting exactly at `SGEE_BASE`.
- **The written bytes are `[u32 LE length=73786][73786 bytes of raw ephemeris]`** - the first
  4 bytes decode to exactly the length of the rest, confirmed by direct arithmetic, not
  assumed from `pmem20.c` alone.
- **The 73,786-byte payload (everything after that 4-byte header) is byte-for-byte identical
  to `assets/WIndows apps/Suuntolink/sgee.7d`** - SuuntoLink's own on-disk cache of exactly
  what it wrote in this capture. Direct confirmation the capture and this project's own
  bundled asset are the same real event, not a coincidence.
- **One `0x0b18` (`data_tail_len`) message**, `[u32 address=0x704e0][u32 opaque][64 ASCII hex
  chars]`. The hex string decodes to `sha256(written_bytes)` **exactly** - confirmed by
  computing it independently and comparing. This is `F.region_hash()`'s existing
  `HASH_WRITTEN` mode (hash of only the written bytes, not the whole padded 140,000-byte
  region) - already implemented in `ambit_format.py`, now proven correct against real bytes
  rather than just asserted in a comment.
- **The opaque 2nd word of the tail** (`field2`, bytes 4:8) does not match total length, last
  chunk size, or anything else tried - same as the already-established "supplied by the
  application" field for Routes/Waypoints tails. Treated the same way: zeroed on write,
  tolerated as a non-fatal mismatch in comparisons.
- **No `CMD_NAV_COMMIT` (`0x0b04`) follows** - confirmed by reading the messages immediately
  after the tail in the capture (`ambit3_log_headers`, `log_read` - unrelated), unlike
  Routes/Waypoints which always need one.

Implemented as a new `sgee` action, initially inside `tools/write_nav.py` and later split
into its own `tools/sgee.py` (see the Summary below): `build_sgee()` (wraps the file in
the length-prefix header, reuses the existing `emit_packs()`/`FlashImage`/`region_hash()`
infrastructure unchanged), `run_sgee()`/`main()` (skips the POI dance and memory-commit that
Routes/Waypoints need - genuinely unrelated to navigation), and
`compare_sgee_with_capture()` (address-scoped rather than whole-capture, since `orbitsync`
carries far more than just this write). `write_nav.py`'s `send_plan()` gained a
`commit=True` parameter, defaulting to the old behaviour, so `sgee` (imported from there)
can pass `commit=False` without touching any existing caller.

`--compare` against the real capture: **74/74 payloads matched exactly** (73 `data_write` + 1
`data_tail_len`), the only reported difference being the already-known-opaque tail field.
Added to `selftest.py` permanently (guarded on both `sgee.7d` and the capture existing in
`assets/`, same pattern as the `restore` check) - now 25/25.

## Part 2: a live, unauthenticated data source, found and confirmed working

The point of writing SGEE data at all is that it goes stale in roughly one to a few weeks -
`sgee.7d` alone (a snapshot from whenever SuuntoLink last cached it) doesn't stay useful. So
the real question was whether a fresh source exists that doesn't require a Suunto account -
this project's whole reason for existing is removing that dependency.

Traced from `production.json` (SuuntoLink's own shipped config,
`assets/WIndows apps/suuntolink_roaming/app-4.1.15/resources/app/`): `serverUrl:
"https://devices.suunto-operations.com"` - a separate host from the account-tied
`askoServerUrl` (`cloudapi.suunto.com`). Reachability probe, 2026-08-05: this host is alive,
nginx-fronted, `/health` reports `{"status":"OK","buildId":"2026.08.05_1"}` - actively
deployed, built the same day this was checked, not a decommissioned relic.

Most of its API surface (`/api`, `/status`, `/swagger`, `/v2`) returns `401 Missing
authentication` - real, gateway-recognized routes, gated behind the `appKey` also found in
`production.json`. But the actual data-download paths, found via string search in the
decompiled `SDSApplicationServer.exe.c` (`SGEE.cpp`'s object code):

```
GET https://devices.suunto-operations.com/devices/gpsorbit/binary
GET https://devices.suunto-operations.com/devices/glonassorbit/binary
```

**Both work with zero authentication** - no AppKey, no serial number, nothing. Makes sense in
hindsight: orbital ephemeris isn't account- or device-specific, only date-specific, so there's
nothing to gate. Confirmed live, 2026-08-05: GPS orbit 71,544 bytes, GLONASS orbit 45,230
bytes, both `Last-Modified: 2026-08-05 08:05:06 GMT` - under two hours old at fetch time, and
confirmed genuinely different from the stale cached `sgee.7d` (different size, different
bytes), not a static/cached response.

The `GPSSGEEFileURI`/`GlonassSGEEFileURI` fields mentioned in the JSON-based
`isNewSGEEAvailable` check (also present in the decompiled C++) appear to be a per-request
signed-URL indirection layered on top of this - not needed in practice, since the static path
above already serves current data directly.

## Part 3: written to real hardware, and a bonus - a previously-unknown status field decoded for free

Wrote the freshly-downloaded GPS orbit file to the reference watch via `sgee --write`, then
independently read the region back and hashed it: **byte-for-byte match**, confirmed via
SHA256, not just "no error was thrown."

Then queried `0x0b15` (`gps_orbit_head`) again - this had only ever been seen as `9× 0x00` in
the reference capture (that watch/session had no valid orbit data at the time). Post-write,
this reference watch now reports `01 ea07 08 05 b271 0000`, which decodes cleanly as:

```
[u8 valid=1][u16 LE year][u8 month][u8 day][u32 LE seconds-since-midnight UTC]
```

`= valid, 2026-08-05, 08:05:06` - **the exact `Last-Modified` timestamp of the file that was
downloaded and written**, parsed back out by the watch's own firmware from inside the
ephemeris data itself, not something this project told it. That's a genuinely strong
correctness signal: not just "bytes landed at the right address," but "the watch accepted
this as valid orbital data and extracted its real embedded date," and resolves the one
previously-undecoded field this project had (`ORBITAL_DATA_ANALYSIS.md`'s "Step 1 - understand
the query command", now done).

## Part 4: the "trigger" - closed, and it's not a timer

André wrote the fresh GPS orbit data (via this project's `sgee --write`), then separately
synced the same watch with the Suunto app on his Mac shortly after. The sync did **not**
rewrite `GpsSGEE`. Worth understanding precisely rather than shrugging at "must still be
fresh."

**The generation date isn't just something `0x0b15` reports back - it's baked directly into
the ephemeris file's own header**, confirmed against three independent real files (all
fetched/cached at genuinely different times, not the same download three times):

| File | Header bytes `[6:10]` | Decodes to | Independently known to be |
|---|---|---|---|
| `sgee.7d` (André's Suuntolink cache, 2026-07-31) | `07 ea 07 1f` | **2026-07-31** | when it was cached |
| `gpsorbit_fresh.bin` (fetched live, 2026-08-05) | `07 ea 08 05` | **2026-08-05** | today, matches `Last-Modified` |
| `glonassorbit_fresh.bin` (fetched live, 2026-08-05) | `07 ea 08 05` | **2026-08-05** | today, matches `Last-Modified` |

Byte `[4]` looks like a running generation counter across those same three samples: `0x7d`
(old) -> `0x7e` (new, both) - sequential, incrementing once per publish rather than per file.

Given that, and the client function this project already found is literally named
`isNewSGEEAvailable` (not `isSgeeStale` or anything timer-shaped), the mechanism is almost
certainly a straight **version/date comparison**, not a fixed "wait N hours" throttle:
the client (or the server, told the watch's current date) checks whether the *currently
published* file's generation date is newer than what the watch already has (readable via
`0x0b15`), and only downloads+writes if so. `getSgee`'s `Forced` parameter (`messages.js`)
fits this exactly - a way to bypass the comparison and re-fetch regardless, for a manual
"force update" action, distinct from the normal automatic path that only acts on genuine
staleness.

That fully explains what André saw: this project fetched the *most current* file the server
had, wrote it, and the Mac sync happened before the server published anything newer - so
there was nothing new to fetch, independent of how much time had passed since the last sync.
Not a cooldown being respected; a real "already up to date" comparison correctly finding
nothing to do.

**One thing this doesn't settle, flagged rather than overclaimed**: how often the *server*
itself actually publishes a new file. The two live-fetched samples above (five days apart)
both carry a generation time of ~08:05 UTC, which is suggestive of a fixed daily publish
schedule (standard practice for AGPS/ephemeris providers) but is two data points, not a
density that proves "exactly once every 24 hours" - it's equally consistent with a
less-frequent automated job that happens to run at a consistent wall-clock time whenever it
does run. Confirming the real cadence would need polling `Last-Modified` over several
consecutive days, not done here.

## Summary

- `./tools/sgee.py FILE --write` - writes real AGPS orbital data, verified byte-exact
  against a real capture and against real hardware read-back. Originally an action inside
  `write_nav.py`; split into its own file 2026-08-05 for consistency with
  `custom_modes.py`/`apps.py`/`exercise_log.py` (see `training_program_andre.md`'s note on
  the same split - André caught the inconsistency).
- A live, free, unauthenticated data source exists and was confirmed working today:
  `https://devices.suunto-operations.com/devices/gpsorbit/binary` (and `glonassorbit/binary`).
- GLONASS data's placement within `GpsSGEE` is not determined, and that's expected rather than
  a gap: per André, only Traverse, Traverse Alpha and Ambit3 Vertical have a GLONASS receiver
  at all - the Ambit3 Peak this project verifies against doesn't, which is exactly why the real
  capture never wrote a GLONASS blob (nothing to write it for). Not a missing case for *this*
  watch; would need one of those three models on hand to reverse-engineer for real, not guessed
  at from `glonassorbit/binary`'s existence alone.
- The `0x0b15` orbit-status query is now fully decoded, confirmed against a live example this
  project generated itself, not just seen once in a capture. The same generation-date
  structure is also readable directly in the ephemeris file's own header, confirmed against
  three independent real samples.
- The "how often does this need refreshing" question is answered: it isn't a client-side
  timer at all - `isNewSGEEAvailable` compares the watch's current generation date against
  whatever the server currently has published, and only writes when the server's is newer.
  Confirmed both from the decompiled function name/shape and from André's own real-world
  test (a sync shortly after this project's write correctly did nothing, because nothing
  newer existed yet). The server's own publish cadence (looks daily, ~08:05 UTC, from two
  samples five days apart) is the only piece left unconfirmed with real density.

This closes the AGPS/orbital sync investigation: write mechanism built and byte-exact
verified, a live free data source found and confirmed working, a full round trip proven on
real hardware, and the refresh/staleness question answered with a real mechanism rather than
a guess.
