"""Lay the icons out on each platform's grid.

Reads the macOS renders renders/mac*.png (+ .json bounding boxes written by
observatory.py) and the aperture drawings renders/aperture-<style>-<detail>.svg
(written by aperture.py), and writes out/:
  macos/Observatory.icon     Icon Composer document (macOS 26+): sky + building layers
  macos/icon.iconset         legacy squircle art on the Big Sur grid (macOS 15 and earlier)
  windows/png, windows/icon.ico   the Windows aperture, filling the 48px grid
  linux/hicolor/...          the GNOME aperture on GNOME's grid, named by app id: PNGs,
                             a scalable SVG, and the symbolic icon (symbolic.svg)
The apertures are rasterized from the SVG at each size rather than scaled down.

Run with: uv run --no-project --with pillow --with numpy --with resvg-py python compose.py
"""

import io
import json
import math
import os
import random
import re
import shutil

import numpy as np
import resvg_py
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
RENDERS = os.path.join(HERE, "renders")
OUT = os.path.join(HERE, "out")
APP_ID = "ooo.lilac.observatory"

# Below this size the detail turns to mush; use the --simple render or drawing.
SIMPLE_BELOW = 40


# ------------------------------------------------------------------ helpers


def srgb_to_lin(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def hexc(h):
    h = h.lstrip("#")
    return np.array([int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)])


def to_image(rgb, alpha=None):
    """Linear float RGB (+ alpha) -> 8-bit straight-alpha PIL image."""
    s = (lin_to_srgb(rgb) * 255 + 0.5).astype(np.uint8)
    if alpha is None:
        return Image.fromarray(s, "RGB")
    a = (np.clip(alpha, 0, 1) * 255 + 0.5).astype(np.uint8)
    return Image.fromarray(np.dstack([s, a]), "RGBA")


def from_image(im):
    """PIL RGBA -> (linear premultiplied RGB, alpha) floats."""
    a = np.asarray(im.convert("RGBA"), dtype=np.float64) / 255
    rgb = srgb_to_lin(a[..., :3]) * a[..., 3:4]
    return rgb, a[..., 3]


def load(name):
    im = Image.open(os.path.join(RENDERS, name + ".png")).convert("RGBA")
    with open(os.path.join(RENDERS, name + ".json")) as fh:
        bbox = json.load(fh)["bbox"]
    return im, bbox


def place(render, size, height, cy, cx=0.5, sharpen=0.0):
    """Resample a render onto a size x size transparent canvas.

    The object's bounding box gets `height` (fraction of the canvas) and its
    centre lands at (cx, cy). Resampling is premultiplied and box-filtered, so
    small sizes average the detail rather than alias it.
    """
    im, (bx0, by0, bx1, by1) = render
    s = height * size / (by1 - by0)  # output px per render px
    # the canvas rectangle in render coordinates
    ox = (bx0 + bx1) / 2 - cx * size / s
    oy = (by0 + by1) / 2 - cy * size / s
    span = size / s
    pad = int(span) + 2  # room for the box to hang off the render's edge
    big = Image.new("RGBa", (im.width + 2 * pad, im.height + 2 * pad), (0, 0, 0, 0))
    big.paste(im.convert("RGBa"), (pad, pad))
    box = (ox + pad, oy + pad, ox + pad + span, oy + pad + span)
    out = big.resize((size, size), Image.LANCZOS, box=box, reducing_gap=3.0)
    if sharpen:
        out = out.filter(ImageFilter.UnsharpMask(radius=0.6, percent=int(sharpen * 100), threshold=0))
    return out.convert("RGBA")


def over(dst_rgb, dst_a, im):
    """Composite a straight-alpha PIL image over premultiplied float layers."""
    rgb, a = from_image(im)
    return rgb + dst_rgb * (1 - a[..., None]), a + dst_a * (1 - a)


def bezier(p0, p1, p2, p3, n=32):
    t = np.linspace(0, 1, n)[:, None]
    p0, p1, p2, p3 = (np.array(p, float) for p in (p0, p1, p2, p3))
    return (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t * t * p2 + t**3 * p3


# One corner of Apple's continuous-corner rounded rectangle (the iOS 7 / Big Sur
# shape), the top right, in units of the radius measured in from the corner
# (left, down). Unlike a circular arc, the curvature eases in from the straight edge.
CORNER = np.vstack([
    bezier((1.52866483, 0), (1.08849323, 0), (0.86840689, 0), (0.63149399, 0.07491100)),
    bezier((0.63149399, 0.07491100), (0.37282392, 0.16905899), (0.16905899, 0.37282392), (0.07491100, 0.63149399)),
    bezier((0.07491100, 0.63149399), (0, 0.86840689), (0, 1.08849323), (0, 1.52866483)),
])


def rounded_square(size, inset, radius, ss=4):
    """Coverage of Apple's rounded square, inset from each edge, antialiased by supersampling."""
    lo, hi = inset * ss, (size - inset) * ss
    c = CORNER * radius * ss
    pts = []
    for (cx, cy), (sx, sy), rev in (((hi, lo), (-1, 1), False), ((hi, hi), (-1, -1), True),
                                    ((lo, hi), (1, -1), False), ((lo, lo), (1, 1), True)):
        pts += [(cx + sx * dx, cy + sy * dy) for dx, dy in (c[::-1] if rev else c)]
    im = Image.new("L", (size * ss, size * ss), 0)
    ImageDraw.Draw(im).polygon(pts, fill=255)
    return np.asarray(im.resize((size, size), Image.BOX), dtype=np.float64) / 255


def blur(a, sigma):
    im = Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8), "L")
    return np.asarray(im.filter(ImageFilter.GaussianBlur(sigma)), dtype=np.float64) / 255


