"""Detailed Vikramaditya-style carrier for the sim (Blender 4.2 bpy module).
Built directly in the sim's ship-local frame (three.js: x starboard, y up, z aft; deck at y = 19, bow at z = -142)
so it lines up with the physics deck, the launch spots, the wires and the island collision box.
The flight-deck surface itself stays the sim's procedural mesh (exact physics match); this file builds everything
else: hull with sponsons, island, mast and radars, catwalks and railings, weapon mounts, LSO platform, deck vehicles
and deck crew. Parts are merged by material to keep draw calls low.
usage: python carrier.py <out_dir>"""
import sys, os, math
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import bpy, bmesh
import numpy as np
from mathutils import Vector, Matrix
from lib import box, cylinder, tube_along, lathe, loft, mat, assign, join, new_obj, set_origin
OUT = sys.argv[-1] if len(sys.argv) > 1 and not sys.argv[-1].endswith('.py') else os.path.join(HERE, 'out')
TEX = os.path.join(HERE, '..', '..', 'sim', 'model', 'carrier')
D2R = math.pi / 180
rng = np.random.default_rng(33)
bpy.ops.wm.read_factory_settings(use_empty=True)
COL = bpy.data.collections.new('Carrier'); bpy.context.scene.collection.children.link(COL)
KW = dict(coll=COL)

# ---------------------------------------------------------------- ship geometry (mirrors sim/world.js)
XMAX = [(-142, 7), (-128, 13), (-100, 18), (-60, 22), (-20, 24), (40, 25), (100, 23), (130, 20), (142, 14)]
XMIN = [(-142, -7), (-128, -12), (-100, -15), (-60, -17), (-10, -22), (20, -30), (60, -33), (100, -31), (130, -24), (142, -16)]
HB = [(-142, 0.4), (-130, 5), (-110, 11), (-80, 15), (-40, 16.5), (60, 16.5), (110, 15.6), (142, 13.5)]
def tab(t, z):
    if z <= t[0][0]: return t[0][1]
    for (a, b), (c, d) in zip(t, t[1:]):
        if z <= c: return b + (d - b) * (z - a) / (c - a)
    return t[-1][1]
DECK = 19.0; BOW, STERN = -142.0, 142.0; RAMP0, RAMPR = -97.0, 182.0
def ramp(z):
    if z >= RAMP0: return 0.0
    t = min(RAMP0 - z, RAMP0 - BOW); return RAMPR - math.sqrt(RAMPR * RAMPR - t * t)
ISL = dict(x0=13.5, x1=24.5, z0=-34.0, z1=26.0, top=44.0)
ANG = 6 * D2R; LA = (0.0, 139.0); ca, sa = math.cos(ANG), math.sin(ANG)
LX = lambda t: LA[0] - sa * t; LZ = lambda t: LA[1] - ca * t
START = [(3, 53), (3, -37)]

# ship-local (three.js) -> Blender: (x, y, z) -> (x, -z, y)
def B(x, y, z): return Vector((x, -z, y))
def bx(name, c, s, m=None, rot=(0, 0, 0), bevel=0.0):
    """box with centre c = (x, y, z) ship-local and size s = (width x, height y, length z)."""
    o = box(name, tuple(B(*c)), (s[0], s[2], s[1]), rot=rot, bevel=bevel, **KW)
    if m: assign(o, m)
    return o
def cyl(name, p0, p1, r, m=None, n=12):
    o = cylinder(name, tuple(B(*p0)), tuple(B(*p1)), r, n=n, **KW)
    if m: assign(o, m)
    return o
def tube(name, pts, r, m=None, n=8, cap=True):
    o = tube_along(name, [B(*p) for p in pts], r, n=n, cap=cap, **KW)
    if m: assign(o, m)
    return o
def sphere(name, c, r, m=None, seg=20):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=tuple(B(*c)), segments=seg, ring_count=seg // 2)
    o = bpy.context.active_object
    for cc in o.users_collection: cc.objects.unlink(o)
    COL.objects.link(o); o.name = name
    for p in o.data.polygons: p.use_smooth = True
    if m: assign(o, m)
    return o

