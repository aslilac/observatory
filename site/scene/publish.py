"""Put the hero render and the app icon on the site.

  out/hero.png + out/hero.json  ->  ../images/hero-<width>.avif and .webp, and where
                                    things fall on the render (the horizon, the sun,
                                    the building, the pole) in ../index.html
  ../../icon (the app icon)     ->  ../public/favicon.svg, ../images/logo.svg,
                                    ../public/apple-touch-icon.png

Run after hero.py (build.sh does both), and after the icon is rebuilt.
"""

import json
import re
import shutil
import subprocess
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
SITE = HERE.parent
IMAGES = SITE / "images"  # bundled (and hashed) by Vite
PUBLIC = SITE / "public"  # copied as they are
ICON = SITE.parent / "icon"
WIDTHS = [1280, 1920, 2880]

# ---- the hero
meta = json.loads((HERE / "out" / "hero.json").read_text())
im = Image.open(HERE / "out" / "hero.png")
im = im.convert("RGBA")  # 16-bit PNG -> 8-bit
IMAGES.mkdir(exist_ok=True)
PUBLIC.mkdir(exist_ok=True)
for old in IMAGES.glob("hero-*.*"):
    old.unlink()
widths = [w for w in WIDTHS if w <= im.width] or [im.width]
for w in widths:
    small = im if w == im.width else im.resize((w, round(w * im.height / im.width)), Image.LANCZOS)
    small.save(IMAGES / f"hero-{w}.webp", quality=84, method=6)
    small.save(IMAGES / f"hero-{w}.avif", quality=68, speed=4)
    print(f"hero-{w}: webp {(IMAGES / f'hero-{w}.webp').stat().st_size // 1024} KB, "
          f"avif {(IMAGES / f'hero-{w}.avif').stat().st_size // 1024} KB")

# where things land on the render, for the sky, the layout and the stars. The sun and
# the building's box fall back to guesses from the aperture for an older render.
hz = meta["horizon"]
ax, ay = meta["aperture"]
sun = meta.get("sun", [ax + 0.03, hz - 0.03])
left, top, right, bottom = meta.get("building", [ax - 0.08, ay - 0.13, ax + 0.18, hz + 0.12])
style = "; ".join(f"--{k}: {v:.4f}" for k, v in [
    ("scene-aspect", meta["width"] / meta["height"]), ("horizon", hz),
    ("sun-x", sun[0]), ("sun-y", sun[1]),
    ("bld-l", left), ("bld-t", top), ("bld-r", right), ("bld-b", bottom),
]) + ";"
page = (SITE / "index.html").read_text()
page, n = re.subn(r'(<section\s+class="hero"\s+style=")[^"]*"', rf'\g<1>{style}"', page)
assert n == 1, "no hero section with a style in index.html"
page = re.sub(r'data-pole-x="[^"]*"', f'data-pole-x="{meta["pole"][0]:.4f}"', page)
page = re.sub(r'data-pole-y="[^"]*"', f'data-pole-y="{meta["pole"][1]:.4f}"', page)
page = re.sub(r'data-horizon="[^"]*"', f'data-horizon="{hz:.4f}"', page)
srcset = lambda ext: ", ".join(f"./images/hero-{w}.{ext} {w}w" for w in widths)
page = re.sub(r'srcset="[^"]*hero-[^"]*\.avif[^"]*"', f'srcset="{srcset("avif")}"', page)
page = re.sub(r'srcset="[^"]*hero-[^"]*\.webp[^"]*"', f'srcset="{srcset("webp")}"', page)
page = re.sub(r'src="[^"]*hero-[^"]*\.webp"', f'src="./images/hero-{widths[min(1, len(widths) - 1)]}.webp"', page)
(SITE / "index.html").write_text(page)
# put the page back in the repo's format (the attributes above come out on one line)
if subprocess.run(["pnpm", "exec", "oxfmt", "index.html"], cwd=SITE, capture_output=True).returncode:
    print("oxfmt didn't run; format index.html with `pnpm fmt` from the repo root")

# ---- the icon: the aperture drawing for the tab and the header, and the macOS art
# (full bleed, as iOS rounds it itself) for the home screen
shutil.copy(ICON / "renders" / "aperture-windows-small.svg", PUBLIC / "favicon.svg")
shutil.copy(ICON / "renders" / "aperture-windows-medium.svg", IMAGES / "logo.svg")
layers = ICON / "out" / "macos" / "Observatory.icon" / "Assets"
art = Image.open(layers / "sky.png").convert("RGBA")
art.alpha_composite(Image.open(layers / "observatory.png").convert("RGBA"))
art.convert("RGB").resize((180, 180), Image.LANCZOS).save(PUBLIC / "apple-touch-icon.png", optimize=True)
print("icons: favicon.svg, logo.svg, apple-touch-icon.png")
