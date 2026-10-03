"""Seamless ground materials for the Siachen location, built as Blender procedural shaders and baked with Cycles.

Each material is a node tree driven by 4D noise sampled on a torus (u, v -> cos/sin pairs), so the bake tiles with
no seam. Baked per material: albedo (sRGB), roughness and a tangent-space normal map from the bump network.
  rock    Karakoram granite / gneiss: grey-brown, strata, joints, lichen and desert varnish
  snow    wind-packed snow with sastrugi ripples and a faint blue in the hollows
  ice     glacier ice: blue-white, flow banding, air bubbles, hairline cracks
  debris  moraine rubble: angular blocks in grit, grey to rust
  gravel  river bars: rounded pebbles in silt
Run: python materials.py <out_dir>   (bpy 4.2)  -> <name>_albedo.jpg, <name>_rough.jpg, <name>_normal.jpg
"""
import sys, os, math
import bpy

OUT = sys.argv[-1] if len(sys.argv) > 1 and not sys.argv[-1].endswith('.py') else 'out'
os.makedirs(OUT, exist_ok=True)
RES = 1024
TAU = 2 * math.pi

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'; prefs.get_devices()
    for d in prefs.devices: d.use = True
    sc.cycles.device = 'GPU'
except Exception as e:
    print('GPU not available, CPU bake', e)
sc.cycles.samples = 8
sc.render.bake.margin = 0

bpy.ops.mesh.primitive_plane_add(size=2)
plane = bpy.context.active_object


class T:
    """small node-tree builder"""
    def __init__(self, m):
        self.nt = m.node_tree; self.n = self.nt.nodes; self.l = self.nt.links; self.n.clear()
        uv = self.n.new('ShaderNodeTexCoord'); sep = self.n.new('ShaderNodeSeparateXYZ'); self.l.new(uv.outputs['UV'], sep.inputs[0])
        self.u, self.v = sep.outputs[0], sep.outputs[1]
    def node(self, kind, **kw):
        x = self.n.new(kind)
        for k, v in kw.items():
            if hasattr(x, k): setattr(x, k, v)
        return x
    def link(self, a, b): self.l.new(a, b)
    def math(self, op, a, b=None, clamp=False):
        m = self.node('ShaderNodeMath', operation=op); m.use_clamp = clamp
        for i, s in enumerate((a, b)):
            if s is None: continue
            if isinstance(s, (int, float)): m.inputs[i].default_value = s
            else: self.link(s, m.inputs[i])
        return m.outputs[0]
    def torus(self, R, su=1.0, sv=1.0):
        """seamless 4D coordinates: (R cos 2pi u, R sin 2pi u, R' cos 2pi v) and W = R' sin 2pi v; su/sv stretch."""
        au = self.math('MULTIPLY', self.u, TAU); av = self.math('MULTIPLY', self.v, TAU)
        c = self.node('ShaderNodeCombineXYZ')
        self.link(self.math('MULTIPLY', self.math('COSINE', au), R * su), c.inputs[0])
        self.link(self.math('MULTIPLY', self.math('SINE', au), R * su), c.inputs[1])
        self.link(self.math('MULTIPLY', self.math('COSINE', av), R * sv), c.inputs[2])
        return c.outputs[0], self.math('MULTIPLY', self.math('SINE', av), R * sv)
    def noise(self, R, scale=1.0, detail=6.0, rough=0.55, su=1.0, sv=1.0, distort=0.0):
        vec, w = self.torus(R, su, sv)
        n = self.node('ShaderNodeTexNoise'); n.noise_dimensions = '4D'
        self.link(vec, n.inputs['Vector']); self.link(w, n.inputs['W'])
        n.inputs['Scale'].default_value = scale; n.inputs['Detail'].default_value = detail; n.inputs['Roughness'].default_value = rough
        n.inputs['Distortion'].default_value = distort
        return n.outputs['Fac']
    def voronoi(self, R, scale=1.0, feature='F1', out='Distance', rand=1.0, su=1.0, sv=1.0):
        vec, w = self.torus(R, su, sv)
        v = self.node('ShaderNodeTexVoronoi'); v.voronoi_dimensions = '4D'; v.feature = feature
        self.link(vec, v.inputs['Vector']); self.link(w, v.inputs['W'])
        v.inputs['Scale'].default_value = scale; v.inputs['Randomness'].default_value = rand
        return v.outputs[out]
    def ramp(self, fac, stops):
        r = self.node('ShaderNodeValToRGB'); self.link(fac, r.inputs['Fac'])
        e = r.color_ramp.elements
        while len(e) < len(stops): e.new(0.5)
        for el, (p, c) in zip(e, stops): el.position = p; el.color = (*c, 1.0) if len(c) == 3 else c
        return r.outputs['Color']
    def bw(self, col):
        n = self.node('ShaderNodeRGBToBW'); self.link(col, n.inputs[0]); return n.outputs[0]
    def ridge(self, R, scale, width, distort=2.0, su=1.0, sv=1.0):
        """thin wandering lines where a distorted noise crosses 0.5 (natural fractures, not cells)"""
        n = self.noise(R, scale, 3, 0.5, su, sv, distort)
        return self.math('LESS_THAN', self.math('ABSOLUTE', self.math('SUBTRACT', n, 0.5)), width)
    def mixc(self, fac, a, b, blend='MIX'):
        m = self.node('ShaderNodeMix'); m.data_type = 'RGBA'; m.blend_type = blend
        if isinstance(fac, (int, float)): m.inputs[0].default_value = fac
        else: self.link(fac, m.inputs[0])
        self.link(a, m.inputs[6]); self.link(b, m.inputs[7]); return m.outputs[2]
    def finish(self, color, rough, height, strength=1.0, dist=0.02):
        """principled + bump; also exposes color / rough on emission for the bakes"""
        p = self.node('ShaderNodeBsdfPrincipled'); self.link(color, p.inputs['Base Color']); self.link(rough, p.inputs['Roughness'])
        b = self.node('ShaderNodeBump'); b.inputs['Strength'].default_value = strength; b.inputs['Distance'].default_value = dist
        self.link(height, b.inputs['Height']); self.link(b.outputs['Normal'], p.inputs['Normal'])
        o = self.node('ShaderNodeOutputMaterial'); self.link(p.outputs[0], o.inputs['Surface'])
        e = self.node('ShaderNodeEmission'); self.emit, self.out, self.bsdf = e, o, p
        self.color, self.rough = color, rough
        return p


