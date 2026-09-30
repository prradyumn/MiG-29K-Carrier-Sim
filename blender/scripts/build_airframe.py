"""Primary airframe: fuselage, LERX body, nacelles, intakes, booms, wings + control surfaces, tails, canopy."""
import bpy, bmesh, math
import numpy as np
from mathutils import Vector, Matrix
from lib import *

D2R = math.pi / 180
COL = {}


def coll(name):
    if name not in COL:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
        COL[name] = c
    return COL[name]


def stations(a, b, n, cluster=None):
    t = np.linspace(0, 1, n)
    if cluster == 'start':
        t = t ** 1.8
    elif cluster == 'both':
        t = (1 - np.cos(t * math.pi)) / 2
    return a + (b - a) * t


# ============================================================ FUSELAGE (forebody + spine + beaver tail)
FUS = [  # s, hw, zt, zmid, zb, n_top, n_bot
    (1.90, 0.475, 0.58, 0.165, -0.25, 2.0, 2.0),
    (2.50, 0.530, 0.71, 0.200, -0.29, 2.2, 2.3),
    (2.95, 0.565, 0.84, 0.240, -0.31, 2.7, 2.5),
    (3.60, 0.600, 0.87, 0.280, -0.32, 3.3, 2.6),
    (4.50, 0.615, 0.88, 0.300, -0.32, 3.5, 2.6),
    (5.25, 0.615, 0.89, 0.300, -0.30, 3.4, 2.6),
    (5.75, 0.615, 0.925, 0.300, -0.27, 3.1, 2.6),
    (6.30, 0.612, 0.965, 0.300, -0.24, 2.7, 2.6),
    (7.50, 0.605, 0.960, 0.300, -0.20, 2.5, 2.6),
    (9.00, 0.585, 0.910, 0.300, -0.18, 2.4, 2.6),
    (10.5, 0.550, 0.830, 0.290, -0.18, 2.4, 2.6),
    (12.0, 0.500, 0.720, 0.270, -0.18, 2.4, 2.6),
    (13.3, 0.445, 0.560, 0.210, -0.19, 2.6, 2.8),
    (14.5, 0.400, 0.380, 0.120, -0.21, 3.0, 3.0),
    (15.4, 0.360, 0.180, -0.02, -0.27, 3.5, 3.5),
    (15.9, 0.280, 0.060, -0.10, -0.25, 3.0, 3.0),
    (16.12, 0.10, -0.06, -0.14, -0.21, 2.5, 2.5),
]
RAD_L = 1.90
RAD_R = 0.475


def radome_f(t):
    R, L = 1.0, 1.0 / 0.2375  # normalized tangent ogive (L/R = 1.9/0.45)
    rho = (R * R + L * L) / (2 * R)
    x = t * L
    return (math.sqrt(max(rho * rho - (L - x) ** 2, 0)) + R - rho) / R


def fus_section(s):
    if s < RAD_L:
        t = max(s / RAD_L, 1e-4)
        f = radome_f(t)
        hw = 0.475 * f
        ht = 0.415 * f
        zc = 0.165 * (1 - (1 - t) ** 1.6)
        return hw, zc + ht, zc, zc - ht, 2.0, 2.0
    return cr_interp(FUS, s)


def build_fuselage():
    c = coll('Airframe')
    ss = list(np.concatenate([stations(0.0, RAD_L, 40, 'start')[:-1], stations(RAD_L, 16.12, 190)]))
    N = 112
    rings = []
    for s in ss:
        hw, zt, zm, zb, nt, nb = fus_section(s)
        rings.append(superellipse_ring(0, zm, hw, zt - zm, zm - zb, nt, nb, N, Y(s)))
    ob = loft('Fuselage', rings, closed=True, cap0=False, cap1=True, coll=c, auto_smooth=60)
    # tip point: collapse first ring to a point
    me = ob.data
    for k in range(N):
        me.vertices[k].co = Vector((0, Y(0.0), 0.0))
    # open the cockpit
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    kill = []
    for f in bm.faces:
        cc = f.calc_center_median()
        s = S0 - cc.y
        if 3.05 < s < 5.55 and cc.z > 0.80 and abs(cc.x) < 0.43:
            kill.append(f)
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bm.to_mesh(me)
    bm.free()
    fix_normals(ob)
    set_auto_smooth(ob, 60)
    return ob


