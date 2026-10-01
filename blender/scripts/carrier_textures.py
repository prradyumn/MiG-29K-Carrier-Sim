"""Texture painter for the detailed carrier (numpy + PIL, no Blender needed).
Writes sim/model/carrier/: deck_macro.jpg (2048x8192, markings + wear, mapped like the physics deck:
u = (x+34)/68, v = (z+145)/290 in ship-local metres), deck_grit.jpg / deck_grit_n.jpg (tiling non-skid),
hull.jpg (4096x1024: starboard side top half, port side bottom half), paint.jpg / paint_n.jpg (tiling weathered grey).
usage: python carrier_textures.py"""
import os, math, numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'sim', 'model', 'carrier')
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(1971)
D2R = math.pi / 180

# ship geometry (mirrors sim/world.js SHIP)
XMAX = [(-142, 7), (-128, 13), (-100, 18), (-60, 22), (-20, 24), (40, 25), (100, 23), (130, 20), (142, 14)]
XMIN = [(-142, -7), (-128, -12), (-100, -15), (-60, -17), (-10, -22), (20, -30), (60, -33), (100, -31), (130, -24), (142, -16)]
def tab(t, z):
    if z <= t[0][0]: return t[0][1]
    for (a, b), (c, d) in zip(t, t[1:]):
        if z <= c: return b + (d - b) * (z - a) / (c - a)
    return t[-1][1]
ANG = 6 * D2R; LA = (0.0, 139.0); WIRES = [38, 50, 62]; START = [(3, 53), (3, -37)]
ca, sa = math.cos(ANG), math.sin(ANG)
LX = lambda t: LA[0] - sa * t; LZ = lambda t: LA[1] - ca * t

