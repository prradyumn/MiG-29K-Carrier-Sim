"""Secondary parts: nozzles, landing gear, sensors, probes, lights, pylons and stores, airbrake, hook."""
import bpy, bmesh, math
import numpy as np
from mathutils import Vector, Matrix
from lib import *
import build_airframe as A

D2R = math.pi / 180


def C(name):
    return A.coll(name)


def empty(name, loc, coll, parent=None):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.3
    coll.objects.link(e)
    e.location = loc
    if parent:
        e.parent = parent
    return e


# ------------------------------------------------------------------ NOZZLES
def ring_axis(c, d, r, n, amp=0.0, petals=16, phase=0.0):
    d = Vector(d).normalized()
    u = Vector((1, 0, 0)) if abs(d.x) < 0.9 else Vector((0, 0, 1))
    u = (u - d * u.dot(d)).normalized()
    v = d.cross(u)
    pts = []
    for k in range(n):
        a = 2 * math.pi * k / n
        fr = ((a / (2 * math.pi) * petals + phase) % 1.0)
        mod = 1 + amp * (fr - 0.5) * 2 if amp else 1
        pts.append(tuple(c + (u * math.cos(a) + v * math.sin(a)) * r * mod))
    return pts


def build_nozzle(side):
    col = C('Engines')
    nm = 'R' if side > 0 else 'L'
    base = Vector((side * 0.87, A.Y(14.10), -0.45))
    d = Vector((0, -1, 0.0))
    N = 96
    outer_prof = [(0.0, 0.503, 0), (0.25, 0.505, 0), (0.50, 0.499, 0.0), (0.62, 0.492, 0.010), (0.80, 0.482, 0.014),
                  (1.00, 0.470, 0.016), (1.18, 0.460, 0.016), (1.25, 0.455, 0.012)]
    rings = [ring_axis(base + d * t, d, r, N, amp, 16) for (t, r, amp) in outer_prof]
    # lip
    rings.append(ring_axis(base + d * 1.262, d, 0.448, N, 0.008, 16))
    rings.append(ring_axis(base + d * 1.25, d, 0.438, N, 0.004, 16))
    outer = loft('NozzleOuter_' + nm, rings, closed=True, coll=col, auto_smooth=70)
    inner_prof = [(1.25, 0.438), (1.05, 0.428), (0.85, 0.410), (0.65, 0.385), (0.50, 0.372), (0.38, 0.385), (0.20, 0.420),
                  (0.0, 0.445), (-0.4, 0.45), (-0.9, 0.45)]
    rings = [ring_axis(base + d * t, d, r, 48) for (t, r) in inner_prof]
    inner = loft('NozzleInner_' + nm, rings, closed=True, cap1=True, coll=col, auto_smooth=70)
    # afterburner flame holder rings & engine tail cone
    parts = []
    for (t, r) in ((-0.25, 0.30), (-0.25, 0.18)):
        c0 = base + d * t
        prof = []
        rings = []
        for k in range(8):
            a = 2 * math.pi * k / 8
            rr = r + 0.03 * math.cos(a)
            rings.append(ring_axis(c0 + d * (0.03 * math.sin(a)), d, rr, 48))
        parts.append(loft('FH', rings, closed=True, coll=col))
    cone = lathe('TailCone', [(-0.85, 0.16), (-0.6, 0.14), (-0.35, 0.07), (-0.2, 0.01)], base, d, n=24, cap0=True, cap1=False, coll=col)
    fh = join(parts + [cone], 'FlameHolder_' + nm)
    # AB glow disc (emissive, driven by the sim)
    glow = lathe('ABGlow_' + nm, [(-0.55, 0.445), (-0.55, 0.0)], base, d, n=48, cap0=False, cap1=False, coll=col)
    return outer, inner, fh, glow


