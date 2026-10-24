"""A review sheet: every platform's icons at real sizes, on light and dark.

Writes out/preview.png. Run after compose.py (build.sh does both).
"""

import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
APP_ID = "ooo.lilac.observatory"


def font(size):
    for path in ("/System/Library/Fonts/SFNS.ttf", "/System/Library/Fonts/Helvetica.ttc"):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def icon(path, size=None):
    im = Image.open(os.path.join(OUT, path)).convert("RGBA")
    if size and im.width != size:
        im = im.convert("RGBa").resize((size, size), Image.LANCZOS).convert("RGBA")
    return im


ROWS = [
    (
        "macOS 26+  (Icon Composer, as the system draws it)",
        [("macos/previews/Default.png", 256), ("macos/previews/Default.png", 128), ("macos/previews/Default.png", 64)],
    ),
    (
        "macOS 15 and earlier  (icon.icns, Big Sur grid)",
        [("macos/icon.iconset/icon_256x256.png", 256), ("macos/icon.iconset/icon_128x128.png", None),
         ("macos/icon.iconset/icon_32x32@2x.png", None), ("macos/icon.iconset/icon_32x32.png", None),
         ("macos/icon.iconset/icon_16x16.png", None)],
    ),
    (
        "Windows  (icon.ico)",
        [("windows/png/icon-256.png", None), ("windows/png/icon-96.png", None), ("windows/png/icon-48.png", None),
         ("windows/png/icon-32.png", None), ("windows/png/icon-24.png", None), ("windows/png/icon-16.png", None)],
    ),
    (
        "Linux  (hicolor, GNOME margins)",
        [(f"linux/hicolor/256x256/apps/{APP_ID}.png", None), (f"linux/hicolor/128x128/apps/{APP_ID}.png", None),
         (f"linux/hicolor/64x64/apps/{APP_ID}.png", None), (f"linux/hicolor/48x48/apps/{APP_ID}.png", None),
         (f"linux/hicolor/32x32/apps/{APP_ID}.png", None), (f"linux/hicolor/16x16/apps/{APP_ID}.png", None)],
    ),
]

PANELS = [("#ececf0", "#3b3b40"), ("#1e1e22", "#c9c9cf")]  # (background, label colour)
PAD, GAP, ROW_H, LABEL_H = 40, 28, 256, 44


def main():
    widths = []
    for _, items in ROWS:
        w = sum((s or icon(p).width) for p, s in items) + GAP * (len(items) - 1)
        widths.append(w)
    panel_w = max(widths) + 2 * PAD
    H = PAD + len(ROWS) * (LABEL_H + ROW_H + PAD)
    sheet = Image.new("RGBA", (panel_w * len(PANELS), H), (0, 0, 0, 255))
    f = font(22)
    for k, (bg, fg) in enumerate(PANELS):
        panel = Image.new("RGBA", (panel_w, H), bg)
        d = ImageDraw.Draw(panel)
        y = PAD
        for label, items in ROWS:
            d.text((PAD, y), label, fill=fg, font=f)
            x = PAD
            base = y + LABEL_H + ROW_H
            for p, s in items:
                im = icon(p, s)
                panel.alpha_composite(im, (x, base - im.height))
                x += im.width + GAP
            y += LABEL_H + ROW_H + PAD
        sheet.paste(panel, (k * panel_w, 0))
    sheet.convert("RGB").save(os.path.join(OUT, "preview.png"))
    print("wrote out/preview.png")


if __name__ == "__main__":
    main()
