"""Observatory app icon: a procedural Blender scene.

A calotte dome (after the Thirty Meter Telescope) on a drum, with a round
aperture in the tilted cap. The telescope's segmented primary mirror inside is
a sunburst chart of a disk: each tile is one folder, rings are nesting depth.

Run headless:
  blender -b --factory-startup --python observatory.py -- --variant mac --out mac.png

Variants (lighting)
  mac    lit for a night-sky backplate: cool sky reflections
  free   freestanding, on no background: neutral sky (unused; Windows and Linux
         use the aperture drawing, aperture.py)
Flags
  --simple   simplified geometry (no windows, seam or grooves; two chunky rings) for 16-32px
  --shadow   soft contact shadow under the building
  --rising   no plinth: the drum runs on down out of frame, for art cut off at the bottom
Styles
  render     Cycles, physically lit (the macOS art; the default)
  toon       EEVEE, cel-shaded: two flat tones per material, a crisp highlight,
             hard shadows and Freestyle ink lines (unused)
"""

import argparse
import json
import math
import sys

import bmesh
import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--variant", default="mac", choices=["mac", "free"])
ap.add_argument("--simple", action="store_true", help="simplified geometry for 16-32px")
ap.add_argument("--out", required=True)
ap.add_argument("--res", type=int, default=1024)
ap.add_argument("--samples", type=int, default=128)
ap.add_argument("--fill", type=float, default=0.86, help="object size as a fraction of the frame")
ap.add_argument("--blend", default=None, help="also save the scene as .blend")
ap.add_argument("--cpu", action="store_true")
ap.add_argument("--shadow", action="store_true", help="include a soft contact shadow (shadow catcher)")
ap.add_argument("--rising", action="store_true", help="hide the plinth and run the drum down out of frame")
ap.add_argument("--view", default="agx", choices=["agx", "standard", "punchy"])
ap.add_argument("--style", default="render", choices=["render", "toon"])
ap.add_argument("--line", type=float, default=None, help="toon: outline width as a fraction of the frame")
ap.add_argument("--no-ink", action="store_true", help="toon: no outlines")
args = ap.parse_args(argv)

V = args.variant
SMALL = args.simple
TOON = args.style == "toon"


# ---------------------------------------------------------------- utilities


def lin(hexstr):
    """sRGB hex -> linear RGB tuple."""
    h = hexstr.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i : i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


def material(name, color, rough=0.45, metal=0.0, coat=0.0, emit=None, strength=0.0, spec=0.5, albedo=1.0):
    m = bpy.data.materials.new(name)
    m["hex"] = color
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*(c * albedo for c in lin(color)), 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    b.inputs["Coat Weight"].default_value = coat
    b.inputs["Coat Roughness"].default_value = 0.15
    b.inputs["Specular IOR Level"].default_value = spec
    if emit:
        b.inputs["Emission Color"].default_value = (*lin(emit), 1)
        b.inputs["Emission Strength"].default_value = strength
    return m


