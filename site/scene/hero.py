"""Website hero: the observatory on a mountaintop above a sea of clouds, at sunset.

The building is the app icon's (../../icon/observatory.py). This sets it on a levelled
site on the summit with a support building beside it (offices, the control room, a high
bay for the mirror coating plant, after TMT's), trucks in the yard and on the access road,
a low hill in front, cinder cones on the shoulders, old snow lying in streaks and drifts,
and a sea of clouds far below with mountain ranges rising out of it toward the horizon. The sun is setting behind the observatory, and
it and the sky are the only light, but for the building's own. Only the ground, the
buildings and the clouds are rendered: the sky is left transparent, and the clouds and the
mountains fade into it toward the horizon, because the page draws the sky (a CSS
gradient, glowing around the sun) and the turning stars (a canvas) behind this image.

  blender -b --factory-startup --python hero.py -- --out out/hero.png [--width 1280] [--samples 32]

Also writes out/hero.json: where the horizon, the sun, the buildings (a box around
them) and the pole (the point the telescope is aimed at, which the stars turn around)
fall on the image, as fractions of its size.
"""

import argparse
import json
import math
import os
import random
import sys

import bmesh
import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector, noise

HERE = os.path.dirname(os.path.abspath(__file__))
OBSERVATORY = os.path.join(HERE, "..", "..", "icon", "observatory.py")

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--width", type=int, default=1280)
ap.add_argument("--samples", type=int, default=32)
ap.add_argument("--blend", default=None, help="also save the scene as .blend")
args = ap.parse_args(argv)
ASPECT = 16 / 9

# ---- the building, as the icon builds it (everything up to the icon's own render)
src = open(OBSERVATORY).read()
END = "bpy.ops.render.render(write_still=True)"
assert END in src, "observatory.py changed: can't find where it renders"
saved_argv = sys.argv
sys.argv = [saved_argv[0], "--", "--variant", "mac", "--rising", "--samples", str(args.samples),
            "--out", os.path.join(os.path.dirname(os.path.abspath(args.out)), "_unused.png")]
icon = {"__name__": "observatory", "__file__": OBSERVATORY}
exec(compile(src.split(END)[0], OBSERVATORY, "exec"), icon)
sys.argv = saved_argv
lin = icon["lin"]
material = icon["material"]
link = icon["link"]
D = icon["D"]  # the telescope's axis, out of the aperture
C = icon["C"]  # the dome's centre

scene = bpy.context.scene
for ob in list(scene.objects):
    if ob.type in {"LIGHT", "CAMERA"}:
        bpy.data.objects.remove(ob, do_unlink=True)
building = [ob for ob in scene.objects if ob.type == "MESH"]

# ---- camera: across from the summit, a little above the dome's base, level, with the
# frame shifted up (so verticals stay vertical) to leave a big sky for the stars. Far
# enough back, and to the left, that the observatory and its support building fit in the
# right half of the frame, beside the page's text
CAM = Vector((-1.75, -12.0, 0.8))
cam_data = bpy.data.cameras.new("cam")
cam_data.sensor_width = 36
cam_data.lens = 35
cam_data.shift_y = 0.10
cam_data.clip_end = 20000
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam.location = CAM
cam.rotation_euler = (math.radians(90), 0, 0)  # level, looking along +y

# ---- turn the building so the telescope aims up and off to the left, still showing
# the mirror: its axis swung AIM_LEFT degrees left of the line to the camera
AIM_LEFT = 30
to_cam = Vector((CAM.x, CAM.y)).normalized()
want = Matrix.Rotation(math.radians(-AIM_LEFT), 2) @ to_cam
have = Vector((D.x, D.y)).normalized()
spin = math.atan2(want.y, want.x) - math.atan2(have.y, have.x)
R = Matrix.Rotation(spin, 4, "Z")
for ob in building:
    ob.matrix_world = R @ ob.matrix_world
D = Matrix.Rotation(spin, 3, "Z") @ D

# the observatory at work: a warm glow through the glazing, the mirror a little brighter
m = bpy.data.materials["interior"]
b = m.node_tree.nodes["Principled BSDF"]
b.inputs["Emission Color"].default_value = (*lin("#ffc27a"), 1)
b.inputs["Emission Strength"].default_value = 0.8
# the brick a little quieter than on the icon, as the low sun turns it orange
bpy.data.materials["drum"].node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (
    *lin("#924b3a"), 1)


# ---- haze: things far off fade toward the sky's horizon colour (near ground), or
# into the sky itself (the clouds and the far volcano), so they meet the page's sky
def hazed(m, colour, dist, into_sky=False, strength=1.0):
    nt = m.node_tree
    out = nt.nodes["Material Output"]
    surf = out.inputs["Surface"].links[0].from_socket
    camd = nt.nodes.new("ShaderNodeCameraData")
    k = nt.nodes.new("ShaderNodeMath")
    k.operation = "MULTIPLY"
    k.inputs[1].default_value = -1.0 / dist
    nt.links.new(camd.outputs["View Distance"], k.inputs[0])
    e = nt.nodes.new("ShaderNodeMath")
    e.operation = "EXPONENT"
    nt.links.new(k.outputs[0], e.inputs[0])
    fac = nt.nodes.new("ShaderNodeMath")
    fac.operation = "SUBTRACT"
    fac.inputs[0].default_value = 1.0
    nt.links.new(e.outputs[0], fac.inputs[1])
    if into_sky:
        # holdout rather than transparent: the same fade into the page's sky, but no
        # light leaking through the clouds (which sparkled like snow)
        far = nt.nodes.new("ShaderNodeHoldout")
    else:
        far = nt.nodes.new("ShaderNodeEmission")
        far.inputs["Color"].default_value = (*lin(colour), 1)
        far.inputs["Strength"].default_value = strength
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(fac.outputs[0], mix.inputs[0])
    nt.links.new(surf, mix.inputs[1])
    nt.links.new(far.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])


