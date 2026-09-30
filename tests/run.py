import asyncio, sys, os, json, subprocess, time
from playwright.async_api import async_playwright
import pathlib; HERE=pathlib.Path(__file__).resolve().parent; ROOT=str(HERE.parent/'sim'); NM=str(HERE/'node_modules'/'three')
script = json.loads(sys.argv[1]) if len(sys.argv)>1 else []
async def main():
    srv = subprocess.Popen(['python3','-m','http.server','8765','--directory',ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-webgl'])
        pg = await b.new_page(viewport={'width':1100,'height':620})
        logs=[]
        pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
        pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        async def route(r):
            u=r.request.url
            if 'cdn.jsdelivr.net/npm/three@0.160.0/' in u:
                rel=u.split('three@0.160.0/')[1]
                path=os.path.join(NM,rel)
                if os.path.exists(path):
                    await r.fulfill(path=path, headers={'content-type':'application/javascript','access-control-allow-origin':'*'}); return
                await r.fulfill(status=404, body='nf'); return
            if 'fonts.g' in u: await r.fulfill(status=200, body='', headers={'content-type':'text/css'}); return
            await r.continue_()
        await pg.route('**/*', route)
        await pg.goto('http://localhost:8765/index.html')
        for step in script:
            k=step[0]
            if k=='wait': await pg.wait_for_timeout(step[1])
            elif k=='waitsel': await pg.wait_for_selector(step[1], state='visible', timeout=step[2] if len(step)>2 else 120000)
            elif k=='click': await pg.click(step[1])
            elif k=='down': await pg.keyboard.down(step[1])
            elif k=='up': await pg.keyboard.up(step[1])
            elif k=='press': await pg.keyboard.press(step[1])
            elif k=='shot': await pg.screenshot(path=step[1], timeout=240000)
            elif k=='eval': logs.append('[eval] '+str(await pg.evaluate(step[1])))
        await b.close()
    srv.terminate()
    print('\n'.join(logs[-60:]))
asyncio.run(main())
