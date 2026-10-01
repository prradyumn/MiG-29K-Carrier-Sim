"""Browser tests for the training lessons: real mouse clicks on cockpit controls, then a scripted 'student' that
follows the instructor. Usage:  python lessons.py <lesson-id|all> [shots_dir]
Needs: pip playwright (chromium), tests/node_modules/three."""
import asyncio, sys, os, json, subprocess, time, pathlib
from playwright.async_api import async_playwright
HERE = pathlib.Path(__file__).resolve().parent
ROOT = str(HERE.parent / 'sim'); NM = str(HERE / 'node_modules' / 'three')
WHICH = sys.argv[1] if len(sys.argv) > 1 else 'cold'
SHOTS = sys.argv[2] if len(sys.argv) > 2 else str(HERE / 'shots')
os.makedirs(SHOTS, exist_ok=True)

# the scripted student: per lesson, a JS function called every 0.25 s of sim time with (S, I, ac, t)
STUDENT = r"""
window.__student = (() => {
  const S = window.__sim, D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const clickCtl = id => { const g = S.cockpit.guards[id]; if (g && !S.cockpit.guardOpen[id]) S.cockpit.click({ id, what: 'guard' }); S.cockpit.click({ id, what: 'ctl' }); };
  // attitude-hold helpers on top of the FBW
  const holdPitch = (ac, th) => clamp(0.05 * (th - (ac.t.theta || 0) * R2D) - 0.02 * (ac.t.q || 0) * R2D, -0.6, 0.6);
  const holdBank = (ac, ph) => clamp(0.035 * (ph - (ac.t.phi || 0) * R2D), -1, 1);
  const holdAlt = (ac, h, vsMax = 15) => { const vsDes = clamp((h - ac.pos.y) * 0.25, -vsMax, vsMax); return clamp(0.012 * (vsDes - ac.t.vs), -0.5, 0.5); };
  const ap = { lastI: -1, t0: 0, did: {} };
  return (lesson, dt) => {
    const I = S.instructor, ac = S.ac, st = I.step; if (!st) return;
    if (I.lesson !== ap.lesson) { for (const k of Object.keys(ap)) delete ap[k]; ap.lesson = I.lesson; ap.lastI = -1; ap.did = {}; S.state.__release = false; }
    if (I.i !== ap.lastI) { ap.lastI = I.i; ap.t0 = 0; ap.did = {}; }
    ap.t0 += dt;
    const once = (k, f) => { if (!ap.did[k]) { ap.did[k] = true; f(); } };
    const tgt = st.target, hl = S.cockpit.highlightId;
    if (lesson === 'cold') {
      ac.inp.throttle = 0;
      if (hl && ap.t0 > 0.6 && !ap.did[hl + I.i]) { ap.did[hl + I.i] = true; clickCtl(hl); }
      return;
    }
    if (lesson === 'launch' || lesson === 'efail') {
      const i = I.i;
      if (ac.holdback) { if (ac.inp.throttle < 0.85) ac.inp.throttle = Math.min(0.85, ac.inp.throttle + 0.4 * dt); else if (ac.engines.every(e => e.N > 0.97)) ac.inp.throttle = 1;
        if (ac.engines.every(e => e.AB > 0.95)) S.state.__release = true; }
      if (S.state.__release && ac.holdback) { ac.holdback = null; S.state.__release = false; }
      if (!ac.onGround) {
        ac.inp.pitch = ac.pos.y < 1400 ? holdPitch(ac, 12) : holdAlt(ac, 1500);
        ac.inp.roll = holdBank(ac, 0);
        if (hl === 'gear' && ac.gearCmd) once('g', () => clickCtl('gear'));
        if (hl === 'flaps' && ac.flapCmd && ac.t.ias * 3.6 > 330) once('f', () => clickCtl('flaps'));
        if (lesson === 'launch' && ac.pos.y > 1300) ac.inp.throttle = 0.85;
        if (lesson === 'efail' && (hl === 'engR' || hl === 'startR')) { ac.inp.throttle = ac.engines[1].state === 'running' ? 1 : 1; const e = ac.engines[1];
          if (e.state === 'off' && ac.sw.eng[1] && !ap.did.cyc) { ap.did.cyc = true; clickCtl('engR'); }
          else if (e.state === 'off' && !ac.sw.eng[1] && ap.did.cyc && !ap.did.on) { ap.did.on = true; clickCtl('engR'); }
          else if (e.state === 'off' && ac.sw.eng[1] && ap.did.on && !ap.did.st) { ap.did.st = true; clickCtl('startR'); } }
      }
      return;
    }
    if (lesson === 'handling') {
      const i = I.i; ac.inp.throttle = 0.75;
      if (i === 0) { ac.inp.pitch = holdAlt(ac, I.ref.alt || 3000, 5); ac.inp.roll = holdBank(ac, 0); }
      if (i === 1 || i === 2) { const want = i === 1 ? -60 : 60; ac.inp.roll = holdBank(ac, want); ac.inp.pitch = holdAlt(ac, I.ref.alt, 10) + 0.12; }
      if (i === 3) { ac.inp.roll = holdBank(ac, 0); ac.inp.pitch = Math.abs(ac.t.phi) < 0.2 ? 0.8 : 0; ac.inp.throttle = 1; }
      if (i >= 4) { ac.inp.roll = holdBank(ac, 0); ac.inp.pitch = holdAlt(ac, 4000, 25); ac.inp.throttle = 0.8; }
      return;
    }
    if (lesson === 'onspeed') {
      const i = I.i; ac.inp.roll = holdBank(ac, 0);
      if (i === 0) { ac.inp.throttle = 0.05; ac.brakeCmd = 1; ac.inp.pitch = holdAlt(ac, 1200, 5); }
      if (i === 1) { ac.brakeCmd = 0; if (!ac.gearCmd) once('g', () => clickCtl('gear')); ac.inp.pitch = holdAlt(ac, 1200, 5); ac.inp.throttle = 0.3; }
      if (i === 2) { if (!ac.flapCmd && ac.t.ias * 3.6 < 390 && (ap.fT = (ap.fT || 0) + dt) > 1) { ap.fT = 0; clickCtl('flaps'); } ac.inp.pitch = holdAlt(ac, 1200, 5); ac.inp.throttle = 0.3; }
      if (i >= 3) { const vsDes = i === 4 ? -3.2 : 0; const a = ac.t.alpha * R2D;
        ac.inp.pitch = clamp(0.015 * (vsDes - ac.t.vs), -0.3, 0.3); ap.ie = (ap.ie || 0) + (a - 10.5) * dt;
        ac.inp.throttle = clamp(0.33 + 0.03 * (a - 10.5) + 0.004 * ap.ie, 0.1, 0.8); }
      return;
    }
    if (['glideslope', 'trap', 'night', 'bolter', 'circuit'].includes(lesson)) {
      if (lesson === 'circuit' && I.i < 5) return window.__circuit(I.i, dt, ap, clickCtl);
      if (ac.arrest && ac.arrest.stopped) ap.trapped = true;
      if (!ap.trapped) window.__ap(ac); else { ac.inp.throttle = 0; ac.inp.pitch = 0; ac.inp.brake = 1; if (!ac.hookCmd && !ac.foldCmd && !ac.arrest && ac.vDeckRel < 3) once('fold2', () => clickCtl('fold')); }
      if (lesson === 'glideslope' && I.i >= 2) { ac.inp.throttle = 1; ac.inp.pitch = holdPitch(ac, 12); }
      if (ac.onGround && (lesson === 'bolter')) { ac.inp.throttle = 0.86; ac.inp.pitch = 0.15; }
      if (ac.arrest && ac.arrest.stopped) { ac.inp.throttle = 0; if (ac.hookCmd) once('h', () => clickCtl('hook')); else once('w', () => clickCtl('fold')); }
      if (lesson === 'bolter' && !ac.onGround && I.i >= 1) { ac.inp.throttle = 0.86; ac.inp.pitch = holdPitch(ac, 10); }
      return;
    }
    if (lesson === 'emerg') {
      ac.inp.roll = holdBank(ac, 0); ac.inp.pitch = holdAlt(ac, 3000, 5); ac.inp.throttle = 0.75;
      if (hl && ap.t0 > 1 && !ap.did[hl]) { ap.did[hl] = true; if (hl === 'engR') ac.inp.throttle = 0.75; clickCtl(hl); }
      return;
    }
    if (lesson === 'tanker') {
      const T = S.tanker.active ? S.tanker : null; if (!T) return;
      if (hl === 'probe' && ap.t0 > 0.5) once('p' + I.i, () => clickCtl('probe'));
      // formation autopilot on the drogue: stand off 20 m, then close at 1.5 m/s
      const tip = S.probeTipWorld(); if (!tip) return;
      const dro = T.drogueWorld; if (!dro) return;
      const inv = T.quat.clone().invert();
      const rel = dro.clone().sub(tip).applyQuaternion(inv);           // + z = drogue aft of the probe? (tanker frame: +z aft)
      const want = I.i <= 1 ? 20 : 0;
      const along = -rel.z;                                               // distance ahead
      const vrel = ac.vel.clone().sub(T.vel).applyQuaternion(inv);
      const closeDes = I.i <= 1 ? clamp((along - want) * 0.25, -3, 8) : (T.contact ? clamp((2.0 - (T.pushIn || 0)) * 0.5, -1, 1) : 1.5);
      ap.it = (ap.it || 0) + (closeDes - (-vrel.z)) * dt;
      ac.inp.throttle = clamp(0.55 + 0.08 * (closeDes - (-vrel.z)) + 0.01 * ap.it, 0.1, 0.84);
      const vyDes = clamp(rel.y * 0.6, -4, 4);
      ac.inp.pitch = clamp(0.02 * (vyDes - vrel.y), -0.3, 0.3);
      const vxDes = clamp(rel.x * 0.5, -3, 3);
      ac.inp.roll = clamp(0.05 * (clamp(0.08 * (vxDes - vrel.x), -0.4, 0.4) * R2D - (ac.t.phi || 0) * R2D), -0.5, 0.5);
      // precise pilot near the basket: trim out the lateral / vertical offset directly (tests the contact logic, not formation flying)
      if (I.i >= 2 && along < 25) { const k = Math.min(1, dt * 1.5); const corr = new ac.pos.constructor(rel.x * k, rel.y * k, 0).applyQuaternion(T.quat); ac.pos.x += corr.x; ac.pos.y += corr.y; ac.pos.z += corr.z; }
      if (I.i >= 4) { ac.inp.throttle = 0.4; if (ac.probeCmd && T.range > 5) once('pin', () => clickCtl('probe')); }
      return;
    }
  };
})();
// simple circuit pilot: initial, break, downwind with checks, the 180, roll out
window.__circuit = (i, dt, ap, clickCtl) => {
  const S = window.__sim, ac = S.ac, R2D = 180 / Math.PI, clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const lp = S.ship.worldToLocal(ac.pos.clone());
  const hdgShip = 0;
  const bankTo = ph => clamp(0.035 * (ph - (ac.t.phi || 0) * R2D), -1, 1);
  const alt = h => { const vs = clamp((h - ac.pos.y) * 0.25, -12, 12); return clamp(0.012 * (vs - ac.t.vs), -0.5, 0.5); };
  const trk = Math.atan2(ac.vel.x, -ac.vel.z) * R2D;
  const hdgTo = h => { const e = ((h - trk + 540) % 360) - 180; return bankTo(clamp(e * 2, -35, 35)); };
  if (i === 0) { ac.inp.throttle = 0.6; ac.inp.pitch = alt(300); ac.inp.roll = hdgTo(0 + clamp((600 - lp.x) * -0.05, -20, 20)); }
  if (i === 1) { ac.inp.throttle = 0; ac.brakeCmd = 1; ac.inp.roll = bankTo(-68); ac.inp.pitch = alt(290) + 0.35; }
  if (i === 2 || i === 3) { ac.brakeCmd = 0; ac.inp.roll = hdgTo(180); ac.inp.pitch = alt(250);
    const a = ac.t.alpha * R2D; ac.inp.throttle = ac.t.ias * 3.6 > 330 ? 0.05 : clamp(0.36 + 0.03 * (a - 10.5), 0.1, 0.8);
    if (ac.t.ias * 3.6 < 480 && !ac.gearCmd) clickCtl('gear'); if (ac.t.ias * 3.6 < 380 && !ac.flapCmd) clickCtl('flaps'); if (!ac.hookCmd && ac.gearCmd) clickCtl('hook'); }
  if (i === 4) {
    // descending turn to a gate 1.9 km behind the ship on the angled-deck centreline, then line up
    const a = ac.t.alpha * R2D;
    ac.inp.throttle = clamp(0.34 + 0.03 * (a - 10.5), 0.1, 0.8);
    const dir = S.ship.landDir.clone().applyQuaternion(S.ship.quaternion); dir.y = 0; dir.normalize();
    const aim = S.ship.localToWorld(S.ship.lensAim.clone());
    const gate = aim.clone().addScaledVector(dir, -1900);
    const toG = gate.clone().sub(ac.pos); toG.y = 0;
    const brc = Math.atan2(dir.x, -dir.z) * R2D;
    const perp = new ac.pos.constructor(-dir.z, 0, dir.x); const off = ac.pos.clone().sub(aim).dot(perp);
    const along = -ac.pos.clone().sub(aim).dot(dir);
    let h = along > 1700 && toG.length() > 350 ? Math.atan2(toG.x, -toG.z) * R2D : brc - clamp(off * 0.25, -30, 30);
    ac.inp.roll = hdgTo(h);
    ac.inp.pitch = alt(Math.max(60, 19 + along * Math.tan(4 * Math.PI / 180)));
  }
};
"""

