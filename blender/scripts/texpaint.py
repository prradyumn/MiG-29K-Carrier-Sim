"""Procedural 3D-aware texture painting for the MiG-29K skin atlases.
Reads baked position/normal/id/ao maps, writes baseColor / ORM / normal textures.
Usage: python3 texpaint.py RES [group ...]"""
import sys, json, math, time
sys.path.insert(0, '/home/claude/mig')
import numpy as np
from PIL import Image
from scipy import ndimage
import decals as DC
import build_airframe as A
from lib import S0

RES = int(sys.argv[1])
GROUPS = sys.argv[2:] or ['SkinA', 'SkinB']
OUT = '/home/claude/mig/out/'
META = json.load(open(OUT + 'bake_meta.json'))
RNG = np.random.default_rng(29)


def srgb2lin(c):
    c = np.asarray(c, dtype=np.float32) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin2srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------ noise
def _hash(ix, iy, iz, seed):
    h = (ix.astype(np.int64) * 73856093) ^ (iy.astype(np.int64) * 19349663) ^ (iz.astype(np.int64) * 83492791) ^ (seed * 2654435761)
    h = h & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    h = h ^ (h >> 16)
    return (h & 0xFFFFFF).astype(np.float32) / float(0xFFFFFF)


def vnoise(p, seed=0):
    f = np.floor(p)
    t = p - f
    t = t * t * (3 - 2 * t)
    i = f.astype(np.int64)
    out = 0
    for dx in (0, 1):
        wx = t[:, 0] if dx else 1 - t[:, 0]
        for dy in (0, 1):
            wy = t[:, 1] if dy else 1 - t[:, 1]
            for dz in (0, 1):
                wz = t[:, 2] if dz else 1 - t[:, 2]
                out = out + wx * wy * wz * _hash(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz, seed)
    return out


def fbm(p, scale, oct=4, seed=0, lac=2.0, gain=0.5):
    """p: (n,3), scale: (3,) frequency multipliers."""
    res = np.zeros(len(p), np.float32)
    amp, tot = 1.0, 0.0
    q = p * np.asarray(scale, np.float32)
    CH = 3_000_000
    for o in range(oct):
        for a in range(0, len(p), CH):
            res[a:a + CH] += amp * vnoise(q[a:a + CH], seed + o * 17)
        tot += amp
        amp *= gain
        q = q * lac + 0.37
    return res / tot


# ------------------------------------------------------------------ helpers
def aa_line(d, width, ts):
    """anti-aliased line of physical width (m) at signed distance d (m), texel size ts (m)."""
    w = np.maximum(width, ts * 1.0)
    cov = np.clip((w / 2 - np.abs(d)) / ts + 0.5, 0, 1)
    return cov * np.minimum(width / w, 1.0)


def dots(along, spacing, dperp, rad, ts):
    """row of dots (rivets): along-coordinate, perpendicular distance to row."""
    a = (along / spacing) % 1.0 - 0.5
    da = a * spacing
    r = np.sqrt(da * da + dperp * dperp)
    w = np.maximum(rad, ts * 0.7)
    return np.clip((w - r) / ts + 0.5, 0, 1) * np.minimum(rad / w, 1) ** 2


def sample_img(img, u, v):
    """bilinear sample RGBA float image at u,v in [0,1] (v=0 bottom)."""
    h, w = img.shape[:2]
    x = np.clip(u * (w - 1), 0, w - 1)
    y = np.clip((1 - v) * (h - 1), 0, h - 1)
    x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int)
    x1 = np.minimum(x0 + 1, w - 1); y1 = np.minimum(y0 + 1, h - 1)
    fx = (x - x0)[:, None]; fy = (y - y0)[:, None]
    a = img[y0, x0] * (1 - fx) + img[y0, x1] * fx
    b = img[y1, x0] * (1 - fx) + img[y1, x1] * fx
    return a * (1 - fy) + b * fy


class Ctx:
    pass