# --------------------------------------------------------------- macOS sky

SKY_TOP, SKY_BOTTOM = hexc("#1c2266"), hexc("#5a52d8")
N_STARS, N_BRIGHT = 34, 3
STAR_GAP, STAR_GAP_BRIGHT = 0.075, 0.3  # least distance between stars, as fractions of the plate
STAR_AVOID = None  # set in main(): (x, y, bright) on the plate -> True too near the building
GLOW = hexc("#8f7cf0")


def sky(size, seed=7):
    """Night sky: deep blue overhead to violet at the horizon, a few stars."""
    y = (np.arange(size) + 0.5) / size
    x = (np.arange(size) + 0.5) / size
    t = y[:, None] ** 1.3 * np.ones((1, size))
    top, bot = srgb_to_lin(SKY_TOP), srgb_to_lin(SKY_BOTTOM)
    rgb = top[None, None, :] * (1 - t[..., None]) + bot[None, None, :] * t[..., None]
    # a soft glow low behind the building
    d = np.sqrt(((x[None, :] - 0.5) / 0.55) ** 2 + ((y[:, None] - 0.95) / 0.45) ** 2)
    g = np.clip(1 - d, 0, 1) ** 2 * 0.35
    rgb = rgb * (1 - g[..., None]) + srgb_to_lin(GLOW)[None, None, :] * g[..., None]
    # stars: spread evenly over the open sky, all around the building, and the
    # brightest few with the six-point spikes of a hexagonal-segment telescope
    rng = random.Random(seed)
    stars = np.zeros((size, size))
    yy, xx = np.mgrid[0:size, 0:size]
    k = size / 1024
    placed = []  # (x, y, bright) on the plate

    def fits(sx, sy, bright):
        # inside the rounded plate, with room for a bright star's spikes
        if abs(2 * sx - 1) ** 5 + abs(2 * sy - 1) ** 5 > (0.5 if bright else 0.78):
            return False
        if STAR_AVOID is not None and STAR_AVOID(sx, sy, bright):
            return False
        # keep clear of the stars already placed, so they spread out instead of clumping
        for px, py, pb in placed:
            gap = STAR_GAP_BRIGHT if (bright and pb) else STAR_GAP
            if (sx - px) ** 2 + (sy - py) ** 2 < gap * gap:
                return False
        return True

    tries = 0
    while len(placed) < N_STARS and tries < 20000:
        tries += 1
        bright = len(placed) < N_BRIGHT
        sx, sy = rng.uniform(0.02, 0.98), rng.uniform(0.02, 0.98)
        if fits(sx, sy, bright):
            placed.append((sx, sy, bright))
    for sx, sy, bright in placed:
        r = (3.0 if bright else rng.choice([1.2, 1.5, 1.8, 2.2, 2.6])) * k
        b = 1.0 if bright else rng.uniform(0.5, 1.0)
        b *= 1 - 0.3 * max(0.0, sy - 0.5) / 0.5  # a little fainter down in the horizon's glow
        cx_, cy_ = sx * size, sy * size
        reach = (20 if bright else 10) * r
        x0, x1 = int(max(cx_ - reach, 0)), int(min(cx_ + reach + 1, size))
        y0, y1 = int(max(cy_ - reach, 0)), int(min(cy_ + reach + 1, size))
        dx, dy = xx[y0:y1, x0:x1] + 0.5 - cx_, yy[y0:y1, x0:x1] + 0.5 - cy_
        dd = (dx * dx + dy * dy) / (r * r)
        star = b * (np.exp(-dd * 1.2) + 0.12 * np.exp(-dd * 0.06))
        if bright:
            for a in np.radians(np.arange(90, 450, 60)):
                along = dx * math.cos(a) - dy * math.sin(a)
                across = dx * math.sin(a) + dy * math.cos(a)
                spike = np.exp(-np.abs(along) / (4.5 * r)) * np.exp(-((across / (0.4 * r)) ** 2))
                star += 0.45 * spike * (along > 0)
        stars[y0:y1, x0:x1] += star
    star_col = srgb_to_lin(hexc("#fff8e8"))
    rgb = rgb + stars[..., None] * star_col[None, None, :] * 1.1
    return rgb


