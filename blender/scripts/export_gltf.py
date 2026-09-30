import sys; sys.path.insert(0,'/home/claude/mig')
import bpy, os
src, dst = sys.argv[1], sys.argv[2]
bpy.ops.wm.open_mainfile(filepath=src)
for o in list(bpy.data.objects):
    if o.type in ('LIGHT','CAMERA') or o.name in ('Ground','Deck','Ocean'): bpy.data.objects.remove(o)
os.makedirs(os.path.dirname(dst), exist_ok=True)
kw = dict(filepath=dst, export_format='GLTF_SEPARATE', export_texture_dir='tex', export_image_format='JPEG',
          export_tangents=True, export_apply=True, export_cameras=False, export_lights=False, export_yup=True)
try:
    bpy.ops.export_scene.gltf(export_image_quality=88, **kw)
except TypeError:
    bpy.ops.export_scene.gltf(**kw)
print('exported')