def load(g):
    c = Ctx()
    P = np.load(OUT + g + '_pos.npy')
    N = np.load(OUT + g + '_nrm.npy')
    I = np.load(OUT + g + '_id.npy')
    AO = np.load(OUT + g + '_ao.npy')[:, :, 0]
    if AO.shape[0] != RES:
        AO = ndimage.zoom(AO, RES / AO.shape[0], order=1)
    assert P.shape[0] == RES
    c.shape = P.shape[:2]
    c.mask = I[:, :, 3] > 0.5
    c.idx = np.nonzero(c.mask.ravel())[0]
    Pf = P.reshape(-1, 3)[c.idx]
    Nf = N.reshape(-1, 3)[c.idx]
    nl = np.linalg.norm(Nf, axis=1, keepdims=True) + 1e-9
    Nf = Nf / nl
    c.p, c.n = Pf, Nf
    c.x, c.y, c.z = Pf[:, 0], Pf[:, 1], Pf[:, 2]
    c.ax = np.abs(c.x)
    c.s = S0 - c.y
    c.oid = np.rint(I[:, :, 0].ravel()[c.idx] * 255).astype(int)
    names = {v: k for k, v in META[g].items()}
    c.oname = np.array([names.get(i, '').split('.')[0] for i in range(max(names) + 1)])
    c.obj = c.oname[c.oid]
    c.ao = AO.ravel()[c.idx]
    # texel size (m) from position gradients
    dx = np.linalg.norm(np.diff(P, axis=1, append=P[:, -1:]), axis=2)
    dy = np.linalg.norm(np.diff(P, axis=0, append=P[-1:]), axis=2)
    ts = np.minimum(dx, dy).ravel()[c.idx]
    med = np.median(ts[ts > 0])
    c.ts = np.clip(ts, med * 0.3, med * 3).astype(np.float32)
    c.tsm = med
    print(g, 'valid', len(c.idx), 'texel %.2f mm' % (med * 1000))
    n = len(c.idx)
    c.col = np.zeros((n, 3), np.float32)
    c.rough = np.full(n, 0.55, np.float32)
    c.metal = np.zeros(n, np.float32)
    c.h = np.zeros(n, np.float32)
    c.line = np.zeros(n, np.float32)   # accumulated panel line coverage
    c.dirt_mask = np.ones(n, np.float32)
    return c


def objmask(c, prefixes):
    m = np.zeros(len(c.obj), bool)
    for p in prefixes:
        m |= np.char.startswith(c.obj, p)
    return m


# ------------------------------------------------------------------ paint scheme
UP = srgb2lin([140, 147, 153])
LO = srgb2lin([166, 171, 175])
RADOME = srgb2lin([52, 56, 60])
ANTIGLARE = srgb2lin([64, 68, 72])
DIEL = srgb2lin([58, 62, 66])
TITAN = srgb2lin([118, 114, 108])


def base_paint(c):
    wup = smoothstep(-0.40, 0.05, c.n[:, 2])
    c.col[:] = LO[None] * (1 - wup[:, None]) + UP[None] * wup[:, None]
    # large-scale mottling / fading
    n1 = fbm(c.p, (0.45, 0.45, 0.45), 4, seed=1)
    n2 = fbm(c.p, (3.0, 3.0, 3.0), 3, seed=2)
    c.col *= (1 + 0.07 * (n1 - 0.5) + 0.03 * (n2 - 0.5))[:, None]
    c.rough[:] = 0.50 + 0.10 * (n1 - 0.5) + 0.06 * (n2 - 0.5)
    c.n1, c.n2 = n1, n2


def patch(c, m, color, rough=None, metal=None, soft=None):
    if soft is None:
        c.col[m] = color
    else:
        w = soft[m][:, None]
        c.col[m] = c.col[m] * (1 - w) + color * w
    if rough is not None:
        c.rough[m] = rough if soft is None else c.rough[m] * (1 - soft[m]) + rough * soft[m]
    if metal is not None:
        c.metal[m] = metal if soft is None else c.metal[m] * (1 - soft[m]) + metal * soft[m]


