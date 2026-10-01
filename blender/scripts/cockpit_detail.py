"""Cockpit detail pass for the MiG-29K sim, exported as a separate glTF (model/cockpit_detail.json) that the simulator
attaches to the aircraft at runtime, like controls.json, so the textured airframe never has to be rebuilt.

  - K-36D-3.5 ejection seat: side beams with guide rollers, parachute headbox with the stabiliser-boom tubes and
    head pad, quilted back and seat cushions, NAZ survival-kit pan, yellow/black ejection loop, leg-restraint garters,
    arm-restraint guards, harness release box. Replaces the airframe's simple Seat_frame/cushion/head/handle meshes.
  - Tub interior: frames and stringers on the aft side walls, wiring looms with P-clamps, padded canopy sills with
    the canopy lock hooks, the oxygen / anti-g connector block, map case.
  - Panel hardware: Dzus fasteners round the main panel, console plates and MFD bezels; MFD rocker switches; a rolled
    leather edge on the glareshield; framed rear-view mirror housings.
Materials are named Ckd*; the sim gives them (and the airframe's Ck* paint) a triplanar crinkle-finish normal map.

Frame (same as the airframe): Blender X = right, Y = S0 - s (forward), Z = up; glTF export converts to three's
x right, y up, z aft.
Run:  python cockpit_detail.py <out_dir>   (bpy 4.2 module), then embed_gltf.py <out>/cockpit_detail.gltf sim/model/cockpit_detail.json
"""
import sys, os, math
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpy
import numpy as np
from mathutils import Vector, Matrix
from lib import *

D2R = math.pi / 180
OUT = sys.argv[-1] if len(sys.argv) > 1 and not sys.argv[-1].endswith('.py') else os.path.join(HERE, 'out')
RNG = np.random.default_rng(29)

bpy.ops.wm.read_factory_settings(use_empty=True)
COLL = bpy.data.collections.new('CockpitDetail')
bpy.context.scene.collection.children.link(COLL)
K = dict(coll=COLL)

M = {
    'frame': mat('CkdSeatFrame', (0.055, 0.058, 0.062), 0.45, 0.5),
    'beam': mat('CkdSeatBeam', (0.10, 0.105, 0.11), 0.4, 0.7),
    'cush': mat('CkdCushion', (0.075, 0.082, 0.050), 0.9),
    'chute': mat('CkdChute', (0.11, 0.115, 0.075), 0.85),
    'pad': mat('CkdHeadPad', (0.035, 0.035, 0.035), 0.75),
    'yellow': mat('CkdHandleYellow', (0.80, 0.58, 0.04), 0.45),
    'black': mat('CkdHandleBlack', (0.015, 0.015, 0.015), 0.5),
    'webbing': mat('CkdWebbing', (0.16, 0.15, 0.10), 0.9),
    'metal': mat('CkdMetal', (0.55, 0.56, 0.58), 0.35, 1.0),
    'paint': mat('CkdPaint', (0.05, 0.053, 0.057), 0.62),
    'loom': mat('CkdLoom', (0.035, 0.036, 0.03), 0.8),
    'loom_w': mat('CkdLoomWhite', (0.45, 0.45, 0.42), 0.7),
    'clamp': mat('CkdClamp', (0.30, 0.30, 0.31), 0.4, 0.8),
    'sill': mat('CkdSill', (0.025, 0.025, 0.027), 0.85),
    'leather': mat('CkdLeather', (0.018, 0.017, 0.016), 0.7),
    'dzus': mat('CkdDzus', (0.20, 0.20, 0.21), 0.35, 0.9),
    'rocker': mat('CkdRocker', (0.03, 0.03, 0.032), 0.45),
    'mirror_frame': mat('CkdMirrorFrame', (0.03, 0.03, 0.033), 0.5),
    'green': mat('CkdHoseGreen', (0.06, 0.09, 0.05), 0.75),
    'red': mat('CkdRed', (0.45, 0.03, 0.02), 0.5),
    'suit': mat('CkdFlightSuit', (0.085, 0.10, 0.06), 0.88),
    'vest': mat('CkdVest', (0.11, 0.105, 0.065), 0.8),
    'gsuit': mat('CkdGSuit', (0.07, 0.085, 0.05), 0.85),
    'helmet': mat('CkdHelmet', (0.62, 0.63, 0.62), 0.35),
    'helmet_trim': mat('CkdHelmetTrim', (0.04, 0.04, 0.045), 0.5),
    'visor': mat('CkdVisor', (0.01, 0.012, 0.02), 0.05, 0.6),
    'mask': mat('CkdMask', (0.06, 0.065, 0.06), 0.6),
    'boot': mat('CkdBoot', (0.02, 0.02, 0.02), 0.55),
}


