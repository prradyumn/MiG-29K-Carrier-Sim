import sys; sys.path.insert(0,'/home/claude/mig')
import bpy
from scene import *
bpy.ops.wm.open_mainfile(filepath=sys.argv[-1])
setup_render((900,700),12); bpy.context.scene.view_settings.exposure=-1.0
sky(sun_el=60, sun_rot=-30, strength=0.3)
cam=camera((0,-3.5,12),(0,-3.5,0),lens=35); cam.data.type='ORTHO'; cam.data.ortho_scale=6
render('/home/claude/mig/out/cu2.png')
