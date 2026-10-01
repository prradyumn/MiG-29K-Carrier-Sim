import asyncio, subprocess, time
from playwright.async_api import async_playwright
async def main():
    srv = subprocess.Popen(['python3','-m','http.server','8790','--directory','/Users/pradyumnawasthi/MiG-29K-Carrier-Sim/sim'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(0.8)
    async with async_playwright() as p:
        for label, kw in [('chrome-metal', dict(channel='chrome', args=['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-webgpu'])), ('chrome-default', dict(channel='chrome'))]:
            b = await p.chromium.launch(headless=True, **kw)
            pg = await b.new_page(viewport={'width':1920,'height':1080}, device_scale_factor=1)
            await pg.goto('http://localhost:8790/index.html?capture')
            info = await pg.evaluate("() => { const g = document.createElement('canvas').getContext('webgl2'); const e = g.getExtension('WEBGL_debug_renderer_info'); return g.getParameter(e.UNMASKED_RENDERER_WEBGL); }")
            print(label, info)
            await pg.wait_for_function('window.__sim && window.__sim.ready', timeout=180000)
            await pg.evaluate("() => { window.__sim.startScenario('deck'); window.__sim.state.view='orbit'; }")
            t=time.time()
            for i in range(30):
                await pg.evaluate("() => window.__sim.renderStep(1/60)")
                await pg.screenshot(path='/Users/pradyumnawasthi/MiG-29K-Carrier-Sim/promo/build/gpu_%s.jpg' % label, type='jpeg', quality=90)
            print(label, 'ms/frame', (time.time()-t)/30*1000)
            await b.close()
    srv.terminate()
asyncio.run(main())
