"""Replace placeholder cockpit with detailed cockpit. python3 add_cockpit.py in.blend out.blend"""
import sys; sys.path.insert(0,'/home/claude/mig')
import bpy
src,dst=sys.argv[1],sys.argv[2]
bpy.ops.wm.open_mainfile(filepath=src)
import build_airframe as A
c=bpy.data.collections.get('Cockpit')
if c:
    for o in list(c.objects): bpy.data.objects.remove(o)
    A.COL['Cockpit']=c
import cockpit as CK
M=CK.materials()
out=CK.build(M)
bpy.ops.wm.save_as_mainfile(filepath=dst)
print('cockpit objects', len(A.coll('Cockpit').objects))
