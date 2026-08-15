"""512-byte memory page chains (t6-0.5.c ``readpages`` model)."""

from __future__ import annotations

from suunto_t6_sync.log_header import page_to_address
from suunto_t6_sync.transport import ProtocolError

PAGE_SIZE = 512
# Usable payload per page: bytes [1..510] inclusive (510 bytes). Byte 0 and 511 are links.
PAGE_DATA_SIZE = 510


def address_to_page(address: int) -> int:
    """Inverse of ``page_to_address`` for addresses in the log region."""
    if address < 0x0E00:
        raise ValueError(f"address 0x{address:04x} is below page region")
    if (address - 0x0E00) % 0x200 != 0:
        raise ValueError(f"address 0x{address:04x} is not page-aligned")
    return (address - 0x0E00) // 0x200


def read_page(device: object, page: int) -> bytes:
    """Read one 512-byte page. *device* must provide ``read_memory(addr, count)``."""
    raw = device.read_memory(page_to_address(page), PAGE_SIZE)  # type: ignore[attr-defined]
    if len(raw) != PAGE_SIZE:
        raise ProtocolError(f"short page 0x{page:02x}: got {len(raw)} bytes")
    return raw


def read_page_chain(
    device: object,
    start_page: int,
    *,
    max_pages: int = 64,
) -> list[tuple[int, bytes]]:
    """Follow next-page links at byte 511 until 0 or a cycle."""
    pages: list[tuple[int, bytes]] = []
    page = start_page
    seen: set[int] = set()
    while page and page not in seen and len(pages) < max_pages:
        seen.add(page)
        raw = read_page(device, page)
        pages.append((page, raw))
        page = raw[511]
    return pages


def page_payload(raw: bytes, *, skip_leading: int = 0) -> bytes:
    """Return usable data bytes from a page (exclude link bytes 0 and 511)."""
    if len(raw) != PAGE_SIZE:
        raise ValueError("page must be 512 bytes")
    data = raw[1 : 1 + PAGE_DATA_SIZE]
    if skip_leading:
        data = data[skip_leading:]
    return data
