"""Bake the Siachen terrain's large-scale maps in Blender (Cycles):
  ao.jpg     ambient occlusion over ~1.5 km (valleys, couloirs and cirques darken as the sky closes in)
  geo.jpg    geology tint: Karakoram rock colour by region and band (dark metamorphics, pale granites,
             rust-stained sediments), from large 3D noise over the real relief
Both cover the whole map (world x east, z south) with planar UVs, 2048 x ~3150 texels (~40 m).
Reads glacier/build/mesh_h.npy + meta.json (from dem.py). Also saves glacier/build/terrain.blend.
Run: python terrain_bake.py <out_dir>
"""
import sys, os, json, math, pathlib
import numpy as np
import bpy

ROOT = pathlib.Path(__file__).resolve().parents[2]
BUILD = ROOT / 'glacier' / 'build'
OUT = sys.argv[-1] if len(sys.argv) > 1 and not sys.argv[-1].endswith('.py') else str(ROOT / 'sim' / 'model' / 'glacier')
meta = json.load(open(BUILD / 'meta.json'))
h = np.load(BUILD / 'mesh_h.npy')                      # rows = z (north -> south), cols = x (west -> east)
step = meta['mesh_step'] * meta['cell']
R, C = h.shape
X0, Z0 = meta['x0'], meta['z0']
TW = 2048; TH = int(round(TW * R / C))

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'; prefs.get_devices()
    for d in prefs.devices: d.use = True
    sc.cycles.device = 'GPU'
except Exception as e:
    print('CPU bake', e)

# ---------------------------------------------------------------- mesh (Blender frame: x east, y north, z up)
xs = X0 + (np.arange(C) + 0.5) * step; zs = Z0 + (np.arange(R) + 0.5) * step
XX, ZZ = np.meshgrid(xs, zs)
verts = np.stack([XX.ravel(), -ZZ.ravel(), h.ravel()], 1)
ii = np.arange(R * C).reshape(R, C)
a, b, c, d = ii[:-1, :-1].ravel(), ii[:-1, 1:].ravel(), ii[1:, 1:].ravel(), ii[1:, :-1].ravel()
faces = np.stack([a, d, c, b], 1)                       # counter-clockwise seen from above (normals up)
me = bpy.data.meshes.new('terrain')
me.vertices.add(len(verts)); me.vertices.foreach_set('co', verts.astype(np.float32).ravel())
me.loops.add(faces.size); me.loops.foreach_set('vertex_index', faces.astype(np.int32).ravel())
me.polygons.add(len(faces)); me.polygons.foreach_set('loop_start', (np.arange(len(faces)) * 4).astype(np.int32)); me.polygons.foreach_set('loop_total', np.full(len(faces), 4, np.int32))
me.update(); me.validate()
uv = me.uv_layers.new(name='UVMap')
loop_v = faces.ravel()
u = (verts[loop_v, 0] - X0) / (C * step); v = 1 - (-verts[loop_v, 1] - Z0) / (R * step)
uv.data.foreach_set('uv', np.stack([u, v], 1).astype(np.float32).ravel())
for p in me.polygons: p.use_smooth = True
ob = bpy.data.objects.new('terrain', me); sc.collection.objects.link(ob)
bpy.context.view_layer.objects.active = ob; ob.select_set(True)
print('terrain mesh', len(verts), 'verts')

# ---------------------------------------------------------------- material: geology tint (emission) and AO
m = bpy.data.materials.new('terrain'); m.use_nodes = True; nt = m.node_tree; N = nt.nodes; L = nt.links; N.clear()
geo = N.new('ShaderNodeNewGeometry')
mapn = N.new('ShaderNodeMapping'); mapn.inputs['Scale'].default_value = (1 / 9000, 1 / 9000, 1 / 2600); L.new(geo.outputs['Position'], mapn.inputs['Vector'])
n1 = N.new('ShaderNodeTexNoise'); n1.inputs['Scale'].default_value = 1.0; n1.inputs['Detail'].default_value = 6; n1.inputs['Distortion'].default_value = 0.6
L.new(mapn.outputs[0], n1.inputs['Vector'])
# bands: strata dipping through the relief (height plus a tilt), wobbling with the noise
sep = N.new('ShaderNodeSeparateXYZ'); L.new(geo.outputs['Position'], sep.inputs[0])
band = N.new('ShaderNodeMath'); band.operation = 'MULTIPLY_ADD'; L.new(sep.outputs[2], band.inputs[0]); band.inputs[1].default_value = 1 / 380.0
tilt = N.new('ShaderNodeMath'); tilt.operation = 'MULTIPLY'; L.new(sep.outputs[0], tilt.inputs[0]); tilt.inputs[1].default_value = 1 / 2600.0
L.new(tilt.outputs[0], band.inputs[2])
wob = N.new('ShaderNodeMath'); wob.operation = 'MULTIPLY_ADD'; L.new(n1.outputs['Fac'], wob.inputs[0]); wob.inputs[1].default_value = 3.0; L.new(band.outputs[0], wob.inputs[2])
sn = N.new('ShaderNodeMath'); sn.operation = 'SINE'; L.new(wob.outputs[0], sn.inputs[0])
mix = N.new('ShaderNodeMath'); mix.operation = 'MULTIPLY_ADD'; L.new(sn.outputs[0], mix.inputs[0]); mix.inputs[1].default_value = 0.18; L.new(n1.outputs['Fac'], mix.inputs[2])
ramp = N.new('ShaderNodeValToRGB'); L.new(mix.outputs[0], ramp.inputs['Fac']); e = ramp.color_ramp.elements
while len(e) < 5: e.new(0.5)
for el, (p, col) in zip(e, [(0.28, (0.16, 0.15, 0.15)), (0.42, (0.30, 0.27, 0.24)), (0.55, (0.44, 0.40, 0.35)), (0.68, (0.38, 0.27, 0.19)), (0.82, (0.52, 0.48, 0.42))]):
    el.position = p; el.color = (*col, 1)
emit = N.new('ShaderNodeEmission'); L.new(ramp.outputs['Color'], emit.inputs['Color'])
out = N.new('ShaderNodeOutputMaterial'); L.new(emit.outputs[0], out.inputs['Surface'])
diff = N.new('ShaderNodeBsdfDiffuse')
me.materials.append(m)

def bake(name, kind, cs):
    img = bpy.data.images.new(name, TW, TH, float_buffer=False); img.colorspace_settings.name = cs
    t = N.new('ShaderNodeTexImage'); t.image = img; N.active = t
    if kind == 'AO':
        L.new(diff.outputs[0], out.inputs['Surface'])
        sc.world = sc.world or bpy.data.worlds.new('w'); sc.world.light_settings.distance = 1500.0
        sc.cycles.samples = 64
        bpy.ops.object.bake(type='AO', margin=4)
    else:
        L.new(emit.outputs[0], out.inputs['Surface']); sc.cycles.samples = 4
        bpy.ops.object.bake(type='EMIT', margin=4)
    img.filepath_raw = os.path.join(OUT, f'{name}.jpg'); img.file_format = 'JPEG'
    sc.render.image_settings.quality = 90; img.save_render(img.filepath_raw)
    N.remove(t); print('baked', name, TW, 'x', TH)

bake('geo', 'EMIT', 'sRGB')
bake('ao', 'AO', 'Non-Color')
bpy.ops.wm.save_as_mainfile(filepath=str(BUILD / 'terrain.blend'))