def put(o, m):
    assign(o, m)
    return o


def smooth(o):
    for p in o.data.polygons:
        p.use_smooth = True
    return o


def bx(c, size, rot=(0, 0, 0), bevel=0.0, name='b'):
    o = box(name, tuple(c), tuple(size), rot=rot, bevel=bevel, **K)
    return o


def tube(pts, r, n=10, name='t'):
    return smooth(tube_along(name, [Vector(p) for p in pts], r, n=n, **K))


def cyl(p0, p1, r, n=12, name='c'):
    return smooth(cylinder(name, Vector(p0), Vector(p1), r, n=n, **K))


def quilt(name, center, w, h, depth, nx, ny, axis_u, axis_v, normal, puff=0.012):
    """cushion: a grid surface bulged per quilted cell, closed with a back plate."""
    c = Vector(center); u = Vector(axis_u).normalized(); v = Vector(axis_v).normalized(); n = Vector(normal).normalized()
    res = 6
    NU, NV = nx * res + 1, ny * res + 1
    rings = []
    for j in range(NV):
        ring = []
        for i in range(NU):
            a, b = i / (NU - 1), j / (NV - 1)
            cu, cv = (a * nx) % 1.0, (b * ny) % 1.0
            cell = math.sin(math.pi * cu) * math.sin(math.pi * cv)
            edge = min(1.0, 8 * min(a, 1 - a, b, 1 - b))           # roll down to the seams at the border
            p = c + u * ((a - 0.5) * w) + v * ((b - 0.5) * h) + n * (depth * edge + puff * cell * edge)
            ring.append(tuple(p))
        rings.append(ring)
    top = loft(name, rings, closed=False, **K)
    back = bx(c - n * 0.002, (0, 0, 0))      # placeholder replaced below
    bpy.data.objects.remove(back)
    sides = []
    for (a0, b0, a1, b1) in ((0, 0, 1, 0), (1, 0, 1, 1), (1, 1, 0, 1), (0, 1, 0, 0)):
        p0 = c + u * ((a0 - 0.5) * w) + v * ((b0 - 0.5) * h)
        p1 = c + u * ((a1 - 0.5) * w) + v * ((b1 - 0.5) * h)
        sides.append(loft('qs', [[tuple(p0), tuple(p1)], [tuple(p0 + n * depth * 0.2), tuple(p1 + n * depth * 0.2)]], closed=False, **K))
    o = join([top] + sides, name)
    return smooth(o)


