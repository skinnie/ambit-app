# intervals.icu gear schema (confirmed from live `GET /gear`, 2026-08-17)

Endpoint: `GET /api/v1/athlete/{id}/gear` → **flat array** of gear AND components mixed together.
Auth: HTTP Basic `API_KEY:<key>`.

## Gear object
| field | type | notes |
|---|---|---|
| `id` | string | numeric string, e.g. `"50906"` (NOT the `b…`/`g…` ids from the athlete summary) |
| `name` | string | |
| `type` | string | free-form: `Bike`, `Shoes`, `Tyre`, `Chain`, `Cassette`, `Wheelset`, `BottomBracket`, `Chainrings`, … Top-level gear is `Bike`/`Shoes`; components carry a part type. |
| `component` | bool | `true` ⇒ this row is a component/part |
| `component_ids` | string[] \| null | child component ids — **the parent→child link lives here**, there is no `parentId` on the child |
| `distance` | float | **meters** (Carrera Scatto = 50 165 610 = 50 165 km) |
| `time` | float | seconds |
| `retired` | bool \| null | nullable; treat null as false |
| `purchased` | date string \| null | |
| `notes` | string \| null | |
| `use_elapsed_time` | bool | |
| `activities` | int | count of activities on this gear |
| `activity_filters` | — | |
| `reminders` | Reminder[] | inline |
| `athlete_id` | string | |

**Not present in `/gear`:** `primary`. The primary bike/shoe is athlete-summary only, so it is
**not** mirrored (our per-sport default assignment covers that need instead).

## Reminder object (self-scoring — the server computes due-ness)
| field | type | notes |
|---|---|---|
| `id` | int | |
| `gear_id` | string | |
| `name` | string | e.g. `"check chain"` |
| `distance` | float | interval in **meters** (500000 = every 500 km) — 0 if not distance-based |
| `time` | float | interval in **seconds** — 0 if unused |
| `days` | int | interval in **days** — 0 if unused |
| `activities` | int | interval in **activity count** — 0 if unused |
| `last_reset` | datetime | baseline reset time |
| `starting_distance`/`starting_time`/`starting_activities` | float | baseline at last reset |
| `snoozed_until` | datetime \| null | |
| **`percent_used`** | float | **0–100+; ≥100 ⇒ due.** Use this directly instead of local math. |
| `distance_used`/`time_used`/`activities_used`/`days_used` | number | progress since reset |

A reminder can combine multiple intervals; `percent_used` reflects whichever is furthest along.

## Write implications
- Create a component: `POST /gear` with `{name, type, component:true}`, then attach it to its
  parent by `PUT /gear/{parentId}` with the parent's updated `component_ids`.
- Create/update reminder body: `{name, distance, time, days, activities}` (0 for unused units).
- Due state comes from the pulled `percent_used`; no local approximation needed.