# ============================================================ LERX / WING-BODY BLEND
BODY = [  # s, half-width, edge z, t_up, t_low
    (3.40, 0.50, 0.290, 0.02, 0.02),
    (4.20, 0.78, 0.270, 0.06, 0.05),
    (5.00, 1.03, 0.240, 0.10, 0.07),
    (6.50, 1.44, 0.160, 0.17, 0.11),
    (7.80, 1.790, 0.075, 0.24, 0.17),
    (9.00, 1.810, 0.060, 0.24, 0.20),
    (10.5, 1.820, 0.055, 0.19, 0.19),
    (12.0, 1.800, 0.045, 0.10, 0.16),
    (13.5, 1.700, 0.030, 0.04, 0.12),
    (14.5, 1.600, 0.010, 0.03, 0.10),
    (15.2, 1.300, 0.000, 0.02, 0.08),
    (15.45, 1.00, -0.010, 0.03, 0.06),
]


def build_body():
    c = coll('Airframe')
    ss = stations(3.4, 15.45, 150)
    M = 40  # per half surface
    rings = []
    for s in ss:
        hw, ze, tu, tl = cr_interp(BODY, s)
        xs = hw * np.cos(np.linspace(0, math.pi, M))  # +hw -> -hw
        ring = []
        for x in xs:  # upper, starboard->port
            r = min(abs(x) / hw, 1)
            ring.append((x, Y(s), ze + tu * (1 - r * r) ** 0.85))
        for x in xs[::-1][1:-1]:  # lower port->starboard
            r = min(abs(x) / hw, 1)
            ring.append((x, Y(s), ze - tl * (1 - r * r) ** 0.85))
        rings.append(ring)
    return loft('BodyLERX', rings, closed=True, cap0=True, cap1=True, coll=c, auto_smooth=50)


# ============================================================ ENGINE NACELLES + INTAKES
NAC = [  # s, xc, a, zc, b, n
    (5.00, 1.050, 0.330, -0.440, 0.405, 4.2),
    (6.00, 1.050, 0.370, -0.440, 0.430, 3.6),
    (8.00, 1.020, 0.420, -0.430, 0.445, 2.7),
    (10.0, 0.970, 0.465, -0.420, 0.455, 2.4),
    (12.0, 0.920, 0.495, -0.425, 0.470, 2.15),
    (13.5, 0.880, 0.500, -0.445, 0.490, 2.0),
    (14.15, 0.870, 0.500, -0.450, 0.500, 2.0),
]
LIP_S = 5.0
RAKE = 0.42  # top lip this much aft of bottom lip


def nac_ring(s, side, N, inset=0.0, extra_s=0.0):
    xc, a, zc, b, n = cr_interp(NAC, s)
    top, ntop = interp_table([(5.0, 0.16, 1.2), (7.0, 0.22, 1.0), (11.0, 0.26, 0.4), (12.5, 0.20, 0.1), (13.6, 0.11, 0.0), (14.15, 0.0, 0.0)], s)
    ring = superellipse_ring(side * xc, zc + top / 2, a - inset, b + top / 2 - inset, b + top / 2 - inset, n + ntop, n, N, 0)
    out = []
    for (x, _, z) in ring:
        zb = zc - b
        frac = min(max((z - zb) / (2 * b), 0), 1)
        sr = s + extra_s + (RAKE * frac if s <= LIP_S + 1e-6 else 0)
        out.append((x, Y(sr), z))
    return out


def build_nacelle(side):
    c = coll('Airframe')
    N = 64
    nm = 'R' if side > 0 else 'L'
    ss = stations(LIP_S, 14.15, 110, 'start')
    rings = []
    # lip: inner ring, rounded lip, outer
    rings.append(nac_ring(LIP_S, side, N, inset=0.045, extra_s=0.10))
    rings.append(nac_ring(LIP_S, side, N, inset=0.030, extra_s=0.01))
    rings.append(nac_ring(LIP_S, side, N, inset=0.012, extra_s=-0.015))
    for s in ss:
        rings.append(nac_ring(s, side, N))
    # rake the whole group so that first 3 rings follow rake (already) and following rings near lip
    ob = loft('Nacelle_' + nm, rings, closed=True, coll=c, auto_smooth=50)
    # inner duct (dark)
    drings = [nac_ring(LIP_S, side, N, inset=0.045, extra_s=0.10)]
    for s in stations(LIP_S + 0.25, 7.2, 14):
        xc, a, zc, b, n = cr_interp(NAC, s)
        f = (s - LIP_S) / (7.2 - LIP_S)
        bb = (b + 0.08 - 0.045) * (1 - 0.15 * f)
        ring = superellipse_ring(side * (xc - 0.10 * f), zc + 0.08 + 0.03 * f, (a - 0.045) * (1 - 0.2 * f), bb, bb,
                                 n + 1.2 - 1.5 * f, n - 0.8 * f, N, Y(s + 0.10))
        drings.append(ring)
    duct = loft('IntakeDuct_' + nm, drings, closed=True, cap1=True, coll=c, auto_smooth=60)
    return ob, duct