def bumpy(m, scale, strength, detail=8):
    """Noise bump (and a little colour variation) for ground and cloud."""
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    tc = nt.nodes.new("ShaderNodeTexCoord")
    tex = nt.nodes.new("ShaderNodeTexNoise")
    nt.links.new(tc.outputs["Object"], tex.inputs["Vector"])  # in scene units
    tex.inputs["Scale"].default_value = scale
    tex.inputs["Detail"].default_value = detail
    tex.inputs["Roughness"].default_value = 0.6
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = strength
    nt.links.new(tex.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return tex


def grid_mesh(name, xs, ys, height, mats):
    verts = [(x, y, height(x, y)) for y in ys for x in xs]
    nx = len(xs)
    faces = [(j * nx + i, j * nx + i + 1, (j + 1) * nx + i + 1, (j + 1) * nx + i)
             for j in range(len(ys) - 1) for i in range(nx - 1)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    for p in me.polygons:
        p.use_smooth = True
    for mt in mats:
        me.materials.append(mt)
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    return ob


def frange(a, b, step):
    n = int(round((b - a) / step))
    return [a + (b - a) * i / n for i in range(n + 1)]


def smoothstep(e0, e1, x):
    t = min(max((x - e0) / (e1 - e0), 0.0), 1.0)
    return t * t * (3 - 2 * t)


# noise over whole arrays of points at once (the cloud sea has about a million)
def cell_rand(ix, iy, seed, k=0):
    v = np.sin(ix * 127.1 + iy * 311.7 + seed * 74.7 + k * 19.19) * 43758.5453
    return v - np.floor(v)


def value_noise(x, y, seed):
    ix, iy = np.floor(x), np.floor(y)
    fx, fy = x - ix, y - iy
    u, v = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a, b = cell_rand(ix, iy, seed), cell_rand(ix + 1, iy, seed)
    c, d = cell_rand(ix, iy + 1, seed), cell_rand(ix + 1, iy + 1, seed)
    return 2 * ((a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v) - 1


def fbm(x, y, seed, octaves=3):
    s, amp, tot = 0.0, 1.0, 0.0
    for i in range(octaves):
        s = s + amp * value_noise(x, y, seed + 7.3 * i)
        tot += amp
        x, y, amp = 2.02 * x + 0.4 * y, 2.02 * y - 0.4 * x, amp * 0.5
    return s / tot


def puffs(x, y, cell, seed, r=0.62):
    """Round puffs, one in each of a grid of cells, jittered: (0..1 height, as a
    sphere's cap; 0..1 for each puff)."""
    gx, gy = x / cell, y / cell
    ix, iy = np.floor(gx), np.floor(gy)
    best, rand = np.full(gx.shape, 9.0), np.zeros(gx.shape)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            cx, cy = ix + dx, iy + dy
            d = np.hypot(gx - cx - cell_rand(cx, cy, seed, 1), gy - cy - cell_rand(cx, cy, seed, 2))
            m = d < best
            best, rand = np.where(m, d, best), np.where(m, cell_rand(cx, cy, seed, 3), rand)
    return np.sqrt(np.maximum(0.0, 1 - (best / r) ** 2)), rand


def smooth_max(a, b, k):
    """max(a, b), rounded off where they meet, over about k."""
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.maximum(a, b) + h * h * k * 0.25


def ease(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ---- shader nodes, briefly
def put(nt, socket, v):
    """Link a socket into `socket`, or set its value."""
    if isinstance(v, bpy.types.NodeSocket):
        nt.links.new(v, socket)
    else:
        socket.default_value = v


def math_node(nt, op, a, b=None):
    n = nt.nodes.new("ShaderNodeMath")
    n.operation = op
    for sock, v in zip(n.inputs, (a, b)):
        if v is not None:
            put(nt, sock, v)
    return n.outputs[0]


def mix_colour(nt, fac, a, b):
    n = nt.nodes.new("ShaderNodeMix")
    n.data_type = "RGBA"
    put(nt, n.inputs[0], fac)
    put(nt, n.inputs[6], a)  # the colour A and B (A and B by name are the float ones)
    put(nt, n.inputs[7], b)
    return n.outputs[2]


def eased(nt, v, at0, at1):
    """0 at `at0`, easing to 1 at `at1`."""
    n = nt.nodes.new("ShaderNodeMapRange")
    n.interpolation_type = "SMOOTHSTEP"
    put(nt, n.inputs["Value"], v)
    lo, hi = sorted((at0, at1))
    n.inputs["From Min"].default_value, n.inputs["From Max"].default_value = lo, hi
    n.inputs["To Min"].default_value, n.inputs["To Max"].default_value = (0.0, 1.0) if at0 < at1 else (1.0, 0.0)
    return n.outputs["Result"]


def attribute(nt, name):
    n = nt.nodes.new("ShaderNodeAttribute")
    n.attribute_name = name
    return n.outputs["Fac"]


def colour(hexs):
    return (*lin(hexs), 1.0)


def spaced(a, b, step0, grow):
    """a..b, finer near a: farther things need fewer vertices."""
    out = [a]
    while out[-1] < b:
        out.append(out[-1] + step0 + grow * (out[-1] - a))
    return out


# ---- the summit: a levelled site for the observatory and its support building, a low
# hill in front hiding their feet, cinder cones out on the shoulders, and the ground
# falling away to the left and behind, into the clouds
HORIZON_COL = "#f0a08f"  # the glow along the horizon, behind the clouds
CLOUD_Z = -24.0
PAD = 0.22  # the levelled site, up the drum
HILL = (-0.7, -4.8)  # the hill in front of the building, on the line to the drum
ANNEX_ANGLE = math.radians(28)  # the support building's long axis, from +x toward +y
CA, SA = math.cos(ANNEX_ANGLE), math.sin(ANNEX_ANGLE)
ROT = ((0.8, -0.6), (0.6, 0.8))


def from_annex(u, v):
    """The support building's frame (u along it, out from the drum; v across, -v toward
    the yard) to the world's."""
    return (u * CA - v * SA, u * SA + v * CA)


def to_annex(x, y):
    return (x * CA + y * SA, -x * SA + y * CA)


def eroded(x, y, octaves=6, seed=0.0):
    """Inigo Quilez's fbm, with each octave damped by the slope gathered so far
    (iquilezles.org/articles/morenoise): detail stays on the crests and the flats and
    washes off the slopes, which reads as weathering without simulating erosion."""
    a, b, dx, dy, e = 0.0, 0.5, 0.0, 0.0, 0.01
    for i in range(octaves):
        q = Vector((x, y, seed + 1.37 * i))
        n = noise.noise(q)
        gx = (noise.noise(q + Vector((e, 0, 0))) - n) / e
        gy = (noise.noise(q + Vector((0, e, 0))) - n) / e
        dx, dy = dx + gx, dy + gy
        a += b * n / (1 + dx * dx + dy * dy)
        b *= 0.5
        x, y = 2 * (ROT[0][0] * x + ROT[0][1] * y), 2 * (ROT[1][0] * x + ROT[1][1] * y)
    return a


def cone(x, y, cx, cy, r, h, rim=0.3, depth=0.35):
    """A cinder cone: concave scree flanks up to a rim, and a crater."""
    d = math.hypot(x - cx, y - cy) / r
    if d >= 1.0:
        return 0.0
    if d > rim:
        return h * smoothstep(0.0, 1.0, (1 - d) / (1 - rim))
    return h * (1 - depth * (1 - (d / rim) ** 2))


def site(x, y):
    """1 on the levelled site (the observatory, the support building and the yard in
    front of them), easing to 0 around it."""
    u, v = to_annex(x, y)
    d_annex = math.hypot(max(0.0, abs(u - 2.5) - 2.0), max(0.0, abs(v + 0.75) - 1.45))
    d = min(max(0.0, math.hypot(x, y) - 2.1), d_annex)
    return 1 - smoothstep(0.0, 2.0, d)


def ground(x, y):
    """The summit, before the road is cut into it."""
    z = -0.05 * max(0.0, -x - 3.0) ** 2  # down to the left
    z -= 0.028 * max(0.0, y - 4.5) ** 2  # and away behind
    z -= 0.012 * max(0.0, x - 7.0) ** 2  # and out to the right
    z -= 0.010 * min(0.0, y + 3.0) ** 2  # a little toward the camera
    z += cone(x, y, -13.0, 14.0, 6.0, 3.2)  # cinder cones out on the shoulders
    z += cone(x, y, -7.0, 8.0, 2.4, 1.0)
    z += cone(x, y, 8.5, 15.0, 4.0, 1.6)
    hx, hy = (x - HILL[0]) / 2.2, (y - HILL[1]) / 1.3
    z += 0.6 * math.exp(-(hx * hx + hy * hy))
    z += 0.5 * eroded(x / 4.0, y / 4.0, 6, 0.3)
    s = site(x, y)
    return z * (1 - s) + PAD * s


# ---- the road: up from the foreground over the hill's shoulder to the yard, and on past
# the building, behind the hill, out between the cinder cones on the left
def catmull(pts, step=0.1):
    P = [Vector(pts[0])] + [Vector(p) for p in pts] + [Vector(pts[-1])]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        n = max(2, int((p2 - p1).length / step))
        for k in range(n):
            t = k / n
            out.append(0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (3 * p1 - p0 - 3 * p2 + p3) * t ** 3))
    out.append(P[-1])
    return [(v.x, v.y) for v in out]


ROAD = catmull([(0.5, -13.0), (0.3, -8.5), (0.9, -5.6), (1.7, -3.6), (1.3, -2.3), (-0.6, -2.35),
                (-3.0, -2.7), (-5.6, -1.4), (-7.6, 1.5), (-9.4, 5.0), (-9.6, 9.0), (-8.0, 12.5),
                (-6.5, 17.0)])
ROAD_W = 0.17  # half its width: 7–8 m across
ROAD_EDGE = 0.3  # the cut or fill either side, eased into the ground
_seg = [math.dist(a, b) for a, b in zip(ROAD, ROAD[1:])]
road_s = np.concatenate([[0.0], np.cumsum(_seg)])
# graded: the ground along it, levelled on the site, then smoothed over ~3 units
_g = np.array([ground(x, y) * (1 - site(x, y)) + PAD * site(x, y) for x, y in ROAD])
_even = np.arange(0.0, road_s[-1], 0.05)
_k = np.ones(61) / 61
road_z = np.convolve(np.pad(np.interp(_even, road_s, _g), 30, mode="edge"), _k, mode="valid")
road_s = _even


def road_nearest(x, y):
    best, at, s0 = 1e9, 0.0, 0.0
    for (ax, ay), (bx, by), L in zip(ROAD, ROAD[1:], _seg):
        dx, dy = bx - ax, by - ay
        t = min(max(((x - ax) * dx + (y - ay) * dy) / (L * L), 0.0), 1.0)
        d = math.hypot(x - ax - t * dx, y - ay - t * dy)
        if d < best:
            best, at = d, s0 + t * L
        s0 += L
    return best, at


def height_at(x, y):
    d, s = road_nearest(x, y)
    k = 1 - smoothstep(ROAD_W, ROAD_W + ROAD_EDGE, d)
    return ground(x, y) * (1 - k) + float(np.interp(s, road_s, road_z)) * k


def axis(a, b, bands, default):
    """a..b, with the step of the first band each value falls in."""
    out = [a]
    while out[-1] < b:
        x = out[-1]
        out.append(x + next((st for lo, hi, st in bands if lo <= x < hi), default))
    return np.array(out)


xs = axis(-40.0, 30.0, [(-9.0, 6.0, 0.06), (-14.0, 10.0, 0.15)], 0.35)
ys = axis(-14.0, 40.0, [(-9.0, 3.0, 0.06), (-12.0, 20.0, 0.15)], 0.35)
X, Y = np.meshgrid(xs, ys)
G = np.array([[ground(x, y) for x in xs] for y in ys])
SITE = np.array([[site(x, y) for x in xs] for y in ys])
dist = np.full(X.shape, 1e9)
S = np.zeros(X.shape)
s0 = 0.0
for (ax, ay), (bx, by), L in zip(ROAD, ROAD[1:], _seg):
    if min(ax, bx) - 2 > xs[-1] or max(ax, bx) + 2 < xs[0]:
        s0 += L
        continue
    dx, dy = bx - ax, by - ay
    t = np.clip(((X - ax) * dx + (Y - ay) * dy) / (L * L), 0.0, 1.0)
    d = np.hypot(X - ax - t * dx, Y - ay - t * dy)
    m = d < dist
    dist = np.where(m, d, dist)
    S = np.where(m, s0 + t * L, S)
    s0 += L
tt = np.clip((dist - ROAD_W) / ROAD_EDGE, 0.0, 1.0)
K = 1 - tt * tt * (3 - 2 * tt)
Z = G * (1 - K) + np.interp(S, road_s, road_z) * K


# ---- ledges, snow and rock. Out on the left the ground steps down in ledges toward the
# clouds. Old snow lasts in the hollows and on the slopes turned from the sun (it sets
# behind the summit), in streaks and drifts, but not on the road or the yard, which are
# kept clear, nor on the ledges' cliffs, which are bare rock, as is the steepest ground.
def blurred(A, k):
    """A box blur, k cells each way (so wider out where the grid is coarser)."""
    for axis_ in (0, 1):
        c = np.cumsum(np.pad(A, [(k + 1, k) if a == axis_ else (0, 0) for a in (0, 1)], mode="edge"),
                      axis=axis_)
        A = (np.take(c, range(2 * k + 1, c.shape[axis_]), axis=axis_)
             - np.take(c, range(0, c.shape[axis_] - 2 * k - 1), axis=axis_)) / (2 * k + 1)
    return A


clear = np.maximum(1 - ease(1.3, 2.6, dist / ROAD_W), ease(0.5, 0.9, SITE))
gy, gx = np.gradient(blurred(Z, 10), ys, xs)
fall = np.arctan2(gy, gx)
# ledges: on the steeper slopes the ground steps down over old lava flows, each a bench
# under a low cliff, wandering across the contours
T = 0.28
zq = Z / T + 0.6 * fbm(X / 2.2, Y / 2.2, 8.8, 3)
f = zq - np.floor(zq)
LEDGE = (ease(0.18, 0.45, np.hypot(gx, gy)) * ease(-0.15, 0.25, fbm(X / 3.5, Y / 3.5, 4.4))
         * ease(-2.5, -4.5, X) * (1 - clear))  # out on the left, falling to the clouds
Z = Z + (ease(0.7, 0.97, f) - f) * T * LEDGE
RISER = ease(0.72, 0.8, f) * (1 - ease(0.92, 0.98, f)) * LEDGE
# the shader draws the snow in streaks down the slopes (noise stretched along the downhill
# direction, blended between four directions so it never shears: these are each vertex's
# weights for them), but in drifts along the contours on the slopes facing us, where
# streaks down them would be foreshortened to flecks, and in round patches where it's flat
facing = ease(0.5, 0.9, np.maximum(0.0, np.sin(fall)) ** 2)
lie = fall + 0.5 * math.pi * facing
tilt = ease(0.015, 0.06, np.hypot(gx, gy))
STREAKS = [np.maximum(0.0, np.cos(2 * (lie - k * math.pi / 4))) ** 2 * tilt for k in range(4)] + [1 - tilt]

gy, gx = np.gradient(Z, ys, xs)
steep = np.hypot(gx, gy)
away = gy / np.sqrt(1 + steep ** 2)  # how much the ground faces us, away from the sun
hollow = blurred(Z, 10) - Z  # above 0 in hollows, below on crests
lee = np.exp(-((X + 3.6) / 1.7) ** 2 - ((Y + 4.9) / 1.2) ** 2)  # more on the hill's left flank
SNOW = ((0.24 + 0.55 * lee + 3.0 * hollow + 0.4 * away + 0.6 * fbm(X / 3.5, Y / 3.5, 3.3, 3)
         - 1.5 * np.maximum(steep - 0.8, 0.0) - 1.2 * RISER) * (1 - clear))
ROCK = (1.2 * RISER + 0.8 * ease(0.6, 1.1, steep) + 0.25 * fbm(X / 0.6, Y / 0.6, 6.1, 3)) * (1 - clear)

ny, nx = Z.shape
verts = np.stack([X, Y, Z], -1).reshape(-1, 3)
idx = np.arange(nx * ny).reshape(ny, nx)
faces = np.stack([idx[:-1, :-1], idx[:-1, 1:], idx[1:, 1:], idx[1:, :-1]], -1).reshape(-1, 4)
me = bpy.data.meshes.new("summit")
me.from_pydata(verts.tolist(), [], faces.tolist())
me.shade_smooth()
# the road and the yard are graded gravel, and the snow and the rock: the shader reads
# these (interpolated across each face, so the edges come out smooth, finer than the mesh)
for name, val in [("road", np.minimum(dist / ROAD_W, 4.0)), ("yard", SITE), ("snow", SNOW), ("rock", ROCK)] + [
        (f"streak{k}", w) for k, w in enumerate(STREAKS)]:
    at = me.attributes.new(name, "FLOAT", "POINT")
    at.data.foreach_set("value", val.ravel().astype(np.float32))

m_ground = material("ground", "#6e4639", rough=0.95)
_nt = m_ground.node_tree
_tc = _nt.nodes.new("ShaderNodeTexCoord")
_patch = _nt.nodes.new("ShaderNodeTexNoise")
put(_nt, _patch.inputs["Vector"], _tc.outputs["Object"])
_patch.inputs["Scale"].default_value = 0.22
_patch.inputs["Detail"].default_value = 3.0
_cinder = mix_colour(_nt, _patch.outputs["Fac"], colour("#74473a"), colour("#b47a56"))
# and finer: darker scoria and paler ash, in drifts about 20 m across
_mottle = _nt.nodes.new("ShaderNodeTexNoise")
put(_nt, _mottle.inputs["Vector"], _tc.outputs["Object"])
_mottle.inputs["Scale"].default_value = 1.1
_mottle.inputs["Detail"].default_value = 4.0
_mottle.inputs["Roughness"].default_value = 0.6
_cinder = mix_colour(_nt, eased(_nt, _mottle.outputs["Fac"], 0.35, 0.65), colour("#4a2e2a"), _cinder)
_gravel = math_node(_nt, "MAXIMUM", eased(_nt, attribute(_nt, "road"), 1.0, 0.85),
                    eased(_nt, attribute(_nt, "yard"), 0.86, 0.93))
_ragged = _nt.nodes.new("ShaderNodeTexNoise")  # the patches' edges, finer than the mesh
put(_nt, _ragged.inputs["Vector"], _tc.outputs["Object"])
_ragged.inputs["Scale"].default_value = 2.0
_ragged.inputs["Detail"].default_value = 6.0
_rag = math_node(_nt, "SUBTRACT", _ragged.outputs["Fac"], 0.5)
_rock = eased(_nt, math_node(_nt, "ADD", attribute(_nt, "rock"), math_node(_nt, "MULTIPLY", _rag, 0.6)),
              0.6, 0.72)


def streaks(nt, coord, across, along):
    """Noise (0..1, about 0.5) stretched down the slopes, by the summit's streak weights."""
    total = None
    for k in range(5):
        v, size = coord, (along, across, across) if k < 4 else (2 * across,) * 3
        if k < 4:  # turn the streak's direction onto x
            rot = nt.nodes.new("ShaderNodeVectorRotate")
            rot.rotation_type = "Z_AXIS"
            put(nt, rot.inputs["Vector"], coord)
            rot.inputs["Angle"].default_value = -k * math.pi / 4
            v = rot.outputs["Vector"]
        mul = nt.nodes.new("ShaderNodeVectorMath")
        mul.operation = "MULTIPLY"
        put(nt, mul.inputs[0], v)
        mul.inputs[1].default_value = tuple(1 / d for d in size)
        n = nt.nodes.new("ShaderNodeTexNoise")
        put(nt, n.inputs["Vector"], mul.outputs["Vector"])
        n.inputs["Scale"].default_value = 1.0
        n.inputs["Detail"].default_value = 1.5
        term = math_node(nt, "MULTIPLY", n.outputs["Fac"], attribute(nt, f"streak{k}"))
        total = term if total is None else math_node(nt, "ADD", total, term)
    return total


_streak = math_node(_nt, "SUBTRACT", streaks(_nt, _tc.outputs["Object"], 0.18, 3.0), 0.5)
_snow = eased(_nt, math_node(_nt, "ADD", attribute(_nt, "snow"),
                             math_node(_nt, "ADD", math_node(_nt, "MULTIPLY", _streak, 1.8),
                                       math_node(_nt, "MULTIPLY", _rag, 0.25))),
              0.5, 0.56)
_bare = mix_colour(_nt, _rock, mix_colour(_nt, _gravel, _cinder, colour("#9a8a7f")), colour("#3b3034"))
_b = _nt.nodes["Principled BSDF"]
put(_nt, _b.inputs["Base Color"], mix_colour(_nt, _snow, _bare, colour("#eeeaf3")))
put(_nt, _b.inputs["Roughness"], math_node(_nt, "SUBTRACT", 0.95, math_node(_nt, "MULTIPLY", _snow, 0.3)))
bumpy(m_ground, 1.2, 0.35)
hazed(m_ground, "#6b5a86", 260.0)
me.materials.append(m_ground)
ob_summit = bpy.data.objects.new("summit", me)
scene.collection.objects.link(ob_summit)

# ---- the support building, as TMT plans one beside its enclosure: offices and the
# control room in a two-storey block, and a high bay for the mirror-coating plant, on a
# line out from the drum and angled back, in corrugated metal
m_wall = material("annex_wall", "#a89a8e", rough=0.5, metal=0.25)
_nt = m_wall.node_tree
_tc = _nt.nodes.new("ShaderNodeTexCoord")
_along = _nt.nodes.new("ShaderNodeVectorMath")  # distance along the building
_along.operation = "DOT_PRODUCT"
put(_nt, _along.inputs[0], _tc.outputs["Object"])
_along.inputs[1].default_value = (CA, SA, 0.0)
_ribs = _nt.nodes.new("ShaderNodeBump")  # vertical ribs, 0.035 apart (about 75 cm)
put(_nt, _ribs.inputs["Height"],
    math_node(_nt, "SINE", math_node(_nt, "MULTIPLY", _along.outputs["Value"], 2 * math.pi / 0.035)))
_ribs.inputs["Distance"].default_value = 0.0015
put(_nt, _nt.nodes["Principled BSDF"].inputs["Normal"], _ribs.outputs["Normal"])
m_trim = material("annex_trim", "#5a5150", rough=0.6)
m_door = material("annex_door", "#8b837c", rough=0.45, metal=0.3)
m_lit = material("window_lit", "#2a2420", rough=0.3, emit="#ffc27a", strength=3.0)
m_dark = material("window_dark", "#1f2233", rough=0.15, spec=0.6)
m_unit = material("plant", "#c4beb6", rough=0.5, metal=0.2)
m_beacon = material("beacon", "#ff3b2f", emit="#ff3b2f", strength=30.0)


def box(bm, u0, u1, v0, v1, z0, z1, mi=0, frame=from_annex):
    corners = [frame(u, v) for u, v in ((u0, v0), (u1, v0), (u1, v1), (u0, v1))]
    lo = [bm.verts.new((x, y, z0)) for x, y in corners]
    hi = [bm.verts.new((x, y, z1)) for x, y in corners]
    fs = [bm.faces.new(lo[::-1]), bm.faces.new(hi)]
    fs += [bm.faces.new((lo[i], lo[(i + 1) % 4], hi[(i + 1) % 4], hi[i])) for i in range(4)]
    for f in fs:
        f.material_index = mi
    return fs


bm = bmesh.new()
Z0 = PAD - 0.05
box(bm, 0.95, 2.75, -0.62, 0.62, Z0, PAD + 0.40)  # offices, the control room
box(bm, 0.93, 2.77, -0.64, 0.64, PAD + 0.40, PAD + 0.43, 1)
box(bm, 2.6, 4.0, -0.78, 0.78, Z0, PAD + 0.62)  # the high bay
box(bm, 2.58, 4.02, -0.80, 0.80, PAD + 0.62, PAD + 0.65, 1)
for u in (2.85, 3.45):  # roll-up doors onto the yard
    box(bm, u, u + 0.36, -0.79, -0.77, PAD - 0.01, PAD + 0.38, 2)
_rng = random.Random(11)
for z in (PAD + 0.09, PAD + 0.26):  # windows, two storeys of them
    u = 1.3
    while u < 2.6:
        box(bm, u, u + 0.085, -0.632, -0.618, z, z + 0.075, 3 if _rng.random() < 0.55 else 4)
        u += 0.15
box(bm, 1.45, 1.75, -0.25, 0.15, PAD + 0.43, PAD + 0.51, 5)  # plant on the roofs
box(bm, 2.05, 2.3, 0.05, 0.4, PAD + 0.43, PAD + 0.50, 5)
box(bm, 3.1, 3.5, -0.2, 0.3, PAD + 0.65, PAD + 0.73, 5)
box(bm, 3.775, 3.795, 0.45, 0.47, PAD + 0.65, PAD + 1.02, 5)  # a mast
ob_annex = link("annex", bm, [m_wall, m_trim, m_door, m_lit, m_dark, m_unit], smooth=False)
_bev = ob_annex.modifiers.new("soft", "BEVEL")
_bev.width, _bev.segments, _bev.limit_method = 0.005, 2, "ANGLE"
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=0.012,
                          matrix=Matrix.Translation((*from_annex(3.785, 0.46), PAD + 1.03)))
link("beacon", bm, [m_beacon])

# ---- trucks: a box truck backed up to the high bay, a couple of pickups, and one coming
# down the road with its lights on
m_rubber = material("rubber", "#1d1b1e", rough=0.7)
m_cab_glass = material("cab_glass", "#232733", rough=0.1, spec=0.6)
m_head = material("headlight", "#fff1d6", emit="#fff1d6", strength=40.0)
m_tail = material("taillight", "#ff2a1a", emit="#ff2a1a", strength=12.0)
m_lens = material("lamp_off", "#d9d6cf", rough=0.2)
m_tail_off = material("tail_off", "#7a2a24", rough=0.3)
m_box = material("truck_box", "#e4e1dc", rough=0.5)
PAINT = {"white": "#e9e6e1", "red": "#b8452f", "yellow": "#e0ad37", "blue": "#3f5f8f"}


def vehicle(name, x, y, heading, kind, paint, lights=False):
    """A toy truck: soft-edged boxes on four wheels, its front toward `heading` (degrees,
    from +x toward +y)."""
    bm = bmesh.new()
    local = lambda a, b: (a, b)
    part = lambda *a: box(bm, *a, frame=local)
    if kind == "pickup":
        W, r, front, back, axles = 0.09, 0.018, 0.125, -0.125, (0.08, -0.085)
        part(0.04, front, -W / 2, W / 2, r * 0.9, 0.055, 0)
        part(-0.03, 0.05, -W / 2, W / 2, r * 0.9, 0.088, 0)
        part(-0.031, 0.051, -W / 2 - 0.001, W / 2 + 0.001, 0.058, 0.082, 1)
        part(back, -0.03, -W / 2, W / 2, r * 0.9, 0.05, 0)
    elif kind == "box":
        W, r, front, back, axles = 0.105, 0.021, 0.18, -0.18, (0.14, -0.12)
        part(0.1, front, -W / 2, W / 2, r * 0.9, 0.11, 0)
        part(0.12, front + 0.001, -W / 2 - 0.001, W / 2 + 0.001, 0.07, 0.1, 1)
        part(back, 0.095, -W / 2 - 0.004, W / 2 + 0.004, r * 0.9, 0.165, 5)
    else:  # an SUV
        W, r, front, back, axles = 0.085, 0.017, 0.105, -0.105, (0.065, -0.065)
        part(back, front, -W / 2, W / 2, r * 0.9, 0.05, 0)
        part(-0.1, 0.06, -W / 2, W / 2, 0.05, 0.08, 0)
        part(-0.101, 0.061, -W / 2 - 0.001, W / 2 + 0.001, 0.053, 0.077, 1)
    for ax in axles:
        for side in (-1, 1):
            res = bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=r, radius2=r, depth=0.014,
                                        matrix=Matrix.Translation((ax, side * (W / 2 - 0.006), r))
                                        @ Matrix.Rotation(math.radians(90), 4, "X"))
            for f in {f for v in res["verts"] for f in v.link_faces}:
                f.material_index = 2
    for side in (-1, 1):
        part(front - 0.002, front + 0.002, side * (W / 2 - 0.018), side * (W / 2 - 0.006), 0.034, 0.046, 3)
        part(back - 0.002, back + 0.002, side * (W / 2 - 0.016), side * (W / 2 - 0.006), 0.036, 0.05, 4)
    z = height_at(x, y)
    bmesh.ops.transform(bm, verts=bm.verts, matrix=Matrix.Translation((x, y, z))
                        @ Matrix.Rotation(math.radians(heading), 4, "Z"))
    ob = link(name, bm, [material(name + "_paint", PAINT[paint], rough=0.35, coat=0.5),
                         m_cab_glass, m_rubber, m_head if lights else m_lens,
                         m_tail if lights else m_tail_off, m_box], smooth=False)
    bev = ob.modifiers.new("soft", "BEVEL")
    bev.width, bev.segments, bev.limit_method = 0.004, 2, "ANGLE"
    if lights:  # a pool of light on the road ahead
        ld = bpy.data.lights.new(name + "_beams", "SPOT")
        ld.energy, ld.color, ld.spot_size, ld.spot_blend = 0.6, lin("#ffe2b0"), math.radians(70), 0.6
        lo = bpy.data.objects.new(name + "_beams", ld)
        scene.collection.objects.link(lo)
        h = math.radians(heading)
        lo.location = (x + 0.13 * math.cos(h), y + 0.13 * math.sin(h), z + 0.045)
        lo.rotation_euler = (math.radians(80), 0, h - math.radians(90))
    return ob


_down = math.degrees(math.atan2(-math.cos(ANNEX_ANGLE), math.sin(ANNEX_ANGLE)))  # -v, out onto the yard
vehicle("box_truck", *from_annex(3.03, -0.99), _down, "box", "red")
vehicle("pickup_yard", *from_annex(3.8, -1.12), _down + 20, "pickup", "white")
vehicle("suv", *from_annex(1.85, -0.86), math.degrees(ANNEX_ANGLE), "suv", "blue")
_i = min(range(len(ROAD)), key=lambda i: math.dist(ROAD[i], (1.1, -4.9)))
(_x0, _y0), (_x1, _y1) = ROAD[_i], ROAD[_i + 3]
vehicle("pickup_road", _x0 - 0.06 * (_y1 - _y0) / math.dist(ROAD[_i], ROAD[_i + 3]),
        _y0 + 0.06 * (_x1 - _x0) / math.dist(ROAD[_i], ROAD[_i + 3]),
        math.degrees(math.atan2(_y0 - _y1, _x0 - _x1)), "pickup", "yellow", lights=True)

# ---- the sea of clouds: billows heaping up into banks here and there, with a few holes
# down to the dark land below; a flat deck beyond; all fading into the sky toward the
# horizon
m_cloud = material("cloud", "#ffffff", rough=1.0)
_b = m_cloud.node_tree.nodes["Principled BSDF"]
_b.inputs["Subsurface Weight"].default_value = 0.5
_b.inputs["Subsurface Radius"].default_value = (1.0, 0.85, 0.8)
_b.inputs["Subsurface Scale"].default_value = 1.5  # less than the lumps, or it smooths them away
_b.inputs["Specular IOR Level"].default_value = 0.0
_b.subsurface_method = "BURLEY"  # smoother than random walk, and no sparkle
# a silver lining where they're lit from behind, at the edges
_b.inputs["Sheen Weight"].default_value = 0.6
_b.inputs["Sheen Roughness"].default_value = 0.35
_b.inputs["Sheen Tint"].default_value = colour("#ffd2b0")
bumpy(m_cloud, 0.12, 0.12, detail=2)
# and a finer texture on that, so the tops look soft and fluffy rather than smooth as satin
_nt = m_cloud.node_tree
_fine = _nt.nodes.new("ShaderNodeTexNoise")
put(_nt, _fine.inputs["Vector"], _nt.nodes["Texture Coordinate"].outputs["Object"])
_fine.inputs["Scale"].default_value = 0.6
_fine.inputs["Detail"].default_value = 4.0
_fine.inputs["Roughness"].default_value = 0.55
_bump2 = _nt.nodes.new("ShaderNodeBump")
_bump2.inputs["Strength"].default_value = 0.5
put(_nt, _bump2.inputs["Height"], _fine.outputs["Fac"])
put(_nt, _bump2.inputs["Normal"], _nt.nodes["Bump"].outputs["Normal"])
put(_nt, _b.inputs["Normal"], _bump2.outputs["Normal"])
# greyer down the holes' walls, as less light gets down there
put(_nt, _b.inputs["Base Color"], mix_colour(_nt, attribute(_nt, "deep"), colour("#ffffff"), colour("#6f6a8c")))
hazed(m_cloud, None, 2400.0, into_sky=True)
CX0, CX1, CY0, CY1 = -900, 800, -20, 1800
DECK = CLOUD_Z - 0.6  # the flat deck beyond the billows
# holes in the clouds, toward the back, down to the land below (x, y, and half their size
# across and along the line of sight). We look across them nearly edge on, from not far
# above, so they're long along it, the cloud thins toward each to let the land show over
# its near rim, and it heaps up on the far side, in a wall facing us, in shade as it
# faces away from the sun.
HOLES = [(-175, 450, 32, 140), (-20, 880, 42, 180)]
FLOOR = DECK - 4.0  # the land in the holes, just under the thin cloud at their rims


def holes(x, y):
    """1 in the middle of a hole, falling to 0 at its edge, which wanders and is scalloped,
    and on below 0 outside it; and how far toward its far side each point is (0 to 1)."""
    g, far = np.full_like(x, -1.0), np.zeros_like(x)
    for cx, cy, rx, ry in HOLES:
        ax, ay = cx - CAM.x, cy - CAM.y
        ax, ay = ax / math.hypot(ax, ay), ay / math.hypot(ax, ay)
        u = ((x - cx) * ax + (y - cy) * ay) / ry  # along the line of sight
        v = ((y - cy) * ax - (x - cx) * ay) / rx  # and across it
        d = (np.hypot(u, v) * (1 + 0.3 * fbm(x / 35, y / 35, cx, 3))
             + 0.05 * fbm(x / 18, y / 18, cy, 2))
        far = np.where(1 - d > g, ease(-0.4, 0.5, u), far)
        g = np.maximum(g, 1 - d)
    return g, far


def billows(x, y):
    """The cloud sea's top: big low domes, middling puffs riding on them, and small ones
    on those near the camera, each layer merging smoothly into the one below, so they
    meet in soft creases, as cauliflower. In places the deck heaps up into banks, with
    bigger puffs on them, and at the holes it falls away in walls."""
    edge = np.minimum.reduce([ease(CX0, CX0 + 200, x), 1 - ease(CX1 - 200, CX1, x),
                              ease(CY0, CY0 + 40, y), 1 - ease(CY1 - 400, CY1, y)])
    mass = 0.5 + 0.5 * fbm(x / 300, y / 300, 0.7)  # where the deck is thicker
    bank = ease(0.12, 0.32, fbm(x / 230, y / 230, 2.9, 3))  # and heaps up
    hole, far = holes(x, y)
    # warped, so the puffs don't line up in rows
    x, y = x + 10 * fbm(x / 45, y / 45, 5.1, 2), y + 10 * fbm(x / 45, y / 45, 9.4, 2)
    d, rd = puffs(x, y, 32, 8.1, 0.75)  # the banks' tops, heaped in rounded heads
    lift = bank * (10.0 + 6.0 * d * (0.5 + rd)) + 2.5 * fbm(x / 500, y / 500, 6.6, 2)
    a, ra = puffs(x, y, 70, 0.3)
    z = a * (4.0 + 7.0 * ra) * mass
    b, rb = puffs(x, y, 24, 1.7)
    z = smooth_max(z, 0.8 * z + b * (2.0 + 2.8 * rb) * (0.4 + mass), 2.0)
    e, re = puffs(x, y, 13, 3.3)
    lift = smooth_max(lift, 0.9 * lift + e * (1.5 + 2.5 * re) * bank, 1.2)
    # the small ones only near the camera: farther off they'd be finer than the mesh
    near = 1 - ease(220, 420, np.hypot(x - CAM.x, y - CAM.y))
    c, rc = puffs(x, y, 8, 4.2)
    z = smooth_max(z, 0.85 * z + c * (0.9 + 1.2 * rc) * near * (0.3 + mass), 0.8)
    # toward a hole the cloud thins on the near side, to a rim of small puffs, and heaps
    # up on the far side; at the edge it falls to the land
    by = ease(-0.4, -0.02, hole)
    f, rf = puffs(x, y, 10, 6.2)
    z = ((z + lift) * (1 - 0.9 * by * (1 - far)) + by * (1 - far) * f * (1.0 + 1.5 * rf)
         + by * far * (1.5 + 2.5 * d))
    z = z + (FLOOR - DECK + 1.6 - z) * ease(0.0, 0.22, hole)
    return DECK + (z - 2.4) * edge


def cut(x, y):
    """Where the billows are cut away, at the bottoms of the holes."""
    return holes(x, y)[0] > 0.22


def grid_np(name, xs, ys, z, mats, cut=None):
    """A grid mesh from arrays (z over ys by xs), built without a Python loop, less the
    squares with any corner where `cut` is true."""
    X, Y = np.meshgrid(xs, ys)
    Z = z(X, Y)
    ny, nx = Z.shape
    me = bpy.data.meshes.new(name)
    me.vertices.add(nx * ny)
    me.vertices.foreach_set("co", np.stack([X, Y, Z], -1).astype(np.float32).ravel())
    idx = np.arange(nx * ny, dtype=np.int32).reshape(ny, nx)
    quads = np.stack([idx[:-1, :-1], idx[:-1, 1:], idx[1:, 1:], idx[1:, :-1]], -1).reshape(-1, 4)
    if cut is not None:
        quads = quads[~cut(X, Y).ravel()[quads].any(axis=1)]
    quads = quads.ravel()
    nq = len(quads) // 4
    me.loops.add(4 * nq)
    me.loops.foreach_set("vertex_index", quads)
    me.polygons.add(nq)
    me.polygons.foreach_set("loop_start", np.arange(0, 4 * nq, 4, dtype=np.int32))
    me.update(calc_edges=True)
    me.shade_smooth()
    for mt in mats:
        me.materials.append(mt)
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    return ob


# fine where the near clouds are (left of the summit), and around the heap behind it
_xs = axis(CX0, CX1, [(-260, 20, 0.5), (-420, 160, 0.8)], 3.0)
_ys = spaced(CY0, CY1, 0.5, 0.004)
_ob = grid_np("billows", _xs, _ys, billows, [m_cloud], cut)
_co = np.empty(3 * len(_ob.data.vertices), np.float32)
_ob.data.vertices.foreach_get("co", _co)
_deep = (1 - ease(FLOOR, DECK + 4.0, _co[2::3])) * ease(-0.35, -0.05, holes(*np.meshgrid(_xs, _ys))[0].ravel())
_ob.data.attributes.new("deep", "FLOAT", "POINT").data.foreach_set("value", _deep.astype(np.float32).ravel())
# the deck, out from the billows' edges (which come down to it) to the horizon
bm = bmesh.new()
outer = [bm.verts.new((x, y, DECK)) for x, y in ((-9000, -9000), (9000, -9000), (9000, 9000), (-9000, 9000))]
inner = [bm.verts.new((x, y, DECK)) for x, y in ((CX0, CY0), (CX1, CY0), (CX1, CY1), (CX0, CY1))]
for i in range(4):
    j = (i + 1) % 4
    bm.faces.new((outer[i], outer[j], inner[j], inner[i]))
link("cloud_deck", bm, [m_cloud], smooth=True)

# the land under the clouds, seen through the gaps: dark, in the clouds' shade, with the
# lights of a few towns coming on
m_lowland = material("lowland", "#2e2a30", rough=1.0)
_nt = m_lowland.node_tree
_tc = _nt.nodes.new("ShaderNodeTexCoord")
_fields = _nt.nodes.new("ShaderNodeTexNoise")
put(_nt, _fields.inputs["Vector"], _tc.outputs["Object"])
_fields.inputs["Scale"].default_value = 0.04
_fields.inputs["Detail"].default_value = 5.0
_b = _nt.nodes["Principled BSDF"]
put(_nt, _b.inputs["Base Color"], mix_colour(_nt, eased(_nt, _fields.outputs["Fac"], 0.35, 0.65),
                                             colour("#1b1519"), colour("#33272a")))
_lamps = _nt.nodes.new("ShaderNodeTexVoronoi")  # one lamp in each cell, in some
put(_nt, _lamps.inputs["Vector"], _tc.outputs["Object"])
_lamps.inputs["Scale"].default_value = 0.15
_towns = _nt.nodes.new("ShaderNodeTexNoise")  # where the towns are
put(_nt, _towns.inputs["Vector"], _tc.outputs["Object"])
_towns.inputs["Scale"].default_value = 0.025
_sep = _nt.nodes.new("ShaderNodeSeparateColor")
put(_nt, _sep.inputs["Color"], _lamps.outputs["Color"])
_lit = math_node(_nt, "MULTIPLY", eased(_nt, _lamps.outputs["Distance"], 0.1, 0.06),
                 math_node(_nt, "MULTIPLY", eased(_nt, _sep.outputs["Red"], 0.5, 0.6),
                           eased(_nt, _towns.outputs["Fac"], 0.5, 0.6)))
_b.inputs["Emission Color"].default_value = colour("#ffb066")
put(_nt, _b.inputs["Emission Strength"], math_node(_nt, "MULTIPLY", _lit, 8.0))
bumpy(m_lowland, 0.05, 0.4)
hazed(m_lowland, "#3b3150", 900.0)
grid_np("lowland", np.arange(CX0, CX1 + 1, 4.0), np.arange(CY0, CY1 + 1, 4.0),
        lambda x, y: FLOOR - 1.0 + 1.6 * np.abs(fbm(x / 45, y / 45, 1.9, 4)), [m_lowland],
        lambda x, y: holes(x, y)[0] < -0.8)


# ---- a cumulus heap rising out of the cloud sea behind the building: a few big lobes,
# middling puffs on their surfaces, and small ones on theirs, so its outline is
# cauliflower rather than balloons. Metaballs, so the puffs melt into each other.
def heap(name, centre, lobes, seed, n_mid=110, n_small=320):
    """`lobes`: (x, y, z, radius) for each big lobe, from the heap's foot."""
    rng = random.Random(seed)
    mb = bpy.data.metaballs.new(name)
    mb.resolution = 2.0
    mb.render_resolution = min(r for *_, r in lobes) / 24
    mb.threshold = 0.6
    SHOWS = 0.67  # how much of an element's radius shows, alone, at this threshold

    def puff(p, r):
        el = mb.elements.new()
        el.co, el.radius = p, r

    def on_surface(balls, k, up):
        """A point on the surface of the union of `balls` (centre, shown radius), not
        inside any other, mostly on their upper sides (`up`), and the ball it's on."""
        for _ in range(200):
            c, r = rng.choice(balls)
            d = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1))).normalized()
            if d.z < -0.2 or rng.random() > (1 - up) + up * max(d.z, 0.0):
                continue
            p = c + d * r
            if all((p - c2).length >= r2 * k for c2, r2 in balls if c2 is not c):
                return p, r
        return None

    big = [(Vector(c[:3]), c[3] * SHOWS) for c in lobes]
    for c, r in big:
        puff(c, r / SHOWS)
    mid = []
    for _ in range(n_mid):
        hit = on_surface(big, 0.98, 0.5)
        if hit:
            r = hit[1] * rng.uniform(0.22, 0.34)
            mid.append((hit[0], r))
            puff(hit[0], r / SHOWS)
    for _ in range(n_small):
        hit = on_surface(mid, 0.9, 0.7)
        if hit:
            puff(hit[0], hit[1] * rng.uniform(0.35, 0.5) / SHOWS)
    ob = bpy.data.objects.new(name, mb)
    ob.location = (centre[0], centre[1], CLOUD_Z - 4)
    scene.collection.objects.link(ob)
    mb.materials.append(m_cloud)
    return ob


