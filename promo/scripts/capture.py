"""Capture film shots from the sim on the GPU (headless Chrome, Metal).
usage: python capture.py shot1,shot2,...|all [--preview]   -> build/shots/<name>/00000.jpg ... and build/sheets/<name>.jpg"""
import asyncio, sys, os, subprocess, time, pathlib
from playwright.async_api import async_playwright
from PIL import Image
HERE = pathlib.Path(__file__).resolve().parent; PROMO = HERE.parent; SIM = PROMO.parent / 'sim'; TESTS = PROMO.parent / 'tests'
OUT = PROMO / 'build' / 'shots'; SHEETS = PROMO / 'build' / 'sheets'
ALL = ['guard', 'cwp', 'gauges', 'instructor', 'wingfold', 'ab_stops', 'launch_side', 'launch_ck', 'climb', 'highg', 'greyout', 'groove',
       'trap_deck', 'night_groove', 'night_chase', 'fire', 'tanker_chase', 'tanker_ck', 'hero', 'ui_menu', 'ui_debrief',
       'hero_open', 'flyby_low', 'clouds', 'roll', 'vapour', 'storm', 'hero_end']
names = ALL if sys.argv[1] == 'all' else sys.argv[1].split(',')
preview = '--preview' in sys.argv          # every 6th frame only, for framing checks

async def shoot(p, name, port):
    b = await p.chromium.launch(headless=True, channel='chrome', args=['--use-angle=metal', '--ignore-gpu-blocklist'])
    pg = await b.new_page(viewport={'width': 1920, 'height': 1080}, device_scale_factor=1)
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    await pg.goto(f'http://localhost:{port}/index.html?capture')
    await pg.wait_for_function('window.__sim && window.__sim.ready', timeout=180000)
    await pg.evaluate('document.fonts.ready')
    await pg.add_script_tag(path=str(TESTS / 'ap.js'))
    await pg.add_script_tag(path=str(HERE / 'shots.js'))
    n = await pg.evaluate(f"() => {{ window.__sim.state.started = true; const s = window.SHOTS['{name}']; s.setup(); const W = window.__sim.water; if (W.u.uSea.value === 0) W.setSea(1); return s.frames; }}")
    d = OUT / name; d.mkdir(parents=True, exist_ok=True)
    for f in d.glob('*.jpg'): f.unlink()
    t0 = time.time(); step = 6 if preview else 1
    for i in range(n):
        await pg.evaluate(f"() => window.SHOTS['{name}'].step({i}, {i / 60})")
        if i % step == 0:
            await pg.screenshot(path=str(d / f'{i:05d}.jpg'), type='jpeg', quality=94)
    print(f'{name}: {n} frames in {time.time() - t0:.0f}s' + (f'  ERRORS {errs[:3]}' if errs else ''), flush=True)
    await b.close()
    # contact sheet: 4 frames
    fr = sorted(d.glob('*.jpg')); pick = [fr[int(k * (len(fr) - 1) / 3)] for k in range(4)] if len(fr) > 1 else fr * 4
    SHEETS.mkdir(parents=True, exist_ok=True)
    sheet = Image.new('RGB', (1920, 1080 // 2 * 2 // 2 * 2))
    sheet = Image.new('RGB', (1920, 1080))
    for k, f in enumerate(pick): sheet.paste(Image.open(f).resize((960, 540)), ((k % 2) * 960, (k // 2) * 540))
    sheet.save(SHEETS / f'{name}.jpg', quality=85)

async def main():
    port = 8791
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(port), '--directory', str(SIM)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    try:
        async with async_playwright() as p:
            for nm in names: await shoot(p, nm, port)
    finally: srv.terminate()
asyncio.run(main())
