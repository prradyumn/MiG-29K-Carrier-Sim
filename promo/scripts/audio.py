"""Soundtrack: Lyria score + Gemini voice-over + synthesized SFX, all placed from the timeline's own cue list
(build/cues.json). Writes build/mix.wav (48 kHz stereo) and a spectrogram for checking."""
import json, numpy as np, soundfile as sf, subprocess, pathlib
from scipy import signal
P = pathlib.Path(__file__).resolve().parent.parent; B = P / 'build'
SR = 48000
cues = json.load(open(B / 'cues.json')); DUR = cues['dur']
N = int(DUR * SR) + SR
rng = np.random.default_rng(29)

def load(path, sr=SR):
    tmp = B / '_ld.wav'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(path), '-ar', str(sr), '-ac', '2', str(tmp)], check=True)
    x, _ = sf.read(tmp); return x
def env(n, a=0.005, r=0.2, shape=3.0):
    t = np.arange(n) / SR; e = np.minimum(1, t / max(a, 1e-4)) * np.exp(-t / max(r, 1e-4) * shape / 3); return e
def lp(x, f, o=2): b, a = signal.butter(o, f / (SR / 2), 'low'); return signal.lfilter(b, a, x)
def hp(x, f, o=2): b, a = signal.butter(o, f / (SR / 2), 'high'); return signal.lfilter(b, a, x)
def bp(x, f1, f2, o=2): b, a = signal.butter(o, [f1 / (SR / 2), f2 / (SR / 2)], 'band'); return signal.lfilter(b, a, x)
def noise(n): return rng.standard_normal(n)
def st(x, w=0.0):   # mono -> stereo with slight width
    d = int(0.0007 * SR * w) if w else 0
    L = x; R = np.roll(x, d) if d else x
    return np.stack([L, R], 1)
def sweep_bp(n, f0, f1, q=2.0):
    """band-passed noise whose centre sweeps f0 -> f1 (block-wise)."""
    x = noise(n); out = np.zeros(n); blk = 1024
    for i in range(0, n, blk):
        f = f0 * (f1 / f0) ** (i / n); lo, hi = max(40, f / (1 + 1 / q)), min(SR / 2 - 100, f * (1 + 1 / q))
        b, a = signal.butter(2, [lo / (SR / 2), hi / (SR / 2)], 'band'); out[i:i + blk] = signal.lfilter(b, a, x[i:i + blk])
    return out

# ---------------------------------------------------------------- sound design
def s_boom(g):
    n = int(2.6 * SR); t = np.arange(n) / SR
    sub = np.sin(2 * np.pi * (48 * t - 18 * t * t)) * np.exp(-t * 1.6)
    body = lp(noise(n), 180, 4) * np.exp(-t * 3.5) * 2.5
    crack = hp(noise(n), 1500) * np.exp(-t * 28) * 0.6
    return st(np.tanh((sub * 1.2 + body + crack) * 1.4) * g * 0.9, 1)
def s_hit(g):
    n = int(1.2 * SR); t = np.arange(n) / SR
    x = np.sin(2 * np.pi * 70 * t) * np.exp(-t * 6) + lp(noise(n), 900) * np.exp(-t * 14) * 1.5 + hp(noise(n), 3000) * np.exp(-t * 40) * 0.4
    return st(np.tanh(x) * g * 0.8, 1)
def s_impact(g):
    n = int(2.0 * SR); t = np.arange(n) / SR
    x = np.sin(2 * np.pi * (60 * t - 10 * t * t)) * np.exp(-t * 2.4) * 1.3 + lp(noise(n), 400, 3) * np.exp(-t * 5) * 2 + bp(noise(n), 1500, 6000) * np.exp(-t * 18) * 0.7
    return st(np.tanh(x * 1.3) * g * 0.85, 1)
def s_riser(g, secs=2.0):
    n = int(secs * SR); t = np.arange(n) / SR
    x = sweep_bp(n, 300, 7000, 3) * (t / secs) ** 2.2 * 2.2
    tone = np.sin(2 * np.pi * np.cumsum(200 + 900 * (t / secs) ** 2) / SR) * (t / secs) ** 3 * 0.25
    return st((x + tone) * g * 0.6, 2)
