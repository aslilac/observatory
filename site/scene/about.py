"""Put the hero render in the app's About window.

  out/hero.png + out/hero.json  ->  ../../build-resources/about/scene.webp, the part of
                                    the render with the building in it, and scene.json,
                                    where the horizon, the sun and the pole fall on it

The About window (src/renderer/views/about/) draws the sky and the stars behind it, as
the site does. Run after hero.py (build.sh does both).
"""

import json
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
ABOUT = HERE.parent.parent / "build-resources" / "about"
# The window shows the render from LEFT to its right edge, which puts the dome near
# the middle, and from TOP (above the dome) down. It's 480 px wide, so this is 2x.
LEFT = 0.25
TOP = 0.3
WIDTH = 960

meta = json.loads((HERE / "out" / "hero.json").read_text())
im = Image.open(HERE / "out" / "hero.png").convert("RGBA")  # 16-bit PNG -> 8-bit
crop = im.crop((round(LEFT * im.width), round(TOP * im.height), im.width, im.height))
crop = crop.resize((WIDTH, round(WIDTH * crop.height / crop.width)), Image.LANCZOS)
ABOUT.mkdir(parents=True, exist_ok=True)
crop.save(ABOUT / "scene.webp", quality=84, method=6)

# as fractions of the crop, which the pole is above
x = lambda f: round((f - LEFT) / (1 - LEFT), 4)
y = lambda f: round((f - TOP) / (1 - TOP), 4)
sun = meta.get("sun", [meta["aperture"][0] + 0.03, meta["horizon"] - 0.03])
layout = {
    "aspect": round(crop.width / crop.height, 4),
    # the whole render's size, in the crop's widths and heights
    "render": [round(1 / (1 - LEFT), 4), round(1 / (1 - TOP), 4)],
    "horizon": y(meta["horizon"]),
    "sun": [x(sun[0]), y(sun[1])],
    "pole": [x(meta["pole"][0]), y(meta["pole"][1])],
}
(ABOUT / "scene.json").write_text(json.dumps(layout, indent="\t") + "\n")
print(f"about: scene.webp {(ABOUT / 'scene.webp').stat().st_size // 1024} KB, {crop.width}x{crop.height}")