# ------------------------------------------------------------------ panel geometry
def add_line(c, d, m, width=0.0029, depth=0.00045, rivet_along=None, rivet_off=0.016, rivet_sp=0.042, rivets=True):
    if not m.any():
        return
    ts = c.ts[m]
    L = aa_line(d[m], width, ts)
    c.line[m] = np.maximum(c.line[m], L)
    c.h[m] -= depth * L
    if rivets and rivet_along is not None:
        al = rivet_along[m]
        for off in (-rivet_off, rivet_off):
            R = dots(al, rivet_sp, d[m] - off, 0.0022, ts)
            c.h[m] += 0.00010 * R
            c.line[m] = np.maximum(c.line[m], 0.35 * R)


def face_classes(c):
    nx, nz = c.n[:, 0], c.n[:, 2]
    side = np.abs(nx) > np.abs(nz) * 1.0
    top = (~side) & (nz > 0)
    bot = (~side) & (nz <= 0)
    return side, top, bot


def rect(c, cls_m, s0, s1, g, g0, g1, fast=True, tone=0.0, touch=None, width=0.0027):
    w = 0.01
    m = cls_m & (c.s > s0 - w) & (c.s < s1 + w) & (g > g0 - w) & (g < g1 + w)
    if not m.any():
        return
    ss, gg = c.s[m], g[m]
    ins = (ss > s0) & (ss < s1) & (gg > g0) & (gg < g1)
    d = np.minimum.reduce([np.abs(ss - s0), np.abs(ss - s1), np.abs(gg - g0), np.abs(gg - g1)])
    L = aa_line(d, width, c.ts[m])
    c.line[m] = np.maximum(c.line[m], L)
    c.h[m] -= 0.0003 * L
    idx = np.nonzero(m)[0]
    if fast:
        inset = 0.018
        # rows along the four edges
        rs = []
        for (dd, al) in ((ss - (s0 + inset), gg), (ss - (s1 - inset), gg), (gg - (g0 + inset), ss), (gg - (g1 - inset), ss)):
            rs.append(dots(al, 0.05, dd, 0.0024, c.ts[m]))
        R = np.maximum.reduce(rs) * ins
        c.h[m] += 0.00012 * R
        c.line[m] = np.maximum(c.line[m], 0.45 * R)
    if tone != 0 or touch is not None:
        ii = idx[ins]
        if touch is not None:
            c.col[ii] = c.col[ii] * 0.35 + touch[None] * 0.65
            c.rough[ii] -= 0.05
        else:
            c.col[ii] *= (1 + tone)


# ------------------------------------------------------------------ decals
def decal(c, img, center, nrm, up, W, H, objs=None, depth=0.35, opacity=1.0, rough=0.48, min_dot=0.35):
    C0 = np.asarray(center, np.float32)
    n = np.asarray(nrm, np.float32); n /= np.linalg.norm(n)
    u = np.asarray(up, np.float32); u = u - n * (u @ n); u /= np.linalg.norm(u)
    r = np.cross(u, n)
    rel = c.p - C0
    a = rel @ r / W + 0.5
    b = rel @ u / H + 0.5
    dn = rel @ n
    m = (a >= 0) & (a <= 1) & (b >= 0) & (b <= 1) & (np.abs(dn) < depth) & ((c.n @ n) > min_dot)
    if objs is not None:
        m &= objmask(c, objs)
    if not m.any():
        return
    rgba = sample_img(img, a[m], b[m])
    al = (rgba[:, 3] * opacity)[:, None]
    col = srgb2lin(rgba[:, :3] * 255)
    # decals pick up a bit of the underlying variation
    col = col * (1 + 0.05 * (c.n2[m][:, None] - 0.5))
    c.col[m] = c.col[m] * (1 - al) + col * al
    c.rough[m] = c.rough[m] * (1 - al[:, 0]) + rough * al[:, 0]


def text_decal(c, txt, center, nrm, up, H, objs=None, color=DC.BLACK, font=DC.FBC, **kw):
    img = DC.text_img(txt, 256, font=font, color=color)
    W = H * img.shape[1] / img.shape[0]
    decal(c, img, center, nrm, up, W, H, objs, **kw)


def stencil(c, lines, center, nrm, up, H, objs=None):
    img = DC.stencil_block(lines)
    W = H * img.shape[1] / img.shape[0]
    decal(c, img, center, nrm, up, W, H, objs, opacity=0.85)


