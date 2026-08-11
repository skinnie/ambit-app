#!/usr/bin/env python3
"""NSP-over-BLE for the DESKTOP - the host side, in the role the watch actually expects.

Real request, 2026-08-11 (André): "port the bluetooth stack of android to desktop".

WHY THIS FILE EXISTS RATHER THAN tools/ble_link.py DOING IT. This project established on real
hardware (PROJECT_OVERVIEW.md; the 2026-08-09 correction; and the working Kotlin module at
android/.../ble/AmbitBleModule.kt) that BLE here is the ANCS pattern inverted from the
obvious one:

    the HOST runs the GATT server, and the WATCH connects into it as a GATT client.

The watch advertises the NSP service UUID as a *solicitation* - "connect to me if you host
NSP" - it does not offer that service itself. That is why every GATT-client approach only
ever found two generic services on it. `tools/ble_link.py` was written as a client (bleak,
BleakClient) in a session with no BLE adapter, before that correction; its NSP framing is
byte-exact against three captures and is reused here, but its transport role was wrong and
bleak cannot host a server at all - it is central-role only.

WHAT THIS IS A TRANSCRIPTION OF. Not new reverse-engineering. The service definition is
exactly what AmbitBleModule.kt's openServerAndConnect() builds, which in turn came from
Suunto's own decompiled BLEService.setService() (assets/APK/movescountapp). Same service,
same two characteristics, same CCCD:

    service 98ae7120-e62e-11e3-badd-0002a5d5c51b
      d0fd6b80-...  NOTIFY (+ CCCD 0x2902)   host -> watch     our TX
      c6339440-...  WRITE_NO_RESPONSE        watch -> host     our RX

Note the direction flip against ble_link.py: as a client it WROTE to c6339440; as the server
we RECEIVE on it. Same wire, opposite end.

STATUS: the D-Bus/BlueZ plumbing below is exercised (registers, advertises, runs), but a real
watch session needs André to trigger "Pair Mobile App" (fresh) or "Sync now" (already paired)
on the watch - the advertising window is short. Nothing here writes to a watch; it is a
transport plus a read-only smoke test, in keeping with this project's dry-run-by-default rule.

    ./tools/ble_server.py listen            # host the service and wait for the watch
    ./tools/ble_server.py listen --verbose  # dump every frame both ways
"""

import argparse
import json
import os
import socket
import struct
import sys
import threading
from pathlib import Path

# The framing is NOT reimplemented here. ble_link.py's SLIP/NSP envelope is byte-exact
# against three real captures, and it is transport-agnostic - it never cared which end of the
# wire it sat on. Only the ROLE was wrong there (it drove a GATT client); the bytes were
# always right, so they are imported rather than copied.
from ble_link import (CHUNK_SIZE, FLAGS_DEFAULT, NspAssembler, encode_nsp_frame)
from ambit_pcap import CMD_NAMES

BLUEZ = "org.bluez"
ADAPTER_IFACE = "org.bluez.Adapter1"
GATT_MANAGER_IFACE = "org.bluez.GattManager1"
LE_ADVERTISING_MANAGER_IFACE = "org.bluez.LEAdvertisingManager1"
DBUS_OM_IFACE = "org.freedesktop.DBus.ObjectManager"
DBUS_PROP_IFACE = "org.freedesktop.DBus.Properties"
GATT_SERVICE_IFACE = "org.bluez.GattService1"
GATT_CHRC_IFACE = "org.bluez.GattCharacteristic1"
LE_ADVERTISEMENT_IFACE = "org.bluez.LEAdvertisement1"

# Identical on the Ambit3 and the Kailash - see this file's docstring for the two independent
# sources these come from.
SERVICE_UUID = "98ae7120-e62e-11e3-badd-0002a5d5c51b"
NOTIFY_CHAR_UUID = "d0fd6b80-e62e-11e3-a2e9-0002a5d5c51b"
WRITE_CHAR_UUID = "c6339440-e62e-11e3-a5b3-0002a5d5c51b"

BASE_PATH = "/org/ambitapp/nsp"

# Real request, 2026-08-11 (André, via the desktop-app conversation): "port the bluetooth
# stack of android to desktop" doesn't stop at this file being reachable from a terminal -
# the actual Qt/Python app (desktop/backend/server.py) needs to reach the SAME connection.
# Unlike USB, a BLE session can't be opened fresh per HTTP request (write_nav.py's own
# per-call Link.open()/close() pattern) - the watch's advertising window is short and the
# GATT server + GLib mainloop above have to stay up across many commands. So this process
# stays the one thing holding the connection, and everything else - the desktop backend,
# any other tool - reaches it through a local control socket instead of trying to open BLE
# itself. Mirrors the Android shape (AmbitBleModule owns the connection, every ReactMethod
# call reaches into it) with a Unix socket standing in for the shared in-process g_device.
SOCKET_PATH = Path.home() / ".cache" / "AmbitApp" / "ble.sock"