# ============================================================ TAIL BOOMS
BOOM = [  # s, xc, a, zc, bt, bb, n
    (10.6, 1.64, 0.06, 0.06, 0.05, 0.05, 2.0),
    (11.6, 1.70, 0.15, 0.05, 0.16, 0.12, 2.2),
    (12.8, 1.73, 0.19, 0.04, 0.24, 0.21, 2.4),
    (13.8, 1.74, 0.20, 0.03, 0.27, 0.24, 2.5),
    (14.8, 1.74, 0.19, 0.02, 0.24, 0.24, 2.5),
    (15.35, 1.73, 0.165, 0.01, 0.18, 0.20, 2.4),
    (15.62, 1.72, 0.11, 0.0, 0.10, 0.12, 2.2),
    (15.74, 1.71, 0.03, 0.0, 0.03, 0.035, 2.0),
]


def build_boom(side):
    c = coll('Airframe')
    rings = []
    for s in stations(10.6, 15.74, 60):
        xc, a, zc, bt, bb, n = cr_interp(BOOM, s)
        rings.append(superellipse_ring(side * xc, zc, a, bt, bb, n, n, 40, Y(s)))
    return loft('Boom_' + ('R' if side > 0 else 'L'), rings, closed=True, cap0=True, cap1=True, coll=c, auto_smooth=50)


# ============================================================ PIVOT FRAMES
def set_pivot_frame(ob, p, xaxis, zhint=(0, 0, 1)):
    """Re-express object so its origin is p and local X is along xaxis (hinge)."""
    x = Vector(xaxis).normalized()
    zh = Vector(zhint)
    yv = zh.cross(x).normalized()
    z = x.cross(yv).normalized()
    R = Matrix((x, yv, z)).transposed().to_4x4()
    M = Matrix.Translation(Vector(p)) @ R
    mw = ob.matrix_world.copy()
    ob.data.transform(M.inverted() @ mw)
    ob.matrix_world = M
    ob['hinge'] = True


# ============================================================ WINGS
TAN_LE = math.tan(41 * D2R)
ANH = math.tan(-2.0 * D2R)


def wing_plan(w):
    le = 7.78 + (w - 1.76) * TAN_LE
    te = 12.68 - (w - 1.76) * 0.025
    return le, te


def wing_t(w):
    return 0.056 - max(w - 1.8, 0) / 4.2 * 0.014


def wing_z(w):
    return 0.065 + (w - 1.8) * ANH


def wing_twist(w):
    return -1.5 * max(w - 1.8, 0) / 4.2


def chord_point(w, cf, zf_rel=0.0, side=1):
    le, te = wing_plan(w)
    ch = te - le
    s = le + cf * ch
    return Vector((side * w, Y(s), wing_z(w) + zf_rel * ch))


