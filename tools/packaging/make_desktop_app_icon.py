#!/usr/bin/env python3
"""Generates the main AmbitApp desktop app's own window/taskbar icon, reusing the real
mountain-peaks mark already drawn for the Android app (android/src/components/ui/Icon.tsx's
own "mountain" case: `M2 18.5L6.5 9.5L9.5 13L13.5 5.5L17.5 12L20 9L22 18.5Z`, a 24x24
viewBox) - the same real app, the same mark, on both platforms, real request 2026-08-09
("can you just use the android app icon for our desktop app?").

Real, deliberate adjustment from the Android original (2026-08-09, "if it needs adjustment
to match our design do it"): the Android launcher draws this as a thin *stroke* outline
(white on black) - fine at a phone's own launcher-icon size, but a thin stroke would all
but disappear at a 16x16 taskbar/dock size. Filled solid here instead (same real path,
closed into a silhouette against its own baseline) for legibility at real desktop icon
sizes, and colored from this project's own actual Theme.qml palette (deep teal background,
white foreground) rather than Android's plain black/white - the same real palette
tools/packaging/make_icon.py's own BG/ACCENT constants already draw from (that script's own
ACCENT, (87, 201, 179), is Theme.qml's _darkPrimary #57C9B3 exactly) - not a new, unrelated
color invented for this icon specifically.

Run once to (re)generate `desktop/packaging/icon.png`/`icon.icns`/`icon.ico` - committed as
normal binary assets, same convention tools/packaging/make_icon.py already established for
the Workout Builder's own separate icon (that one intentionally different: this project's
own original interval-bars mark, not reused from the Android app's own icon, since they're
different tools).

    ./tools/packaging/make_desktop_app_icon.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 1024
OUT_DIR = Path(__file__).resolve().parent.parent.parent / "desktop" / "packaging"

# Same deep-teal/white pairing as tools/packaging/make_icon.py's own BG - this project's
# real, already-established icon background, not invented fresh here.
BG = (13, 58, 51, 255)
MOUNTAIN = (255, 255, 255, 255)

# android/src/components/ui/Icon.tsx's own real "mountain" path, in its native 24x24
# viewBox - copied by coordinate, not redrawn/guessed.
MOUNTAIN_PATH_24 = [
    (2, 18.5), (6.5, 9.5), (9.5, 13), (13.5, 5.5), (17.5, 12), (20, 9), (22, 18.5),
]


def make_base_image():
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    margin = SIZE * 0.06
    draw.rounded_rectangle(
        [margin, margin, SIZE - margin, SIZE - margin], radius=SIZE * 0.22, fill=BG)

    # The real path scaled from its native 24x24 viewBox into this icon's own drawable
    # area, closed back to its own start point (a real, solid silhouette against its own
    # baseline - not a guess at "what the shape would look like filled").
    pad_frac = 0.16
    area = SIZE * (1 - 2 * pad_frac)
    offset = SIZE * pad_frac
    scale = area / 24
    points = [(offset + x * scale, offset + y * scale) for x, y in MOUNTAIN_PATH_24]
    draw.polygon(points, fill=MOUNTAIN)

    return img


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    img = make_base_image()
    img.save(OUT_DIR / "icon.png")
    img.save(OUT_DIR / "icon.icns")
    img.save(OUT_DIR / "icon.ico",
              sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print(f"wrote {OUT_DIR / 'icon.png'}, icon.icns, icon.ico")


if __name__ == "__main__":
    main()