def rock(t):
    big = t.noise(1.0, 2.2, 8, 0.6)
    strata = t.noise(1.0, 1.1, 3, 0.5, su=0.25, sv=3.0, distort=0.6)          # bedding, stretched across the tile
    crack = t.math('MAXIMUM', t.ridge(1.0, 1.6, 0.010, 2.4), t.math('MULTIPLY', t.ridge(1.0, 4.0, 0.006, 1.5), 0.6))
    fine = t.noise(1.0, 22.0, 6, 0.65)
    lichen = t.math('GREATER_THAN', t.noise(1.0, 9.0, 4, 0.5), 0.62)
    base = t.ramp(t.math('ADD', t.math('MULTIPLY', big, 0.7), t.math('MULTIPLY', strata, 0.5)),
                  [(0.3, (0.13, 0.12, 0.11)), (0.5, (0.33, 0.30, 0.26)), (0.68, (0.52, 0.48, 0.42)), (0.9, (0.26, 0.21, 0.17))])
    varnish = t.ramp(fine, [(0.35, (0.16, 0.12, 0.09)), (0.65, (0.40, 0.37, 0.33))])
    col = t.mixc(0.35, base, varnish, 'MULTIPLY')
    col = t.mixc(t.math('MULTIPLY', crack, 0.8), col, t.ramp(fine, [(0.0, (0.05, 0.05, 0.05)), (1.0, (0.08, 0.07, 0.06))]))
    col = t.mixc(t.math('MULTIPLY', lichen, 0.25), col, t.ramp(fine, [(0.0, (0.42, 0.40, 0.30)), (1.0, (0.55, 0.52, 0.40))]))
    rough = t.math('ADD', 0.72, t.math('MULTIPLY', fine, 0.2))
    height = t.math('ADD', t.math('MULTIPLY', big, 0.6), t.math('SUBTRACT', t.math('MULTIPLY', fine, 0.25), t.math('MULTIPLY', crack, 0.35)))
    return t.finish(col, rough, height, 1.0, 0.04)


def snow(t):
    rip = t.noise(1.0, 2.0, 3, 0.4, su=0.35, sv=2.6, distort=1.2)             # sastrugi: long wind ripples
    drift = t.noise(1.0, 1.0, 4, 0.5)
    grain = t.noise(1.0, 60.0, 2, 0.5)
    col = t.ramp(t.math('ADD', t.math('MULTIPLY', rip, 0.6), t.math('MULTIPLY', drift, 0.4)),
                 [(0.3, (0.78, 0.84, 0.92)), (0.55, (0.92, 0.94, 0.97)), (0.8, (0.98, 0.98, 0.99))])
    rough = t.math('ADD', 0.55, t.math('MULTIPLY', grain, 0.25))
    height = t.math('ADD', t.math('MULTIPLY', rip, 0.7), t.math('MULTIPLY', grain, 0.05))
    return t.finish(col, rough, height, 0.6, 0.03)


