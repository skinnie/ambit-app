# Credits

This project stands on real prior work by other people. None of the protocol
reverse-engineering here would have been possible, or would have taken far longer, without it.

- **[openambit](https://github.com/openambitproject/openambit)** and its contributors,
  especially **Emil Ljungdahl** (`libambit`'s original author) - the real, working reference
  implementation this project checks its own findings against throughout. `libambit`'s design
  (the `device_driver_*`/`pmem20` split, the BXml sport-mode format, the whole USB transport
  layer) is the foundation this project's own C code is written to sit alongside, not inside
  of - see `csrc/`'s own notes on why openambit's GPLv3 code was kept out of this repo.

- **[opensportsync](https://github.com/guiguoz/opensportsync)** and its author - the React
  Native base this project's own Android app (`android/` in this repo - imported via a real
  `git subtree` merge of the upstream history, 2026-08-08, after living as an unversioned
  sibling folder for most of this project's life) was forked from.

- **[marguslt](https://github.com/marguslt)** - several independent, real contributions cited
  throughout this project: the firmware-download-link recipe
  (`gist.github.com/marguslt/8cffaa78152503b29b91920de845e536`), the workout/App-Zone gists,
  and [`openmoves`](https://github.com/marguslt/openmoves).

- **[sebchastang](https://forum.suunto.com/user/sebchastang)** - author of a complete,
  published set of real interval-training Suunto Apps (`IntervalCounter`, `IntervalRun`,
  `IntervalSpeed`, `IntervalSerie`, `IntervalAIO`, and more), maintained through Movescount's
  actual 2022 shutdown. Genuine, sophisticated App Zone code that this project's own
  structured-workout tooling learned from.

- **Pavel Samokha** and the Suunto forum community, especially
  [`forum.suunto.com/topic/7592`](https://forum.suunto.com/topic/7592) - the documented,
  confirmed-real mechanism for adding a compiled Suunto App to SuuntoLink's own catalog
  (`suunto-apps/index.json`), which this project's own installer tooling uses directly rather
  than reinventing a flash-write path.

- **[wanarun.net](https://wanarun.net)** and its developers - independent confirmation of the
  structured-workout JSON schema this project's own workout generator (`tools/workout.py`)
  targets, alongside `openambitproject/openambit#257` and Suunto's own French tutorial.

If anyone belongs on this list and isn't here, that's an omission to fix, not a judgment -
say so and it'll be corrected.

## Activity icons

The sport-mode badges are keyed on each mode's own `activityId`, using the activity table in
`assets/activity_types.json` (84 activity ids with their names and Suunto's own category
colours, read out of SuuntoLink's `activity.js` - factual mapping, not artwork).

**77 of the 84 symbols are our own drawings**, made for this app in a 24x24 box and
deliberately not traced from anyone's font.

**7 are taken from Suunto's own icon font** (`suunto_icon.woff`, shipped inside SuuntoLink) -
Boxing, Frisbee, Horseback riding, Indoor rowing, Racquet ball, Scuba diving and Squash.
Those seven are equipment shapes we could not draw legibly at 22px after three attempts, and
André chose to use Suunto's rather than ship icons that did not read. They remain Suunto Oy's
artwork; this project claims no rights over them and is not affiliated with or endorsed by
Suunto Oy. If that ever becomes a problem, they can be swapped for the generic "Unspecified
sport" star with no code change - just edit those seven entries in
`assets/activity_types.json` and re-run `tools/gen_activity_qml.py`.