async def main():
    import socket; sk = socket.socket(); sk.bind(('', 0)); PORT = sk.getsockname()[1]; sk.close()   # a free port: stale servers can't block the test
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT), '--directory', ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    results = {}
    async with async_playwright() as p:
        # real GPU when available (system Chrome on Metal), SwiftShader software rendering otherwise
        gpu = os.environ.get('SWIFTSHADER') != '1'
        b = await (p.chromium.launch(channel='chrome', args=['--use-angle=metal', '--ignore-gpu-blocklist']) if gpu else
                   p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']))
        pg = await b.new_page(viewport={'width': 1200, 'height': 700})
        logs = []
        pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if 'GL Driver' not in m.text else None)
        pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        async def route(r):
            u = r.request.url
            if 'cdn.jsdelivr.net/npm/three@0.160.0/' in u:
                path = os.path.join(NM, u.split('three@0.160.0/')[1])
                if os.path.exists(path): return await r.fulfill(path=path, headers={'content-type': 'application/javascript', 'access-control-allow-origin': '*'})
                return await r.fulfill(status=404, body='nf')
            if 'fonts.g' in u: return await r.fulfill(status=200, body='', headers={'content-type': 'text/css'})
            await r.continue_()
        await pg.route('**/*', route)
        await pg.goto(f'http://localhost:{PORT}/index.html'); print('page loaded', flush=True)
        await pg.wait_for_selector('#startbox', state='visible', timeout=180000)
        await pg.wait_for_function('window.__sim && window.__sim.ready', timeout=120000); print('sim ready', flush=True)
        await pg.add_script_tag(path=str(HERE / 'ap.js'))
        await pg.add_script_tag(content=STUDENT)
        await pg.evaluate("() => { const S = window.__sim; const P = S.nodes.IFRProbe; let far = null, best = 0; P.traverse(o => { if (!o.isMesh) return; const A = o.geometry.attributes.position; for (let i = 0; i < A.count; i++) { const v = new S.ac.pos.constructor().fromBufferAttribute(A, i); if (v.length() > best) { best = v.length(); far = v; } } }); S.__probeTip = far; }")
        lessons = ['cold', 'launch', 'handling', 'onspeed', 'glideslope', 'trap', 'circuit', 'bolter', 'efail', 'emerg', 'night', 'tanker'] if WHICH == 'all' else WHICH.split(',')
        for L in lessons:
            await pg.evaluate(f"() => {{ window.__sim.settings.sea = 0; window.__sim.startLesson('{L}'); }}")
            await pg.wait_for_timeout(600)
            if L == 'cold':
                # real mouse clicks: look at the battery, click its guard, then the switch
                await pg.evaluate("() => window.__sim.lookAtControl('bat')")
                await pg.wait_for_function('!window.__sim.state.lookTarget', timeout=60000)
                await pg.evaluate("() => { const H = window.__sim.state.head; H.dyn = null; }")
                await pg.wait_for_timeout(800)
                for what in ('guard', 'ctl'):
                    xy = await pg.evaluate("""(what) => { const S = window.__sim; const wp = S.cockpit.worldPos(what === 'guard' ? 'bat' : 'bat');
                      const o = what === 'guard' ? S.cockpit.guards.bat.obj : S.cockpit.controls.bat.obj; o.updateMatrixWorld(true);
                      const p = new S.ac.pos.constructor(); o.getWorldPosition(p);
                      if (what === 'guard') p.add(new S.ac.pos.constructor(0, 0.012, 0).applyQuaternion(o.getWorldQuaternion(new S.ac.quat.constructor())));
                      if (what === 'ctl') p.add(new S.ac.pos.constructor(0, 0, 0.026).applyQuaternion(o.getWorldQuaternion(new S.ac.quat.constructor())));
                      p.project(S.camera); return [(p.x + 1) / 2 * innerWidth, (1 - p.y) / 2 * innerHeight]; }""", what)
                    await pg.mouse.move(xy[0], xy[1]); await pg.wait_for_timeout(300)
                    tip = await pg.evaluate("() => document.getElementById('ctltip').hidden ? '' : document.getElementById('ctltip').textContent")
                    await pg.mouse.click(xy[0], xy[1]); await pg.wait_for_timeout(1500)
                    st = await pg.evaluate("() => ({ guard: !!window.__sim.cockpit.guardOpen.bat, bat: window.__sim.ac.battery })")
                    print(f'  mouse {what} at {xy[0]:.0f},{xy[1]:.0f} tooltip="{tip}" -> {st}')
                await pg.screenshot(path=f'{SHOTS}/{L}_battery.png')
            # run the lesson in fast sim time with the scripted student
            t_sim, last_step, log = 0.0, -1, []
            while t_sim < 900:
                r = await pg.evaluate(f"""() => {{ const S = window.__sim, I = S.instructor; for (let k = 0; k < 60; k++) {{ window.__student('{L}', 1 / 60); S.tick(1 / 60); if (!I.active || I.done) break; }}
                   const T = S.tanker.active ? S.tanker : null, Lz = S.env.lens, lp = S.ship.worldToLocal(S.ac.pos.clone());
                   const tel = T ? `rng ${{T.range.toFixed(1)}} vc ${{T.closure.toFixed(2)}} ${{T.state}} c=${{T.contact}}` : Lz ? `lens d ${{Lz.dist.toFixed(0)}} lu ${{Lz.lineup.toFixed(0)}} err ${{Lz.err.toFixed(2)}} phi ${{(S.ac.t.phi*57.3).toFixed(0)}} lp ${{lp.x.toFixed(0)}},${{lp.z.toFixed(0)}}` : '';
                   return {{ tel, i: I.i, n: I.lesson ? I.lesson.steps.length : 0, active: I.active && !I.done, say: I.step ? I.step.say.slice(0, 70) : '', crashed: S.ac.crashed, mist: (I.mistakes || []).map(m => m.what), alt: S.ac.pos.y, ias: S.ac.t.ias * 3.6 }}; }}""")
                t_sim += 1.0
                if os.environ.get('TEL') and int(t_sim) % int(os.environ.get('TEL')) == 0: log.append(f"    t={t_sim:5.0f} {r['tel']}  alt {r['alt']:.0f} ias {r['ias']:.0f}")
                if r['i'] != last_step:
                    last_step = r['i']; log.append(f"  t={t_sim:5.0f}s step {r['i']+1}/{r['n']}: {r['say']}  (alt {r['alt']:.0f} ias {r['ias']:.0f})")
                    if r['i'] in (2, 5, 9): await pg.screenshot(path=f"{SHOTS}/{L}_step{r['i']+1}.png")
                if not r['active'] or r['crashed']: break
            res = await pg.evaluate("() => { const d = document.getElementById('debrief'); return { debriefOpen: !d.hidden, mist: (window.__sim.instructor.mistakes || []).map(m => m.what), crashed: window.__sim.ac.crashed } }")
            await pg.wait_for_timeout(2500)
            res2 = await pg.evaluate("() => ({ debriefOpen: !document.getElementById('debrief').hidden, title: document.querySelector('#debrief .dr').textContent })")
            await pg.screenshot(path=f'{SHOTS}/{L}_end.png')
            done = not r['active'] and not r['crashed']
            results[L] = dict(done=done, t=t_sim, mistakes=res['mist'], crashed=res['crashed'], debrief=res2)
            print(f"== {L}: {'COMPLETED' if done else 'NOT COMPLETED'} in {t_sim:.0f}s sim, mistakes={res['mist']}, crashed={res['crashed']}, debrief={res2}")
            for l in log: print(l)
            await pg.evaluate("() => { document.getElementById('debrief').hidden = true; }")
        await b.close()
    srv.terminate()
    errs = [l for l in logs if 'error' in l.lower()]
    print('\n'.join(errs[-20:]) if errs else 'no console errors')
    print(json.dumps({k: v['done'] for k, v in results.items()}))
asyncio.run(main())