def add_line_bump(m, coord_fn, period, width, strength):
    """Thin grooves in a material's normal: lines where coord_fn(nodes, links)/period is an integer."""
    if TOON:
        return
    nt = m.node_tree
    nodes, links = nt.nodes, nt.links
    bsdf = nodes["Principled BSDF"]
    value = coord_fn(nodes, links)
    div = nodes.new("ShaderNodeMath")
    div.operation = "DIVIDE"
    div.inputs[1].default_value = period
    links.new(value, div.inputs[0])
    fr = nodes.new("ShaderNodeMath")
    fr.operation = "PINGPONG"  # distance to the nearest integer, 0..0.5
    fr.inputs[1].default_value = 0.5
    links.new(div.outputs[0], fr.inputs[0])
    sm = nodes.new("ShaderNodeMapRange")
    sm.interpolation_type = "SMOOTHSTEP"
    sm.inputs["From Min"].default_value = 0.0
    sm.inputs["From Max"].default_value = width
    links.new(fr.outputs[0], sm.inputs["Value"])
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = strength
    bump.inputs["Distance"].default_value = 0.01
    links.new(sm.outputs["Result"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Coat Normal"])


def angle_about(axis_u, axis_v, centre):
    """Shader value: angle (radians) around an axis through centre, in the (u, v) plane."""

    def fn(nodes, links):
        geo = nodes.new("ShaderNodeNewGeometry")
        sub = nodes.new("ShaderNodeVectorMath")
        sub.operation = "SUBTRACT"
        sub.inputs[1].default_value = centre
        links.new(geo.outputs["Position"], sub.inputs[0])
        dots = []
        for ax in (axis_u, axis_v):
            d = nodes.new("ShaderNodeVectorMath")
            d.operation = "DOT_PRODUCT"
            d.inputs[1].default_value = ax
            links.new(sub.outputs[0], d.inputs[0])
            dots.append(d)
        at = nodes.new("ShaderNodeMath")
        at.operation = "ARCTAN2"
        links.new(dots[1].outputs["Value"], at.inputs[0])
        links.new(dots[0].outputs["Value"], at.inputs[1])
        return at.outputs[0]

    return fn


def elevation_about(centre):
    """Shader value: elevation angle (radians) seen from centre."""

    def fn(nodes, links):
        geo = nodes.new("ShaderNodeNewGeometry")
        sub = nodes.new("ShaderNodeVectorMath")
        sub.operation = "SUBTRACT"
        sub.inputs[1].default_value = centre
        links.new(geo.outputs["Position"], sub.inputs[0])
        nrm = nodes.new("ShaderNodeVectorMath")
        nrm.operation = "NORMALIZE"
        links.new(sub.outputs[0], nrm.inputs[0])
        sep = nodes.new("ShaderNodeSeparateXYZ")
        links.new(nrm.outputs[0], sep.inputs[0])
        asn = nodes.new("ShaderNodeMath")
        asn.operation = "ARCSINE"
        links.new(sep.outputs["Z"], asn.inputs[0])
        return asn.outputs[0]

    return fn


def link(name, bm, mats, smooth=True, sharp_angle=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    if smooth:
        me.shade_smooth()
        if sharp_angle is not None:
            me.set_sharp_from_angle(angle=math.radians(sharp_angle))
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def bevel(ob, width, segments=3, angle=35):
    if TOON:  # crisp edges ink better
        return None
    m = ob.modifiers.new("bevel", "BEVEL")
    m.width = width
    m.segments = segments
    m.limit_method = "ANGLE"
    m.angle_limit = math.radians(angle)
    m.use_clamp_overlap = True
    return m


def cylinder(name, r, z0, z1, mats, segs=192, bev=0.015):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r, depth=z1 - z0)
    for v in bm.verts:
        v.co.z += (z0 + z1) / 2
    ob = link(name, bm, mats, sharp_angle=40)
    if bev:
        bevel(ob, bev)
    return ob


def revolve(name, profile, point, segs, mats, sharp_angle=50):
    """Sweep a closed 2D profile around an axis. point(p, psi) -> Vector."""
    bm = bmesh.new()
    rings = [[bm.verts.new(point(p, 2 * math.pi * i / segs)) for p in profile] for i in range(segs)]
    n = len(profile)
    for i in range(segs):
        a, b = rings[i], rings[(i + 1) % segs]
        for j in range(n):
            k = (j + 1) % n
            bm.faces.new((a[j], b[j], b[k], a[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return link(name, bm, mats, sharp_angle=sharp_angle)


def beam(bm, p0, p1, w, h, up):
    """A box from p0 to p1, h thick along `up` and w wide across it."""
    e = (p1 - p0).normalized()
    sdn = e.cross(up).normalized()
    sd, t = sdn * (w / 2), sdn.cross(e) * (h / 2)
    vs = [bm.verts.new(p + a * sd + b * t) for p in (p0, p1) for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    bm.faces.new(vs[3::-1])
    bm.faces.new(vs[4:])
    for k in range(4):
        bm.faces.new((vs[k], vs[(k + 1) % 4], vs[4 + (k + 1) % 4], vs[4 + k]))


def frame(w):
    """Orthonormal (u, v, w) with w the given axis and u horizontal."""
    w = w.normalized()
    u = Vector((0, 0, 1)).cross(w).normalized()
    v = w.cross(u)
    return u, v, w


def rounded_profile(pts, radius, steps=5):
    """Round the corners of a closed polyline (2D tuples) with arcs of `radius`."""
    out = []
    n = len(pts)
    for i in range(n):
        p0, p1, p2 = Vector(pts[i - 1]), Vector(pts[i]), Vector(pts[(i + 1) % n])
        a, b = (p0 - p1), (p2 - p1)
        la, lb = a.length, b.length
        a.normalize()
        b.normalize()
        r = min(radius, la / 2.2, lb / 2.2)
        s, e = p1 + a * r, p1 + b * r
        for t in range(steps + 1):
            f = t / steps
            # quadratic bezier through the corner: close enough to an arc
            q = s * (1 - f) ** 2 + p1 * 2 * f * (1 - f) + e * f * f
            out.append((q.x, q.y))
    return out


# --------------------------------------------------------------- the scene

for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob, do_unlink=True)

scene = bpy.context.scene

# Proportions (Blender units). z = 0 is the ground.
PLINTH_R, PLINTH_H = 1.12, 0.08
DRUM_R, DRUM_TOP = 1.0, 0.95
DOME_R = 1.15
DOME_CUT = 0.98  # dome sits on the cornice here
C = Vector((0, 0, DOME_CUT + 0.42))  # dome centre

# Aperture: faces up and a little to the right of the camera (camera is at -Y).
AP_ELEV, AP_AZ = math.radians(36), math.radians(24)
D = Vector((math.cos(AP_ELEV) * math.sin(AP_AZ), -math.cos(AP_ELEV) * math.cos(AP_AZ), math.sin(AP_ELEV)))
AP_ALPHA = math.radians(35 if not SMALL else 37)  # angular radius of the hole
RING_W = math.radians(7.5 if not SMALL else 9)  # angular width of the shutter ring
RING_H = 0.075 if not SMALL else 0.09

# Seam between the rotating cap and the lower dome: a plane tilted toward the aperture.
SEAM_TILT = math.radians(25)
hd = Vector((D.x, D.y, 0)).normalized()
SEAM_N = Vector((hd.x * math.sin(SEAM_TILT), hd.y * math.sin(SEAM_TILT), math.cos(SEAM_TILT)))
SEAM_OFF = 0.18

# ---- palette
if V == "mac":
    WHITE, WHITE_SHADE = "#eef1f7", "#dfe4ee"
else:
    WHITE, WHITE_SHADE = "#f1f3f7", "#e2e6ee"
m_dome = material("dome", WHITE, rough=0.32, coat=0.35)
if not SMALL:
    add_line_bump(m_dome, elevation_about(C), math.radians(9), 0.035, 0.25)
m_dome_in = material("dome_inside", "#1a1f3a", rough=0.8)
m_dome_rim = material("dome_rim", WHITE_SHADE, rough=0.4)
m_ring = material("shutter_ring", "#c2c9d8", rough=0.3, metal=0.35, coat=0.4)
m_drum = material("drum", "#a8472e", rough=0.55, coat=0.15)
m_cornice = material("cornice", "#e9e4dc", rough=0.4)
m_plinth = material("plinth", "#7d8392", rough=0.6)
m_glass = bpy.data.materials.new("glass")  # clear, reflective at grazing angles
m_glass.use_nodes = True
_nt = m_glass.node_tree
_nt.nodes.remove(_nt.nodes["Principled BSDF"])
_clear = _nt.nodes.new("ShaderNodeBsdfTransparent")
_clear.inputs["Color"].default_value = (*lin("#c4cde6"), 1)
_gloss = _nt.nodes.new("ShaderNodeBsdfGlossy")
_gloss.inputs["Roughness"].default_value = 0.06
_lw = _nt.nodes.new("ShaderNodeLayerWeight")
_lw.inputs["Blend"].default_value = 0.35
_mix = _nt.nodes.new("ShaderNodeMixShader")
_nt.links.new(_lw.outputs["Fresnel"], _mix.inputs[0])
_nt.links.new(_clear.outputs[0], _mix.inputs[1])
_nt.links.new(_gloss.outputs[0], _mix.inputs[2])
_nt.links.new(_mix.outputs[0], _nt.nodes["Material Output"].inputs["Surface"])
m_interior = material("interior", "#2a3158", rough=0.8)
m_steel = material("steel", "#d3d9e4", rough=0.35, metal=0.5, coat=0.3)
m_brace = material("bracing", "#d3d9e4", rough=0.35, metal=0.5, coat=0.3)
m_cell = material("mirror_cell", "#0f1428", rough=0.5, metal=0.3)
m_hub = material("hub", "#e8ecf3", rough=0.3, coat=0.4)
m_tube = material("tube", "#1d2242", rough=0.7)

# ---- plinth, drum, window band, cornice
BAND_Z0 = 0.67  # the ribbon of glazing runs from here up under the cornice
plinth = cylinder("plinth", PLINTH_R, 0.0, PLINTH_H, [m_plinth], bev=0.02)
cylinder("drum", DRUM_R, PLINTH_H - 0.01, BAND_Z0 + 0.005, [m_drum], bev=0.0)
if args.rising:
    # The plinth still frames the shot (so the layout's sizes mean the same
    # building), but isn't drawn; the drum carries on below instead.
    plinth.hide_render = True
    below = cylinder("drum_below", DRUM_R, -1.5, PLINTH_H, [m_drum], bev=0.0)
    below["noframe"] = True
cylinder("cornice", DRUM_R + 0.08, DRUM_TOP - 0.02, DOME_CUT + 0.03, [m_cornice], bev=0.02)


def radial_box(bm, a, x0, x1, r0, r1, z0, z1):
    """A box on the drum at angle a: x tangential, r radial, z up."""
    res = bmesh.ops.create_cube(bm, size=1.0)
    for v in res["verts"]:
        x = x0 if v.co.x < 0 else x1
        r = r0 if v.co.y < 0 else r1
        z = z0 if v.co.z < 0 else z1
        v.co = Vector((r * math.sin(a) + x * math.cos(a), -r * math.cos(a) + x * math.sin(a), z))


# Glazing after TMT: a continuous ribbon of glass set back under the cornice,
# split by steel mullions, with the building's X-braced frame seen through it
# and a walkway ledge below.
LEDGE_T = BAND_Z0 + 0.015
cylinder("glass", DRUM_R - 0.03, BAND_Z0, DRUM_TOP, [m_glass], bev=0.0)
cylinder("interior", DRUM_R - 0.16, BAND_Z0, DRUM_TOP, [m_interior], bev=0.0)
cylinder("ledge", DRUM_R + 0.035, BAND_Z0 - 0.008, LEDGE_T, [m_cornice], bev=0.006)
if not SMALL:
    N_MULL = 24
    bm = bmesh.new()
    for i in range(N_MULL):
        radial_box(bm, 2 * math.pi * i / N_MULL, -0.007, 0.007, DRUM_R - 0.04, DRUM_R + 0.004, LEDGE_T, DRUM_TOP)
    mull = link("mullions", bm, [m_steel], smooth=False)
    bevel(mull, 0.003, segments=1)
    # an X in every bay, on columns behind the mullions
    bm = bmesh.new()
    BR = DRUM_R - 0.08
    for i in range(N_MULL):
        a0, a1 = 2 * math.pi * i / N_MULL, 2 * math.pi * (i + 1) / N_MULL
        am = (a0 + a1) / 2
        radial = Vector((math.sin(am), -math.cos(am), 0))
        p = lambda a, z: Vector((BR * math.sin(a), -BR * math.cos(a), z))
        beam(bm, p(a0, LEDGE_T), p(a1, DRUM_TOP - 0.02), 0.012, 0.012, radial)
        beam(bm, p(a0, DRUM_TOP - 0.02), p(a1, LEDGE_T), 0.012, 0.012, radial)
        radial_box(bm, a0, -0.01, 0.01, BR - 0.01, BR + 0.01, LEDGE_T, DRUM_TOP)  # column
    link("bracing", bm, [m_brace], smooth=False)
    # the lower wall is clad in vertical metal panels
    add_line_bump(m_drum, angle_about(Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 0))),
                  2 * math.pi / 96, 0.05, 0.25)


# ---- dome shells
def dome_shell(name, R, cuts):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=288, v_segments=144, radius=R)
    for v in bm.verts:
        v.co += C
    for co, no, keep_above in cuts:
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-7, plane_co=co, plane_no=no, clear_inner=keep_above, clear_outer=not keep_above)
    ob = link(name, bm, [m_dome, m_dome_in, m_dome_rim])
    # every vertex is on the sphere, so give it the exact radial normal
    # (the slivers left by the bisect cuts would otherwise shade unevenly)
    me = ob.data
    me.normals_split_custom_set_from_vertices([((v.co - C).normalized())[:] for v in me.vertices])
    s = ob.modifiers.new("shell", "SOLIDIFY")
    s.thickness = 0.035
    s.offset = -1
    s.use_even_offset = True
    s.use_rim = True
    s.material_offset = 1
    s.material_offset_rim = 2
    return ob


ap_co = C + D * (DOME_R * math.cos(AP_ALPHA))
dome_shell("dome", DOME_R, [(Vector((0, 0, DOME_CUT)), Vector((0, 0, 1)), True), (ap_co, D, False)])

if not SMALL:
    # The seam: the cap's edge overlaps the lower dome as a lip that steps out
    # sharply on the lower side and tapers back into the cap.
    SU, SV, SW = frame(SEAM_N)
    g = math.acos(SEAM_OFF / DOME_R)  # angle of the seam circle from SEAM_N

    def seam_pt(p, psi):
        gam, r = p
        return C + r * (math.sin(gam) * math.cos(psi) * SU + math.sin(gam) * math.sin(psi) * SV + math.cos(gam) * SW)

    lip = rounded_profile(
        [
            (g + 0.004, DOME_R - 0.03),
            (g + 0.004, DOME_R + 0.017),
            (g - 0.05, DOME_R + 0.012),
            (g - 0.16, DOME_R - 0.004),
            (g - 0.16, DOME_R - 0.03),
        ],
        radius=0.008,
        steps=3,
    )
    revolve("seam_lip", lip, seam_pt, 384, [m_dome], sharp_angle=60)

# ---- shutter ring around the aperture
U, Vv, W = frame(D)
if not SMALL:
    add_line_bump(m_ring, angle_about(U, Vv, C), 2 * math.pi / 36, 0.04, 0.4)
R_ring = DOME_R


def sph(p, psi):
    beta, r = p
    return C + r * (math.sin(beta) * math.cos(psi) * U + math.sin(beta) * math.sin(psi) * Vv + math.cos(beta) * W)


# profile in (angle from the aperture axis, distance from the dome centre), closed loop
a0, a1 = AP_ALPHA, AP_ALPHA + RING_W
ring_profile = rounded_profile(
    [
        (a0 - 0.002, R_ring - 0.10),
        (a0 - 0.002, R_ring + RING_H),
        (a1 - 0.012, R_ring + RING_H),
        (a1 + 0.03, R_ring - 0.004),
        (a1 + 0.03, R_ring - 0.03),
    ],
    radius=0.025,
    steps=4,
)
# rounded_profile works in mixed units (radians vs metres); close enough at this scale
revolve("shutter_ring", ring_profile, sph, 256, [m_ring])

# ---- the mirror: a sunburst of tiles on a shallow concave dish
# It sits down a dark tube, recessed below the aperture, with the telescope's
# top end (a hexagonal frame holding the secondary mirror) out in front.
AP_T = DOME_R * math.cos(AP_ALPHA)  # aperture plane's distance from C along D
RING_LOW = DOME_R - 0.10  # the shutter ring's inner face starts this far from C
TUBE_R = RING_LOW * math.sin(AP_ALPHA) - 0.005
TUBE_TOP = RING_LOW * math.cos(AP_ALPHA) + 0.01
MIRROR_R = TUBE_R - 0.035
MIRROR_T = AP_T - (0.40 if not SMALL else 0.30)  # distance of the mirror centre from C along D
DISH = 0.12  # depth gain at the rim (concave toward the sky)

HUES = {
    "blue": ["#1557f0", "#1f6cff", "#3285ff"],
    "violet": ["#6f3df5", "#8152fb", "#966cff"],
    "pink": ["#f2287f", "#fb4593", "#ff63a8"],
    "orange": ["#ff4f1f", "#ff6633", "#ff7f4d"],
    "amber": ["#ffa000", "#ffb000", "#ffc21f"],
    "grey": ["#5d6679", "#6f788c", "#838c9f"],
}

# Folder sizes as fractions of the disk. (hue, size, children) at depth 0;
# deeper levels inherit the hue. Leaves stop short: that ragged outer edge is
# what makes it a sunburst and not a dartboard.
TREE = [
    ("blue", 0.30, [(0.15, [(0.085, []), (0.045, [])]), (0.09, [(0.05, [])]), (0.04, [])]),
    ("violet", 0.21, [(0.12, [(0.07, []), (0.03, [])]), (0.06, [])]),
    ("pink", 0.18, [(0.10, [(0.06, [])]), (0.055, [(0.03, [])])]),
    ("orange", 0.16, [(0.09, [(0.05, []), (0.025, [])]), (0.045, [])]),
    ("amber", 0.11, [(0.065, [(0.035, [])]), (0.03, [])]),
    ("grey", 0.04, []),
]
if SMALL:
    # two rings, chunkier
    TREE = [(h, s, [(c[0], []) for c in ch[:2]]) for h, s, ch in TREE]

RINGS = [(0.24, 0.49), (0.51, 0.73), (0.75, 0.97)] if not SMALL else [(0.30, 0.62), (0.66, 0.97)]
GAP = 0.013 if not SMALL else 0.03
TILE_H = 0.028
START = math.radians(100)

tile_mats = {}


def tile_material(hex_):
    if hex_ not in tile_mats:
        tile_mats[hex_] = material("tile_" + hex_, hex_, rough=0.35, coat=0.25, emit=hex_, strength=0.62, albedo=0.4)
    return tile_mats[hex_]


def mirror_point(r, phi, lift=0.0):
    depth = MIRROR_T + DISH * (r / MIRROR_R) ** 2 + lift
    return C + depth * W + r * math.cos(phi) * U + r * math.sin(phi) * Vv


def tile(name, r0, r1, f0, f1, mat):
    """An annular-sector tile with constant-width gaps, following the dish."""
    r0, r1 = r0 * MIRROR_R + GAP / 2, r1 * MIRROR_R - GAP / 2
    ang0, ang1 = START - 2 * math.pi * f0, START - 2 * math.pi * f1  # clockwise
    bm = bmesh.new()
    n = max(4, int(abs(ang1 - ang0) * r1 / 0.02))
    nr = 4
    top, bot = [], []
    for i in range(n + 1):
        t = i / n
        col_t, col_b = [], []
        for j in range(nr + 1):
            r = r0 + (r1 - r0) * j / nr
            # sides run parallel to the radius at a constant gap
            off = math.asin(min(0.99, GAP / 2 / r))
            a = ang0 - off + (ang1 + off - (ang0 - off)) * t
            col_t.append(bm.verts.new(mirror_point(r, a, TILE_H)))
            col_b.append(bm.verts.new(mirror_point(r, a, 0.0)))
        top.append(col_t)
        bot.append(col_b)
    for i in range(n):
        for j in range(nr):
            bm.faces.new((top[i][j], top[i][j + 1], top[i + 1][j + 1], top[i + 1][j]))
            bm.faces.new((bot[i][j], bot[i + 1][j], bot[i + 1][j + 1], bot[i][j + 1]))
    for i in range(n):  # inner and outer walls
        bm.faces.new((top[i][0], top[i + 1][0], bot[i + 1][0], bot[i][0]))
        bm.faces.new((top[i][nr], bot[i][nr], bot[i + 1][nr], top[i + 1][nr]))
    for i, cap in ((0, True), (n, False)):  # end walls
        for j in range(nr):
            q = (top[i][j], bot[i][j], bot[i][j + 1], top[i][j + 1])
            bm.faces.new(q if cap else q[::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    ob = link(name, bm, [mat], sharp_angle=40)
    bevel(ob, 0.006, segments=2, angle=40)
    return ob


def walk(nodes, depth, f0, hue=None):
    f = f0
    for node in nodes:
        if depth == 0:
            hue, size, kids = node
        else:
            size, kids = node
        r0, r1 = RINGS[depth]
        tile(f"tile_{depth}_{f:.3f}", r0, r1, f, f + size, tile_material(HUES[hue][depth]))
        if kids and depth + 1 < len(RINGS):
            walk(kids, depth + 1, f, hue)
        f += size


walk(TREE, 0, 0.0)

# mirror cell: a dark dish behind the tiles
bm = bmesh.new()
cell_r = MIRROR_R + 0.03
nseg, nring = 128, 10
verts = []
for j in range(nring + 1):
    r = cell_r * j / nring
    verts.append([bm.verts.new(mirror_point(max(r, 1e-4), 2 * math.pi * i / nseg, -0.01)) for i in range(nseg)])
for j in range(nring):
    for i in range(nseg):
        k = (i + 1) % nseg
        bm.faces.new((verts[j][i], verts[j][k], verts[j + 1][k], verts[j + 1][i]))
bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
cell = link("mirror_cell", bm, [m_cell])
sol = cell.modifiers.new("thick", "SOLIDIFY")
sol.thickness = 0.04

AXIS = W.to_track_quat("Z", "Y").to_matrix().to_4x4()


def along_axis(name, bm, t, mats, sharp_angle=40):
    """Place a bmesh built around the origin (z = the axis) at depth t along D."""
    for v in bm.verts:
        v.co = C + t * W + AXIS @ v.co
    return link(name, bm, mats, sharp_angle=sharp_angle)


# the tube: a dark well from the mirror cell up into the shutter ring
t0 = MIRROR_T - 0.05
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=False, segments=192, radius1=TUBE_R, radius2=TUBE_R, depth=TUBE_TOP - t0)
along_axis("tube", bm, (t0 + TUBE_TOP) / 2, [m_tube])

if SMALL:
    # hub: the root of the sunburst
    hub_r = RINGS[0][0] * MIRROR_R - GAP * 0.6
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=96, radius1=hub_r, radius2=hub_r * 0.92, depth=0.07)
    hub = along_axis("hub", bm, MIRROR_T + 0.035, [m_hub])
    bevel(hub, 0.012)
else:
    # The top end, after TMT: the secondary mirror's housing in a hexagonal
    # frame, held out toward the sky on six vanes that reach forward from the
    # tube wall just above the primary.
    M2_T = AP_T + 0.04  # about level with the aperture
    VANE_T = MIRROR_T + DISH + TILE_H + 0.05  # where the vanes meet the tube wall
    M2_R = RINGS[0][0] * MIRROR_R * 0.82
    HEX_R = M2_R * 1.55
    ax = Vector((0, 0, 1))
    corner = [Vector((HEX_R * math.cos(math.radians(90 + 60 * k)), HEX_R * math.sin(math.radians(90 + 60 * k)), 0)) for k in range(6)]
    bm = bmesh.new()
    for k in range(6):
        c0, c1 = corner[k], corner[(k + 1) % 6]
        e = (c1 - c0) * 0.06  # overlap at the corners
        beam(bm, c0 - e, c1 + e, 0.03, 0.045, ax)
        beam(bm, c0 * 0.95, c0.normalized() * M2_R * 0.9, 0.014, 0.028, ax)  # strut in to the housing
        # vane: from the corner back and out to the tube wall
        foot = c0.normalized() * (TUBE_R + 0.01) + Vector((0, 0, VANE_T - M2_T))
        beam(bm, c0 * 0.97, foot, 0.02, 0.035, ax)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    frame_ob = along_axis("top_end", bm, M2_T, [m_steel])
    bevel(frame_ob, 0.005, segments=2)

    # the secondary mirror's housing: a hexagonal can, its back to the sky
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=M2_R, radius2=M2_R * 0.9, depth=0.09)
    for v in bm.verts:
        v.co = Matrix.Rotation(math.radians(30), 4, "Z") @ v.co
    m2 = along_axis("secondary", bm, M2_T + 0.01, [m_hub])
    bevel(m2, 0.012, segments=3)