def bake(o):
    # matrix_world is only refreshed on a depsgraph update; for fresh unparented objects use the basis transform
    m = o.matrix_basis.copy() if o.parent is None else o.matrix_world.copy()
    o.data.transform(m); o.matrix_basis = Matrix.Identity(4); return o
def box_uv(o, tile=6.0):
    """world-space box projection UVs (dominant normal axis), tiling every `tile` metres."""
    bake(o); me = o.data
    uv = me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
    for p in me.polygons:
        n = p.normal; ax = max(range(3), key=lambda i: abs(n[i]))
        for li in p.loop_indices:
            v = me.vertices[me.loops[li].vertex_index].co
            a, b = [(v.y, v.z), (v.x, v.z), (v.x, v.y)][ax]
            uv.data[li].uv = (a / tile, b / tile)
    return o

# ---------------------------------------------------------------- materials
def tex_mat(name, img, rough=0.75, metal=0.1, normal=None, nstr=0.6, tint=(1, 1, 1)):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; b = nt.nodes['Principled BSDF']
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = bpy.data.images.load(os.path.join(TEX, img))
    if tint != (1, 1, 1):
        mix = nt.nodes.new('ShaderNodeMixRGB'); mix.blend_type = 'MULTIPLY'; mix.inputs[0].default_value = 1
        mix.inputs[2].default_value = (*tint, 1); nt.links.new(t.outputs[0], mix.inputs[1]); nt.links.new(mix.outputs[0], b.inputs['Base Color'])
    else: nt.links.new(t.outputs[0], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    if normal:
        tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = bpy.data.images.load(os.path.join(TEX, normal)); tn.image.colorspace_settings.name = 'Non-Color'
        nm = nt.nodes.new('ShaderNodeNormalMap'); nm.inputs[0].default_value = nstr
        nt.links.new(tn.outputs[0], nm.inputs[1]); nt.links.new(nm.outputs[0], b.inputs['Normal'])
    return m
M = {
    'paint': tex_mat('ShipPaint', 'paint.jpg', 0.72, 0.15, 'paint_n.jpg', 0.5),
    'paintD': tex_mat('ShipPaintDark', 'paint.jpg', 0.78, 0.1, 'paint_n.jpg', 0.5, tint=(0.62, 0.64, 0.67)),
    'hull': tex_mat('Hull', 'hull.jpg', 0.7, 0.1),
    'glass': mat('IslandWindows', (0.02, 0.035, 0.05), 0.12, 0.25),
    'white': mat('ShipWhite', (0.80, 0.81, 0.80), 0.55),
    'black': mat('ShipBlack', (0.03, 0.03, 0.035), 0.6, 0.2),
    'radar': mat('RadarFace', (0.06, 0.07, 0.08), 0.45, 0.3),
    'rail': mat('Railing', (0.62, 0.64, 0.66), 0.45, 0.6),
    'grate': mat('Grating', (0.12, 0.13, 0.14), 0.7, 0.4),
    'yellow': mat('DeckYellow', (0.78, 0.58, 0.06), 0.55),
    'red': mat('DeckRed', (0.62, 0.06, 0.04), 0.5),
    'tyre': mat('Tyre', (0.025, 0.025, 0.028), 0.85),
    'skin': mat('CrewSkin', (0.42, 0.27, 0.18), 0.6),
    'trouser': mat('CrewTrousers', (0.10, 0.11, 0.13), 0.85),
    'lamp': mat('ShipLamp', (0.9, 0.85, 0.7), 0.3, emit=(1, 0.9, 0.7), emit_strength=0.0),
}
JERSEY = {c: mat('Jersey_' + c, rgb, 0.8) for c, rgb in {
    'yellow': (0.85, 0.66, 0.05), 'green': (0.08, 0.40, 0.12), 'purple': (0.30, 0.10, 0.42), 'brown': (0.30, 0.17, 0.07),
    'white': (0.82, 0.83, 0.82), 'red': (0.62, 0.06, 0.05), 'blue': (0.07, 0.18, 0.52)}.items()}

# ================================================================ HULL with flared sponsons up to the deck edge
def hull():
    NS = 150; rings = []
    for k in range(NS + 1):
        z = BOW + (STERN - BOW) * k / NS
        hb = tab(HB, z); xe, xw = tab(XMAX, z), tab(XMIN, z); top = DECK - 0.05 + ramp(z)
        rake = (z + 120) * -0.35 if z < -120 else 0.0
        def side(s, xedge):
            ox = abs(xedge)
            pts = [(ox, top), (ox, top - 0.9), (hb + (ox - hb) * 0.86, top - 1.6), (hb * 1.01, 13.0), (hb * 0.995, 8.0), (hb * 0.975, 2.0),
                   (hb * 0.95, 0.0), (hb * 0.88, -4.6), (hb * 0.62, -9.2)]
            return [(s * x, y) for x, y in pts]
        st = side(1, xe); pt = side(-1, xw)
        ring = st + [(0.0, -10.2)] + pt[::-1]
        rings.append([B(x, y, z + (rake * (10 - y) / 26 if y < 10 else 0)) for x, y in ring])
    o = loft('Hull', [[tuple(p) for p in r] for r in rings], closed=False, smooth=True, auto_smooth=50, **KW)
    # transom: fan from the last ring's centre
    me = o.data
    uv = me.uv_layers.new(name='UVMap')
    for p in me.polygons:
        cx = sum(me.vertices[i].co.x for i in p.vertices) / len(p.vertices)
        for li in p.loop_indices:
            v = me.vertices[me.loops[li].vertex_index].co
            y, z = v.z, -v.y
            h = min(max((19 - y) / 30, 0), 1) * 0.5
            if cx >= 0: uv.data[li].uv = ((145 - z) / 290, 1 - h)
            else: uv.data[li].uv = ((z + 145) / 290, 0.5 - h)
    assign(o, M['hull'])
    last = rings[-1]
    n = len(last)   # fan to the centre, including the closing triangle across the top between the two deck edges
    tr = new_obj('Transom', [tuple(p) for p in last] + [tuple(B(0, 6, STERN))], [(n, i, i + 1) for i in range(n - 1)] + [(n, n - 1, 0)], smooth=False, **KW)
    box_uv(tr, 6); assign(tr, M['paintD'])
    # sponson girders under the overhangs (visible from the side and from below on approach)
    parts = []
    for z in np.arange(-96, 136, 7.0):
        for s, t in ((1, XMAX), (-1, XMIN)):
            hb = tab(HB, z); xe = abs(tab(t, z))
            if xe - hb < 3: continue
            parts.append(tube('girder', [(s * hb, 13.2, z), (s * (xe - 0.8), DECK - 1.7, z)], 0.28, n=6))
    if parts: g = join(parts, 'Girders'); box_uv(g, 4); assign(g, M['paintD'])
hull()

# ================================================================ ISLAND
def island():
    I = ISL; D = DECK; cx = (I['x0'] + I['x1']) / 2; W = I['x1'] - I['x0']
    P, Dk, G = M['paint'], M['paintD'], M['glass']
    objs = []
    def add(o, m=None, tile=6):
        box_uv(o, tile)
        if m: assign(o, m)
        objs.append(o); return o
    # stepped superstructure
    add(bx('isl1', (cx, D + 3.6, -4), (W, 7.2, 60), bevel=0.45), P)
    add(bx('isl1b', (cx, D + 7.35, -4), (W + 0.4, 0.3, 60.4)), Dk)
    add(bx('isl2', (cx + 0.3, D + 10.6, -6), (W - 1.2, 6.2, 50), bevel=0.4), P)
    # sloped forward face (Kiev-class islands rake back at the front)
    add(bx('isl_slope', (cx + 0.3, D + 9.6, -31.6), (W - 1.4, 6.0, 3.0), rot=(math.radians(-24), 0, 0)), P)
    add(bx('isl2b', (cx + 0.3, D + 13.85, -6), (W - 0.8, 0.3, 50.4)), Dk)
    add(bx('isl3', (cx + 0.4, D + 16.4, -12), (W - 1.8, 5.0, 26), bevel=0.12), P)          # navigation bridge level
    add(bx('bridge_win', (cx + 0.4, D + 17.2, -12), (W - 1.6, 1.4, 26.2)), G)
    add(bx('bridge_wing', (I['x0'] - 1.0, D + 15.0, -21), (5.0, 0.35, 3.2)), Dk)
    add(bx('bridge_wing2', (I['x1'] + 1.2, D + 15.0, -21), (3.0, 0.35, 3.2)), Dk)
    # primary flight control: glassed box cantilevered over the deck, raked windows looking aft and to port
    add(bx('prifly_base', (I['x0'] + 2.4, D + 16.2, 9), (4.4, 4.6, 10), bevel=0.2), P)      # the cab sits on its own deckhouse
    add(bx('prifly', (I['x0'] + 1.6, D + 20.0, 9), (5.4, 3.0, 11), bevel=0.1), P)
    add(bx('prifly_w', (I['x0'] + 1.6, D + 20.6, 9), (5.6, 1.5, 11.2)), G)
    add(bx('prifly_w2', (I['x0'] + 1.6, D + 20.6, 14.65), (5.0, 1.5, 0.1)), G)
    # forward tower with four flat phased-array faces, aft lattice mast, funnel
    add(bx('tower_base', (cx + 0.6, D + 16.2, -22), (7.8, 4.8, 10.4), bevel=0.25), P)     # deckhouse carrying the radar tower
    add(bx('tower', (cx + 0.6, D + 23.0, -22), (8.4, 9.0, 11.0), bevel=0.35), P)
    for (x, z, w, d) in ((cx + 0.6 - 4.25, -22, 0.2, 7.4), (cx + 0.6 + 4.25, -22, 0.2, 7.4), (cx + 0.6, -27.55, 6.4, 0.2), (cx + 0.6, -16.45, 6.4, 0.2)):
        add(bx('array', (x, D + 24.0, z), (w, 6.6, d)), M['radar'])
        add(bx('array_frame', (x, D + 24.0, z), (w + (0.25 if w > 1 else 0.05), 6.9, d + (0.25 if d > 1 else 0.05))), Dk)
    add(bx('tower_sup', (cx + 0.6, D + 31.0, -22), (3.0, 3.0, 3.0), bevel=0.2), Dk)
    add(cyl('tower_mast', (cx + 0.6, D + 32.5, -22), (cx + 0.6, D + 38, -22), 0.25), Dk)
    # vertical piping and ladders on the deck-facing (port) side, external stairs between levels
    for z in (-30, -22.5, -9, 6, 20):
        add(cyl('pipe', (I['x0'] - 0.18, D + 0.2, z), (I['x0'] - 0.18, D + 7.3, z), 0.09, n=6), Dk)
    for z in (-18, 12):
        for k in range(12): add(bx('rung', (I['x0'] - 0.25, D + 0.5 + k * 0.55, z), (0.06, 0.05, 0.6)), M['rail'])
        for dz in (-0.3, 0.3): add(cyl('ladder', (I['x0'] - 0.25, D + 0.2, z + dz), (I['x0'] - 0.25, D + 6.8, z + dz), 0.03, n=4), M['rail'])
    add(bx('stair', (I['x0'] + 0.6, D + 10.5, -33.0), (1.2, 0.2, 7.0), rot=(math.radians(38), 0, 0)), Dk)
    add(bx('tower_top', (cx + 0.6, D + 27.9, -22), (6.4, 0.8, 8.4)), Dk)
    add(bx('funnel', (cx + 1.6, D + 18.5, 18), (6.6, 11, 10), bevel=0.25), Dk)
    add(bx('funnel_cap', (cx + 1.6, D + 24.2, 18.6), (6.0, 0.6, 9.0)), M['black'])
    for k in range(4): add(bx('grille', (cx + 1.6 + (k - 1.5) * 1.3, D + 24.55, 18.6), (0.9, 0.2, 7.8)), M['black'])
    mx, mz = cx + 0.6, 2.0
    add(cyl('mast', (mx, D + 14, mz), (mx, D + 41, mz), 0.55), Dk)
    for (y, w) in ((D + 28, 11), (D + 34, 8), (D + 38.5, 5)):
        add(bx('yard', (mx, y, mz), (w, 0.28, 0.28)), Dk)
    for s_ in (-1, 1):                                         # signal halyards from the yard tips down to the island roof
        add(tube('halyard', [(mx + s_ * 5.4, D + 28, mz), (mx + s_ * 4.2, D + 14.2, mz - 6)], 0.02, n=3), M['black'])
    add(bx('mast_plat', (mx, D + 31, mz), (3.4, 0.25, 3.4)), Dk)
    for k in range(4):                                        # mast lattice braces
        a = k * math.pi / 2
        add(tube('brace', [(mx + math.cos(a) * 1.8, D + 14.5, mz + math.sin(a) * 1.8), (mx + math.cos(a) * 0.45, D + 30.5, mz + math.sin(a) * 0.45)], 0.12, n=6), Dk)
    for (x, y, z, r) in ((mx, D + 43.0, mz, 1.5), (cx - 2.6, D + 29.6, -15.5, 1.6), (cx + 3.4, D + 29.6, -15.5, 1.6), (cx - 2.2, D + 21.5, 6, 1.1), (cx + 3.2, D + 15.8, -30, 0.9)):
        add(sphere('dome', (x, y, z), r), M['white']); add(cyl('dome_ped', (x, y - r - 0.9, z), (x, y - r + 0.1, z), 0.35), Dk)
    for (x, z, h) in ((I['x1'] - 0.5, -30, 9), (I['x1'] - 0.5, 22, 8), (cx + 3, -3, 7), (I['x0'] + 1, -32, 6), (cx - 2, 18, 6)):
        add(cyl('whip', (x, D + 14, z), (x, D + 14 + h, z), 0.06, n=5), Dk)
    # doors, portholes and AC units
    for z in (-28, -14, 2, 18):                                # watertight doors: dark leaf in a raised frame
        add(bx('door_frame', (I['x0'] - 0.08, D + 1.25, z), (0.18, 2.5, 1.55)), Dk)
        add(bx('door', (I['x0'] - 0.2, D + 1.2, z), (0.06, 2.2, 1.2)), M['black'])
    for z in np.arange(-32, 25, 2.6):                         # window rows with frames
        for (x, y, dz) in ((I['x0'] - 0.1, D + 5.2, 0), (I['x0'] + 0.48, D + 11.8, -2)):
            add(bx('win_frame', (x + 0.04, y, z + dz), (0.12, 0.75, 1.05)), Dk)
            add(bx('win', (x - 0.04, y, z + dz), (0.06, 0.55, 0.85)), G)
    for _ in range(14):
        x = rng.uniform(I['x0'] + 1, I['x1'] - 1); z = rng.uniform(-28, 20)
        add(bx('unit', (x, D + 14.3, z), (rng.uniform(0.8, 2), 0.9, rng.uniform(0.8, 2))), Dk)
    # life-raft canisters along the outboard (starboard) face of level 1
    for z in np.arange(-30, 24, 1.6):
        o = cyl('raft', (I['x1'] + 0.55, D + 4.2, z - 0.55), (I['x1'] + 0.55, D + 4.2, z + 0.55), 0.42, n=10); objs.append(o); assign(o, M['white'])
    # rotating air-search radar on the mast head (its own object so the sim can spin it)
    ant = [bx('rad_bar', (mx, D + 45.6, mz), (7.2, 1.3, 0.5)), bx('rad_back', (mx, D + 45.6, mz + 0.45), (7.0, 0.3, 0.3)), cyl('rad_ped', (mx, D + 44.6, mz), (mx, D + 45.1, mz), 0.35)]
    r = join(ant, 'Radar_Rot'); assign(r, M['radar']); bake(r); set_origin(r, tuple(B(mx, D + 45.0, mz)))
    # railings round every roof edge
    rails = []
    for (y, x0, x1, z0, z1) in ((D + 7.5, I['x0'], I['x1'], -34, 26), (D + 14.0, I['x0'] + 0.5, I['x1'] - 0.1, -31, 19), (D + 18.9, I['x0'] + 0.5, I['x1'] - 0.5, -25, 1)):
        for (a, b) in (((x0, z0), (x1, z0)), ((x1, z0), (x1, z1)), ((x1, z1), (x0, z1)), ((x0, z1), (x0, z0))):
            L = math.hypot(b[0] - a[0], b[1] - a[1]); n = max(2, int(L / 1.6))
            rails.append(tube('rail', [(a[0], y + 1.05, a[1]), (b[0], y + 1.05, b[1])], 0.035, n=5))
            for k in range(n + 1):
                t = k / n; px, pz = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
                rails.append(cyl('post', (px, y, pz), (px, y + 1.05, pz), 0.03, n=4))
    j = join(rails, 'IslandRails'); assign(j, M['rail'])
island()

# ================================================================ CATWALKS, NETS, WEAPONS, BOATS
def edges():
    walks, rails = [], []
    for s, t in ((1, XMAX), (-1, XMIN)):
        z = -118.0
        while z < 134:
            z2 = min(z + 2.0, 134)
            if s > 0 and -38 < z < 30: z = z2; continue        # the island sits on the starboard edge here
            e0, e1 = tab(t, z) + s * 0.75, tab(t, z2) + s * 0.75
            y0, y1 = DECK - 1.1 + ramp(z), DECK - 1.1 + ramp(z2)
            c = ((e0 + e1) / 2, (y0 + y1) / 2, (z + z2) / 2)
            ang = math.atan2(e1 - e0, z2 - z)
            o = bx('walk', c, (1.3, 0.08, math.hypot(e1 - e0, z2 - z) + 0.05)); o.rotation_euler = (0, 0, ang); walks.append(o)
            ro = (e0 + s * 0.65, e1 + s * 0.65)
            rails.append(tube('wr', [(ro[0], y0 + 1.0, z), (ro[1], y1 + 1.0, z2)], 0.03, n=4))
            rails.append(cyl('wp', (ro[0], y0, z), (ro[0], y0 + 1.0, z), 0.025, n=4))
            z = z2
    w = join(walks, 'Catwalks'); box_uv(w, 2); assign(w, M['grate'])
    r = join(rails, 'CatwalkRails'); assign(r, M['rail'])
    objs = []
    def ciws(x, z, s):
        y = DECK - 1.6
        objs.append(bx('ciws_plat', (x, y - 0.2, z), (5.0, 0.4, 5.0)))
        objs.append(cyl('ciws_base', (x, y, z), (x, y + 1.0, z), 1.0, n=16))
        objs.append(bx('ciws_turret', (x, y + 1.6, z), (1.8, 1.2, 2.2), bevel=0.25))
        objs.append(cyl('ciws_gun', (x, y + 1.7, z - 0.6), (x + s * 0.2, y + 2.0, z - 3.2), 0.18, n=8))
    for (z, s, t) in ((-112, 1, XMAX), (-112, -1, XMIN), (128, 1, XMAX), (128, -1, XMIN)):
        ciws(tab(t, z) + s * 2.6, z, s)
    for k in range(4): objs.append(bx('vls', (tab(XMAX, -80) - 2.5, DECK - 1.2 + ramp(-80), -86 + k * 2.4), (2.0, 0.6, 2.0)))
    o = join(objs, 'Weapons'); box_uv(o, 4); assign(o, M['paintD'])
    # boat on davits, starboard aft
    bz, bxp = 96, tab(HB, 96) + 1.6
    b = lathe('boat', [(0, 0.1), (0.8, 1.0), (5.2, 1.1), (6.5, 0.5), (7.0, 0.05)], tuple(B(bxp, 13.5, bz + 3.5)), (0, 1, 0), n=12, **KW)
    assign(b, M['red'])
    dv = [tube('davit', [(tab(HB, z), 13, z), (tab(HB, z) + 1.4, 16.5, z), (bxp, 15.6, z)], 0.12, n=6) for z in (bz - 2.5, bz + 2.5)]
    d = join(dv, 'Davits'); assign(d, M['rail'])
edges()

# ================================================================ LSO PLATFORM, VEHICLES
def lso():
    z0 = 40.0; xe = tab(XMIN, z0)
    p = [bx('lso_floor', (xe - 2.0, DECK - 0.3, z0), (4.4, 0.25, 7.0))]
    p.append(bx('lso_wind', (xe - 2.0, DECK + 0.55, z0 - 3.6), (4.2, 1.5, 0.12)))
    p.append(bx('lso_console', (xe - 1.2, DECK + 0.25, z0 - 2.4), (1.6, 1.0, 0.7)))
    o = join(p, 'LSOPlatform'); box_uv(o, 3); assign(o, M['paintD'])
    rr = [tube('lso_rail', [(xe - 4.2, DECK + 0.75, z0 - 3.5), (xe - 4.2, DECK + 0.75, z0 + 3.5), (xe + 0.1, DECK + 0.75, z0 + 3.5)], 0.035, n=4)]
    j = join(rr, 'LSORails'); assign(j, M['rail'])
lso()

def vehicle(kind, x, z, yaw):
    parts = {'body': [], 'tyre': [], 'glass': [], 'dark': []}
    if kind == 'tractor':
        parts['body'] += [bx('t1', (0, 0.55, 0), (2.0, 0.7, 3.6), bevel=0.1), bx('t2', (0, 1.15, 0.9), (1.8, 0.5, 1.4), bevel=0.08)]
        parts['dark'] += [bx('seat', (0, 1.45, 1.1), (0.6, 0.5, 0.5))]
        wb = [(0.95, -1.1), (-0.95, -1.1), (0.95, 1.1), (-0.95, 1.1)]; r = 0.38
    elif kind == 'firetruck':
        parts['body'] += [bx('f1', (0, 0.9, 0), (2.4, 1.4, 6.2), bevel=0.12), bx('f2', (0, 1.95, -2.0), (2.2, 0.8, 1.9), bevel=0.08)]
        parts['glass'] += [bx('fw', (0, 2.0, -2.97), (2.0, 0.55, 0.06))]
        parts['dark'] += [cyl('nozzle', (0.5, 1.9, 1.0), (0.5, 2.3, -1.8), 0.12, n=8)]
        wb = [(1.15, -2.0), (-1.15, -2.0), (1.15, 2.0), (-1.15, 2.0)]; r = 0.5
    elif kind == 'crane':
        parts['body'] += [bx('c1', (0, 1.0, 0), (3.0, 1.6, 7.0), bevel=0.12), bx('c2', (0, 2.2, 1.5), (2.2, 1.0, 2.6), bevel=0.1),
                          tube('boom', [(0, 2.4, 1.0), (0, 6.5, -4.5)], 0.32, n=8)]
        parts['dark'] += [tube('hook', [(0, 6.5, -4.5), (0, 3.5, -4.6)], 0.04, n=4)]
        wb = [(1.4, -2.4), (-1.4, -2.4), (1.4, 2.4), (-1.4, 2.4)]; r = 0.6
    else:   # fuel cart
        parts['body'] += [cyl('tank', (0, 0.9, -1.4), (0, 0.9, 1.4), 0.7, n=14), bx('frame', (0, 0.35, 0), (1.6, 0.2, 3.2))]
        wb = [(0.8, -1.0), (-0.8, -1.0), (0.8, 1.0), (-0.8, 1.0)]; r = 0.3
    for (wx, wz) in wb: parts['tyre'].append(cyl('w', (wx - 0.2, r, wz), (wx + 0.2, r, wz), r, n=12))
    out = []
    for k, objs in parts.items():
        if not objs: continue
        o = join(objs, kind + '_' + k)
        o.matrix_world = Matrix.Translation(B(x, DECK, z)) @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Translation(-B(0, 0, 0))
        bake(o); box_uv(o, 3)
        assign(o, {'body': M['yellow'] if kind != 'firetruck' else M['red'], 'tyre': M['tyre'], 'glass': M['glass'], 'dark': M['black']}[k])
        out.append(o)
    return out
for args in (('tractor', 21.5, 60, 0.3), ('tractor', 10.5, -45, -0.2), ('tractor', 19, 104, 1.2), ('firetruck', 17.5, 128, 0.05),
             ('crane', 19.5, 36, 0.0), ('fuel', 21.5, 84, 0.4)):
    vehicle(*args)

# ================================================================ DECK CREW
def crew(x, z, yaw, colour, pose=0.0):
    J = JERSEY[colour]; parts = {J: [], M['trouser']: [], M['skin']: [], M['black']: []}
    for s in (-1, 1):
        parts[M['trouser']].append(tube('leg', [(s * 0.11, 0.08, 0), (s * 0.12, 0.85, 0)], [0.075, 0.085], n=7))
        parts[M['black']].append(bx('boot', (s * 0.11, 0.06, -0.06), (0.12, 0.12, 0.28)))
        a = (0.35 + pose) * s
        parts[J].append(tube('arm', [(s * 0.24, 1.42, 0), (s * (0.27 + 0.38 * math.sin(abs(a)) * 0.6), 1.42 - 0.55 * math.cos(a * 0.6), -0.05)], [0.06, 0.05], n=6))
    parts[J].append(tube('torso', [(0, 0.86, 0), (0, 1.25, 0), (0, 1.50, 0)], [0.17, 0.19, 0.17], n=10))
    parts[M['skin']].append(sphere('head', (0, 1.66, 0), 0.105, seg=10))
    parts[J].append(sphere('helmet', (0, 1.70, 0.005), 0.118, seg=10))
    parts[M['black']].append(bx('goggles', (0, 1.68, -0.095), (0.17, 0.05, 0.04)))
    out = []
    for m, objs in parts.items():
        o = join(objs, 'crew'); o.matrix_world = Matrix.Translation(B(x, DECK, z)) @ Matrix.Rotation(yaw, 4, 'Z'); bake(o); assign(o, m); out.append(o)
    return out
CREW = [(-6.5, 47, 0.4, 'yellow'), (9.5, 60, -0.8, 'green'), (11.8, 49, -1.2, 'purple'), (-5.0, -43, 0.3, 'yellow'), (9.8, -30, -1.4, 'brown'),
        (12.2, -8, -1.57, 'white'), (12.0, 4, -1.2, 'red'), (14.0, 31, -0.6, 'blue'), (13.0, 78, -0.2, 'brown'), (20.5, 88, 2.4, 'blue'),
        (21.8, 117, 2.8, 'green'), (11.5, 108, -1.0, 'red'), (tab(XMIN, 40) - 2.8, 41.5, 3.0, 'white'), (tab(XMIN, 40) - 1.4, 39.0, 2.7, 'white'),
        (-10.5, 70, 1.3, 'green'), (-8.0, -60, 0.2, 'yellow')]
for i, c in enumerate(CREW): crew(*c, pose=0.25 * math.sin(i * 1.7))

# ================================================================ merge by material and export
groups = {}
for o in list(COL.objects):
    if o.type != 'MESH' or o.name == 'Radar_Rot': continue
    groups.setdefault(o.active_material.name, []).append(o)
for name, objs in groups.items():
    for o in objs:
        if not o.data.uv_layers: box_uv(o, 6)
    j = join(objs, 'Ship_' + name); j.active_material.name = name
for o in COL.objects:
    if o.type == 'MESH':
        for p in o.data.polygons: p.use_smooth = p.use_smooth
os.makedirs(OUT, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'carrier.gltf'), export_format='GLTF_SEPARATE', export_extras=True, export_apply=True,
                          export_yup=True, export_image_format='JPEG', export_texcoords=True, export_normals=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'carrier.blend'))
tris = sum(len(o.data.polygons) for o in COL.objects if o.type == 'MESH')
print('carrier exported:', len(COL.objects), 'objects,', tris, 'faces')