# ------------------------------------------------------------------ weathering
def weather(c, strength=1.0):
    # flow-aligned streaks (stretched along s)
    q = np.stack([c.s * 0.9, c.x * 16, c.z * 16], 1).astype(np.float32)
    st = fbm(q, (1, 1, 1), 4, seed=5)
    streak = np.clip((st - 0.52) * 3.5, 0, 1)
    # dirt accumulates near panel lines (cheap halo via ao and line)
    grime = 0.09 * streak + 0.12 * (1 - c.ao) ** 1.5
    lower = smoothstep(0.2, -0.6, c.n[:, 2])
    grime += 0.05 * lower * fbm(c.p, (2.2, 2.2, 2.2), 3, seed=6)
    grime *= strength * c.dirt_mask
    dirt_col = srgb2lin([92, 90, 84])
    g = np.clip(grime, 0, 0.6)[:, None]
    c.col = c.col * (1 - g) + dirt_col[None] * g
    c.rough += 0.18 * g[:, 0]
    # salt speckle / chipping
    sp = fbm(c.p, (40, 40, 40), 2, seed=7)
    chip = (sp > 0.82) & (c.n1 > 0.55)
    c.col[chip] *= 1.07
    c.rough[chip] += 0.05
    # panel lines darkening (after decals so lines show through)
    c.col *= (1 - 0.58 * c.line)[:, None]
    # ambient occlusion tint baked lightly into colour
    c.col *= (0.82 + 0.18 * c.ao)[:, None]


def soot(c, amount, color=(22, 20, 18), rough=0.8):
    a = np.clip(amount, 0, 1)[:, None]
    col = srgb2lin(color)
    c.col = c.col * (1 - a) + col[None] * a
    c.rough = c.rough * (1 - a[:, 0]) + rough * a[:, 0]


# ------------------------------------------------------------------ group A: fuselage, body, nacelles, booms
FRAMES = [1.93, 2.55, 2.97, 3.62, 4.30, 4.95, 5.60, 6.35, 7.15, 7.90, 8.70, 9.45, 10.25, 11.05, 11.85, 12.65, 13.45, 14.25, 15.05, 15.62]
FULL = {1.93, 2.97, 5.60, 6.35, 7.90, 9.45, 11.05, 12.65, 14.25, 15.05}


