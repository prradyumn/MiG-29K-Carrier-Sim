import sys; sys.path.insert(0,'/home/claude/mig')
import bpy, math
from scene import *
blend=sys.argv[sys.argv.index('--')+1]; tag=sys.argv[sys.argv.index('--')+2]
views=sys.argv[sys.argv.index('--')+3].split(',')
bpy.ops.wm.open_mainfile(filepath=blend)
setup_render((1000,580),20)
bpy.context.scene.view_settings.exposure=-0.8
for o in list(bpy.data.objects):
    if o.type in('LIGHT','CAMERA') or o.name=='Ground': bpy.data.objects.remove(o)
sky(sun_el=38, sun_rot=-30, strength=0.35); ground()
V={'34':((-13,17,3.0),(0,1.5,0),40,None),'side':((-40,0,0.3),(0,0,0.3),None,18.5),'top':((0,0,45),(0,0.001,0),None,18.5),
   'front':((0,40,0.3),(0,0,0.3),None,14),'rear34':((11,-15,4.5),(0,-2,0),40,None),'low34':((9,10,-1.2),(0,1,0),35,None),
   'nose':((-3.5,11,1.8),(0,5,0.6),35,None), 'tail':((-5,-12,2.5),(0,-5,0),35,None), 'gear':((-5,6,-1.0),(0,0.5,-0.9),30,None)}
for k in views:
    l,t,lens,orth=V[k]
    cam=camera(l,t,lens=lens or 50)
    if orth: cam.data.type='ORTHO'; cam.data.ortho_scale=orth
    render(f'/home/claude/mig/out/{tag}_{k}.png')
