"""Render frames [start, end) of the composition to an H.264 segment. usage: python render.py start end out.mp4 [port]"""
import asyncio, sys, subprocess, time, pathlib
from playwright.async_api import async_playwright
PROMO = pathlib.Path(__file__).resolve().parent.parent
start, end, out = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
port = int(sys.argv[4]) if len(sys.argv) > 4 else 8800
async def main():
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(port), '--directory', str(PROMO)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(0.8)
    ff = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'image2pipe', '-framerate', '60', '-c:v', 'mjpeg', '-i', '-',
                           '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', '60', out], stdin=subprocess.PIPE)
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, channel='chrome', args=['--use-angle=metal'])
        pg = await b.new_page(viewport={'width': 1920, 'height': 1080})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(f'http://localhost:{port}/web/index.html'); await pg.evaluate('document.fonts.ready'); await pg.wait_for_timeout(400)
        t0 = time.time()
        for f in range(start, end):
            await pg.evaluate(f'window.renderFrame({f})')
            ff.stdin.write(await pg.screenshot(type='jpeg', quality=93))
            if (f - start) % 300 == 0: print(f'{out}: frame {f} ({(time.time() - t0) / max(1, f - start + 1) * 1000:.0f} ms/f)', flush=True)
        await b.close()
    ff.stdin.close(); ff.wait(); srv.terminate()
    print(f'{out}: done {end - start} frames in {time.time() - t0:.0f}s', ('ERRORS ' + str(errs[:3])) if errs else '', flush=True)
asyncio.run(main())