# ================================================================== K-36D-3.5 ejection seat
def seat():
    sc = Vector((0, Y(4.02), 0.30))
    rec = 18 * D2R
    up = Vector((0, -math.sin(rec), math.cos(rec)))       # along the seat back (leans aft)
    fwd = Vector((0, math.cos(rec), math.sin(rec)))       # out of the seat back, towards the pilot's chest
    right = Vector((1, 0, 0))
    base = sc + Vector((0, -0.20, 0.0))                    # foot of the back
    fr, beam, cush, yel, blk, web, met = [], [], [], [], [], [], []
    # side beams: box-section rails with guide rollers riding in the cockpit rails behind
    for sd in (1, -1):
        p0 = base + right * (sd * 0.245)
        for k in range(10):
            t0, t1 = k * 0.105, k * 0.105 + 0.1
            beam.append(bx(p0 + up * ((t0 + t1) / 2), (0.034, 0.05, 0.1), rot=(rec, 0, 0), bevel=0.004))
        for t in (0.12, 0.55, 0.95):
            met.append(cyl(p0 + up * t + right * (sd * 0.022) - fwd * 0.012, p0 + up * t + right * (sd * 0.034) - fwd * 0.012, 0.016, n=14))
        # arm-restraint guard folded along the beam (deploys on ejection)
        fr.append(bx(p0 + up * 0.42 + fwd * 0.07 - right * (sd * 0.01), (0.012, 0.13, 0.30), rot=(rec, 0, 0), bevel=0.005))
    # cross members at the back
    for t in (0.06, 0.62):
        fr.append(bx(base + up * t - fwd * 0.03, (0.47, 0.03, 0.05), rot=(rec, 0, 0), bevel=0.004))
    # seat pan (survival kit container NAZ-7) with side walls
    pan_c = sc + Vector((0, 0.03, 0.05))
    fr.append(bx(pan_c, (0.46, 0.47, 0.11), bevel=0.018))
    for sd in (1, -1):
        fr.append(bx(sc + Vector((sd * 0.232, 0.02, 0.14)), (0.028, 0.46, 0.18), bevel=0.008))
        # pan side reinforcing ribs
        for yv in (-0.12, 0.05, 0.19):
            fr.append(bx(sc + Vector((sd * 0.249, yv, 0.11)), (0.008, 0.02, 0.15)))
    # front lip of the pan
    fr.append(bx(sc + Vector((0, 0.262, 0.115)), (0.44, 0.02, 0.05), bevel=0.006))
    # cushions: quilted seat and back, with a lumbar roll
    cush.append(quilt('seat_cush', sc + Vector((0, 0.035, 0.105)), 0.40, 0.42, 0.045, 4, 4, (1, 0, 0), (0, 1, 0), (0, 0, 1)))
    bc = base + up * 0.47 + fwd * 0.035
    cush.append(quilt('back_cush', bc, 0.40, 0.66, 0.05, 3, 5, right, up, fwd, puff=0.014))
    cush.append(smooth(cyl(base + up * 0.18 + fwd * 0.08 - right * 0.17, base + up * 0.18 + fwd * 0.08 + right * 0.17, 0.035, n=14)))
    # headbox: parachute container (fabric-covered), stabiliser-boom tubes on top, head pad on the front
    hc = base + up * 1.0
    chute = [bx(hc - fwd * 0.01, (0.38, 0.22, 0.32), rot=(rec, 0, 0), bevel=0.045)]
    for sd in (1, -1):
        met.append(cyl(hc + right * (sd * 0.15) + up * 0.12 - fwd * 0.08, hc + right * (sd * 0.15) + up * 0.30 - fwd * 0.14, 0.018, n=12))
        fr.append(cyl(hc + right * (sd * 0.15) + up * 0.29 - fwd * 0.14, hc + right * (sd * 0.15) + up * 0.31 - fwd * 0.145, 0.024, n=12))
    # container lacing / flap seams
    for t in (-0.08, 0.04):
        web.append(bx(hc + up * t + fwd * 0.112, (0.36, 0.004, 0.012), rot=(rec, 0, 0)))
    pad = quilt('head_pad', hc + fwd * 0.10 - up * 0.04, 0.26, 0.18, 0.03, 2, 2, right, up, fwd, puff=0.008)
    # drogue-gun canister on the right of the headbox
    fr.append(cyl(hc + right * 0.215 - up * 0.13, hc + right * 0.215 + up * 0.10, 0.03, n=14))
    # ejection handle: the K-36 loop at the front of the pan, yellow with black stripes, between the thighs
    c0 = sc + Vector((0, 0.285, 0.10))
    loop = [c0 + Vector((math.sin(a) * 0.075, 0.035 * math.cos(a), -0.055 * math.cos(a) + 0.02)) for a in np.linspace(-1.35, 1.35, 15)]
    segs = []
    for i in range(len(loop) - 1):
        s_ = tube([loop[i], loop[i + 1]], 0.011, n=10)
        (yel if i % 2 == 0 else blk).append(s_)
    for sd in (1, -1):
        blk.append(cyl(loop[0 if sd < 0 else -1], loop[0 if sd < 0 else -1] + Vector((0, -0.03, 0.01)), 0.014, n=10))
    # leg-restraint garters and their lines into the pan front
    for sd in (1, -1):
        web.append(tube([sc + Vector((sd * 0.12, 0.26, 0.09)), sc + Vector((sd * 0.13, 0.33, 0.02)), sc + Vector((sd * 0.13, 0.45, -0.08))], 0.006, n=6))
        met.append(bx(sc + Vector((sd * 0.12, 0.27, 0.085)), (0.03, 0.012, 0.02), bevel=0.003))
    # harness release / inertia reel housing on the back
    fr.append(bx(base + up * 0.83 + fwd * 0.05, (0.12, 0.05, 0.07), rot=(rec, 0, 0), bevel=0.01))
    met.append(cyl(base + up * 0.83 + fwd * 0.08, base + up * 0.83 + fwd * 0.09, 0.016, n=12))
    # seat-height actuator and the firing-mechanism box at the lower right
    fr.append(bx(sc + Vector((0.26, -0.14, 0.24)), (0.05, 0.10, 0.12), bevel=0.008))
    red = [bx(sc + Vector((0.287, -0.14, 0.27)), (0.004, 0.03, 0.02))]
    out = []
    for parts, m, nm in ((fr, M['frame'], 'Ckd_Seat_Frame'), (beam, M['beam'], 'Ckd_Seat_Beams'), (cush, M['cush'], 'Ckd_Seat_Cushions'),
                         (chute, M['chute'], 'Ckd_Seat_Headbox'), ([pad], M['pad'], 'Ckd_Seat_HeadPad'), (yel, M['yellow'], 'Ckd_Seat_HandleY'),
                         (blk, M['black'], 'Ckd_Seat_HandleK'), (web, M['webbing'], 'Ckd_Seat_Webbing'), (met, M['metal'], 'Ckd_Seat_Metal'),
                         (red, M['red'], 'Ckd_Seat_Red')):
        if parts:
            out.append(put(join(parts, nm), m))
    return out