def fbm(h, w, octaves=6, base=4, seed=0, persist=0.55):
    """smooth value-noise fbm in [0,1] at the given resolution."""
    r = np.random.default_rng(seed); out = np.zeros((h, w), np.float32); amp, tot = 1.0, 0.0
    for o in range(octaves):
        gh, gw = max(2, int(base * 2 ** o * h / max(h, w)) + 2), max(2, int(base * 2 ** o * w / max(h, w)) + 2)
        g = r.random((gh, gw)).astype(np.float32)
        im = Image.fromarray((g * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
        out += np.asarray(im, np.float32) / 255 * amp; tot += amp; amp *= persist
    return out / tot

# ================================================================ DECK
W, H = 2048, 8192
PX = W / 68.0                                    # pixels per metre across (30.1); along: H / 290 = 28.2
X = lambda x: (x + 34) / 68 * W
Z = lambda z: (z + 145) / 290 * H
print('deck: base')
lo = fbm(H // 8, W // 8, 5, 3, seed=1); lo = np.asarray(Image.fromarray((lo * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC), np.float32) / 255
mid = fbm(H // 2, W // 2, 4, 40, seed=2); mid = np.asarray(Image.fromarray((mid * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC), np.float32) / 255
base = 0.30 + 0.07 * (lo - 0.5) + 0.04 * (mid - 0.5)
deck = np.stack([base * 0.93, base * 0.96, base * 1.02], -1)
# deck plate joints: a faint grid of welded panels
img = Image.fromarray(np.clip(deck * 255, 0, 255).astype(np.uint8))
d = ImageDraw.Draw(img, 'RGBA')
for z in np.arange(-142, 142, 6.1):
    d.line([(0, Z(z)), (W, Z(z))], fill=(30, 32, 36, 60), width=2)
for x in np.arange(-34, 34, 3.05):
    d.line([(X(x), 0), (X(x), H)], fill=(30, 32, 36, 40), width=1)
# tie-down points: a grid of small dark rings in the parking areas
for z in np.arange(-130, 140, 4.6):
    for x in np.arange(-30, 25, 4.6):
        if not (tab(XMIN, z) + 1 < x < tab(XMAX, z) - 1): continue
        cx, cy = X(x), Z(z); r = 0.16 * PX
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(24, 25, 27, 150), width=2)

def stain(cx, cz, rx, rz, col, alpha, n=1):
    for _ in range(n):
        ox, oz = rng.normal(0, rx * 0.25), rng.normal(0, rz * 0.25)
        br = max(2, rx * PX * 0.35); pad = int(br * 3) + 4      # pad the layer so the blur never reaches its edge
        lay = Image.new('L', (int(rx * 2 * PX) + 2 * pad, int(rz * 2 * PX) + 2 * pad), 0)
        ImageDraw.Draw(lay).ellipse([pad, pad, lay.width - pad, lay.height - pad], fill=int(255 * alpha))
        lay = lay.filter(ImageFilter.GaussianBlur(br))
        colim = Image.new('RGB', lay.size, col)
        img.paste(colim, (int(X(cx + ox) - lay.width / 2), int(Z(cz + oz) - lay.height / 2)), lay)
print('deck: stains and scorch')
for sx, sz in START:                                         # exhaust scorch behind the launch spots, on the deflector line
    stain(sx, sz + 13, 6, 12, (18, 17, 16), 0.65, 3)
    stain(sx, sz + 3, 4, 4, (30, 28, 25), 0.4, 2)
for _ in range(70):                                          # fuel / hydraulic drips in the parking area (starboard aft)
    stain(rng.uniform(10, 22), rng.uniform(40, 135), rng.uniform(0.3, 1.2), rng.uniform(0.3, 1.0), (22, 21, 19), rng.uniform(0.2, 0.5))
for _ in range(40):
    stain(rng.uniform(-28, 22), rng.uniform(-120, 135), rng.uniform(0.4, 2.0), rng.uniform(0.4, 2.0), (34, 33, 31), rng.uniform(0.1, 0.3))
# tyre rubber in the landing area: dense near the wires, thinning forward
print('deck: tyre rubber')
tyre = Image.new('L', (W, H), 0); td = ImageDraw.Draw(tyre)
for _ in range(1400):
    t0 = rng.gamma(2.2, 18) + 10
    if t0 > 160: continue
    off = rng.normal(0, 2.6); L = rng.uniform(4, 22); a = int(np.clip(rng.normal(70, 35) * math.exp(-t0 / 90), 8, 160))
    for wo in (-1.56, 1.56):                                   # main gear track
        p0 = (X(LX(t0) + (off + wo) * ca), Z(LZ(t0) - (off + wo) * sa)); p1 = (X(LX(t0 + L) + (off + wo) * ca), Z(LZ(t0 + L) - (off + wo) * sa))
        td.line([p0, p1], fill=a, width=int(rng.uniform(0.16, 0.3) * PX))
tyre = tyre.filter(ImageFilter.GaussianBlur(1.6))
img.paste(Image.new('RGB', (W, H), (14, 14, 15)), (0, 0), tyre)
# wire hook scuffs (bright scrape marks just aft of each wire)
for t in WIRES:
    for _ in range(40):
        off = rng.normal(0, 1.8); L = rng.uniform(1, 5)
        d.line([(X(LX(t - L) + off * ca), Z(LZ(t - L) - off * sa)), (X(LX(t) + off * ca), Z(LZ(t) - off * sa))], fill=(120, 118, 112, 50), width=2)

print('deck: markings')
def mline(x0, z0, x1, z1, col, w, dash=None, wear=0.25):
    lay = Image.new('L', (W, H), 0); ld = ImageDraw.Draw(lay)
    if dash:
        L = math.hypot(x1 - x0, z1 - z0); n = int(L / (dash[0] + dash[1]))
        for k in range(n + 1):
            a = k * (dash[0] + dash[1]) / L; b = min(1, a + dash[0] / L)
            ld.line([(X(x0 + (x1 - x0) * a), Z(z0 + (z1 - z0) * a)), (X(x0 + (x1 - x0) * b), Z(z0 + (z1 - z0) * b))], fill=255, width=max(2, int(w * PX)))
    else:
        ld.line([(X(x0), Z(z0)), (X(x1), Z(z1))], fill=255, width=max(2, int(w * PX)))
    return lay, col, wear
marks = []
L_ = 178
for off in (-11, 11):                                       # landing area edge lines
    marks.append(mline(LX(0) + off * ca, LZ(0) - off * sa, LX(L_) + off * ca, LZ(L_) - off * sa, (222, 222, 214), 0.45))
marks.append(mline(LX(-2), LZ(-2), LX(L_), LZ(L_), (232, 232, 222), 0.4, dash=(6, 6)))
for t in range(0, L_, 3):                                   # red/white foul line, starboard edge of the landing area
    o = 12.6; marks.append(mline(LX(t) + o * ca, LZ(t) - o * sa, LX(t + 1.5) + o * ca, LZ(t + 1.5) - o * sa, (176, 40, 34) if t % 6 < 3 else (222, 222, 214), 0.42))
for t in WIRES:                                             # wire positions: a dashed band across the landing area
    marks.append(mline(LX(t) - 15 * ca, LZ(t) + 15 * sa, LX(t) + 15 * ca, LZ(t) - 15 * sa, (200, 200, 192), 0.15, dash=(1.0, 0.6), wear=0.4))
for sx, sz in START:                                        # take-off lanes and hold lines
    marks.append(mline(sx, sz + 8, sx, -141, (220, 178, 30), 0.4))
    marks.append(mline(sx - 5, sz, sx + 5, sz, (220, 178, 30), 0.5))
    for k in (-1, 1): marks.append(mline(sx + k * 6.5, sz + 6, sx + k * 6.5, -141, (210, 206, 196), 0.22, dash=(3, 3)))
for z in range(-140, 141, 2):                               # deck edge lines
    marks.append(mline(tab(XMAX, z) - 0.9, z, tab(XMAX, z + 2) - 0.9, z + 2, (206, 206, 198), 0.25))
    marks.append(mline(tab(XMIN, z) + 0.9, z, tab(XMIN, z + 2) + 0.9, z + 2, (206, 206, 198), 0.25))
# safe-walk lane along the island
marks.append(mline(12.5, -36, 12.5, 30, (220, 178, 30), 0.3, dash=(1.5, 1.0)))
for lay, col, wear in marks:
    if wear:
        wn = fbm(256, 64, 4, 20, seed=int(rng.integers(1e6))); wn = np.asarray(Image.fromarray((wn * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR), np.float32) / 255
        a = np.asarray(lay, np.float32) * np.clip((wn - wear * 0.6) * 3.0, 0.15, 1.0)
        lay = Image.fromarray(a.astype(np.uint8))
    img.paste(Image.new('RGB', (W, H), col), (0, 0), lay)
d = ImageDraw.Draw(img, 'RGBA')
try: font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', int(5 * PX))
except Exception: font = ImageFont.load_default()
for (sx, sz), lab in zip(START, ('2', '1')):
    d.text((X(sx - 8), Z(sz) - 2.5 * PX), lab, fill=(220, 178, 30, 230), font=font)
for i, z in enumerate((66, 88)):                            # helicopter spots
    cx, cy, r = X(15), Z(z), 5.5 * PX
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(225, 225, 216, 220), width=int(0.3 * PX))
    f2 = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', int(3.4 * PX)) if hasattr(font, 'path') else font
    d.text((cx - 1 * PX, cy - 1.8 * PX), str(i + 3), fill=(225, 225, 216, 220), font=f2)
for (ex, ez, ew, eh) in ((12, 40, 10, 17), (-8, 95, 16, 18)):  # elevator outlines
    d.rectangle([X(ex), Z(ez), X(ex + ew), Z(ez + eh)], outline=(150, 152, 150, 200), width=int(0.25 * PX))
# '33' on the ski-jump approach (rotated 180 to read from aft)
big = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', int(14 * PX)) if hasattr(font, 'path') else font
num = Image.new('L', (int(24 * PX), int(16 * PX)), 0); ImageDraw.Draw(num).text((0, 0), '33', fill=230, font=big)
num = num.rotate(180)
img.paste(Image.new('RGB', num.size, (232, 232, 224)), (int(X(-12)), int(Z(-86))), num)
for z in np.arange(-140, -98, 6):                            # ramp chevrons
    d.polygon([(X(-5), Z(z + 2)), (X(0), Z(z)), (X(5), Z(z + 2)), (X(5), Z(z + 2.6)), (X(0), Z(z + 0.6)), (X(-5), Z(z + 2.6))], fill=(212, 210, 200, 150))
img = img.filter(ImageFilter.GaussianBlur(0.4))
img.save(os.path.join(OUT, 'deck_macro.jpg'), quality=84, optimize=True)

# non-skid grit (tiles every 2 m in the sim): albedo variation + a normal map
print('deck: grit')
G = 512
grit = rng.random((G, G)).astype(np.float32)
grit = np.asarray(Image.fromarray((grit * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8)), np.float32) / 255
coarse = fbm(G, G, 3, 8, seed=9)
alb = np.clip(0.82 + 0.28 * (grit - 0.5) + 0.12 * (coarse - 0.5), 0, 1)
Image.fromarray((np.stack([alb] * 3, -1) * 255).astype(np.uint8)).save(os.path.join(OUT, 'deck_grit.jpg'), quality=86)
hgt = grit * 0.8 + coarse * 0.2
gx = np.roll(hgt, -1, 1) - np.roll(hgt, 1, 1); gy = np.roll(hgt, -1, 0) - np.roll(hgt, 1, 0)
n = np.stack([-gx * 6, -gy * 6, np.ones_like(gx)], -1); n /= np.linalg.norm(n, axis=-1, keepdims=True)
Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8)).save(os.path.join(OUT, 'deck_grit_n.jpg'), quality=88)

# ================================================================ HULL (u along the ship bow->stern, v = height)
print('hull')
HW, HH = 4096, 1024
def hull_side(starboard):
    h = HH // 2
    # v from top (y = 19 deck) to bottom (y = -11 keel): 30 m -> 512 px, 17 px/m; u: 290 m -> 4096 px, 14 px/m
    yv = lambda y: (19 - y) / 30 * h
    # text must read left-to-right from outboard: on starboard the bow is to the viewer's right, on port to the left
    uz = lambda z: (145 - z) / 290 * HW if starboard else (z + 145) / 290 * HW
    n1 = fbm(h, HW, 5, 6, seed=11 + starboard); n2 = fbm(h, HW, 4, 60, seed=21 + starboard)
    grey = 0.36 + 0.06 * (n1 - 0.5) + 0.03 * (n2 - 0.5)
    grey = grey * (1 - 0.18 * np.clip((np.arange(h)[:, None] - yv(12)) / (yv(1) - yv(12)), 0, 1))   # salt-darkened lower hull
    a = np.stack([grey * 0.92, grey * 0.97, grey * 1.02], -1)
    im = Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8)); dd = ImageDraw.Draw(im, 'RGBA')
    # boot-topping and red below the waterline
    dd.rectangle([0, yv(0.9), HW, yv(-0.7)], fill=(16, 16, 17, 255))
    dd.rectangle([0, yv(-0.7), HW, h], fill=(96, 32, 26, 255))
    for x in range(0, HW, 64): dd.line([(x, yv(19)), (x, yv(1))], fill=(70, 74, 78, 26), width=1)    # plating seams
    for y in (4, 8, 12.5, 16): dd.line([(0, yv(y)), (HW, yv(y))], fill=(70, 74, 78, 40), width=1)
    for row, y in enumerate((10.2, 14.0)):                     # portholes with rust weeping from each
        for z in np.arange(-110 + row * 3, 120, 6.5):
            if rng.random() < 0.2: continue
            cx, cy = uz(z), yv(y)
            dd.ellipse([cx - 4, cy - 4, cx + 4, cy + 4], fill=(22, 24, 26, 255))
            if rng.random() < 0.55:
                L = rng.uniform(20, 90); dd.line([(cx, cy + 4), (cx + rng.normal(0, 1.5), cy + 4 + L)], fill=(110, 62, 34, int(rng.uniform(40, 110))), width=int(rng.uniform(2, 5)))
    for _ in range(260):                                       # general rust streaks and salt bloom
        x = rng.uniform(0, HW); y0 = rng.uniform(yv(18.5), yv(4)); L = rng.uniform(15, 140)
        col = (112, 64, 36, int(rng.uniform(15, 70))) if rng.random() < 0.7 else (220, 222, 216, int(rng.uniform(15, 40)))
        dd.line([(x, y0), (x + rng.normal(0, 2), y0 + L)], fill=col, width=int(rng.uniform(2, 7)))
    for z in (-128,):                                          # hawse pipe and anchor with a long rust stain
        cx, cy = uz(z), yv(13)
        dd.ellipse([cx - 16, cy - 12, cx + 16, cy + 12], fill=(18, 18, 20, 255)); dd.line([(cx, cy + 12), (cx, yv(1))], fill=(104, 58, 32, 120), width=14)
    f = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', 150)
    txt = Image.new('L', (520, 190), 0); ImageDraw.Draw(txt).text((10, 10), 'R33', fill=235, font=f)
    im.paste(Image.new('RGB', txt.size, (234, 236, 232)), (int(uz(-108) - 260), int(yv(16.2))), txt)
    im = im.filter(ImageFilter.GaussianBlur(0.5))
    return im
