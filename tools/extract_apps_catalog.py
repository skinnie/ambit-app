#!/usr/bin/env python3
"""Extracts a real, distributable copy of SuuntoLink's own Suunto Apps catalog
(`suunto-apps/index.json`, found bundled inside a real SuuntoLink installation under
`assets/` - a research-only, gitignored folder, never shipped with this app) into a
tracked, compact pair of files this project actually ships: `data/suunto_apps/catalog.json`
(metadata only) + `data/suunto_apps/catalog.bin` (every app's real compiled bytecode,
concatenated).

Real request 2026-08-09 ("2 bigger. Let's ship the full catalog") - a full app picker
needs the real 13,104-entry catalog (name/category/description/compatibility) plus the
actual installable binaries, but the source file encodes every binary as a JSON array of
decimal integers (`[73, 65, 77, ...]`), which is enormously wasteful as text - confirmed
real: 29MB on disk for 9,457,390 real binary bytes, a >3x blow-up. Splitting the binaries
into one raw, unencoded blob file and keeping the metadata JSON small keeps the real
information (nothing dropped) at roughly 1/3 the size and lets the metadata be parsed/
searched without skipping huge inline arrays.

    ./tools/extract_apps_catalog.py --from ".../suunto-apps/index.json"
"""

import argparse
import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
CATALOG_DIR = HERE.parent / "data" / "suunto_apps"


def extract(source_path, out_dir):
    with open(source_path) as f:
        raw = json.load(f)

    meta = []
    blob = bytearray()
    for e in raw:
        binary = bytes(e["binary"])
        offset = len(blob)
        blob.extend(binary)
        meta.append({
            "ruleId": e["ruleId"],
            "name": e["name"],
            "categoryId": e.get("categoryId"),
            "activityId": e.get("activityId"),
            "description": e.get("description"),
            "userCount": e.get("userCount"),
            "compatibleVariants": e.get("compatibleVariants", []),
            "binaryOffset": offset,
            "binaryLength": len(binary),
        })

    out_dir.mkdir(parents=True, exist_ok=True)
    catalog_path = out_dir / "catalog.json"
    blob_path = out_dir / "catalog.bin"
    with open(catalog_path, "w") as f:
        json.dump({"entries": meta}, f, separators=(",", ":"))
    with open(blob_path, "wb") as f:
        f.write(blob)

    return catalog_path, blob_path, len(meta), len(blob)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--from", dest="from_file", required=True, metavar="FILE",
                     help="the real suunto-apps/index.json to extract from")
    ap.add_argument("--out", metavar="DIR", default=str(CATALOG_DIR),
                     help=f"output directory (default: {CATALOG_DIR})")
    args = ap.parse_args()

    catalog_path, blob_path, count, blob_size = extract(args.from_file, pathlib.Path(args.out))
    catalog_size = catalog_path.stat().st_size
    print(f"{count} app(s) extracted")
    print(f"  {catalog_path}  ({catalog_size:,} B)")
    print(f"  {blob_path}  ({blob_size:,} B)")
    print(f"  total: {(catalog_size + blob_size):,} B")
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
