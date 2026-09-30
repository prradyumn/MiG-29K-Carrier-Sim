"""Generate decal RGBA images (numpy float arrays, linear-ish sRGB values 0-1) with PIL."""
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

FB = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
FBC = '/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf'
FR = '/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed.ttf'
SAFFRON = (255, 128, 30)
GREEN = (19, 120, 20)
WHITE = (240, 240, 236)
BLACK = (22, 22, 24)


def to_arr(im):
    a = np.asarray(im.convert('RGBA')).astype(np.float32) / 255.0
    return a


def roundel(px=1024):
    ss = 2
    n = px * ss
    im = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = n / 2
    for r, col in ((0.5, SAFFRON), (0.5 * 2 / 3, WHITE), (0.5 / 3, GREEN)):
        rr = r * n
        d.ellipse([c - rr, c - rr, c + rr, c + rr], fill=col + (255,))
    return to_arr(im.resize((px, px), Image.LANCZOS))


def text_img(txt, h_px=256, font=FBC, color=BLACK, pad=8, spacing=1.0):
    f = ImageFont.truetype(font, h_px)
    bbox = f.getbbox(txt)
    w = bbox[2] - bbox[0] + 2 * pad
    h = bbox[3] - bbox[1] + 2 * pad
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.text((pad - bbox[0], pad - bbox[1]), txt, font=f, fill=color + (255,))
    return to_arr(im)


def stencil_block(lines, h_px=40, color=(40, 40, 42), font=FR):
    f = ImageFont.truetype(font, h_px)
    ws = [f.getbbox(l)[2] for l in lines]
    W = max(ws) + 10
    H = int(len(lines) * h_px * 1.25) + 10
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for i, l in enumerate(lines):
        d.text((5, 5 + i * h_px * 1.25), l, font=f, fill=color + (235,))
    return to_arr(im)