# ---- lights and world
world = bpy.data.worlds.new("sky")
scene.world = world
world.use_nodes = True
nt = world.node_tree
for n in list(nt.nodes):
    nt.nodes.remove(n)
tc = nt.nodes.new("ShaderNodeTexCoord")
sep = nt.nodes.new("ShaderNodeSeparateXYZ")
ramp = nt.nodes.new("ShaderNodeValToRGB")
bg = nt.nodes.new("ShaderNodeBackground")
outn = nt.nodes.new("ShaderNodeOutputWorld")
nt.links.new(tc.outputs["Generated"], sep.inputs[0])
maprange = nt.nodes.new("ShaderNodeMapRange")
maprange.inputs["From Min"].default_value = -1
maprange.inputs["From Max"].default_value = 1
nt.links.new(sep.outputs["Z"], maprange.inputs["Value"])
nt.links.new(maprange.outputs["Result"], ramp.inputs["Fac"])
nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
nt.links.new(bg.outputs[0], outn.inputs[0])
els = ramp.color_ramp.elements
if V == "mac":
    stops = [(0.0, "#1b1e33"), (0.47, "#3b3f6e"), (0.53, "#8b84d9"), (0.75, "#4a58b8"), (1.0, "#27348a")]
    bg.inputs["Strength"].default_value = 0.6