heap("heapBehind", (80, 260), [(-20, 0, 8, 21), (6, 6, 14, 24), (28, 3, 7, 18), (48, -3, 3, 13),
                               (-3, 8, 34, 15), (14, 11, 42, 11), (-36, -3, 1, 13)], 3)
# and others farther off: one against the near range, one off to the right
heap("heapRange", (-122, 800), [(-32, 0, 6, 22), (-6, 6, 12, 28), (22, 2, 8, 22), (44, -4, 3, 15),
                                (-20, 6, 20, 20), (6, 8, 27, 20), (-6, 10, 37, 14), (-50, -2, 1, 14)],
     7, n_small=240)
heap("heapRight", (300, 640), [(-15, 0, 6, 16), (5, 4, 12, 20), (24, 2, 6, 14), (2, 6, 26, 12),
                               (-20, 2, 16, 10)], 11, n_small=220)

# ---- mountains on the horizon: a range off to the left rising out of the clouds, its
# crest running away from us, a paler one beyond it, and a far range along the horizon,
# each paler than the one before as they fade into the sky
MOUNTAIN_BASE = CLOUD_Z - 18  # under the land below the clouds


def ridged(x, y, z, octaves=5):
    """Noise with sharp crests: 1 along them, falling to 0 between."""
    s, amp, tot = 0.0, 1.0, 0.0
    for i in range(octaves):
        n = 1 - abs(noise.noise(Vector((x, y, z + 3.7 * i))))
        s += amp * n * n
        tot += amp
        x, y = 2.03 * x + 0.31 * y, 2.03 * y - 0.31 * x
        amp *= 0.5
    return s / tot