def ejection_triangle(px=512):
    im = Image.new('RGBA', (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    m = px * 0.04
    tri = [(px / 2, m), (px - m, px - m), (m, px - m)]
    d.polygon(tri, fill=(210, 30, 30, 255))
    m2 = px * 0.16
    tri2 = [(px / 2, m2 + px * 0.06), (px - m2, px - m2 * 0.75), (m2, px - m2 * 0.75)]
    d.polygon(tri2, fill=(245, 245, 240, 255))
    f = ImageFont.truetype(FBC, int(px * 0.09))
    for i, l in enumerate(('DANGER', 'EJECTION', 'SEAT')):
        bb = f.getbbox(l)
        d.text((px / 2 - (bb[2] - bb[0]) / 2, px * 0.47 + i * px * 0.11), l, font=f, fill=(200, 20, 20, 255))
    return to_arr(im)


def rescue_arrow(px=768):
    W, H = px, px // 3
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    col = (225, 150, 20, 255)
    d.polygon([(0, H * 0.35), (W * 0.72, H * 0.35), (W * 0.72, H * 0.1), (W, H * 0.5), (W * 0.72, H * 0.9), (W * 0.72, H * 0.65), (0, H * 0.65)], fill=col)
    f = ImageFont.truetype(FBC, int(H * 0.22))
    d.text((W * 0.06, H * 0.38), 'RESCUE', font=f, fill=(20, 20, 20, 255))
    return to_arr(im)


def intake_warning(px=512):
    im = Image.new('RGBA', (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    tri = [(px / 2, px * 0.05), (px * 0.95, px * 0.8), (px * 0.05, px * 0.8)]
    d.polygon(tri, outline=(200, 25, 25, 255), width=int(px * 0.06))
    f = ImageFont.truetype(FBC, int(px * 0.10))
    for i, l in enumerate(('DANGER', 'AIR INTAKE')):
        bb = f.getbbox(l)
        d.text((px / 2 - (bb[2] - bb[0]) / 2, px * 0.45 + i * px * 0.12), l, font=f, fill=(200, 25, 25, 255))
    f2 = ImageFont.truetype(FBC, int(px * 0.08))
    l = 'KEEP CLEAR'
    bb = f2.getbbox(l)
    d.text((px / 2 - (bb[2] - bb[0]) / 2, px * 0.84), l, font=f2, fill=(200, 25, 25, 255))
    return to_arr(im)


def panther_badge(px=1024):
    """Squadron badge (stylised): black panther rampant on sea waves, azure field, gold ring."""
    ss = 2
    n = px * ss
    im = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = n / 2
    R = n * 0.49
    d.ellipse([c - R, c - R, c + R, c + R], fill=(200, 160, 50, 255))
    R2 = n * 0.43
    d.ellipse([c - R2, c - R2, c + R2, c + R2], fill=(30, 110, 205, 255))
    # waves (lower part)
    mask = Image.new('L', (n, n), 0)
    ImageDraw.Draw(mask).ellipse([c - R2, c - R2, c + R2, c + R2], fill=255)
    waves = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    wd = ImageDraw.Draw(waves)
    for k in range(4):
        y0 = c + n * (0.16 + 0.07 * k)
        pts = []
        for i in range(0, 201):
            x = i / 200 * n
            pts.append((x, y0 + math.sin(x / n * math.pi * 8 + k) * n * 0.018))
        pts += [(n, n), (0, n)]
        colr = (235, 240, 245, 255) if k % 2 == 0 else (20, 70, 150, 255)
        wd.polygon(pts, fill=colr)
    im.paste(waves, (0, 0), Image.composite(waves, Image.new('RGBA', (n, n)), mask).split()[3])
    # panther silhouette (rampant, facing left) as polygon in unit coords
    P = [(0.30, 0.25), (0.32, 0.27), (0.35, 0.28), (0.38, 0.31), (0.40, 0.34), (0.33, 0.33), (0.27, 0.31), (0.23, 0.30),
         (0.22, 0.32), (0.27, 0.345), (0.34, 0.365), (0.39, 0.38), (0.34, 0.42), (0.29, 0.44), (0.26, 0.455), (0.27, 0.475),
         (0.33, 0.46), (0.40, 0.44), (0.46, 0.50), (0.50, 0.58), (0.49, 0.66), (0.46, 0.73), (0.44, 0.79), (0.43, 0.82),
         (0.49, 0.82), (0.51, 0.76), (0.54, 0.69), (0.56, 0.72), (0.60, 0.78), (0.60, 0.82), (0.67, 0.82), (0.66, 0.78),
         (0.64, 0.70), (0.62, 0.62), (0.64, 0.60), (0.70, 0.57), (0.75, 0.51), (0.78, 0.43), (0.78, 0.35), (0.75, 0.28),
         (0.72, 0.27), (0.735, 0.31), (0.75, 0.37), (0.745, 0.44), (0.72, 0.50), (0.67, 0.545), (0.625, 0.56), (0.60, 0.50),
         (0.56, 0.42), (0.52, 0.35), (0.48, 0.28), (0.45, 0.22), (0.42, 0.18), (0.41, 0.14), (0.395, 0.175), (0.38, 0.165),
         (0.365, 0.13), (0.355, 0.175), (0.33, 0.19), (0.31, 0.22)]
    d = ImageDraw.Draw(im)
    d.polygon([(x * n, y * n) for x, y in P], fill=(12, 12, 14, 255))
    d.ellipse([0.345 * n, 0.195 * n, 0.36 * n, 0.21 * n], fill=(230, 200, 40, 255))  # eye
    # ring text
    f = ImageFont.truetype(FBC, int(n * 0.045))
    for txt, a0, sgn in (('INAS 303', -90, 1), ('BLACK PANTHERS', 90, -1)):
        L = len(txt)
        for i, ch in enumerate(txt):
            ang = math.radians(a0 + sgn * (i - (L - 1) / 2) * 7.5)
            rr = n * 0.46
            x = c + rr * math.cos(ang)
            y = c + rr * math.sin(ang)
            g = Image.new('RGBA', (int(n * 0.06), int(n * 0.06)), (0, 0, 0, 0))
            ImageDraw.Draw(g).text((n * 0.012, 0), ch, font=f, fill=(20, 30, 60, 255))
            g = g.rotate(-math.degrees(ang) - 90 * sgn, resample=Image.BICUBIC)
            im.alpha_composite(g, (int(x - g.width / 2), int(y - g.height / 2)))
    return to_arr(im.resize((px, px), Image.LANCZOS))


def fold_stripes(px=512):
    im = Image.new('RGBA', (px, px // 8), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    H = px // 8
    for i in range(0, px, H):
        d.polygon([(i, 0), (i + H // 2, 0), (i + H, H), (i + H // 2, H)], fill=(200, 30, 30, 255))
    return to_arr(im)


if __name__ == '__main__':
    for name, fn in (('roundel', roundel), ('panther', panther_badge), ('eject', ejection_triangle), ('rescue', rescue_arrow),
                     ('intake', intake_warning)):
        a = fn()
        Image.fromarray((a * 255).astype(np.uint8)).save('/home/claude/mig/out/decal_%s.png' % name)
    Image.fromarray((text_img('817') * 255).astype(np.uint8)).save('/home/claude/mig/out/decal_serial.png')
