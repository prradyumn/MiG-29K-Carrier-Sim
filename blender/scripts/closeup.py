import sys; sys.path.insert(0,'/home/claude/mig')
import bpy
from scene import *
bpy.ops.wm.open_mainfile(filepath=sys.argv[-1])
setup_render((900,520),12); bpy.context.scene.view_settings.exposure=-1.0
sky(sun_el=50, sun_rot=-30, strength=0.3)
cam=camera((-3.5,-3.0,3.2),(-1.0,-4.0,0.3),lens=35)
render('/home/claude/mig/out/cu1.png')
