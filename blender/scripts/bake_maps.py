"""UV-unwrap skin groups into shared atlases and bake world-space position / normal / object-id maps.
Usage: python3 bake_maps.py in.blend out.blend RES"""
import sys, time, json
sys.path.insert(0, '/home/claude/mig')
import bpy, bmesh
import numpy as np

src, dst, RES = sys.argv[1], sys.argv[2], int(sys.argv[3])
bpy.ops.wm.open_mainfile(filepath=src)
if bpy.context.scene.world is None:
    bpy.context.scene.world = bpy.data.worlds.new('W')

GROUPS = {
    'SkinA': lambda n: n.split('.')[0] in ('Fuselage', 'BodyLERX', 'Nacelle_R', 'Nacelle_L', 'Boom_R', 'Boom_L', 'Airbrake'),
    'SkinB': lambda n: any(n.startswith(p) for p in ('WingRoot', 'WingInner', 'WingOuter', 'Slat', 'Flap', 'Aileron',
                                                      'Stabilator', 'Fin_', 'Rudder', 'Pylons')),
}


def objs_of(g):
    return [o for o in bpy.data.objects if o.type == 'MESH' and GROUPS[g](o.name)]


def unwrap(objs, margin=0.004):
    vl = bpy.context.view_layer
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
        if not o.data.uv_layers:
            o.data.uv_layers.new(name='UVMap')
    vl.objects.active = objs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=margin, area_weight=0.0, correct_aspect=True,
                             scale_to_bounds=False)
    # pack tighter
    try:
        bpy.ops.uv.pack_islands(udim_source='CLOSEST_UDIM', rotate=True, margin_method='FRACTION', margin=margin, shape_method='CONCAVE')
    except Exception as e:
        print('pack fallback', e)
        bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')


def bake_pass(objs, img, kind, ids):
    """kind: 'pos' | 'nrm' | 'id'"""
    orig = {o.name: [m for m in o.data.materials] for o in objs}
    tmp = []
    for i, o in enumerate(objs):
        m = bpy.data.materials.new('bake_%s_%d' % (kind, i))
        m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        em = nt.nodes.new('ShaderNodeEmission')
        nt.links.new(em.outputs[0], out.inputs[0])
        if kind == 'ao':
            bs = nt.nodes.new('ShaderNodeBsdfPrincipled')
            nt.links.new(bs.outputs[0], out.inputs[0])
        elif kind in ('pos', 'nrm'):
            geo = nt.nodes.new('ShaderNodeNewGeometry')
            nt.links.new(geo.outputs['Position' if kind == 'pos' else 'Normal'], em.inputs[0])
        else:
            em.inputs[0].default_value = (ids[o.name] / 255.0, 0, 0, 1)
        tn = nt.nodes.new('ShaderNodeTexImage')
        tn.image = img
        nt.nodes.active = tn
        o.data.materials.clear()
        o.data.materials.append(m)
        tmp.append(m)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 1
    sc.cycles.use_denoising = False
    sc.render.bake.margin = 6
    sc.render.bake.margin_type = 'EXTEND'
    sc.render.bake.use_clear = True
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    t = time.time()
    if kind == 'ao':
        sc.cycles.samples = 48
        hidden = []
        for o in bpy.data.objects:
            cn = [c.name for c in o.users_collection]
            if not any(c in ('Airframe', 'Engines') for c in cn) and not GROUPS['SkinB'](o.name) and o not in objs:
                if not o.hide_render:
                    o.hide_render = True
                    hidden.append(o)
        bpy.context.scene.world.light_settings.distance = 1.5
        bpy.ops.object.bake(type='AO', margin=6, use_clear=True)
        for o in hidden:
            o.hide_render = False
    else:
        bpy.ops.object.bake(type='EMIT', margin=6, use_clear=True)
    print('bake', kind, img.name, '%.1fs' % (time.time() - t))
    for o in objs:
        o.data.materials.clear()
        for m in orig[o.name]:
            o.data.materials.append(m)
    for m in tmp:
        bpy.data.materials.remove(m)


meta = {}
for g in GROUPS:
    objs = objs_of(g)
    print(g, len(objs), [o.name for o in objs])
    # make sure every object has single user mesh & identity-free transforms are fine (bake uses world coords)
    unwrap(objs)
    ids = {o.name: i + 1 for i, o in enumerate(objs)}
    meta[g] = ids
    for kind in ('pos', 'nrm', 'id', 'ao'):
        R = RES if kind != 'ao' else RES // 2
        img = bpy.data.images.new('%s_%s' % (g, kind), R, R, alpha=True, float_buffer=True)
        bake_pass(objs, img, kind, ids)
        arr = np.empty(R * R * 4, dtype=np.float32)
        img.pixels.foreach_get(arr)
        np.save('/home/claude/mig/out/%s_%s.npy' % (g, kind), arr.reshape(R, R, 4)[:, :, :3 if kind != 'id' else 4].astype(np.float32))
        bpy.data.images.remove(img)

json.dump(meta, open('/home/claude/mig/out/bake_meta.json', 'w'))
bpy.ops.wm.save_as_mainfile(filepath=dst)
