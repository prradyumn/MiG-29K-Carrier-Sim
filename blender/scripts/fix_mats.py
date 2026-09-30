import sys; import bpy
bpy.ops.wm.open_mainfile(filepath=sys.argv[1])
m=bpy.data.materials.get('CanopyFrame'); b=m.node_tree.nodes['Principled BSDF']
b.inputs['Base Color'].default_value=(0.03,0.032,0.035,1); b.inputs['Roughness'].default_value=0.75
bpy.ops.wm.save_as_mainfile(filepath=sys.argv[1])