# The building on the macOS plate, as fractions of the plate: its height and
# the gap above the dome. It's taller than the plate's room below that gap, so
# it rises up from the bottom edge, cut off through the drum.
MAC_H, MAC_TOP = 1.04, 0.14
MAC_H_SIMPLE, MAC_TOP_SIMPLE = 1.04, 0.125
MAC_CY = MAC_TOP + MAC_H / 2
MAC_CY_SIMPLE = MAC_TOP_SIMPLE + MAC_H_SIMPLE / 2

# Big Sur grid: 1024 canvas, 824 plate with continuous corners.
PLATE = 824 / 1024
RADIUS = 185.4 / 1024  # of the continuous corners


def mac_legacy(size, building, building_simple):
    """Legacy squircle icon (macOS 15 and earlier) at `size` px."""
    work = max(size * 4, 256) if size < 256 else size * 2
    inset = work * (1 - PLATE) / 2
    plate = work * PLATE
    mask = rounded_square(work, inset, work * RADIUS)
    rgb = np.zeros((work, work, 3))
    a = np.zeros((work, work))
    # drop shadow under the plate
    sh = blur(np.roll(mask, int(round(work * 12 / 1024)), axis=0), work * 14 / 1024) * 0.32
    a = sh
    # the plate: sky inside the squircle
    s = np.zeros((work, work, 3))
    i0, i1 = int(math.floor(inset)), int(math.ceil(work - inset))
    s[i0:i1, i0:i1] = sky(i1 - i0)
    rgb = s * mask[..., None] + rgb * (1 - mask[..., None])
    a = mask + a * (1 - mask)
    # the building, clipped to the plate
    simple = size < SIMPLE_BELOW
    r = building_simple if simple else building
    h, cy = (MAC_H_SIMPLE, MAC_CY_SIMPLE) if simple else (MAC_H, MAC_CY)
    obj = place(r, work, h * PLATE, (inset + cy * plate) / work)
    orgb, oa = from_image(obj)
    # a soft shadow on the sky, standing in for the one macOS 26 draws
    sh = blur(np.roll(oa, int(round(work * 0.012)), axis=0), work * 0.02) * 0.3 * mask
    rgb = rgb * (1 - sh[..., None])
    oa = oa * mask
    orgb = orgb * mask[..., None]
    rgb = orgb + rgb * (1 - oa[..., None])
    a = oa + a * (1 - oa)
    # premultiplied -> straight, downsample
    straight = np.where(a[..., None] > 1e-6, rgb / np.maximum(a[..., None], 1e-6), 0)
    im = to_image(straight, a)
    if work != size:
        im = im.convert("RGBa").resize((size, size), Image.LANCZOS).convert("RGBA")
        if size <= 64:
            im = sharpen_rgba(im, 0.5)
    return im


def sharpen_rgba(im, amount):
    p = im.convert("RGBa").filter(ImageFilter.UnsharpMask(radius=0.6, percent=int(amount * 100), threshold=0))
    return p.convert("RGBA")


def icon_composer(building):
    """An Icon Composer document: full-bleed sky + the building on a 1024 canvas."""
    doc = os.path.join(OUT, "macos", "Observatory.icon")
    shutil.rmtree(doc, ignore_errors=True)
    os.makedirs(os.path.join(doc, "Assets"))
    to_image(sky(1024)).save(os.path.join(doc, "Assets", "sky.png"))
    place(building, 1024, MAC_H, MAC_CY).save(os.path.join(doc, "Assets", "observatory.png"))
    spec = {
        "fill": {"solid": "srgb:%.5f,%.5f,%.5f,1.00000" % tuple(SKY_TOP)},
        "groups": [
            {
                "name": "Observatory",
                "layers": [{"name": "observatory", "image-name": "observatory.png", "glass": False}],
                "shadow": {"kind": "neutral", "opacity": 0.5},
                "translucency": {"enabled": False, "value": 0},
                "specular": False,
            },
            {
                "name": "Sky",
                "layers": [{"name": "sky", "image-name": "sky.png", "glass": False}],
                "shadow": {"kind": "none", "opacity": 0},
                "translucency": {"enabled": False, "value": 0},
                "specular": False,
            },
        ],
        "supported-platforms": {"squares": ["macOS"]},
    }
    with open(os.path.join(doc, "icon.json"), "w") as fh:
        json.dump(spec, fh, indent=2)


# ------------------------------------------------------- Windows and Linux