# ================================================================== tub interior
def tub():
    paint, loom, loomw, clamp, sill, met, grn = [], [], [], [], [], [], []
    for sd in (1, -1):
        # frames (formers) on the aft side walls above the consoles, and a stringer between them
        for s in (4.40, 4.66, 4.92, 5.18, 5.42):
            paint.append(bx((sd * 0.405, Y(s), 0.72), (0.022, 0.014, 0.23), bevel=0.003))
            paint.append(bx((sd * 0.395, Y(s), 0.835), (0.04, 0.02, 0.012)))
        paint.append(bx((sd * 0.41, Y(4.92), 0.66), (0.012, 1.1, 0.014)))
        # wiring looms along the walls, with P-clamps, and a white-sleeved branch dropping into each frame bay
        p = [(sd * 0.395, Y(s), 0.785 + 0.006 * math.sin(s * 9)) for s in np.linspace(4.36, 5.48, 9)]
        loom.append(tube(p, 0.011, n=10))
        loom.append(tube([(x + sd * 0.004, y_, z - 0.024) for (x, y_, z) in p], 0.007, n=8))
        for s in (4.53, 4.79, 5.05, 5.30):
            clamp.append(cyl((sd * 0.392, Y(s) + 0.006, 0.785), (sd * 0.392, Y(s) - 0.006, 0.785), 0.015, n=12))
            loomw.append(tube([(sd * 0.393, Y(s), 0.775), (sd * 0.385, Y(s) - 0.02, 0.72), (sd * 0.39, Y(s) - 0.03, 0.66)], 0.005, n=6))
        # padded canopy sill along the top of the wall, with the canopy lock hooks
        sill.append(tube([(sd * 0.415, Y(s), 0.852) for s in np.linspace(3.40, 5.52, 12)], 0.022, n=12))
        for s in (3.9, 4.45, 5.0):
            met.append(bx((sd * 0.405, Y(s), 0.875), (0.02, 0.05, 0.03), bevel=0.004))
            met.append(cyl((sd * 0.393, Y(s) - 0.02, 0.888), (sd * 0.393, Y(s) + 0.02, 0.888), 0.006, n=8))
        # canopy rails (on which the canopy frame seats)
        met.append(bx((sd * 0.428, Y(4.46), 0.873), (0.008, 2.1, 0.012)))
    # oxygen / anti-g / comms connector block on the right console's aft end, and its hoses
    clamp.append(bx((0.30, Y(5.08), 0.62), (0.10, 0.08, 0.06), bevel=0.008))
    grn.append(tube([(0.29, Y(5.06), 0.66), (0.23, Y(4.85), 0.66), (0.14, Y(4.55), 0.58)], 0.016, n=10))
    grn.append(tube([(0.32, Y(5.06), 0.66), (0.28, Y(4.86), 0.62), (0.20, Y(4.6), 0.52)], 0.013, n=10))
    # map case on the left wall aft of the side panel
    paint.append(bx((-0.392, Y(4.62), 0.69), (0.02, 0.22, 0.14), bevel=0.006))
    met.append(bx((-0.381, Y(4.62), 0.755), (0.004, 0.2, 0.008)))
    out = []
    for parts, m, nm in ((paint, M['paint'], 'Ckd_Tub_Frames'), (loom, M['loom'], 'Ckd_Tub_Looms'), (loomw, M['loom_w'], 'Ckd_Tub_LoomsW'),
                         (clamp, M['clamp'], 'Ckd_Tub_Clamps'), (sill, M['sill'], 'Ckd_Tub_Sills'), (met, M['metal'], 'Ckd_Tub_Metal'),
                         (grn, M['green'], 'Ckd_Tub_Hoses')):
        if parts:
            out.append(put(join(parts, nm), m))
    return out