# ------------------------------------------------------------------ WHEELS
def wheel(name, center, axis, R, W, hubR, col):
    ax = Vector(axis).normalized()
    c = Vector(center)
    prof = []
    # tire cross-section profile (t along axle, radius)
    for k in range(17):
        a = -math.pi / 2 + math.pi * k / 16
        t = math.sin(a) * W / 2
        r = hubR + (R - hubR) * (0.25 + 0.75 * math.cos(a) ** 0.6)
        prof.append((t, r))
    tire = lathe(name + '_Tire', prof, c, ax, n=48, cap0=False, cap1=False, coll=col, auto_smooth=80)
    hub = lathe(name + '_Hub', [(-W * 0.46, hubR * 1.02), (-W * 0.46, hubR * 0.55), (-W * 0.30, hubR * 0.45), (-W * 0.30, 0.04),
                                (W * 0.30, 0.04), (W * 0.30, hubR * 0.45), (W * 0.46, hubR * 0.55), (W * 0.46, hubR * 1.02)],
                c, ax, n=32, cap0=False, cap1=False, coll=col, auto_smooth=30)
    # hub bolts
    bolts = []
    u = Vector((0, 0, 1)) if abs(ax.z) < 0.9 else Vector((1, 0, 0))
    u = (u - ax * u.dot(ax)).normalized()
    v = ax.cross(u)
    for k in range(8):
        a = 2 * math.pi * k / 8
        p = c + (u * math.cos(a) + v * math.sin(a)) * hubR * 0.35
        for sgn in (-1, 1):
            bolts.append(cylinder('bolt', p + ax * sgn * W * 0.30, p + ax * sgn * W * 0.34, 0.012, n=6, coll=col))
    hub = join([hub] + bolts, name + '_Hub')
    return tire, hub