def build_wing(side):
    c = coll('Airframe')
    nm = 'R' if side > 0 else 'L'
    kw = dict(plan=wing_plan, tfun=wing_t, z0fun=wing_z, twistfun=wing_twist, side=side, coll=c)
    parts = {}
    parts['root'] = surface_panel('WingRoot_' + nm, 1.30, 1.93, c0=0.0, c1=1.0, nspan=4, nchord=34, **kw)
    parts['inner'] = surface_panel('WingInner_' + nm, 1.90, 3.84, c0=0.135, c1=0.758, nspan=12, nchord=20, **kw)
    parts['slat_in'] = surface_panel('SlatInner_' + nm, 1.94, 3.82, c0=0.0, c1=0.128, nspan=10, nchord=14, **kw)
    parts['flap'] = surface_panel('Flap_' + nm, 1.95, 3.80, c0=0.772, c1=1.0, nspan=10, nchord=10, **kw)
    parts['outer'] = surface_panel('WingOuter_' + nm, 3.87, 5.88, c0=0.135, c1=0.758, nspan=12, nchord=20, **kw)
    parts['slat_out'] = surface_panel('SlatOuter_' + nm, 3.89, 5.86, c0=0.0, c1=0.128, nspan=10, nchord=14, **kw)
    parts['aileron'] = surface_panel('Aileron_' + nm, 3.92, 5.82, c0=0.772, c1=1.0, nspan=10, nchord=10, **kw)
    parts['tip'] = surface_panel('WingTip_' + nm, 5.86, 6.00, c0=0.0, c1=1.0, nspan=2, nchord=34, **kw)
    parts['fold_in'] = surface_panel('FoldRibIn_' + nm, 3.835, 3.855, c0=0.0, c1=1.0, nspan=1, nchord=34, **kw)
    # outer panel incl. surfaces as one hierarchy — join static bits
    outer = join([parts['outer'], parts['tip']], 'WingOuter_' + nm)
    inner = join([parts['inner'], parts['fold_in']], 'WingInner_' + nm)
    parts['outer'] = outer
    parts['inner'] = inner
    del parts['tip'], parts['fold_in']
    # hinges
    fl_a = chord_point(1.95, 0.772, 0.0, side)
    fl_b = chord_point(3.80, 0.772, 0.0, side)
    set_pivot_frame(parts['flap'], fl_a, (fl_b - fl_a) * side)
    ai_a = chord_point(3.92, 0.772, 0.0, side)
    ai_b = chord_point(5.82, 0.772, 0.0, side)
    set_pivot_frame(parts['aileron'], ai_a, (ai_b - ai_a) * side)
    for key, (w0, w1) in (('slat_in', (1.94, 3.82)), ('slat_out', (3.89, 5.86))):
        a = chord_point(w0, 0.128, 0.0, side)
        b = chord_point(w1, 0.128, 0.0, side)
        set_pivot_frame(parts[key], a, (b - a) * side)
    # fold hinge: along the chord line at w = 3.86 (upper surface)
    fa = chord_point(3.86, 0.0, 0.03, side)
    fb = chord_point(3.86, 1.0, 0.03, side)
    set_pivot_frame(outer, fa, (fb - fa))
    for k in ('slat_out', 'aileron'):
        parent_keep(parts[k], outer)
    return parts


# ============================================================ STABILATORS
def stab_plan(w):
    le = 13.30 + (w - 1.75) * math.tan(50 * D2R)
    te = 15.62 + (w - 1.75) * 0.52
    return le, te


def build_stab(side):
    c = coll('Airframe')
    nm = 'R' if side > 0 else 'L'
    ob = surface_panel('Stabilator_' + nm, 1.78, 3.90, stab_plan, 0.0, 1.0, lambda w: 0.042 - 0.01 * (w - 1.78) / 2.1,
                       nspan=14, nchord=30, side=side, z0fun=lambda w: -0.02, m=0.0, coll=c)
    set_pivot_frame(ob, (side * 1.9, Y(14.95), -0.02), (1, 0, 0))
    return ob


# ============================================================ FINS + RUDDERS
CANT = 6.0 * D2R
FIN_X = 1.745
FIN_Z = 0.28


def fin_plan(h):
    return 12.40 + h * math.tan(47.5 * D2R), 15.25 + h * 0.03


def fin_xform(side):
    sd = Vector((side * math.sin(CANT), 0, math.cos(CANT)))
    td = Vector((side * math.cos(CANT), 0, -math.sin(CANT)))  # 'thickness' axis -> outboard

    def f(h, s, z):
        p = Vector((side * FIN_X, Y(s), FIN_Z)) + sd * h + td * z
        return tuple(p)
    return f


def fin_t(h):
    return 0.05 - 0.012 * max(h, 0) / 2.05


