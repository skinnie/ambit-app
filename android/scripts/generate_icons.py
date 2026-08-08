from PIL import Image, ImageDraw
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIZES = {
    'mipmap-mdpi':    48,
    'mipmap-hdpi':    72,
    'mipmap-xhdpi':   96,
    'mipmap-xxhdpi':  144,
    'mipmap-xxxhdpi': 192,
}

# Tracé GPS stylisé (proportions 0–1)
TRACK = [
    (0.15, 0.72),
    (0.30, 0.52),
    (0.22, 0.32),
    (0.50, 0.18),
    (0.72, 0.30),
    (0.62, 0.52),
    (0.82, 0.68),
]

BG    = (22,  33,  62,  255)   # #16213e
CYAN  = (0,  229, 255, 255)    # tracé GPS
GREEN = (46, 204, 113, 255)    # marqueur départ
RED   = (231, 76,  60, 255)    # marqueur arrivée


def draw_content(draw, size):
    pad = size * 0.12
    w   = size - 2 * pad
    pts = [(pad + x * w, pad + y * w) for x, y in TRACK]
    lw  = max(2, size // 20)
    draw.line(pts, fill=CYAN, width=lw)
    r = max(3, size // 18)
    for pt, color in [(pts[0], GREEN), (pts[-1], RED)]:
        draw.ellipse([pt[0] - r, pt[1] - r, pt[0] + r, pt[1] + r], fill=color)


def make_square(size):
    img  = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    cr   = int(size * 0.22)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=cr, fill=BG)
    draw_content(draw, size)
    return img


def make_round(size):
    img  = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse([0, 0, size - 1, size - 1], fill=BG)
    draw_content(draw, size)
    return img


for folder, size in SIZES.items():
    out = os.path.join(BASE, 'android', 'app', 'src', 'main', 'res', folder)
    make_square(size).save(os.path.join(out, 'ic_launcher.png'))
    make_round(size).save(os.path.join(out,  'ic_launcher_round.png'))
    print(f'{folder}: {size}x{size} OK')

print('Done.')
