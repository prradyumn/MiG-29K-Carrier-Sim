"""Thoise-style high-altitude airbase (Nubra valley, 3,060 m) for the Siachen location, built in Blender.

Runway-local frame (Blender): X along runway 10 -> 28 (origin at the runway midpoint), Y to the left of that
direction (north side), Z up, ground at Z = 0. The sim places the export on the graded airfield platform.
  - runway 3035 x 44 m, 7.5 m shoulders; painted markings: threshold piano keys, designators 10 / 28,
    centreline, touchdown-zone bars, aiming points, edge lines; tyre rubber in the touchdown zones
  - parallel taxiway 200 m south with three links, an apron, six hardened aircraft shelters, a transport
    hangar, the control tower, technical-area buildings, a fuel farm behind a berm, a perimeter road
  - approach light bars, PAPI units, edge-light fixtures (lit by the sim at night), windsock
Run: python airbase.py <out_dir>   -> airbase.gltf (+ .bin + textures); embed with embed_gltf.py
"""
import sys, os, math
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'blender', 'scripts'))
import bpy
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from mathutils import Vector
from lib import box, cylinder, loft, mat, assign, join, new_obj

OUT = sys.argv[-1] if len(sys.argv) > 1 and not sys.argv[-1].endswith('.py') else os.path.join(HERE, '..', 'build', 'airbase')
os.makedirs(OUT, exist_ok=True)
L, W, SH = 3035.0, 44.0, 7.5
TX = -200.0                     # taxiway centreline (south of the runway)
bpy.ops.wm.read_factory_settings(use_empty=True)
COLL = bpy.context.scene.collection
K = dict(coll=COLL)
rng = np.random.default_rng(3)

