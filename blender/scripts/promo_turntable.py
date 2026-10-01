"""Promo film: studio turntable of the MiG-29K in Cycles (Metal GPU), beauty and glowing-wireframe passes.
usage: python promo_turntable.py <out_dir> <pass: beauty|wire> <first> <last> [samples]
Frames are numbered 0..N-1 over a 60-frame-per-second sweep (N = 300, 5 s)."""
import sys, os, math
import bpy
from mathutils import Vector
OUT, PASS, F0, F1 = sys.argv[-5], sys.argv[-4], int(sys.argv[-3]), int(sys.argv[-2])
SAMPLES = int(sys.argv[-1])
N = 300
bpy.ops.wm.open_mainfile(filepath=os.path.join(os.path.dirname(__file__), '..', 'mig29k_indian_navy.blend'))
sc = bpy.context.scene
for o in list(bpy.data.objects):
    if o.name.startswith(('Pilot', 'R77_', 'R73_', 'Pylons_')): o.hide_render = True
sc.render.engine = 'CYCLES'
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'METAL'; prefs.get_devices()
for d in prefs.devices: d.use = d.type == 'METAL'
sc.cycles.device = 'GPU'
sc.cycles.samples = SAMPLES; sc.cycles.use_denoising = True
try: sc.cycles.denoiser = 'OPENIMAGEDENOISE'
except Exception: pass
sc.cycles.max_bounces = 6
sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
sc.render.image_settings.file_format = 'JPEG'; sc.render.image_settings.quality = 94
sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Punchy'

# ---------------- world: near-black navy
w = bpy.data.worlds.new('Studio'); sc.world = w; w.use_nodes = True
bg = w.node_tree.nodes['Background']; bg.inputs[0].default_value = (0.004, 0.006, 0.012, 1); bg.inputs[1].default_value = 1.0

def area(name, loc, rot, size, energy, color):
    L = bpy.data.lights.new(name, 'AREA'); L.shape = 'RECTANGLE'; L.size, L.size_y = size
    L.energy = energy; L.color = color
    o = bpy.data.objects.new(name, L); sc.collection.objects.link(o); o.location = loc
    o.rotation_euler = (Vector((0, 1.4, 0.2)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler() if rot is None else rot
    return o

C = Vector((0, 1.4, 0.25))   # aircraft centre (Blender: +Y forward)
if PASS == 'beauty':
    # glossy black floor for reflections
    bpy.ops.mesh.primitive_plane_add(size=300, location=(0, 0, -1.74))
    fl = bpy.context.active_object; m = bpy.data.materials.new('Floor'); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = (0.008, 0.009, 0.011, 1); b.inputs['Roughness'].default_value = 0.18
    fl.data.materials.append(m)
    area('Key', (-9, 12, 9), None, (7, 4), 2600, (1.0, 0.86, 0.72))
    area('RimCyan', (10, -12, 3.5), None, (14, 2), 5200, (0.35, 0.7, 1.0))
    area('RimOrange', (-11, -10, 2.5), None, (14, 2), 4200, (1.0, 0.45, 0.12))
    area('Top', (0, 2, 14), None, (10, 10), 900, (0.8, 0.88, 1.0))
    area('Kicker', (7, 14, 0.2), None, (6, 1.2), 1400, (1.0, 0.7, 0.45))
else:
    # glowing wireframe: every mesh becomes an emissive lattice on black
    em = bpy.data.materials.new('Wire'); em.use_nodes = True; nt = em.node_tree; nt.nodes.clear()
    e = nt.nodes.new('ShaderNodeEmission'); e.inputs[0].default_value = (0.25, 0.75, 1.0, 1); e.inputs[1].default_value = 1.4
    o_ = nt.nodes.new('ShaderNodeOutputMaterial'); nt.links.new(e.outputs[0], o_.inputs[0])
    for o in bpy.data.objects:
        if o.type != 'MESH' or o.hide_render: continue
        md = o.modifiers.new('wire', 'WIREFRAME'); md.thickness = 0.006; md.use_replace = True; md.use_relative_offset = False
        o.data.materials.clear(); o.data.materials.append(em)
    sc.view_settings.look = 'None'
    bg.inputs[0].default_value = (0, 0, 0, 1)

cd = bpy.data.cameras.new('Cam'); cd.lens = 42; cd.clip_start = 0.1; cd.dof.use_dof = PASS == 'beauty'; cd.dof.aperture_fstop = 5.6
cam = bpy.data.objects.new('Cam', cd); sc.collection.objects.link(cam); sc.camera = cam
os.makedirs(OUT, exist_ok=True)
for f in range(F0, F1 + 1):
    t = f / (N - 1); e_ = t * t * (3 - 2 * t)
    az = math.radians(-38 + 58 * e_)                 # sweeps from the front-left three-quarter round to front-right
    R = 18.5 - 2.5 * e_; h = 0.35 + 1.1 * (1 - e_)
    pos = C + Vector((math.sin(az) * R, math.cos(az) * R, h))
    cam.location = pos
    cam.rotation_euler = (C + Vector((0, -0.6, 0.1)) - pos).to_track_quat('-Z', 'Y').to_euler()
    cd.dof.focus_distance = (C - pos).length
    sc.render.filepath = os.path.join(OUT, f'{f:05d}.jpg')
    bpy.ops.render.render(write_still=True)
print('done', PASS, F0, F1)