else:
    # a mid-grey horizon, so the dome's outline (which reflects it) holds up on white
    stops = [(0.0, "#3c404c"), (0.47, "#6d7486"), (0.53, "#9aa3b8"), (0.75, "#c3cce0"), (1.0, "#b4c0dc")]
    bg.inputs["Strength"].default_value = 0.5
els[0].position, els[0].color = stops[0][0], (*lin(stops[0][1]), 1)
els[1].position, els[1].color = stops[-1][0], (*lin(stops[-1][1]), 1)
for pos, col in stops[1:-1]:
    e = els.new(pos)
    e.color = (*lin(col), 1)


def area_light(name, loc, power, size, color="#ffffff", target=Vector((0, 0, 1.2))):
    ld = bpy.data.lights.new(name, "AREA")
    ld.energy = power
    ld.size = size
    ld.color = lin(color)
    ob = bpy.data.objects.new(name, ld)
    scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = (target - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    return ob


if V == "mac":
    area_light("key", (-5.0, -5.5, 7.0), 1700, 5.0, "#fff3e6")
    area_light("rim", (5.5, 4.5, 3.0), 1200, 4.0, "#b9a8ff")
    area_light("fill", (4.0, -6.0, 1.5), 250, 4.0, "#c9d6ff")
else:
    area_light("key", (-5.0, -5.5, 7.0), 1700, 5.0, "#fff6ec")
    area_light("rim", (5.5, 4.5, 3.0), 800, 4.0, "#dfe6ff")
    area_light("fill", (4.0, -6.0, 1.5), 250, 4.0, "#eef2ff")

# shadow catcher for a soft contact shadow (macOS legacy art only: the other
# platforms ask for no shadow outside the silhouette)
if args.shadow:
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=8)
    ground = link("ground", bm, [], smooth=False)
    ground.is_shadow_catcher = True
    # catch the shadow only: don't bounce the key light back up onto the building
    ground.visible_diffuse = ground.visible_glossy = ground.visible_transmission = False