class Range:
    """A mountain range along a crest line (x, y, and the crest's height above the
    cloud tops at each point): peaks and cols along the crest, spurs running down the
    flanks with gullies between them, and flanks that steepen toward the crest."""

    def __init__(self, crest, width, seed):
        self.pts = [Vector((x, y)) for x, y, _ in crest]
        self.h = [CLOUD_Z + h - MOUNTAIN_BASE for *_, h in crest]
        self.width, self.seed = width, seed
        self.seg = [(b - a).length for a, b in zip(self.pts, self.pts[1:])]
        xs = [p.x for p in self.pts]
        ys = [p.y for p in self.pts]
        self.box = (min(xs) - width, max(xs) + width, min(ys) - width, max(ys) + width)

    def height(self, x, y):
        p = Vector((x, y))
        best, u, h, s0 = 1e9, 0.0, 0.0, 0.0
        for i, (a, b, L) in enumerate(zip(self.pts, self.pts[1:], self.seg)):
            t = min(max((p - a).dot(b - a) / (L * L), 0.0), 1.0)
            d = (p - a - t * (b - a)).length
            if d < best:
                best, u, h = d, s0 + t * L, self.h[i] + t * (self.h[i + 1] - self.h[i])
            s0 += L
        # the crest wanders off the line a little, and the range is wider in places
        d = best + 0.25 * self.width * noise.noise(Vector((u / 160, self.seed, 0.5)))
        w = self.width * (0.85 + 0.3 * noise.noise(Vector((u / 220, self.seed, 1.5))))
        s = abs(d) / w
        if s >= 1.0:
            return 0.0
        crest = h * (0.62 + 0.5 * ridged(u / 70, self.seed, 2.5, 3))  # peaks and cols
        # spurs down the flanks, unevenly spaced (the ridges' line along the crest wanders)
        uw = u + 30 * noise.noise(Vector((u / 90, abs(d) / 120, self.seed + 9.0)))
        spurs = ridged(uw / 34, abs(d) / 150, self.seed + 4.0, 4)
        body = crest * (1 - s) ** 1.35
        gully = (1 - spurs) * math.sin(math.pi * min(1.0, 1.25 * s))
        return body * (1 - 0.42 * gully)