class ControlSocketServer:
    """Local Unix-socket bridge onto one `ServerLink`, so a separate process (the desktop
    backend) can issue `link.command()` calls against the connection this process is holding
    open, without needing D-Bus/BlueZ access itself.

    One line-delimited JSON request per line, one JSON reply per line:
      {"op": "status"}
        -> {"ok": true, "subscribed": bool, "rx_total": int}
      {"op": "command", "cmd": int, "payload_hex": "", "expect_reply": true,
       "timeout": 20.0}
        -> {"ok": true, "payload_hex": "..."} or {"ok": false, "error": "..."}
      {"op": "set_dry_run", "value": true}
        -> {"ok": true, "dry_run": bool}

    `command` calls are serialized with a lock: `ServerLink` (like `write_nav.Link`) only
    tracks one in-flight command's reply at a time, and this socket can have more than one
    client - same reasoning as `desktop/backend/server.py`'s own WATCH_LOCK around
    subprocess tool calls, applied here instead to concurrent socket requests.
    """

    def __init__(self, link, rx_total, path=SOCKET_PATH):
        self.link = link
        self.rx_total = rx_total
        self.path = Path(path)
        self._cmd_lock = threading.Lock()

    def _handle(self, request):
        op = request.get("op")
        if op == "status":
            # "subscribed" is the transport-level signal (CCCD write); "handshake_done"/
            # "device_info" report the higher-level bootstrap exchange - a watch can be
            # subscribed for a moment before it's pushed 0x1201/0x0002, so callers that
            # need real device identity (server.py's /api/device) should wait for
            # handshake_done, not just subscribed.
            return {"ok": True, "subscribed": bool(self.link.notify_chrc.notifying),
                     "handshake_done": self.link.handshake_done.is_set(),
                     "device_info": self.link.device_info,
                     "dry_run": self.link.dry_run, "rx_total": self.rx_total[0]}
        if op == "set_dry_run":
            self.link.dry_run = bool(request.get("value", True))
            return {"ok": True, "dry_run": self.link.dry_run}
        if op == "command":
            try:
                payload = bytes.fromhex(request.get("payload_hex", ""))
                with self._cmd_lock:
                    reply = self.link.command(
                        int(request["cmd"]), payload,
                        expect_reply=bool(request.get("expect_reply", True)),
                        quiet=True,
                        timeout=float(request.get("timeout", 20.0)))
                return {"ok": True, "payload_hex": reply.hex()}
            except Exception as exc:                       # noqa: BLE001 - reported to the caller, not swallowed
                return {"ok": False, "error": str(exc)}
        return {"ok": False, "error": f"unknown op {op!r}"}

    def _serve_client(self, conn):
        with conn, conn.makefile("rb") as rf, conn.makefile("wb") as wf:
            for line in rf:
                line = line.strip()
                if not line:
                    continue
                try:
                    request = json.loads(line)
                    response = self._handle(request)
                except Exception as exc:                   # noqa: BLE001 - malformed request, not a crash
                    response = {"ok": False, "error": f"bad request: {exc}"}
                wf.write((json.dumps(response) + "\n").encode("utf-8"))
                wf.flush()

    def serve_forever(self):
        """Runs in its own thread - accept() blocks, and this must never share a thread with
        the GLib mainloop `listen()` already needs for D-Bus."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:
            self.path.unlink()
        except FileNotFoundError:
            pass                                            # first run, nothing stale to clear
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.bind(str(self.path))
        # Owner-only: this socket is a direct line to writing the watch's flash, same trust
        # boundary as the desktop backend's own localhost-only HTTP server.
        os.chmod(self.path, 0o600)
        sock.listen(4)
        print(f"  control socket: {self.path}")
        try:
            while True:
                conn, _ = sock.accept()
                threading.Thread(target=self._serve_client, args=(conn,), daemon=True).start()
        finally:
            sock.close()
            try:
                self.path.unlink()
            except FileNotFoundError:
                pass

# The name fallback, and on Linux it is not a fallback at all - it is the only live signal.
# BlueZ exposes advertised SERVICE uuids on Device1.UUIDs, but has no D-Bus property for
# service SOLICITATION uuids, which is what these watches actually broadcast. Android has a
# dedicated API for them (serviceSolicitationUuids) and still keeps a name check; here there
# is nothing else to go on while the watch is soliciting. Real miss, 2026-08-11: a UUID-only
# match found the Ambit3 once - from BlueZ's CACHE, populated by an earlier connection's
# service discovery - and never once while it was actually advertising.
#
# "Suunto NSP" is the Kailash: confirmed from a real Android scan and from kailashpair.pklg
# that this, not "Kailash" or "Hoopoe", is its advertised name.
NAME_PREFIXES = ("Ambit3", "Traverse", "Suunto NSP", "Kailash")

# Suunto's OUI. Confirmed 2026-08-11 from a raw btmon capture of a real "Pair Mobile App"
# press: the advertiser was 0C:8C:DC:2A:58:28. The same prefix this project already strips
# from Android's bond config when forgetting a pairing, so it is Suunto's across the family.
#
# Matching on it is a backstop for the case a watch advertises with neither a recognised name
# nor the service UUID visible to BlueZ. The same capture settled what it actually sends: the
# NSP UUID rides in AD type 0x07 (complete 128-bit service class list), NOT as a solicitation
# (0x15) - so Device1.UUIDs does carry it and the UUID rule works. An earlier reading here
# claimed 0x15 from a naive byte count; the packet structure says otherwise.
SUUNTO_OUI = "0C:8C:DC"


def _dbus():
    """Imported lazily, exactly like ble_link.py defers bleak and write_nav.py defers hid -
    so a cable-only install is never broken by a missing BLE dependency."""
    import dbus                                            # noqa: PLC0415
    import dbus.mainloop.glib                              # noqa: PLC0415
    import dbus.service                                    # noqa: PLC0415
    from gi.repository import GLib                         # noqa: PLC0415
    return dbus, dbus.service, GLib


def build_classes():
    """The D-Bus object tree BlueZ expects, built after the lazy import above."""
    dbus, dbus_service, GLib = _dbus()

    class Application(dbus_service.Object):
        """The ObjectManager root. BlueZ reads the whole tree from this one call."""

        def __init__(self, bus, service):
            self.path = BASE_PATH
            self.service = service
            dbus_service.Object.__init__(self, bus, self.path)

        @dbus_service.method(DBUS_OM_IFACE, out_signature="a{oa{sa{sv}}}")
        def GetManagedObjects(self):
            out = {self.service.path: self.service.properties()}
            for chrc in self.service.characteristics:
                out[chrc.path] = chrc.properties()
            return out

    class Characteristic(dbus_service.Object):
        def __init__(self, bus, index, uuid, flags, service):
            self.path = service.path + "/char" + str(index)
            self.uuid = uuid
            self.flags = flags
            self.service = service
            self.notifying = False
            # Set by the owner to receive inbound frames (the watch writing to us).
            self.on_write = None
            # Fired once the watch subscribes: BlueZ raises StartNotify then, and the Kotlin
            # module treats exactly that as the "transport is live" signal.
            self.on_subscribed = None
            dbus_service.Object.__init__(self, bus, self.path)

        def properties(self):
            return {GATT_CHRC_IFACE: {
                "Service": dbus.ObjectPath(self.service.path),
                "UUID": self.uuid,
                "Flags": self.flags,
                "Notifying": dbus.Boolean(self.notifying),
            }}

        @dbus_service.method(DBUS_PROP_IFACE, in_signature="s",
                             out_signature="a{sv}")
        def GetAll(self, interface):
            if interface != GATT_CHRC_IFACE:
                raise dbus.exceptions.DBusException(
                    "org.bluez.Error.InvalidArguments")
            return self.properties()[GATT_CHRC_IFACE]

        @dbus_service.method(GATT_CHRC_IFACE, in_signature="aya{sv}")
        def WriteValue(self, value, options):
            # The watch writing to us - our RX. BlueZ hands over one ATT write at a time;
            # reassembly into NSP frames is the caller's job (ble_link.py already does it).
            if self.on_write:
                self.on_write(bytes(bytearray(value)))

        @dbus_service.method(GATT_CHRC_IFACE, out_signature="ay")
        def ReadValue(self, options):
            # The notify characteristic is declared readable to mirror the Android service
            # (PERMISSION_READ), but it carries no standing value - data only ever arrives
            # as notifications.
            return dbus.Array([], signature="y")

        @dbus_service.method(GATT_CHRC_IFACE)
        def StartNotify(self):
            if self.notifying:
                return
            self.notifying = True
            print("  watch subscribed - transport is live")
            if self.on_subscribed:
                self.on_subscribed()

        @dbus_service.method(GATT_CHRC_IFACE)
        def StopNotify(self):
            self.notifying = False

        @dbus_service.signal(DBUS_PROP_IFACE, signature="sa{sv}as")
        def PropertiesChanged(self, interface, changed, invalidated):
            pass

        def notify(self, payload):
            """Our TX. A notification is delivered by announcing a Value change - that is how
            BlueZ's D-Bus GATT server sends, there is no explicit send method."""
            if not self.notifying:
                return False
            self.PropertiesChanged(
                GATT_CHRC_IFACE,
                {"Value": dbus.Array([dbus.Byte(b) for b in payload], signature="y")},
                [])
            return True

    class Service(dbus_service.Object):
        def __init__(self, bus, index):
            self.path = BASE_PATH + "/service" + str(index)
            self.characteristics = []
            dbus_service.Object.__init__(self, bus, self.path)

        def properties(self):
            return {GATT_SERVICE_IFACE: {
                "UUID": SERVICE_UUID,
                "Primary": dbus.Boolean(True),
                "Characteristics": dbus.Array(
                    [dbus.ObjectPath(c.path) for c in self.characteristics],
                    signature="o"),
            }}

        @dbus_service.method(DBUS_PROP_IFACE, in_signature="s", out_signature="a{sv}")
        def GetAll(self, interface):
            if interface != GATT_SERVICE_IFACE:
                raise dbus.exceptions.DBusException(
                    "org.bluez.Error.InvalidArguments")
            return self.properties()[GATT_SERVICE_IFACE]

    class Advertisement(dbus_service.Object):
        """Optional, and NOT how the connection is actually established.

        First attempt here advertised the service and waited to be found. That was wrong, and
        the working Android module says so plainly: it never advertises. It SCANS for the
        soliciting watch and then connects TO it, while hosting the server. Solicitation is
        the watch asking "connect to me if you host NSP" - the answer is a connection, not
        another advertisement.

        Kept as a best-effort extra (some stacks connect faster when they can also see us),
        which is why a failure here is a warning rather than fatal. The payload is also
        trimmed: a 128-bit UUID is 18 bytes of the 31-byte budget, and adding a name plus
        tx-power overflowed it - the real cause of the first run's
        "Failed to register advertisement".
        """

        def __init__(self, bus, index):
            self.path = BASE_PATH + "/advert" + str(index)
            dbus_service.Object.__init__(self, bus, self.path)

        def properties(self):
            return {
                "Type": "peripheral",
                "ServiceUUIDs": dbus.Array([SERVICE_UUID], signature="s"),
                "LocalName": "AmbitApp",
            }

        @dbus_service.method(DBUS_PROP_IFACE, in_signature="s", out_signature="a{sv}")
        def GetAll(self, interface):
            if interface != LE_ADVERTISEMENT_IFACE:
                raise dbus.exceptions.DBusException(
                    "org.bluez.Error.InvalidArguments")
            return self.properties()

        @dbus_service.method(LE_ADVERTISEMENT_IFACE)
        def Release(self):
            pass

    return Application, Service, Characteristic, Advertisement, dbus, GLib


