import sys, math; sys.path.insert(0,'/home/claude/mig')
import bpy
from scene import *
a=sys.argv[sys.argv.index('--')+1:]
bpy.ops.wm.open_mainfile(filepath=a[0]); tag=a[1]; views=a[2].split(',')
setup_render((1400,800),int(a[3]) if len(a)>3 else 32)
sc=bpy.context.scene; sc.view_settings.exposure=-0.2
for o in list(bpy.data.objects):
    if o.type in('LIGHT','CAMERA'): bpy.data.objects.remove(o)
sky(sun_el=40, sun_rot=150, strength=0.35)
import build_airframe as A
V={'pov':((0,A.Y(4.50),1.17),(0,A.Y(2.0),0.62),24),'pov_wide':((0,A.Y(4.55),1.18),(0,A.Y(2.5),0.70),16),
   'over':((-1.3,A.Y(5.6),2.3),(0,A.Y(4.2),0.8),30),'left':((0.05,A.Y(4.55),1.15),(-0.4,A.Y(4.3),0.5),20),
   'right':((-0.05,A.Y(4.55),1.15),(0.4,A.Y(4.3),0.5),20), 'ext':((-4.5,A.Y(1.5),2.4),(0,A.Y(4.4),0.9),35)}
for k in views:
    pil=bpy.data.objects.get('Pilot')
    hide = k in ('pov','pov_wide','left','right')
    for o in bpy.data.objects:
        if o.name.startswith('Pilot'): o.hide_render=hide
    l,t,lens=V[k]; camera(l,t,lens=lens)
    render(f'/home/claude/mig/out/{tag}_{k}.png')