RANGES = [
    Range([(-345, 470, 8), (-300, 560, 44), (-262, 700, 38), (-212, 900, 33), (-150, 1120, 26),
           (-100, 1300, 10)], 120, 1.3),
    Range([(-640, 1150, 12), (-520, 1260, 50), (-400, 1420, 44), (-300, 1560, 30), (-230, 1680, 8)],
          200, 7.9),
]


def range_mesh(name, rg):
    """A grid over the range, about as fine as a few pixels at its distance."""
    x0, x1, y0, y1 = rg.box
    step = max(1.5, (y0 - CAM.y) / 320)
    base = MOUNTAIN_BASE
    return grid_mesh(name, frange(x0, x1, step), spaced(y0, y1, step, 0.0025),
                     lambda x, y: base + rg.height(x, y), [m_peak])


def mountains(x, y):
    base = MOUNTAIN_BASE
    z = base
    band = smoothstep(1300, 1600, y) * (1 - smoothstep(2100, 2400, y))
    if band > 0:  # the far range
        rr = noise.ridged_multi_fractal(Vector((x / 300, y / 300, 2.3)), 1.0, 2.1, 6, 1.0, 2.0)
        lift = 0.5 + 0.5 * noise.noise(Vector((x / 1400, 0.5, 7.7)))
        z = max(z, base + band * (16 + rr * 34 * lift))
    return z


