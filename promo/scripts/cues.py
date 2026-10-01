import asyncio, subprocess, time, json, pathlib
from playwright.async_api import async_playwright
PROMO = pathlib.Path(__file__).resolve().parent.parent
async def main():
    srv = subprocess.Popen(['python3', '-m', 'http.server', '8798', '--directory', str(PROMO)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(0.8)
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, channel='chrome'); pg = await b.new_page()
        await pg.goto('http://localhost:8798/web/index.html')
        c = await pg.evaluate('({ sfx: window.SFX, vo: window.VO, dur: window.DUR })')
        await b.close()
    srv.terminate()
    json.dump(c, open(PROMO / 'build' / 'cues.json', 'w'), indent=1)
    print(len(c['sfx']), 'sfx', len(c['vo']), 'vo', sorted(set(s['type'] for s in c['sfx'])))
asyncio.run(main())
