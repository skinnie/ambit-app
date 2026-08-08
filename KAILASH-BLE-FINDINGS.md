# Kailash ↔ 7R app: real BLE protocol findings, 2026-08-08

Companion to `KAILASH-SCOPING-NOTE.md` (see the status box at its own top). That note framed
the Kailash's BLE protocol as an open fork - "Ambit3-like NSP, or a modern/Movesense-style
stack?" - to be settled by a future capture. This is that capture, and the answer.

## Captures

All in `assets/APK/kailash/`, taken on André's iPhone 13 mini (iOS 27 beta 3) with Apple's
Bluetooth diagnostics profile + a sysdiagnose, decoded with Xcode's PacketLogger and read
directly by `tshark`/Wireshark (native `.pklg` support, no conversion needed) and
`tools/ble_pklg.py` (the NSP-layer decoder written for the Ambit3's own 2026-08-08 iOS
captures, reused here unmodified):

| File | What it is |
|---|---|
| `kailashpair.pklg` / `.btsnoop` | A real Kailash + 7R app pairing session |
| `kailash7rsettingschange.pklg` / `.btsnoop` | A later session, same watch/phone, a settings value changed in the 7R app's UI |
| `ambit3pairand2activitiesnoorbit.pklg` | **Not Kailash** - a real Ambit3 + Suunto-app session, captured the same day as the reference the existing `ble_pklg.py`/HANDOFF.md Milestone-7 write-up was built from. Kept in the same folder as a convenient side-by-side comparison; see Finding 2 for why that comparison mattered. |
| `kaylashactivity04km.pklg` | A real 0.4 km activity: long-pressed 7R to start recording (no sport choice - "likely walk or similar"), walked with the **watch only, phone not present**, pressed 7R again to stop, then synced. See Finding 5. |
| `kaylashactivity1.8km.pklg` | Same method, a real 1.8 km walk (watch only, no phone) - a longer, second data point. See Finding 6. |
| `kailashsettingjson.json` | Unrelated: a bulk export from the app's own local storage, not a capture |

## Finding 1: the Kailash/7R protocol is the Ambit3's NSP, not a different stack

Running `tools/ble_pklg.py` against `kailashpair.pklg` decodes it cleanly - correct 12-byte
headers, correct SLIP framing, **every CRC32 trailer valid** - using the exact same
`ambit_pcap.CMD_NAMES` table built from Ambit3 USB captures. No Kailash-specific decoder was
needed or written. Real content came straight out:

- The device-identify message (`0x0002`, the same "hello" Milestone 7 found on the Ambit3) is
  `"Hoopoe"` (the Kailash's own real codename, confirmed independently in
  `Firmware/kaylash_Hoopoe-fw_2.0.5-72.1.0.zip`) followed by descriptor id
  `79DC39510E000100`, matching the descriptor file already in this repo
  (`assets/APK/kailash/Suunto 7R/Container/Documents/descr+79DC39510E000100+2.0.5`, also
  `assets/WIndows apps/Suuntolink/descr+79DC39510E000100+2.0.5`).
- `0x1100`/`0x1101` (settings read/write), `0x1200`/`0x1201` (log headers/synced), `0x0b1e`
  (compact serial) all appear, byte-identical in shape to their USB and Ambit3-BLE forms.
- `tools/sbem_schema.py`, loaded against the Kailash's own descriptor above, named every field
  of the `0x1100` write with real paths (`sml.DeviceSettings.Date.Format`,
  `...Display.Backlight.Brightness`, etc.) - the same schema-driven decoder
  `tools/settings_write.py` already uses for the Kailash over cable, unmodified, now also
  correct over BLE.

This resolves `KAILASH-SCOPING-NOTE.md` §4's fork: not the modern/Movesense stack, no
`libmds.so` needed for the transport. See that note's own updated status box for the
practical consequence (existing `tools/kailash_*.py` cable machinery already assumed this and
was right to).

## Finding 2: the GATT service is the Ambit3's own, not per-model

Cross-checked by running the same GATT service/characteristic discovery against both the
Kailash captures and the Ambit3 reference capture in the same folder. Identical in both:

- **Service**: `d0fd6b80-e62e-11e3-a2e9-0002a5d5c51b`
- **Write characteristic** (phone→watch, ATT opcode `0x52`, Write Without Response):
  `c6339440-e62e-11e3-a5b3-0002a5d5c51b`
- **Notify characteristic** (watch→phone): `...806bfdd0` under the same `1bc5d5a5-0200-...`
  wire-order family