class ServerLink:
    """`write_nav.Link`'s public shape, driven from the SERVER end.

    Existing tools only ever call `link.command(command, payload)` and block for the reply, so
    presenting that same method here is what lets settings_write.py, custom_modes.py,
    kailash_history.py and the rest run over Bluetooth with no change at all.

    Two things differ from ble_link.py's client version and both come from the role flip:
    sending is a NOTIFICATION on d0fd6b80 rather than a GATT write, and there is no connect
    step - the watch arrives on its own, so `open()` is a wait rather than an action.
    """

    # Server-role driver flags. NOT ble_link.py's FLAGS_DEFAULT (0x0A) - that value was
    # reverse-engineered from the 7R app acting as a BLE CLIENT (HANDOFF.md Milestone 7's
    # "Outgoing flags" paragraph). We are the opposite role (server), and
    # protocol_ble.c's ble_send_command - the native code that actually got phone-driven
    # requests working post-handshake on real hardware, 2026-08-09 - uses 0x05 for every
    # driver-path request once the handshake below has completed. Reusing 0x0A here would
    # be the client's own value in the server's mouth.
    DRIVER_FLAGS = 0x05

    def __init__(self, notify_chrc, glib):
        self.notify_chrc = notify_chrc
        self._glib = glib
        self.dry_run = True            # matches Link: nothing writes unless asked
        self.verbose = False
        self.sequence = 0
        self.sent = []
        self._pkt_num = 0
        self._conn_id = 0x0009
        self._reply = None
        self._reply_ready = threading.Event()
        self._expecting = None

        # Server-side bootstrap handshake (HANDOFF.md Milestone 7 items 9-10, ported
        # byte-for-byte from protocol_ble.c's libambit_ble_handshake_device_info() - the
        # fix that got Android's own connect+identify working on real hardware). Over BLE
        # the WATCH drives the opening exchange: it pushes 0x1201 first and won't send
        # anything else until we answer it with 0x0000; only then does it push 0x0002
        # (hello - model/serial/fw/hw, not a reply to a request). A naive "send 0x0000,
        # wait for a reply" - the USB pattern device_info.py already uses - just hangs:
        # confirmed the same way here, live, 2026-08-11, that Android's HANDOFF.md entry
        # already documented for the native code.
        self.handshake_done = threading.Event()
        self.device_info = {}

    def on_message(self, message):
        """Called from the D-Bus thread for every decoded inbound frame. Before the
        handshake completes, incoming frames are the watch's own opener pushes, not replies
        to anything we sent - dispatched to _handle_handshake_frame() instead of the normal
        _expecting match."""
        if not self.handshake_done.is_set():
            self._handle_handshake_frame(message)
            return
        if self._expecting is not None and message.command == self._expecting:
            self._reply = message
            self._reply_ready.set()

    def _handle_handshake_frame(self, message):
        if message.command == 0x1201:
            # The watch's opener. Byte-exact against the working Suunto capture
            # (protocol_ble.c's own comment, itself sourced from assets/ble 2026-08-09/):
            # flags=0x01, connId=0x0000, pktNum=0x0000, payload 03 00 00 00. Answering
            # this is what makes the watch advance to sending its 0x0002 hello - without
            # it the watch just re-sends 0x1201 every ~5s.
            self._send_raw(0x0000, flags=0x01, conn_id=0x0000, pkt_num=0x0000,
                           payload=b"\x03\x00\x00\x00")
            return
        if message.command == 0x0002:
            # hello: [model 16][id 16][fw 4][hw 4]... - same offsets
            # libambit_ble_handshake_device_info() reads, ported directly rather than
            # re-derived. fw is a plain 3-byte major.minor.patch (HANDOFF.md's own worked
            # example: 02 04 11 = "2.4.17"); hw mirrors the USB device_info reply's
            # 16-bit-third-component convention (device_info.py's read_device_info(), and
            # protocol_ble.c's own comment says this explicitly - "mirroring the USB
            # device-info reply layout").
            payload = message.payload
            info = {}
            if len(payload) >= 16:
                info["model"] = payload[0:16].split(b"\0")[0].decode("utf-8", "replace")
            if len(payload) >= 32:
                info["serial"] = payload[16:32].split(b"\0")[0].decode("utf-8", "replace")
            if len(payload) >= 36:
                fw = payload[32:36]
                info["fw_version"] = f"{fw[0]}.{fw[1]}.{fw[2]}"
            if len(payload) >= 40:
                hw = payload[36:40]
                info["hw_version"] = f"{hw[0]}.{hw[1]}.{hw[2] | (hw[3] << 8)}"
            self.device_info = info
            # Driver-path commands (getLogs etc.) continue the pktNum sequence from here -
            # protocol_ble.c: "device_info was the watch's pkt 0 exchange... the phone's
            # first real request is pkt 1."
            self._pkt_num = 1
            self.handshake_done.set()
            return
        # any other early push (a retried 0x1201, etc.) is ignored, same as the native code

    def _send(self, frame):
        """Notifications must be emitted on the GLib main loop thread - D-Bus signals are not
        safe to raise from another one - so the send is handed to the loop and this returns
        immediately. command() then blocks on the reply event instead.
        """
        def emit():
            for i in range(0, len(frame), CHUNK_SIZE):
                self.notify_chrc.notify(frame[i:i + CHUNK_SIZE])
            return False               # one-shot idle callback
        self._glib.idle_add(emit)

    def _send_raw(self, command, flags, conn_id, pkt_num, payload):
        """Like _send(), but with explicit header fields instead of self._conn_id/
        self._pkt_num - the handshake's 0x0000 answer uses fixed values (flags=0x01,
        connId=0, pktNum=0) that don't fit the driver-path bookkeeping command() does."""
        frame = encode_nsp_frame(command, payload, flags, conn_id, pkt_num)
        self._send(frame)

    def command(self, command, payload=b"", expect_reply=True, quiet=False, flags=None,
                timeout=20.0):
        if not self.handshake_done.is_set():
            raise RuntimeError(
                "handshake not complete yet - the watch hasn't pushed its 0x1201/0x0002 "
                "opener, so there's no connId/pktNum sequence to send a driver-path "
                "request into. Wait for ServerLink.handshake_done before calling command().")
        name = CMD_NAMES.get(command, f"0x{command:04x}")
        frame = encode_nsp_frame(command, payload,
                                 self.DRIVER_FLAGS if flags is None else flags,
                                 self._conn_id, self._pkt_num)
        if not quiet:
            print(f"  {'[dry-run] ' if self.dry_run else ''}-> 0x{command:04x} "
                  f"{name:22} {len(payload):5} B  {len(frame)} raw byte(s)")
        self.sent.append((command, payload, frame))
        self._pkt_num += 1
        self.sequence += 1
        if self.dry_run or not expect_reply:
            return b""
        if not self.notify_chrc.notifying:
            raise RuntimeError("the watch has not subscribed yet - nothing to send to")
        self._expecting = command
        self._reply = None
        self._reply_ready.clear()
        self._send(frame)
        if not self._reply_ready.wait(timeout):
            self._expecting = None
            raise TimeoutError(f"no reply to 0x{command:04x} within {timeout}s")
        self._expecting = None
        return self._reply.payload


