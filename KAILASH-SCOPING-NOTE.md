# Suunto Kailash (Hoopoe) — Reverse-Engineering Scoping Note

**Status:** exploratory / future project. **Keep separate from the Ambit3 route handoff** — the
Kailash is a *different generation*, uses a *different app*, and its protocol lives in *different
artifacts*. Do not build it on the Ambit3 foundation.

> **2026-08-08 update — most of this note is now historical, not current.** Both forks in §4
> below are resolved, and not the way §7 predicted: the Kailash's cable **and** BLE protocols
> both turned out to be the **same NSP family the Ambit3 already uses**, not a modern/
> Movesense-style stack. §7's "do not assume the Ambit3 findings apply" caution held for the
> memory map and log formats, which really are Kailash-specific, but not for the wire protocol
> itself. Concretely, since this note was written: `tools/write_nav.py`'s `Link`/`CMD_NAMES`/
> `sbem_schema.py` machinery already drives the Kailash over cable (`tools/kailash_history.py`,
> `tools/kailash_tracklog.py`, `tools/kailash_eventlog.py`, `tools/settings_write.py --device
> kailash`, all real and hardware-confirmed - see git history), and a real 7R-app BLE capture
> (§4's "decisive artifact", finally taken) confirms the **exact same GATT service/
> characteristics and SLIP-framed NSP envelope as the Ambit3's own Milestone 7** work in
> `HANDOFF.md`. Full writeup: `KAILASH-BLE-FINDINGS.md`. New BLE transport, usable by every
> existing Kailash tool: `tools/ble_link.py` (built from the capture, not yet run against real
> hardware - see its own docstring for what's confirmed vs. still needs a live test). The asset
> checklist in §6 is updated accordingly; the rest of this note (§1-§3, §5's remaining
> unknowns) is still accurate and worth reading for context.

This note captures (1) what we know, (2) what to preserve *now* before it's lost, and (3) the
most tractable path to a working offline tool, so the project can be picked up cleanly later.

---

## 1. What this project is (and isn't)

**Goal (the real pain):** activities recorded on a **Suunto Kailash** and offloaded via
**SuuntoLink** (desktop) **do not reach the Suunto app** — Suunto never properly migrated Kailash
data into the new app ecosystem. So the user has activities stuck on the watch / in SuuntoLink
with no clean way to get them into a modern service. The useful deliverable is: **read Kailash
activities offline (over the cable), and export them as FIT/GPX/TCX** — bypassing Suunto's broken
cloud handoff. Optionally: orbital (AGPS) update, time sync, settings.

**Not routes.** The Kailash is a GPS *travel/adventure* watch (world-explorer "7R" timeline,
places/POIs visited), not a navigation watch. It has no route-following feature, so the Ambit3
route work does **not** apply. This is an *activity-read / sync* project, not a route-write one.

---

## 2. Key facts established so far

- **Codename: `Hoopoe`** (firmware seen: `Hoopoe-fw_2.0.5-72.1.0`). This is a Suunto bird-family
  codename, same naming scheme as Bluebird/Emu/etc.
- **The Kailash is NOT a Movescount device.** It synced only with the **7R app (iOS-only)**, never
  with Movescount. Confirmed by the library evidence below.
- **`libkomposti-ng.so` (the Movescount native lib) does NOT contain a Kailash driver.** Its
  device table lists Ambit / Ambit2 / Ambit3 (Emu/Finch) / GPS Track POD / EON Steel / dive
  computers — **no `type="Hoopoe"` device, no Hoopoe driver class.** `Hoopoe` appears only as a
  *name string* at three sites near `SyncServiceImplementation::firmwareUpdate` and TimelinePart
  sync — i.e. the old lib knew the name for firmware/timeline bookkeeping, but never spoke the
  Kailash's sync protocol.
- **Implication:** the Kailash sits on the **newer Suunto sync architecture** (7R app + the
  modern "TimelinePart" timeline model), architecturally closer to the **modern-watch generation
  in the V2 handoff** than to the Ambit3. The real protocol driver is in the **7R app / modern
  Suunto app libraries**, NOT in `libkomposti`.
- **BUT: a working desktop cable path exists.** SuuntoLink *can* pull activities off the Kailash
  over the cable (that's how the user got activities into SuuntoLink at all). **Desktop cable
  traffic is far easier to capture than iOS BLE** — this is the tractable angle (§4).

---

## 3. Preserve NOW (prevents permanent, irreversible loss)

The 7R app is iOS-only and appears abandoned by Suunto; an iOS update or App Store removal can
destroy the only working copy. Do these low-effort steps before anything else:

1. **Back up the firmware file** `Hoopoe-fw_2.0.5-72.1.0` to multiple permanent locations. It's
   the *device side* of the protocol and Suunto's hosting may vanish. Just copy the file verbatim.
2. **Make an ENCRYPTED local iPhone backup** (Finder on Mac / iTunes on Windows, tick *Encrypt
   local backup* — encryption is what makes it include app data). This preserves the 7R app's
   **container**: its databases, cached protocol/format definitions, and stored activities. Even
   if the app executable stays FairPlay-encrypted, the data files are often plaintext SQLite/plist
   and reveal a lot.
3. **Do not delete or update the 7R install**, and ideally **set aside the device** that has it
   working, so an OS update can't break an abandoned app permanently.
4. **Keep the modern Suunto app libraries** already collected (from the v7/v8 lib screenshot):
   especially **`libmds.so`** (modern decode lib — likely understands the Kailash's activity/
   timeline SBEM format), plus the mapbox/duktape/etc. for completeness.
5. **(Higher effort, high value) Obtain a DECRYPTED `.ipa` of 7R** if a jailbroken iOS device is
   available: `frida-ios-dump` or `bagbak` pull a decrypted, analyzable binary. This is the
   crown-jewel artifact (the actual sync protocol) but the hardest to get.

---

## 4. The tractable path: capture what SuuntoLink already does over the cable

Rather than reverse the iOS 7R app (hard: FairPlay encryption, iOS BLE sniffing), **intercept the
working SuuntoLink ↔ Kailash cable sync** — the same technique that mapped the Ambit3, on hardware
the user already has (the Windows ThinkPad / any PC with SuuntoLink).

**First capture to take:**
- USBPcap (Windows) or `usbmon`/Wireshark (Linux) while **SuuntoLink downloads activities** from
  the Kailash over the cable. Also capture: initial connect/identify, time sync, and an orbital
  (AGPS) update if SuuntoLink offers one.

**What that single capture decides — the key fork:**
- **If the cable protocol resembles the Ambit3's** (HID packets starting `0x3f`, NSP 12-byte
  headers, `0x0b`-family read/write commands, `ReadMemory`/PMEM20-style log reads) → **great
  news**: much of the Ambit3 transport knowledge transfers, and an openambit-style Kailash driver
  is very approachable. The work becomes "new device profile on a known transport" (new memory
  map, new log format).
- **If it's the modern stack** (different framing, Whiteboard/Movesense-style, protobuf/CBOR-ish
  payloads) → it's a **V2-handoff-style** effort; use `libmds.so` + the V2 handoff methodology as
  the starting point, and the modern Suunto app libs become the reference.

Either way, the capture is the ground truth and tells you which project you're in **before** you
invest in either library.

> **Resolved, 2026-08-08: it's the first branch.** Both the cable protocol (already driving
> `tools/kailash_*.py` and `settings_write.py --device kailash` in production, per the status
> box at the top of this note) and, now also confirmed, the **7R app's own BLE protocol**
> (`KAILASH-BLE-FINDINGS.md`) are the Ambit3's own NSP: 12-byte header
> `[msgId][subId][flags][errFlags][connId][pktNum][dataSize]`, the same `0x0b`-family commands,
> the same SBEM0102 settings/log encoding. Not "transferable knowledge" in the loose sense
> predicted above - **literally the same protocol implementation**, down to sharing one fixed
> GATT service UUID (`d0fd6b80-e62e-11e3-a2e9-0002a5d5c51b`) with the Ambit3. `libmds.so` and the
> modern-stack/V2-handoff path never ended up needed for the wire protocol; they may still be
> relevant to the Kailash's own activity/timeline *log format* (§5 item 4, still open), which is
> a separate question from the transport this fork was actually about.

