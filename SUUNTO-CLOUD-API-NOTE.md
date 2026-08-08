# Suunto Cloud API (apizone.suunto.com) — a possible second, optional path for routes

Researched 2026-08-04, in response to a real problem found the same day: a route written to
the Ambit3 by this project's own offline tooling is never adopted into the Suunto account
before being overwritten — confirmed on hardware, see `HANDOFF_ANDRE.md` "Closed, 2026-08-04:
no adoption, only clobber." Any subsequent SuuntoLink sync or Suunto-app BLE sync (even a
passive background one, with no explicit "sync" action) wholesale-rewrites the watch's Routes
region back to whatever the account's own list says, which never includes anything written
offline. So a route from this project does not survive the watch's next meeting with the
official ecosystem, and there is no way to make it, working only at the protocol/flash level.

This note is about a different approach to that specific problem: instead of writing to the
watch directly, write into the user's own Suunto account through Suunto's public API, and let
the *official* sync mechanism carry the route down to the watch as designed. If a route is
already known to the account, SuuntoLink/the Suunto app would reassert it rather than erase it
— the clobber problem stops applying, by construction, because the route would no longer be
unrecognized outsider content.

**This is optional and separate from the core project**, not a replacement for it. It requires
a live Suunto account and network access — exactly the dependency this project exists to
remove for the offline path (routes/POIs/reset/undelete over USB or BLE, no account, no
server). The offline path stays fully valid on its own, including for anyone with no Suunto
account at all. This would only ever be a second, optional feature for users who already have
an account and want a route to actually persist through normal use of the official apps.

## What's confirmed

`apizone.suunto.com` is a real, live developer portal (Microsoft Azure API Management) for a
**Suunto Cloud API**, OAuth2-based. It has an actual **Route API**:

- `GET /v2/route` — lists the user's routes (JSON: id, description, visibility, activityIds,
  coordinates, distance, etc.)
- `GET /v2/route/{id}/export` — exports a specific route as GPX (`Accept:
  application/gpx+xml`)
- The route points can be given in GPX `trk` or `rte` elements; multiple `trk`/`rte` elements
  in one GPX file import as separate routes.
- Activity type is set via a query-string `activities` parameter, a comma-separated list of
  Suunto activity IDs (defaults to activity ID 1 if not given).
- The docs state outright: **"Suunto Route API enables importing routes in GPX format... and
  exporting routes user created in Suunto App to partner services."** Routes handled this way
  show up in the Suunto App and **"can be then synced to Suunto watches for navigation."**
- Auth for calls: `Authorization` bearer JWT + `Ocp-Apim-Subscription-Key` header. Example from
  the docs (workouts, not routes, but same auth pattern):
  ```
  curl -v https://cloudapi.suunto.com/v2/workouts \
    -H "Authorization: <JWT_TOKEN>" \
    -H "Ocp-Apim-Subscription-Key: <SUBSCRIPTION_KEY>"
  ```
- Webhooks exist for being notified when a user creates/modifies a route in the app, rather
  than polling — the docs explicitly say polling `GET /v2/route` is prohibited.

## What's NOT confirmed — the actual gap

**The exact POST/import endpoint** — path, request body shape (raw GPX body? multipart?
something else?), and the write-scope OAuth permission needed. The docs prose clearly says
import exists and describes what it accepts (GPX `trk`/`rte`, the `activities` parameter), but
the concrete request signature lives in the portal's interactive API reference, which renders
client-side (JS) and wasn't retrievable through a plain fetch. Two ways to close this gap:

1. Register a developer account on the portal and open the live "try it" console for the
   Route API — the concrete request should be right there once logged in.
2. Capture Komoot's own traffic when it pushes a route into your linked Suunto account (you
   already have this integration on your own account) — it almost certainly hits this same
   import endpoint, and a real request is worth more than documentation prose anyway, same
   methodology this whole project has used throughout.

## Access restrictions — the real strings attached

From `apizone.suunto.com/faq`, verbatim: **"We can provide access to companies/organizations
that are building tools/apps/services for commercial & non-commercial usage. However we do
not provide this for personal use."**

- Non-commercial is fine; *individual/personal* is explicitly not. Access is gated to
  organizational registration, not a solo hobbyist account, at least for anything called
  "Production."
- There's a **Development API** tier meant for building/testing (with a personal Suunto test
  account) before a **Production API** subscription step, described as "we will then connect
  you for next steps" — presumably the formal partner agreement.
- Genuinely unresolved, and a ToS question rather than a technical one: whether "no personal
  use" blocks *using your own developer credentials against your own account* during
  development, or only blocks *shipping a public app* without registering as an org. Worth
  reading the actual partner agreement rather than assuming either way.

## Recommendation

Treat this as a real, worthwhile research spike, kept explicitly separate from the milestone 7
BLE work: register for Development-tier access and/or capture Komoot's real traffic to nail
down the import request, and read the partner agreement before deciding whether ongoing use is
viable without formal organizational registration. Not a blocker for anything else in this
project either way.

## Sources

- https://apizone.suunto.com/ (Home)
- https://apizone.suunto.com/route-description (Routes)
- https://apizone.suunto.com/how-to-start (How to start / Suunto Cloud API)
- https://apizone.suunto.com/faq (FAQ)
- https://apizone.suunto.com/apis (APIs)
