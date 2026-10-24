"""The freestanding icon (Windows and Linux): just the telescope's aperture.

Looking down the tube: the shutter ring, the dark well, the sunburst mirror at
the bottom, and the top end (the secondary mirror in a hexagonal frame on six
vanes) in front of it.

Two styles, after each platform's app icon guidelines:
  windows  straight-on, every layer flat and facing the viewer; subtle 120-degree
           gradients, lighter at the top left; depth from Fluent's pairs of soft
           drop shadows, masked into the layer below (the ring's falls into the well)
  gnome    seen a little from above: the ring's front profile shows at the bottom
           (4px at 128) and the tube's far wall at the top of the opening; light from
           straight above, so flat surfaces are flat colours from GNOME's palette;
           only hard shadows, and only where elements need telling apart
Three levels of detail, picked per size by compose.py:
  full     three rings of tiles, the frame and vanes
  medium   two rings of tiles, the frame and vanes
  small    two chunky rings, a wider opening, just the secondary (16-32px)

  python aperture.py out.svg [--style windows|gnome] [--detail full|medium|small]

The viewBox is a square around the art; compose.py adds each platform's margins.
"""

import argparse
import math

ap = argparse.ArgumentParser()
ap.add_argument("out")
ap.add_argument("--style", choices=["windows", "gnome"], default="windows")
ap.add_argument("--detail", choices=["full", "medium", "small"], default="full")
args = ap.parse_args()
GNOME = args.style == "gnome"
DETAIL = args.detail
SMALL = DETAIL == "small"

U = 256 / 48  # one unit of Microsoft's 48px grid, for shadow sizes
CX, CY = 128.0, 128.0
R = 120.0  # shutter ring, outside
R_IN = R * (0.72 if SMALL else 0.79)  # the opening
PX = R / 59  # one pixel of GNOME's 128 canvas, where the ring is 118 across
THICK = 4 * PX if GNOME else 0.0  # the front profile


def circ(c, r, n=192):
    return [(c[0] + r * math.cos(2 * math.pi * i / n), c[1] + r * math.sin(2 * math.pi * i / n)) for i in range(n)]


def path(pts, close=True):
    d = "M" + " L".join(f"{x:.2f},{y:.2f}" for x, y in pts)
    return d + (" Z" if close else "")


def box(c, r):
    return (c[0] - r, c[1] - r, c[0] + r, c[1] + r)


# ---- svg plumbing
defs, body = [], []
_n = [0]


def uid(p):
    _n[0] += 1
    return f"{p}{_n[0]}"


def grad(stops, b, angle=120):
    """Linear gradient across box b at a CSS-style angle (120 = toward the lower right)."""
    x0, y0, x1, y1 = b
    a = math.radians(angle - 90)
    dx, dy = math.cos(a), math.sin(a)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    half = (abs(dx) * (x1 - x0) + abs(dy) * (y1 - y0)) / 2
    g = uid("g")
    s = "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in stops)
    defs.append(
        f'<linearGradient id="{g}" gradientUnits="userSpaceOnUse" x1="{cx - dx * half:.2f}" y1="{cy - dy * half:.2f}" '
        f'x2="{cx + dx * half:.2f}" y2="{cy + dy * half:.2f}">{s}</linearGradient>'
    )
    return f"url(#{g})"


def clip(*ds):
    c = uid("c")
    defs.append(f'<clipPath id="{c}">' + "".join(f'<path d="{d}"/>' for d in ds) + "</clipPath>")
    return f"url(#{c})"


def blur(sd):
    f = uid("f")
    defs.append(f'<filter id="{f}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="{sd:.2f}"/></filter>')
    return f"url(#{f})"


def shape(d, fill, extra=""):
    body.append(f'<path d="{d}" fill="{fill}"{extra}/>')


def shadow(d, onto, strength=1.0):
    """Windows: Fluent's pair of drop shadows (a tight one and a soft one, straight down).
    GNOME: one hard shadow, 2px down at 20%. Either way, masked into `onto`."""
    out = f'<g clip-path="{onto}">'
    if GNOME:
        out += f'<path d="{d}" fill="#000000" opacity="{min(1, 0.2 * strength):.3f}" transform="translate(0,{2 * PX:.2f})"/>'
    else:
        for dy, sd, op in ((0.5 * U, 0.5 * U, 0.24), (1.0 * U, 1.5 * U, 0.22)):
            out += (
                f'<path d="{d}" fill="#070a24" opacity="{min(1, op * strength):.3f}" filter="{blur(sd)}" '
                f'transform="translate(0,{dy:.2f})"/>'
            )
    body.append(out + "</g>")


