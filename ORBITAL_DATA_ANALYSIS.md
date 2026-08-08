# Orbital Data Sync Analysis — firmware vs orbitsync vs orbitsync2

> **Historical** - early AGPS capture analysis; the format is now fully solved and documented in `sgee_andre.md` and `tools/README.md`. Kept for the derivation history only.

## Key Finding: orbitsync2 is a verification-only check, not a full sync

| Capture | Orbit Data Size | Route Data | Packets | Duration (est.) | Type |
|---|---|---|---|---|---|
| **firmware** | 41,350 bytes (68×1032B blocks) | Not written | 48,364 | ~1 min | FW update + AGPS init |
| **orbitsync** | 41,350 bytes (68×1032B blocks) | Not written | 2,188 | ~10s | Full AGPS sync |
| **orbitsync2** | **0 bytes** | Not written | 384 | ~2s | **Verification only** |

---

## What This Means (§16.4 AGPS Future Feature)

### orbitsync (full sync)
- Downloads 41,350 bytes of **SGEE data** (Suunto Glonass Ephemeris)
- Written to flash region **0x000704e0–0x000824e0** (70KB)
- Chunked as 68 × 1,032-byte blocks (standard write size)
- Used to fix GPS/GLONASS accuracy on the watch

### orbitsync2 (verification check)
- **Sends query to device:** "What's your current SGEE version/timestamp?"
- **Receives response:** Watch returns SGEE age/validity
- **Decision logic:** If orbit data is newer than X days/weeks, skip sync
- **Otherwise:** Do full orbitsync
- **Saves bandwidth:** 2s check vs 10s full sync on every connection

---

## Implementation for §16.4

**The verification flow likely:**
1. Send command: `query_sgee_version()` or `get_sgee_timestamp()`
2. Receive: timestamp or version number from device
3. Calculate age: `now() - sgee_timestamp`
4. If age > threshold (e.g., 7 days):
   - Fetch fresh SGEE data from server/AGPS provider
   - Write 41,350 bytes to 0x000704e0 via 68 × write_memory calls
5. Else:
   - Skip sync (save bandwidth & time)

---

## SGEE Data Characteristics

- **Size:** 41,350 bytes (constant across both syncs)
- **Region:** 0x000704e0 to 0x000824e0 (68 blocks × 1,032 bytes = 70KB)
- **Format:** Binary ephemeris data (satellites, orbits, clocks)
- **Updateable:** Yes (every sync replaces entire block)
- **Timestamp:** Stored somewhere in device (read via query command)

---

## For Your Implementation (Deliverable §16.4)

**Step 1 — Understand the query command**
- Use orbitsync2 capture to reverse-engineer the query
- Likely command in the 0x0b16 or message-based protocol
- Response contains timestamp/version/age

**Step 2 — Implement conditional sync**
```
IF device_sgee_age > 7_days THEN
  DO full_orbitsync (41KB write)
ELSE
  SKIP (save ~10 seconds and data)
END
```

**Step 3 — Data source**
- Current source: SuuntoLink's bundled SGEE data
- Better source: Live AGPS service (if discoverable)
- For offline mode: Fallback to cached 41KB SGEE blob

---

## Why orbitsync2 Is Important

**Real-world scenario:**
- User syncs watch every 2 days
- AGPS data is valid for 2 weeks
- Without verification: 7 × 10-second syncs = 70 seconds wasted bandwidth
- With verification: 7 × 2-second checks = 14 seconds (90% savings)

This is the optimization SuuntoLink uses, and it's worth replicating in openambit.

---

## Next Steps for You

1. **Extract orbitsync2's query command:**
   - Search for a short command in the first 500 packets
   - Likely non-0x0b16 (not a write)
   - Response will be SGEE timestamp or version

2. **Test the threshold logic:**
   - Run orbitsync2 immediately after full orbitsync
   - Confirm 0 bytes written (verification skipped)
   - Run again 7+ days later, should trigger full sync

3. **Implement in openambit:**
   - Add `query_sgee_timestamp()` function
   - Wrap full sync in age check
   - Preserve captured SGEE blob for offline

---

## Files Referenced

- firmware pcap (7.0M): Full update with AGPS initialization
- orbitsync pcap (323K): Full 41KB AGPS data sync
- orbitsync2 pcap (59K): Verification check only — **this is the key**