def paint_A(c):
    side, top, bot = face_classes(c)
    fus = objmask(c, ['Fuselage'])
    body = objmask(c, ['BodyLERX'])
    nac = objmask(c, ['Nacelle'])
    boom = objmask(c, ['Boom'])
    abk = objmask(c, ['Airbrake'])
    base_paint(c)
    # radome & anti-glare
    rad = fus & (c.s < 1.93)
    patch(c, rad, RADOME, rough=0.40)
    c.dirt_mask[rad] = 0.4
    ag = fus & (c.s >= 1.93) & (c.s < 2.97) & (c.n[:, 2] > 0.55) & (c.ax < 0.42)
    soft = smoothstep(0.55, 0.70, c.n[:, 2])
    patch(c, ag, ANTIGLARE, rough=0.72, soft=soft)
    # bare titanium around nozzles
    ti = (nac & (c.s > 13.55)) | (boom & (c.s > 15.3) & (c.n[:, 0] * np.sign(c.x) < 0.2)) | (fus & (c.s > 15.55))
    tint = fbm(c.p, (6, 6, 6), 3, seed=11)
    heat = smoothstep(13.55, 14.1, c.s)
    tcol = TITAN[None] * (0.85 + 0.3 * tint[:, None]) * (1 - 0.25 * heat[:, None]) + srgb2lin([90, 80, 110])[None] * 0.12 * heat[:, None]
    c.col[ti] = c.col[ti] * 0.0 + tcol[ti]
    c.metal[ti] = 0.85
    c.rough[ti] = 0.33 + 0.12 * tint[ti]
    # riveted seam at the titanium border
    add_line(c, c.s - 13.55, nac, 0.003, 0.0004, rivet_along=c.z * 1.0 + c.x)
    # ---- frames
    g_side = c.z
    g_top = c.ax
    for f in FRAMES:
        d = c.s - f
        near = np.abs(d) < 0.02
        if not near.any():
            continue
        if f in FULL:
            m = near & (fus | body | nac | boom)
        elif FRAMES.index(f) % 2:
            m = near & side & (fus | nac)
        else:
            m = near & (top | side) & (fus | body)
        along = np.where(side, g_side, g_top)
        add_line(c, d, m, rivet_along=along)
    # ---- longitudinal seams
    LONG = [('z', 0.52, 1.93, 3.0, side & fus), ('z', 0.05, 1.93, 5.6, side & fus), ('x', 0.24, 6.35, 13.45, top & fus),
            ('x', 1.20, 6.8, 14.25, top & body), ('x', 1.55, 8.0, 12.65, bot & body), ('z', -0.44, 5.6, 13.45, side & nac),
            ('x', 0.62, 6.35, 13.45, bot & nac), ('x', 1.15, 6.35, 13.45, bot & nac), ('z', 0.10, 11.05, 15.3, side & boom)]
    for (ax, v, s0, s1, m0) in LONG:
        coord = c.ax if ax == 'x' else c.z
        d = coord - v
        m = m0 & (np.abs(d) < 0.02) & (c.s > s0) & (c.s < s1)
        add_line(c, d, m, rivet_along=c.s)
    # ---- access panels (random but symmetric)
    rng = np.random.default_rng(303)
    zones = [  # cls, objs, g-name, g range, s range, count
        (side, fus, 'z', (0.0, 0.62), (1.95, 3.0), 2),
        (side, fus, 'z', (-0.25, 0.25), (3.0, 5.6), 3),
        (top, fus, 'x', (0.05, 0.45), (6.35, 13.4), 7),
        (side, fus, 'z', (0.4, 0.8), (6.35, 12.6), 4),
        (top, body, 'x', (0.72, 1.62), (6.0, 14.2), 9),
        (bot, body, 'x', (1.45, 1.78), (7.9, 12.6), 3),
        (side, nac, 'z', (-0.72, -0.12), (5.7, 13.4), 8),
        (bot, nac, 'x', (0.62, 1.30), (6.4, 13.4), 7),
        (bot, fus, 'x', (0.0, 0.35), (2.0, 5.5), 3),
        (side, boom, 'z', (-0.15, 0.25), (11.2, 15.2), 3),
        (top, boom, 'x', (1.60, 1.88), (11.2, 15.2), 2),
    ]
    for cls, om, gname, (g0, g1), (sa, sb), cnt in zones:
        g = c.z if gname == 'z' else c.ax
        m0 = cls & om
        for k in range(cnt):
            L = rng.uniform(0.28, 0.85)
            s0 = rng.uniform(sa, max(sa, sb - L))
            gw = rng.uniform(0.15, max(0.16, (g1 - g0) * 0.8))
            ga = rng.uniform(g0, max(g0, g1 - gw))
            tone = rng.uniform(-0.035, 0.035)
            touch = None
            if rng.random() < 0.22:
                touch = UP * rng.uniform(0.9, 1.08) * np.array([1.0, 1.0 + rng.uniform(-0.02, 0.02), 1.0 + rng.uniform(-0.02, 0.03)])
            rect(c, m0, s0, s0 + L, g, ga, ga + gw, tone=tone, touch=touch)
    # fuel filler, grounding points, small round access covers
    for (sx, sz, r) in ((7.2, 0.93, 0.07), (10.6, 0.80, 0.05), (4.1, -0.1, 0.05)):
        dd = np.sqrt((c.s - sx) ** 2 + (c.ax * 0 + (c.z - sz)) ** 2 + np.minimum(c.ax, 0.0) ** 2)
        if sz > 0.5:
            dd = np.sqrt((c.s - sx) ** 2 + (c.ax - 0.12) ** 2)
        m = fus & (np.abs(dd - r) < 0.02)
        add_line(c, dd - r, m, 0.0025, 0.0004, rivets=False)
    # ---- decals
    for sd in (1, -1):
        decal(c, DC.roundel(), (sd * 0.62, A.Y(3.72), 0.26), (sd, 0, 0), (0, 0, 1), 0.60, 0.60, ['Fuselage'])
        text_decal(c, '817', (sd * 1.44, A.Y(6.55), -0.42), (sd, 0, 0), (0, 0, 1), 0.40, ['Nacelle'])
        decal(c, DC.ejection_triangle(), (sd * 0.60, A.Y(4.62), 0.63), (sd, 0, 0), (0, 0, 1), 0.15, 0.15, ['Fuselage'])
        decal(c, DC.rescue_arrow(), (sd * 0.61, A.Y(5.05), 0.48), (sd, 0, 0), (0, 0, 1), 0.36, 0.12, ['Fuselage'])
        decal(c, DC.intake_warning(), (sd * 1.40, A.Y(5.42), -0.25), (sd, 0, 0.2), (0, 0, 1), 0.26, 0.26, ['Nacelle'])
        text_decal(c, 'INDIAN NAVY', (sd * 0.56, A.Y(8.6), 0.55), (sd, 0, 0.6), (0, 0, 1), 0.09, ['Fuselage'])
        # small stencils
        spots = [((sd * 0.58, A.Y(2.4), 0.12), (sd, 0, 0)), ((sd * 0.61, A.Y(6.9), 0.45), (sd, 0, 0)),
                 ((sd * 1.45, A.Y(8.3), -0.55), (sd, 0, 0)), ((sd * 1.42, A.Y(11.5), -0.35), (sd, 0, 0)),
                 ((sd * 1.2, A.Y(9.8), 0.25), (0, 0, 1)), ((sd * 0.5, A.Y(11.2), 0.62), (sd, 0, 1)),
                 ((sd * 1.0, A.Y(10.8), -0.88), (0, 0, -1)), ((sd * 1.93, A.Y(13.2), 0.05), (sd, 0, 0))]
        texts = [['FUEL 5000 L', 'T-6 / TS-1'], ['OXYGEN'], ['HYDRAULIC', 'AMG-10'], ['GROUND HERE'], ['NO STEP'], ['EARTH'],
                 ['JACK POINT'], ['NO PUSH']]
        for (pt, nn), tx in zip(spots, texts):
            stencil(c, tx, pt, nn, (0, 1, 0) if abs(nn[2]) > 0.9 else (0, 0, 1), 0.035 * len(tx) + 0.02)
    # ---- soot / stains
    gun = np.exp(-np.maximum(c.s - 5.30, 0) / 0.9) * np.exp(-((c.x + 0.92) / 0.22) ** 2 - ((c.z - 0.26) / 0.20) ** 2)
    gun *= (c.s > 5.2) * (0.6 + 0.4 * fbm(c.p, (8, 8, 8), 2, seed=12))
    soot(c, 0.85 * gun)
    exh = smoothstep(13.8, 15.4, c.s) * (fus | boom | nac) * (0.4 + 0.6 * fbm(c.p, (3, 12, 12), 3, seed=13))
    soot(c, 0.45 * exh * (1 - 0.5 * ti))
    # intake lip wear
    lip = nac & (c.s < 5.5) & (c.n[:, 1] > 0.4)
    c.col[lip] *= 0.92
    weather(c, 1.0)
    # airbrake edge line
    add_line(c, c.ax - 0.28, abk, 0.004)