def paint(flat, stops, b):
    """A flat colour (GNOME) or a 120-degree gradient (Windows)."""
    return flat if GNOME else grad(stops, b)


C = (CX, CY)
# GNOME: seen from above, the tube's far wall shows over the top of the opening, as
# deep as the front profile, so what's inside the tube is centred on what's left
DROP = THICK / 2
M = (CX, CY + DROP)

# ---- the shutter ring: its front profile (GNOME), then its face
if THICK:
    shape(path(circ((CX, CY + THICK), R)), "#c0bfbc")  # Light 4
ring_d = path(circ(C, R)) + " " + path(circ(C, R_IN)[::-1])
shape(ring_d, paint("#ffffff", [(0, "#ffffff"), (0.5, "#e4e8f1"), (1, "#b2bbce")], box(C, R)), ' fill-rule="evenodd"')

# ---- the well
hole_d = path(circ(C, R_IN))
hole_clip = clip(hole_d)
shape(hole_d, paint("#241f31", [(0, "#2a3480"), (1, "#10143a")], box(C, R_IN)))  # Dark 4

# ---- the mirror: a sunburst of tiles, each a folder; rings are nesting depth
MIRROR_R = (R_IN - DROP) * 0.93
if GNOME:  # GNOME's palette: the 4, 3 and 2 of each hue (Yellow a step darker, so it reads on white)
    HUES = {
        "blue": ["#1c71d8", "#3584e4", "#62a0ea"],
        "violet": ["#813d9c", "#9141ac", "#c061cb"],
        "pink": ["#c01c28", "#e01b24", "#f66151"],
        "orange": ["#e66100", "#ff7800", "#ffa348"],
        "amber": ["#e5a50a", "#f5c211", "#f6d32d"],
        "grey": ["#77767b", "#9a9996", "#c0bfbc"],
    }
else:
    HUES = {
        "blue": ["#1557f0", "#1f6cff", "#3285ff"],
        "violet": ["#6f3df5", "#8152fb", "#966cff"],
        "pink": ["#f2287f", "#fb4593", "#ff63a8"],
        "orange": ["#ff4f1f", "#ff6633", "#ff7f4d"],
        "amber": ["#ffa000", "#ffb000", "#ffc21f"],
        "grey": ["#5d6679", "#6f788c", "#838c9f"],
    }
TREE = [
    ("blue", 0.30, [(0.15, [(0.085, []), (0.045, [])]), (0.09, [(0.05, [])]), (0.04, [])]),
    ("violet", 0.21, [(0.12, [(0.07, []), (0.03, [])]), (0.06, [])]),
    ("pink", 0.18, [(0.10, [(0.06, [])]), (0.055, [(0.03, [])])]),
    ("orange", 0.16, [(0.09, [(0.05, []), (0.025, [])]), (0.045, [])]),
    ("amber", 0.11, [(0.065, [(0.035, [])]), (0.03, [])]),
    ("grey", 0.04, []),
]
if SMALL:  # only the two biggest folders in each
    TREE = [(h, s, ch[:2]) for h, s, ch in TREE]
RINGS = {
    "full": [(0.24, 0.49), (0.51, 0.73), (0.75, 0.97)],
    "medium": [(0.33, 0.64), (0.67, 0.97)],
    "small": [(0.30, 0.62), (0.66, 0.97)],
}[DETAIL]
GAP = {"full": 3.2, "medium": 4.4, "small": 7.0}[DETAIL]
START = math.radians(100)


def lighten(h, t):
    h = h.lstrip("#")
    c = [int(h[i : i + 2], 16) for i in (0, 2, 4)]
    return "#" + "".join(f"{round(x + (255 - x) * t):02x}" for x in c)


tiles = []


def tile(r0, r1, f0, f1, color):
    r0, r1 = r0 * MIRROR_R + GAP / 2, r1 * MIRROR_R - GAP / 2
    a0, a1 = START - 2 * math.pi * f0, START - 2 * math.pi * f1  # clockwise
    o0, o1 = math.asin(GAP / 2 / r0), math.asin(GAP / 2 / r1)  # sides parallel to the radius
    n = max(8, int(abs(a1 - a0) * r1 / 3))
    pt = lambda r, a: (M[0] + r * math.cos(a), M[1] - r * math.sin(a))
    outer = [pt(r1, a0 - o1 + (a1 + o1 - a0 + o1) * i / n) for i in range(n + 1)]
    inner = [pt(r0, a1 + o0 + (a0 - o0 - a1 - o0) * i / n) for i in range(n + 1)]
    d = path(outer + inner)
    tiles.append(d)
    # Windows: one 120° ramp across the whole mirror, so the chart reads as one surface
    shape(d, paint(color, [(0, lighten(color, 0.25)), (1, color)], box(M, MIRROR_R)))