---

## 5. Unknowns to resolve (in rough order)

1. ~~**Cable transport family** — Ambit3-like NSP vs modern stack (§4 fork). *Resolved by one
   SuuntoLink cable capture.*~~ **Resolved 2026-08-08, see the note directly above: Ambit3-like
   NSP, confirmed over both cable and BLE.**
2. ~~**Device identification** — the Kailash's USB VID/PID and identify handshake (so a tool can
   recognize it). *From the same capture.*~~ **Resolved**: USB VID:PID `1493:002a` (see
   `tools/write_nav.py`'s `PRODUCT_IDS`), and the BLE identify handshake is the same `0x0002`
   "hello" the Ambit3 uses, carrying the codename `"Hoopoe"` and descriptor id
   `79DC39510E000100` (`KAILASH-BLE-FINDINGS.md`).
3. **Activity/log memory map** — where the Kailash stores activities/timeline, and the read
   command sequence. *From an activity-download capture.*
4. **Activity data format** — the Kailash's log schema (travel/timeline-oriented: places, tracks,
   timestamps). Likely modern SBEM/timeline; `libmds.so` may decode it. *Biggest unknown; needs
   capture + possibly `libmds` or the 7R container data.*
5. **Orbital (AGPS) source & write** — the assistance-data host and the write mechanism (generic,
   not account-bound; modern host is `devices.suunto-operations.com` per the V2 handoff).