# ------------------------------------------------------------------ group B: wings / tails
def fin_local(c, sd):
    s6, c6 = math.sin(A.CANT), math.cos(A.CANT)
    X = c.x * sd
    h = (X - A.FIN_X) * s6 + (c.z - A.FIN_Z) * c6
    return h


def paint_B(c):
    side, top, bot = face_classes(c)
    base_paint(c)
    wing = objmask(c, ['Wing', 'Slat', 'Flap', 'Aileron'])
    stab = objmask(c, ['Stabilator'])
    fin = objmask(c, ['Fin_', 'Rudder'])
    pyl = objmask(c, ['Pylons'])
    # --- wing coordinates
    w = c.ax
    le = 7.78 + (w - 1.76) * A.TAN_LE
    te = 12.68 - (w - 1.76) * 0.025
    cf = (c.s - le) / (te - le)
    horiz = wing & (np.abs(c.n[:, 2]) > 0.3)
    for f in (0.30, 0.55):
        m = horiz & (np.abs(cf - f) * (te - le) < 0.02) & (w > 1.9) & (w < 5.85)
        add_line(c, (cf - f) * (te - le), m, rivet_along=w)
    for r in (2.35, 2.85, 3.35, 4.35, 4.85, 5.35):
        m = horiz & (np.abs(w - r) < 0.02) & (cf > 0.14) & (cf < 0.76)
        add_line(c, w - r, m, rivet_along=c.s)
    rng = np.random.default_rng(29)
    for k in range(10):
        wa = rng.uniform(2.0, 5.3)
        ww = rng.uniform(0.18, 0.4)
        ca = rng.uniform(0.2, 0.55)
        cw = rng.uniform(0.08, 0.18)
        cls = bot if k % 3 else top
        # rect in (s, w) coords with s-bounds from chord fractions at wa
        lea = 7.78 + (wa - 1.76) * A.TAN_LE
        tea = 12.68 - (wa - 1.76) * 0.025
        rect(c, cls & wing, lea + ca * (tea - lea), lea + (ca + cw) * (tea - lea), w, wa, wa + ww, tone=rng.uniform(-0.03, 0.03))
    # leading edge erosion on wings/slats
    lef = (wing | stab | fin) & (c.n[:, 1] > 0.6)
    er = fbm(c.p, (25, 25, 25), 3, seed=21)
    ero = lef & (er > 0.6)
    c.col[ero] = c.col[ero] * 1.05
    c.rough[ero] -= 0.06
    # fold warning stripes + wing roundels + NO STEP
    stripes = DC.fold_stripes()
    for sd in (1, -1):
        l2, t2 = A.wing_plan(3.86)
        mids = l2 + 0.45 * (t2 - l2)
        for off in (-0.07, 0.07):
            decal(c, stripes, (sd * (3.86 + off), A.Y(mids), A.wing_z(3.86) + 0.08), (0, 0, 1), (1, 0, 0), 0.6 * (t2 - l2), 0.05,
                  ['Wing'], depth=0.25)
        l4, t4 = A.wing_plan(4.9)
        zc = A.wing_z(4.9)
        decal(c, DC.roundel(), (sd * 4.9, A.Y(l4 + 0.48 * (t4 - l4)), zc + 0.05), (0, 0, 1), (0, 1, 0), 0.72, 0.72, ['Wing', 'Slat', 'Aileron'], depth=0.25)
        decal(c, DC.roundel(), (sd * 4.9, A.Y(l4 + 0.48 * (t4 - l4)), zc - 0.05), (0, 0, -1), (0, 1, 0), 0.72, 0.72, ['Wing', 'Slat', 'Aileron'], depth=0.25)
        l3, t3 = A.wing_plan(2.6)
        stencil(c, ['NO STEP'], (sd * 2.6, A.Y(l3 + 0.6 * (t3 - l3)), A.wing_z(2.6) + 0.06), (0, 0, 1), (sd * 1.0, 0, 0), 0.05)
    # --- stabilators
    sw = c.ax
    sle = 13.30 + (sw - 1.75) * math.tan(50 * math.pi / 180)
    ste = 15.62 + (sw - 1.75) * 0.52
    scf = (c.s - sle) / (ste - sle)
    hs = stab & (np.abs(c.n[:, 2]) > 0.3)
    for f in (0.25, 0.62):
        m = hs & (np.abs(scf - f) * (ste - sle) < 0.02)
        add_line(c, (scf - f) * (ste - sle), m, rivet_along=sw)
    for r in (2.45, 3.15):
        m = hs & (np.abs(sw - r) < 0.02)
        add_line(c, sw - r, m, rivet_along=c.s)
    # --- fins
    for sd in (1, -1):
        fm = fin & (np.sign(c.x) == sd)
        h = fin_local(c, sd)
        fle = 12.40 + h * math.tan(47.5 * math.pi / 180)
        fte = 15.25 + h * 0.03
        fcf = (c.s - fle) / (fte - fle)
        for r in (0.55, 1.05, 1.55):
            m = fm & (np.abs(h - r) < 0.02) & (fcf < 0.74)
            add_line(c, h - r, m, rivet_along=c.s)
        for f in (0.18, 0.45):
            m = fm & (np.abs((fcf - f) * (fte - fle)) < 0.02) & (h > 0.05) & (h < 1.82)
            add_line(c, (fcf - f) * (fte - fle), m, rivet_along=h)
        # dielectric tip and RWR fairing
        tip = fm & (h > 1.82)
        soft = smoothstep(1.815, 1.83, h)
        patch(c, tip, DIEL, rough=0.6, soft=soft)
        add_line(c, h - 1.82, fm & (np.abs(h - 1.82) < 0.02), 0.003, 0.0004, rivets=False)
        # decals — outer face: roundel + NAVY; inner face: panther badge
        xf = A.fin_xform(sd)
        outn = (sd * math.cos(A.CANT), 0, -math.sin(A.CANT))
        inn = tuple(-v for v in outn)
        upv = (sd * math.sin(A.CANT), 0, math.cos(A.CANT))

        def fpt(hh, cfv):
            l_, t_ = A.fin_plan(hh)
            return xf(hh, l_ + cfv * (t_ - l_), 0)
        decal(c, DC.roundel(), fpt(1.08, 0.40), outn, upv, 0.56, 0.56, ['Fin_'], depth=0.2)
        text_decal(c, 'NAVY', fpt(0.42, 0.42), outn, upv, 0.17, ['Fin_', 'Rudder'], depth=0.2)
        decal(c, DC.panther_badge(), fpt(1.12, 0.40), inn, upv, 0.52, 0.52, ['Fin_'], depth=0.2)
        stencil(c, ['817'], fpt(1.70, 0.55), outn, upv, 0.06, ['Fin_'])
    # pylons slightly different grey
    c.col[pyl] *= 0.97
    weather(c, 0.8)


