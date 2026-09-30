import sys, time; sys.path.insert(0,'.')
import bpy
from scene import *
reset()
import build_airframe as B
t=time.time()
o=B.build_all()
print('built', time.time()-t)
clay=bpy.data.materials.new('clay'); clay.use_nodes=True
bb=clay.node_tree.nodes['Principled BSDF']; bb.inputs['Base Color'].default_value=(0.45,0.47,0.5,1); bb.inputs['Roughness'].default_value=0.5
glass=bpy.data.materials.new('glass'); glass.use_nodes=True
g=glass.node_tree.nodes['Principled BSDF']; g.inputs['Transmission Weight'].default_value=1; g.inputs['Roughness'].default_value=0.02
for ob in bpy.data.objects:
    if ob.type=='MESH':
        ob.data.materials.append(glass if ob.name in ('Canopy','Windscreen') else clay)
setup_render((1200,700),24); sky(); ground()
views={'34':((14,16,6),(0,1,0)),'side':((-30,0,0.5),(0,0,0.5)),'top':((0,0.5,40),(0,0.5,0)),'front':((0,30,0.5),(0,0,0.3)), 'rear34':((-12,-16,4),(0,-2,0))}
for k,(l,t_) in views.items():
    cam=camera(l,t_,lens=50 if k not in('side','top','front') else 60)
    if k in ('side','top','front'):
        cam.data.type='ORTHO'; cam.data.ortho_scale=19 if k!='front' else 14
    render(f'/home/claude/mig/out/t1_{k}.png')
print('done', time.time()-t)
bpy.ops.wm.save_as_mainfile(filepath='/home/claude/mig/out/t1.blend')
