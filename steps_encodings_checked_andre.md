# Step-value search: encodings tried, and where

Reference value used throughout: **333 steps**, read directly off the watch's own display on
2026-08-05, used as known-plaintext to search raw flash dumps rather than continue guessing
NSP query IDs. Companion to `steps_welness_data_andre.md`, which has the full protocol-side
investigation - this file only tracks the byte-level search itself.

## Encodings searched for the literal value 333

| Encoding | Bytes (for 333) | Checked? | Notes |
|---|---|---|---|
| uint16, little-endian | `4d 01` | Yes | |
| uint16, big-endian | `01 4d` | Yes | |
| uint32, little-endian | `4d 01 00 00` | Yes | |
| uint32, big-endian | `00 00 01 4d` | Yes | |
| ASCII decimal text | `33 33 33` | Yes | |
| int16 (signed), either endianness | same bytes as uint16 | Redundant, not run separately | 333 < 32768, so a signed 16-bit int has an identical bit pattern to unsigned - nothing to gain from checking separately |
| int32 (signed), either endianness | same bytes as uint32 | Redundant, not run separately | Same reasoning as int16 |
| uint8 (single byte) | - | Not applicable | 333 > 255, cannot fit in one byte at all |
| BCD (binary-coded decimal) | `03 33` (nibble-packed) | **Not checked** | Worth a quick pass; some embedded firmware uses BCD for display-adjacent counters |
| Scaled/MOD-transformed | unknown - depends on the transform | **Not checked, and not really checkable yet** | Energy fields on this watch use a `<MOD>4184*x` scale factor (confirmed working, see `steps_welness_data_andre.md`); the `Steps+Value` schema entry itself lists no `<MOD>` formula, suggesting raw=engineering with no scaling - but unconfirmed since the field has never been read |
| Hourly-disaggregated sub-values | no single literal match possible if true | Attempted (heuristic frequency scan), **inconclusive** | The Android app's local cache stored steps at *hourly* resolution, not just a daily total - if the watch itself stores it the same way, no single "333" would ever appear, only smaller values that sum to it. Scanning for "plausible small u16 values" without a real reference number mostly surfaces structural noise (repeated small values like `4`, `2`, `1025` - almost certainly record markers or unrelated fields). Needs a real hourly figure from the watch's own display to be meaningful, not yet available |

## Regions searched (all encodings above, against each)

| Region | Size | Non-`0xFF` bytes | Result |
|---|---|---|---|
| `BlePairingInfo` | 450 B | 449 | No match, any encoding |
| `TrainingProgram` | 3,072 B | 0 (fully erased) | No match, any encoding |
| `CustomModes` | 12,288 B | 7,522 | No match, any encoding |
| `EventLog` | 400,000 B | 27,887 | No match, any encoding |
| `ExerciseLog` | 5,526,464 B | 631,068 | 6 raw `u16LE` hits + a run of `0x33` bytes - both judged false positives, see below |
| `Waypoints`, `Routes`, `GpsSGEE`, `Apps` | - | - | Not searched - already fully understood (Waypoints/Routes/GpsSGEE) or confirmed empty (Apps, checksum all-`F`) by this project; steps data has no plausible reason to live there |

## `ExerciseLog` result, in detail - matches found, judged coincidental

Six `u16LE` (`4d 01`) hits at offsets 282535, 283129, 289959, 313913, 335065, 348161. Reading
the surrounding bytes at each: they sit inside runs that look like **compiled ARM Thumb machine
code**, not structured data - e.g. offset 282535 has `70 bd 70 b5` immediately after it
(`POP {PC}` followed by `PUSH {.., LR}`, the standard Thumb function epilogue/prologue pair),
and several others show the same `68`/`60`/`49`/`4e`/`4d`/`4c` opcode family (`LDR`/`STR`
literal and immediate forms) clustered together. That's a strong, specific signature of real
code, not sensor data - the `4d 01` match is best explained as incidental bytes inside an
instruction, not a real step value.

The ASCII `"333333"` hit (14 overlapping match positions, offsets 264085-264101) is likewise
not real text: 14 overlapping 3-byte matches at consecutive offsets means a run of roughly
16 identical `0x33` bytes back to back - a padding/fill pattern, not a decimal "333" written
as characters.

**Overall: no plausible, structurally-supported match for 333 in any encoding, in any of the
five regions checked.** Not a decoding-guess failure so much as evidence the current value
either lives somewhere not yet located (a region this pass didn't check, or a sub-offset within
`ExerciseLog`'s move-record structure this project hasn't parsed), or is transformed/
disaggregated in a way a raw literal search can't catch (see the hourly-disaggregation note
above). Reinforces rather than replaces the earlier conclusion in `steps_welness_data_andre.md`:
`libmds.so` or a live capture of the current Suunto ecosystem remain the more promising paths.

## What a positive match would mean, and what it wouldn't

A raw byte match doesn't by itself prove *this* is the steps counter - flash is dense with
other u16/u32 values for unrelated fields, and as `ExerciseLog` demonstrated, dense with
compiled code too. The signal is in whether a match sits at a **plausible, structured offset**
(e.g. near other recognizable per-day/per-hour fields, clearly in a data region rather than a
code region) - none of tonight's matches passed that bar.
