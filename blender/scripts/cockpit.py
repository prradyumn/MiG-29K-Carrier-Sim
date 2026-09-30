"""MiG-29K single-seat cockpit: glass panel with 3 MFDs, UFCP + HUD, stick, HOTAS throttle, side consoles,
K-36D-3.5 ejection seat, canopy mirrors, optional pilot figure. Screens are separate objects with 0-1 UVs so the
simulator can draw live canvases onto them."""
import bpy, bmesh, math
import numpy as np
from mathutils import Vector, Matrix, Euler
from lib import *
import build_airframe as A

D2R = math.pi / 180
RNG = np.random.default_rng(7)


def col():
    return A.coll('Cockpit')


def bx(name, c, size, rot=(0, 0, 0), m=None, bevel=0.0):
    o = box(name, c, size, rot=rot, coll=col(), bevel=bevel)
    if m:
        assign(o, m)
    return o


def cyl(name, p0, p1, r, n=12, m=None):
    o = cylinder(name, p0, p1, r, n=n, coll=col())
    if m:
        assign(o, m)
    return o


def quad_screen(name, center, right, up, w, h, m):
    """flat rectangle with UVs 0..1 (u along right, v along up)."""
    c = Vector(center); r = Vector(right).normalized(); u = Vector(up).normalized()
    vs = [c - r * w / 2 - u * h / 2, c + r * w / 2 - u * h / 2, c + r * w / 2 + u * h / 2, c - r * w / 2 + u * h / 2]
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in vs], [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new(name='UVMap')
    for i, (a, b) in enumerate(((0, 0), (1, 0), (1, 1), (0, 1))):
        uv.data[i].uv = (a, b)
    o = bpy.data.objects.new(name, me)
    col().objects.link(o)
    assign(o, m)
    return o


def panel_frame(tilt):
    """returns origin, right, up, normal for the main instrument panel plane (tilted back by tilt deg)."""
    org = Vector((0, A.Y(3.62), 0.62))
    up = Vector((0, math.sin(tilt * D2R), math.cos(tilt * D2R)))  # top leans forward
    nrm = Vector((0, -math.cos(tilt * D2R), math.sin(tilt * D2R)))  # faces pilot (aft)
    right = Vector((1, 0, 0))
    return org, right, up, nrm


def on_panel(org, right, up, nrm, x, z, dn=0.0):
    return org + right * x + up * z + nrm * dn


def switch_field(prefix, origin, right, fwd, nx, ny, pitch, M, kinds=('toggle', 'knob', 'button')):
    """grid of small controls on a console plate. right/fwd are in-plane axes, normal = up (z)."""
    parts = []
    lit = []
    for i in range(nx):
        for j in range(ny):
            k = kinds[RNG.integers(len(kinds))]
            if RNG.random() < 0.35:
                continue
            p = origin + right * (i * pitch) + fwd * (j * pitch)
            if k == 'toggle':
                parts.append(cylinder('tg', p, p + Vector((0, 0, 0.010)), 0.006, n=8, coll=col()))
                parts.append(cylinder('tgl', p + Vector((0, 0, 0.008)), p + Vector((0, 0.006, 0.030)), 0.0025, n=6, coll=col()))
            elif k == 'knob':
                parts.append(cylinder('kn', p, p + Vector((0, 0, 0.016)), 0.011, n=14, coll=col()))
                parts.append(cylinder('kn2', p + Vector((0, 0, 0.016)), p + Vector((0, 0, 0.020)), 0.007, n=10, coll=col()))
            else:
                b = box('bt', p + Vector((0, 0, 0.004)), (0.016, 0.012, 0.008), coll=col())
                (lit if RNG.random() < 0.3 else parts).append(b)
    return parts, lit


def build(M):
    out = {}
    dk = M['ck_panel']
    # ---------------- tub side walls & floor
    for sd in (1, -1):
        rings = []
        for s in np.linspace(3.35, 5.55, 12):
            rings.append([(sd * 0.425, A.Y(s), 0.84), (sd * 0.41, A.Y(s), 0.62), (sd * 0.36, A.Y(s), 0.25), (sd * 0.30, A.Y(s), 0.10)])
        w = loft('ck_wall', rings, closed=False, coll=col())
        assign(w, dk)
    bx('ck_floor', (0, A.Y(4.4), 0.10), (0.62, 2.0, 0.02), m=dk)
    bx('ck_rear', (0, A.Y(5.52), 0.70), (0.84, 0.03, 1.2), m=dk)
    bx('ck_deck', (0, A.Y(5.18), 0.84), (0.84, 0.75, 0.03), m=dk)
    bx('ck_bulk', (0, A.Y(4.80), 0.62), (0.80, 0.03, 0.46), m=dk)
    # ---------------- side consoles
    lit_all = []
    for sd in (1, -1):
        top = 0.575
        bx('ck_console', (sd * 0.31, A.Y(4.5), top - 0.12), (0.18, 1.35, 0.24), m=M['ck_console'])
        # panels on console top
        for k, s0 in enumerate(np.arange(3.95, 5.1, 0.19)):
            plate = bx('ck_plate', (sd * 0.31, A.Y(s0 + 0.09), top + 0.003), (0.165, 0.175, 0.006), m=M['ck_plate'])
            if sd < 0 and 4.3 < s0 < 4.8:
                continue  # throttle quadrant space
            parts, lit = switch_field('sw', Vector((sd * 0.31 - 0.06, A.Y(s0 + 0.03), top + 0.006)), Vector((0.03, 0, 0)).normalized(),
                                      Vector((0, -1, 0)), 5, 4, 0.03, M)
            if parts:
                j = join(parts, 'ck_sw'); assign(j, M['ck_knob'])
            if lit:
                j = join(lit, 'ck_btn'); assign(j, M['ck_btn_lit'])
    # ---------------- glareshield + main panel
    org, right, up, nrm = panel_frame(14)
    pw, ph = 0.74, 0.42
    pan = bx('ck_mainpanel', tuple(on_panel(org, right, up, nrm, 0, 0.0, -0.02)), (pw, 0.04, ph), rot=(14 * D2R, 0, 0), m=dk)
    # coaming (curved hood above the panel)
    rings = []
    for s in np.linspace(3.25, 3.68, 7):
        t = (s - 3.25) / 0.43
        rings.append([(x, A.Y(s), 0.90 + 0.05 * (1 - (x / 0.40) ** 2) - 0.06 * t ** 2) for x in np.linspace(-0.40, 0.40, 16)])
    co = loft('ck_coaming', rings, closed=False, coll=col())
    sol = co.modifiers.new('s', 'SOLIDIFY'); sol.thickness = 0.03; apply_mods(co)
    assign(co, M['ck_coaming'])
    # three MFDs (MFI-10-7): 6x8 in LCD in bezels with 26 buttons each
    mfd_w, mfd_h = 0.162, 0.212
    xs = (-0.235, 0.0, 0.235)
    zc = -0.03
    for i, x in enumerate(xs):
        c = on_panel(org, right, up, nrm, x, zc, 0.005)
        bz = bx('MFD_Bezel_%d' % i, tuple(c), (mfd_w + 0.07, 0.03, mfd_h + 0.075), rot=(14 * D2R, 0, 0), m=M['ck_bezel'], bevel=0.004)
        scr = quad_screen(['MFD_L', 'MFD_C', 'MFD_R'][i], on_panel(org, right, up, nrm, x, zc, 0.0215), right, up, mfd_w, mfd_h, M['screen_%d' % i])
        out[scr.name] = scr
        btns = []
        for k in range(5):
            for (dx, dz) in (((-2 + k) * 0.03, mfd_h / 2 + 0.022), ((-2 + k) * 0.03, -mfd_h / 2 - 0.022)):
                btns.append(box('mb', tuple(on_panel(org, right, up, nrm, x + dx, zc + dz, 0.022)), (0.018, 0.012, 0.012), coll=col()))
        for k in range(6):
            for dx in (-mfd_w / 2 - 0.022, mfd_w / 2 + 0.022):
                btns.append(box('mb', tuple(on_panel(org, right, up, nrm, x + dx, zc + (-2.5 + k) * 0.034, 0.022)), (0.012, 0.012, 0.018), coll=col()))
        for b in btns:
            b.rotation_euler = (14 * D2R, 0, 0)
        j = join(btns, 'MFD_Buttons_%d' % i)
        assign(j, M['ck_btn_lit'])
    # standby instruments (round gauges) lower centre
    gauges = []
    faces = []
    for k, (x, z) in enumerate(((-0.10, -0.19), (0.0, -0.19), (0.10, -0.19))):
        c0 = on_panel(org, right, up, nrm, x, z, 0.0)
        gauges.append(cylinder('gg', c0, c0 + nrm * 0.03, 0.038, n=24, coll=col()))
        faces.append(cylinder('ggf', c0 + nrm * 0.028, c0 + nrm * 0.031, 0.032, n=24, coll=col()))
    j = join(gauges, 'ck_gauges'); assign(j, M['ck_bezel'])
    j = join(faces, 'StandbyFaces'); assign(j, M['gauge_face'])
    # warning lights column & misc switches at panel sides
    lights = []
    for k in range(6):
        for sd in (1, -1):
            lights.append(box('wl', tuple(on_panel(org, right, up, nrm, sd * 0.345, 0.14 - k * 0.04, 0.0)), (0.028, 0.012, 0.022), coll=col()))
    for l in lights:
        l.rotation_euler = (14 * D2R, 0, 0)
    j = join(lights, 'ck_caution'); assign(j, M['ck_caution'])
    # ---------------- UFCP + HUD
    uc = Vector((0, A.Y(3.71), 0.835))
    bx('UFCP_Body', tuple(uc), (0.19, 0.08, 0.085), rot=(-30 * D2R, 0, 0), m=M['ck_bezel'], bevel=0.005)
    ufcp = quad_screen('UFCP_Screen', uc + Vector((0, -0.036, 0.042)), (1, 0, 0), (0, 0.5, 0.866), 0.12, 0.035, M['screen_3'])
    out['UFCP_Screen'] = ufcp
    keys = []
    for i in range(4):
        for j2 in range(3):
            p = uc + Vector(((j2 - 1) * 0.034, -0.052 + i * 0.009, -0.025 + i * 0.015 - 0.01))
            keys.append(box('k', tuple(p), (0.024, 0.012, 0.012), coll=col()))
    for k in keys:
        k.rotation_euler = (-30 * D2R, 0, 0)
    j = join(keys, 'UFCP_Keys'); assign(j, M['ck_btn_lit'])
    # HUD: base, frame posts, combiner glass
    hb = Vector((0, A.Y(3.57), 0.99))
    bx('HUD_Base', tuple(hb), (0.24, 0.14, 0.05), m=M['ck_bezel'], bevel=0.006)
    for sd in (1, -1):
        cyl('HUD_Post', hb + Vector((sd * 0.112, -0.02, 0.02)), hb + Vector((sd * 0.112, 0.02, 0.22)), 0.007, m=M['ck_bezel'])
    hud = quad_screen('HUD_Glass', hb + Vector((0, 0.0, 0.125)), (1, 0, 0), (0, 0.26, 0.966), 0.22, 0.18, M['hud_glass'])
    out['HUD_Glass'] = hud
    # ---------------- centre stick
    sb = Vector((0, A.Y(3.88), 0.12))
    boot = lathe('ck_boot', [(0, 0.07), (0.04, 0.06), (0.08, 0.035), (0.10, 0.02)], sb, (0, 0, 1), n=16, coll=col())
    assign(boot, M['ck_boot'])
    stick = empty_obj('Stick', sb)
    parts = [cylinder('st', sb + Vector((0, 0, 0.08)), sb + Vector((0, 0.03, 0.40)), 0.013, n=12, coll=col())]
    g0 = sb + Vector((0, 0.03, 0.40))
    grip = lathe('grip', [(0, 0.022), (0.03, 0.026), (0.08, 0.024), (0.11, 0.021), (0.13, 0.014)], g0, (0, 0.18, 1), n=14, coll=col())
    parts.append(grip)
    parts.append(box('trig', tuple(g0 + Vector((0, 0.025, 0.035))), (0.012, 0.012, 0.025), coll=col()))
    parts.append(cylinder('hat', g0 + Vector((0, 0.018, 0.125)), g0 + Vector((0, 0.03, 0.135)), 0.008, n=8, coll=col()))
    s = join(parts, 'Stick_Grip'); assign(s, M['ck_grip'])
    parent_keep(s, stick)
    out['Stick'] = stick
    # ---------------- throttle (twin levers, left console)
    tb = Vector((-0.31, A.Y(4.10), 0.58))
    bx('ck_throttle_quad', tuple(tb), (0.10, 0.34, 0.03), m=M['ck_console'])
    thr = empty_obj('Throttle', tb + Vector((0, 0, 0.0)))
    tl = []
    for dx in (-0.018, 0.018):
        tl.append(cylinder('tl', tb + Vector((dx, 0, 0.01)), tb + Vector((dx, 0.04, 0.12)), 0.008, n=8, coll=col()))
    th = box('thg', tuple(tb + Vector((0, 0.05, 0.14))), (0.075, 0.07, 0.05), coll=col(), bevel=0.01)
    t_ = join(tl + [th], 'Throttle_Grip'); assign(t_, M['ck_grip'])
    parent_keep(t_, thr)
    out['Throttle'] = thr
    # ---------------- K-36D-3.5 ejection seat
    seat = build_seat(M)
    out['seat'] = seat
    # ---------------- canopy mirrors (on canopy arch; moving canopy)
    mir = []
    arch_s = 3.80
    for x, z in ((-0.30, 1.20), (0.0, 1.29), (0.30, 1.20)):
        p = Vector((x, A.Y(arch_s + 0.03), z))
        mir.append(box('mir', tuple(p), (0.11, 0.012, 0.045), rot=(-20 * D2R, 0, -x * 0.7), coll=col(), bevel=0.004))
    j = join(mir, 'Mirrors'); assign(j, M['mirror'])
    out['mirrors'] = j
    # ---------------- pilot figure
    out['pilot'] = build_pilot(M)
    return out


def empty_obj(name, loc):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.05
    col().objects.link(e)
    e.location = loc
    return e


def build_seat(M):
    sc = Vector((0, A.Y(4.02), 0.30))
    rec = 18 * D2R
    parts = {'frame': [], 'cushion': [], 'handle': [], 'strap': [], 'head': []}
    back_dir = Vector((0, -math.sin(rec), math.cos(rec)))
    # side rails (seat frame) - tall beams along the back
    for sd in (1, -1):
        p0 = sc + Vector((sd * 0.24, -0.20, 0.0))
        parts['frame'].append(tube_along('rail', [p0, p0 + back_dir * 1.02], 0.025, n=8, coll=col()))
        # pan sides
        parts['frame'].append(box('pan_side', tuple(sc + Vector((sd * 0.235, 0.02, 0.12))), (0.03, 0.46, 0.20), coll=col(), bevel=0.01))
    # seat bucket / survival kit
    parts['frame'].append(box('pan', tuple(sc + Vector((0, 0.03, 0.05))), (0.46, 0.46, 0.10), coll=col(), bevel=0.02))
    parts['cushion'].append(box('pan_cush', tuple(sc + Vector((0, 0.04, 0.12))), (0.40, 0.42, 0.06), coll=col(), bevel=0.025))
    # back cushion
    bc = sc + Vector((0, -0.20, 0.0)) + back_dir * 0.45 + Vector((0, 0.05, 0))
    b = box('back_cush', tuple(bc), (0.40, 0.08, 0.66), rot=(rec, 0, 0), coll=col(), bevel=0.03)
    parts['cushion'].append(b)
    # headbox (parachute container) with drogue gun and stabiliser booms
    hc = sc + Vector((0, -0.22, 0.0)) + back_dir * 0.98
    hbx = box('headbox', tuple(hc), (0.36, 0.20, 0.30), rot=(rec, 0, 0), coll=col(), bevel=0.03)
    parts['head'].append(hbx)
    hp = box('headpad', tuple(hc + Vector((0, 0.10, -0.06))), (0.24, 0.05, 0.16), rot=(rec, 0, 0), coll=col(), bevel=0.02)
    parts['cushion'].append(hp)
    for sd in (1, -1):
        parts['frame'].append(tube_along('boom', [hc + Vector((sd * 0.16, -0.06, 0.10)), hc + Vector((sd * 0.16, -0.14, 0.22))], 0.014, n=6, coll=col()))
    # ejection handles (K-36: two loops at the front of the seat pan)
    for sd in (1, -1):
        c0 = sc + Vector((sd * 0.12, 0.27, 0.10))
        pts = [c0 + Vector((0, math.sin(a) * 0.05, math.cos(a) * 0.05 - 0.05)) for a in np.linspace(-1.2, 1.2, 8)]
        parts['handle'].append(tube_along('handle', pts, 0.009, n=8, coll=col()))
    # harness straps
    for sd in (1, -1):
        p0 = hc + Vector((sd * 0.09, 0.06, -0.08))
        p1 = sc + Vector((sd * 0.09, 0.03, 0.62))
        p2 = sc + Vector((sd * 0.05, 0.12, 0.30))
        parts['strap'].append(tube_along('strap', [p0, p1, p2], 0.012, n=6, coll=col()))
        parts['strap'].append(tube_along('lap', [sc + Vector((sd * 0.20, -0.05, 0.16)), sc + Vector((sd * 0.07, 0.12, 0.22))], 0.012, n=6, coll=col()))
    res = {}
    for k, mk in (('frame', 'seat_frame'), ('cushion', 'seat'), ('handle', 'seat_handle'), ('strap', 'strap'), ('head', 'seat_frame')):
        if parts[k]:
            o = join(parts[k], 'Seat_' + k)
            assign(o, M[mk])
            res[k] = o
    return res


def build_pilot(M):
    """simple seated pilot: torso, arms, legs, helmet with visor and mask (hidden in first person)."""
    root = empty_obj('Pilot', (0, A.Y(4.2), 0.5))
    rec = 18 * D2R
    parts = []
    hip = Vector((0, A.Y(4.20), 0.50))
    chest = hip + Vector((0, -0.10, 0.45))
    torso = lathe('torso', [(0, 0.15), (0.2, 0.17), (0.38, 0.19), (0.48, 0.16), (0.52, 0.07)], hip, (chest - hip), n=16, coll=col())
    parts.append(torso)
    neck = chest + Vector((0, 0.0, 0.08))
    head = neck + Vector((0, 0.03, 0.13))
    # legs
    for sd in (1, -1):
        knee = hip + Vector((sd * 0.11, 0.44, 0.10))
        foot = knee + Vector((0, 0.18, -0.36))
        parts.append(tube_along('thigh', [hip + Vector((sd * 0.10, 0.05, 0.02)), knee], [0.075, 0.06], n=12, coll=col()))
        parts.append(tube_along('shin', [knee, foot], [0.055, 0.045], n=12, coll=col()))
        parts.append(box('boot', tuple(foot + Vector((0, 0.07, -0.02))), (0.09, 0.24, 0.08), coll=col(), bevel=0.02))
        sh = chest + Vector((sd * 0.19, 0.0, 0.0))
        el = sh + Vector((sd * 0.03, 0.18, -0.25))
        hand = Vector((0.0, A.Y(3.84), 0.60)) if sd > 0 else Vector((-0.31, A.Y(4.05), 0.72))
        parts.append(tube_along('uarm', [sh, el], [0.055, 0.045], n=12, coll=col()))
        parts.append(tube_along('farm', [el, hand + Vector((0, -0.05, 0))], [0.045, 0.038], n=12, coll=col()))
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.042, location=hand, segments=12, ring_count=8)
        gl = bpy.context.active_object
        for cc in gl.users_collection:
            cc.objects.unlink(gl)
        col().objects.link(gl)
        parts.append(gl)
    suit = join(parts, 'Pilot_Suit'); assign(suit, M['flight_suit'])
    # helmet
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.14, location=head, segments=32, ring_count=16)
    hel = bpy.context.active_object; hel.name = 'Pilot_Helmet'
    hel.scale = (0.95, 1.08, 1.0)
    for cc in hel.users_collection:
        cc.objects.unlink(hel)
    col().objects.link(hel)
    for p in hel.data.polygons:
        p.use_smooth = True
    assign(hel, M['helmet'])
    # visor: front part of a slightly bigger sphere
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=0.147)
    kill = [f for f in bm.faces if not (f.calc_center_median().y > 0.05 and -0.06 < f.calc_center_median().z < 0.09)]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    me = bpy.data.meshes.new('Pilot_Visor'); bm.to_mesh(me); bm.free()
    vis = bpy.data.objects.new('Pilot_Visor', me); col().objects.link(vis)
    vis.location = head; vis.scale = (0.95, 1.08, 1.0)
    for p in me.polygons:
        p.use_smooth = True
    assign(vis, M['visor'])
    mask = lathe('Pilot_Mask', [(0, 0.055), (0.07, 0.05), (0.11, 0.022)], head + Vector((0, 0.115, -0.075)), (0, 1, -0.4), n=14, coll=col())
    assign(mask, M['mask'])
    hose = tube_along('Pilot_Hose', [head + Vector((0, 0.17, -0.10)), chest + Vector((0.05, 0.14, -0.05)), chest + Vector((0.12, 0.12, -0.25))], 0.018, n=8, coll=col())
    assign(hose, M['mask'])
    for o in (suit, hel, vis, mask, hose):
        parent_keep(o, root)
    return root


