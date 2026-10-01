"""Render stills of the composition at given times into a contact sheet. usage: python stills.py out.jpg t1 t2 ... (up to 9)"""
import asyncio, sys, subprocess, time, pathlib
from playwright.async_api import async_playwright
from PIL import Image
PROMO = pathlib.Path(__file__).resolve().parent.parent
async def main():
    out, ts = sys.argv[1], [float(x) for x in sys.argv[2:]]
    srv = subprocess.Popen(['python3', '-m', 'http.server', '8795', '--directory', str(PROMO)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(0.8)
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, channel='chrome', args=['--use-angle=metal'])
        pg = await b.new_page(viewport={'width': 1920, 'height': 1080})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        await pg.goto('http://localhost:8795/web/index.html'); await pg.evaluate('document.fonts.ready')
        await pg.wait_for_timeout(500)
        shots = []
        for i, t in enumerate(ts):
            await pg.evaluate(f'window.renderFrame({round(t * 60)})')
            f = f'/tmp/still_{i}.jpg'; await pg.screenshot(path=f, type='jpeg', quality=90); shots.append(f)
        await b.close()
        if errs: print('ERRORS', errs[:5])
    srv.terminate()
    n = len(shots); cols = 3 if n > 4 else 2 if n > 1 else 1; rows = (n + cols - 1) // cols
    sheet = Image.new('RGB', (cols * 640, rows * 360))
    for i, f in enumerate(shots): sheet.paste(Image.open(f).resize((640, 360)), ((i % cols) * 640, (i // cols) * 360))
    sheet.save(out, quality=88)
asyncio.run(main())
