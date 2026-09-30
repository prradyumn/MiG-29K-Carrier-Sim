import sys, time
sys.path.insert(0, '/home/claude/mig')
import bpy
from scene import *
from lib import *
import build_airframe as A
import parts as P


def make_mats():
    M = {}
    M['airframe'] = mat('Airframe', (0.30, 0.33, 0.36), 0.5)
    M['airframe_misc'] = mat('AirframeMisc', (0.30, 0.33, 0.36), 0.55)
    M['gear'] = mat('GearPaint', (0.55, 0.57, 0.56), 0.45, 0.2)
    M['tire'] = mat('Tire', (0.025, 0.025, 0.027), 0.85)
    M['hub'] = mat('WheelHub', (0.35, 0.38, 0.36), 0.4, 0.3)
    M['lamp'] = mat('LampGlass', (0.9, 0.9, 0.85), 0.05, 0.0, emit=(1, 0.95, 0.85), emit_strength=0.5)
    M['metal_dark'] = mat('MetalDark', (0.12, 0.12, 0.12), 0.35, 0.9)
    M['sensor'] = mat('SensorGlass', (0.02, 0.03, 0.05), 0.05, 0.6)
    M['dielectric'] = mat('Dielectric', (0.07, 0.075, 0.08), 0.55)
    M['nav_green'] = mat('NavGreen', (0.1, 0.8, 0.2), 0.1, emit=(0.1, 1, 0.3), emit_strength=3)
    M['nav_red'] = mat('NavRed', (0.8, 0.1, 0.1), 0.1, emit=(1, 0.05, 0.05), emit_strength=3)
    M['nav_white'] = mat('NavWhite', (0.9, 0.9, 0.9), 0.1, emit=(1, 1, 1), emit_strength=3)
    M['beacon'] = mat('Beacon', (0.7, 0.05, 0.05), 0.1, emit=(1, 0.05, 0.02), emit_strength=1)
    M['hook'] = mat('Hook', (0.8, 0.8, 0.8), 0.4, 0.3)
    M['missile'] = mat('MissileWhite', (0.62, 0.63, 0.62), 0.45)
    M['seeker'] = mat('Seeker', (0.3, 0.25, 0.15), 0.05, 0.3)
    M['pylon'] = mat('Pylon', (0.30, 0.33, 0.36), 0.55)
    M['cockpit'] = mat('CockpitGrey', (0.04, 0.045, 0.05), 0.6)
    M['seat'] = mat('SeatOlive', (0.12, 0.13, 0.08), 0.8)
    M['glass'] = mat('CanopyGlass', (0.92, 0.93, 0.90), 0.02, transmission=1.0, ior=1.5)
    M['frame'] = mat('CanopyFrame', (0.03, 0.032, 0.035), 0.75)
    M['intake'] = mat('IntakeDuct', (0.16, 0.17, 0.18), 0.6)
    M['nozzle'] = mat('NozzleMetal', (0.32, 0.30, 0.28), 0.42, 0.9)
    M['nozzle_in'] = mat('NozzleInner', (0.05, 0.045, 0.04), 0.7, 0.5)
    M['abglow'] = mat('ABGlow', (0.0, 0.0, 0.0), 1.0, emit=(1.0, 0.45, 0.12), emit_strength=0.0)
    return M


def build(M):
    o = A.build_all()
    skin = [o['fus'], o['body'], o['nacR'], o['nacL'], o['boomR'], o['boomL'], o['stabR'], o['stabL'], o['finR'], o['finL'],
            o['rudR'], o['rudL']]
    for side in ('wingR', 'wingL'):
        skin += list(o[side].values())
    for ob in skin:
        assign(ob, M['airframe'])
    for k in ('ductR', 'ductL'):
        assign(o[k], M['intake'])
    assign(o['ws'], M['glass']); assign(o['can'], M['glass'])
    assign(o['wsf'], M['frame']); assign(o['canf'], M['frame'])
    for side in (1, -1):
        outer, inner, fh, glow = P.build_nozzle(side)
        assign(outer, M['nozzle']); assign(inner, M['nozzle_in']); assign(fh, M['nozzle_in']); assign(glow, M['abglow'])
    g = P.build_gear(M)
    d = P.build_details(M)
    assign(d['airbrake'], M['airframe'])
    P.build_stores(M)
    P.build_cockpit_basic(M)
    return o, g, d


if __name__ == '__main__':
    t = time.time()
    reset()
    M = make_mats()
    o, g, d = build(M)
    print('built', time.time() - t, 'objects', len(bpy.data.objects),
          'tris', sum(len(ob.data.polygons) for ob in bpy.data.objects if ob.type == 'MESH'))
    bpy.ops.wm.save_as_mainfile(filepath='/home/claude/mig/out/geo.blend')
