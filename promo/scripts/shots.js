// Film shots, captured from the live sim in ?capture mode. Each shot: setup() once, then step(i, t) before each
// rendered frame (inputs, events, extra physics), plus an optional camera hook. The runner screenshots every frame.
window.SHOTS = (() => {
  const S = window.__sim, D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const V = (x = 0, y = 0, z = 0) => new S.ac.pos.constructor(x, y, z);
  const Q = () => new S.ac.quat.constructor();
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const ease = t => t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;
  const ac = () => S.ac;
  // point the pilot's head at a world position, immediately
  const headAt = (wp, off = { yaw: 0, pitch: 0 }) => {
    S.renderStep(0.0001);
    const eye = S.camera.position.clone();
    const d = wp.clone().sub(eye).applyQuaternion(S.ac.quat.clone().invert());
    S.state.lookTarget = null;
    S.state.head.yaw = Math.atan2(-d.x, -d.z) + off.yaw; S.state.head.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)) + off.pitch;
  };
  const objPos = name => { const o = S.cockpit.root.getObjectByName(name); o.updateMatrixWorld(true); return o.getWorldPosition(V()); };
  const ctlPos = id => S.cockpit.worldPos(id);
  const fov = f => { S.state.fov = f; S.camera.fov = f; };
  const noHud = on => { document.getElementById('hud').style.visibility = on ? 'hidden' : 'visible'; };
  const coach = on => { document.getElementById('coach').style.display = on ? '' : 'none'; document.getElementById('coacharrow').style.display = on ? '' : 'none'; };
  // physics fast-forward that keeps the page's systems in step (instructor, ops, cockpit)
  const ff = (secs, ctl) => S.tick(secs, ctl);
  const shipW = (x, y, z) => S.ship.localToWorld(V(x, y, z));
  const cam = fn => { window.__camHook = fn; };
  const base = (tod, sea = 0) => { window.__holdInputs = true; S.settings.sea = sea; window.__camHook = null; noHud(false); coach(false); S.cockpit.highlightId = null; document.getElementById('debrief').hidden = true; document.getElementById('report').hidden = true; document.getElementById('replay').hidden = true; S.state.paused = false; return tod; };
  const approachAt = (dist, night = false) => {
    S.startScenario('approach', true, { night });
    const dir = S.ship.landDir.clone().applyQuaternion(S.ship.quaternion); dir.y = 0; dir.normalize();
    const aim = S.ship.localToWorld(S.ship.lensAim.clone());
    S.ac.pos.copy(aim).addScaledVector(dir, -dist); S.ac.pos.y = aim.y + dist * Math.tan(4 * D2R) - 0.9;
  };
  // the test autopilot rides slightly low (wire 1); fly it half a metre high so it takes the target wire 2
  const ap = () => { S.ac.pos.y -= 0.5; window.__ap(S.ac); S.ac.pos.y += 0.5; };
  const holdBank = (ph) => clamp(0.035 * (ph - (S.ac.t.phi || 0) * R2D), -1, 1);
  // the sea's look is visual only: show a moderate (or rough) sea even when the physics runs calm for the autopilot
  const seaVis = (k = 1) => { S.water.setSea(k); };
  // horizontal direction towards the sun (or moon) for lighting-aware camera placement
  const sunH = () => { const d = S.tod().lightAz ?? S.tod().az, el = S.tod().lightEl ?? S.tod().el; const v = V().setFromSphericalCoords(1, (90 - el) * D2R, d * D2R); v.y = 0; return v.normalize(); };
  const heading = () => { const v = S.ac.vel.clone(); v.y = 0; return v.normalize(); };

  return {
    // ---------------------------------------------------------------- cockpit, night: the guard lifts, battery ON, lamp test
    guard: { frames: 210, setup() { base(); S.startScenario('cold', true, { night: true, lesson: true }); S.applyTimeOfDay('night'); S.state.view = 'cockpit'; fov(30); S.renderStep(1 / 60);
        headAt(ctlPos('bat'), { yaw: -0.03, pitch: 0.02 }); },
      step(i, t) { if (i === 24) S.cockpit.setGuard('bat', true); if (i === 88) S.cockpit.activate('bat');
        S.state.fov = S.camera.fov = lerp(25, 18, ease(t / 3.5)); S.renderStep(1 / 60); } },
    // ---------------------------------------------------------------- caution panel during the lamp test, then master caution
    cwp: { frames: 180, setup() { base(); S.startScenario('cold', true, { night: true, lesson: true }); S.applyTimeOfDay('night'); S.state.view = 'cockpit'; S.renderStep(1 / 60);
        headAt(objPos('CWP_Screen'), { yaw: 0.0, pitch: 0.0 }); fov(20); },
      step(i, t) { if (i === 12) S.control('bat'); S.state.fov = S.camera.fov = lerp(21, 17, ease(t / 3)); S.renderStep(1 / 60); } },
    // ---------------------------------------------------------------- engine start: RPM and T4 needles climb (time-lapse 5x)
    gauges: { frames: 240, setup() { base(); S.startScenario('cold', true, { night: true, lesson: true }); S.applyTimeOfDay('night');
        const a = ac(); a.setBattery(true); a.setPump(true); a.setApu(true); ff(20); a.setEngineMaster(0, true); a.setEngineMaster(1, true);
        S.state.view = 'cockpit'; S.renderStep(1 / 60); const p = objPos('Gauge_rpm').add(objPos('Gauge_egt')).multiplyScalar(0.5); headAt(p); fov(18); },
      step(i, t) { if (i === 2) S.control('startL'); if (i === 70) S.control('startR'); ff(4 / 60); S.state.fov = S.camera.fov = lerp(19, 15.5, ease(t / 4)); S.renderStep(1 / 60); } },
    // ---------------------------------------------------------------- the instructor: lesson 1 at START L, highlight pulsing, coach panel
    instructor: { frames: 210, setup() { base(); coach(false); S.applyTimeOfDay('day'); S.startLesson('cold');
        const I = S.instructor; const click = id => { const g = S.cockpit.guards[id]; if (g && !S.cockpit.guardOpen[id]) S.cockpit.click({ id, what: 'guard' }); S.cockpit.click({ id, what: 'ctl' }); };
        for (let k = 0; k < 400 && I.i < 5; k++) { const h = S.cockpit.highlightId; S.ac.inp.throttle = 0; if (h && I.stepT > 0.5) click(h); ff(0.25); }
        S.state.view = 'cockpit'; S.renderStep(1 / 60); headAt(ctlPos('startL'), { yaw: -0.04, pitch: 0.03 }); fov(30); },
      step(i, t) { S.state.fov = S.camera.fov = lerp(31, 25, ease(t / 3.5)); S.renderStep(1 / 60); } },
    // ---------------------------------------------------------------- wings spread on deck, low orbiting camera (time-lapse 3.5x)
    wingfold: { frames: 240, setup() { base(); S.startScenario('cold', true, { lesson: true }); S.applyTimeOfDay('day'); const a = ac(); a.setEnginesRunning(); a.canopyCmd = 0; a.canopy = 0; a.fold = a.foldCmd = 1; S.state.view = 'orbit';
        ff(0.5); a.foldCmd = 0;
        cam((c, dt) => { const t = (window.__shotT || 0), a0 = Math.PI + 0.95 - 0.35 * ease(t / 4); const tgt = S.ac.pos.clone().add(V(0, 0.6, 1.5));
          c.position.copy(tgt).add(V(Math.sin(a0) * 19, 5.5 - 1.0 * ease(t / 4), Math.cos(a0) * 19).applyQuaternion(S.ship.quaternion)); c.up.set(0, 1, 0); c.lookAt(tgt); c.fov = 36; }); },
      step(i, t) { window.__shotT = t; ff(2.5 / 60); S.renderStep(1 / 60); } },
    // ---------------------------------------------------------------- full afterburner on the stops at dawn, low rear quarter
    ab_stops: { frames: 180, setup() { base(); S.startScenario('deck', true, { lesson: true }); S.applyTimeOfDay('dusk'); const a = ac(); a.inp.throttle = 1; ff(6, x => { x.inp.throttle = 1; }); S.state.view = 'orbit';
        cam((c) => { const t = window.__shotT || 0; const tgt = S.ac.pos.clone().add(V(0, 0.2, 6).applyQuaternion(S.ac.quat));
          const off = V(-11 + 1.5 * ease(t / 3), 0.4, 9.5 - 1.5 * ease(t / 3)).applyQuaternion(S.ship.quaternion);
          c.position.copy(S.ac.pos).add(off); c.position.y = S.ac.pos.y - 0.6; c.up.set(0, 1, 0); c.lookAt(tgt); c.fov = 38;
          c.position.x += Math.sin(t * 37) * 0.012; c.position.y += Math.sin(t * 43 + 1) * 0.012; }); },
      step(i, t) { window.__shotT = t; S.ac.inp.throttle = 1; S.renderStep(1 / 60); } },
    // ---------------------------------------------------------------- release: the jet thunders past a camera at the ramp edge
    launch_side: { frames: 300, setup() { base(); S.startScenario('deck', true, { lesson: true }); S.applyTimeOfDay('dusk'); const a = ac(); ff(6, x => { x.inp.throttle = 1; }); S.state.view = 'orbit';
        const cp = shipW(-13, 19 + 1.6, -112);
        cam((c) => { c.position.copy(cp); c.up.set(0, 1, 0); const tgt = S.ac.pos.clone().add(V(0, 0.6, 0)); c.lookAt(tgt);
          const d = cp.distanceTo(S.ac.pos); c.fov = clamp(2 * Math.atan(6.5 / d) * R2D, 3.5, 55); }); },
      step(i, t) { S.ac.inp.throttle = 1; if (i === 12) S.ac.holdback = null; S.ac.inp.pitch = S.ac.onGround ? 0 : 0.18; if (!S.ac.onGround && S.ac.gearCmd && t > 3.2) S.control('gear'); S.renderStep(1 / 60); } },
    // ---------------------------------------------------------------- the same launch from the cockpit: the shove, the ramp, the sky
    launch_ck: { frames: 210, setup() { base(); S.startScenario('deck', true, { lesson: true }); S.applyTimeOfDay('dusk'); ff(6, x => { x.inp.throttle = 1; }); S.state.view = 'cockpit'; S.state.head.yaw = 0; S.state.head.pitch = -6 * D2R; fov(62); },
      step(i, t) { S.ac.inp.throttle = 1; if (i === 20) S.ac.holdback = null; S.ac.inp.pitch = S.ac.onGround ? 0 : 0.2; S.renderStep(1 / 60); } },
    // ---------------------------------------------------------------- climb-out chase at dawn, gear coming up
    climb: { frames: 180, setup() { base(); S.startScenario('deck', true, { lesson: true }); S.applyTimeOfDay('dusk'); ff(6, x => { x.inp.throttle = 1; }); S.ac.holdback = null;
        ff(4.2, x => { x.inp.throttle = 1; x.inp.pitch = x.onGround ? 0 : 0.2; }); S.control('gear'); S.state.view = 'orbit';
        cam((c) => { const t = window.__shotT || 0; const a0 = -0.9 - 0.5 * t / 3; const off = V(Math.sin(a0) * 22, 3 - t * 0.5, Math.cos(a0) * 22).applyQuaternion(S.ac.quat);
          c.position.copy(S.ac.pos).add(off); c.up.copy(V(0, 1, 0).applyQuaternion(S.ac.quat)).lerp(V(0, 1, 0), 0.5).normalize(); c.lookAt(S.ac.pos); c.fov = 34; }); },
      step(i, t) { window.__shotT = t; S.ac.inp.throttle = 1; S.ac.inp.pitch = holdPitchTo(12); S.ac.inp.roll = holdBank(0); S.renderStep(1 / 60); } },
    // ---------------------------------------------------------------- high-g turn over the sea: LERX vapour, wingtip vortices
    highg: { frames: 240, setup() { base(); S.startScenario('free', true, { alt: 700, speed: 175, lesson: true }); S.applyTimeOfDay('day'); S.ac.inp.throttle = 1;
        ff(1.5, x => { x.inp.roll = holdBank(-72); x.inp.pitch = 0; x.inp.throttle = 1; }); ff(1.5, x => { x.inp.roll = holdBank(-72); x.inp.pitch = 0.95; x.inp.throttle = 1; });
        S.state.view = 'orbit';
        cam((c) => { const t = window.__shotT || 0; const off = V(-5.5 + 3 * ease(t / 4), -3.2, 15 - 3 * ease(t / 4)).applyQuaternion(S.ac.quat);
          c.position.copy(S.ac.pos).add(off); c.up.copy(V(0, 1, 0).applyQuaternion(S.ac.quat)); c.lookAt(S.ac.pos.clone().add(V(0, 0, -2).applyQuaternion(S.ac.quat))); c.fov = 42; }); },
      step(i, t) { window.__shotT = t; S.ac.inp.roll = holdBank(-72); S.ac.inp.pitch = 0.95; S.ac.inp.throttle = 1; S.renderStep(1 / 60); } },
    // ---------------------------------------------------------------- 7 g from the seat: grey-out creeping in
    greyout: { frames: 170, setup() { base(); S.startScenario('free', true, { alt: 1500, speed: 230, lesson: true }); S.applyTimeOfDay('day'); S.state.view = 'cockpit'; S.state.head.yaw = 0.35; S.state.head.pitch = 0.05; fov(64);
        ff(1.2, x => { x.inp.roll = holdBank(-78); x.inp.pitch = 0; x.inp.throttle = 1; }); S.state.gEff = 6.6; },
      step(i, t) { S.ac.inp.roll = holdBank(-78); S.ac.inp.pitch = 1; S.ac.inp.throttle = 1; S.renderStep(1 / 60); } },
    // ---------------------------------------------------------------- in the groove: the ball, the HUD, the deck ahead
    groove: { frames: 200, setup() { base(); approachAt(1100); S.applyTimeOfDay('day'); S.ac.inp.throttle = 0.3; ff(4, ap); S.state.view = 'cockpit'; S.state.head.yaw = 0.01; S.state.head.pitch = -9 * D2R; fov(30); },
      step(i, t) { ap(); S.state.fov = S.camera.fov = lerp(30, 26, ease(t / 3.3)); S.renderStep(1 / 60); } },
    // ---------------------------------------------------------------- the trap from deck level at 4x slow motion (1/240 s per frame)
    trap_deck: { frames: 600, setup() { base(); approachAt(420); S.applyTimeOfDay('day'); S.ac.inp.throttle = 0.3; ff(1, ap); S.state.view = 'orbit';
        const wire = S.ship.localToWorld(S.ship.wires[1].c.clone());
        const cp = S.ship.localToWorld(V(-24, 19.6, 92));
        cam((c) => { c.position.copy(cp); c.up.set(0, 1, 0); const tgt = S.ac.pos.clone().add(V(0, 0.2, 0)); c.lookAt(tgt);
          const d = cp.distanceTo(S.ac.pos); c.fov = clamp(2 * Math.atan(13 / d) * R2D, 7, 50); });
        // skip ahead to about 1.3 s before touchdown
        for (let k = 0; k < 400; k++) { const lp = S.ship.worldToLocal(S.ac.pos.clone()); if (lp.z < 175) break; ff(1 / 60, ap); } },
      step(i, t) { if (!S.ac.arrest) ap(); else { S.ac.inp.throttle = S.ac.arrest.stopped ? 0 : 0.86; S.ac.inp.pitch = 0; } S.renderStep(1 / 240); } },
    // ---------------------------------------------------------------- night: the groove with deck lights and the ball
    night_groove: { frames: 200, setup() { base(); approachAt(1300, true); S.applyTimeOfDay('night'); S.renderer.toneMappingExposure = 1.7; S.ac.inp.throttle = 0.3; ff(4, ap); S.state.view = 'cockpit'; S.state.head.yaw = 0.01; S.state.head.pitch = -10 * D2R; fov(34); },
      step(i, t) { ap(); S.renderStep(1 / 60); } },
    // ---------------------------------------------------------------- night: close chase, nav lights, carrier lights ahead
    night_chase: { frames: 200, setup() { base(); approachAt(1500, true); S.applyTimeOfDay('night'); S.renderer.toneMappingExposure = 2.1; S.ac.inp.throttle = 0.3; ff(3, ap); S.state.view = 'orbit';
        cam((c) => { const t = window.__shotT || 0; const off = V(8 - 2.5 * ease(t / 3.3), 3.2, 24).applyQuaternion(S.ac.quat); c.position.copy(S.ac.pos).add(off); c.up.set(0, 1, 0);
          c.lookAt(S.ac.pos.clone().add(V(-2, -3, -60).applyQuaternion(S.ac.quat))); c.fov = 36; }); },
      step(i, t) { window.__shotT = t; ap(); S.renderStep(1 / 60); } },
    // ---------------------------------------------------------------- engine fire: FIRE R, master warning, from the seat
    fire: { frames: 190, setup() { base(); S.startScenario('free', true, { alt: 3000, lesson: true }); S.applyTimeOfDay('day'); S.state.view = 'cockpit'; S.renderStep(1 / 60);
        headAt(objPos('CWP_Screen'), { yaw: 0.02, pitch: 0.01 }); fov(24); },
      step(i, t) { if (i === 18) S.ac.fireEngine(1); S.ac.inp.roll = holdBank(0); S.state.fov = S.camera.fov = lerp(24, 19, ease(t / 3.2)); S.renderStep(1 / 60); } },
    // ---------------------------------------------------------------- refuelling: probe into the basket, from between the jets
    tanker_chase: { frames: 270, setup() { base(); S.startScenario('tanker', true, { lesson: true }); S.applyTimeOfDay('day'); S.control('probe'); ff(3.5);
        placeBehindDrogue(4.2); S.state.view = 'orbit';
        cam((c) => { const t = window.__shotT || 0; const T = S.tanker; const mid = T.drogueWorld.clone().lerp(S.probeTipWorld() || S.ac.pos, 0.5);
          const off = V(-6.5 + 1.5 * ease(t / 4.5), 1.8, -1 + 3 * ease(t / 4.5)).applyQuaternion(T.quat); c.position.copy(mid).add(off); c.up.set(0, 1, 0); c.lookAt(mid); c.fov = 46; }); },
      step(i, t) { window.__shotT = t; formation(1.5); S.renderStep(1 / 60); } },
    tanker_ck: { frames: 200, setup() { base(); S.startScenario('tanker', true, { lesson: true }); S.applyTimeOfDay('day'); S.control('probe'); ff(3.5); placeBehindDrogue(3.2);
        S.state.view = 'cockpit'; S.renderStep(1 / 60); headAt(S.tanker.drogueWorld, { yaw: -0.25, pitch: -0.02 }); fov(58); },
      step(i, t) { formation(1.2); S.renderStep(1 / 60); } },
    // ---------------------------------------------------------------- end card: dusk, hero jet on the deck, slow push-in
    hero: { frames: 420, setup() { base(); S.startScenario('deck', true, { lesson: true }); S.applyTimeOfDay('dusk'); const a = ac(); a.inp.throttle = 0; a.holdback = null; a.parkBrake = true; S.ship.jbd[0].rotation.x = Math.PI / 2; S.state.view = 'orbit';
        cam((c) => { const t = window.__shotT || 0; const a0 = Math.PI + 0.62 - 0.22 * ease(t / 7); const tgt = S.ac.pos.clone().add(V(0, 0.9, -1.5).applyQuaternion(S.ship.quaternion)); const d = 23 - 5 * ease(t / 7);
          c.position.copy(tgt).add(V(Math.sin(a0) * d, 0.35 + 0.4 * ease(t / 7), Math.cos(a0) * d).applyQuaternion(S.ship.quaternion)); c.up.set(0, 1, 0); c.lookAt(tgt); c.fov = 28; }); },
      step(i, t) { window.__shotT = t; S.renderStep(1 / 60); } },
    // ---------------------------------------------------------------- UI stills: training menu, debrief after a trap lesson, instant replay
    ui_menu: { frames: 1, setup() { base(); S.postfx.post.opts.mb = 0; S.applyTimeOfDay('dusk'); S.startScenario('deck', false); S.state.view = 'orbit'; S.state.started = false; S.state.paused = true;
        document.getElementById('menu').hidden = false; document.getElementById('startbox').hidden = false; document.getElementById('loading').hidden = true; },
      step() { S.state.orbit.yaw = 2.2; for (let k = 0; k < 4; k++) S.renderStep(1 / 60); } },
    ui_debrief: { frames: 1, setup() { base(); S.postfx.post.opts.mb = 0; S.startScenario('approach', true, { lesson: true }); S.applyTimeOfDay('day'); S.ac.inp.throttle = 0.3;
        for (let k = 0; k < 9000 && !(S.ac.arrest && S.ac.arrest.stopped) && !S.ac.crashed; k++) ff(1 / 60, x => { if (!x.arrest) ap(); else x.inp.throttle = 0.86; });
        ff(2, x => { x.inp.throttle = 0; });
        window.__trapReport = S.ops.report; S.debrief.show({ title: '6. The trap', ok: true, pts: 96, stars: 3, time: 118, mistakes: [], metrics: { gs: 0.08, lu: 0.1, aoa: 0.4 }, id: 'trap', next: 'circuit' });
        S.state.view = 'deck'; },
      step() { S.renderStep(1 / 60); } },
    // ================================================================ 2026-10 recut: hero and flight shots
    // dawn on deck: a slow lateral dolly along the nose, the jet lit by the low sun, the sea alive behind
    hero_open: { frames: 300, setup() { base(); S.startScenario('deck', true, { lesson: true }); S.applyTimeOfDay('dusk'); seaVis(1); const a = ac(); a.inp.throttle = 0; a.holdback = null; a.parkBrake = true; S.ship.jbd[0].rotation.x = Math.PI / 2; S.state.view = 'orbit'; noHud(true);
        const sh = sunH();
        cam((c) => { const t = window.__shotT || 0, k = ease(t / 5); const tgt = S.ac.pos.clone().add(V(0, 1.0, -2.5).applyQuaternion(S.ship.quaternion));
          const side = V(-sh.z, 0, sh.x); const p = tgt.clone().addScaledVector(sh, 13 - 3 * k).addScaledVector(side, -7 + 9 * k); p.y = tgt.y - 0.2 + 0.5 * k;
          c.position.copy(p); c.up.set(0, 1, 0); c.lookAt(tgt); c.fov = 30 - 3 * k; }); },
      step(i, t) { window.__shotT = t; S.renderStep(1 / 60); } },
    // a low pass over the ocean: rooster tail, heat haze, whitecaps; a sea-level camera pans with it
    flyby_low: { frames: 330, setup() { base(); S.startScenario('free', true, { alt: 13, speed: 255, lesson: true }); S.applyTimeOfDay('day'); seaVis(1.1); S.ac.inp.throttle = 1; S.state.view = 'orbit'; noHud(true);
        ff(0.3, x => { x.inp.throttle = 1; x.inp.pitch = 0; });
        const hd = heading(), rt = V(-hd.z, 0, hd.x); const cp = S.ac.pos.clone().addScaledVector(hd, 255 * 2.6).addScaledVector(rt, 34); cp.y = 4.5;
        cam((c) => { c.position.copy(cp); c.up.set(0, 1, 0); const tgt = S.ac.pos.clone().add(V(0, -1.5, 0)); c.lookAt(tgt);
          const d = cp.distanceTo(S.ac.pos); c.fov = clamp(2 * Math.atan(9 / d) * R2D, 4, 62); }); },
      step(i, t) { S.ac.inp.throttle = 1; S.ac.pos.y += (13 - S.ac.pos.y) * 0.1; S.ac.vel.y *= 0.8; S.ac.inp.roll = holdBank(0); S.renderStep(1 / 60); } },
    // banking over the cloud tops in the sun: volumetric clouds below, flare
    clouds: { frames: 270, setup() { base(); S.startScenario('free', true, { alt: 1250, speed: 210, lesson: true }); seaVis(1); S.applyTimeOfDay('day'); S.ac.inp.throttle = 0.9; S.state.view = 'orbit'; noHud(true);
        ff(2.5, x => { x.inp.roll = holdBank(-48); x.inp.pitch = 0.25; x.inp.throttle = 0.9; });
        cam((c) => { const t = window.__shotT || 0, k = ease(t / 4.5); const off = V(7 - 4 * k, -3.8, 21 - 4 * k).applyQuaternion(S.ac.quat);
          c.position.copy(S.ac.pos).add(off); c.up.copy(V(0, 1, 0).applyQuaternion(S.ac.quat)).lerp(V(0, 1, 0), 0.55).normalize(); c.lookAt(S.ac.pos.clone().add(V(0, 2.5, -4).applyQuaternion(S.ac.quat))); c.fov = 44; }); },
      step(i, t) { window.__shotT = t; S.ac.inp.roll = holdBank(-48); S.ac.inp.pitch = 0.25; S.ac.inp.throttle = 0.9; S.renderStep(1 / 60); } },
    // a full aileron roll from a level chase camera (it does not roll with the jet)
    roll: { frames: 180, setup() { base(); S.startScenario('free', true, { alt: 900, speed: 230, lesson: true }); S.applyTimeOfDay('day'); seaVis(1); S.ac.inp.throttle = 1; S.state.view = 'orbit'; noHud(true);
        ff(1, x => { x.inp.roll = holdBank(0); x.inp.throttle = 1; });
        cam((c) => { const t = window.__shotT || 0; const hd = heading(), rt = V(-hd.z, 0, hd.x);
          c.position.copy(S.ac.pos).addScaledVector(hd, -17).addScaledVector(rt, 6.5 - 2 * ease(t / 3)).add(V(0, 2.2, 0)); c.up.set(0, 1, 0); c.lookAt(S.ac.pos.clone().addScaledVector(hd, 4)); c.fov = 38; }); },
      step(i, t) { window.__shotT = t; S.ac.inp.throttle = 1; S.ac.inp.pitch = 0.04; S.ac.inp.roll = t > 0.5 && t < 2.05 ? 1 : holdBank(0); S.renderStep(1 / 60); } },
    // transonic: the Prandtl-Glauert vapour cone at Mach 0.98, low over the sea, camera ahead and to the side
    vapour: { frames: 200, setup() { base(); S.startScenario('free', true, { alt: 160, speed: 334, lesson: true }); S.applyTimeOfDay('day'); seaVis(1); S.ac.inp.throttle = 1; S.state.view = 'orbit'; noHud(true);
        ff(0.5, x => { x.inp.throttle = 1; x.inp.roll = holdBank(0); x.vel.setLength(327); });
        cam((c) => { const t = window.__shotT || 0, k = ease(t / 3.3); const hd = heading(), rt = V(-hd.z, 0, hd.x);
          c.position.copy(S.ac.pos).addScaledVector(hd, 14 - 26 * k).addScaledVector(rt, 11).add(V(0, 1.2, 0)); c.up.set(0, 1, 0); c.lookAt(S.ac.pos); c.fov = 46; }); },
      step(i, t) { window.__shotT = t; S.ac.inp.throttle = 1; S.ac.inp.roll = holdBank(0); S.ac.inp.pitch = 0.02 + 0.03 * Math.sin(t * 3); S.ac.vel.setLength(327); S.renderStep(1 / 60); } },
    // the carrier in a rough sea: green water at the bow, spray, whitecaps, a wet deck
    storm: { frames: 270, setup() { base(); S.settings.sea = 1.8; S.startScenario('deck', true, { lesson: true }); S.applyTimeOfDay('day'); S.ship.setSea(1.8); seaVis(1.8); S.state.view = 'orbit'; noHud(true);
        for (let k = 0; k < 240; k++) S.renderStep(1 / 30);      // let the spray and the deck motion build up
        cam((c) => { const t = window.__shotT || 0, k = ease(t / 4.5); const p = S.ship.localToWorld(V(-70 + 10 * k, 9, -170 + 14 * k)); p.y = 7 + 1.5 * Math.sin(t * 0.9);
          c.position.copy(p); c.up.set(0, 1, 0); c.lookAt(S.ship.localToWorld(V(0, 18, -70))); c.fov = 42; }); },
      step(i, t) { window.__shotT = t; S.renderStep(1 / 60); } },
    // finale: dusk, the jet on deck from a low front quarter, slow push-in
    hero_end: { frames: 420, setup() { base(); S.startScenario('deck', true, { lesson: true }); S.applyTimeOfDay('dusk'); seaVis(1); const a = ac(); a.inp.throttle = 0; a.holdback = null; a.parkBrake = true; S.ship.jbd[0].rotation.x = Math.PI / 2; S.state.view = 'orbit'; noHud(true);
        cam((c) => { const t = window.__shotT || 0; const a0 = Math.PI + 0.62 - 0.22 * ease(t / 7); const tgt = S.ac.pos.clone().add(V(0, 0.9, -1.5).applyQuaternion(S.ship.quaternion)); const d = 23 - 5 * ease(t / 7);
          c.position.copy(tgt).add(V(Math.sin(a0) * d, 0.35 + 0.4 * ease(t / 7), Math.cos(a0) * d).applyQuaternion(S.ship.quaternion)); c.up.set(0, 1, 0); c.lookAt(tgt); c.fov = 28; }); },
      step(i, t) { window.__shotT = t; S.renderStep(1 / 60); } },
  };
  function holdPitchTo(th) { return clamp(0.05 * (th - (S.ac.t.theta || 0) * R2D) - 0.02 * (S.ac.t.q || 0) * R2D, -0.6, 0.6); }
  function placeBehindDrogue(dist) {
    const T = S.tanker; const tip = S.probeTipWorld(); if (!tip) return;
    const want = T.drogueWorld.clone().add(V(0, 0, dist).applyQuaternion(T.quat));
    S.ac.pos.add(want.sub(tip)); S.ac.vel.copy(T.vel); S.ac.quat.copy(T.quat); S.ac.omega.set(0, 0, 0); ff(0.3, () => formation(0));
  }
  // precise formation: hold the probe on the drogue axis, close at `closing` m/s, then hold the push-in
  function formation(closing) {
    const T = S.tanker, a = S.ac, tip = S.probeTipWorld(); if (!tip || !T.drogueWorld) return;
    const inv = T.quat.clone().invert(); const rel = T.drogueWorld.clone().sub(tip).applyQuaternion(inv);
    const vrel = a.vel.clone().sub(T.vel).applyQuaternion(inv);
    const want = T.contact ? clamp((2.0 - (T.pushIn || 0)) * 0.5, -1, 1) : closing;
    a.inp.throttle = clamp(0.56 + 0.1 * (want - (-vrel.z)), 0.1, 0.84);
    const k = 0.04; const corr = V(rel.x * k, rel.y * k, 0).applyQuaternion(T.quat); a.pos.add(corr);
    a.vel.copy(T.vel).add(V(0, 0, -(want)).applyQuaternion(T.quat)); a.quat.slerp(T.quat, 0.05); a.omega.multiplyScalar(0.8);
  }
})();
