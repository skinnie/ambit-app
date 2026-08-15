"""Serial transport for Suunto FTDI devices."""

from __future__ import annotations

import time
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    import serial


class Transport(Protocol):
    """Minimal serial-like interface (real port or test double)."""

    def write(self, data: bytes) -> None: ...

    def read(self, size: int = 256) -> bytes: ...

    def reset_input_buffer(self) -> None: ...


class SerialTransport:
    def __init__(
        self,
        port: str,
        baudrate: int = 115200,
        timeout: float = 2.0,
    ) -> None:
        self.port = port
        self.baudrate = baudrate
        self.timeout = timeout
        self._serial: serial.Serial | None = None

    def open(self) -> None:
        import serial

        self._serial = serial.Serial(
            port=self.port,
            baudrate=self.baudrate,
            bytesize=serial.EIGHTBITS,
            parity=serial.PARITY_NONE,
            stopbits=serial.STOPBITS_ONE,
            timeout=self.timeout,
            # pyserial defaults can assert RTS; on this FTDI cable that
            # prevents the T6 from answering (live probe 2026-08-06).
            rtscts=False,
            dsrdtr=False,
        )
        self._serial.rts = False
        self._serial.dtr = False
        # Match vendor/t6-0.5.c: settle then drain stale bytes.
        time.sleep(0.15)
        self.reset_input_buffer()

    def close(self) -> None:
        if self._serial and self._serial.is_open:
            self._serial.close()
        self._serial = None

    def __enter__(self) -> SerialTransport:
        self.open()
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def write(self, data: bytes) -> None:
        if not self._serial:
            raise RuntimeError("serial port not open")
        self._serial.write(data)
        self._serial.flush()

    def read(self, size: int = 256) -> bytes:
        if not self._serial:
            raise RuntimeError("serial port not open")
        return bytes(self._serial.read(size))

    def reset_input_buffer(self) -> None:
        if not self._serial:
            raise RuntimeError("serial port not open")
        self._serial.reset_input_buffer()


class ProtocolError(Exception):
    """Device response missing, malformed, or checksum failure."""


def read_exact(transport: Transport, size: int, *, label: str = "data") -> bytes:
    """Read exactly *size* bytes or raise ``ProtocolError``."""
    if size == 0:
        return b""
    chunks: list[bytes] = []
    remaining = size
    # pyserial timeout applies per read(); allow a few partial reads.
    attempts = 0
    max_attempts = max(8, size)
    while remaining > 0 and attempts < max_attempts:
        chunk = transport.read(remaining)
        attempts += 1
        if not chunk:
            break
        chunks.append(chunk)
        remaining -= len(chunk)
    data = b"".join(chunks)
    if len(data) != size:
        raise ProtocolError(
            f"timeout reading {label}: got {len(data)}/{size} bytes "
            f"({data.hex(' ') if data else 'empty'})"
        )
    return data