# snow on the heights, on all but the steepest faces, in streaks down them
m_peak = material("peak", "#a8939f", rough=0.9)
_nt = m_peak.node_tree
_geo = _nt.nodes.new("ShaderNodeNewGeometry")
_n = _nt.nodes.new("ShaderNodeSeparateXYZ")
put(_nt, _n.inputs[0], _geo.outputs["Normal"])
_p = _nt.nodes.new("ShaderNodeSeparateXYZ")
put(_nt, _p.inputs[0], _geo.outputs["Position"])
_map = _nt.nodes.new("ShaderNodeMapping")
put(_nt, _map.inputs["Vector"], _geo.outputs["Position"])
_map.inputs["Scale"].default_value = (1 / 6, 1 / 6, 1 / 24)
_streak = _nt.nodes.new("ShaderNodeTexNoise")
put(_nt, _streak.inputs["Vector"], _map.outputs["Vector"])
_streak.inputs["Detail"].default_value = 4.0
_snow = math_node(_nt, "ADD",
                  math_node(_nt, "MULTIPLY", eased(_nt, _n.outputs["Z"], 0.62, 0.88),
                            eased(_nt, _p.outputs["Z"], CLOUD_Z + 4, CLOUD_Z + 18)),
                  math_node(_nt, "MULTIPLY", math_node(_nt, "SUBTRACT", _streak.outputs["Fac"], 0.5), 1.4))