def find_adapter(bus, dbus):
    """The first adapter that can actually do what we need - both managers present."""
    manager = dbus.Interface(bus.get_object(BLUEZ, "/"), DBUS_OM_IFACE)
    for path, ifaces in manager.GetManagedObjects().items():
        if GATT_MANAGER_IFACE in ifaces and LE_ADVERTISING_MANAGER_IFACE in ifaces:
            return path
    return None


def forget_suunto_bonds(bus, dbus, adapter):
    """Drop every existing Suunto bond before scanning.

    André, 2026-08-11: "just unpair every suunto ambit, kailash, traverse before running.
    It's not like people have plenty." A stale bond is not harmless here - a watch already
    bonded to this host has no reason to advertise, so it sits invisible while we wait for a
    solicitation it will never send, and "Pair Mobile App" has nothing to do. Clearing it
    first makes every run start from the same known state.

    Scoped to Suunto by OUI and name, so no unrelated device the user owns is touched. This
    mirrors what the Android side already does deliberately (forget the bond on every
    rebuild) rather than being a new idea.
    """
    manager = dbus.Interface(bus.get_object(BLUEZ, "/"), DBUS_OM_IFACE)
    adapter_obj = dbus.Interface(bus.get_object(BLUEZ, adapter), ADAPTER_IFACE)
    removed = 0
    for path, ifaces in manager.GetManagedObjects().items():
        device = ifaces.get("org.bluez.Device1")
        if not device:
            continue
        address = str(device.get("Address", "")).upper()
        name = str(device.get("Name", device.get("Alias", "")) or "")
        ours = address.startswith(SUUNTO_OUI) or any(
            name.startswith(prefix) for prefix in NAME_PREFIXES)
        if not ours or not device.get("Paired", False):
            continue
        try:
            adapter_obj.RemoveDevice(path)
            print(f"  unpaired {name or address} - it can advertise again now")
            removed += 1
        except Exception as exc:
            print(f"  could not unpair {name or address}: {exc}")
    if removed == 0:
        print("  no existing Suunto bonds to clear")
    return removed