---

## 6. Asset checklist (gather / preserve for this project)

| Asset | Have? | Role |
|---|---|---|
| `Hoopoe-fw_2.0.5-72.1.0` firmware | yes | device-side protocol ground truth — **back up now** |
| Encrypted iPhone backup w/ 7R + data | TODO | app container, activity DBs, format hints — **do now** |
| Decrypted 7R `.ipa` | TODO (needs jailbreak) | the actual sync protocol — crown jewel |
| `libmds.so` + modern Suunto app libs | yes (screenshot) | modern activity/timeline decode |
| SuuntoLink ↔ Kailash **cable capture** | **done** | decided the fork (Ambit3-like NSP) — `tools/kailash_*.py`, `settings_write.py --device kailash` all built and hardware-confirmed on it |
| 7R ↔ Kailash BLE capture (iOS PacketLogger) | **done, 2026-08-08** | confirmed the same NSP over BLE too — `assets/APK/kailash/kailashpair.pklg` + `kailash7rsettingschange.pklg`, see `KAILASH-BLE-FINDINGS.md`; transport tool `tools/ble_link.py` built from it, not yet run live |
| V2 handoff (`SUUNTO-V2-HANDOFF.md`) | yes | turned out not to be the relevant methodology for the transport (see the §4 resolution note above) — may still matter for the activity/timeline log *format*, §5 item 4 |

---

## 7. Relationship to the Ambit3 work

**Historical note — superseded by the §4 resolution above.** This section originally said
"separate project, do not merge... the one thing that could bridge them is §4's fork," on the
assumption that the fork would probably resolve the other way. It resolved toward the Ambit3
side instead: the wire protocol (transport, framing, command set, GATT UUIDs) is now confirmed
shared, and the Kailash tooling (`tools/kailash_*.py`, `settings_write.py`, now `ble_link.py`)
deliberately builds on `write_nav.py`'s `Link`/`ambit_pcap.CMD_NAMES`/`sbem_schema.py`
machinery rather than reinventing it — the opposite of "do not build it on the Ambit3
foundation" above. What's still separate and still must be profiled from the Kailash's own
captures, not assumed from the Ambit3: flash/memory addresses, the activity/timeline log
format (§5 item 4), and anything specific to the 7R app's own UI/settings surface
(`settings_write.py`'s `KAILASH_SETTINGS` table already reflects this — same mechanism,
device-specific entry IDs, see that file's own docstring for a real bug this distinction
already caught).

---

## 8. Recommended first session (when picked up)

**Historical — both steps below are done; see the status box at the top of this note and
`KAILASH-BLE-FINDINGS.md` for what to pick up next instead (live-testing `tools/ble_link.py`
against real hardware, and §5's remaining items 3-5).**

1. ~~Preserve the firmware + make the encrypted iPhone backup (§3.1–3.2) — 30 minutes, prevents
   permanent loss.~~
2. ~~Install SuuntoLink on the PC; capture a full Kailash cable sync (connect → activity download →
   time → orbit) with USBPcap. Save the pcap.~~
3. ~~Bring the pcap (+ firmware + `libmds.so`) to a fresh analysis session. First question to
   resolve: **§4 fork — Ambit3-like or modern stack?** That single answer scopes the entire rest
   of the project.~~

---

*This is a preservation-and-scoping note, not a build spec. The immediate value is in §3 (back
things up before they're lost) and §4 (one cable capture decides which kind of project this is).
The Kailash is feasible as an offline activity-export tool — the "SuuntoLink already reads it over
cable, I just need to intercept and reimplement that" framing is far more approachable than the
iOS-only reputation suggests — but it is its own effort, distinct from the Ambit3 route work.*