put(_nt, _nt.nodes["Principled BSDF"].inputs["Base Color"],
    mix_colour(_nt, eased(_nt, _snow, 0.42, 0.52), colour("#a8939f"), colour("#f2ecf3")))
bumpy(m_peak, 0.08, 0.5)
hazed(m_peak, None, 1600.0, into_sky=True)
grid_mesh("mountains", frange(-2500, 1600, 8), spaced(1250, 2500, 4, 0.002), mountains, [m_peak])
for i, rg in enumerate(RANGES):
    range_mesh(f"range{i}", rg)


# ---- light: the sun, setting behind the dome (its lower right, so the dome hides it and
# only its glow shows around it on the page), and the dusk sky, brighter around the sun as
# the haze scatters its light
def direction(az, el):
    """az: degrees from +y (straight ahead) toward -x (left); el: degrees up."""
    a, e = math.radians(az), math.radians(el)
    return Vector((-math.sin(a) * math.cos(e), math.cos(a) * math.cos(e), math.sin(e)))


SUN = direction(-9.1, 2.55)
world = scene.world
nt = world.node_tree
ramp = next(n for n in nt.nodes if n.type == "VALTORGB")
bg = next(n for n in nt.nodes if n.type == "BACKGROUND")
tc = next(n for n in nt.nodes if n.type == "TEX_COORD")
els = ramp.color_ramp.elements
while len(els) > 1:
    els.remove(els[-1])