# ------------------------------------------------------------------ LANDING GEAR
def build_gear(mats):
    col = C('Gear')
    out = {}
    # ---- nose gear (twin wheel)
    P = Vector((0, A.Y(6.02), -0.27))
    axle = Vector((0, A.Y(6.22), -1.455))
    root = empty('Gear_Nose', P, col)
    parts = []
    k1 = P + (axle - P) * 0.52
    parts.append(cylinder('ng_cyl', P + Vector((0, 0, 0.03)), k1, 0.075, n=20, coll=col))
    parts.append(cylinder('ng_piston', k1, axle + Vector((0, 0.0, 0.08)), 0.052, n=20, coll=col))
    parts.append(cylinder('ng_collar', k1 + Vector((0, 0, 0.03)), k1 - Vector((0, 0, 0.05)), 0.09, n=20, coll=col))
    parts.append(cylinder('ng_axle', axle + Vector((-0.2, 0, 0)), axle + Vector((0.2, 0, 0)), 0.04, n=12, coll=col))
    parts.append(box('ng_fork', axle + Vector((0, 0, 0.09)), (0.14, 0.12, 0.16), coll=col))
    # torque links
    parts.append(tube_along('ng_tl', [k1 + Vector((0, 0.08, -0.08)), (k1 + axle) / 2 + Vector((0, 0.16, 0)), axle + Vector((0, 0.08, 0.14))], 0.018, n=6, coll=col))
    # drag brace
    parts.append(tube_along('ng_brace', [P + (axle - P) * 0.35, Vector((0, A.Y(5.55), -0.30))], 0.03, n=10, coll=col))
    parts.append(tube_along('ng_brace2', [P + (axle - P) * 0.35 + Vector((0.08, 0, 0)), Vector((0.08, A.Y(5.55), -0.30))], 0.02, n=8, coll=col))
    # mudguard
    rings = []
    for a in np.linspace(75, 195, 14):
        ar = a * D2R
        c0 = axle + Vector((0, math.cos(ar) * 0.33, math.sin(ar) * 0.33))
        rings.append([tuple(c0 + Vector((x, 0, 0))) for x in (-0.21, 0.21)])
    mg = loft('ng_mudguard', rings, closed=False, coll=col, smooth=True)
    sol = mg.modifiers.new('s', 'SOLIDIFY'); sol.thickness = 0.012
    apply_mods(mg)
    parts.append(mg)
    # landing / taxi lights
    lights = []
    for dz, dx in ((-0.60, 0.0), (-0.70, 0.0)):
        lp = P + (axle - P) * 0.42 + Vector((dx, 0.10, dz + 0.55))
        lb = cylinder('ng_lamp', lp, lp + Vector((0, 0.07, 0)), 0.065, n=16, coll=col)
        lights.append(lb)
        lights.append(cylinder('ng_lampglass', lp + Vector((0, 0.07, 0)), lp + Vector((0, 0.075, 0)), 0.058, n=16, coll=col))
    strut = join(parts, 'NoseStrut')
    assign(strut, mats['gear'])
    lamp_body = join([l for i, l in enumerate(lights) if i % 2 == 0], 'NoseLampBody')
    assign(lamp_body, mats['gear'])
    lamp_glass = join([l for i, l in enumerate(lights) if i % 2 == 1], 'NoseLampGlass')
    assign(lamp_glass, mats['lamp'])
    wparts = []
    for x in (-0.115, 0.115):
        t, h = wheel('NoseWheel', axle + Vector((x, 0, 0)), (1, 0, 0), 0.285, 0.165, 0.16, col)
        assign(t, mats['tire']); assign(h, mats['hub'])
        wparts += [t, h]
    tl = [p for p in wparts if 'Tire' in p.name]
    hl = [p for p in wparts if 'Hub' in p.name]
    tires = join(tl, 'NoseTires')
    hubs = join(hl, 'NoseHubs')
    for o in (strut, lamp_body, lamp_glass, tires, hubs):
        parent_keep(o, root)
    # nose gear doors (open, hanging)
    doors = []
    for sx in (-1, 1):
        d = box('NoseDoor', (sx * 0.24, A.Y(6.35), -0.52), (0.018, 1.25, 0.46), coll=col)
        d.rotation_euler = (0, sx * 8 * D2R, 0)
        doors.append(d)
    nd = join(doors, 'NoseGearDoors')
    assign(nd, mats['airframe_misc'])
    out['nose'] = root
    out['nose_doors'] = nd
    # ---- main gear
    for side in (1, -1):
        nm = 'R' if side > 0 else 'L'
        P = Vector((side * 1.36, A.Y(9.72), -0.28))
        K = Vector((side * 1.37, A.Y(9.95), -1.02))
        Ap = Vector((side * 1.37, A.Y(10.17), -1.32))
        Wc = Vector((side * 1.56, A.Y(10.17), -1.32))
        root = empty('Gear_Main_' + nm, P, col)
        parts = []
        parts.append(cylinder('mg_cyl', P + Vector((0, 0, 0.03)), P + (K - P) * 0.62, 0.095, n=20, coll=col))
        parts.append(cylinder('mg_pis', P + (K - P) * 0.55, K, 0.07, n=20, coll=col))
        parts.append(cylinder('mg_collar', P + (K - P) * 0.6 + Vector((0, 0, 0.03)), P + (K - P) * 0.6 - Vector((0, 0, 0.04)), 0.11, n=20, coll=col))
        parts.append(tube_along('mg_arm', [K, Ap], 0.065, n=14, coll=col))
        parts.append(cylinder('mg_knuckle', K - Vector((side * 0.08, 0, 0)), K + Vector((side * 0.08, 0, 0)), 0.08, n=14, coll=col))
        parts.append(cylinder('mg_axle', Ap, Wc + Vector((side * 0.05, 0, 0)), 0.05, n=12, coll=col))
        # shock absorber strut between cyl and arm
        parts.append(tube_along('mg_shock', [P + (K - P) * 0.4 + Vector((0, -0.12, 0)), (K + Ap) / 2 + Vector((0, 0, 0.05))], 0.035, n=8, coll=col))
        # side brace to wing
        parts.append(tube_along('mg_brace', [P + (K - P) * 0.45, Vector((side * 1.82, A.Y(9.85), -0.05))], 0.04, n=10, coll=col))
        parts.append(tube_along('mg_brace2', [P + (K - P) * 0.45, Vector((side * 1.55, A.Y(9.35), -0.25))], 0.03, n=10, coll=col))
        # brake lines
        parts.append(tube_along('mg_line', [P + Vector((side * 0.1, 0, -0.1)), K + Vector((side * 0.09, 0.05, 0.02)), Ap + Vector((side * 0.09, 0.02, 0.03))], 0.008, n=5, coll=col))
        strut = join(parts, 'MainStrut_' + nm)
        assign(strut, mats['gear'])
        t, h = wheel('MainWheel_' + nm, Wc, (1, 0, 0), 0.42, 0.29, 0.25, col)
        assign(t, mats['tire']); assign(h, mats['hub'])
        # leg door (outboard, attached to strut)
        door = box('MainDoor_' + nm, (side * 1.28, A.Y(9.78), -0.62), (0.02, 0.95, 0.70), coll=col, bevel=0.0)
        door.rotation_euler = (8 * D2R, side * -4 * D2R, 0)
        assign(door, mats['airframe_misc'])
        for o in (strut, t, h, door):
            parent_keep(o, root)
        out['main_' + nm] = root
        # inner bay door (hinged at fuselage underside, open)
        bd = box('MainBayDoor_' + nm, (side * 1.05, A.Y(9.65), -0.95), (0.02, 1.0, 0.36), coll=col)
        bd.rotation_euler = (0, side * -20 * D2R, 0)
        assign(bd, mats['airframe_misc'])
        out['bay_' + nm] = bd
    return out


