"""Turn the Gemini photo textures (glacier/build/gem/*.png) into the terrain's albedo + normal layers:
seamless by offset blending, mean brightness matched to the Blender-baked albedo of the same material (keeps the
calibrated albedo), and a normal map derived from the photo (luminance as height), blended 70/30 with the Blender
normal. Writes sim/model/glacier/tex/<name>_albedo.jpg and _normal.jpg (roughness stays the Blender bake)."""
import pathlib, numpy as np
from PIL import Image
from scipy import ndimage
ROOT = pathlib.Path(__file__).resolve().parents[2]; GEM = ROOT / 'glacier' / 'build' / 'gem'; TEX = ROOT / 'sim' / 'model' / 'glacier' / 'tex'
S = 1024
def seamless(a):
    r = np.roll(np.roll(a, S // 2, 0), S // 2, 1)
    x = np.linspace(0, 1, S); w = np.clip(np.minimum(x, 1 - x) / 0.32, 0, 1); w = w * w * (3 - 2 * w)
    m = (w[:, None] * w[None, :])[..., None]
    return a * m + r * (1 - m)
def lin(c): return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def srgb(c): return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.clip(c, 0, None), 1 / 2.4) - 0.055)
for n, nk in (('rock', 2.2), ('snow', 0.8), ('ice', 0.8), ('debris', 2.6), ('gravel', 2.0)):
    a = np.asarray(Image.open(GEM / f'{n}.png').convert('RGB').resize((S, S), Image.LANCZOS)).astype(np.float64) / 255
    a = seamless(a)
    ref = np.asarray(Image.open(TEX / f'{n}_albedo.jpg').convert('RGB')).astype(np.float64) / 255
    la, lr = lin(a).mean(), lin(ref).mean()
    out = srgb(np.clip(lin(a) * (lr / la), 0, 1))
    # normal from the photo: high-passed luminance as height
    lum = (a * [0.2126, 0.7152, 0.0722]).sum(2)
    hgt = lum - ndimage.gaussian_filter(lum, 24, mode='wrap')
    gx = ndimage.sobel(hgt, 1, mode='wrap'); gy = ndimage.sobel(hgt, 0, mode='wrap')
    nrm = np.dstack([-gx * nk, gy * nk, np.ones_like(gx)]); nrm /= np.linalg.norm(nrm, axis=2, keepdims=True)
    bl = np.asarray(Image.open(TEX / f'{n}_normal.jpg').convert('RGB')).astype(np.float64) / 255 * 2 - 1
    nn = nrm * 0.7 + bl * 0.3; nn /= np.linalg.norm(nn, axis=2, keepdims=True)
    Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8)).save(TEX / f'{n}_albedo.jpg', quality=92)
    Image.fromarray(((nn * 0.5 + 0.5) * 255).astype(np.uint8)).save(TEX / f'{n}_normal.jpg', quality=92)
    print(n, f'albedo mean {lr:.3f} (linear) kept')