def walk(nodes, depth, f0, hue=None):
    f = f0
    for node in nodes:
        if depth == 0:
            hue, size, kids = node
        else:
            size, kids = node
        tile(*RINGS[depth], f, f + size, HUES[hue][depth])
        if kids and depth + 1 < len(RINGS):
            walk(kids, depth + 1, f, hue)
        f += size


body.append(f'<g clip-path="{hole_clip}">')
walk(TREE, 0, 0.0)
# Windows' shadows fall only on the tiles; GNOME's hard ones fall on the well too
onto = hole_clip if GNOME else clip(*tiles)


# ---- the top end, out in front of the mirror
def hexagon(r, rot):
    return [(M[0] + r * math.cos(math.radians(rot + 60 * k)), M[1] - r * math.sin(math.radians(rot + 60 * k))) for k in range(6)]


M2_R = MIRROR_R * (0.27 if SMALL else 0.19)
if not SMALL:
    HEX_R = M2_R * 1.55
    w0, w1, band = (1.6, 0.85, 1.9) if DETAIL == "full" else (2.1, 1.1, 2.4)
    corners = hexagon(HEX_R, 90)
    parts = []
    # vanes: from the frame's corners out to the tube wall, tapering as they reach back (away from you)
    for k, c in enumerate(corners):
        a = math.radians(90 + 60 * k)
        ux, uy = math.cos(a), -math.sin(a)
        px, py = -uy, ux
        foot = (M[0] + (R_IN + 2) * ux, M[1] + (R_IN + 2) * uy)
        parts.append(path([(c[0] + px * w0, c[1] + py * w0), (foot[0] + px * w1, foot[1] + py * w1),
                           (foot[0] - px * w1, foot[1] - py * w1), (c[0] - px * w0, c[1] - py * w0)]))
    # the hexagonal frame: a band between two hexagons
    parts.append(path(hexagon(HEX_R + band, 90)) + " " + path(hexagon(HEX_R - band, 90)[::-1]))
    frame_d = " ".join(parts)
    shadow(frame_d, onto, strength=1.6 if not GNOME else 1.0)
    shape(frame_d, paint("#f6f5f4", [(0, "#ffffff"), (1, "#aab3c8")], box(C, R_IN)), ' fill-rule="nonzero"')  # Light 2
m2_d = path(hexagon(M2_R, 0))
shadow(m2_d, onto, strength=1.6 if not GNOME else 1.0)
shape(m2_d, paint("#ffffff", [(0, "#ffffff"), (1, "#c3cad9")], box(M, M2_R)))

if GNOME:
    # the tube's far wall, seen over the top of the opening (as deep as the front profile)
    wall_d = hole_d + " " + path(circ((CX, CY + THICK), R_IN)[::-1])
    shape(wall_d, "#9a9996", ' fill-rule="evenodd"')  # Light 5
body.append("</g>")

if not GNOME:
    # the ring's shadow falls into the well, past a thin lip at its inner edge
    LIP = R * 0.03
    lip_d = path(circ(C, R_IN + LIP)) + " " + path(circ(C, R_IN)[::-1])
    shadow(ring_d, hole_clip, strength=1.8)
    shape(lip_d, grad([(0, "#d5dbe6"), (1, "#7d869d")], box(C, R_IN)), ' fill-rule="evenodd"')

# ---- assemble: a square viewBox around the art (compose.py adds the margins)
x0, y0, x1, y1 = CX - R, CY - R, CX + R, CY + R + THICK
side = max(x1 - x0, y1 - y0)
vx, vy = (x0 + x1) / 2 - side / 2, (y0 + y1) / 2 - side / 2
svg = (
    f'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="{vx:.2f} {vy:.2f} {side:.2f} {side:.2f}">'
    f'<defs>{"".join(defs)}</defs>{"".join(body)}</svg>'
)
with open(args.out, "w") as fh:
    fh.write(svg)
print("wrote", args.out)