def ice(t):
    band = t.noise(1.0, 1.4, 4, 0.45, su=0.2, sv=4.0, distort=0.3)           # flow foliation
    cloud = t.noise(1.0, 3.0, 6, 0.55)
    crack = t.math('MULTIPLY', t.ridge(1.0, 2.5, 0.006, 1.8, su=0.6, sv=1.6), 0.6)
    bubbles = t.math('GREATER_THAN', t.voronoi(1.0, 40.0, 'F1', 'Distance'), 0.42)
    col = t.ramp(t.math('ADD', t.math('MULTIPLY', band, 0.6), t.math('MULTIPLY', cloud, 0.4)),
                 [(0.25, (0.40, 0.60, 0.74)), (0.5, (0.62, 0.78, 0.88)), (0.75, (0.84, 0.91, 0.95))])
    col = t.mixc(t.math('MULTIPLY', bubbles, 0.25), col, t.ramp(cloud, [(0.0, (0.92, 0.95, 0.98)), (1.0, (1.0, 1.0, 1.0))]))
    col = t.mixc(t.math('MULTIPLY', crack, 0.7), col, t.ramp(cloud, [(0.0, (0.10, 0.22, 0.32)), (1.0, (0.18, 0.32, 0.44))]))
    rough = t.math('ADD', 0.12, t.math('MULTIPLY', cloud, 0.25))
    height = t.math('SUBTRACT', t.math('MULTIPLY', band, 0.3), t.math('MULTIPLY', crack, 0.5))
    return t.finish(col, rough, height, 0.5, 0.02)


def debris(t):
    cells = t.voronoi(1.0, 9.0, 'F1', 'Distance', 1.0)
    cellc = t.voronoi(1.0, 9.0, 'F1', 'Color', 1.0)
    small = t.voronoi(1.0, 30.0, 'F1', 'Distance', 1.0)
    grit = t.noise(1.0, 50.0, 4, 0.6)
    tone = t.noise(1.0, 2.0, 4, 0.5)
    stone = t.math('LESS_THAN', cells, 0.62)
    pal = t.ramp(t.math('ADD', tone, 0.0), [(0.3, (0.22, 0.21, 0.20)), (0.55, (0.36, 0.33, 0.30)), (0.8, (0.42, 0.33, 0.25))])
    stonecol = t.mixc(0.0, pal, pal); stonecol = t.mixc(t.math('MULTIPLY', t.bw(cellc), 0.9), t.ramp(tone, [(0.3, (0.17, 0.16, 0.15)), (0.8, (0.30, 0.26, 0.22))]), pal)
    gritcol = t.ramp(grit, [(0.3, (0.24, 0.22, 0.20)), (0.7, (0.33, 0.31, 0.28))])
    col = t.mixc(stone, gritcol, stonecol)
    rough = t.math('ADD', 0.78, t.math('MULTIPLY', grit, 0.15))
    height = t.math('ADD', t.math('MULTIPLY', stone, t.math('SUBTRACT', 0.7, cells)), t.math('MULTIPLY', t.math('SUBTRACT', 0.6, small), 0.25))
    return t.finish(col, rough, height, 1.0, 0.05)


def gravel(t):
    peb = t.voronoi(1.0, 26.0, 'F1', 'Distance', 0.9)
    pebc = t.voronoi(1.0, 26.0, 'F1', 'Color', 0.9)
    silt = t.noise(1.0, 3.0, 6, 0.5)
    col = t.mixc(t.math('LESS_THAN', peb, 0.56), t.ramp(silt, [(0.3, (0.40, 0.38, 0.34)), (0.7, (0.52, 0.49, 0.44))]),
                 t.ramp(t.bw(pebc), [(0.1, (0.30, 0.29, 0.28)), (0.5, (0.50, 0.47, 0.43)), (0.9, (0.66, 0.62, 0.56))]))
    rough = t.math('ADD', 0.7, t.math('MULTIPLY', silt, 0.2))
    height = t.math('MULTIPLY', t.math('MAXIMUM', t.math('SUBTRACT', 0.56, peb), 0.0), 2.0)
    return t.finish(col, rough, height, 0.8, 0.03)


def bake(name, build):
    m = bpy.data.materials.new(name); m.use_nodes = True
    t = T(m); build(t)
    plane.data.materials.clear(); plane.data.materials.append(m)
    for kind in ('albedo', 'rough', 'normal'):
        img = bpy.data.images.new(f'{name}_{kind}', RES, RES, float_buffer=False)
        img.colorspace_settings.name = 'sRGB' if kind == 'albedo' else 'Non-Color'
        tex = t.n.new('ShaderNodeTexImage'); tex.image = img; t.n.active = tex
        if kind == 'normal':
            t.link(t.bsdf.outputs[0], t.out.inputs['Surface'])
            bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT')
        else:
            src = t.color if kind == 'albedo' else t.rough
            if kind == 'rough':      # a float socket into the emission colour
                t.link(src, t.emit.inputs['Color'])
            else:
                t.link(src, t.emit.inputs['Color'])
            t.link(t.emit.outputs[0], t.out.inputs['Surface'])
            bpy.ops.object.bake(type='EMIT')
        img.filepath_raw = os.path.join(OUT, f'{name}_{kind}.jpg'); img.file_format = 'JPEG'
        sc.render.image_settings.quality = 92
        img.save_render(img.filepath_raw)
        t.n.remove(tex)
    print('baked', name)


plane.select_set(True); bpy.context.view_layer.objects.active = plane
for nm, fn in (('rock', rock), ('snow', snow), ('ice', ice), ('debris', debris), ('gravel', gravel)):
    bake(nm, fn)
