"""Siachen / Nubra terrain for the sim, from Copernicus GLO-30 (30 m DSM, public, AWS open data).

Output (sim/model/glacier/):
  height.png   16-bit height packed in R (high byte) and G (low byte): h = (R*256+G)/65535 * HSPAN + HMIN
  mask.png     R glacier ice, G snow cover, B debris / moraine, A river and gravel bars (0..255 weights)
  meta.json    grid size, cell size, world extents, origin, height range, runway geometry
and glacier/build/ (for Blender): mesh_h.npy (coarse heights), meta.json.

World frame (as the sim): x east, y up (metres above sea level), z south; origin at the map centre.
Usage: python dem.py
"""
import json, math, pathlib
import numpy as np
import rasterio
from rasterio.merge import merge
from scipy import ndimage
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
DEM = ROOT / 'glacier' / 'dem'; BUILD = ROOT / 'glacier' / 'build'; OUT = ROOT / 'sim' / 'model' / 'glacier'
BUILD.mkdir(parents=True, exist_ok=True); OUT.mkdir(parents=True, exist_ok=True)

LON0, LON1, LAT0, LAT1 = 76.65, 77.55, 34.58, 35.72
LATC, LONC = (LAT0 + LAT1) / 2, (LON0 + LON1) / 2
MX = 111320.0 * math.cos(math.radians(LATC))     # metres per degree of longitude at the map centre
MZ = 110574.0                                     # metres per degree of latitude
CELL = 30.0
W = int(round((LON1 - LON0) * MX / CELL)); H = int(round((LAT1 - LAT0) * MZ / CELL))
X0, Z0 = -W * CELL / 2, -H * CELL / 2             # world x of column 0, world z of row 0 (north edge)

def world(lat, lon):
    return (lon - LONC) * MX, -(lat - LATC) * MZ

# ---------------------------------------------------------------- mosaic and resample onto the world grid
srcs = [rasterio.open(p) for p in sorted(DEM.glob('*.tif'))]
mos, tr = merge(srcs, bounds=(LON0 - 0.01, LAT0 - 0.01, LON1 + 0.01, LAT1 + 0.01))
mos = mos[0].astype(np.float64)
print('mosaic', mos.shape, 'range', np.nanmin(mos), np.nanmax(mos))
xs = X0 + (np.arange(W) + 0.5) * CELL; zs = Z0 + (np.arange(H) + 0.5) * CELL
lon = LONC + xs / MX; lat = LATC - zs / MZ
col = (lon - tr.c) / tr.a - 0.5; row = (lat - tr.f) / tr.e - 0.5
R, C = np.meshgrid(row, col, indexing='ij')
h = ndimage.map_coordinates(mos, [R, C], order=1, mode='nearest').astype(np.float64)
print('grid', W, 'x', H, 'cells', f'{W * CELL / 1000:.1f} x {H * CELL / 1000:.1f} km', 'h', h.min(), h.max())

# ---------------------------------------------------------------- Thoise runway 10/28: a flat, graded strip
T10, T28 = world(34.6566, 77.3598), world(34.6486, 77.3917)
rx0, rz0 = T10; rx1, rz1 = T28
rlen = math.hypot(rx1 - rx0, rz1 - rz0); ux, uz = (rx1 - rx0) / rlen, (rz1 - rz0) / rlen
X, Z = np.meshgrid(xs, zs)
along = (X - rx0) * ux + (Z - rz0) * uz; side = -(X - rx0) * uz + (Z - rz0) * ux
def hat(x, z):
    i = int((z - Z0) / CELL); j = int((x - X0) / CELL); return float(np.median(h[i - 3:i + 4, j - 3:j + 4]))
e10, e28 = hat(rx0, rz0), hat(rx1, rz1)
ext = 400.0                                       # overruns / stopways at each end
prof = e10 + (e28 - e10) * np.clip(along / rlen, 0, 1)
# the whole airfield platform: runway, parallel taxiway and apron (south side) plus the base, graded flat
# side > 0 is south of the runway (the taxiway, apron and base); side < 0 north
inside = np.clip(1 - np.maximum(np.where(side > 0, side - 520, -side - 200), 0) / 650, 0, 1) * np.clip(1 - np.maximum(np.maximum(-along, along - rlen) - ext, 0) / 700, 0, 1)
inside = inside * inside * (3 - 2 * inside)
h = h * (1 - inside) + prof * inside
rmid = ((rx0 + rx1) / 2, (rz0 + rz1) / 2)
hdg = (math.degrees(math.atan2(ux, -uz)) + 360) % 360
print(f'runway {rlen:.0f} m, true heading {hdg:.1f}, thresholds {e10:.0f} / {e28:.0f} m')

