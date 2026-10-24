"""Website hero: the observatory on a mountaintop above a sea of clouds, at sunset.

The building is the app icon's (../../icon/observatory.py). This sets it on a levelled
site on the summit with a support building beside it (offices, the control room, a high
bay for the mirror coating plant, after TMT's), trucks in the yard and on the access road,
a low hill in front, cinder cones on the shoulders, and a sea of clouds far below with
mountains rising out of it on the horizon. The sun is setting behind the observatory, and
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


xs = axis(-40.0, 30.0, [(-5.0, 6.0, 0.06), (-14.0, 10.0, 0.15)], 0.35)
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

ny, nx = Z.shape
verts = np.stack([X, Y, Z], -1).reshape(-1, 3)
idx = np.arange(nx * ny).reshape(ny, nx)
faces = np.stack([idx[:-1, :-1], idx[:-1, 1:], idx[1:, 1:], idx[1:, :-1]], -1).reshape(-1, 4)
me = bpy.data.meshes.new("summit")
me.from_pydata(verts.tolist(), [], faces.tolist())
me.shade_smooth()
# the road and the yard are graded gravel: the shader reads these (interpolated across
# each face, so the edges come out smooth, finer than the mesh)
for name, val in (("road", np.minimum(dist / ROAD_W, 4.0)), ("yard", SITE)):
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
_gravel = math_node(_nt, "MAXIMUM", eased(_nt, attribute(_nt, "road"), 1.0, 0.85),
                    eased(_nt, attribute(_nt, "yard"), 0.86, 0.93))
put(_nt, _nt.nodes["Principled BSDF"].inputs["Base Color"],
    mix_colour(_nt, _gravel, _cinder, colour("#9a8a7f")))
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

# ---- the sea of clouds: billows near, a flat deck beyond, both fading into the
# sky toward the horizon
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
hazed(m_cloud, None, 2400.0, into_sky=True)
CX0, CX1, CY0, CY1 = -900, 800, -20, 1800


def puffs(x, y, cell, seed, r=0.62):
    """Round puffs, one per voronoi cell: (0..1 height, as a sphere's cap; 0..1 per puff)."""
    ds, ps = noise.voronoi(Vector((x / cell, y / cell, seed)))
    q = ps[0]
    rand = (math.sin(q.x * 12.9898 + q.y * 78.233 + q.z * 37.719) * 43758.5453) % 1.0
    return math.sqrt(max(0.0, 1 - (ds[0] / r) ** 2)), rand


def billows(x, y):
    """Cumulus tops: big round puffs, middling ones riding on them, and small ones on
    those near the camera. Each layer is taken where it rises above the one below, so
    the puffs meet in creases, as cauliflower."""
    edge = min(smoothstep(CX0, CX0 + 200, x), 1 - smoothstep(CX1 - 200, CX1, x),
               smoothstep(CY0, CY0 + 40, y), 1 - smoothstep(CY1 - 400, CY1, y))
    mass = 0.5 + 0.5 * noise.fractal(Vector((x / 300, y / 300, 0.7)), 0.5, 2.0, 3)
    a, ra = puffs(x, y, 70, 0.3)
    z = a * (8 + 14 * ra) * mass
    b, rb = puffs(x, y, 24, 1.7)
    z = max(z, 0.8 * z + b * (3 + 4 * rb) * (0.4 + mass))
    # the small ones only near the camera: farther off they'd be finer than the mesh
    near = 1 - smoothstep(200, 380, math.hypot(x - CAM.x, y - CAM.y))
    if near > 0:
        c, rc = puffs(x, y, 8, 4.2)
        z = max(z, 0.85 * z + c * (1.2 + 1.6 * rc) * near * (0.3 + mass))
    return CLOUD_Z - 6.0 + z * edge


def spaced_x():
    """CX0..CX1, fine where the near lumps are (left of the summit), coarse beyond."""
    out = [CX0]
    while out[-1] < CX1:
        x = out[-1]
        out.append(x + (0.8 if -420 < x < 60 else 3.0))
    return out


grid_mesh("billows", spaced_x(), spaced(CY0, CY1, 0.8, 0.006), billows, [m_cloud])
bm = bmesh.new()
bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=9000)
for v in bm.verts:
    v.co.z = CLOUD_Z - 0.6
