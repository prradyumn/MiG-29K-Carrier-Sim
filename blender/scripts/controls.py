"""Interactive cockpit controls for the MiG-29K sim, exported as a separate glTF that the simulator attaches to the
aircraft at runtime (so the textured airframe never has to be rebuilt).

Every moving part is its own object with its origin on its hinge or slide axis and its local frame set so that
  local X = hinge axis, local Y = panel 'up', local Z = panel normal (towards the pilot).
The simulator rotates toggles / levers / guards about local X and slides buttons / T-handles along local Z.
glTF extras carry the control id, kind and the legend position on its panel face, so the panel artwork
(drawn live on canvases in the sim) lines up with the geometry.

Run:  python controls.py <out_dir>        (bpy 4.2 module; writes controls.gltf/.bin, then embed with embed_gltf.py)
"""
import sys, os, math
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpy
from mathutils import Vector, Matrix
from lib import *

D2R = math.pi / 180
OUT = sys.argv[-1] if len(sys.argv) > 1 and not sys.argv[-1].endswith('.py') else os.path.join(HERE, 'out')

bpy.ops.wm.read_factory_settings(use_empty=True)
COLL = bpy.data.collections.new('Controls')
bpy.context.scene.collection.children.link(COLL)


def kw():
    return dict(coll=COLL)


# ------------------------------------------------------------------ materials
MAT = {
    'panel': mat('CtlPanel', (0.030, 0.032, 0.035), 0.55),
    'nut': mat('CtlNut', (0.55, 0.56, 0.57), 0.3, 0.9),
    'bat': mat('CtlBat', (0.72, 0.73, 0.74), 0.25, 1.0),
    'guard': mat('CtlGuardRed', (0.55, 0.04, 0.03), 0.35),
    'guard_y': mat('CtlGuardYellow', (0.75, 0.55, 0.03), 0.4),
    'cap': mat('CtlButtonCap', (0.05, 0.05, 0.055), 0.45),
    'knob': mat('CtlKnob', (0.04, 0.04, 0.045), 0.5, 0.2),
    'gearwheel': mat('CtlGearWheel', (0.85, 0.85, 0.82), 0.5),
    'handle_y': mat('CtlHandleYellow', (0.78, 0.60, 0.05), 0.45),
    'handle_r': mat('CtlHandleRed', (0.60, 0.05, 0.04), 0.45),
    'mw': mat('CtlMasterWarn', (0.25, 0.02, 0.02), 0.3, emit=(1.0, 0.1, 0.05), emit_strength=0.0),
    'mc': mat('CtlMasterCaution', (0.25, 0.16, 0.02), 0.3, emit=(1.0, 0.65, 0.1), emit_strength=0.0),
    'bezel': mat('CtlBezel', (0.028, 0.029, 0.031), 0.45),
    'pedal': mat('CtlPedal', (0.10, 0.105, 0.11), 0.6, 0.4),
    'glove': mat('CtlGlove', (0.075, 0.066, 0.058), 0.72),
    'glove_seam': mat('CtlGloveSeam', (0.045, 0.040, 0.036), 0.8),
    'sleeve': mat('CtlSleeve', (0.10, 0.12, 0.07), 0.85),
}
# canvas-driven faces: the sim swaps these for CanvasTexture materials by name
FACE = mat('CtlFace', (0, 0, 0), 0.5, emit=(0.2, 0.2, 0.2), emit_strength=0.3)


def frame_matrix(origin, u, v, n):
    """object matrix with local X=u, Y=v, Z=n at origin."""
    u, v, n = Vector(u).normalized(), Vector(v).normalized(), Vector(n).normalized()
    m = Matrix((u, v, n)).transposed().to_4x4()
    m.translation = Vector(origin)
    return m


def bake(o):
    """fold the object's own transform into its mesh so the origin sits at the local-frame origin."""
    o.data.transform(o.matrix_world)
    o.matrix_world = Matrix.Identity(4)
    return o


def local_obj(name, build, M, material, extras=None):
    """build(...) creates geometry in LOCAL coordinates (hinge frame at origin); we then place it with matrix M."""
    o = bake(build())
    o.name = name
    if material:
        assign(o, material)
    o.matrix_world = M
    if extras:
        for k, v in extras.items():
            o[k] = v
    return o