def materials():
    M = {}
    M['ck_panel'] = mat('CkPanel', (0.028, 0.03, 0.033), 0.62)
    M['ck_console'] = mat('CkConsole', (0.035, 0.037, 0.04), 0.6)
    M['ck_plate'] = mat('CkPlate', (0.022, 0.023, 0.025), 0.5)
    M['ck_coaming'] = mat('CkCoaming', (0.018, 0.018, 0.02), 0.85)
    M['ck_bezel'] = mat('CkBezel', (0.03, 0.031, 0.033), 0.45)
    M['ck_knob'] = mat('CkKnob', (0.05, 0.05, 0.05), 0.4, 0.3)
    M['ck_btn_lit'] = mat('CkButtonLit', (0.06, 0.08, 0.06), 0.4, emit=(0.35, 1.0, 0.45), emit_strength=0.3)
    M['ck_caution'] = mat('CkCaution', (0.08, 0.06, 0.02), 0.3, emit=(1.0, 0.65, 0.1), emit_strength=0.25)
    M['gauge_face'] = mat('GaugeFace', (0.01, 0.01, 0.012), 0.3, emit=(0.8, 0.9, 1.0), emit_strength=0.08)
    for i in range(4):
        M['screen_%d' % i] = mat('Screen_%d' % i, (0.0, 0.0, 0.0), 0.15, emit=(0.08, 0.35, 0.18), emit_strength=1.0)
    M['hud_glass'] = mat('HUDGlass', (0.6, 0.8, 0.6), 0.02, alpha=0.18, emit=(0.2, 1.0, 0.4), emit_strength=0.0)
    M['ck_boot'] = mat('CkBoot', (0.02, 0.02, 0.02), 0.9)
    M['ck_grip'] = mat('CkGrip', (0.03, 0.03, 0.03), 0.5)
    M['seat'] = mat('SeatCushion', (0.10, 0.11, 0.07), 0.85)
    M['seat_frame'] = mat('SeatFrame', (0.07, 0.075, 0.08), 0.5, 0.4)
    M['seat_handle'] = mat('SeatHandle', (0.75, 0.55, 0.02), 0.4)
    M['strap'] = mat('Strap', (0.75, 0.30, 0.03), 0.8)
    M['mirror'] = mat('Mirror', (0.9, 0.9, 0.9), 0.02, 1.0)
    M['flight_suit'] = mat('FlightSuit', (0.10, 0.12, 0.07), 0.85)
    M['helmet'] = mat('Helmet', (0.42, 0.44, 0.42), 0.4)
    M['visor'] = mat('Visor', (0.02, 0.02, 0.025), 0.03, 0.5)
    M['mask'] = mat('OxyMask', (0.05, 0.05, 0.05), 0.6)
    return M