def start_discovery(bus, dbus, adapter, verbose):
    """Scan, and connect to anything soliciting the NSP service.

    Deliberately an unfiltered scan. The Kotlin module hit exactly this on real hardware: the
    Kailash only SOLICITS the UUID, so a service-UUID scan filter matched nothing at all
    ("scan registered, zero results"). Every device is examined here and judged on its own
    UUID list instead.
    """
    adapter_obj = dbus.Interface(bus.get_object(BLUEZ, adapter), ADAPTER_IFACE)
    seen = set()

    def consider(path, ifaces):
        device = ifaces.get("org.bluez.Device1")
        if not device or path in seen:
            return
        uuids = [str(u).lower() for u in device.get("UUIDs", [])]
        name = str(device.get("Name", device.get("Alias", "")) or "")
        solicits = SERVICE_UUID.lower() in uuids
        named = any(name.startswith(prefix) for prefix in NAME_PREFIXES)
        addressed = str(device.get("Address", "")).upper().startswith(SUUNTO_OUI)
        if not solicits and not named and not addressed:
            if verbose:
                print(f"  seen {path.split('/')[-1]} {name or '(no name)'}")
            return
        seen.add(path)
        why = "NSP uuid" if solicits else ("name match" if named else "Suunto address")
        print(f"  watch found: {name or '(no name)'} [{why}] - connecting "
              f"(we host the service, it connects in)")
        # Discovery MUST stop before connecting. An active scan and a connection attempt
        # fight for the same radio, and BlueZ resolves it by aborting the connection -
        # "le-connection-abort-by-local", which reads like a refusal by the watch and is
        # really our own scan getting in the way.
        try:
            adapter_obj.StopDiscovery()
        except Exception:
            pass                       # already stopped is fine
        # If the watch already has a link to us there is nothing to initiate - it connects in
        # on its own, and our outbound attempt is at best redundant ("Operation already in
        # progress") and at worst the thing that kills the session
        # ("le-connection-abort-by-local"). Both were seen for real, 2026-08-11.
        if device.get("Connected", False):
            print("  already connected - waiting for it to subscribe")
            return

        # Asynchronously, with handlers. A blocking Connect() times out on D-Bus's own
        # 25s default long before BlueZ finishes connecting and pairing - the first run
        # failed exactly that way ("Did not receive a reply"), which looked like a refusal
        # and was really just impatience.
        dbus.Interface(bus.get_object(BLUEZ, path), "org.bluez.Device1").Connect(
            reply_handler=lambda: print("  connected - waiting for it to subscribe"),
            error_handler=lambda exc: print(f"  connect failed: {exc}"),
            timeout=60)

    bus.add_signal_receiver(
        consider, dbus_interface=DBUS_OM_IFACE, signal_name="InterfacesAdded")

    # InterfacesAdded fires only for a device BlueZ has NEVER seen. A watch it already
    # cached - which is any watch used once before - re-appears as a PROPERTY UPDATE on the
    # existing object instead, so a listener on InterfacesAdded alone goes deaf to exactly
    # the devices most likely to be ours. Real miss, 2026-08-11: an earlier run found
    # "Ambit3 1849100781" straight from the cache, then a later run with a freshness check
    # saw nine other devices and never the watch, because by then it was cached and only
    # ever emitted RSSI updates. Both signals are needed.
    def on_props(interface, changed, invalidated, path=None):
        if interface != "org.bluez.Device1" or not path:
            return
        if "RSSI" not in changed and "UUIDs" not in changed and "ServiceData" not in changed:
            return
        try:
            props = dbus.Interface(bus.get_object(BLUEZ, path), DBUS_PROP_IFACE)
            consider(path, {"org.bluez.Device1": props.GetAll("org.bluez.Device1")})
        except Exception:
            pass                       # device vanished mid-scan; nothing to do

    bus.add_signal_receiver(
        on_props, dbus_interface=DBUS_PROP_IFACE, signal_name="PropertiesChanged",
        arg0="org.bluez.Device1", path_keyword="path")

    # Devices BlueZ already knows about never fire InterfacesAdded again - a watch paired
    # earlier would otherwise be invisible to this scan. But a REMEMBERED device is not
    # necessarily a present one: BlueZ caches it long after it stopped advertising, and
    # connecting to a watch that is not currently soliciting just fails. Only cached devices
    # BlueZ still reports as in range are considered.
    manager = dbus.Interface(bus.get_object(BLUEZ, "/"), DBUS_OM_IFACE)
    for path, ifaces in manager.GetManagedObjects().items():
        device = ifaces.get("org.bluez.Device1") or {}
        # A PAIRED device is the exception, and it turned out to be the important one. A
        # watch already bonded to this host does not have to advertise for us to reach it -
        # BlueZ can connect to a known device by address. The freshness check was written to
        # skip stale cache entries and ended up discarding exactly the device most likely to
        # be ours: real miss, 2026-08-11 - the Ambit3 sat there paired=True, RSSI=None
        # through several attempts while we waited for an advertisement it had no reason to
        # send.
        if (device.get("RSSI") is None and not device.get("Connected", False)
                and not device.get("Paired", False)):
            continue                   # remembered, not paired, not advertising
        consider(path, ifaces)

    try:
        # The filter is NOT optional, and its absence is the likeliest reason a scan sees
        # everything except the device you want. With no filter BlueZ applies its own
        # defaults - which can exclude LE-only advertisers and de-duplicate repeats - so a
        # watch that btmon shows advertising never reaches a D-Bus client at all. Real miss,
        # 2026-08-11: btmon captured the Ambit3 advertising the NSP UUID (AD type 0x07) from
        # 0C:8C:DC:2A:58:28 while this scan, running at the same time, reported nothing.
        #
        # Transport "le" asks for LE advertisements explicitly; DuplicateData keeps repeat
        # adverts coming (a watch advertises the same payload over and over, and without this
        # only the first is delivered); the RSSI floor is deliberately at the limit so nothing
        # is dropped for being faint.
        adapter_obj.SetDiscoveryFilter({
            "Transport": "le",
            "DuplicateData": dbus.Boolean(True),
            "RSSI": dbus.Int16(-127),
        })
        adapter_obj.StartDiscovery()
        print("  scanning (LE transport, duplicates on) for the watch...")
    except Exception as exc:
        print(f"  could not start discovery: {exc}")