# Each platform's aperture: its style, how much of the canvas it fills, and the
# size from which it gets the full three rings of tiles (below that, two).
WINDOWS = {"style": "windows", "fill": 0.92, "fill_small": 0.96, "full_from": 96}  # 44 of the 48px grid
# GNOME's round icons fill its 120px circle keyline on the 128 canvas (with the front
# profile), and its detail should read at 64px, so two rings at every size.
GNOME = {"style": "gnome", "fill": 122 / 128, "fill_small": 122 / 128, "full_from": None}


def aperture_svg(p, size):
    if size < SIMPLE_BELOW:
        detail = "small"
    elif p["full_from"] and size >= p["full_from"]:
        detail = "full"
    else:
        detail = "medium"
    return os.path.join(RENDERS, f"aperture-{p['style']}-{detail}.svg")


def aperture(p, size):
    """The platform's aperture at `size` px, centred with its margins."""
    frac = p["fill_small"] if size < SIMPLE_BELOW else p["fill"]
    margin = round(size * (1 - frac) / 2)  # whole pixels, so it sits centred
    inner = size - 2 * margin
    svg = aperture_svg(p, size)
    art = Image.open(io.BytesIO(bytes(resvg_py.svg_to_bytes(svg_path=svg, width=inner, height=inner)))).convert("RGBA")
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.alpha_composite(art, (margin, margin))
    return out


def scalable(p, dst):
    """The aperture as an SVG on the platform's canvas: its viewBox widened by the margins."""
    with open(aperture_svg(p, 128)) as fh:
        svg = fh.read()
    m = re.search(r'width="256" height="256" viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"', svg)
    x, y, side, _ = map(float, m.groups())
    big = side / p["fill"]
    x, y = x - (big - side) / 2, y - (big - side) / 2
    svg = svg.replace(m.group(0), f'width="128" height="128" viewBox="{x:.2f} {y:.2f} {big:.2f} {big:.2f}"')
    with open(dst, "w") as fh:
        fh.write(svg)


WIN_SIZES = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256]
LINUX_SIZES = [16, 22, 24, 32, 48, 64, 128, 256, 512]


def main():
    mac = load("mac")
    mac_simple = load("mac-simple")

    # macOS
    global STAR_AVOID
    _, cover = from_image(place(mac, 256, MAC_H, MAC_CY))
    near = blur(cover, 4) > 0.02  # keep stars a little way off the building
    far = blur(cover, 9) > 0.02  # and the bright ones' spikes clear of it

    def STAR_AVOID(x, y, bright=False):
        return bool((far if bright else near)[min(int(y * 256), 255), min(int(x * 256), 255)])

    iconset = os.path.join(OUT, "macos", "icon.iconset")
    shutil.rmtree(iconset, ignore_errors=True)
    os.makedirs(iconset)
    cache = {}
    for pts in (16, 32, 128, 256, 512):
        for scale in (1, 2):
            px = pts * scale
            if px not in cache:
                cache[px] = mac_legacy(px, mac, mac_simple)
            suffix = "" if scale == 1 else "@2x"
            cache[px].save(os.path.join(iconset, f"icon_{pts}x{pts}{suffix}.png"))
    cache[1024].save(os.path.join(OUT, "macos", "icon-legacy-1024.png"))
    icon_composer(mac)
    print("macos done")

    # Windows
    wdir = os.path.join(OUT, "windows", "png")
    os.makedirs(wdir, exist_ok=True)
    win = {n: aperture(WINDOWS, n) for n in WIN_SIZES}
    for n, im in win.items():
        im.save(os.path.join(wdir, f"icon-{n}.png"))
    big = win[256]
    big.save(
        os.path.join(OUT, "windows", "icon.ico"),
        format="ICO",
        sizes=[(n, n) for n in WIN_SIZES],
        append_images=[win[n] for n in WIN_SIZES if n != 256],
    )
    print("windows done")

    # Linux
    for n in LINUX_SIZES:
        d = os.path.join(OUT, "linux", "hicolor", f"{n}x{n}", "apps")
        os.makedirs(d, exist_ok=True)
        aperture(GNOME, n).save(os.path.join(d, f"{APP_ID}.png"))
    aperture(GNOME, 1024).save(os.path.join(OUT, "linux", "icon.png"))
    d = os.path.join(OUT, "linux", "hicolor", "scalable", "apps")
    os.makedirs(d, exist_ok=True)
    scalable(GNOME, os.path.join(d, f"{APP_ID}.svg"))
    sym = os.path.join(OUT, "linux", "hicolor", "symbolic", "apps")
    os.makedirs(sym, exist_ok=True)
    shutil.copy(os.path.join(HERE, "symbolic.svg"), os.path.join(sym, f"{APP_ID}-symbolic.svg"))
    print("linux done")


if __name__ == "__main__":
    main()
