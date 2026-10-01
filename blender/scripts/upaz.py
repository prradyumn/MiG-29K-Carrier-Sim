"""Buddy refuelling pod (UPAZ / PAZ-MK style) and drogue basket for the tanker MiG-29K.
Objects (origins chosen for the sim):
  UPAZ_Pod    pod body + pylon, origin on the pylon attach point (top centre)
  UPAZ_RAT    ram-air turbine propeller, origin on its hub (spins about the pod axis)
  Drogue      coupling + ribs + canopy, origin at the coupling nose where the hose attaches; trails towards -Y (aft)
Run: python upaz.py <out_dir>
"""
import sys, os, math
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpy
from mathutils import Vector, Matrix
from lib import *

OUT = sys.argv[-1] if len(sys.argv) > 1 and not sys.argv[-1].endswith('.py') else os.path.join(HERE, 'out')
bpy.ops.wm.read_factory_settings(use_empty=True)
C = bpy.data.collections.new('Pod'); bpy.context.scene.collection.children.link(C)
kw = dict(coll=C)

grey = mat('PodGrey', (0.30, 0.33, 0.36), 0.5)
dark = mat('PodDark', (0.06, 0.065, 0.07), 0.45, 0.4)
metal = mat('PodMetal', (0.62, 0.63, 0.64), 0.3, 0.9)
white = mat('PodWhite', (0.80, 0.80, 0.78), 0.55)
red = mat('PodRed', (0.60, 0.06, 0.04), 0.5)
fabric = mat('DrogueFabric', (0.85, 0.84, 0.80), 0.85)
yellow = mat('DrogueYellow', (0.85, 0.65, 0.05), 0.5)


def bake(o):
    o.data.transform(o.matrix_world); o.matrix_world = Matrix.Identity(4); return o


L, R = 4.6, 0.27
# pod body along Y (forward +Y): ogive nose, straight barrel, boat-tail with the drogue tunnel
prof = []
for t in [i / 40 for i in range(41)]:
    y = L * t
    if t < 0.16:   r = R * math.sqrt(t / 0.16) * (1 - 0.15 * (1 - t / 0.16) ** 2)
    elif t < 0.8:  r = R
    else:          r = R * (1 - 0.55 * ((t - 0.8) / 0.2) ** 1.3)
    prof.append((y, max(r, 0.01)))
# lathe profile (t along axis from the TAIL towards the nose)
body = lathe('body', [(L - y, r) for (y, r) in reversed(prof)], (0, -L / 2 - 0.0, 0), (0, 1, 0), n=40, cap0=False, cap1=True, **kw)
# the axis runs from tail (y=-L/2) to nose (y=+L/2)
assign(body, grey)
tunnel = cylinder('tunnel', (0, -L / 2 - 0.01, 0), (0, -L / 2 + 0.55, 0), 0.115, n=28, **kw); assign(tunnel, dark)
band = cylinder('band', (0, L / 2 - 1.10, 0), (0, L / 2 - 1.18, 0), R + 0.004, n=40, **kw); assign(band, red)
band2 = cylinder('band2', (0, -L / 2 + 0.95, 0), (0, -L / 2 + 1.03, 0), R + 0.004, n=40, **kw); assign(band2, red)
# pylon on top
py = box('pylon', (0, 0.25, R + 0.10), (0.10, 1.9, 0.22), bevel=0.02, **kw); assign(py, grey)
# fairing lights (tanker signal lights: red / amber / green) on the aft body
lights = []
for k, col in enumerate(((0.9, 0.1, 0.05), (1.0, 0.65, 0.1), (0.1, 0.9, 0.3))):
    m = mat('PodLight%d' % k, col, 0.2, emit=col, emit_strength=0.0)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.035, location=(0.20, -L / 2 + 0.7 + k * 0.12, 0.13), segments=12, ring_count=8)
    s = bpy.context.active_object
    for c in s.users_collection: c.objects.unlink(s)
    C.objects.link(s); assign(s, m); s.name = 'PodLight%d' % k; lights.append(s)
pod = join([body, tunnel, band, band2, py], 'UPAZ_Pod')
set_origin(pod, (0, 0.25, R + 0.21))
for s in lights:
    s.parent = pod; s.matrix_parent_inverse = pod.matrix_world.inverted()
# ram-air turbine on the nose
hub = lathe('hub', [(0, 0.075), (0.10, 0.07), (0.18, 0.03), (0.21, 0.0)], (0, L / 2 - 0.02, 0), (0, 1, 0), n=20, **kw); assign(hub, dark)
blades = []
for k in range(3):
    a = 2 * math.pi * k / 3
    b = box('blade', (0, 0, 0), (0.05, 0.012, 0.30), **kw)
    b.location = (math.sin(a) * 0.18, L / 2 + 0.06, math.cos(a) * 0.18); b.rotation_euler = (0.35, a, 0)
    assign(b, dark); blades.append(b)
rat = join([hub] + blades, 'UPAZ_RAT'); assign(rat, dark)
set_origin(rat, (0, L / 2 + 0.06, 0))
rat.parent = pod; rat.matrix_parent_inverse = pod.matrix_world.inverted()

# ---------------- drogue basket: coupling at the origin, trailing aft (-Y)
parts = []
cp = lathe('coupling', [(0, 0.05), (0.06, 0.075), (0.28, 0.085), (0.34, 0.07)], (0, 0, 0), (0, -1, 0), n=24, **kw); assign(cp, metal); parts.append(cp)
throat = cylinder('throat', (0, -0.34, 0), (0, -0.40, 0), 0.10, n=24, **kw); assign(throat, dark); parts.append(throat)
ribs = []
N = 16
for k in range(N):
    a = 2 * math.pi * k / N
    p0 = Vector((math.cos(a) * 0.10, -0.38, math.sin(a) * 0.10))
    p1 = Vector((math.cos(a) * 0.36, -0.95, math.sin(a) * 0.36))
    ribs.append(tube_along('rib', [p0, (p0 + p1) / 2 + Vector((math.cos(a), 0, math.sin(a))) * 0.02, p1], 0.008, n=6, **kw))
rib = join(ribs, 'ribs'); assign(rib, metal); parts.append(rib)
# canopy fabric between the ribs (slightly scalloped cone), and the outer ring with yellow reflective band
rings = []
for j, (y, r) in enumerate(((-0.62, 0.22), (-0.80, 0.31), (-0.97, 0.37))):
    rings.append([(math.cos(2 * math.pi * k / (N * 2)) * r * (0.97 if k % 2 else 1.0), y, math.sin(2 * math.pi * k / (N * 2)) * r * (0.97 if k % 2 else 1.0)) for k in range(N * 2)])
can = loft('canopy', rings, closed=True, **kw); assign(can, fabric); parts.append(can)
ring = tube_along('ring', [(math.cos(2 * math.pi * k / 48) * 0.37, -0.97, math.sin(2 * math.pi * k / 48) * 0.37) for k in range(49)], 0.022, n=8, cap=False, **kw)
assign(ring, yellow); parts.append(ring)
drogue = join(parts, 'Drogue')
set_origin(drogue, (0, 0, 0))
for o in C.objects:
    if o.type == 'MESH':
        for p in o.data.polygons: p.use_smooth = True

os.makedirs(OUT, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'upaz.gltf'), export_format='GLTF_SEPARATE', export_extras=True, export_apply=True, export_yup=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'upaz.blend'))
print('upaz exported', [o.name for o in C.objects])
