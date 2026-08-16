#!/usr/bin/env python3
"""Generates the Sommet desktop app's own window/taskbar icon.

The mark is "Peak" (direction 01, chosen 2026-08-14): the Suunto Smart Sensor's own visual
language - a round black device disc with a single triangle accent - with the Suunto name
dropped and the accent moved from Suunto red to Sommet's own teal (#2FA98C, Theme.qml's
_lightAccent). Sommet is French for "summit", so the peak is the whole idea; the light dot at
its apex is a summit waypoint (the POI the app plants on a route). The same mark is drawn
in-app by qml/components/SommetMark.qml - this script is the raster (PNG/ICO/ICNS) version for
the one static OS-level icon slot, kept in step with that component's geometry (both use the
same 120-unit reference the logo concepts were drawn in).

Run once to (re)generate `desktop/packaging/icon.png`/`icon.icns`/`icon.ico` - committed as
normal binary assets, same convention as before.

    ./tools/packaging/make_desktop_app_icon.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 1024
SS = 4                     # supersample factor for smooth disc/triangle edges
OUT_DIR = Path(__file__).resolve().parent.parent.parent / "desktop" / "packaging"

# Colors, straight from the chosen mark / Theme.qml - not invented for the icon.
POD = (14, 17, 22, 255)        # #0E1116 - the device-black disc
TEAL = (47, 169, 140, 255)     # #2FA98C - Theme.qml _lightAccent, the summit peak
DOT = (233, 235, 238, 255)     # #E9EBEE - Theme.qml _darkText, the summit waypoint

# The mark is drawn in a 120x120 reference box (the same one the logo concepts used), then
# scaled to the icon size, so the raster stays identical to SommetMark.qml's vector.
DISC = (60, 60, 57)                       # cx, cy, r
PEAK = [(40, 84), (72, 40), (94, 84)]     # front peak triangle
APEX = (72, 40)                           # summit waypoint centre
WP_OUTER, WP_INNER = 6.6, 3.1             # waypoint dark ring / light centre radii


def make_base_image():
    n = SIZE * SS
    s = n / 120.0
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def circle(cx, cy, r, fill):
        d.ellipse([(cx - r) * s, (cy - r) * s, (cx + r) * s, (cy + r) * s], fill=fill)

    # pod disc
    circle(*DISC, fill=POD)
    # front peak
    d.polygon([(x * s, y * s) for x, y in PEAK], fill=TEAL)
    # summit waypoint: dark ring (cut into the peak) + light centre
    circle(APEX[0], APEX[1], WP_OUTER, fill=POD)
    circle(APEX[0], APEX[1], WP_INNER, fill=DOT)

    return img.resize((SIZE, SIZE), Image.LANCZOS)


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