def s_whoosh(g):
    n = int(0.7 * SR); t = np.arange(n) / SR
    e = np.sin(np.pi * np.clip(t / 0.7, 0, 1)) ** 2
    return st(sweep_bp(n, 500, 5000, 2.5) * e * g * 1.1, 3)
def s_roar(g):
    n = int(1.6 * SR); t = np.arange(n) / SR
    rumble = lp(noise(n), 260, 3) * 3.0; hiss = bp(noise(n), 1200, 5000) * 0.5
    crackle = hp(noise(n), 500) * (rng.random(n) > 0.9965) * 4
    e = np.minimum(1, t / 0.08) * np.clip(1.25 - t / 1.4, 0, 1)
    return st(np.tanh((rumble + hiss + crackle) * e) * g * 0.8, 2)
def s_flyby(g):
    n = int(2.4 * SR); t = np.arange(n) / SR; tc = 1.2
    x = sweep_bp(n, 1800, 220, 1.5) * 2.5 + lp(noise(n), 300, 3) * 2
    e = 1 / (1 + ((t - tc) / 0.28) ** 2)
    pan = np.clip((t - tc) / 0.6, -1, 1)
    y = np.tanh(x * e * 1.2) * g * 0.9
    return np.stack([y * (0.6 - 0.4 * pan), y * (0.6 + 0.4 * pan)], 1)
def s_spool(g):
    n = int(4.0 * SR); t = np.arange(n) / SR
    f = 180 + 2600 * (1 - np.exp(-t / 1.6))
    whine = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.35 + np.sin(2 * np.pi * np.cumsum(f * 1.51) / SR) * 0.15
    air = bp(noise(n), 400, 2500) * 0.5 * np.minimum(1, t / 1.5)
    lightoff = lp(noise(n), 200, 2) * np.exp(-np.maximum(t - 1.3, 0) * 4) * (t > 1.3) * 2.2
    e = np.minimum(1, t / 0.5) * np.clip((4.0 - t) / 0.4, 0, 1)
    return st((whine + air + lightoff) * e * g * 0.55, 2)
def s_click(g, f=3000, d=0.03, low=False):
    n = int(0.12 * SR); t = np.arange(n) / SR
    x = bp(noise(n), f * 0.7, f * 1.4) * np.exp(-t / d * 3) * 2 + np.sin(2 * np.pi * 900 * t) * np.exp(-t * 90) * 0.6
    if low: x += np.sin(2 * np.pi * 140 * t) * np.exp(-t * 30) * 0.8
    return st(x * g * 0.5)
def s_thunk(g):
    n = int(0.8 * SR); t = np.arange(n) / SR
    return st((np.sin(2 * np.pi * 95 * t) * np.exp(-t * 9) + lp(noise(n), 700) * np.exp(-t * 22)) * g * 0.8)
def s_type(g): return s_click(g * 0.45, 4200, 0.012)
def s_tick(g): return s_click(g * 0.5, 2600, 0.01)
def s_drone(g):
    n = int(8.0 * SR); t = np.arange(n) / SR
    x = sum(np.sin(2 * np.pi * f * t + k) * a for k, (f, a) in enumerate([(55, 0.5), (55.4, 0.4), (82.5, 0.25), (110.3, 0.12)]))
    x += lp(noise(n), 120, 2) * 0.6
    e = np.minimum(1, t / 2.0) * np.clip((8 - t) / 2.5, 0, 1)
    return st(x * e * g * 0.35, 4)
def s_vortex(g):
    n = int(2.0 * SR); t = np.arange(n) / SR
    x = bp(noise(n), 250, 1400) * (0.6 + 0.4 * np.sin(2 * np.pi * 3.3 * t)) * np.minimum(1, t / 0.2) * np.clip((2 - t) / 0.6, 0, 1)
    return st(x * g * 1.2, 3)