# ------------------------------------------------------------------ SMALL DETAILS
def build_details(mats):
    col = C('Details')
    out = {}
    # pitot boom
    tip = Vector((0, A.Y(0.0), 0.0))
    fw = Vector((0, 1, -0.012)).normalized()
    pit = lathe('Pitot', [(-0.05, 0.075), (0.0, 0.055), (0.25, 0.035), (0.40, 0.022), (1.05, 0.018), (1.12, 0.012), (1.18, 0.006)],
                tip, fw, n=16, cap0=True, cap1=True, coll=col)
    # small vanes on pitot
    vanes = []
    for sx in (-1, 1):
        vanes.append(box('pvane', tip + fw * 0.75 + Vector((sx * 0.05, 0, 0)), (0.07, 0.05, 0.004), coll=col))
    pitot = join([pit] + vanes, 'Pitot')
    assign(pitot, mats['metal_dark'])
    out['pitot'] = pitot
    # side pitots & AoA vanes
    extras = []
    for sx in (-1, 1):
        base = Vector((sx * 0.43, A.Y(2.35), 0.28))
        extras.append(tube_along('spitot', [base, base + Vector((sx * 0.08, 0.03, 0)), base + Vector((sx * 0.1, 0.2, 0))], 0.012, n=8, coll=col))
        vb = Vector((sx * 0.50, A.Y(2.85), 0.08))
        extras.append(box('aoa', vb + Vector((sx * 0.03, -0.05, 0)), (0.004, 0.12, 0.05), coll=col))
    ex = join(extras, 'NoseProbes')
    assign(ex, mats['metal_dark'])
    # IRST (OLS) ball ahead of windscreen, starboard
    ic = Vector((0.20, A.Y(2.78), 0.835))
    fair = lathe('IRSTbase', [(-0.08, 0.16), (-0.02, 0.15), (0.02, 0.13)], ic, (0, 0, 1), n=24, cap0=True, cap1=False, coll=col)
    assign(fair, mats['airframe_misc'])
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.125, location=ic + Vector((0, 0, 0.03)), segments=32, ring_count=16)
    ball = bpy.context.active_object; ball.name = 'IRST'
    for p in ball.data.polygons: p.use_smooth = True
    for c in ball.users_collection: c.objects.unlink(ball)
    col.objects.link(ball)
    assign(ball, mats['sensor'])
    out['irst'] = ball
    # IFR probe (retractable) fairing on port side ahead of cockpit
    pf = []
    rings = []
    for s in np.linspace(2.05, 3.85, 18):
        t = (s - 2.05) / 1.8
        r = 0.075 * (min(t / 0.18, 1) ** 0.5) * (1 - max(t - 0.85, 0) / 0.15 * 0.6)
        c0 = Vector((-0.475 + 0.03 * t, A.Y(s), 0.47 - 0.05 * t))
        rings.append([tuple(c0 + Vector((-math.cos(a) * r * 0.55, 0, math.sin(a) * r * 1.15))) for a in np.linspace(-math.pi / 2, math.pi / 2, 12)])
    fairing = loft('IFRFairing', rings, closed=False, coll=col)
    assign(fairing, mats['airframe_misc'])
    probe = lathe('IFRProbe', [(0, 0.045), (1.4, 0.045), (1.48, 0.06), (1.58, 0.07), (1.65, 0.05), (1.70, 0.02)],
                  Vector((-0.53, A.Y(3.55), 0.48)), (0, 1, 0), n=16, coll=col)
    assign(probe, mats['metal_dark'])
    set_origin(probe, (-0.53, A.Y(3.55), 0.48))
    out['ifr'] = probe
    # gun (GSh-30-1) muzzle in port LERX root + blast vents
    mz = Vector((-0.92, A.Y(5.30), 0.24))
    gun = lathe('GunMuzzle', [(-0.2, 0.05), (0.08, 0.05), (0.10, 0.035)], mz, (0, 1, -0.02), n=16, coll=col)
    assign(gun, mats['metal_dark'])
    # antennas
    ants = []
    ants.append(box('ant_dorsal', (0, A.Y(8.4), 0.925), (0.012, 0.30, 0.20), rot=(-12 * D2R, 0, 0), coll=col))
    ants.append(box('ant_ventral', (0, A.Y(7.9), -0.30), (0.012, 0.26, 0.18), rot=(12 * D2R, 0, 0), coll=col))
    ants.append(box('ant_ventral2', (0, A.Y(3.9), -0.36), (0.012, 0.20, 0.12), rot=(12 * D2R, 0, 0), coll=col))
    an = join(ants, 'Antennas')
    assign(an, mats['airframe_misc'])
    # lights: nav R/G wingtips, white tail, red beacons
    def bulb(name, p, r, m):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=p, segments=16, ring_count=8)
        o = bpy.context.active_object; o.name = name
        for c in o.users_collection: c.objects.unlink(o)
        col.objects.link(o)
        for pp in o.data.polygons: pp.use_smooth = True
        assign(o, m)
        return o
    out['nav_R'] = bulb('NavLight_R', (6.02, A.Y(11.35), A.wing_z(6.0)), 0.035, mats['nav_green'])
    out['nav_L'] = bulb('NavLight_L', (-6.02, A.Y(11.35), A.wing_z(6.0)), 0.035, mats['nav_red'])
    out['beacon_top'] = bulb('Beacon_Top', (0, A.Y(9.6), 0.905), 0.05, mats['beacon'])
    out['beacon_bot'] = bulb('Beacon_Bot', (0, A.Y(9.0), -0.20), 0.05, mats['beacon'])
    out['tail_light'] = bulb('TailLight', (0, A.Y(16.13), -0.13), 0.03, mats['nav_white'])
    # wingtip pods (ECM/RWR)
    for side in (1, -1):
        le, te = A.wing_plan(6.0)
        pod = lathe('TipPod_' + ('R' if side > 0 else 'L'), [(0, 0.0), (0.12, 0.05), (0.4, 0.068), (1.1, 0.068), (1.45, 0.05), (1.55, 0.0)],
                    Vector((side * 6.03, A.Y(le - 0.25), A.wing_z(6.0) + 0.005)), (0, -1, 0), n=16, coll=col)
        assign(pod, mats['dielectric'])
        # static dischargers on aileron TE
        sd = []
        for w in (5.3, 5.7):
            le2, te2 = A.wing_plan(w)
            p0 = Vector((side * w, A.Y(te2), A.wing_z(w)))
            sd.append(cylinder('sdis', p0, p0 + Vector((0, -0.14, 0)), 0.004, n=5, coll=col))
        sdo = join(sd, 'Dischargers_' + ('R' if side > 0 else 'L'))
        assign(sdo, mats['metal_dark'])
    # tail hook (stowed) — pivot at front
    hp = Vector((0, A.Y(13.15), -0.30))
    hook = tube_along('TailHook', [hp, hp + Vector((0, -1.3, -0.04)), hp + Vector((0, -2.45, -0.07))], 0.045, n=12, coll=col)
    tipb = box('hooktip', hp + Vector((0, -2.52, -0.08)), (0.10, 0.16, 0.08), coll=col, bevel=0.015)
    hook = join([hook, tipb], 'TailHook')
    assign(hook, mats['hook'])
    set_origin(hook, hp)
    out['hook'] = hook
    # dorsal airbrake (on top of the tail spine between the fins)
    rings = []
    for s in np.linspace(13.55, 15.25, 10):
        hw, zt, zm, zb, nt, nb = A.fus_section(s)
        wdt = min(0.30, hw * 0.75)
        ring = []
        for x in np.linspace(-wdt, wdt, 12):
            # surface z of superellipse top at x
            cth = abs(x) / hw
            zz = zm + (zt - zm) * max(1 - cth ** nt, 0) ** (1 / nt)
            ring.append((x, A.Y(s), zz + 0.012))
        rings.append(ring)
    ab = loft('Airbrake', rings, closed=False, coll=col)
    sol = ab.modifiers.new('s', 'SOLIDIFY'); sol.thickness = 0.02; sol.offset = 1
    apply_mods(ab)
    hw, zt, zm, zb, nt, nb = A.fus_section(13.55)
    A.set_pivot_frame(ab, (0, A.Y(13.55), zt + 0.012), (1, 0, 0))
    out['airbrake'] = ab
    return out