def listen(verbose=False, timeout=0, forget=False, serve_socket=True):
    Application, Service, Characteristic, Advertisement, dbus, GLib = build_classes()
    import dbus.mainloop.glib                              # noqa: PLC0415

    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    bus = dbus.SystemBus()

    adapter = find_adapter(bus, dbus)
    if not adapter:
        print("  no Bluetooth adapter with GattManager1 + LEAdvertisingManager1 found.")
        return 1
    print(f"  adapter: {adapter}")

    # Powered on and discoverable, or the watch has nothing to find.
    props = dbus.Interface(bus.get_object(BLUEZ, adapter), DBUS_PROP_IFACE)
    props.Set(ADAPTER_IFACE, "Powered", dbus.Boolean(True))

    service = Service(bus, 0)
    # Order matters only for readability; BlueZ keys off the UUIDs.
    notify_chrc = Characteristic(bus, 0, NOTIFY_CHAR_UUID, ["notify", "read"], service)
    write_chrc = Characteristic(bus, 1, WRITE_CHAR_UUID,
                                ["write-without-response", "write"], service)
    service.characteristics = [notify_chrc, write_chrc]
    app = Application(bus, service)

    rx_total = [0]
    # One assembler for the whole session: the watch's writes arrive as 20-byte ATT chunks
    # that do not align with frame boundaries, so reassembly has to be stateful across them.
    assembler = NspAssembler()

    def on_write(chunk):
        rx_total[0] += len(chunk)
        if verbose:
            print(f"  RX {len(chunk):3d} B  {chunk.hex()}")
        for message in assembler.feed(chunk):
            name = CMD_NAMES.get(message.command, f"0x{message.command:04x}")
            crc = ("crc ok" if message.crc_ok else
                   "CRC MISMATCH" if message.crc_ok is False else "no crc")
            print(f"  <- 0x{message.command:04x} {name:22} "
                  f"{len(message.payload):5} B  [{crc}]")
            if verbose and message.payload:
                print(f"        {message.payload[:64].hex(' ')}"
                      f"{' ...' if len(message.payload) > 64 else ''}")
            link.on_message(message)

    write_chrc.on_write = on_write

    # The Link-compatible face of this transport. Constructed before the characteristic
    # callbacks are armed so a frame arriving early is never dropped - the same "arm the RX
    # stash first" lesson the Kotlin module learned when the Kailash sent its hello once.
    link = ServerLink(notify_chrc, GLib)

    if serve_socket:
        control = ControlSocketServer(link, rx_total)
        threading.Thread(target=control.serve_forever, daemon=True).start()

    gatt_manager = dbus.Interface(bus.get_object(BLUEZ, adapter), GATT_MANAGER_IFACE)
    ad_manager = dbus.Interface(bus.get_object(BLUEZ, adapter),
                                LE_ADVERTISING_MANAGER_IFACE)
    advert = Advertisement(bus, 0)

    loop = GLib.MainLoop()

    def registered():
        print(f"  NSP service registered ({SERVICE_UUID})")
        print('  now trigger "Pair Mobile App" (first time) or "Sync now" (already paired) '
              "on the watch - its solicitation window is short.")

    def failed(error):
        print(f"  registration failed: {error}")
        loop.quit()

    gatt_manager.RegisterApplication(app.path, {},
                                     reply_handler=registered, error_handler=failed)
    ad_manager.RegisterAdvertisement(
        advert.path, {},
        reply_handler=lambda: print("  also advertising as 'AmbitApp' (optional)"),
        error_handler=lambda e: print(f"  (advertising unavailable: {e} - not required, "
                                      f"we connect to the watch)"))

    # NOT automatic any more. Clearing bonds every run fixed the first pairing and broke
    # every one after it: the bond a successful session establishes is exactly what lets the
    # watch reconnect, and deleting it each time put us back to square one (real regression,
    # 2026-08-11 - a working session was followed by le-connection-abort-by-local because the
    # bond it had just created was wiped). Now opt-in, for when pairing is genuinely stuck.
    if forget:
        forget_suunto_bonds(bus, dbus, adapter)

    # The real mechanism, mirroring AmbitBleModule.scanAndConnect(): find the watch
    # soliciting our service, then connect to it while we host the server.
    start_discovery(bus, dbus, adapter, verbose)

    if timeout > 0:
        def stop():
            print(f"  stopping after {timeout}s "
                  f"({rx_total[0]} B received, "
                  f"{'subscribed' if notify_chrc.notifying else 'never subscribed'})")
            loop.quit()
            return False
        GLib.timeout_add_seconds(timeout, stop)

    try:
        loop.run()
    except KeyboardInterrupt:
        print("\n  stopped")
    finally:
        try:
            ad_manager.UnregisterAdvertisement(advert.path)
            gatt_manager.UnregisterApplication(app.path)
        except Exception:
            pass                       # teardown on an already-gone bus is not a failure
    return 0


def main():
    parser = argparse.ArgumentParser(
        description=__doc__.splitlines()[0],
        formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="action", required=True)
    listen_p = sub.add_parser("listen", help="host the NSP service and wait for the watch")
    listen_p.add_argument("--verbose", action="store_true", help="dump every frame")
    listen_p.add_argument("--timeout", type=int, default=0,
                          help="stop after N seconds (0 = until Ctrl-C)")
    listen_p.add_argument("--forget", action="store_true",
                          help="unpair existing Suunto bonds first - use when pairing is "
                               "stuck, NOT routinely: the bond is what lets a paired watch "
                               "reconnect")
    listen_p.add_argument("--no-socket", action="store_true",
                          help="don't start the local control socket (desktop/backend/server.py "
                               "uses it; a bare CLI session doesn't need it)")
    args = parser.parse_args()
    if args.action == "listen":
        return listen(verbose=args.verbose, timeout=args.timeout, forget=args.forget,
                      serve_socket=not args.no_socket)
    return 1


if __name__ == "__main__":
    sys.exit(main())