def s_breath(g):
    n = int(1.8 * SR); t = np.arange(n) / SR
    x = bp(noise(n), 500, 2600) * (np.sin(np.pi * np.clip(t / 0.8, 0, 1)) ** 2 * (t < 0.8) + np.sin(np.pi * np.clip((t - 1.0) / 0.7, 0, 1)) ** 2 * (t > 1.0) * 0.8)
    return st(x * g * 0.9)
def s_cable(g):
    n = int(2.4 * SR); t = np.arange(n) / SR
    twang = sum(np.sin(2 * np.pi * f * t) * np.exp(-t * d) * a for f, d, a in [(82, 1.2, 0.8), (164, 2.2, 0.4), (247, 3.5, 0.25), (330, 5, 0.15)])
    scrape = bp(noise(n), 800, 5000) * np.exp(-t * 2.6) * 0.9
    slam = lp(noise(n), 250, 3) * np.exp(-t * 7) * 3
    return st(np.tanh((twang + scrape + slam) * 1.4) * g * 0.8, 2)
def s_stamp(g):
    n = int(1.2 * SR); t = np.arange(n) / SR
    x = np.sin(2 * np.pi * 58 * t) * np.exp(-t * 5) * 1.3 + lp(noise(n), 1500) * np.exp(-t * 25) * 1.2
    return st(np.tanh(x * 1.2) * g * 0.8, 1)
def s_squelch(g):
    n = int(0.25 * SR); t = np.arange(n) / SR
    return st(bp(noise(n), 900, 4000) * np.exp(-t * 14) * g * 0.7)
def s_alarm(g):
    n = int(0.38 * SR); t = np.arange(n) / SR
    x = (np.sign(np.sin(2 * np.pi * 740 * t)) * 0.5 + np.sin(2 * np.pi * 1480 * t) * 0.2) * np.minimum(1, t / 0.005) * np.clip((0.38 - t) / 0.02, 0, 1)
    return st(lp(x, 3500) * g * 0.28)
def s_glitch(g):
    n = int(0.35 * SR); x = noise(n); x = np.round(x * 4) / 4
    chop = (np.floor(np.arange(n) / (SR * 0.018)) % 2)
    return st(bp(x, 300, 6000) * chop * np.exp(-np.arange(n) / SR * 6) * g * 0.6, 2)
def s_clunk(g):
    n = int(0.9 * SR); t = np.arange(n) / SR
    x = np.sin(2 * np.pi * 130 * t) * np.exp(-t * 12) + bp(noise(n), 1500, 5000) * np.exp(-t * 35) * 0.8 + np.sin(2 * np.pi * 2100 * t) * np.exp(-t * 25) * 0.3
    return st(x * g * 0.8)
GEN = {'boom': s_boom, 'hit': s_hit, 'impact': s_impact, 'riser': lambda g: s_riser(g, 2.0), 'riser_short': lambda g: s_riser(g, 0.9), 'whoosh': s_whoosh,
       'roar': s_roar, 'flyby': s_flyby, 'spool': s_spool, 'guard': lambda g: s_click(g, 1500, 0.05, True), 'toggle': lambda g: s_click(g, 3300, 0.03, True),
       'thunk': s_thunk, 'type': s_type, 'tick': s_tick, 'drone': s_drone, 'vortex': s_vortex, 'breath': s_breath, 'cable': s_cable, 'stamp': s_stamp,
       'squelch': s_squelch, 'alarm': s_alarm, 'glitch': s_glitch, 'clunk': s_clunk}
# risers end on their hit: shift so the sound peaks at the cue time + length
PRE = {'riser': 0.0, 'riser_short': 0.0}

def place(buf, x, t):
    i = int(t * SR); j = min(len(buf), i + len(x))
    if i < 0: x = x[-i:]; i = 0
    buf[i:j] += x[:j - i]

# ---------------------------------------------------------------- stems
sfxb = np.zeros((N, 2))
for c in cues['sfx']:
    place(sfxb, GEN[c['type']](c['gain']), c['t'] - PRE.get(c['type'], 0))