# ------------------------------------------------------------------ PYLONS & STORES
def missile_R73(name, nose, col, mats):
    d = Vector((0, -1, 0))
    body = lathe(name + '_body', [(0.0, 0.0), (0.03, 0.055), (0.08, 0.078), (0.14, 0.085), (2.85, 0.085), (2.9, 0.06)], nose, d, n=20,
                 cap0=False, cap1=True, coll=col)
    dome = lathe(name + '_dome', [(-0.02, 0.0), (0.0, 0.04), (0.03, 0.056)], nose + d * 0.0, d, n=16, cap0=False, cap1=False, coll=col)
    fins = []
    for k in range(4):
        a = (45 + 90 * k) * D2R
        u = Vector((math.cos(a), 0, math.sin(a)))
        # forward destabilisers
        fins.append(fin_plate('f1', nose + d * 0.22, d, u, 0.085, 0.06, 0.10, 0.04))
        # movable canards
        fins.append(fin_plate('f2', nose + d * 0.36, d, u, 0.085, 0.16, 0.22, 0.06))
        # tail wings
        fins.append(fin_plate('f3', nose + d * 2.45, d, u, 0.085, 0.20, 0.42, 0.18))
    for f in fins:
        col.objects.link(f) if f.name not in col.objects else None
    m = join([body] + fins, name)
    assign(m, mats['missile'])
    assign(dome, mats['seeker'])
    return m, dome