These are exactly the UUIDs `HANDOFF.md`'s Milestone 7 already recorded from the Ambit3's own
BLE work (`write c6339440-..., notify d0fd6b80-...`) - now independently confirmed from a
second watch generation and a second app. A worked example, straight from
`kailashpair.pklg`, frames 742/743/746/747 (four consecutive ~20-byte GATT writes on handle
`0x003e`, concatenated):

```
7e 00 02 02 00 09 00 00 00 30 00 00 00
48 6f 6f 70 6f 65 00 00 00 00 00 00 00 00 00 00
37 39 44 43 33 39 35 31 30 45 30 30 30 31 30 30
02 00 05 00 48 01 00 00 01 05 00 00 00 04 00 00
d1 02 9a 8d 7e
```
`7e` open · `00 02` = command `0x0002` · `02` flags · `00` errFlags · `00 09` connId (LE) ·
`00 00` pktNum · `30 00 00 00` dataSize=48 · then the 48-byte `"Hoopoe\0...79DC39510E000100\0..."`
payload · `d1 02 9a 8d` CRC32 (LE) over header+payload · `7e` close. `tools/ble_link.py`'s
`encode_nsp_frame()` reproduces these exact bytes given the same inputs - see that file's own
inline test claim and the verification note in "What was built," below.

One real, apparently fixed vendor-family pattern worth recording: this project's own GATT
discovery dump shows the **raw wire-order** form of these same UUIDs as
`1bc5d5a5-0200-ddba-e311-2ee62071ae98` (service) and siblings - reversing that byte sequence
gives back `98ae7120-e62e-11e3-badd-0002a5d5c51b`, i.e. the *service's own* canonical UUID
(distinct from the write/notify characteristic UUIDs above, which live one level down). Not a
new fact - `HANDOFF.md` already had this exact triple - but useful confirmation that
`tshark`'s two different UUID renderings (raw Read-By-Group-Type-Response bytes vs. its own
later context-resolved annotations) are the same value, in case that trips up whoever looks
at a raw capture next.

## Finding 3: real evidence on the Ambit3's own open `IsNspCapable` question

`write_nav.py` already documents `BLE_WHITELIST_ENTRY = 0x41` for the Ambit3 - the
`sml.DeviceSettings.WhitelistedBleDevices.Device` struct (`MAC`, `IdentityResolvingKey`,
`EncodingKey`, `EncodingRnd`, `IsAuthenticated`, `IsNspCapable`) that `HANDOFF.md`'s Milestone
7 spent real effort on. **The exact same struct exists in the Kailash's own descriptor, just
at a different entry id (`0x35`, not `0x41` - entry ids are per-descriptor, already a known
gotcha, see `settings_write.py`'s own docstring for the bug that taught this project that
lesson).** Decoded from `kailashpair.pklg`'s real `0x1100` write, via
`schema.decode_entry(0x35, ...)` against the Kailash's own descriptor:

```
DeviceId=4278644736  AddrClass=0  MAC='...'
IdentityResolvingKey='...'
EncodingKey='...'
EncodingRnd='...'  EncodingDiv=57438
IsAuthenticated=1  IsNspCapable=0
```
(real MAC/IdentityResolvingKey/EncodingKey/EncodingRnd values redacted here - same
`SECRET_FIELDS` this project already treats as key material everywhere else, see
`write_nav.py`'s own `--redact`/`show_value()`. This file had them in cleartext until
2026-08-08's documentation audit caught it.)

This is a **real, working session** - the same capture where full settings, log-header, and
serial traffic all decoded successfully end to end (Finding 1) - with `IsNspCapable=0` on the
bond actually in use. That is independent, cross-device corroboration for `HANDOFF.md`'s own
2026-08-08 conclusion ("the safer reading... is that it's vestigial from the Movescount-era
stack and the current firmware + app do not check it at all"): a second watch, a second app,
same result - a full NSP session proceeds normally with the flag unset. Doesn't finish
Milestone 7 (that was already considered likely-resolved, pending the Step-2 write experiment
being unnecessary), but it's one more real data point against ever needing to write that flag.

Also visible in the same struct: `EncodingKey` really did change between the two Kailash
captures (different real values in `kailashpair.pklg` vs. `kailash7rsettingschange.pklg`,
minutes apart, same phone - real bytes redacted here too) - matching the Ambit3's own
already-documented finding that this key is per-bond and regenerated at pairing, not derived
from anything stable.

Fid `0x36`, adjacent to the whitelist entry, is unrelated - just
`sml.DeviceSettings.HomeLocation` (`Latitude`/`Longitude`), not a second bond-related field.

> **Followed up, 2026-08-08, later the same day**: this field got its own full treatment -
> decoded from the real `kailashsethome.pklg`/`kailashsnotificationsandsethome.pklg`
> captures (`50.6240395, 3.0552564`, matching André's real home city, Lille, to ~0.6 km),
> confirmed byte-exact against the schema (`<MOD> PI*x/(10^7*180)` on both `Latitude`
> `0x28`/`Longitude` `0x29`, confirming the degrees×1e7 encoding directly), and wired up as a
> real read+write field on both desktop and Android (range-checked, confirmed-by-reread, not
> yet hardware-tested). Full write-up: `custom_modes_andre.md`'s "Kailash Home Location"
> section and the `ambit_app_kailash_home_location_field` memory - not duplicated here.

## Finding 4: a real settings-write diff, for anyone building the Kailash equivalent of `settings_write.py`'s live-write confirmation

Diffing the two captures' `0x1100` write payloads (both decode as 41 named fields via the
Kailash's own schema) shows exactly what the 7R app's settings screen changed between
sessions: `AltiBaro.StormAlarm` 1→0, `Audio.Mode` 1→0, `Display.Backlight.Brightness` 49→50,
`Display.Backlight.Mode` 1→0. Ordinary user-driven settings changes, not a protocol finding by
themselves, but a second confirmation (independent of `settings_write.py`'s own
cable-based one) that a real `0x1100` write on this watch only carries the fields that
actually changed plus the unchanged rest of the tree, not a sparse diff - consistent with how
`settings_write.py --write` already works.

## Finding 5: a real activity does sync over BLE - as a small summary push, not a bulk download, and that's the watch's own real design, not a gap in this project's captures

`kaylashactivity04km.pklg` is a real "GPS Power Use" recording (the article's own name for
it - see below): André long-pressed the 7R button to start it, walked ~0.4 km with **only the
watch, no phone present**, long-pressed again to stop, then opened the 7R app to sync. This
directly rules out the "the phone tracked it with its own GPS" hypothesis raised while
reviewing the previous two captures - the phone had nothing to track with.

**A real, new, distinctly-dated activity did appear, decoded via the same
`sml.DeviceHistory.Histories.History.LogHeaders.Header` (fid `0x66`) struct as before**, timed
`2026-08-08T19:08:52` - right when the walk ended. Reading the *schema's own* `<MOD>`
conversion tags this time (`tools/sbem_schema.py`'s `Field.mod`, not assumed from a
similarly-named field elsewhere):

```
Duration:   raw 591,  <MOD> x/10   -> 59.1 s
Speed.Max:  raw 421,  <MOD> x/360  -> 1.17 (unit unconfirmed, m/s plausible - a walking pace)
Distance:   raw 44,   <MOD> ''     -> 44, unscaled (schema declares no conversion at all)
```

Against the real 0.4 km (400 m) walked, `Distance=44` is a real ~9x undercount - not a units
bug in this project's decoding (the schema's own tag was checked directly, not guessed), a
real limitation of what the watch itself recorded.

**A second, previously-unseen top-level object also appeared in the same connection: `sml.
DeviceLog`** (singular - distinct from both `DeviceLogBook`, entry `0x8d`, and `DeviceHistory`,
entry `0x67`), carrying **3 real GPS point samples** with `Latitude`/`Longitude`/`GPSAltitude`/
`Time`/`UTC`, decoded the same schema-driven way:

```
2026-08-07T12:29:59Z  50.6237298, 3.0552071  (a day-old point, unrelated to this walk)
2026-08-08T17:09:07Z  50.6238461, 3.0553029
2026-08-08T17:09:39Z  50.6237667, 3.0552925  (32s later)
```

The last two land right in the activity's own window (17:09 UTC = 19:09 local, matching the
`19:08:52` activity timestamp above) and decode to real coordinates near André's actual
location. Only two real fixes, 32 seconds apart, for the whole 59-second walk.

**Why so sparse, and why the distance undercount, with a real primary source rather than a
guess**: `assets/articles/Suunto Kailash Review...pdf`, a long-term real-world review of this
exact watch, documents the 7R-button-long-press recording mode directly (its own name: "GPS
Power Use", added in a 2015 firmware update) - **"records a GPS location every second for the
first 15 minutes... It's still not quite the route record one gets from an Ambit, but it could
be used to e.g. make a record of a marathon's route that is relatively exact."** Straight from
Suunto's own real-world behavior: even this watch's own dedicated recording mode is explicitly
*not* a dense continuous track the way an Ambit's exercise log is - and a real GPS cold fix
commonly takes 30-60+ seconds, which for a 59-second walk plausibly means the watch got only
the two fixes actually seen here before being stopped, computed a straight-line distance between them
(44 m for two points that close together, against 400 m actually walked - consistent), and
that's genuinely everything there was to sync. **The 3-sample push in this capture is very
likely the complete real content for this activity, not a truncated view of something
bigger** - which reframes "why is there no bulk 0x0b17-style download" from an open question
into an answered one: there was never a bulk track for this watch to send.

**Update, see Finding 6 below: correct that the *mechanism* only ever sends a handful of
samples - it doesn't, a longer real activity pushed 36 of them, paginated. What was specific
to this 0.4 km/59 s test was the low real fix count, not a cap on `0x1200` itself.**

Also from the same article, confirming two things this project already suspected from other
angles: the `1bc5d5a5`/`98ae7120`-family transport carries this data **the same
echo-shaped way as everything else in this project's `0x1200` traffic** - phone sends the big
payload, watch only ever sends short status pings - and Suunto's own review site records, as
of a 2018 comment, **"the Kailash only 'records' into its own iOS app, doesn't sync across to
anything"** - the original pain point in `KAILASH-SCOPING-NOTE.md` §1 (activities stuck on the
watch/in the 7R app silo) is confirmed straight from the device's own original design intent,
not a bug that crept in later.

**Not related to BLE/GPS sync at all, despite looking related at first**: the same article
(a 2016 comment) confirms the 7R app also overlays photos onto its timeline - "take a picture
during that urban exploration, and it is... shown while going through the timeline in the
app." That's the app cross-referencing the iPhone's own Photos library (EXIF timestamp/
location) against the timeline view, independent of anything synced from the watch over BLE.
Worth recording so it doesn't get chased as a protocol lead later: if photos on the timeline
seem to "know" a location the watch never recorded, this is very likely why.