hull = Image.new('RGB', (HW, HH)); hull.paste(hull_side(True), (0, 0)); hull.paste(hull_side(False), (0, HH // 2))
hull.save(os.path.join(OUT, 'hull.jpg'), quality=84, optimize=True)

# ================================================================ PAINT (tiles every 6 m: island, sponsons, equipment)
print('paint')
P = 1024
n1 = fbm(P, P, 6, 4, seed=31); n2 = fbm(P, P, 3, 40, seed=32)
g = 0.385 + 0.07 * (n1 - 0.5) + 0.035 * (n2 - 0.5)      # Navy haze grey is darker than it looks in photos
pm = Image.fromarray((np.stack([g * 0.93, g * 0.97, g * 1.02], -1) * 255).clip(0, 255).astype(np.uint8)); pd = ImageDraw.Draw(pm, 'RGBA')
for _ in range(90):
    x = rng.uniform(0, P); y = rng.uniform(0, P); L = rng.uniform(20, 220)
    pd.line([(x, y), (x + rng.normal(0, 1.5), y + L)], fill=(104, 64, 40, int(rng.uniform(12, 50))), width=int(rng.uniform(2, 6)))
for k in range(0, P, 128): pd.line([(0, k), (P, k)], fill=(60, 62, 66, 30), width=2); pd.line([(k, 0), (k, P)], fill=(60, 62, 66, 22), width=2)
pm = pm.filter(ImageFilter.GaussianBlur(0.6))
# make it tile: blend with a half-offset copy across the seams
a = np.asarray(pm, np.float32); b = np.roll(np.roll(a, P // 2, 0), P // 2, 1)
w = np.minimum(np.minimum(np.arange(P), P - 1 - np.arange(P)) / (P * 0.2), 1)[:, None]; w = np.minimum(w, w.T)[..., None]
Image.fromarray((a * w + b * (1 - w)).astype(np.uint8)).save(os.path.join(OUT, 'paint.jpg'), quality=85)
hp = n2 * 0.6 + n1 * 0.4
gx = np.roll(hp, -1, 1) - np.roll(hp, 1, 1); gy = np.roll(hp, -1, 0) - np.roll(hp, 1, 0)
nn = np.stack([-gx * 10, -gy * 10, np.ones_like(gx)], -1); nn /= np.linalg.norm(nn, axis=-1, keepdims=True)
Image.fromarray(((nn * 0.5 + 0.5) * 255).astype(np.uint8)).save(os.path.join(OUT, 'paint_n.jpg'), quality=86)
for f in sorted(os.listdir(OUT)): print(f, os.path.getsize(os.path.join(OUT, f)) // 1024, 'KB')