# ------------------------------------------------------------------ output
def finish(c, g):
    H, W = c.shape
    # tangent-space normal from height map
    Hm = np.zeros(H * W, np.float32)
    Hm[c.idx] = c.h
    Hm = Hm.reshape(H, W)
    TS = np.full(H * W, c.tsm, np.float32)
    TS[c.idx] = c.ts
    TS = TS.reshape(H, W)
    gx = (np.roll(Hm, -1, 1) - np.roll(Hm, 1, 1)) / (2 * TS)
    gy = (np.roll(Hm, -1, 0) - np.roll(Hm, 1, 0)) / (2 * TS)  # row index increases with v (bpy order)
    nrm = np.stack([-gx, -gy, np.ones_like(gx)], -1)
    nrm /= np.linalg.norm(nrm, axis=2, keepdims=True)
    # composite maps
    def full(vals, ch):
        a = np.zeros((H * W, ch), np.float32)
        a[c.idx] = vals.reshape(len(c.idx), ch)
        return a.reshape(H, W, ch)
    col = full(lin2srgb(c.col), 3)
    orm = full(np.stack([0.35 + 0.65 * c.ao, np.clip(c.rough, 0.08, 1), np.clip(c.metal, 0, 1)], 1), 3)
    # dilate into empty texels
    inv = ~c.mask
    _, (iy, ix) = ndimage.distance_transform_edt(inv, return_indices=True)
    col = col[iy, ix]
    orm = orm[iy, ix]
    nrm[inv] = nrm[iy, ix][inv]
    for arr, name, q in ((col, 'base', 'jpg'), (orm, 'orm', 'jpg'), (nrm * 0.5 + 0.5, 'normal', 'png')):
        im = Image.fromarray((np.flipud(np.clip(arr, 0, 1)) * 255 + 0.5).astype(np.uint8))
        if q == 'jpg':
            im.save(OUT + 'tex_%s_%s.jpg' % (g, name), quality=93, subsampling=0)
        else:
            im.save(OUT + 'tex_%s_%s.png' % (g, name), optimize=False, compress_level=6)
    print('saved', g)


if __name__ == '__main__':
    for g in GROUPS:
        t = time.time()
        c = load(g)
        (paint_A if g == 'SkinA' else paint_B)(c)
        finish(c, g)
        print(g, 'done %.1fs' % (time.time() - t))
