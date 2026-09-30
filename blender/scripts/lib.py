"""Geometry helpers for the MiG-29K build (Blender 4.2, bpy module).
Frame: Blender X = right (starboard), Y = forward, Z = up.
Stations: s = distance aft of nose tip (m). Y = S0 - s, origin near CG.
"""
import bpy, bmesh, math
import numpy as np
from mathutils import Vector, Matrix

S0 = 9.25  # nose tip Y  (CG at s = 9.25)


def Y(s):
    return S0 - s


def interp_table(table, s):
    """table: list of (s, v0, v1, ...) sorted; returns tuple of interpolated values (smoothstep between keys)."""
    ss = [r[0] for r in table]
    if s <= ss[0]:
        return table[0][1:]
    if s >= ss[-1]:
        return table[-1][1:]
    for i in range(len(ss) - 1):
        if ss[i] <= s <= ss[i + 1]:
            t = (s - ss[i]) / (ss[i + 1] - ss[i])
            return tuple(a + (b - a) * t for a, b in zip(table[i][1:], table[i + 1][1:]))


def cr_interp(table, s):
    """Catmull-Rom interpolation of a key table (smooth)."""
    ss = [r[0] for r in table]
    n = len(ss)
    if s <= ss[0]:
        return table[0][1:]
    if s >= ss[-1]:
        return table[-1][1:]
    i = max(j for j in range(n - 1) if ss[j] <= s)
    t = (s - ss[i]) / (ss[i + 1] - ss[i])
    p0 = table[max(i - 1, 0)][1:]
    p1 = table[i][1:]
    p2 = table[i + 1][1:]
    p3 = table[min(i + 2, n - 1)][1:]
    out = []
    for a, b, c, d in zip(p0, p1, p2, p3):
        # monotone-ish centripetal-free CR with tension
        m1 = (c - a) * 0.5
        m2 = (d - b) * 0.5
        t2, t3 = t * t, t * t * t
        v = (2 * t3 - 3 * t2 + 1) * b + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * c + (t3 - t2) * m2
        lo, hi = min(b, c), max(b, c)
        # limit overshoot
        span = hi - lo
        v = min(max(v, lo - 0.15 * span), hi + 0.15 * span)
        out.append(v)
    return tuple(out)


