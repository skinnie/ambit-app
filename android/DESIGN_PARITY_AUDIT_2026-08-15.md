# Android ↔ Desktop design-parity audit — 2026-08-15

Baseline: **desktop** (`desktop/qml`). Goal: the Android app looks 100% identical to
desktop in both light and dark mode, except the Intervals feature. This audit compared the
two apps' theme tokens, shared components (buttons, toggles, cards, nav), colors, fonts and
titles. Android is React Native, desktop is Qt/QML, so "identical" means visual parity, not
shared code.

Nothing was compiled (project rule). **Rebuild the Android app (`./build-android.sh`) to
see these changes.**

---

## Fixed (applied to source)

### 1. Light-mode primary/accent color — teal, not grey  ★ the big one
`android/src/theme/v3.ts`
- **Was:** light `primary #475569`, `accent #64748B` (slate grey).
- **Now:** `primary #167E6A`, `accent #2FA98C` — desktop's exact `_lightPrimary`/`_lightAccent`.
- **Why it was wrong:** the 2026-08-09 "nicer grey" change only ever mutualized the **dark**
  palette (both apps are grey in dark mode). Light mode was left behind — desktop kept its
  teal, Android was grey. So the two apps disagreed in light mode on every accent surface
  (selected states, chips, icons, links, primary text accents). Dark mode already matched and
  is unchanged.

### 2. Map track / POI color
`android/src/services/MapTile.ts` — `TRACK_COLOR`
- **Was:** `#00897B` (a near-but-not-equal Material teal).
- **Now:** `#167E6A` — desktop's `Theme.mapAccent` (`= _lightPrimary`), the same fixed,
  theme-independent green desktop draws every track and POI marker in. A route drawn on the
  map now matches the same route on desktop.

### 3. Selected navigation item
`android/src/navigation/NavShell.tsx`
- **Was:** faint `accent+'22'` tint behind the selected item, label/icon in `primary`;
  unselected label/icon greyed (`mutedText`).
- **Now:** selected item is a **solid `primary` fill** with its icon+label in `card`, and
  unselected items use full-contrast `text` — an exact port of desktop `NavItem.qml`.

### 4. Toggles / switches  ★ (you flagged this specifically)
New `Toggle` component in `android/src/components/ui/primitives.tsx`; replaced all 3 native
`<Switch>` uses (Settings ×2, Sport Modes ×1).
- **Was:** React Native's built-in `<Switch>` — ON track a translucent `primary+'88'`, OFF
  a translucent `mutedText+'55'`, thumb always `card`; no border possible.
- **Now:** a faithful port of desktop `RoundedSwitch.qml` — 36×20 pill, 16px handle:
  ON = solid `primary` track + `card` thumb; OFF = `card` track with a 1px `mutedText`
  border + a `mutedText` thumb (so an off switch stays visible, desktop's own 2026-08-10 fix).

### 5. Action buttons — bordered, not solid teal  ★ ("buttons/outlines that are not the same")
`android/src/components/ui/primitives.tsx` — `Button`
- **Was:** default `filled` variant = solid `primary` fill with `card` text.
- **Now:** ported from desktop `RoundedButton.qml`: every plain action button (Save, Connect,
  Import, Disconnect…) is a **card-surfaced button with a 1px `mutedText` border and a `text`
  label**. Desktop only fills a button with `primary` when it's *checked* (a selected/toggle
  state) — and those selected states are handled here by dedicated controls (Toggle, the
  Appearance selector, chip rows), never by a plain action Button. `tone="alert"` recolors
  border+label to `error` for destructive actions (e.g. Delete).
- The map replay play/pause control stays a solid-primary circle (an Android-only media
  control with no desktop counterpart); only its stale comment was corrected.

### 6. Page titles (Calendar, Totals)
`CalendarScreen.tsx`, `TotalsScreen.tsx`
- **Was:** `fontSize 20 / weight 800`.
- **Now:** `18 / 700` — desktop's `fontSizeTitle`, bold.

---

## Found but NOT auto-changed (need your call / a look on-device)

- **Single-select selectors render as chips, not radios.** Map provider (OSM/CyclOSM/IGN) and
  the enum Ambit settings are `RoundedRadioButton` on desktop (a circle indicator + label in
  a vertical list). Android renders them as a row of tinted pills (`chip`/`chipActive`).
  Both use the primary color now, but the *control shape* differs. Converting the chip rows to
  radio lists touches several screens and I couldn't verify it visually without building, so I
  left it. Say the word and I'll port a `RadioRow` to match desktop.
- **Navigation shell: bottom tab bar (phone) vs left rail (desktop).** This is a deliberate
  adaptive choice (tabs are thumb-reachable; a 220px labelled rail doesn't fit a phone). The
  tablet layout is a left rail, closer to desktop. Colors/selected-state now match (item 3);
  the layout paradigm is the one thing that can't be pixel-identical on a phone.

---

## Confirmed already matching (no change needed)
- Icon font: both use `MaterialSymbolsRounded.ttf`, same glyph codepoints.
- Spacing / radius / type scale: copied verbatim from `Theme.qml`.
- Dark palette: fully mutualized (identical hex on both sides).
- Activity/sport colors: identical Suunto palette data.
- Appearance (light/dark/system) selector: already a solid-primary-fill selected state,
  matching desktop's checked control.
- Card surface (rounded, shadow, `card` fill) and section titles.