def build_fin(side):
    c = coll('Airframe')
    nm = 'R' if side > 0 else 'L'
    xf = fin_xform(side)
    kw = dict(plan=fin_plan, tfun=fin_t, m=0.0, xform=xf, coll=c)
    lo = surface_panel('FinLow_' + nm, -0.25, 0.26, c0=0.0, c1=1.0, nspan=3, nchord=30, **kw)
    mid = surface_panel('FinMid_' + nm, 0.24, 1.76, c0=0.0, c1=0.735, nspan=10, nchord=24, **kw)
    hi = surface_panel('FinTop_' + nm, 1.74, 2.05, c0=0.0, c1=1.0, nspan=3, nchord=30, **kw)
    fin = join([lo, mid, hi], 'Fin_' + nm)
    rud = surface_panel('Rudder_' + nm, 0.27, 1.73, c0=0.748, c1=1.0, nspan=8, nchord=10, **kw)
    le0, te0 = fin_plan(0.27)
    le1, te1 = fin_plan(1.73)
    a = Vector(xf(0.27, le0 + 0.748 * (te0 - le0), 0))
    b = Vector(xf(1.73, le1 + 0.748 * (te1 - le1), 0))
    set_pivot_frame(rud, a, (b - a), zhint=(0, 1, 0))
    # dorsal fillet at fin LE root
    rings = []
    for s in stations(11.25, 12.75, 12):
        t = (s - 11.25) / 1.5
        hgt = 0.02 + 0.28 * t ** 1.6
        wid = 0.012 + 0.03 * t
        base = Vector((side * FIN_X, Y(s), FIN_Z - 0.06))
        sd = Vector((side * math.sin(CANT), 0, math.cos(CANT)))
        td = Vector((side * math.cos(CANT), 0, -math.sin(CANT)))
        rings.append([tuple(base + sd * (hgt * (0.5 + 0.5 * math.sin(a2))) + td * (wid * math.cos(a2))) for a2 in np.linspace(0, 2 * math.pi, 16, endpoint=False)])
    fil = loft('FinFillet_' + nm, rings, closed=True, cap0=True, cap1=True, coll=c)
    return join([fin, fil], 'Fin_' + nm), rud


# ============================================================ CANOPY
CAN = [  # s, half width at sill, height above sill
    (2.95, 0.340, 0.000),
    (3.20, 0.390, 0.170),
    (3.50, 0.425, 0.330),
    (3.80, 0.440, 0.450),
    (4.20, 0.445, 0.540),
    (4.60, 0.445, 0.580),
    (5.00, 0.440, 0.575),
    (5.40, 0.425, 0.520),
    (5.80, 0.390, 0.410),
    (6.10, 0.350, 0.280),
    (6.40, 0.300, 0.130),
]
SILL = 0.84


def canopy_ring(s, n=40, off=0.0):
    hw, h = cr_interp(CAN, s)[0], cr_interp(CAN, s)[1]
    pts = []
    for k in range(n + 1):
        th = math.pi * k / n  # 0 -> starboard sill, pi -> port sill
        c, sn = math.cos(th), math.sin(th)
        ex = 2.4
        x = (hw + off) * np.sign(c) * abs(c) ** (2 / ex)
        z = SILL + (h + off) * sn ** (2 / 2.1)
        pts.append((x, Y(s), z))
    return pts


def build_canopy():
    c = coll('Airframe')
    ws = [canopy_ring(s) for s in stations(2.95, 3.78, 14)]
    wsob = loft('Windscreen', ws, closed=False, coll=c, auto_smooth=0)
    cn = [canopy_ring(s) for s in stations(3.79, 6.40, 30)]
    cnob = loft('Canopy', cn, closed=False, coll=c, auto_smooth=0)
    # rear canopy closure (glass bulkhead is not glass: frame plate)
    # frames
    fr = []
    fr.append(tube_along('CanopyArch', canopy_ring(3.785, 30, 0.012), 0.022, n=8, coll=c))
    fr.append(tube_along('WSBase', canopy_ring(2.97, 20, 0.0), 0.02, n=8, coll=c))
    for side in (1, -1):
        rail = [(side * (cr_interp(CAN, s)[0] + 0.005), Y(s), SILL + 0.01) for s in stations(2.96, 6.38, 34)]
        fr.append(tube_along('Sill', rail, 0.028, n=8, coll=c))
    fr.append(tube_along('CanopyRear', canopy_ring(6.36, 30, 0.01), 0.025, n=8, coll=c))
    # mid canopy bow (MiG-29K canopy has a light rear bow)
    frame_fixed = join([fr[0], fr[1]], 'WindscreenFrame')
    frame_mov = join(fr[2:], 'CanopyFrame')
    return wsob, cnob, frame_fixed, frame_mov


def build_all():
    out = {}
    out['fus'] = build_fuselage()
    out['body'] = build_body()
    out['nacR'], out['ductR'] = build_nacelle(1)
    out['nacL'], out['ductL'] = build_nacelle(-1)
    out['boomR'] = build_boom(1)
    out['boomL'] = build_boom(-1)
    out['wingR'] = build_wing(1)
    out['wingL'] = build_wing(-1)
    out['stabR'] = build_stab(1)
    out['stabL'] = build_stab(-1)
    out['finR'], out['rudR'] = build_fin(1)
    out['finL'], out['rudL'] = build_fin(-1)
    out['ws'], out['can'], out['wsf'], out['canf'] = build_canopy()
    return out
