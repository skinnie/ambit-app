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
```

## Layout

| File | Role |
|---|---|
| `src/model.ts` | the canonical shapes the coach touches — nothing else |
| `src/ports.ts` | the three interfaces: `LibrarySource`, `HistorySource`, `DeviceSink` |
| `src/coach.ts` | readiness (Fitness/Fatigue/Freshness + light) + recommend + send. Imports **only** model + ports |
| `src/adapters/systmLibrary.ts` | real: maps SYSTM data → canonical (swap `loadCatalogue()` for a live wahoo-systm-mcp call) |
| `src/adapters/localHistory.ts` | default history; `readinessSignals()` returns `{}` on Ambit3 (the light copes) |
| `src/adapters/fitSink.ts` | writes a FIT-ready plan; real bytes come from `tools/` fit_tool pipeline |
| `src/adapters/suuntoRaceSink.ts` | real: canonical → SuuntoPlus IntervalPlan (HR-range targets + auto-advance; power/pace ride as text). Wire `transport` to suunto-mcp to send |
| `src/demo.ts` | the whole wire-up in one file — the "toggle" |

## The two rules that make it hold

1. **`coach.ts` never imports an adapter.** Swap every backend; not a line changes.
2. **Readiness is driven by `load`; HRV/sleep only nudge it *more* cautious.** So it runs
   sensor-rich (Race S / intervals) or sensor-poor (Ambit3) — see `Readiness.basis`.

## Not built yet (deliberately — ship the real ones first)

- `IntervalsHistory` — same `HistorySource` interface, three method bodies (GET /activities, /wellness).
- `Ambit3Sink` — your BLE/USB Training-Program writer. The finish line, not the blocker.