# ---- toon: flat tones, a crisp highlight, hard shadows, ink
def srgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))


def to_lin(c):
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


SHADOW_TINT = srgb("#4b3fa6")  # shadows lean violet, like the macOS sky


def shade(c, k, t):
    """sRGB colour in shadow: darker by k, pulled toward the shadow tint by t."""
    return tuple((1 - t) * x * k + t * s for x, s in zip(c, SHADOW_TINT))


def lighten(c, t):
    return tuple(x + (1 - x) * t for x in c)


# per material: lit colour override, highlight amount, shadow darkening k and tint t
TOON_MATS = {
    "dome": dict(lit="#e8ebf3", shadow_of=WHITE, hl=1.0, hl_col="#ffffff"),
    "dome_rim": dict(),
    "shutter_ring": dict(hl=1.0),
    "drum": dict(),
    "cornice": dict(hl=0.0),
    "plinth": dict(),
    "interior": dict(k=0.8, t=0.05),
    "steel": dict(hl=1.0),
    "bracing": dict(lit="#4c5589", k=0.85, t=0.05),
    "mirror_cell": dict(k=0.9, t=0.0),
    "hub": dict(hl=1.0, hl_col="#ffffff"),
    "tube": dict(k=0.8, t=0.05),
    "dome_inside": dict(k=0.85, t=0.05),
}
DIFFUSE_SPLIT = 0.28  # sun-facing-ness where light turns to shadow
HL_SPLIT = 1.2  # glossy brightness where the highlight starts


