#!/usr/bin/env python3
"""Rebuild real captured SuuntoLink writes using ONLY the tables Android now has.

Run after tools/gen_android_settings_templates.py, or whenever settings_write.py's own
templates change. Exits 1 if any captured write cannot be reproduced.

The TypeScript is a direct transcription of build_write_payload; what could actually go
wrong is the generated data - wrong entry ids, wrong order, wrong enum sets. So this runs
the Android ALGORITHM against the Android TABLES and compares with the real captures.
"""
import glob, json, os, re, sys
sys.path.insert(0, 'tools')
from ambit_pcap import messages

ts = open('android/src/services/AmbitSettingsTemplates.ts').read()
def table(name):
    m = re.search(name + r'[^=]*= (\{.*?\}|\[.*?\]);\n', ts, re.S)
    return json.loads(m.group(1))
TEMPLATES = table('AMBIT3_WRITE_TEMPLATES')
ENUMS = {int(k): v for k, v in table('AMBIT3_ENUM_VALUES').items()}
BOOLS = set(table('AMBIT3_BOOL_ENTRIES'))
MAGIC = b'SBEM0102'

def split_entries(buf):
    head = buf.find(MAGIC)
    if head < 0: return None, []
    out, off = [], head + 8
    while off + 2 <= len(buf):
        eid, ln = buf[off], buf[off+1]; off += 2
        if ln == 0xff:
            ln = int.from_bytes(buf[off:off+4], 'little'); off += 4
        out.append((eid, buf[off:off+ln])); off += ln
    return buf[:head], out

def encode_entry(eid, data):
    if len(data) < 0xff: return bytes([eid, len(data)]) + data
    return bytes([eid, 0xff]) + len(data).to_bytes(4, 'little') + data

def representable(eid, data):
    if eid in ENUMS: return len(data) >= 1 and data[0] in ENUMS[eid]
    if eid in BOOLS: return len(data) == 1 and data[0] in (0, 1)
    return True

def build(read, screen):
    prefix, entries = split_entries(read)
    if prefix is None: return None
    by_id = {}
    for eid, data in entries: by_id.setdefault(eid, []).append(data)
    out = bytearray(prefix[:-1] + b'\x01') + MAGIC
    for eid in TEMPLATES[screen]:
        for data in by_id.get(eid, []):
            if representable(eid, data): out += encode_entry(eid, data)
    return bytes(out)

matched = total = 0
mismatch_sizes = {}
for path in sorted(glob.glob('assets/pcap/*')):
    if not os.path.isfile(path): continue
    last_read = None
    try: msgs = list(messages(path))
    except Exception: continue
    for m in msgs:
        if m.incoming and m.command == 0x1100 and len(m.payload) > 40:
            last_read = m.payload
        elif not m.incoming and m.command == 0x1101 and last_read is not None:
            total += 1
            # A real write CHANGES a value, so an unpatched rebuild can never be equal
            # byte-for-byte. What the tables decide is which entries appear and in what
            # order - compare that, plus the total size, which together pin the template
            # exactly. The one differing field is the value being written.
            _, want_entries = split_entries(m.payload)
            want_seq = [eid for eid, _ in want_entries]
            hit = False
            for screen in TEMPLATES:
                got = build(last_read, screen)
                if got is None: continue
                _, got_entries = split_entries(got)
                if [eid for eid, _ in got_entries] == want_seq and len(got) == len(m.payload):
                    matched += 1; hit = True; break
            if not hit:
                mismatch_sizes[len(m.payload)] = mismatch_sizes.get(len(m.payload), 0) + 1

print(f"captured 0x1101 writes rebuilt from the Android tables: {matched}/{total}")
if mismatch_sizes:
    print("  unmatched write sizes:", dict(sorted(mismatch_sizes.items())))

sys.exit(0 if matched == total and total else 1)