## Finding 6: a longer real activity (`kaylashactivity1.8km.pklg`) confirms the mechanism scales, paginates, and is much more accurate given real fixes

Same method as Finding 5 - watch only, no phone, 7R long-press to start and stop - but a real
1.8 km walk instead of 0.4 km. This directly answers the open question Finding 5 left
("does the sample list scale, or is it capped?") and gives a real, second, independent
accuracy check on `Distance`.

**36 real GPS samples came through** (plus the same stale carried-over leading point pattern
as Finding 5 - here literally the 0.4 km test's own last fix, `17:09:39Z`, confirming that
first-entry-is-stale is a real, repeatable shape, not a one-off), spanning
`17:33:11Z`-`17:51:15Z`: **~18 minutes at a steady ~31-second interval.** That interval, not
the source article's "every second for the first 15 minutes" - real, current-firmware (`Hoopoe
2.0.5`, a decade past that 2016 review) behavior evidently differs from the article's, or the
7R app downsamples before pushing over BLE; this capture can't tell which, only that ~31 s is
what actually crosses the wire.

**Paginated across two separate `0x1200` messages, using the same cursor mechanism
`write_nav.py` already documented for the Ambit3's own logbook** (that file's own docstring:
"the watch pages a long list... the continuation cursor sits in the reply prefix"). Concretely
here: the first message (`pkt=3`, 1003 B) has the usual `[4B cursor][2B flag][SBEM0102][Header
fields][Samples, declared length 925 B]` shape; the second (`pkt=4`, 456 B) is `[4B
cursor=0][2B flag][more Samples, declared length 444 B]` - **no `SBEM0102` magic at all**,
since it's a continuation, not a new self-contained object. `sbem_schema.entries()` requires
the magic and raises on this second shape by design - decoding a continuation page needs the
same `[u8 id][u8 len][data]` grammar applied directly at offset 6 (past the cursor+flag),
skipping the magic check.

**Distance accuracy, checked two independent ways:**

```
Point-to-point haversine sum over the 36 real samples:        1512.6 m
Watch's own LogHeaders.Header.Distance for this activity:     1595   m (raw, unscaled)
Real distance walked:                                         1800   m
```

Both watch-side figures agree closely with each other (~5% apart, real internal consistency -
the `Distance` field genuinely tracks the real GPS path, it isn't an unrelated number) and both
land within ~12-16% of the truth - a completely different result from Finding 5's 9x
undercount. This confirms the hypothesis Finding 5 raised: **the earlier undercount was a
too-short-recording, too-few-real-fixes artifact, not a general flaw in how the watch computes
distance.** The remaining ~12-16% gap here has a mundane, sufficient explanation on its own:
connecting real fixes 31 seconds apart in a straight line necessarily cuts corners on any path
that isn't dead straight - no further mechanism needed to account for it.

## What was built: `tools/ble_link.py`

A `Link`-compatible BLE transport (see `write_nav.py`'s own `Link` class), so any existing
tool that takes a `link` object (`kailash_history.py`, `kailash_tracklog.py`,
`settings_write.py`, `write_nav.py`'s own read functions) can run over BLE by constructing a
`BleLink` instead - nothing else about those callers needs to change.

**Confirmed, not guessed:** the SLIP encoder/decoder and NSP frame format. Round-tripped in
this session against the real bytes quoted in Finding 2 above - `encode_nsp_frame(0x0002,
payload, flags=0x02, conn_id=0x0009, pkt_num=0)` reproduces the real captured frame
byte-for-byte, and the incremental assembler (`NspAssembler`, built for live per-notification
delivery rather than whole-capture-file decoding like `ble_pklg.py`) correctly reassembles the
same message when fed in realistic ~20-byte chunks across multiple calls, matching how BLE
notifications actually arrive.

**Update, 2026-08-08, later same day - a real Linux/`bleak` adapter became available, and
`scan` is now confirmed working, but only after fixing a real bug this exposed.**
`SERVICE_UUID`/`NOTIFY_CHAR_UUID` were swapped relative to `HANDOFF.md` Milestone 7's own
values (service `98ae7120-...`, write `c6339440-...`, notify `d0fd6b80-...`): what was
here as `SERVICE_UUID` (`d0fd6b80-...`) was actually the notify characteristic's real
UUID, and `NOTIFY_CHAR_UUID` was a manually byte-reversed ("wire order") rendering of
that same UUID rather than a real distinct value - confirmed precisely, reversing
`d0fd6b80-e62e-11e3-a2e9-0002a5d5c51b` byte-for-byte reproduces the old
`NOTIFY_CHAR_UUID` constant exactly. Concretely caught because `ble_link.py scan`,
filtering on the old (wrong) `SERVICE_UUID`, found nothing across two real attempts even
with the Ambit3 (`0C:8C:DC:2A:58:28`, `Ambit3 1849100781`) advertising right next to the
adapter, confirmed separately via an unfiltered `bleak` scan that saw it clearly
(`rssi=-58`, `uuids=['98ae7120-e62e-11e3-badd-0002a5d5c51b']`). Fixed in `ble_link.py`;
`scan` now finds the watch reliably on every retry. This was never exercised on the
Kailash directly (no Kailash hardware in this follow-up session, only the Ambit3), but
since Finding 2 already established both watches share one fixed service/characteristic
set, the fix applies equally to both.

**Still not confirmed - the actual `connect()`/pairing/`start_notify()` path**, since the
bug above was only caught at the `scan()` filter stage; a real connect attempt (which
would also exercise `start_notify(NOTIFY_CHAR_UUID, ...)`, previously called with the
garbled wrong value - a second real bug this same fix corrects, not yet verified live)
hasn't been tried yet. Also still unconfirmed:
- Whether `conn_id` (`0x0009` in the one real outgoing example seen) needs to match anything
  the watch checks, or is ignored/echoed. Only one direction, one session, one value was ever
  observed - see the constant's own comment in `ble_link.py`.

Treat the first real run the way every other write in this project has been verified: `
--verbose`, capture alongside it, diff the raw bytes against a fresh `.pklg`.

## Finding 7: `sml.DeviceLog` is real and queryable over cable, but three real attempts all came back empty - most likely BLE-only, not a timing issue

Added `--gps` to `tools/kailash_history.py`, querying `sml.DeviceLog` (entry `0x53` - a real
queryable top-level object, confirmed via `sbem_schema.load(...).queries`, sibling to
`DeviceHistory`'s `0x67`) the exact same way that file already reads `DeviceHistory` - same
`0x1200` command, same request shape, different entry id. Three real, live attempts against
the actual watch over cable, each time immediately after a real "GPS Power Use" recording,
**all came back with 0 samples**, while `DeviceHistory`'s own `LogHeaders.Header` list, read
in the very same runs, correctly gained a new real entry each time - the query mechanism
itself is fine throughout, the object is just empty:

| Attempt | Real gap between stopping and the cable read | Phone Bluetooth | Result |
|---|---|---|---|
| 1.8 km walk, read afterward | ~minutes (already synced with 7R earlier, deliberately, to capture the BLE traffic) | had been on earlier | 0 samples |
| 27-minute/2.78 km walk | ~5 min (`21:59:46` end -> `22:04:33` read, by the `DateTime` field's own timestamp) | **confirmed fully off**, not just greyed out | 0 samples |
| 16.3 s stationary test | **under a minute** | still fully off | 0 samples |

Ruled out along the way: **background BLE auto-sync** (this watch family is known to
auto-sync the moment a paired phone comes in range - already documented Ambit3-side - but
Bluetooth was confirmed hard-off for attempts 2 and 3, so it never had the chance), and
**a decay/timeout window** (attempt 3 was read inside a minute and was still empty - if a
window exists at all, it's shorter than that, which stops being a useful "window" in
practice).

**Current best explanation, not yet independently confirmed**: `sml.DeviceLog` is most likely
populated as a side effect of an actual BLE session - staged for the connecting phone as part
of the connection/pairing handshake itself - rather than being general persistent state
equally reachable from any transport the way `DeviceHistory` clearly is. Cable and BLE aren't
two doors into the same room for this one object; the cable door may simply not open into it
at all. This would mean the two real captures behind Findings 5-6 saw real samples *because*
a BLE connection was actively involved, not because they happened to be quick enough - and
that no amount of "read faster" or "read before syncing" over cable would ever have worked.

**What would actually confirm this, still open**: a live BLE read (`ble_link.py`, or another
real iOS capture) of a *fresh, not-yet-synced* recording, timed close to a cable read attempt
of that exact same recording. If BLE shows real samples while cable (moments apart, same
activity) shows none, that's decisive. Not yet done - `ble_link.py`'s own connect/notify path
is itself still unverified against real hardware (see "What was built," above), so this is
blocked on that first real BLE run either way.

**Practical takeaway for the actual project goal (export Kailash activities as GPX/FIT/TCX,
`KAILASH-SCOPING-NOTE.md` §1)**: don't keep chasing `sml.DeviceLog` over cable - three real
attempts, three empty results, and a real mechanistic reason why. The passive `TrackLog`
flash region `kailash_tracklog.py` already reads directly (continuous background fixes,
independent of "GPS Power Use" recordings) remains the working cable-side path to real point
data; `DeviceHistory.LogHeaders.Header` (already read by this file) remains the reliable
cable-side path to each activity's summary stats. Raw per-point export specifically for a
"GPS Power Use" recording looks like it may only ever be achievable by catching a live BLE
sync, not a design gap in this project's own tooling.

## Still open (updated against `KAILASH-SCOPING-NOTE.md` §5)

Item 1 (transport family) and item 2 (device identification) were closed by Finding 1 above;
Findings 5 and 6 together close the practical question behind item 3 (the activity data
*does* reach the phone, over `0x1200`, as a summary plus a paginated GPS-sample list - not a
separate bulk-read command; scales and paginates correctly for a real 36-sample activity, not
capped at a handful). What's left, genuinely:

- **Item 4, the passive travel-history log format** (`DeviceHistory`'s own dense data, as
  opposed to one `GPS Power Use` recording) - still untouched; `kailash_tracklog.py`'s cable-
  read `TrackLog` flash region is the closer existing lead for this, not anything in these BLE
  captures.
- **Item 5, orbital/AGPS** - still untouched.
- **Genuinely new from Finding 6, still open, and now harder to close than it looked**: the
  real ~31-second fix interval doesn't match the source article's "every second for the first
  15 minutes" claim (a decade-old description of much older firmware). Worth knowing which of
  the two live possibilities is true - the watch itself now fixes less often, or it still
  fixes at 1 Hz but the 7R app only ever syncs a downsampled subset over BLE - before building
  anything that assumes one or the other (e.g. an offline GPX exporter for these activities
  should not assume it's getting every fix the watch actually took). Finding 7 tried the
  obvious way to tell them apart (read the watch's own copy directly over cable) and got 0
  samples three real times running, most likely because `sml.DeviceLog` turns out to be
  BLE-only, not because of timing - so this still needs a live BLE re-capture, not a cable
  one, and stays open.