def toonify(m, lit=None, shadow_of=None, hl=0.0, hl_col=None, k=0.8, t=0.16):
    base = srgb(m["hex"])
    lit_c = srgb(lit) if lit else base
    shadow_c = shade(srgb(shadow_of) if shadow_of else base, k, t)
    nt = m.node_tree
    nodes, links = nt.nodes, nt.links
    for n in list(nodes):
        nodes.remove(n)
    out = nodes.new("ShaderNodeOutputMaterial")

    def lightness(bsdf):
        s2r = nodes.new("ShaderNodeShaderToRGB")
        links.new(bsdf.outputs[0], s2r.inputs[0])
        bw = nodes.new("ShaderNodeRGBToBW")
        links.new(s2r.outputs["Color"], bw.inputs[0])
        return bw.outputs[0]

    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    e0, e1 = ramp.color_ramp.elements
    e0.position, e0.color = 0.0, (*to_lin(shadow_c), 1)
    e1.position, e1.color = DIFFUSE_SPLIT, (*to_lin(lit_c), 1)
    dif = nodes.new("ShaderNodeBsdfDiffuse")
    dif.inputs["Color"].default_value = (1, 1, 1, 1)
    links.new(lightness(dif), ramp.inputs[0])
    col = ramp.outputs["Color"]
    if hl:
        gl = nodes.new("ShaderNodeBsdfGlossy")
        gl.inputs["Roughness"].default_value = 0.22
        gt = nodes.new("ShaderNodeMath")
        gt.operation = "GREATER_THAN"
        gt.inputs[1].default_value = HL_SPLIT
        links.new(lightness(gl), gt.inputs[0])
        mul = nodes.new("ShaderNodeMath")
        mul.operation = "MULTIPLY"
        mul.inputs[1].default_value = hl
        links.new(gt.outputs[0], mul.inputs[0])
        mix = nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        links.new(mul.outputs[0], mix.inputs[0])
        links.new(col, mix.inputs[6])
        mix.inputs[7].default_value = (*to_lin(srgb(hl_col) if hl_col else lighten(lit_c, 0.6)), 1)
        col = mix.outputs[2]
    em = nodes.new("ShaderNodeEmission")
    links.new(col, em.inputs["Color"])
    links.new(em.outputs[0], out.inputs["Surface"])