# ================================================================== panel hardware
def panel_frame(tilt=14):
    org = Vector((0, Y(3.62), 0.62))
    up = Vector((0, math.sin(tilt * D2R), math.cos(tilt * D2R)))
    nrm = Vector((0, -math.cos(tilt * D2R), math.sin(tilt * D2R)))
    return org, Vector((1, 0, 0)), up, nrm


def dzus(p, n, parts):
    """quarter-turn fastener head: a low dome with a slot."""
    n = Vector(n).normalized()
    parts.append(cyl(p, p + n * 0.0025, 0.0045, n=10))


def hardware():
    dz, rock, lea, mf = [], [], [], []
    org, right, up, nrm = panel_frame()
    pw, ph = 0.74, 0.42
    on = lambda x, z, d=0.0: org + right * x + up * z + nrm * d
    # main panel perimeter fasteners
    for x in np.linspace(-pw / 2 + 0.02, pw / 2 - 0.02, 12):
        for z in (ph / 2 - 0.015, -ph / 2 + 0.015):
            dzus(on(x, z, 0.0005), nrm, dz)
    for z in np.linspace(-ph / 2 + 0.06, ph / 2 - 0.06, 5):
        for x in (-pw / 2 + 0.012, pw / 2 - 0.012):
            dzus(on(x, z, 0.0005), nrm, dz)
    # MFD bezels: corner fasteners and the four rockers (BRT / CON / SYM / DAY-NT) in the corners
    mfd_w, mfd_h = 0.162, 0.212
    for x in (-0.235, 0.0, 0.235):
        for sx in (-1, 1):
            for sz in (-1, 1):
                dzus(on(x + sx * (mfd_w / 2 + 0.028), -0.03 + sz * (mfd_h / 2 + 0.031), 0.021), nrm, dz)
                c = on(x + sx * (mfd_w / 2 + 0.022), -0.03 + sz * (mfd_h / 2 + 0.022), 0.0215)
                r = bx(c + nrm * 0.004, (0.016, 0.008, 0.016), rot=(14 * D2R, 0, 0), bevel=0.002)
                rock.append(r)
    # console plates: four fasteners each
    top = 0.575
    for sd in (1, -1):
        for s0 in np.arange(3.95, 5.1, 0.19):
            for dx in (-0.074, 0.074):
                for ds in (-0.078, 0.078):
                    dzus(Vector((sd * 0.31 + dx, Y(s0 + 0.09) + ds, top + 0.006)), (0, 0, 1), dz)
    # glareshield: rolled leather edge along the front of the coaming hood
    t = 1.0
    edge = [(x, Y(3.68) - 0.004, 0.90 + 0.05 * (1 - (x / 0.40) ** 2) - 0.06 * t ** 2 - 0.004) for x in np.linspace(-0.40, 0.40, 24)]
    lea.append(tube(edge, 0.011, n=10))
    # rear-view mirror housings: frames round the three mirrors on the canopy arch (moved with the canopy by the sim)
    arch_s = 3.80
    for x, z in ((-0.30, 1.20), (0.0, 1.29), (0.30, 1.20)):
        p = Vector((x, Y(arch_s + 0.03) + 0.008, z))
        mf.append(bx(p, (0.122, 0.014, 0.056), rot=(-20 * D2R, 0, -x * 0.7), bevel=0.005))
        mf.append(cyl(p + Vector((0, 0.01, 0.03)), p + Vector((0, 0.03, 0.06)), 0.006, n=8))
    out = []
    for parts, m, nm in ((dz, M['dzus'], 'Ckd_Dzus'), (rock, M['rocker'], 'Ckd_Rockers'), (lea, M['leather'], 'Ckd_Glareshield'),
                         (mf, M['mirror_frame'], 'Ckd_MirrorFrames')):
        if parts:
            out.append(put(join(parts, nm), m))
    return out