def quad(name, w, h, material):
    me = bpy.data.meshes.new(name)
    me.from_pydata([(-w / 2, -h / 2, 0), (w / 2, -h / 2, 0), (w / 2, h / 2, 0), (-w / 2, h / 2, 0)], [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new(name='UVMap')
    for i, (a, b) in enumerate(((0, 0), (1, 0), (1, 1), (0, 1))):
        uv.data[i].uv = (a, b)
    o = bpy.data.objects.new(name, me)
    COLL.objects.link(o)
    assign(o, material)
    return o


def disc(name, r, material, n=40):
    """circular face with 0..1 UVs (for gauge dials)."""
    vs = [(0, 0, 0)] + [(r * math.cos(2 * math.pi * k / n), r * math.sin(2 * math.pi * k / n), 0) for k in range(n)]
    fs = [(0, 1 + k, 1 + (k + 1) % n) for k in range(n)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(vs, [], fs)
    uv = me.uv_layers.new(name='UVMap')
    for p in me.polygons:
        for li in p.loop_indices:
            x, y, _ = vs[me.loops[li].vertex_index]
            uv.data[li].uv = (0.5 + x / (2 * r), 0.5 + y / (2 * r))
    o = bpy.data.objects.new(name, me)
    COLL.objects.link(o)
    assign(o, material)
    return o


# ------------------------------------------------------------------ control builders (local frame)
def toggle_geo():
    parts = [cylinder('nut', (0, 0, 0), (0, 0, 0.006), 0.0065, n=6, **kw()),
             cylinder('bushing', (0, 0, 0.004), (0, 0, 0.011), 0.0042, n=12, **kw())]
    # bat-handle lever, tapering, with a ball end
    parts.append(tube_along('bat', [(0, 0, 0.008), (0, 0, 0.022), (0, 0, 0.030)], [0.0024, 0.0021, 0.0019], n=10, **kw()))
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.0031, location=(0, 0, 0.031), segments=12, ring_count=8)
    b = bpy.context.active_object
    for c in b.users_collection:
        c.objects.unlink(b)
    COLL.objects.link(b)
    parts.append(b)
    return join(parts, 'tmp')


def guard_geo(w=0.022, l=0.040, h=0.020):
    """flip-up guard cover hinged along local X at the panel surface, extending along -Y (closed) over the switch."""
    t = 0.0016
    parts = [box('g_top', (0, -l / 2, h), (w, l, t), **kw()),
             box('g_side1', (w / 2, -l / 2, h / 2), (t, l, h), **kw()),
             box('g_side2', (-w / 2, -l / 2, h / 2), (t, l, h), **kw()),
             box('g_front', (0, -l + t / 2, h / 2), (w, t, h), **kw()),
             cylinder('g_hinge', (-w / 2 - 0.002, 0, 0.002), (w / 2 + 0.002, 0, 0.002), 0.0022, n=8, **kw())]
    return join(parts, 'tmp')


def button_cap_geo(w=0.016, h=0.014, d=0.008):
    return box('cap', (0, 0, d / 2), (w, h, d), bevel=0.0012, **kw())


def button_well_geo(w=0.016, h=0.014):
    t = 0.0022
    parts = [box('w1', (0, h / 2 + t / 2, 0.003), (w + 2 * t, t, 0.006), **kw()),
             box('w2', (0, -h / 2 - t / 2, 0.003), (w + 2 * t, t, 0.006), **kw()),
             box('w3', (w / 2 + t / 2, 0, 0.003), (t, h, 0.006), **kw()),
             box('w4', (-w / 2 - t / 2, 0, 0.003), (t, h, 0.006), **kw())]
    return join(parts, 'tmp')


def gear_lever_geo():
    """lever arm out of the panel with the classic wheel-shaped knob; pivot at the panel surface."""
    parts = [tube_along('arm', [(0, 0, 0.0), (0, 0, 0.045), (0, 0.004, 0.070)], [0.0045, 0.004, 0.0038], n=12, **kw())]
    # wheel: torus-like tube around the knob axis (local Y), a disc in the X-Z plane
    wheel = tube_along('wheel', [(0.017 * math.cos(2 * math.pi * k / 24), 0.004, 0.082 + 0.017 * math.sin(2 * math.pi * k / 24)) for k in range(25)],
                       0.0048, n=10, cap=False, **kw())
    hub = cylinder('hub', (0, -0.004, 0.082), (0, 0.012, 0.082), 0.011, n=20, **kw())
    return join(parts, 'tmp'), join([wheel, hub], 'tmp2')


def slot_geo(length=0.09, w=0.012):
    t = 0.003
    parts = [box('s1', (w / 2 + t / 2, 0, 0.002), (t, length, 0.004), **kw()),
             box('s2', (-w / 2 - t / 2, 0, 0.002), (t, length, 0.004), **kw()),
             box('s3', (0, length / 2 + t / 2, 0.002), (w + 2 * t, t, 0.004), **kw()),
             box('s4', (0, -length / 2 - t / 2, 0.002), (w + 2 * t, t, 0.004), **kw())]
    return join(parts, 'tmp')


def t_handle_geo(bar=0.05):
    parts = [cylinder('shaft', (0, 0, 0.0), (0, 0, 0.024), 0.0035, n=10, **kw()),
             tube_along('bar', [(-bar / 2, 0, 0.028), (0, 0, 0.031), (bar / 2, 0, 0.028)], 0.0065, n=12, **kw())]
    return join(parts, 'tmp')


def bezel_ring_geo(r, depth=0.008, n=40):
    return lathe('bz', [(0, r + 0.006), (depth * 0.6, r + 0.006), (depth, r + 0.002), (depth, r), (0, r)], (0, 0, 0), (0, 0, 1), n=n, **kw())


# ------------------------------------------------------------------ panels
CONTROLS = []


class Panel:
    def __init__(self, pid, center, u, v, n, w, h):
        self.pid, self.c = pid, Vector(center)
        self.u, self.v, self.n = Vector(u).normalized(), Vector(v).normalized(), Vector(n).normalized()
        self.w, self.h = w, h
        # backing plate + canvas face (legends, lamps) on top of it
        plate = local_obj('Panel_' + pid, lambda: box('pl', (0, 0, -0.004), (w + 0.008, h + 0.008, 0.008), bevel=0.0015, **kw()),
                          frame_matrix(self.c, self.u, self.v, self.n), MAT['panel'])
        face = quad('PanelFace_' + pid, w, h, FACE)
        face.matrix_world = frame_matrix(self.c + self.n * 0.0004, self.u, self.v, self.n)
        face['face'] = 'panel'; face['panel'] = pid; face['w'] = w; face['h'] = h

    def at(self, x, y, dz=0.0):
        return self.c + self.u * x + self.v * y + self.n * dz

    def M(self, x, y, dz=0.0):
        return frame_matrix(self.at(x, y, dz), self.u, self.v, self.n)

    def uv(self, x, y):
        return (0.5 + x / self.w, 0.5 + y / self.h)

    def reg(self, ctl, kind, x, y, label, **extra):
        u, v = self.uv(x, y)
        CONTROLS.append(dict(ctl=ctl, kind=kind, panel=self.pid, u=u, v=v, label=label, **extra))
        return dict(ctl=ctl, kind=kind, panel=self.pid, u=u, v=v, label=label, **extra)

    def toggle(self, ctl, x, y, label, guard=None):
        ex = self.reg(ctl, 'toggle', x, y, label)
        local_obj('Ctl_' + ctl, toggle_geo, self.M(x, y, 0.0005), MAT['bat'], ex)
        if guard:
            local_obj('Guard_' + ctl, guard_geo, self.M(x, y + 0.02, 0.0005), MAT[guard], dict(ctl=ctl, kind='guard', panel=self.pid))

    def button(self, ctl, x, y, label, guard=None, w=0.016, h=0.014):
        ex = self.reg(ctl, 'button', x, y, label)
        local_obj('Well_' + ctl, lambda: button_well_geo(w, h), self.M(x, y, 0.0), MAT['bezel'])
        local_obj('Ctl_' + ctl, lambda: button_cap_geo(w, h), self.M(x, y, 0.0), MAT['cap'], ex)
        cap_face = quad('Lamp_' + ctl, w * 0.86, h * 0.8, FACE)
        cap_face.matrix_world = self.M(x, y, 0.0082)
        cap_face['face'] = 'lamp'; cap_face['ctl'] = ctl
        if guard:
            local_obj('Guard_' + ctl, lambda: guard_geo(w + 0.008, h + 0.016, 0.016), self.M(x, y + (h + 0.016) / 2, 0.0005),
                      MAT[guard], dict(ctl=ctl, kind='guard', panel=self.pid))

    def t_handle(self, ctl, x, y, label, material='handle_y'):
        ex = self.reg(ctl, 'pull', x, y, label)
        local_obj('Ctl_' + ctl, t_handle_geo, self.M(x, y, 0.0), MAT[material], ex)
        local_obj('Collar_' + ctl, lambda: cylinder('col', (0, 0, 0), (0, 0, 0.005), 0.008, n=16, **kw()), self.M(x, y, 0.0), MAT['bezel'])

    def gauge(self, gid, x, y, r, label):
        self.reg(gid, 'gauge', x, y, label, r=r)
        local_obj('Bezel_' + gid, lambda: bezel_ring_geo(r), self.M(x, y, 0.0), MAT['bezel'])
        d = disc('Gauge_' + gid, r, FACE)
        d.matrix_world = self.M(x, y, 0.0015)
        d['face'] = 'gauge'; d['gauge'] = gid


def build():
    # ---------------- left front sub-panel (gear, flaps, hook, park brake, engine rpm / T4 gauges)
    nL = Vector((0.91, 0, 0.41)); uL = Vector((0, 1, 0)); vL = nL.cross(uL)
    PL = Panel('L', (-0.386, Y(3.80), 0.735), uL, vL, nL, 0.36, 0.20)
    PL.gauge('rpm', 0.095, 0.045, 0.033, 'RPM %')
    PL.gauge('egt', 0.020, 0.045, 0.033, 'T4 °C')
    # gear lever in its slot, with three gear position lamps drawn on the face beside it
    x, y = -0.125, 0.0
    PL.reg('gear', 'lever', x, y, 'GEAR', throw=28)
    local_obj('Slot_gear', lambda: slot_geo(0.10, 0.012), PL.M(x, y, 0.0), MAT['bezel'])
    arm, wheel = gear_lever_geo()
    for o in (arm, wheel):
        bake(o); o.matrix_world = PL.M(x, y, 0.0)
    assign(arm, MAT['bat']); assign(wheel, MAT['gearwheel'])
    lever = join([arm, wheel], 'Ctl_gear')
    lever['ctl'] = 'gear'; lever['kind'] = 'lever'; lever['panel'] = 'L'
    u, v = PL.uv(x, y); lever['u'] = u; lever['v'] = v; lever['label'] = 'GEAR'
    PL.toggle('flaps', 0.020, -0.052, 'FLAPS')
    PL.t_handle('hook', 0.085, -0.052, 'HOOK')
    PL.t_handle('park', 0.150, -0.052, 'PARK BRK', material='handle_r')

    # ---------------- right front sub-panel (caution panel, canopy, wing fold, lights, probe, FCS reset)
    nR = Vector((-0.91, 0, 0.41)); uR = Vector((0, -1, 0)); vR = nR.cross(uR)
    PR = Panel('R', (0.386, Y(3.80), 0.735), uR, vR, nR, 0.36, 0.20)
    cw = quad('CWP_Screen', 0.150, 0.080, FACE)
    cw.matrix_world = PR.M(-0.090, 0.045, 0.0012)
    cw['face'] = 'cwp'
    local_obj('Bezel_cwp', lambda: box('b', (0, 0, 0.001), (0.158, 0.088, 0.002), **kw()), PR.M(-0.090, 0.045, 0.0), MAT['bezel'])
    PR.toggle('canopy', 0.045, 0.050, 'CANOPY')
    PR.toggle('fold', 0.125, 0.050, 'WING FOLD', guard='guard_y')
    PR.toggle('navlt', -0.150, -0.055, 'NAV LTS')
    PR.toggle('beacon', -0.095, -0.055, 'ANTI-COLL')
    PR.toggle('ldglt', -0.040, -0.055, 'LDG LT')
    PR.toggle('probe', 0.030, -0.055, 'IFR PROBE')
    PR.button('fcsrst', 0.110, -0.055, 'FCS RESET', w=0.018, h=0.016)

    # ---------------- engine start panel on the left cockpit wall, level with the throttle (clear of the seat rails)
    PS = Panel('S', (-0.392, Y(4.19), 0.715), uL, vL, nL, 0.28, 0.16)
    # read left to right as the start sequence: battery, fuel pump, APU, engine masters, start buttons, generators
    PS.toggle('bat', -0.110, 0.030, 'BATTERY', guard='guard')
    PS.toggle('pump', -0.055, 0.030, 'FUEL PUMP')
    PS.toggle('apu', -0.005, 0.030, 'APU')
    PS.toggle('engL', 0.050, 0.030, 'ENG L')
    PS.toggle('engR', 0.100, 0.030, 'ENG R')
    PS.button('startL', -0.095, -0.040, 'START L', guard='guard', w=0.018, h=0.016)
    PS.button('startR', -0.035, -0.040, 'START R', guard='guard', w=0.018, h=0.016)
    PS.toggle('genL', 0.050, -0.040, 'GEN L')
    PS.toggle('genR', 0.100, -0.040, 'GEN R')

    # ---------------- master warning / caution push-lights on the main panel top edge
    tilt = 14 * D2R
    org = Vector((0, Y(3.62), 0.62))
    upm = Vector((0, math.sin(tilt), math.cos(tilt))); nm = Vector((0, -math.cos(tilt), math.sin(tilt))); rm = Vector((1, 0, 0))
    for ctl, x, m in (('mwarn', -0.175, MAT['mw']), ('mcaut', 0.175, MAT['mc'])):
        c = org + rm * x + upm * 0.165 + nm * 0.0
        o = local_obj('Ctl_' + ctl, lambda: box('cap', (0, 0, 0.005), (0.034, 0.022, 0.010), bevel=0.0015, **kw()), frame_matrix(c, rm, upm, nm), m,
                      dict(ctl=ctl, kind='button', panel='M', label='MASTER WARNING' if ctl == 'mwarn' else 'MASTER CAUTION'))
        local_obj('Well_' + ctl, lambda: button_well_geo(0.034, 0.022), frame_matrix(c, rm, upm, nm), MAT['bezel'])
    # standby instrument faces over the three round gauges (ASI, ADI, altimeter)
    for gid, x in (('asi', -0.10), ('adi', 0.0), ('alt', 0.10)):
        c = org + rm * x + upm * (-0.19) + nm * 0.0318
        d = disc('Gauge_' + gid, 0.031, FACE)
        d.matrix_world = frame_matrix(c, rm, upm, nm)
        d['face'] = 'gauge'; d['gauge'] = gid

    # ---------------- rudder pedals (pivot on a lateral axis under the panel)
    for sd, nm_ in ((-1, 'L'), (1, 'R')):
        piv = Vector((sd * 0.12, Y(3.40), 0.13))
        def pedal():
            parts = [tube_along('arm', [(0, 0, 0), (0, -0.02, 0.10), (0, -0.05, 0.16)], 0.009, n=8, **kw()),
                     box('plate', (0, -0.055, 0.17), (0.085, 0.022, 0.13), rot=(-35 * D2R, 0, 0), bevel=0.004, **kw()),
                     box('toe', (0, -0.075, 0.23), (0.085, 0.03, 0.012), rot=(-35 * D2R, 0, 0), **kw()),
                     cylinder('pivot', (-0.03, 0, 0), (0.03, 0, 0), 0.012, n=12, **kw())]
            return join(parts, 'tmp')
        o = local_obj('Pedal_' + nm_, pedal, Matrix.Translation(piv), MAT['pedal'], dict(kind='pedal', side=sd))
    # ---------------- gloved hands
    build_hands()


# ------------------------------------------------------------------ hands
def finger(name, pts, r0, r1):
    rs = [r0 + (r1 - r0) * i / (len(pts) - 1) for i in range(len(pts))]
    f = tube_along(name, pts, rs, n=10, **kw())
    # rounded fingertip
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r1 * 1.02, location=pts[-1], segments=10, ring_count=6)
    tip = bpy.context.active_object
    for c in tip.users_collection:
        c.objects.unlink(tip)
    COLL.objects.link(tip)
    return join([f, tip], name)


def rounded_box(name, c, size, rot=(0, 0, 0), bevel=0.01):
    return box(name, c, size, rot=rot, bevel=bevel, **kw())


def right_hand():
    """right glove wrapped around the stick grip. Local frame: grip axis = +Z, pilot = -Y, right = +X; origin = grip base."""
    R = 0.027          # grip radius at the fingers
    parts = []
    # palm behind and right of the grip
    parts.append(rounded_box('palm', (0.018, -0.040, 0.050), (0.060, 0.030, 0.090), rot=(0, 0, 35 * D2R), bevel=0.012))
    # four fingers curling around the front of the grip, from the right side to the left side
    for i, z in enumerate((0.082, 0.060, 0.038, 0.017)):
        rr = R + 0.009
        pts = []
        for a in (55, 95, 140, 185, 225, 250):
            t = a * D2R
            pts.append((rr * math.sin(t), -rr * math.cos(t), z - 0.004 * i * 0))
        # knuckle start inside the palm
        pts = [(0.036, -0.040, z)] + pts
        r0 = 0.0105 - 0.0006 * i
        parts.append(finger('fing%d' % i, pts, r0, r0 * 0.78))
    # thumb over the top of the grip, resting beside the trim hat
    parts.append(finger('thumb', [(0.020, -0.050, 0.095), (0.004, -0.040, 0.118), (-0.012, -0.020, 0.132), (-0.018, 0.000, 0.136)], 0.012, 0.009))
    # back of the hand / knuckle ridge
    parts.append(tube_along('knuck', [(0.040, -0.030, 0.090), (0.046, -0.022, 0.012)], 0.012, n=10, **kw()))
    glove = join(parts, 'tmp')
    assign(glove, MAT['glove'])
    cuff = tube_along('cuff', [(0.030, -0.075, 0.020), (0.036, -0.110, -0.004)], [0.030, 0.034], n=16, **kw())
    assign(cuff, MAT['glove_seam'])
    return join([glove, cuff], 'tmp')


def left_hand():
    """left glove resting over the twin throttle grip. Local frame: throttle quadrant axes; origin = throttle pivot."""
    parts = []
    top = 0.165
    parts.append(rounded_box('palm', (0.000, 0.040, top + 0.018), (0.085, 0.075, 0.030), rot=(8 * D2R, 0, 0), bevel=0.012))
    for i, x in enumerate((-0.030, -0.010, 0.010, 0.030)):
        r0 = 0.0102 - 0.0005 * abs(i - 1.5)
        pts = [(x, 0.070, top + 0.020), (x, 0.088, top + 0.014), (x, 0.094, top - 0.004), (x, 0.090, top - 0.022)]
        parts.append(finger('lf%d' % i, pts, r0, r0 * 0.8))
    parts.append(finger('lthumb', [(0.040, 0.030, top + 0.012), (0.050, 0.055, top - 0.004), (0.048, 0.075, top - 0.016)], 0.012, 0.0095))
    glove = join(parts, 'tmp')
    assign(glove, MAT['glove'])
    cuff = tube_along('lcuff', [(-0.004, 0.000, top + 0.016), (-0.010, -0.040, top + 0.006)], [0.031, 0.035], n=16, **kw())
    assign(cuff, MAT['glove_seam'])
    return join([glove, cuff], 'tmp')


def build_hands():
    # stick grip base (cockpit.py): sb = (0, Y(3.88), 0.12); grip starts at sb + (0, 0.03, 0.40) along (0, 0.18, 1)
    sb = Vector((0, Y(3.88), 0.12))
    g0 = sb + Vector((0, 0.03, 0.40))
    d = Vector((0, 0.18, 1)).normalized()
    xr = Vector((1, 0, 0))
    yr = Vector((0, 1, 0)) - d * d.y; yr.normalize()          # forward, perpendicular to the grip axis
    m = frame_matrix(g0, xr, yr, d)
    rh = bake(right_hand()); rh.matrix_world = m; rh.name = 'Hand_R'
    rh['kind'] = 'hand'; rh['side'] = 1
    # wrist point for the procedural forearm (world, Blender coords -> exported as custom prop in glTF space)
    wr = m @ Vector((0.034, -0.105, -0.002))
    rh['wrist'] = [wr.x, wr.z, -wr.y]
    tb = Vector((-0.31, Y(4.10), 0.58))
    lm = Matrix.Translation(tb)
    lh = bake(left_hand()); lh.matrix_world = lm; lh.name = 'Hand_L'
    lh['kind'] = 'hand'; lh['side'] = -1
    wl = lm @ Vector((-0.010, -0.040, 0.171))
    lh['wrist'] = [wl.x, wl.z, -wl.y]
    for o in (rh, lh):
        for p in o.data.polygons:
            p.use_smooth = True


build()
os.makedirs(OUT, exist_ok=True)
dst = os.path.join(OUT, 'controls.gltf')
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLTF_SEPARATE', export_extras=True, export_apply=True,
                          export_yup=True, export_cameras=False, export_lights=False, use_selection=False)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'controls.blend'))
print('controls exported:', len(COLL.objects), 'objects,', len(CONTROLS), 'controls')