stops = [(0.0, "#1a1622"), (0.495, "#4a3550"), (0.5, HORIZON_COL), (0.53, "#a76f9e"),
         (0.62, "#5b4a9a"), (0.8, "#25296d"), (1.0, "#12153f")]
els[0].position, els[0].color = stops[0][0], (*lin(stops[0][1]), 1)
for pos, col in stops[1:]:
    e = els.new(pos)
    e.color = (*lin(col), 1)
# the glow: a wide lobe around the sun and a tight one, added to the ramp's colour
toward = nt.nodes.new("ShaderNodeVectorMath")
toward.operation = "DOT_PRODUCT"
put(nt, toward.inputs[0], tc.outputs["Generated"])
toward.inputs[1].default_value = SUN
near = math_node(nt, "MAXIMUM", toward.outputs["Value"], 0.0)
glow = math_node(nt, "ADD", math_node(nt, "MULTIPLY", math_node(nt, "POWER", near, 6.0), 0.9),
                 math_node(nt, "MULTIPLY", math_node(nt, "POWER", near, 80.0), 4.0))
tint = nt.nodes.new("ShaderNodeVectorMath")
tint.operation = "SCALE"
tint.inputs[0].default_value = lin("#ff9a5c")
put(nt, tint.inputs["Scale"], glow)
sky = nt.nodes.new("ShaderNodeVectorMath")
sky.operation = "ADD"
put(nt, sky.inputs[0], ramp.outputs["Color"])
put(nt, sky.inputs[1], tint.outputs["Vector"])
put(nt, bg.inputs["Color"], sky.outputs["Vector"])
bg.inputs["Strength"].default_value = 1.4

ld = bpy.data.lights.new("sun", "SUN")
ld.energy = 4.0
ld.color = lin("#ffb27a")
ld.angle = math.radians(2.5)
ob = bpy.data.objects.new("sun", ld)
scene.collection.objects.link(ob)
ob.rotation_euler = (-SUN).to_track_quat("-Z", "Y").to_euler()

# ---- render
W = args.width
scene.render.resolution_x = W
scene.render.resolution_y = round(W / ASPECT)
scene.render.resolution_percentage = 100
scene.cycles.samples = args.samples
scene.cycles.sample_clamp_indirect = 3.0  # no fireflies off the clouds
scene.cycles.sample_clamp_direct = 8.0
scene.render.film_transparent = True
scene.render.filepath = os.path.abspath(args.out)
if args.blend:
    bpy.ops.wm.save_as_mainfile(filepath=args.blend)
bpy.ops.render.render(write_still=True)


# ---- where things land on the image (x right, y down, as fractions)
def on_image(p):
    q = world_to_camera_view(scene, cam, p)
    return [q.x, 1 - q.y]


horizon = on_image(CAM + Vector((0, 1e5, 0)))[1]
# the pole: along the telescope's axis as it appears on the image, up to near the top
apc = C + 1.1 * D
a0 = Vector(on_image(apc))
a1 = Vector(on_image(apc + 0.3 * D))
d = (a1 - a0).normalized()
POLE_Y = 0.16
pole = a0 + d * ((POLE_Y - a0.y) / d.y)
# a box around the buildings, for the layout to keep the text off them
pts = [on_image(ob.matrix_world @ Vector(c)) for ob in building + [ob_annex]
       if "below" not in ob.name for c in ob.bound_box]
box_ = [max(0.0, min(p[0] for p in pts)), max(0.0, min(p[1] for p in pts)),
        min(1.0, max(p[0] for p in pts)), min(1.0, max(p[1] for p in pts))]
meta = {"width": W, "height": scene.render.resolution_y, "horizon": horizon,
        "pole": [pole.x, pole.y], "aperture": [a0.x, a0.y], "sun": on_image(CAM + 1e5 * SUN),
        "building": box_}
with open(os.path.splitext(args.out)[0] + ".json", "w") as fh:
    json.dump(meta, fh, indent=1)
print("meta", meta)
