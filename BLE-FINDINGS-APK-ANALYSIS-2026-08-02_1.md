# Ambit3 BLE — Findings from Suunto App APK Analysis (jadx)

**Source:** jadx-decompiled output of two APKs — `com.stt.android.suunto` v4.73.6
(`4073006`, minAPI24) and v6.7.12 (`6007012`, minAPI26) — both `arm64-v8a` +
`armeabi-v7a`, sourced via apkmirror.com. Both versions analyzed in parallel; findings
below hold for both unless noted.

**Purpose:** these findings update `AMBIT3-SUUNTO-HANDOFF.md` — specifically §8 (BLE
transport), §9 (native library map), and §17 (known unknowns). Merge into that doc; this
is written to stand alone in the meantime.

**Status of the two open BLE unknowns from the handoff doc:**
- BLE session-login token derivation (§8.3) — **not yet solved, but now has a concrete,
  much more tractable target** (see §3 below). Previously this required an HCI sniff;
  we now have an exported native function to reverse directly.
- Nothing here changes the coordinate-scale/route-point-encoding unknown (§5.3–5.4) —
  that's still a separate task, though the same native library (§3) is worth checking for
  `Communist::Serialization::StructMap` at rest, per Appendix A of the handoff doc.

---

## 1. GATT UUIDs — confirmed live and unchanged

`com/suunto/obi2/internal/BLEBase.java` (present, identical in both APK versions):

```java
public static final String NSP_SERVICE_UUID = "98ae7120-e62e-11e3-badd-0002a5d5c51b";
public static final String NSP_TO_CLIENT_CHARACTERISTIC_UUID = "d0fd6b80-e62e-11e3-a2e9-0002a5d5c51b";
public static final String NSP_TO_SERVER_CHARACTERISTIC_UUID = "c6339440-e62e-11e3-a5b3-0002a5d5c51b";
protected static final UUID CHARACTERISTIC_UPDATE_NOTIFICATION_DESCRIPTOR_UUID =
    UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
```

Exact match to handoff §8.1. This is a **live, current-app confirmation**, not just
historical residue — the UUIDs are still active in the shipping app as of both sampled
versions.

## 2. Correction to handoff §8 — GATT role is reversed from what was assumed

The handoff doc's BLE section implicitly assumed the standard "watch = peripheral/GATT
server, phone = central/GATT client" model (phone scans, connects, discovers services).
**The APK shows the opposite for this device family:**

- `AmbitDevice.java`'s `connect()` calls `createGattServer(this.device)`, which
  instantiates `BLEService` and logs *"Create gatt server and wait until client makes
  connection..."*.
- `BLEService.java` calls `bluetoothManager.openGattServer(...)` — the **phone opens and
  advertises its own GATT server**, then waits.
- The `BluetoothGattServerCallback.onConnectionStateChange` handler in `BLEService.java`
  fires when a remote device connects **to** the phone's server — i.e. **the watch
  connects to the phone as a central**, not the reverse.
- `AmbitDevice.dataWrite()` sends outbound data by calling
  `bleService.dataWrite(BLEBase.NSP_TO_CLIENT_CHARACTERISTIC_UUID, bArr)` — the phone, as
  GATT *server*, updates its own `TO_CLIENT` characteristic and relies on
  `notifyCharacteristicChanged()` to push it to the connected watch. ("TO_CLIENT" here
  means "toward whichever device is the GATT client of this server" — i.e. the watch.)

**Practical impact — Deliverable A (iOS) needs revising:** iOS's `CBCentralManager` /
"scan and connect" approach won't work for this transport. You need
**`CBPeripheralManager`**: publish the `98ae7120-...` service with the two characteristics,
start advertising, and wait for the watch to initiate the connection. This is a materially
different iOS implementation path than a typical BLE-wearable integration and should be
scoped accordingly before starting Deliverable A build-out. (Sanity-check this against
a live BLE `hcidump`/`btsnoop` capture of the real Suunto app talking to a real Ambit3 if
possible — this finding is from static Java analysis, not yet a packet capture.)

## 3. The real protocol logic lives in a native lib — and it's a better RE target than the old one

The Java/Kotlin layer (`BLEBase`, `BLEService`, `AmbitDevice`, `SharedGattServer`, etc.) is
a thin GATT-queue/plumbing wrapper. The actual NSP protocol, login, and
route/POI/settings serialization logic is in a bundled native library:

```
lib/arm64-v8a/libmds.so     (v6: ~14.6 MB, v4: ~10.4 MB)
lib/armeabi-v7a/libmds.so   (both versions also present — 32-bit, usable with your
                              existing QEMU/x230 setup per handoff Appendix A)
```

`libmds.so` is a **direct descendant of `libkomposti-ng.so`** from the old Movescount
APK — confirmed by matching C++ namespaces surviving in the symbol table:

- `Communist::Serialization::StructMap`, `Communist::Serialization::jsonToType<T>` /
  `jsonFromType<T>` (the same property-tree ↔ struct serialization framework)
- `EmuDevice`, `EndDevice`, `NspEndDevice` (device class hierarchy — `EmuDevice` = Ambit3,
  same as before)
- `Task::NSP::*` (WriteMemory, ReadMemory, SystemReset, and several new ones not in the
  old lib: `NspTaskReadPmemRaw`, `NspTaskWritePmemRaw`, `NspTaskEraseWaypoints`,
  `NspTaskReadDevSerialNumber`, `NspTaskWritePmemRawFinalizeWithChecksum` — worth a look
  for anyone doing the PMEM/logbook side of the project)
- Log/const strings: `NSP_MSG_ID_LOGIN`, `NSP_MSG_SUBID_LOGIN`,
  `DEVICE_RESULT_ERROR_INVALID_LOGIN`, `"Login failed"` — same result-code vocabulary as
  the old lib.

**This is meaningfully better-preserved than `libkomposti-ng.so` was.** The old lib
required full Ghidra static decompilation with no exported symbol help. `libmds.so`,
despite being marked "stripped" by `file`, still carries a large **dynamic symbol table**
(`nm -D`) — over 5,600 defined text/weak symbols — because C++ RTTI and exception handling
keep typeinfo and many mangled names around even in a stripped build. Demangling with
`c++filt` recovers full class/method signatures directly, no decompilation needed just to
get the map of what's there.

## 4. Direct hit: the login function is exported and locatable

```
nm -D --defined-only libmds.so | c++filt | grep -i login
→ 0000000000a2a114 W EndDevice::login(unsigned char*)
```

`EndDevice::login(unsigned char*)` is a **real, exported, weakly-linked symbol at a fixed
address** in the arm64-v8a build. This is the direct equivalent of the function the
handoff doc (§2, §8.3) flagged as needing an HCI sniff to recover, because in the old lib
it wasn't cleanly exported/locatable this way.

**Recommended next step for the dev:**
1. Load `lib/arm64-v8a/libmds.so` into Ghidra, jump to `0xa2a114`, and decompile
   `EndDevice::login(unsigned char*)`. Trace what it does with the input buffer — this
   should reveal whether the login token is a straight transform of the device serial
   (hash/HMAC/static-key cipher/etc.), matching the "local, no server" conclusion already
   established in the handoff doc (§2).
2. Cross-reference against `NspEndDevice` (the concrete subclass — check for an override
   or a caller that actually assembles the 16-byte token before calling `login`).
3. If static analysis stalls, the `armeabi-v7a` build of the same lib is available and
   compatible with the QEMU dynamic-analysis approach already set up per the handoff doc's
   Appendix A — call `EndDevice::login` directly with a known/synthetic serial and read the
   output bytes, or dump `Communist::Serialization::StructMap` from relocated memory the
   same way as planned for the route-point encoding task.
4. Worth a diff of `EndDevice::login` and any `NspEndDevice`-specific login logic between
   the v4.73.6 and v6.7.12 builds — if unchanged, that's further confirmation the token
   scheme hasn't rotated recently.

## 5. Housekeeping

- Both APKs were sourced from apkmirror.com, not the Play Store directly — fine for RE
  purposes, just noting provenance.
- No credentials or account tokens were found in this analysis (unlike the SuuntoLink
  desktop dump previously flagged) — nothing sensitive to redact here.
- Didn't yet check: `SharedGattServer.java`, `BondStatusHandler.java`,
  `SimplePairingMonitor.java`, or `EonDevice.java` (a second device class alongside
  `AmbitDevice` and `EmuDevice` — worth checking what device family "Eon" maps to, may be
  a newer Suunto watch line unrelated to Ambit3, or may share transport code worth
  reusing).
