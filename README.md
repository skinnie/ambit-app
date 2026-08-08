# ambit-app

Interoperability reverse engineering, to send GPX routes to a **Suunto Ambit3** without
Movescount, which is dead, without an account and without a server.

The binary format of the watch's navigation database is decoded and verified byte for byte
against USB captures of SuuntoLink. The serializer exists in Python and in C, the latter
written to drop into openambit's `libambit` unmodified.

**It works on hardware.** On 2026-08-04 a route built from a GPX file alone was written to a real
Ambit3 over USB, and the watch shows it with its waypoints. What remains is packaging: Android
USB-OTG, then Bluetooth, then iOS.

- [`RUNBOOK.md`](RUNBOOK.md) — step-by-step instructions for whoever has the watch.
- [`HANDOFF.md`](HANDOFF.md) — project state, prerequisites and remaining work. **Start here** -
  it also has a pointer near the top for whoever is building the app specifically.
- [`tools/README.md`](tools/README.md) — format specification and tooling usage.
- [`history.md`](history.md) — watch-family background (codenames, hardware), the
  Movescount/Suunto-app timeline, and adjacent open-source/reference material
  (openambit, opensportsync, marguslt's writeups, AmbitConnect/AmbitSync).

A few other top-level `.md` files are earlier drafts or preliminary research, superseded by
`HANDOFF.md` - each says so at its own top if you open it directly. Beyond the original
GPX/route goal, this repo also has verified-on-hardware work on recorded-move export and AGPS
data, plus a paused investigation into recreating Movescount's training-plan feature - see
`HANDOFF.md`'s "Work done beyond these 8 milestones" section for all of it; none of it is
required for the core GPX-over-cable-and-Bluetooth deliverable.

```
make -C csrc && python3 tools/selftest.py
```

The analysis artifacts (captures, SuuntoLink binaries, decompiled APK) are not versioned:
proprietary software and personal data. See `HANDOFF.md`.

Interoperability with owned hardware, to put one's own data back on it after a service was
shut down. No protection is circumvented.

## License and credits

[GPLv3](LICENSE) - the same license as [openambit](https://github.com/openambitproject/openambit),
whose real, working `libambit` this project checks its own reverse-engineering against
throughout.

See [`CREDITS.md`](CREDITS.md) for the people and projects this work builds on: openambit,
opensportsync, marguslt, sebchastang, the Suunto forum community, and wanarun.net.