def fin_plate(name, root_le, d, u, r0, span, root_c, tip_c, th=0.006):
    """Thin trapezoid fin: root at radius r0 along direction u, LE at root_le, chord along d."""
    le = Vector(root_le) + u * r0
    sweep = (root_c - tip_c) * 0.8
    pts = [le, le + d * root_c, le + u * span + d * (sweep + tip_c), le + u * span + d * sweep]
    n = d.cross(u).normalized() * th
    verts = [tuple(p + n) for p in pts] + [tuple(p - n) for p in pts]
    faces = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    fix_normals(ob)
    return ob


def missile_R77(name, nose, col, mats):
    d = Vector((0, -1, 0))
    prof = [(0.0, 0.0)]
    for t in np.linspace(0.02, 0.55, 10):
        prof.append((t, 0.1 * (1 - (1 - t / 0.55) ** 2) ** 0.8))
    prof += [(3.55, 0.1), (3.6, 0.08)]
    body = lathe(name + '_body', prof, nose, d, n=24, cap0=False, cap1=True, coll=col)
    parts = [body]
    for k in range(4):
        a = (45 + 90 * k) * D2R
        u = Vector((math.cos(a), 0, math.sin(a)))
        f = fin_plate('w', nose + d * 1.35, d, u, 0.1, 0.07, 1.0, 0.8)
        parts.append(f)
        # grid fin: frame + lattice
        v = d.cross(u).normalized()
        c0 = nose + d * 3.38 + u * 0.10
        gf = []
        W, H, Dp = 0.17, 0.22, 0.05
        for (p, q) in ((0, 0), (1, 0), (0, 1), (1, 1)):
            pass
        frame_pts = [c0 - v * W / 2, c0 + v * W / 2, c0 + v * W / 2 + u * H, c0 - v * W / 2 + u * H]
        for i in range(4):
            a0, b0 = frame_pts[i], frame_pts[(i + 1) % 4]
            gf.append(box_between('gfe', a0, b0, d, Dp, 0.008))
        for t in (0.25, 0.5, 0.75):
            gf.append(box_between('gfl', c0 - v * W / 2 + u * H * t, c0 + v * W / 2 + u * H * t, d, Dp, 0.004))
            gf.append(box_between('gfl', c0 + v * W * (t - 0.5), c0 + v * W * (t - 0.5) + u * H, d, Dp, 0.004))
        parts += gf
    for p in parts:
        if p.name not in col.objects:
            for cc in p.users_collection:
                cc.objects.unlink(p)
            col.objects.link(p)
    m = join(parts, name)
    assign(m, mats['missile'])
    return m