if args.style == "toon":
    for m in list(bpy.data.materials):
        if "hex" not in m:
            continue
        if m.name.startswith("tile_"):
            toonify(m, k=0.9, t=0.06)  # the sunburst stays bright even in shadow
        else:
            toonify(m, **TOON_MATS.get(m.name, {}))
    bpy.data.objects["glass"].hide_render = True
    # one sun from the upper left (Windows' light direction), no ambient: the
    # shaders only ask "lit or not"
    for ob in [o for o in scene.objects if o.type == "LIGHT"]:
        bpy.data.objects.remove(ob, do_unlink=True)
    bg.inputs["Strength"].default_value = 0.0
    sun_d = bpy.data.lights.new("sun", "SUN")
    sun_d.energy = math.pi  # a white diffuse surface facing it then reads 1.0
    sun_d.angle = math.radians(0.5)
    sun = bpy.data.objects.new("sun", sun_d)
    scene.collection.objects.link(sun)
    sun.rotation_euler = (-Vector((-5.0, -5.5, 7.0))).to_track_quat("-Z", "Y").to_euler()

    # objects too fine to ink: they read as tone alone
    noink = bpy.data.collections.new("noink")
    scene.collection.children.link(noink)
    for ob in list(scene.objects):
        if ob.name.startswith(("tile_", "bracing", "mullions", "mirror_cell", "top_end")):
            for c in ob.users_collection:
                c.objects.unlink(ob)
            noink.objects.link(ob)

