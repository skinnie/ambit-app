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
- ~~GLONASS data's placement within `GpsSGEE` is not determined, and that's expected rather
  than a gap: per André, only Traverse, Traverse Alpha and Ambit3 Vertical have a GLONASS
  receiver at all...~~ **SUPERSEDED 2026-08-10 - see "GLONASS on the Kailash" below.** The
  premise was incomplete: the Kailash has a GLONASS receiver too, its own separate
  `GlonassSGEE` region, and had never received a single byte of GLONASS ephemeris.
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

---

## GLONASS on the Kailash (2026-08-10)

Supersedes the summary bullet above, whose premise ("only Traverse, Traverse Alpha and
Ambit3 Vertical have a GLONASS receiver") was incomplete. The Kailash has one as well, and
the whole path turned out to be reachable without guessing at anything.

### What the watch declares

Its own `0x0b21` memory map lists a region the Ambit3 family does not have at all:

| region | address | size | state before this work |
|---|---|---|---|
| `GpsSGEE` | `0x0704e0` | 140,000 B | populated |
| `GlonassSGEE` | `0x1339e0` | **100,000 B** | **`0xff` throughout - erased since manufacture** |

Verified by reading the flash directly, not inferred from the region checksum: 4096/4096
bytes came back `0xff`, exactly one distinct byte value. Its schema also carries entry
`0x15 EnabledNavigationSystems` (`enum:0=GPS,1=GPS+Glonass`), which the Ambit3's descriptor
has no equivalent of.

### Why it was empty: a config allowlist, not a technical limit

SuuntoLink has the whole GLONASS pipeline built. `movescount.js`'s
`downloadGnssOrbitFiles()` fetches BOTH files for the SGEE format:

```js
case ExtendedEphemerisDataFormat.SGEE:
  Promise.all([ downloadFile(serverUrl+'/devices/gpsorbit/binary?appkey=…',     'gpsorbit.bin'),
                downloadFile(serverUrl+'/devices/glonassorbit/binary?appkey=…', 'gloorbit.bin') ])
```

and `active_device.js` passes both URIs down (`postSgee(Serial, GPSSGEEFileURI,
GlonassSGEEFileURI)`). The gate is `Devices.xml`, which declares
`<options><glonass><download/></glonass>` for exactly three devices - Ambit3 Vertical,
Traverse, Traverse Alpha. **Kailash's entire option block is `<firmware><bootupdate>`.**

Confirmed in live behaviour, not just config: a full SuuntoLink sync rewrote `GpsSGEE`
(`0x0b15` went 08:05 -> 16:05 the same day) and never touched `GlonassSGEE`. So GPS orbit
is NOT gated by that file - only GLONASS is, and Kailash was left off the list.

Patching the live `Devices.xml` to add Kailash to that list does not work, and the reason is
worth recording: **SuuntoLink restores `Devices.xml` on startup.** The patched file
(318,850 B) was byte-identical to the original (318,789 B) again after the next launch, so
`gloorbit.bin` was never downloaded. That is not evidence the gating is deeper than config -
the config simply reverted before the app ever read it.

### The format needed no reverse-engineering

`gpsorbit/binary` and `glonassorbit/binary` share a byte-identical 12-byte header:

```
gpsorbit.bin      62 12 37 09  7f 01  07 ea 08 0a  00 00  a9 f0 de 82 …
glonassorbit.bin  62 12 37 09  7f 01  07 ea 08 0a  00 00  a9 f2 33 a3 …
                  └─ magic ─┘  └ver┘  └2026-08-10┘        └ payload ──┘
```

Same magic, same version, same big-endian year + month + day. And the region framing is the
same one `GpsSGEE` already uses - `[u32 LE length][raw file]` - confirmed from both ends:
the watch's own `GpsSGEE` begins `28 1b 01 00` (= 72,488) followed verbatim by
`gpsorbit.bin`, and the `kailashactivity` capture wrote 72,020 bytes whose leading u32 is
72,016 (= length + 4).

Note the files regenerate through the day: 50,186 B and 49,950 B were both served on
2026-08-10.

### Written, and it persists

`sgee.py --device kailash --glonass FILE --write` wrote 49,950 bytes (+4 prefix) to
`0x1339e0`. Read-back matched the source file byte-for-byte, length prefix correct. **The
first GLONASS ephemeris this watch has ever held**, by any software.

Persistence, tested rather than assumed:

- **Survives a SuuntoLink sync** - after a full Windows sync the region still read exactly
  49,950 bytes, our own marker. SuuntoLink leaves it alone.
- **Wiped by a firmware reset** - the reset erases it; the subsequent sync does not restore
  it (nothing writes it).

A 37-minute walk with GLONASS enabled and the data loaded produced a clean track: 73 points,
median step 42 m at ~30 s sampling, no jumps >150 m, no gaps. That is the "no harm done"
result. It is NOT evidence the data helped - that was a warm start (the watch had fixed
minutes earlier), and extended ephemeris only pays off on a genuinely cold one.

### `EnabledNavigationSystems` is NOT the GNSS switch

Entry `0x15` looks like the obvious GLONASS toggle and demonstrably is not. With the watch's
own "GPS & GLONASS" menu ON the field read 0; with it OFF it read 0; and a byte-comparison
of the two 152-byte settings blobs across that toggle showed 40 entries in, 40 out, **zero
bytes changed anywhere**. Writing 1 does change the field, and a re-read confirms the field -
but that is not evidence the receiver changed, a claim made and corrected the same day. It is
exposed read-only in `KAILASH_SETTINGS` with that note. Wherever the watch keeps its real
GNSS setting, it is not in the `0x1100` blob and has not been found yet.

### Practical upshot

Re-write it every week or two (the file regenerates daily, and stale ephemeris stops helping
after roughly one to a few weeks - same freshness logic as GPS, above):

```
./tools/sgee.py --device kailash --glonass gloorbit.bin --write
```

`sgee.py` refuses outright on a watch that declares no `GlonassSGEE` region rather than
guessing an address, and hard-bounds-checks the file against the size THAT WATCH declares
before planning a single byte.

### The 7R app does not write orbital data over BLE (2026-08-10)

Tested deliberately rather than inferred from silence. The Kailash's `GpsSGEE` was written
with a genuinely old file (2026-07-31, ten days stale - the watch reports the date embedded
in the file itself, so `0x0b15` answered honestly), then the 7R iOS app was opened fresh and
allowed to sync, with PacketLogger capturing
(`assets/APK/kailash/Untitled 3 - (null).pklg`).

Result: **46 NSP messages, zero `0x0b16` data writes, and not even a `0x0b15` orbit-status
query.** Only device info, `0x1100` settings reads, `0x1201` pushes and log headers. André
confirmed the app displayed its "updating orbital data" message during that very session,
and again after closing and reopening it.

So that message does not correspond to a watch transfer - the app is doing something else
with it (most plausibly fetching to the phone or refreshing its own cache). The tell is that
it never asks the watch how fresh its data is; anything about to update would check first.

Consequence, and the reason this is not worth chasing further: our own cable path
(`sgee.py`, GPS and GLONASS) is the only mechanism that demonstrably puts orbital data on
this watch at all, and the only one that has ever written GLONASS. Keeping it.