def box_between(name, a, b, d, depth, th):
    a, b = Vector(a), Vector(b)
    L = (b - a).length
    x = (b - a).normalized()
    yv = Vector(d).normalized()
    z = x.cross(yv).normalized()
    c = (a + b) / 2 + yv * depth / 2
    vs = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                vs.append(tuple(c + x * sx * L / 2 + yv * sy * depth / 2 + z * sz * th))
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(vs, [], faces)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    fix_normals(ob)
    return ob


def build_stores(mats):
    col = C('Stores')
    out = {}
    stations_w = (2.55, 3.35, 4.50, 5.25)
    loads = {5.25: 'R73', 4.50: 'R77', 3.35: 'R77', 2.55: None}
    for side in (1, -1):
        nm = 'R' if side > 0 else 'L'
        pyl = []
        for w in stations_w:
            le, te = A.wing_plan(w)
            ch = te - le
            zlow = A.wing_z(w) - A.wing_t(w) * ch * 0.42
            L = min(2.0, ch * 0.75)
            s0 = le + ch * 0.12
            rings = []
            for s in np.linspace(s0, s0 + L, 14):
                t = (s - s0) / L
                th = 0.055 * math.sqrt(max(1 - (2 * t - 1) ** 2, 0.02))
                hgt = 0.30 * (0.35 + 0.65 * math.sqrt(max(1 - (2 * t - 1) ** 4, 0)))
                rings.append([(side * w + x, A.Y(s), zlow + z) for (x, z) in ((th, 0.05), (th, -hgt), (-th, -hgt), (-th, 0.05))])
            p = loft('pylon', rings, closed=True, cap0=True, cap1=True, coll=col, auto_smooth=45)
            pyl.append(p)
            rail = box('rail', (side * w, A.Y(s0 + L * 0.5), zlow - 0.33), (0.07, L * 0.85, 0.06), coll=col)
            pyl.append(rail)
            kind = loads[w]
            nose = Vector((side * w, A.Y(s0 - 0.45), zlow - 0.46))
            if kind == 'R73':
                m, dome = missile_R73('R73_%s_%d' % (nm, int(w * 10)), nose, col, mats)
            elif kind == 'R77':
                m = missile_R77('R77_%s_%d' % (nm, int(w * 10)), nose + Vector((0, 0.35, -0.02)), col, mats)
        po = join(pyl, 'Pylons_' + nm)
        assign(po, mats['pylon'])
    return out


# ------------------------------------------------------------------ COCKPIT PLACEHOLDER
def build_cockpit_basic(mats):
    col = C('Cockpit')
    parts = []
    tub = box('tub', (0, A.Y(4.30), 0.42), (0.80, 2.6, 0.80), coll=col)
    parts.append(tub)
    # flip tub normals inward
    tub.data.flip_normals()
    assign(tub, mats['cockpit'])
    # glareshield / coaming
    rings = []
    for s in np.linspace(3.05, 3.45, 6):
        rings.append([(x, A.Y(s), 0.86 + 0.06 * (1 - (x / 0.36) ** 2) - 0.04 * (s - 3.05)) for x in np.linspace(-0.36, 0.36, 12)])
    co = loft('Coaming', rings, closed=False, coll=col)
    sol = co.modifiers.new('s', 'SOLIDIFY'); sol.thickness = 0.03
    apply_mods(co)
    assign(co, mats['cockpit'])
    panel = box('Panel', (0, A.Y(3.50), 0.66), (0.72, 0.05, 0.36), rot=(-15 * D2R, 0, 0), coll=col)
    assign(panel, mats['cockpit'])
    seat = box('SeatBack', (0, A.Y(5.18), 0.78), (0.52, 0.18, 0.95), rot=(18 * D2R, 0, 0), coll=col, bevel=0.03)
    seat2 = box('SeatHead', (0, A.Y(5.30), 1.28), (0.40, 0.2, 0.25), rot=(18 * D2R, 0, 0), coll=col, bevel=0.03)
    seat3 = box('SeatPan', (0, A.Y(4.85), 0.40), (0.50, 0.55, 0.12), coll=col, bevel=0.03)
    s = join([seat, seat2, seat3], 'Seat')
    assign(s, mats['seat'])
    return {}
