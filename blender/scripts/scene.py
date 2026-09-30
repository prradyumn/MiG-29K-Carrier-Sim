import bpy, math
from mathutils import Vector

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def setup_render(res=(1600, 900), samples=48, engine='CYCLES'):
    sc = bpy.context.scene
    sc.render.engine = engine
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception:
        pass
    sc.cycles.max_bounces = 6
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast'
    sc.render.image_settings.file_format = 'PNG'
    sc.cycles.threads = 0

def sky(sun_el=35, sun_rot=-40, strength=0.9):
    sc = bpy.context.scene
    w = bpy.data.worlds.new('World'); sc.world = w; w.use_nodes = True
    nt = w.node_tree; nt.nodes.clear()
    sk = nt.nodes.new('ShaderNodeTexSky'); sk.sky_type = 'NISHITA'
    sk.sun_elevation = math.radians(sun_el); sk.sun_rotation = math.radians(sun_rot)
    sk.altitude = 50; sk.air_density = 1.0; sk.dust_density = 1.5
    bg = nt.nodes.new('ShaderNodeBackground'); bg.inputs[1].default_value = strength
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(sk.outputs[0], bg.inputs[0]); nt.links.new(bg.outputs[0], out.inputs[0])
    sd = bpy.data.lights.new('Sun', 'SUN'); sd.energy = 3.2; sd.angle = math.radians(0.6)
    so = bpy.data.objects.new('Sun', sd); sc.collection.objects.link(so)
    so.rotation_euler = (math.radians(90 - sun_el), 0, math.radians(sun_rot + 180))
    return so

def ground(z=-1.74, color=(0.18, 0.18, 0.19)):
    bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, z))
    g = bpy.context.active_object; g.name = 'Ground'
    m = bpy.data.materials.new('GroundMat'); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = (*color, 1); b.inputs['Roughness'].default_value = 0.85
    g.data.materials.append(m)
    return g

def camera(loc, target, lens=50, name='Cam'):
    cd = bpy.data.cameras.new(name); cd.lens = lens; cd.clip_start = 0.05; cd.clip_end = 2000
    co = bpy.data.objects.new(name, cd); bpy.context.scene.collection.objects.link(co)
    co.location = loc
    d = Vector(target) - Vector(loc)
    co.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = co
    return co

def render(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
