# ambit-app

Interoperability reverse engineering, to send GPX routes to a **Suunto Ambit3** without
Movescount, which is dead, without an account and without a server.

The binary format of the watch's navigation database is decoded and verified byte for byte
against USB captures of SuuntoLink. The serializer exists in Python and in C, the latter
written to drop into openambit's `libambit` unmodified.

- [`RUNBOOK.md`](RUNBOOK.md) — step-by-step instructions for whoever has the watch.
- [`HANDOFF.md`](HANDOFF.md) — project state, prerequisites and remaining work. **Start here.**
- [`tools/README.md`](tools/README.md) — format specification and tooling usage.

```
make -C csrc && python3 tools/selftest.py
```

The analysis artifacts (captures, SuuntoLink binaries, decompiled APK) are not versioned:
proprietary software and personal data. See `HANDOFF.md`.

Interoperability with owned hardware, to put one's own data back on it after a service was
shut down. No protection is circumvented.