# ---- camera, framed to the object
cam_data = bpy.data.cameras.new("cam")
cam_data.sensor_width = 36
cam_data.lens = 85
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
CAM_ELEV, CAM_DIST = math.radians(14), 14.0
target = Vector((0, 0, 1.25))
cam.location = target + CAM_DIST * Vector((0, -math.cos(CAM_ELEV), math.sin(CAM_ELEV)))
cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()

scene.render.resolution_x = scene.render.resolution_y = args.res
scene.render.resolution_percentage = 100


def projected_bbox():
    dg = bpy.context.evaluated_depsgraph_get()
    xs, ys = [], []
    for ob in scene.objects:
        if ob.type != "MESH" or ob.is_shadow_catcher or ob.get("noframe"):
            continue
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        mw = ob.matrix_world
        for v in me.vertices:
            p = world_to_camera_view(scene, cam, mw @ v.co)
            xs.append(p.x)
            ys.append(p.y)
        ev.to_mesh_clear()
    return min(xs), min(ys), max(xs), max(ys)


for _ in range(3):
    x0, y0, x1, y1 = projected_bbox()
    size = max(x1 - x0, y1 - y0)
    cam_data.lens *= args.fill / size
    x0, y0, x1, y1 = projected_bbox()
    cam_data.shift_x += (x0 + x1) / 2 - 0.5
    cam_data.shift_y += (y0 + y1) / 2 - 0.5
x0, y0, x1, y1 = projected_bbox()

# ---- render settings
if args.style == "toon":
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    ee = scene.eevee
    ee.taa_render_samples = args.samples
    ee.use_shadows = True
    ee.shadow_resolution_scale = 1.0
    sun_d.use_shadow = True
    sun_d.shadow_maximum_resolution = 0.0005
    scene.render.filter_size = 1.0
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    if not args.no_ink:
        # ink: a heavier outline around the whole silhouette, finer lines inside
        INK = "#1e2148"
        line = args.line if args.line is not None else (0.022 if SMALL else 0.0072)
        r = scene.render
        r.use_freestyle = True
        r.line_thickness_mode = "ABSOLUTE"
        r.line_thickness = 1.0
        fs = bpy.context.view_layer.freestyle_settings
        fs.crease_angle = math.radians(130)
        fs.use_smoothness = True

        def lineset(ls, name, thickness, position, kinds, exclude=None):
            ls.name = name
            ls.select_by_visibility = True
            ls.visibility = "VISIBLE"
            ls.select_by_edge_types = True
            ls.edge_type_combination = "OR"
            for k in ("silhouette", "border", "crease", "material_boundary", "contour", "external_contour"):
                setattr(ls, "select_" + k, k in kinds)
            if exclude:
                ls.select_by_collection = True
                ls.collection = exclude
                ls.collection_negation = "EXCLUSIVE"
            st = bpy.data.linestyles.new(name)
            st.color = lin(INK)
            st.thickness = thickness
            st.thickness_position = position
            st.caps = "ROUND"
            ls.linestyle = st

        lineset(fs.linesets[0], "outline", line * args.res, "INSIDE", ["external_contour"])
        lineset(fs.linesets.new("detail"), "detail", 0.5 * line * args.res, "CENTER",
                ["silhouette", "border", "crease", "material_boundary"], exclude=noink)
else:
    scene.render.engine = "CYCLES"
    cyc = scene.cycles
    if not args.cpu:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        cyc.device = "GPU"
    cyc.samples = args.samples
    cyc.use_denoising = True
    cyc.denoiser = "OPENIMAGEDENOISE"
    cyc.max_bounces = 8
    scene.render.filter_size = 1.2
scene.render.film_transparent = True
if args.style == "toon":
    pass
elif args.view == "standard":
    scene.view_settings.view_transform = "Standard"
else:
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Punchy" if args.view == "punchy" else "AgX - Medium High Contrast"
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.color_depth = "16"
scene.render.filepath = args.out

if args.blend:
    bpy.ops.wm.save_as_mainfile(filepath=args.blend)

bpy.ops.render.render(write_still=True)

# bbox in pixels, y down, for the compositing step
res = args.res
meta = {"bbox": [x0 * res, (1 - y1) * res, x1 * res, (1 - y0) * res], "res": res, "variant": V}
with open(args.out.rsplit(".", 1)[0] + ".json", "w") as fh:
    json.dump(meta, fh)
print("bbox", meta["bbox"])