link("cloud_deck", bm, [m_cloud], smooth=True)

# ---- cumulus heaps rising out of the cloud sea: one behind the building, a couple
# out on the left. Metaballs, so the puffs melt into each other.
def heap(name, centre, spread, height, seed, n=220, rmin=0.06, rmax=0.16):
    rng = random.Random(seed)
    mb = bpy.data.metaballs.new(name)
    mb.resolution = 2.0
    mb.render_resolution = max(0.4, spread / 90)
    mb.threshold = 0.6
    for i in range(n):
        k = (i / n) ** 0.8  # more puffs low down, fewer up the tower
        reach = spread * (1 - 0.75 * k) * math.sqrt(rng.random())
        a = rng.uniform(0, 2 * math.pi)
        el = mb.elements.new()
        el.co = (reach * math.cos(a), reach * math.sin(a) * 0.7, height * k + rng.uniform(-0.05, 0.05) * height)
        el.radius = spread * rng.uniform(rmin, rmax) * (1 - 0.35 * k)
    ob = bpy.data.objects.new(name, mb)
    ob.location = (centre[0], centre[1], CLOUD_Z - 8)
    scene.collection.objects.link(ob)
    mb.materials.append(m_cloud)
    return ob


heap("heapBehind", (80, 260), 85, 44, 3)
heap("heapLeft", (-130, 330), 60, 30, 5)
heap("heapFar", (-330, 760), 150, 55, 8, n=300)

# ---- mountains on the horizon: peaks off to the left rising out of the clouds, a far
# range along the horizon, and a broad shield volcano beyond the building, all fading
# into the sky
PEAKS = [(-150, 600, 100, 30.0), (-265, 790, 140, 40.0), (-95, 830, 80, 24.0), (-420, 1120, 220, 52.0)]


def volcano(x, y, cx, cy, R, h, seed):
    """A peak with concave flanks, cut by gullies running down it."""
    dx, dy = x - cx, y - cy
    r = math.hypot(dx, dy) / R
    if r >= 1.0:
        return 0.0
    a = math.atan2(dy, dx)
    ring = Vector((5 * math.cos(a), 5 * math.sin(a), 2.0 * r + seed))
    gully = abs(noise.noise(ring))  # 0 along a gully's floor
    prof = (1 - r) ** 1.7
    return h * prof * (1 - 0.35 * (1 - gully) * math.sin(math.pi * min(1.0, 1.4 * r)))


def mountains(x, y):
    base = CLOUD_Z - 10
    z = base
    for i, (cx, cy, R, h) in enumerate(PEAKS):
        z = max(z, base + volcano(x, y, cx, cy, R, CLOUD_Z + h - base, 3.1 * i))
    if z > base:
        z += (z - base) * 0.06 * noise.fractal(Vector((x / 20, y / 20, 5.0)), 0.7, 2.0, 4)
    band = smoothstep(1300, 1600, y) * (1 - smoothstep(2100, 2400, y))
    if band > 0:  # the far range
        rr = noise.ridged_multi_fractal(Vector((x / 300, y / 300, 2.3)), 1.0, 2.1, 6, 1.0, 2.0)
        lift = 0.5 + 0.5 * noise.noise(Vector((x / 1400, 0.5, 7.7)))
        z = max(z, base + band * (16 + rr * 34 * lift))
    d2 = ((x + 1150) / 1300) ** 2 + ((y - 2750) / 600) ** 2
    if d2 < 1:  # a shield volcano, broad and low, off to the left
        z = max(z, base + 95 * (1 - d2) ** 1.6)
    return z


m_peak = material("peak", "#a8939f", rough=0.9)
bumpy(m_peak, 0.08, 0.5)
hazed(m_peak, None, 3000.0, into_sky=True)
grid_mesh("mountains", frange(-2500, 1600, 8), spaced(480, 3400, 4, 0.002), mountains, [m_peak])


# ---- light: the sun, setting behind the observatory (a little to its right, so the page
# can show it), and the dusk sky, brighter around the sun as the haze scatters its light
def direction(az, el):
    """az: degrees from +y (straight ahead) toward -x (left); el: degrees up."""
    a, e = math.radians(az), math.radians(el)
    return Vector((-math.sin(a) * math.cos(e), math.cos(a) * math.cos(e), math.sin(e)))


SUN = direction(-16, 4.0)
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
