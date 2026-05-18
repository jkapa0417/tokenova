#!/usr/bin/env python3
"""
Compose the macOS DMG background image.

Generates `src-tauri/dmg-background.png` (540x380, @2x produces 1080x760)
combining:
  - deep-navy gradient backdrop
  - a gold "drag" arrow between the two icon slots
  - first-launch Gatekeeper bypass instructions

We intentionally do NOT bake the Tokenova icon or wordmark into the
background. Finder renders the live `.app` icon and its label on top at
`appPosition`; baking another copy underneath creates a visible ghost
and a doubled label.

Run from repo root:
    python3 scripts/build-dmg-background.py

Re-run after any visual tweak. Output committed to git so the CI bundle
step can pick it up from tauri.conf.json's bundle.macOS.dmg.background.
"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src-tauri" / "dmg-background.png"
OUT_2X = ROOT / "src-tauri" / "dmg-background@2x.png"

# DMG window inner content area. tauri.conf.json's windowSize matches.
W, H = 540, 380

# Palette — Tokenova design.
BG_TOP = (20, 22, 38)          # deep navy top
BG_BOTTOM = (8, 10, 22)        # darker navy bottom
GOLD = (212, 168, 87)          # Tokenova gold
GOLD_DIM = (140, 110, 56)
FG_HIGH = (240, 234, 220)
FG_MID = (170, 165, 155)

# Position constants (in DMG window coordinates).
APP_X, APP_Y = 140, 220        # tauri.conf appPosition
APPS_X, APPS_Y = 400, 220      # tauri.conf applicationFolderPosition
ICON_LABEL_GAP = 8


def vertical_gradient(size, top, bottom):
    """Build a top-to-bottom RGB gradient."""
    w, h = size
    img = Image.new("RGB", (w, h))
    pixels = img.load()
    for y in range(h):
        t = y / max(1, h - 1)
        r = int(top[0] + (bottom[0] - top[0]) * t)
        g = int(top[1] + (bottom[1] - top[1]) * t)
        b = int(top[2] + (bottom[2] - top[2]) * t)
        for x in range(w):
            pixels[x, y] = (r, g, b)
    return img


def add_starfield(img, count=80):
    """Sprinkle faint stars over the gradient so the background feels alive."""
    import random
    rng = random.Random(7)  # deterministic — same output every build
    px = img.load()
    for _ in range(count):
        x = rng.randint(0, img.width - 1)
        y = rng.randint(0, img.height - 1)
        # mild brightness boost relative to existing pixel
        r, g, b = px[x, y]
        boost = rng.randint(40, 110)
        r = min(255, r + boost)
        g = min(255, g + boost)
        b = min(255, b + boost)
        px[x, y] = (r, g, b)


def load_font(size, *, cjk=False):
    """Try CJK-capable fonts when needed, otherwise a Latin face.

    Candidates cover both macOS (local dev) and Linux (CI runner) so the
    script produces identical output regardless of where it's run.
    """
    cjk_candidates = [
        # macOS
        ("/System/Library/Fonts/AppleSDGothicNeo.ttc", 0),
        ("/System/Library/Fonts/Supplemental/AppleGothic.ttf", 0),
        # Linux
        ("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", 0),
        ("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", 0),
    ]
    latin_candidates = [
        # macOS
        ("/System/Library/Fonts/Supplemental/Arial Bold.ttf", None),
        ("/System/Library/Fonts/Helvetica.ttc", 0),
        # Linux
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", None),
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", None),
    ]
    candidates = cjk_candidates if cjk else latin_candidates
    for path, index in candidates:
        try:
            if index is None:
                return ImageFont.truetype(path, size)
            return ImageFont.truetype(path, size, index=index)
        except OSError:
            continue
    return ImageFont.load_default()


def draw_arrow(draw, x1, y1, x2, y2, color, width=3):
    """Horizontal arrow from (x1,y1) to (x2,y2) with a small triangle head."""
    draw.line([(x1, y1), (x2, y2)], fill=color, width=width)
    head_size = 12
    # Triangle at the tip
    draw.polygon(
        [
            (x2, y2),
            (x2 - head_size, y2 - head_size // 2),
            (x2 - head_size, y2 + head_size // 2),
        ],
        fill=color,
    )


def compose(scale=1):
    w, h = W * scale, H * scale
    img = vertical_gradient((w, h), BG_TOP, BG_BOTTOM)
    add_starfield(img, count=120 * scale)
    draw = ImageDraw.Draw(img, "RGBA")

    sub_font = load_font(11 * scale)
    body_font_latin = load_font(11 * scale)
    body_font_cjk = load_font(11 * scale, cjk=True)

    # Drag arrow: from icon area → Applications folder area.
    arrow_y = APP_Y * scale + 0
    draw_arrow(
        draw,
        (APP_X + 60) * scale,
        arrow_y,
        (APPS_X - 60) * scale,
        arrow_y,
        GOLD,
        width=3 * scale,
    )

    # Subtle "DRAG" word above the arrow.
    drag_text = "DRAG"
    bbox = draw.textbbox((0, 0), drag_text, font=sub_font)
    drag_tw = bbox[2] - bbox[0]
    arrow_mid_x = (APP_X + APPS_X) // 2 * scale
    draw.text(
        (arrow_mid_x - drag_tw // 2, arrow_y - 24 * scale),
        drag_text,
        font=sub_font,
        fill=GOLD_DIM,
    )

    # Gatekeeper instructions at the bottom.
    notice_lines = [
        ("FIRST LAUNCH:  Right-click Tokenova in /Applications → Open", GOLD, body_font_latin),
        ("처음 실행:  /Applications 안의 Tokenova 우클릭 → 열기", FG_MID, body_font_cjk),
    ]
    y_cursor = (H - 50) * scale
    for line, color, font in notice_lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        line_w = bbox[2] - bbox[0]
        draw.text(((w - line_w) // 2, y_cursor), line, font=font, fill=color)
        y_cursor += 18 * scale

    return img


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    compose(1).save(OUT, "PNG", optimize=True)
    compose(2).save(OUT_2X, "PNG", optimize=True)
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size:,} bytes)")
    print(f"wrote {OUT_2X.relative_to(ROOT)} ({OUT_2X.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