# ================================================================== pilot (external views; hidden in first person)
def sphere(name, c, r, scale=(1, 1, 1), seg=28, ring=16):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=tuple(c), segments=seg, ring_count=ring)
    o = bpy.context.active_object; o.name = name; o.scale = scale
    for cc in o.users_collection: cc.objects.unlink(o)
    COLL.objects.link(o)
    bpy.context.view_layer.update()
    o.data.transform(o.matrix_basis); o.matrix_basis = Matrix.Identity(4)
    return smooth(o)


def pilot():
    suit, vest, gs, hel, trim, vis, mask, boot = [], [], [], [], [], [], [], []
    hip = Vector((0, Y(4.16), 0.50)); sh_c = Vector((0, Y(4.33), 0.93))
    # torso: flight suit with the flotation vest over it
    suit.append(lathe('torso', [(0, 0.15), (0.12, 0.165), (0.30, 0.18), (0.40, 0.175), (0.47, 0.12), (0.50, 0.05)], hip, sh_c - hip, n=20, **K))
    vest.append(lathe('vest', [(0.10, 0.172), (0.22, 0.19), (0.34, 0.195), (0.42, 0.18)], hip, sh_c - hip, n=20, **K))
    for sd in (1, -1):   # vest collar lobes
        vest.append(sphere('collar', sh_c + Vector((sd * 0.07, 0.03, 0.03)), 0.06, (1.2, 1.0, 0.7)))
    # arms: shoulder to elbow (the forearms and gloves are the sim's own hands on the stick and throttle)
    for sd, el in ((1, Vector((0.215, Y(4.16), 0.70))), (-1, Vector((-0.25, Y(4.42), 0.73)))):
        sh = Vector((sd * 0.20, Y(4.33), 0.93))
        suit.append(tube([sh, el], [0.058, 0.05], n=14))
        suit.append(sphere('shoulder', sh, 0.062))
        suit.append(sphere('elbow', el, 0.05))
    # legs in the anti-g suit: hips to knees to the pedals, boots on the pedals
    for sd in (1, -1):
        h0 = Vector((sd * 0.10, Y(4.10), 0.50)); kn = Vector((sd * 0.13, Y(3.70), 0.58)); ft = Vector((sd * 0.12, Y(3.47), 0.20))
        gs.append(tube([h0, (h0 + kn) / 2 + Vector((0, 0, 0.02)), kn], [0.085, 0.075, 0.06], n=16))
        gs.append(sphere('knee', kn, 0.062))
        suit.append(tube([kn, ft + Vector((0, 0, 0.06))], [0.055, 0.045], n=14))
        boot.append(bx(ft + Vector((0, 0.06, -0.01)), (0.095, 0.25, 0.09), bevel=0.025))
        # G-suit bladder lacing on the thigh
        trim.append(tube([h0 + Vector((sd * 0.07, -0.05, 0.03)), kn + Vector((sd * 0.055, 0.0, 0.02))], 0.006, n=6))
    # head: ZSh-7 helmet (shell, visor housing, dark visor half down), KM-34 mask and its hose to the chest connector
    head = Vector((0, Y(4.26), 1.13))
    hel.append(sphere('shell', head + Vector((0, -0.01, 0.01)), 0.142, (0.93, 1.06, 1.0), seg=36, ring=20))
    trim.append(tube([head + Vector((math.sin(a) * 0.135, math.cos(a) * 0.15 - 0.01, -0.055 + 0.04 * math.cos(a))) for a in np.linspace(-1.9, 1.9, 17)], 0.008, n=8))
    house = sphere('visor_house', head + Vector((0, 0.035, 0.075)), 0.15, (0.95, 1.0, 0.55), seg=32, ring=14)
    hel.append(house)
    # visor: the front band of a slightly larger shell
    import bmesh
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=36, v_segments=18, radius=0.152)
    kill = [f for f in bm.faces if not (f.calc_center_median().y > 0.06 and -0.035 < f.calc_center_median().z < 0.085)]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    me = bpy.data.meshes.new('visor'); bm.to_mesh(me); bm.free()
    vo = bpy.data.objects.new('visor', me); COLL.objects.link(vo)
    vo.location = head; vo.scale = (0.94, 1.06, 1.0); bpy.context.view_layer.update()
    vo.data.transform(vo.matrix_basis); vo.matrix_basis = Matrix.Identity(4); vis.append(smooth(vo))
    m0 = head + Vector((0, 0.115, -0.065))
    mask.append(lathe('mask', [(0, 0.058), (0.05, 0.052), (0.09, 0.03), (0.105, 0.012)], m0, (0, 1, -0.5), n=18, **K))
    for sd in (1, -1):
        mask.append(tube([m0 + Vector((sd * 0.05, 0.01, 0.02)), head + Vector((sd * 0.125, 0.02, 0.0))], 0.006, n=6))   # bayonet straps
    mask.append(tube([m0 + Vector((0, 0.09, -0.04)), m0 + Vector((0.03, 0.08, -0.15)), sh_c + Vector((0.08, 0.13, -0.20)), sh_c + Vector((0.13, 0.12, -0.32))], 0.017, n=10))
    out = []
    for parts, m, nm in ((suit, M['suit'], 'Pilot2_Suit'), (vest, M['vest'], 'Pilot2_Vest'), (gs, M['gsuit'], 'Pilot2_GSuit'), (hel, M['helmet'], 'Pilot2_Helmet'),
                         (trim, M['helmet_trim'], 'Pilot2_Trim'), (vis, M['visor'], 'Pilot2_Visor'), (mask, M['mask'], 'Pilot2_Mask'), (boot, M['boot'], 'Pilot2_Boots')):
        if parts:
            out.append(put(join(parts, nm), m))
    root = bpy.data.objects.new('Pilot2', None); COLL.objects.link(root)
    for o in out:
        parent_keep(o, root)
    return out


objs = seat() + tub() + hardware() + pilot()
for o in objs:
    if o.name == 'Ckd_MirrorFrames':
        o['canopy'] = 1          # the sim parents this to the canopy so it opens with it
os.makedirs(OUT, exist_ok=True)
dst = os.path.join(OUT, 'cockpit_detail.gltf')
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLTF_SEPARATE', export_extras=True, export_apply=True,
                          export_yup=True, export_cameras=False, export_lights=False, use_selection=False)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'cockpit_detail.blend'))
tris = sum(len(o.data.polygons) for o in objs)
print('cockpit detail exported:', len(objs), 'objects,', tris, 'faces')
