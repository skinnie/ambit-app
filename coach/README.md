# @sommet/coach — backend-blind training coach

A small **canonical model** + three **pluggable adapter seams**, so *where data comes
from* and *where a plan goes* are config flags, not rewrites. Local-first: intervals.icu
enters as one adapter and leaves the same way.

```
 SYSTM lib ─┐                                    ┌─ Ambit3  (BLE/USB — the moat)
 local DB  ─┼─►  canonical model  ─►  COACH  ─►──┼─ Suunto Race S (suunto-mcp)
 intervals ─┘      (adapters)     (light + plan) └─ FIT export (any device, today)
```

## Run it (Node 22+, zero install)

```bash
node --experimental-strip-types src/demo.ts        # or: npm run demo
SOURCE=local DEVICE=fit MINUTES=90 npm run demo    # the toggle is just env here
DEVICE=suunto-race npm run demo                    # builds a SuuntoPlus guide (dry-run)
DEVICE=ambit3 npm run demo                          # collapses to an Ambit3 planned move
DEVICE=ambit3-app npm run demo                      # App Zone guided-workout spec (real watt ranges)
SOURCE=intervals npm run demo                       # sample data; ICU_KEY/ICU_ATHLETE = live
```

## Layout

| File | Role |
|---|---|
| `src/model.ts` | the canonical shapes the coach touches — nothing else |
| `src/ports.ts` | the three interfaces: `LibrarySource`, `HistorySource`, `DeviceSink` |
| `src/coach.ts` | readiness (Fitness/Fatigue/Freshness + light) + recommend + send. Imports **only** model + ports |
| `src/adapters/systmLibrary.ts` | real: maps SYSTM data → canonical (swap `loadCatalogue()` for a live wahoo-systm-mcp call) |
| `src/adapters/localHistory.ts` | default history; `readinessSignals()` returns `{}` on Ambit3 (the light copes) |
| `src/adapters/intervalsHistory.ts` | real intervals.icu REST (sample offline); adds HRV+sleep → richer light |
| `src/adapters/fitSink.ts` | writes a FIT-ready plan; real bytes come from `tools/` fit_tool pipeline |
| `src/adapters/suuntoRaceSink.ts` | real: canonical → SuuntoPlus IntervalPlan (HR-range targets + auto-advance; power/pace ride as text). Wire `transport` to suunto-mcp to send |
| `src/adapters/ambit3Sink.ts` | real: canonical → one Ambit3 planned move (activity/duration/distance/intensity). Steps dropped — a calendar entry. Wire `transport` to `tools/training_program.py` |
| `src/adapters/ambit3AppSink.ts` | real: canonical → App Zone workout JSON (`tools/workout.py` schema; **power/HR/pace enforced on-watch**). Stops at the spec — compile on the community site, never the parked compiler. Long workouts hit BINARY_TOO_LARGE |
| `src/demo.ts` | the whole wire-up in one file — the "toggle" |

## The two rules that make it hold

1. **`coach.ts` never imports an adapter.** Swap every backend; not a line changes.
2. **Readiness is driven by `load`; HRV/sleep only nudge it *more* cautious.** So it runs
   sensor-rich (Race S / intervals) or sensor-poor (Ambit3) — see `Readiness.basis`.

## All six adapters are real. What's left is live wiring (config, not code)

Each adapter runs offline on sample/dry-run data. To make one send/receive for real, supply
credentials and swap its one `transport`/loader:

- `IntervalsHistory` → set `ICU_KEY` + `ICU_ATHLETE` (real intervals.icu REST).
- `SystmLibrary` → point `loadCatalogue()` at a live (forked) `wahoo-systm-mcp`.
- `SuuntoRaceSink` → `transport` → `suunto-mcp push_workout_guide` (needs `SUUNTO_APP_NAME` + APIzone OAuth).
- `Ambit3Sink` → `transport` → POST to the app's Python backend → `tools/training_program.py --write`.

Note the device ceilings the sinks encode honestly: FIT carries full intervals; SuuntoPlus
enforces HR only (power/pace as text); the Ambit3 planned-move is a calendar entry (no steps);
the Ambit3 App Zone app enforces power/HR/pace live but only for short sessions — dense SYSTM
rides overflow one app slot (BINARY_TOO_LARGE), so those go planned-move + FIT instead.

### App Zone / compiler boundary (deliberate)

`ambit3AppSink` stops at the `tools/workout.py` JSON spec. Compilation is a separate step the
adapter never performs: the community compiler "is not ours to invoke on a user's behalf"
(compile on the community site, or via `tools/training_plan.py`'s backend path). This code does
**not** touch the parked offline App-Zone compiler.