# ---------------------------------------------------------------- terrain classes from the elevation itself
gy, gx = np.gradient(h, CELL)
slope = np.degrees(np.arctan(np.hypot(gx, gy)))
relief = h - ndimage.gaussian_filter(h, 50)       # vs the ~1.5 km neighbourhood: valley floors negative
# glacier ice: gentle, high, in the valleys (Siachen and its tributaries; surface slope only a few degrees)
ice = np.clip((h - 3900) / 300, 0, 1) * np.clip((16 - slope) / 6, 0, 1) * np.clip((-relief + 40) / 120, 0, 1)
ice = ndimage.gaussian_filter(ice, 1.2)
# snow: permanent above ~5300 m except on cliffs, seasonal patches lower on gentle north-facing slopes
north = np.clip(-gy / (np.hypot(gx, gy) + 1e-6), -1, 1)   # gy > 0 means the ground rises southwards (row grows south)
snowline = 5300 - 380 * north
snow = np.clip((h - snowline) / 700, 0, 1) ** 0.8 * np.clip((52 - slope) / 18, 0, 1)
snow = np.maximum(snow, ice * 0.55)
snow = ndimage.gaussian_filter(snow, 2.0)
# debris cover: the lower Siachen and the glacier margins carry rock (dark medial / lateral moraines)
debris = np.clip((4500 - h) / 500, 0, 1) * ice + np.clip(ndimage.gaussian_gradient_magnitude(ice, 2) * 6, 0, 1) * (ice > 0.05)
debris = np.clip(ndimage.gaussian_filter(debris, 1.0), 0, 1)
# river and gravel bars: flat valley floor of the Nubra and Siachen rivers below the snout
river = np.clip((3500 - h) / 250, 0, 1) * np.clip((4 - slope) / 3, 0, 1) * np.clip((-relief - 20) / 60, 0, 1) * (1 - inside)
river = ndimage.gaussian_filter(river, 1.0)

def u8(a): return (np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)
Image.fromarray(np.dstack([u8(ice), u8(snow), u8(debris), u8(river)]), 'RGBA').save(OUT / 'mask.png', optimize=True)

HMIN, HMAX = math.floor(h.min() - 10), math.ceil(h.max() + 10)
q = np.round((h - HMIN) / (HMAX - HMIN) * 65535).astype(np.uint32)
rgb = np.dstack([(q >> 8).astype(np.uint8), (q & 255).astype(np.uint8), np.zeros_like(q, dtype=np.uint8)])
Image.fromarray(rgb, 'RGB').save(OUT / 'height.png', optimize=True)

meta = dict(W=W, H=H, cell=CELL, x0=X0, z0=Z0, hmin=HMIN, hmax=HMAX, latc=LATC, lonc=LONC, mx=MX, mz=MZ,
            bounds=[LON0, LON1, LAT0, LAT1], source='Copernicus GLO-30 DSM (ESA, public)',
            runway=dict(name='Thoise 10/28', t10=list(T10), t28=list(T28), e10=e10, e28=e28, len=rlen, width=44.0, hdg=hdg, mid=list(rmid)),
            snout=list(world(35.1986, 77.2014)), head=list(world(35.6644, 76.7978)))
json.dump(meta, open(OUT / 'meta.json', 'w'), indent=1)
# coarse grid for Blender (90 m) and the masks at the same scale
step = 3
np.save(BUILD / 'mesh_h.npy', h[::step, ::step].astype(np.float32))
np.save(BUILD / 'mesh_mask.npy', np.dstack([ice, snow, debris, river])[::step, ::step].astype(np.float32))
json.dump({**meta, 'mesh_step': step}, open(BUILD / 'meta.json', 'w'), indent=1)
for f in ('height.png', 'mask.png'):
    print(f, (OUT / f).stat().st_size // 1024, 'KB')
print(f'height {HMIN}..{HMAX} m; ice {ice.mean() * 100:.1f}%  snow {snow.mean() * 100:.1f}%  debris {debris.mean() * 100:.1f}%  river {river.mean() * 100:.1f}%')
