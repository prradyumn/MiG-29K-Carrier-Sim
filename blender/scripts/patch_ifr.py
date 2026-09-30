import sys; sys.path.insert(0,'/home/claude/mig')
import bpy, math, numpy as np
from mathutils import Vector
bpy.ops.wm.open_mainfile(filepath=sys.argv[1])
from lib import *
import build_airframe as A
old=bpy.data.objects.get('IFRFairing'); m=old.data.materials[0]; bpy.data.objects.remove(old)
rings=[]
for s in np.linspace(2.05, 3.85, 18):
    t=(s-2.05)/1.8
    r=0.075*(min(t/0.18,1)**0.5)*(1-max(t-0.85,0)/0.15*0.6)
    c0=Vector((-0.475+0.03*t, A.Y(s), 0.47-0.05*t))
    rings.append([tuple(c0+Vector((-math.cos(a)*r*0.55,0,math.sin(a)*r*1.15))) for a in np.linspace(-math.pi/2,math.pi/2,12)])
f=loft('IFRFairing', rings, closed=False, coll=A.coll('Details')); assign(f,m)
bpy.ops.wm.save_as_mainfile(filepath=sys.argv[1])