# ---------------------------------------------------------------- runway texture (painted)
PX = 4096; PY = 256                                   # 0.74 m x 0.23 m per texel
def runway_texture(path):
    img = Image.new('RGB', (PX, PY)); px = np.zeros((PY, PX, 3), np.float32)
    base = np.array([0.20, 0.20, 0.205])
    noise = rng.normal(0, 0.012, (PY, PX))[..., None]
    patch = np.kron(rng.normal(0, 0.02, (PY // 16 + 1, PX // 64 + 1)), np.ones((16, 64)))[:PY, :PX, None]
    px[:] = base + noise + patch
    # tyre rubber in both touchdown zones (darker, streaky along the centreline)
    xs = np.arange(PX) / PX * L; ys = (np.arange(PY) / PY - 0.5) * W
    X, Y = np.meshgrid(xs, ys)
    for x0 in (300, L - 300):
        r = np.exp(-((X - x0) / 330) ** 2) * np.exp(-(Y / 9) ** 2) * (0.6 + 0.4 * rng.random((PY, PX)))
        px -= r[..., None] * 0.09
    img = Image.fromarray((np.clip(px, 0, 1) * 255).astype(np.uint8)); d = ImageDraw.Draw(img)
    WHITE = (232, 232, 228)
    m = lambda x: int(x / L * PX); n = lambda y: int((y / W + 0.5) * PY)
    # edge lines
    for y in (-W / 2 + 0.6, W / 2 - 0.6): d.rectangle([0, n(y) - 1, PX, n(y) + 1], fill=WHITE)
    # threshold piano keys (16 stripes), designators, centreline, touchdown and aiming-point markings
    try: font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', 120)
    except Exception: font = ImageFont.load_default()
    for end in (0, 1):
        s = 1 if end == 0 else -1; x0 = 6 if end == 0 else L - 6
        for k in range(16):
            y = -W / 2 + 3 + k * (W - 6) / 15.5
            if abs(y) < 1.5: continue
            xa, xb = sorted([x0, x0 + s * 30]); d.rectangle([m(xa), n(y), m(xb), n(y + 1.8)], fill=WHITE)
        # designator, rotated so it reads on approach
        txt = '10' if end == 0 else '28'
        t = Image.new('L', (260, 150)); ImageDraw.Draw(t).text((10, 0), txt, font=font, fill=255)
        t = t.rotate(-90 if end == 0 else 90, expand=True).resize((int(18 / L * PX * 1.0) + 40, int(18 / W * PY)))
        xc = x0 + s * 52; img.paste(Image.new('RGB', t.size, WHITE), (m(xc) - t.size[0] // 2, n(0) - t.size[1] // 2), t)
        # aiming points (2 broad bars at 400 m) and touchdown-zone pairs every 150 m
        xa = x0 + s * 400
        for yy in (-W / 2 + 6, W / 2 - 16): d.rectangle([m(min(xa, xa + s * 60)), n(yy), m(max(xa, xa + s * 60)), n(yy + 10)], fill=WHITE)
        for k, cnt in ((150, 3), (300, 3), (550, 2), (700, 2), (850, 1), (1000, 1)):
            xk = x0 + s * k
            for j in range(cnt):
                for side in (-1, 1):
                    yy = side * (5 + j * 3.2); d.rectangle([m(min(xk, xk + s * 22)), n(yy - 0.8), m(max(xk, xk + s * 22)), n(yy + 0.8)], fill=WHITE)
    for x in np.arange(110, L - 110, 50): d.rectangle([m(x), n(-0.45), m(x + 30), n(0.45)], fill=WHITE)
    img.save(path, quality=92)
runway_texture(os.path.join(OUT, 'runway.jpg'))

# ---------------------------------------------------------------- materials
M = {
    'asphalt': mat('AbAsphalt', (0.06, 0.06, 0.062), 0.82),
    'shoulder': mat('AbShoulder', (0.24, 0.23, 0.21), 0.9),
    'concrete': mat('AbConcrete', (0.36, 0.35, 0.33), 0.85),
    'has': mat('AbShelter', (0.40, 0.39, 0.36), 0.9),
    'door': mat('AbShelterDoor', (0.10, 0.11, 0.10), 0.6, 0.6),
    'clad': mat('AbCladding', (0.30, 0.34, 0.30), 0.55, 0.4),
    'roof': mat('AbRoof', (0.33, 0.12, 0.10), 0.6, 0.3),
    'wall': mat('AbWall', (0.55, 0.50, 0.42), 0.85),
    'glass': mat('AbGlass', (0.02, 0.03, 0.04), 0.08, 0.6),
    'tank': mat('AbTank', (0.58, 0.58, 0.55), 0.4, 0.6),
    'berm': mat('AbBerm', (0.30, 0.27, 0.23), 0.95),
    'light': mat('AbLightFixture', (0.15, 0.15, 0.13), 0.5, 0.5),
    'yellow': mat('AbYellow', (0.75, 0.55, 0.05), 0.5),
    'red': mat('AbRed', (0.6, 0.06, 0.04), 0.5),
    'white': mat('AbWhite', (0.80, 0.80, 0.78), 0.6),
    'sock': mat('AbWindsock', (0.85, 0.30, 0.05), 0.8),
    'road': mat('AbRoad', (0.13, 0.13, 0.13), 0.85),
}
# the runway material uses the painted texture
rw = bpy.data.materials.new('AbRunway'); rw.use_nodes = True
bs = rw.node_tree.nodes['Principled BSDF']; tx = rw.node_tree.nodes.new('ShaderNodeTexImage')
tx.image = bpy.data.images.load(os.path.join(OUT, 'runway.jpg')); rw.node_tree.links.new(tx.outputs['Color'], bs.inputs['Base Color'])
bs.inputs['Roughness'].default_value = 0.8

def put(o, m): assign(o, m); return o
def slab(name, x0, x1, y0, y1, z, m, uv=None):
    vs = [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)]
    o = new_obj(name, vs, [(0, 1, 2, 3)], smooth=False, **K)
    if uv:
        lay = o.data.uv_layers.new(name='UVMap')
        for i, (a, b) in enumerate(uv): lay.data[i].uv = (a, b)
    return put(o, m)

objs = []
# ---------------------------------------------------------------- pavements
objs.append(slab('Runway', -L / 2, L / 2, -W / 2, W / 2, 0.06, rw, uv=[(0, 0), (1, 0), (1, 1), (0, 1)]))
shoulders = [slab('sh', -L / 2 - 60, L / 2 + 60, -W / 2 - SH, -W / 2, 0.03, M['shoulder']), slab('sh', -L / 2 - 60, L / 2 + 60, W / 2, W / 2 + SH, 0.03, M['shoulder']),
             slab('sh', -L / 2 - 60, -L / 2, -W / 2, W / 2, 0.03, M['shoulder']), slab('sh', L / 2, L / 2 + 60, -W / 2, W / 2, 0.03, M['shoulder'])]
objs.append(put(join(shoulders, 'Ab_Shoulders'), M['shoulder']))
tw = [slab('tw', -L / 2 + 40, L / 2 - 40, TX - 11.5, TX + 11.5, 0.05, M['asphalt'])]
for xc in (-L / 2 + 60, 0.0, L / 2 - 60):
    tw.append(slab('link', xc - 11.5, xc + 11.5, TX + 11.5, -W / 2 - SH, 0.05, M['asphalt']))
objs.append(put(join(tw, 'Ab_Taxiways'), M['asphalt']))
# apron and shelter taxi-lanes south of the taxiway
ap = [slab('apron', -300, 300, TX - 160, TX - 11.5, 0.05, M['concrete'])]
for k in range(6):
    xc = -1100 + k * 110; ap.append(slab('lane', xc - 9, xc + 9, TX - 70, TX - 11.5, 0.05, M['concrete']))
objs.append(put(join(ap, 'Ab_Apron'), M['concrete']))
# taxiway centreline and hold-short markings (yellow)
ym = [slab('tcl', -L / 2 + 40, L / 2 - 40, TX - 0.12, TX + 0.12, 0.07, M['yellow'])]
for xc in (-L / 2 + 60, 0.0, L / 2 - 60):
    ym.append(slab('hold', xc - 11, xc + 11, -W / 2 - SH - 60 - 0.3, -W / 2 - SH - 60 + 0.3, 0.07, M['yellow']))
    ym.append(slab('lcl', xc - 0.12, xc + 0.12, TX + 11.5, -W / 2 - SH, 0.07, M['yellow']))
objs.append(put(join(ym, 'Ab_YellowMarks'), M['yellow']))
# perimeter road
rd = [slab('road', -L / 2 - 200, L / 2 + 200, TX - 420, TX - 412, 0.04, M['road']), slab('road', -L / 2 - 200, L / 2 + 200, 160, 168, 0.04, M['road']),
      slab('road', -L / 2 - 208, -L / 2 - 200, TX - 420, 168, 0.04, M['road']), slab('road', L / 2 + 200, L / 2 + 208, TX - 420, 168, 0.04, M['road'])]
objs.append(put(join(rd, 'Ab_Roads'), M['road']))

# ---------------------------------------------------------------- hardened aircraft shelters (arched, earth-covered sides)
def shelter(xc, yc):
    rings = []; sp = 13.0; ln = 36.0
    for y in np.linspace(-ln / 2, ln / 2, 2):
        rings.append([(xc + sp * math.cos(a), yc + y, sp * math.sin(a) * 0.72) for a in np.linspace(0, math.pi, 20)])
    shell = loft('has', rings, closed=False, **K)
    md = shell.modifiers.new('s', 'SOLIDIFY'); md.thickness = 1.2
    with bpy.context.temp_override(object=shell): bpy.ops.object.modifier_apply(modifier='s')
    back = box('hb', (xc, yc - ln / 2 - 0.6, 4.6), (2 * sp, 1.2, 9.4), **K)
    door = box('hd', (xc, yc + ln / 2 + 0.4, 4.2), (2 * sp - 3, 0.6, 8.2), **K)
    blast = box('bw', (xc, yc - ln / 2 - 6, 2.5), (2 * sp + 6, 3, 5), **K)
    return [shell, back, blast], door
hs, ds = [], []
for k in range(6):
    s_, d_ = shelter(-1100 + k * 110, TX - 70 - 18 - 1); hs += s_; ds.append(d_)
objs.append(put(join(hs, 'Ab_Shelters'), M['has'])); objs.append(put(join(ds, 'Ab_ShelterDoors'), M['door']))

# ---------------------------------------------------------------- transport hangar, control tower, technical area
def gable(name, x, y, w, l, h, rh, wallm, roofm):
    walls = box(name + '_w', (x, y, h / 2), (l, w, h), **K)
    rings = [[(x + dx, y - w / 2 - 0.5, h), (x + dx, y, h + rh), (x + dx, y + w / 2 + 0.5, h)] for dx in (-l / 2 - 0.5, l / 2 + 0.5)]
    roof = loft(name + '_r', rings, closed=False, **K)
    md = roof.modifiers.new('s', 'SOLIDIFY'); md.thickness = 0.4
    with bpy.context.temp_override(object=roof): bpy.ops.object.modifier_apply(modifier='s')
    return put(walls, wallm), put(roof, roofm)
hw, hr = gable('hangar', 420, TX - 120, 70, 85, 18, 6, M['clad'], M['roof'])
door = box('hgdoor', (420, TX - 120 + 35.3, 8), (70, 0.5, 16), **K)
objs += [hw, hr, put(door, M['door'])]
# tower: shaft, cab with glazing, gallery, antennas
tx0, ty0 = 120.0, TX - 230
tw_ = [box('shaft', (tx0, ty0, 9), (6, 6, 18), **K), box('base', (tx0 + 8, ty0, 4), (14, 12, 8), **K), box('cabfloor', (tx0, ty0, 18.4), (10, 10, 0.8), **K),
       box('cabroof', (tx0, ty0, 22.6), (11, 11, 0.6), **K), box('gallery', (tx0, ty0, 18.1), (12, 12, 0.3), **K)]
objs.append(put(join(tw_, 'Ab_Tower'), M['white']))
objs.append(put(box('Ab_TowerGlass', (tx0, ty0, 20.5), (9.6, 9.6, 3.6), **K), M['glass']))
ant = [cylinder('ant', Vector((tx0 + 3, ty0 + 3, 22.9)), Vector((tx0 + 3, ty0 + 3, 30)), 0.08, n=6, **K), cylinder('ant', Vector((tx0 - 3, ty0 - 2, 22.9)), Vector((tx0 - 3, ty0 - 2, 27)), 0.06, n=6, **K)]
objs.append(put(join(ant, 'Ab_Antennas'), M['light']))
# barracks / technical buildings in rows
bw_, br_ = [], []
for k in range(10):
    x = -350 + (k % 5) * 70 + rng.uniform(-6, 6); y = TX - 260 - (k // 5) * 55
    w, r = gable(f'blk{k}', x, y, 18, 45 + rng.uniform(-8, 8), 6, 2.2, M['wall'], M['roof']); bw_.append(w); br_.append(r)
objs.append(put(join(bw_, 'Ab_Buildings'), M['wall'])); objs.append(put(join(br_, 'Ab_BuildingRoofs'), M['roof']))
# fuel farm: four tanks inside an earth berm
tk = []
for k in range(4):
    x = 760 + (k % 2) * 34; y = TX - 280 - (k // 2) * 34
    tk.append(cylinder('tank', Vector((x, y, 0)), Vector((x, y, 11)), 12, n=32, **K))
objs.append(put(join(tk, 'Ab_FuelTanks'), M['tank']))
berm = [box('b', (777, TX - 297, 1.2), (100, 4, 2.4), **K), box('b', (777, TX - 263 + 30, 1.2), (100, 4, 2.4), **K),
        box('b', (727, TX - 280, 1.2), (4, 70, 2.4), **K), box('b', (827, TX - 280, 1.2), (4, 70, 2.4), **K)]
objs.append(put(join(berm, 'Ab_Berm'), M['berm']))

# ---------------------------------------------------------------- lights: approach bars, PAPI, edge fixtures (geometry; lit at night by the sim)
lf = []
for end, s in ((-L / 2, -1), (L / 2, 1)):
    for k in range(1, 11):
        x = end + s * k * 30
        lf.append(box('apl', (x, 0, 1.2), (0.3, 14 if k % 3 == 0 else 4, 0.3), **K))
        lf.append(box('apls', (x, 0, 0.6), (0.2, 0.2, 1.2), **K))
for x in np.arange(-L / 2, L / 2 + 1, 60):
    for y in (-W / 2 - 1.5, W / 2 + 1.5): lf.append(box('edge', (x, y, 0.2), (0.3, 0.3, 0.4), **K))
for end, s in ((-L / 2, 1), (L / 2, -1)):
    for k in range(4):        # PAPI on the left of each runway, 300 m in
        lf.append(box('papi', (end + s * 300, (W / 2 + 15 + k * 9) * s, 0.5), (1.2, 2.0, 1.0), **K))
objs.append(put(join(lf, 'Ab_LightFixtures'), M['light']))
# windsock near the 10 end
objs.append(put(cylinder('Ab_WindsockPole', Vector((-L / 2 + 250, 70, 0)), Vector((-L / 2 + 250, 70, 6)), 0.08, n=8, **K), M['white']))
sock = loft('Ab_Windsock', [[(-L / 2 + 250 + 0.6 * math.cos(a), 70 + dx, 6 + 0.6 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 12)] if dx == 0 else
                             [(-L / 2 + 250 + 0.3 * math.cos(a), 70 + dx, 5.7 + 0.3 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 12)] for dx in (0, 3.5)], closed=True, **K)
objs.append(put(sock, M['sock']))

bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'airbase.gltf'), export_format='GLTF_SEPARATE', export_apply=True,
                          export_yup=True, export_cameras=False, export_lights=False, use_selection=False, export_extras=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'airbase.blend'))
print('airbase exported:', len(objs), 'objects', sum(len(o.data.polygons) for o in objs), 'faces')
