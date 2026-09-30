"""Create PBR skin materials from painted atlases and assign them. Usage: python3 apply_tex.py in.blend out.blend"""
import sys
sys.path.insert(0, '/home/claude/mig')
import bpy

src, dst = sys.argv[1], sys.argv[2]
bpy.ops.wm.open_mainfile(filepath=src)
OUT = '/home/claude/mig/out/'
GROUPS = {
    'SkinA': lambda n: n.split('.')[0] in ('Fuselage', 'BodyLERX', 'Nacelle_R', 'Nacelle_L', 'Boom_R', 'Boom_L', 'Airbrake'),
    'SkinB': lambda n: any(n.startswith(p) for p in ('WingRoot', 'WingInner', 'WingOuter', 'Slat', 'Flap', 'Aileron',
                                                      'Stabilator', 'Fin_', 'Rudder', 'Pylons')),
}


def img(path, noncolor):
    im = bpy.data.images.load(path, check_existing=True)
    if noncolor:
        im.colorspace_settings.name = 'Non-Color'
    return im


def skin_material(g):
    m = bpy.data.materials.get(g) or bpy.data.materials.new(g)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); out.location = (600, 0)
    bs = nt.nodes.new('ShaderNodeBsdfPrincipled'); bs.location = (300, 0)
    nt.links.new(bs.outputs[0], out.inputs[0])
    tb = nt.nodes.new('ShaderNodeTexImage'); tb.image = img(OUT + 'tex_%s_base.jpg' % g, False); tb.location = (-400, 300)
    to = nt.nodes.new('ShaderNodeTexImage'); to.image = img(OUT + 'tex_%s_orm.jpg' % g, True); to.location = (-400, 0)
    tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = img(OUT + 'tex_%s_normal.png' % g, True); tn.location = (-400, -300)
    sep = nt.nodes.new('ShaderNodeSeparateColor'); sep.location = (-100, 0)
    nm = nt.nodes.new('ShaderNodeNormalMap'); nm.location = (-100, -300); nm.inputs['Strength'].default_value = 1.0
    nt.links.new(tb.outputs['Color'], bs.inputs['Base Color'])
    nt.links.new(to.outputs['Color'], sep.inputs[0])
    nt.links.new(sep.outputs['Green'], bs.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], bs.inputs['Metallic'])
    nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bs.inputs['Normal'])
    # glTF occlusion hookup (read by the glTF exporter)
    grp = bpy.data.node_groups.get('glTF Material Output')
    if grp is None:
        grp = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
        grp.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    gn = nt.nodes.new('ShaderNodeGroup'); gn.node_tree = grp; gn.location = (300, -400)
    nt.links.new(sep.outputs['Red'], gn.inputs['Occlusion'])
    bs.inputs['Specular IOR Level'].default_value = 0.5
    return m


for g, f in GROUPS.items():
    m = skin_material(g)
    for o in bpy.data.objects:
        if o.type == 'MESH' and f(o.name):
            o.data.materials.clear()
            o.data.materials.append(m)
# misc painted parts pick up the average skin colour
for n in ('AirframeMisc', 'Pylon'):
    mm = bpy.data.materials.get(n)
    if mm:
        mm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.262, 0.292, 0.318, 1)
bpy.ops.wm.save_as_mainfile(filepath=dst)
