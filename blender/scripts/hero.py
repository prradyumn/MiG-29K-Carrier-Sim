"""Hero renders on a carrier-deck style set. python3 hero.py -- blend tag views [res] [samples]"""
import sys, math
sys.path.insert(0, '/home/claude/mig')
import bpy
from mathutils import Vector
from scene import setup_render, camera, render

a = sys.argv[sys.argv.index('--') + 1:]
blend, tag, views = a[0], a[1], a[2].split(',')
res = tuple(int(v) for v in a[3].split('x')) if len(a) > 3 else (1600, 900)
spp = int(a[4]) if len(a) > 4 else 64
bpy.ops.wm.open_mainfile(filepath=blend)
for o in list(bpy.data.objects):
    if o.type in ('LIGHT', 'CAMERA') or o.name in ('Ground', 'Deck', 'Ocean'):
        bpy.data.objects.remove(o)
setup_render(res, spp)
sc = bpy.context.scene
sc.view_settings.exposure = -0.3

# sky + sun
w = bpy.data.worlds.new('Sky'); sc.world = w; w.use_nodes = True
nt = w.node_tree; nt.nodes.clear()
sk = nt.nodes.new('ShaderNodeTexSky'); sk.sky_type = 'NISHITA'
SUN_EL, SUN_ROT = 28, 35
sk.sun_elevation = math.radians(SUN_EL); sk.sun_rotation = math.radians(SUN_ROT)
sk.sun_disc = False; sk.altitude = 30; sk.air_density = 1.2; sk.dust_density = 2.5
bg = nt.nodes.new('ShaderNodeBackground'); bg.inputs[1].default_value = 0.30
out = nt.nodes.new('ShaderNodeOutputWorld')
nt.links.new(sk.outputs[0], bg.inputs[0]); nt.links.new(bg.outputs[0], out.inputs[0])
sd = bpy.data.lights.new('Sun', 'SUN'); sd.energy = 4.2; sd.angle = math.radians(0.8); sd.color = (1.0, 0.96, 0.9)
so = bpy.data.objects.new('Sun', sd); sc.collection.objects.link(so)
# Blender sun points along its -Z; aim it from the sky direction
az = math.radians(SUN_ROT)
d = Vector((math.sin(az) * math.cos(math.radians(SUN_EL)), math.cos(az) * math.cos(math.radians(SUN_EL)), math.sin(math.radians(SUN_EL))))
so.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()

# deck
GZ = -1.74
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, GZ))
deck = bpy.context.active_object; deck.name = 'Deck'; deck.scale = (60, 260, 1)
m = bpy.data.materials.new('DeckMat'); m.use_nodes = True
t = m.node_tree; b = t.nodes['Principled BSDF']
tc = t.nodes.new('ShaderNodeTexCoord')
n1 = t.nodes.new('ShaderNodeTexNoise'); n1.inputs['Scale'].default_value = 0.35; n1.inputs['Detail'].default_value = 8
n2 = t.nodes.new('ShaderNodeTexNoise'); n2.inputs['Scale'].default_value = 4000; n2.inputs['Detail'].default_value = 1
t.links.new(tc.outputs['Object'], n1.inputs['Vector']); t.links.new(tc.outputs['Object'], n2.inputs['Vector'])
ramp = t.nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].color = (0.035, 0.037, 0.04, 1); ramp.color_ramp.elements[1].color = (0.075, 0.075, 0.078, 1)
t.links.new(n1.outputs['Fac'], ramp.inputs[0])
# painted lines: centre line (yellow dashed) and landing area edge lines (white)
sep = t.nodes.new('ShaderNodeSeparateXYZ'); t.links.new(tc.outputs['Object'], sep.inputs[0])
def band(center, width, axis_out='X'):
    sub = t.nodes.new('ShaderNodeMath'); sub.operation = 'SUBTRACT'; sub.inputs[1].default_value = center
    t.links.new(sep.outputs[axis_out], sub.inputs[0])
    ab = t.nodes.new('ShaderNodeMath'); ab.operation = 'ABSOLUTE'; t.links.new(sub.outputs[0], ab.inputs[0])
    lt = t.nodes.new('ShaderNodeMath'); lt.operation = 'LESS_THAN'; lt.inputs[1].default_value = width
    t.links.new(ab.outputs[0], lt.inputs[0])
    return lt
