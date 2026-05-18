#!/usr/bin/env python3
"""
Repaint the macOS tray icons as white-on-transparent.

The originals are near-black silhouettes intended for AppKit's template
image tinting, where the system flips them to white on dark menubars and
black on light menubars. We want the icon to stay white in every
appearance, so we bake the white pixels into the asset itself and let
`lib.rs` disable `icon_as_template`.

Run from repo root:
    python3 scripts/whiten-tray-mac.py

Output is committed to git alongside the source PNGs.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
TARGETS = [
    ROOT / "src-tauri" / "icons" / "tray-mac.png",
    ROOT / "src-tauri" / "icons" / "tray-mac-88.png",
    ROOT / "src-tauri" / "icons" / "tray-mac-discovery.png",
    ROOT / "src-tauri" / "icons" / "tray-mac-discovery-88.png",
]


def whiten(path: Path) -> None:
    img = Image.open(path).convert("RGBA")
    w, h = img.size
    out = Image.new("RGBA", (w, h))
    src = img.load()
    dst = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = src[x, y]
            if a == 0:
                continue
            # Preserve the icon shape via alpha; force opaque pixels to
            # white. This works for both the plain planet silhouette and
            # the discovery variant (its "new" dot is the same near-black
            # tone as the body, so whitening keeps the shape intact).
            dst[x, y] = (255, 255, 255, a)
    out.save(path, "PNG", optimize=True)
    print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size:,} bytes)")


def main() -> None:
    for p in TARGETS:
        if not p.exists():
            print(f"skip (missing): {p.relative_to(ROOT)}")
            continue
        whiten(p)


if __name__ == "__main__":
    main()