def new_obj(name, verts, faces, smooth=True, parent=None, coll=None, auto_smooth=40, fixn=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.validate(clean_customdata=False)
    me.update()
    ob = bpy.data.objects.new(name, me)
    (coll or bpy.context.scene.collection).objects.link(ob)
    if fixn:
        fix_normals(ob)
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
        if auto_smooth:
            set_auto_smooth(ob, auto_smooth)
    if parent:
        ob.parent = parent
    return ob


def fix_normals(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def set_auto_smooth(ob, angle_deg):
    """Blender 4.1+: split normals by angle using 'smooth by angle' via edges sharp marking."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    lim = math.radians(angle_deg)
    for e in bm.edges:
        if len(e.link_faces) == 2:
            a = e.link_faces[0].normal.angle(e.link_faces[1].normal, 0)
            e.smooth = a < lim
        else:
            e.smooth = True
    bm.to_mesh(me)
    bm.free()


def loft(name, rings, closed=True, cap0=False, cap1=False, **kw):
    """rings: list of lists of 3D points (same count). Builds quad strip surface."""
    nr = len(rings)
    m = len(rings[0])
    verts = [p for r in rings for p in r]
    faces = []
    mm = m if closed else m - 1
    for i in range(nr - 1):
        for j in range(mm):
            j2 = (j + 1) % m
            a = i * m + j
            b = i * m + j2
            c = (i + 1) * m + j2
            d = (i + 1) * m + j
            faces.append((a, b, c, d))
    if cap0:
        c = len(verts)
        cen = np.mean(np.array(rings[0]), axis=0)
        verts.append(tuple(cen))
        for j in range(mm):
            faces.append((c, (j + 1) % m, j))
    if cap1:
        c = len(verts)
        cen = np.mean(np.array(rings[-1]), axis=0)
        verts.append(tuple(cen))
        base = (nr - 1) * m
        for j in range(mm):
            faces.append((c, base + j, base + (j + 1) % m))
    return new_obj(name, verts, faces, **kw)


def superellipse_ring(xc, zc, a, b_top, b_bot, n_top, n_bot, N, y, flat_bottom=0.0):
    """closed ring around (xc,zc) at world Y=y. Starts at +x side (starboard) going up (CCW seen from front)."""
    pts = []
    for k in range(N):
        th = 2 * math.pi * k / N
        c, s_ = math.cos(th), math.sin(th)
        if s_ >= 0:
            n = n_top
            b = b_top
        else:
            n = n_bot
            b = b_bot
        x = a * np.sign(c) * abs(c) ** (2.0 / n)
        z = b * np.sign(s_) * abs(s_) ** (2.0 / n)
        pts.append((xc + x, y, zc + z))
    return pts


# ---------------------------------------------------------------- airfoils

def naca_thick(x, t):
    return 5 * t * (0.2969 * np.sqrt(np.maximum(x, 0)) - 0.1260 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1036 * x ** 4)


def camber(x, m=0.01, p=0.4):
    x = np.asarray(x, dtype=float)
    return np.where(x < p, m / p ** 2 * (2 * p * x - x ** 2), m / (1 - p) ** 2 * ((1 - 2 * p) + 2 * p * x - x ** 2))


def airfoil_loop(c0, c1, t, n=24, m=0.008, blunt_te=0.0015):
    """Closed airfoil section loop in chord fractions [c0, c1]. Returns list of (xc, zc) in chord units.
    Upper surface c0->c1, then lower c1->c0. If c0==0 the LE point is shared."""
    beta = np.linspace(0, math.pi, n)
    xs = c0 + (c1 - c0) * (1 - np.cos(beta)) / 2
    if c0 > 0:
        # cosine clustering at both ends not needed: use uniform-ish with LE cluster only if c0==0
        xs = np.linspace(c0, c1, n)
    yt = naca_thick(xs, t) + blunt_te * xs
    yc = camber(xs, m)
    up = [(x, c + h) for x, c, h in zip(xs, yc, yt)]
    lo = [(x, c - h) for x, c, h in zip(xs, yc, yt)]
    if c0 == 0:
        loop = up + lo[::-1][1:-1]  # skip duplicated LE and TE
        loop = up + lo[::-1][1:-1]
    else:
        loop = up + lo[::-1]
    return loop


def surface_panel(name, w0, w1, plan, c0, c1, tfun, nspan=10, nchord=22, side=1, z0fun=None,
                  twistfun=None, cap=True, xform=None, m=0.008, **kw):
    """Generic lifting-surface chunk.
    plan(w) -> (le_s, te_s); w = spanwise coordinate (m from centre, positive).
    Section lies in plane Y-Z at X = side*w; chord along -Y (aft).
    z0fun(w) -> chord line z at LE. twistfun(w)-> deg (nose up +).
    xform: optional function mapping (w, s, z) -> world (x, y, z) for fins etc."""
    rings = []
    for i in range(nspan + 1):
        w = w0 + (w1 - w0) * i / nspan
        le, te = plan(w)
        ch = te - le
        t = tfun(w)
        loop = airfoil_loop(c0, c1, t, nchord, m=m)
        z0 = z0fun(w) if z0fun else 0.0
        tw = math.radians(twistfun(w)) if twistfun else 0.0
        ring = []
        for (xc, zc) in loop:
            ds = xc * ch
            dz = zc * ch
            # twist about 25% chord... rotate (ds,dz) around quarter chord
            qx = 0.25 * ch
            rx, rz = ds - qx, dz
            ds2 = qx + rx * math.cos(tw) + rz * math.sin(tw)
            dz2 = -rx * math.sin(tw) + rz * math.cos(tw)
            s = le + ds2
            z = z0 + dz2
            if xform:
                ring.append(xform(w, s, z))
            else:
                ring.append((side * w, Y(s), z))
        if side < 0 and not xform:
            ring = ring[::-1]
        rings.append(ring)
    return loft(name, rings, closed=True, cap0=cap, cap1=cap, **kw)


def set_origin(ob, world_pt):
    """Move object origin to world_pt without moving geometry."""
    wp = Vector(world_pt)
    mw = ob.matrix_world.copy()
    local = mw.inverted() @ wp
    ob.data.transform(Matrix.Translation(-local))
    ob.matrix_world = mw @ Matrix.Translation(local)


def parent_keep(child, parent):
    mw = child.matrix_world.copy()
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()
    child.matrix_world = mw


def tube_along(name, pts, r, n=12, cap=True, **kw):
    """Sweep circle of radius r (scalar or list) along polyline pts (list of Vector-like)."""
    pts = [Vector(p) for p in pts]
    rs = r if isinstance(r, (list, tuple)) else [r] * len(pts)
    rings = []
    prev_n = None
    for i, p in enumerate(pts):
        if i == 0:
            d = (pts[1] - pts[0]).normalized()
        elif i == len(pts) - 1:
            d = (pts[-1] - pts[-2]).normalized()
        else:
            d = ((pts[i + 1] - pts[i]).normalized() + (pts[i] - pts[i - 1]).normalized()).normalized()
        if prev_n is None:
            up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
            nvec = d.cross(up).normalized()
        else:
            nvec = (prev_n - d * prev_n.dot(d)).normalized()
        prev_n = nvec
        bvec = d.cross(nvec).normalized()
        ring = []
        for k in range(n):
            a = 2 * math.pi * k / n
            ring.append(tuple(p + (nvec * math.cos(a) + bvec * math.sin(a)) * rs[i]))
        rings.append(ring)
    return loft(name, rings, closed=True, cap0=cap, cap1=cap, **kw)


def cylinder(name, p0, p1, r, n=16, cap=True, **kw):
    return tube_along(name, [p0, p1], r, n=n, cap=cap, **kw)


def lathe(name, profile, axis_p0, axis_dir, n=24, cap0=True, cap1=True, **kw):
    """profile: list of (t, r) along axis. Builds surface of revolution."""
    d = Vector(axis_dir).normalized()
    p0 = Vector(axis_p0)
    up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
    u = d.cross(up).normalized()
    v = d.cross(u).normalized()
    rings = []
    for (t, r) in profile:
        c = p0 + d * t
        rings.append([tuple(c + (u * math.cos(2 * math.pi * k / n) + v * math.sin(2 * math.pi * k / n)) * r) for k in range(n)])
    return loft(name, rings, closed=True, cap0=cap0, cap1=cap1, **kw)


def box(name, center, size, rot=(0, 0, 0), bevel=0.0, **kw):
    cx, cy, cz = center
    sx, sy, sz = [v / 2 for v in size]
    vs = [(-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz), (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz)]
    fs = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    kw.setdefault('smooth', False)
    ob = new_obj(name, vs, fs, **kw)
    ob.rotation_euler = rot
    ob.location = center
    if bevel > 0:
        md = ob.modifiers.new('bev', 'BEVEL')
        md.width = bevel
        md.segments = 2
        apply_mods(ob)
    return ob


def apply_mods(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)


def mat(name, color=(0.5, 0.5, 0.5), rough=0.5, metal=0.0, emit=None, emit_strength=0.0, alpha=1.0,
        transmission=0.0, ior=1.45):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    b.inputs['IOR'].default_value = ior
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = emit_strength
    if transmission > 0:
        b.inputs['Transmission Weight'].default_value = transmission
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        m.blend_method = 'BLEND'
    return m


def assign(ob, m):
    ob.data.materials.clear()
    ob.data.materials.append(m)


def join(objs, name):
    objs = [o for o in objs if o]
    if len(objs) == 1:
        objs[0].name = name
        return objs[0]
    ctx = bpy.context
    for o in ctx.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    ctx.view_layer.objects.active = objs[0]
    with ctx.temp_override(active_object=objs[0], selected_editable_objects=objs, selected_objects=objs):
        bpy.ops.object.join()
    objs[0].name = name
    return objs[0]


def mirror_obj(ob, name):
    """Duplicate mesh object and mirror across X=0 (real geometry, flipped normals fixed)."""
    me = ob.data.copy()
    me.transform(Matrix.Scale(-1, 4, (1, 0, 0)))
    me.flip_normals()
    o2 = bpy.data.objects.new(name, me)
    (ob.users_collection[0]).objects.link(o2)
    mw = ob.matrix_world.copy()
    # mirror location
    loc = mw.translation.copy()
    loc.x = -loc.x
    o2.location = loc
    # geometry is already mirrored about the object's local origin; recompute: we mirrored mesh in local space,
    # so object origin must be mirrored too — only valid when object has no rotation.
    return o2