yl = band(8.0 / 60, 0.075 / 60)  # yellow centre line under the aircraft
dash = t.nodes.new('ShaderNodeMath'); dash.operation = 'PINGPONG'; dash.inputs[1].default_value = 0.012
t.links.new(sep.outputs['Y'], dash.inputs[0])
dgt = t.nodes.new('ShaderNodeMath'); dgt.operation = 'GREATER_THAN'; dgt.inputs[1].default_value = 0.004
t.links.new(dash.outputs[0], dgt.inputs[0])
ym = t.nodes.new('ShaderNodeMath'); ym.operation = 'MULTIPLY'; t.links.new(yl.outputs[0], ym.inputs[0]); t.links.new(dgt.outputs[0], ym.inputs[1])
wl = band(0.23, 0.25 / 60)
mix1 = t.nodes.new('ShaderNodeMix'); mix1.data_type = 'RGBA'
mix1.inputs['B'].default_value = (0.55, 0.42, 0.05, 1)
t.links.new(ym.outputs[0], mix1.inputs['Factor']); t.links.new(ramp.outputs[0], mix1.inputs['A'])
mix2 = t.nodes.new('ShaderNodeMix'); mix2.data_type = 'RGBA'
mix2.inputs['B'].default_value = (0.5, 0.5, 0.48, 1)
t.links.new(wl.outputs[0], mix2.inputs['Factor']); t.links.new(mix1.outputs['Result'], mix2.inputs['A'])
t.links.new(mix2.outputs['Result'], b.inputs['Base Color'])
b.inputs['Roughness'].default_value = 0.92
bump = t.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.06
t.links.new(n2.outputs['Fac'], bump.inputs['Height']); t.links.new(bump.outputs[0], b.inputs['Normal'])
deck.data.materials.append(m)
deck.location = (-8, -40, GZ)

# ocean
bpy.ops.mesh.primitive_plane_add(size=6000, location=(0, 0, GZ - 18))
oc = bpy.context.active_object; oc.name = 'Ocean'
mo = bpy.data.materials.new('OceanMat'); mo.use_nodes = True
to = mo.node_tree; bo = to.nodes['Principled BSDF']
bo.inputs['Base Color'].default_value = (0.005, 0.02, 0.03, 1); bo.inputs['Roughness'].default_value = 0.08
wv = to.nodes.new('ShaderNodeTexWave'); wv.inputs['Scale'].default_value = 0.02; wv.inputs['Distortion'].default_value = 8
wv.inputs['Detail'].default_value = 6
bm = to.nodes.new('ShaderNodeBump'); bm.inputs['Strength'].default_value = 0.15
to.links.new(wv.outputs['Fac'], bm.inputs['Height']); to.links.new(bm.outputs[0], bo.inputs['Normal'])
oc.data.materials.append(mo)

# thin-glass canopy for Cycles (single-surface glass renders black otherwise)
g = bpy.data.materials.get('CanopyGlass')
if g:
    nt2 = g.node_tree; nt2.nodes.clear()
    o2 = nt2.nodes.new('ShaderNodeOutputMaterial'); tr = nt2.nodes.new('ShaderNodeBsdfTransparent'); gl = nt2.nodes.new('ShaderNodeBsdfGlossy')
    gl.inputs['Roughness'].default_value = 0.03; tr.inputs[0].default_value = (0.93, 0.95, 0.92, 1)
    fr = nt2.nodes.new('ShaderNodeFresnel'); fr.inputs['IOR'].default_value = 1.5
    mx = nt2.nodes.new('ShaderNodeMixShader')
    nt2.links.new(fr.outputs[0], mx.inputs[0]); nt2.links.new(tr.outputs[0], mx.inputs[1]); nt2.links.new(gl.outputs[0], mx.inputs[2]); nt2.links.new(mx.outputs[0], o2.inputs[0])
V = {
    'hero': ((-11.5, 15.5, 1.1), (0.3, 1.6, 0.1), 38),
    'hero_r': ((12.5, -14.5, 3.8), (0, -1.5, -0.2), 38),
    'side': ((-24, 0.5, 0.4), (0, 0.5, 0.2), 45),
    'nose': ((-3.2, 12.2, 1.1), (0, 5.3, 0.5), 30),
    'top': ((-8, 4, 14), (0, 0, 0), 32),
    'front': ((0.0, 22, -0.6), (0, 0, 0.0), 50),
    'tail': ((3.5, -14, 1.2), (0, -6, 0.1), 35),
    'under': ((6, 9, -1.55), (0, 1, -0.6), 26),
    'pov': ((0, 9.25 - 4.20, 1.12), (0, 9.25 - 1.5, 0.66), 26),
    'pov_l': ((0.02, 9.25 - 4.55, 1.16), (-0.45, 9.25 - 4.1, 0.55), 20),
    'pov_r': ((-0.02, 9.25 - 4.55, 1.16), (0.45, 9.25 - 4.1, 0.55), 20),
    'ck_over': ((-1.6, 9.25 - 6.2, 2.5), (0, 9.25 - 4.3, 0.85), 32),
    'ck_side': ((-3.2, 9.25 - 4.0, 1.9), (0, 9.25 - 4.3, 0.95), 35),
}
POV = ('pov', 'pov_l', 'pov_r')
for k in views:
    for o in bpy.data.objects:
        if o.name.startswith('Pilot'):
            o.hide_render = k in POV
    l, tg, lens = V[k]
    cam = camera(l, tg, lens=lens)
    cam.data.dof.use_dof = False
    render('/home/claude/mig/out/%s_%s.png' % (tag, k))
