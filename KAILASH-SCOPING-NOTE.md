# Suunto Kailash (Hoopoe) — Reverse-Engineering Scoping Note

**Status:** exploratory / future project. **Keep separate from the Ambit3 route handoff** — the
Kailash is a *different generation*, uses a *different app*, and its protocol lives in *different
artifacts*. Do not build it on the Ambit3 foundation.

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

---

## 5. Unknowns to resolve (in rough order)

1. **Cable transport family** — Ambit3-like NSP vs modern stack (§4 fork). *Resolved by one
   SuuntoLink cable capture.*
2. **Device identification** — the Kailash's USB VID/PID and identify handshake (so a tool can
   recognize it). *From the same capture.*
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
| SuuntoLink ↔ Kailash **cable capture** | TODO | **the decisive artifact** — protocol family, identify, activity read |
| 7R ↔ Kailash BLE capture (macOS PacketLogger) | optional | behavioral ground truth if going the app route |
| V2 handoff (`SUUNTO-V2-HANDOFF.md`) | yes | methodology for the modern-stack case |

---

## 7. Relationship to the Ambit3 work

**Separate project. Do not merge.** Shared *only* at the level of general methodology (capture
the official tool, treat the watch as ground truth, dry-run all writes, no cloud oracle). Do NOT
assume the Ambit3 flash addresses, NSP details, route format, or `libkomposti` findings apply —
the Kailash is a different generation and must be profiled from its own captures. The one thing
that could bridge them is §4's fork: *if* the cable capture shows Ambit3-like NSP, then (and only
then) the Ambit3 transport layer becomes a reusable head start.

---

## 8. Recommended first session (when picked up)

1. Preserve the firmware + make the encrypted iPhone backup (§3.1–3.2) — 30 minutes, prevents
   permanent loss.
2. Install SuuntoLink on the PC; capture a full Kailash cable sync (connect → activity download →
   time → orbit) with USBPcap. Save the pcap.
3. Bring the pcap (+ firmware + `libmds.so`) to a fresh analysis session. First question to
   resolve: **§4 fork — Ambit3-like or modern stack?** That single answer scopes the entire rest
   of the project.

---

*This is a preservation-and-scoping note, not a build spec. The immediate value is in §3 (back
things up before they're lost) and §4 (one cable capture decides which kind of project this is).
The Kailash is feasible as an offline activity-export tool — the "SuuntoLink already reads it over
cable, I just need to intercept and reimplement that" framing is far more approachable than the
iOS-only reputation suggests — but it is its own effort, distinct from the Ambit3 route work.*
