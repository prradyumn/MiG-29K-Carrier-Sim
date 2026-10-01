"""Real-time stability test in GPU Chrome: every mission and some lessons played live with keyboard input.
Flags page reloads, mission resets (sim clock going backwards), JS errors, crashes, heap growth and frame rate.
usage: python stability.py [seconds_per_mission]"""
import asyncio, sys, subprocess, time, pathlib, json
from playwright.async_api import async_playwright
SIM = pathlib.Path(__file__).resolve().parent.parent / 'sim'
SECS = float(sys.argv[1]) if len(sys.argv) > 1 else 40
import os
RUNS = [tuple(x.split(':')) for x in os.environ['RUNS'].split(',')] if os.environ.get('RUNS') else [('scn', 'cold'), ('scn', 'deck'), ('scn', 'short'), ('scn', 'approach'), ('scn', 'circuit'), ('scn', 'tanker'), ('scn', 'free'),
        ('night', 'approach'), ('lesson', 'cold'), ('lesson', 'launch'), ('lesson', 'emerg'), ('lesson', 'tanker')]
# keyboard script per mission: (time s, action, key)
KEYS = {
  'cold': [(1, 'press', 'Digit1'), (2, 'press', 'Digit5'), (3, 'press', 'Digit2'), (22, 'press', 'Digit3'), (23, 'press', 'Digit3'), (28, 'press', 'KeyV'), (30, 'press', 'KeyC')],
  'deck': [(1, 'down', 'ShiftLeft'), (4, 'up', 'ShiftLeft'), (4.5, 'press', 'Tab'), (8, 'press', 'Space'), (12, 'down', 'KeyS'), (13, 'up', 'KeyS'), (14, 'press', 'KeyG'), (18, 'press', 'KeyL'), (20, 'press', 'KeyV'), (25, 'press', 'KeyZ'), (30, 'press', 'KeyZ')],
  'short': [(1, 'press', 'Tab'), (5, 'press', 'Space'), (10, 'press', 'KeyG')],
  'approach': [(2, 'down', 'KeyW'), (2.3, 'up', 'KeyW'), (10, 'press', 'KeyV'), (14, 'press', 'KeyV'), (18, 'press', 'KeyC')],
  'circuit': [(2, 'down', 'KeyA'), (3, 'up', 'KeyA'), (6, 'press', 'KeyG'), (9, 'press', 'KeyL'), (11, 'press', 'KeyH')],
  'tanker': [(1, 'press', 'KeyI'), (5, 'down', 'ShiftLeft'), (6, 'up', 'ShiftLeft')],
  'free': [(1, 'down', 'KeyD'), (2.5, 'up', 'KeyD'), (3, 'down', 'KeyS'), (6, 'up', 'KeyS'), (8, 'press', 'Tab'), (15, 'press', 'KeyP'), (17, 'press', 'KeyP'), (20, 'press', 'KeyM'), (22, 'press', 'KeyM')],
}
async def main():
    srv = subprocess.Popen(['python3', '-m', 'http.server', '8810', '--directory', str(SIM)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(0.8)
    report = []
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, channel='chrome', args=['--use-angle=metal', '--enable-precise-memory-info', '--autoplay-policy=no-user-gesture-required'])
        pg = await b.new_page(viewport={'width': 1600, 'height': 900})
        errs = []; loads = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'favicon' not in m.text else None)
        pg.on('load', lambda: loads.append(time.time()))
        pg.on('response', lambda r: errs.append('HTTP %d %s' % (r.status, r.url)) if r.status >= 400 else None)
        await pg.goto('http://localhost:8810/index.html')
        await pg.wait_for_function('window.__sim && window.__sim.ready', timeout=180000)
        await pg.evaluate("window.__marker = 'alive'; window.__frames = 0; (function c(){ window.__frames++; requestAnimationFrame(c); })();")
        for kind, name in RUNS:
            e0 = len(errs); l0 = len(loads)
            await pg.evaluate("() => { const S = window.__sim; if (S.state.started && !S.state.paused) document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP' })); document.getElementById('menu').hidden = false; document.getElementById('debrief').hidden = true; }")
            if kind == 'scn': await pg.click(f'#tab-free'); await pg.click(f'[data-scn={name}]:not([data-night])')
            elif kind == 'night': await pg.evaluate("() => { document.getElementById('menu').hidden = false; }"); await pg.click('#tab-free'); await pg.click('[data-scn=approach][data-night]')
            else: await pg.evaluate("() => { document.getElementById('menu').hidden = false; }"); await pg.click('#tab-train'); await pg.click(f'[data-lesson={name}]')
            await pg.mouse.move(800, 450)
            t0 = time.time(); last_sim = -1; resets = 0; f0 = await pg.evaluate('window.__frames'); heap0 = await pg.evaluate('performance.memory.usedJSHeapSize')
            keys = sorted(KEYS.get(name, []) if kind == 'scn' else [])
            ki = 0
            while time.time() - t0 < SECS:
                el = time.time() - t0
                while ki < len(keys) and keys[ki][0] <= el:
                    _, act, k = keys[ki]; ki += 1
                    await (pg.keyboard.press(k) if act == 'press' else pg.keyboard.down(k) if act == 'down' else pg.keyboard.up(k))
                st = await pg.evaluate("({ m: window.__marker, t: window.__sim.state.simTime, crashed: window.__sim.ac.crashed, paused: window.__sim.state.paused, replay: !!window.__sim.state.replay })")
                if st['m'] != 'alive': resets += 100; break
                if st['t'] + 0.5 < last_sim and not st['replay']: resets += 1
                last_sim = st['t']
                await pg.wait_for_timeout(250)
            frames = await pg.evaluate('window.__frames') - f0; heap1 = await pg.evaluate('performance.memory.usedJSHeapSize')
            fin = await pg.evaluate("({ t: window.__sim.state.simTime, crashed: window.__sim.ac.crashed, alt: Math.round(window.__sim.ac.pos.y), ias: Math.round(window.__sim.ac.t.ias * 3.6), lesson: window.__sim.instructor.active ? window.__sim.instructor.i + 1 : null })")
            r = dict(run=f'{kind}:{name}', fps=round(frames / SECS), simT=round(fin['t'], 1), resets=resets, reloads=len(loads) - l0, errors=errs[e0:][:3], crashed=fin['crashed'], heapMB=round((heap1 - heap0) / 1e6, 1), alt=fin['alt'], ias=fin['ias'], lessonStep=fin['lesson'])
            report.append(r); print(json.dumps(r, ensure_ascii=False), flush=True)
            for k in ['ShiftLeft', 'KeyW', 'KeyS', 'KeyA', 'KeyD']: await pg.keyboard.up(k)
            await pg.keyboard.press('Escape')
            if await pg.evaluate('!document.getElementById("debrief").hidden'): await pg.keyboard.press('Escape')
        await b.close()
    srv.terminate()
    bad = [r for r in report if r['resets'] or r['reloads'] or r['errors']]
    print('RESULT:', 'no resets, reloads or errors' if not bad else f'{len(bad)} problem runs')
asyncio.run(main())
