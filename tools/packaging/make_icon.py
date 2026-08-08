#!/usr/bin/env python3
"""Generates this project's own app icon - a simple, original design (alternating interval
bars), not any real Suunto asset. Deliberately original: using SuuntoLink's own icon would
look like impersonation and directly contradict the "not affiliated with Suunto" disclaimer
already in the app (`workout_gui.py`'s HTML_PAGE); a third-party stock icon would need
attribution tracking for an unclear benefit. This is small enough to just draw directly.

Run once to (re)generate `icon.png`/`icon.icns`/`icon.ico` in this same folder - the build
scripts consume those directly, so a plain PyInstaller build on Windows/macOS never needs
Pillow installed, only this one regeneration step does (already run, committed as normal
binary assets, same as `dist/linux/`).

    ./tools/packaging/make_icon.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 1024
OUT_DIR = Path(__file__).parent

BG = (13, 58, 51, 255)  # deep teal - distinct from Suunto's own black/white branding
BAR = (255, 255, 255, 255)
ACCENT = (87, 201, 179, 255)  # matches the accent used in this project's other UI work


def make_base_image():
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    margin = SIZE * 0.06
    draw.rounded_rectangle(
        [margin, margin, SIZE - margin, SIZE - margin], radius=SIZE * 0.22, fill=BG)

    # Four bars, alternating low/high - an interval-training profile at a glance
    # (recovery/interval/recovery/interval), the whole reason this tool exists.
    heights = [0.30, 0.62, 0.30, 0.74]
    colors = [BAR, ACCENT, BAR, ACCENT]
    n = len(heights)
    area_left, area_right = SIZE * 0.20, SIZE * 0.80
    area_bottom = SIZE * 0.74
    gap = SIZE * 0.045
    bar_w = ((area_right - area_left) - gap * (n - 1)) / n
    radius = bar_w * 0.35

    for i, (h_frac, color) in enumerate(zip(heights, colors)):
        x0 = area_left + i * (bar_w + gap)
        x1 = x0 + bar_w
        bar_h = (SIZE * 0.46) * h_frac
        y1 = area_bottom
        y0 = y1 - bar_h
        draw.rounded_rectangle([x0, y0, x1, y1], radius=radius, fill=color)

    return img


def main():
    img = make_base_image()
    img.save(OUT_DIR / "icon.png")
    img.save(OUT_DIR / "icon.icns")
    img.save(OUT_DIR / "icon.ico",
              sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print(f"wrote {OUT_DIR / 'icon.png'}, icon.icns, icon.ico")


if __name__ == "__main__":
    main()