def vo_chain(x, radio=False):
    x = x.mean(1)
    # trim leading/trailing silence
    a = np.abs(x); th = 0.01 * a.max(); idx = np.where(a > th)[0]
    x = x[max(0, idx[0] - int(0.02 * SR)): idx[-1] + int(0.08 * SR)]
    if radio:
        x = bp(x, 320, 3200, 3); x = np.tanh(x / (np.abs(x).max() + 1e-9) * 3) * 0.6
        x += bp(noise(len(x)), 800, 4000) * 0.015
    else:
        x = hp(x, 85, 2)
        b, a2 = signal.butter(2, [2800 / (SR / 2), 5200 / (SR / 2)], 'band'); x = x + signal.lfilter(b, a2, x) * 0.5     # presence
        x = x + lp(x, 180, 2) * 0.35                                                                                       # chest
        e = np.sqrt(np.abs(lp(x * x, 12, 1))) + 1e-5; gain = np.minimum(1, (0.12 / e) ** 0.45); x = x * gain                # gentle compression
        x = x / (np.abs(x).max() + 1e-9) * 0.9
    # short room
    ir = noise(int(0.35 * SR)) * np.exp(-np.arange(int(0.35 * SR)) / SR * 14) * 0.02
    wet = signal.fftconvolve(x, ir)[:len(x)]
    return st(x + wet, 1)
vob = np.zeros((N, 2)); voEnv = np.zeros(N)
for v in cues['vo']:
    x = vo_chain(load(P / 'assets' / 'vo' / f"{v['id']}.wav"), radio=v['id'] == 'lso') * v['gain']
    place(vob, x, v['t']); i = int(v['t'] * SR); voEnv[i:i + len(x)] = 1

music = load(B / 't_music.mp3')[:N]
if len(music) < N: music = np.vstack([music, np.zeros((N - len(music), 2))])
t = np.arange(N) / SR
fade = np.clip((DUR - 0.2 - t) / 1.4, 0, 1)            # tail fade with the picture
music *= fade[:, None]
# duck the score ~8 dB under the voice, smoothed
duck = lp(voEnv, 3, 1); duck = 1 - 0.6 * np.clip(duck * 1.3, 0, 1)
music *= duck[:, None]

def rms(x): return np.sqrt(np.mean(x ** 2) + 1e-12)
m_r = rms(music[music.any(1)]); v_r = rms(vob[voEnv > 0]) if voEnv.any() else 1
vob *= (m_r * 1.45) / v_r                                # voice ~7 dB over the ducked score
sfxb *= 0.55
mix = music * 0.9 + vob + sfxb
mix = np.tanh(mix * 1.1) * 0.95
mix = mix[:int(DUR * SR)]
sf.write(B / 'mix.wav', mix, SR, subtype='PCM_24')
print('mix', mix.shape[0] / SR, 's  peak', np.abs(mix).max().round(3), ' rms dB', (20 * np.log10(rms(mix))).round(1),
      ' voice-over-music dB', (20 * np.log10(rms(vob[voEnv[:len(vob)] > 0]) / (rms(music[voEnv > 0]) + 1e-9))).round(1))
# spectrogram for a visual check
import PIL.Image as Im
f_, tt, S = signal.spectrogram(mix.mean(1), SR, nperseg=2048, noverlap=1024)
S = 10 * np.log10(S + 1e-12); S = np.clip((S - S.max() + 90) / 90, 0, 1)[::-1][:400]
Im.fromarray((S * 255).astype(np.uint8)).resize((1600, 400)).save(B / 'spectrogram.png')
if __name__ == '__main__':
    import sys
    if '--stems' in sys.argv:
        for s in range(0, int(DUR), 4):
            sl = slice(s * SR, (s + 4) * SR)
            db = lambda x: 20 * np.log10(np.sqrt(np.mean(x[sl] ** 2)) + 1e-9)
            print(f'{s:2d}-{s+4:2d}s  music {db(music * 0.9):6.1f}  vo {db(vob):6.1f}  sfx {db(sfxb):6.1f}  mix {db(mix):6.1f}')
