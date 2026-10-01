// "CLEARED HOT" (2026-10 recut): 64.6 s launch film for the MiG-29K Carrier Sim, hero jet shots first.
// Same Lyria score and beat map as the first cut (120 BPM, 2 s bars: build 0-16, drop 16, drive to 42,
// breakdown 42-50, rebuild 50, finale hit 58). The first cut's edit is kept in scenes_v1_cleared_hot.js.
const W = 1920, H = 1080;
const TT = '../build/tt';

// ================================================================ ACT 1  HERO  (0 - 16)
tl.set(blackEl, { opacity: 1 }, 0);
fadeBlack(0.05, 0, 1.1);
sfx(0.0, 'drone', 0.6);
// 0.0 dawn on deck: a slow dolly along the nose
const cHo = clip('hero_open', 0.0, 4.2, { frames: 300, f0: 18 }); push(cHo, 1.0, 1.05, -20, 0);
el('INAS 303 · BLACK PANTHERS · 817', 0.5, 4.0, { left: '90px', top: '84px' }, 'mono');
display('This is the|<span class="sf">MiG-29K.</span>', 1.0, 4.05, { left: '90px', bottom: '130px', fontSize: '170px' }, { cls: 'shadow', out: 'blur' });
vo(0.95, 'h01');
tex('leak', 0.2, 4.2, { opacity: 0, x: -200 }, { opacity: 0.45, x: 120 });

// 4.2 a low pass over the ocean: the jet screams past a camera at the waterline
const cFl = clip('flyby_low', 4.2, 8.0, { frames: 330, f0: 40 });
flash(4.2, 0.35, 0.3); sfx(4.2, 'whoosh', 0.6);
sfx(5.75, 'flyby', 1.3); shake(6.1, 14, 0.6); flash(6.12, 0.25, 0.2);
display('Low over|<span class="sf">a living sea.</span>', 4.5, 7.9, { left: '90px', top: '110px', fontSize: '128px' }, { cls: 'shadow' });
vo(4.5, 'h02');
chips(['<b>13 m</b>Above the waves', '<b>920</b>km/h', 'Rooster-tail spray'], 6.4, 7.95, { left: '90px', bottom: '96px' }, 0.22);

// 8.0 a climbing turn into the sun
const cSun = clip('clouds', 8.0, 12.0, { frames: 270, f0: 20 }); push(cSun, 1.0, 1.06, 0, -10);
flash(8.0, 0.55, 0.35); sfx(8.0, 'hit', 0.7);
tex('flare', 8.1, 11.9, { opacity: 0, x: -500, scaleY: 0.5 }, { opacity: 0.55, x: 300 }, 'power1.out');
display('Into|<span class="sf">the sun.</span>', 8.35, 11.9, { right: '90px', bottom: '130px', fontSize: '160px', textAlign: 'right' }, { cls: 'shadow' });
vo(8.4, 'h03');
chips(['Physically based sky', 'Volumetric clouds', 'HDR + bloom'], 9.2, 11.9, { right: '90px', top: '110px' }, 0.2);
brackets(8.0, 12.0);

// 12.0 Blender: glowing wireframe on a blueprint, a scan line reveals the Cycles render
tex('blueprint', 11.99, 16.0, { opacity: 0.55, scale: 1.0, mixBlendMode: 'normal' }, { scale: 1.06 });
const cWire = clip('wire', 12.0, 16.0, { dir: `${TT}/wire`, frames: 300, f0: 20, nograde: true });
const cBeauty = clip('beauty', 12.0, 16.0, { dir: `${TT}/beauty`, frames: 300, f0: 20, nograde: true });
cWire.el.style.mixBlendMode = 'screen'; cWire.img.style.filter = 'brightness(1.9) contrast(1.8) saturate(1.4)';
tl.set(cBeauty.el, { clipPath: 'inset(0 100% 0 0)' }, 12.0);
tl.to(cBeauty.el, { clipPath: 'inset(0 0% 0 0)', duration: 1.1, ease: 'power2.inOut', immediateRender: false }, 12.9);
{ const g = group(12.9, 14.1); svgEl('rect', { x: 0, y: 0, width: 5, height: 1080, fill: '#6fd3ff' }, g);
  svgEl('rect', { x: 0, y: 0, width: 2, height: 1080, fill: '#e8fbff' }, g);
  tl.fromTo(g, { x: 0 }, { x: 1920, duration: 1.1, ease: 'power2.inOut', immediateRender: false }, 12.9); }
flash(12.0, 0.6, 0.4); sfx(12.0, 'hit', 0.9);
el('<div class="kick" style="color:#6fd3ff">Built in Blender</div>', 12.3, 15.9, { left: '90px', top: '90px' });
display('Down to|<span class="cy">every hinge.</span>', 13.0, 15.9, { left: '90px', bottom: '150px', fontSize: '140px' }, { cls: 'shadow' });
chips(['163 parts', '4K PBR', 'Live control surfaces'], 13.6, 15.9, { left: '90px', bottom: '80px' }, 0.2);
{ const g = group(12.2, 13.9);
  for (const [d, t] of [['M1180,300 L1180,250 L1780,250 L1780,300', 12.25], ['M1140,820 L1860,820', 12.45], ['M1860,800 L1860,840 M1140,800 L1140,840', 12.5]]) { const p = svgEl('path', { d, fill: 'none', stroke: '#6fd3ff', 'stroke-width': 2, opacity: 0.8 }, g); draw(p, t, 0.6); }
  const t1 = svgEl('text', { x: 1480, y: 236, fill: '#6fd3ff', 'font-family': 'Mono', 'font-size': 22, 'text-anchor': 'middle', 'letter-spacing': 3 }, g); t1.textContent = 'SPAN 11.99 M';
  const t2 = svgEl('text', { x: 1500, y: 862, fill: '#6fd3ff', 'font-family': 'Mono', 'font-size': 22, 'text-anchor': 'middle', 'letter-spacing': 3 }, g); t2.textContent = 'LENGTH 17.3 M';
  tl.fromTo([t1, t2], { opacity: 0 }, { opacity: 1, duration: 0.3, immediateRender: true }, 12.7); }
vo(13.0, 'v04');
sfx(14.0, 'riser', 1);

// ================================================================ ACT 2  THE DROP  (16 - 42)
// 16.0 full afterburner on the restraining stops (dawn), heat haze behind the nozzles
const cAB = clip('ab_stops', 16.0, 17.2, { frames: 180, f0: 60 }); push(cAB, 1.08, 1.0);
flash(16.0, 1, 0.45); sfx(16.0, 'boom', 1.2); sfx(16.0, 'roar', 1); shake(16.0, 10, 0.4);
tex('leak', 16.0, 17.2, { opacity: 0.0, x: -200 }, { opacity: 0.75, x: 100 });
display('Full|<span class="out">afterburner.</span>', 16.1, 17.2, { left: '90px', top: '110px', fontSize: '170px' }, { cls: 'shadow', dur: 0.4, stagger: 0.06 });
el('<div class="chip"><b>ЧР</b>Emergency take-off rating</div>', 16.35, 17.2, { left: '90px', bottom: '100px' });
vo(16.25, 'v05');
// 17.52 release: the cockpit shove, then the jet thunders off the ramp past the camera
const cLck = clip('launch_ck', 17.2, 19.2, { frames: 210, f0: 1 });
flash(17.52, 1, 0.45); shake(17.52, 22, 0.8); sfx(17.52, 'impact', 1.3); bars(17.4, true);
const cLs = clip('launch_side', 19.2, 21.3, { frames: 300, f0: 162, speed: 66 });
sfx(19.1, 'flyby', 1.2);
{ const box = el('<small>Airspeed · km/h</small><span id="kmh">0</span>', 17.6, 21.25, { right: '120px', bottom: '160px', fontSize: '64px' }, 'readout');
  counter(box.querySelector('#kmh'), 0, 287, 17.6, 3.3, v => Math.round(v), 'power1.in');
  chips(['195 m deck run', '14° ski-jump', 'No catapult'], 17.9, 21.25, { left: '120px', bottom: '160px' }, 0.3); }
const cClimb = clip('climb', 21.3, 24.0, { frames: 180, f0: 0, speed: 62 });
sfx(21.3, 'whoosh', 0.6);
display('Ski-jump.|<span class="sf">No catapult.</span>', 22.0, 23.9, { left: '120px', top: '150px', fontSize: '150px' }, { cls: 'shadow', dur: 0.35, stagger: 0.05 });
flash(22.0, 0.45, 0.25); sfx(22.0, 'hit', 0.8);
bars(23.8, false);

// 24.0 a full aileron roll
const cRoll = clip('roll', 24.0, 26.0, { frames: 180, f0: 22 }); push(cRoll, 1.0, 1.05);
flash(24.0, 0.7, 0.3); sfx(24.0, 'boom', 0.9); sfx(24.45, 'whoosh', 0.9);
{ const d = display('205<span style="font-size:.42em">°/S</span>', 24.05, 25.95, { right: '110px', top: '60px', fontSize: '300px' }, { cls: 'out shadow', dur: 0.4 });
  d.style.webkitTextStroke = '4px #eef3f8'; }
vo(24.2, 'h04');
el('<div class="kick" style="color:#eef3f8">Roll rate · fly-by-wire</div>', 24.4, 25.95, { left: '110px', bottom: '100px' });

// 26.0 transonic: the vapour cone at Mach 0.98
const cVap = clip('vapour', 26.0, 28.0, { frames: 200, f0: 50 }); push(cVap, 1.0, 1.07, 20, 0);
flash(26.0, 0.8, 0.3); sfx(26.0, 'hit', 0.9); sfx(26.1, 'flyby', 1.0);
display('The edge|<span class="sf">of sound.</span>', 26.15, 27.95, { left: '110px', top: '110px', fontSize: '140px' }, { cls: 'shadow', dur: 0.4, stagger: 0.06 });
vo(26.2, 'h05');
chips(['<b>M 0.98</b>', 'Vapour cone'], 26.7, 27.95, { left: '110px', bottom: '100px' }, 0.2);

// 28.0 eight g, vapour off the LERX; 30.0 grey-out from the seat
const cHg = clip('highg', 28.0, 30.0, { frames: 240, f0: 60 }); push(cHg, 1.0, 1.08);
flash(28.0, 0.8, 0.3); sfx(28.0, 'boom', 1); sfx(28.0, 'vortex', 0.8);
{ const d = display('8<span style="font-size:.5em">G</span>', 28.05, 31.9, { right: '110px', top: '40px', fontSize: '470px' }, { cls: 'out shadow', dur: 0.4 });
  d.style.webkitTextStroke = '4px #eef3f8'; }
chips(['Fly-by-wire', 'AoA limiter 26°', 'g limiter 8 g'], 28.5, 31.9, { left: '110px', bottom: '100px' }, 0.22);
vo(28.2, 'v06');
const cGo = clip('greyout', 30.0, 32.0, { frames: 170, f0: 20 });
sfx(30.0, 'whoosh', 0.7); sfx(30.2, 'breath', 0.7);
el('<div class="kick" style="color:#eef3f8">Grey-out builds with time</div>', 30.2, 31.9, { left: '110px', top: '90px' });

// 32.0 in the groove: fly the ball
const cGr = clip('groove', 32.0, 34.53, { frames: 200, f0: 30 }); push(cGr, 1.0, 1.05);
wipe(32.0, ['#0b1a2e', '#07111f', '#ff9a2e'], -1);
{ const g = group(32.15, 34.5);
  const bx = 1500, by = 330;
  svgEl('rect', { x: bx - 150, y: by - 150, width: 300, height: 300, fill: 'rgba(5,12,22,0.7)', stroke: 'rgba(238,243,248,0.4)', 'stroke-width': 1.5 }, g);
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) svgEl('rect', { x: bx + s * (40 + k * 34) - (s < 0 ? 26 : 0), y: by - 5, width: 26, height: 10, fill: '#3dff66' }, g);
  const ball = svgEl('circle', { cx: bx, cy: by - 70, r: 17, fill: '#ffb21e' }, g);
  tl.fromTo(ball, { attr: { cy: by - 80 } }, { attr: { cy: by }, duration: 1.2, ease: 'power2.out', immediateRender: false }, 32.4);
  const tx = svgEl('text', { x: bx, y: by + 125, fill: '#eef3f8', 'font-family': 'Mono', 'font-size': 20, 'text-anchor': 'middle', 'letter-spacing': 3 }, g); tx.textContent = 'MEATBALL · CENTRED'; }
display('Fly the|<span class="sf">ball.</span>', 32.25, 34.45, { left: '110px', top: '120px', fontSize: '150px' }, { cls: 'shadow' });
chips(['4.0° glide slope', '10.5° AoA', 'LSO calls'], 32.8, 34.45, { left: '110px', bottom: '100px' }, 0.2);

// 34.53 the trap: deck-level telephoto at quarter speed; the hook takes the wire on the 38.78 s hit
const cTrap = clip('trap_deck', 34.53, 42.0, { frames: 600, f0: 233, speed: 60 }); push(cTrap, 1.0, 1.1, 0, 10);
flash(34.53, 0.9, 0.35); sfx(34.53, 'boom', 1); bars(34.4, true);
vo(34.65, 'v07');
el('<div class="chip"><b>¼</b>speed · deck level</div>', 34.8, 38.6, { right: '120px', top: '150px' });
sfx(37.9, 'riser_short', 0.9);
flash(38.78, 0.7, 0.35); shake(38.78, 16, 0.7); sfx(38.78, 'cable', 1.3);
sfx(39.12, 'impact', 0.9);
{ const st = el('OK', 40.0, 41.95, { left: '110px', top: '200px' }, 'stamp', { opacity: 0, scale: 2.2, rotate: -8 }, 0.28);
  const card = el(`<div class="kick" style="margin-bottom:14px">LSO grade</div><dl><dt>Wire</dt><dd>2</dd><dt>Run-out</dt><dd>82 m</dd><dt>Peak</dt><dd>1.9 g</dd><dt>Sink</dt><dd>2.6 m/s</dd></dl>`,
    40.2, 41.95, { left: '130px', top: '520px' }, 'lsocard', { opacity: 0, x: -30 }, 0.35);
  flash(40.0, 0.5, 0.25); sfx(40.0, 'stamp', 1.2); shake(40.0, 10, 0.3); }
vo(40.35, 'lso');
sfx(40.3, 'squelch', 0.9);
bars(41.8, false);

// ================================================================ ACT 3  NIGHT AND STORM  (42 - 50)
const cNc = clip('night_chase', 42.0, 44.2, { frames: 200, f0: 0 }); push(cNc, 1.0, 1.05);
fadeBlack(41.75, 1, 0.25); fadeBlack(42.0, 0, 0.6);
display('<span class="out">Night.</span>', 42.3, 45.9, { left: '110px', bottom: '150px', fontSize: '220px' }, { out: 'blur' });
vo(42.45, 'v08');
chips(['Deck lights', 'Drop lights', 'Night trap'], 43.0, 45.9, { left: '110px', bottom: '90px' }, 0.3);
const cNg = clip('night_groove', 44.2, 46.0, { frames: 200, f0: 60 }); push(cNg, 1.04, 1.0);
sfx(42.0, 'drone', 0.5);
// 46.0 the carrier in a rough sea: bow spray, whitecaps, deck heaving
const cSt = clip('storm', 46.0, 50.0, { frames: 270, f0: 20 }); push(cSt, 1.0, 1.08, -20, 10);
flash(46.0, 0.6, 0.3); sfx(46.0, 'boom', 0.9); sfx(46.2, 'drone', 0.7);
display('In any|<span class="sf">sea.</span>', 46.3, 49.9, { right: '110px', top: '110px', fontSize: '170px', textAlign: 'right' }, { cls: 'shadow' });
vo(46.3, 'h06');
chips(['Rough sea', 'Deck motion', 'Air wake', 'Bow spray'], 47.2, 49.9, { left: '110px', bottom: '100px' }, 0.25);

// ================================================================ ACT 4  REBUILD  (50 - 58)
const cT = clip('tanker_chase', 50.0, 52.8, { frames: 270, f0: 110 }); push(cT, 1.0, 1.06);
flash(50.0, 0.8, 0.35); sfx(50.0, 'boom', 1);
display('Plug the|<span class="sf">tanker.</span>', 50.2, 52.75, { left: '110px', top: '110px', fontSize: '150px' }, { cls: 'shadow' });
vo(50.3, 'v10');
{ const r = el('<small>Drogue</small><span id="drg">4.2 M</span>', 50.3, 52.75, { right: '120px', bottom: '130px' }, 'readout');
  const n = r.querySelector('#drg'); const o = { v: 4.2 };
  tl.to(o, { v: 0, duration: 1.05, ease: 'none', immediateRender: false, onUpdate: () => { n.textContent = o.v.toFixed(1) + ' M'; } }, 50.3);
  tl.call(() => { n.textContent = 'CONTACT'; }, null, 51.35); tl.call(() => { n.textContent = '4.2 M'; }, null, 0.01);
  const f = { v: 0 }; tl.to(f, { v: 520, duration: 1.4, ease: 'none', immediateRender: false, onUpdate: () => { if (f.v > 1) n.textContent = 'FUEL +' + Math.round(f.v) + ' KG'; } }, 51.45); }
sfx(51.35, 'clunk', 1.2); flash(51.35, 0.3, 0.2);
// 52.8 the teaching side, quickly: the instructor in the cockpit, then the debrief and the lessons
const cI = clip('instructor', 52.8, 54.0, { frames: 210, f0: 60, speed: 52 }); push(cI, 1.0, 1.05, 10, -8);
wipe(52.8, ['#ff9a2e', '#0b1a2e', '#07111f']);
el('<div class="kick">An instructor in your ear · every switch clickable</div>', 52.95, 53.95, { left: '90px', bottom: '90px' });
const cDb = clip('ui_debrief', 54.0, 56.0, { still: true }); push(cDb, 1.0, 1.12, 40, 10);
wipe(54.0);
display('Every pass,|<span class="sf">debriefed.</span>', 54.25, 55.95, { left: '90px', top: '70px', fontSize: '110px' }, { cls: 'shadow' });
vo(54.2, 'v11');
const cMenu = clip('ui_menu', 56.0, 58.0, { still: true }); push(cMenu, 1.06, 1.0, 20);
{ const names = ['Cold start', 'Ski-jump launch', 'Basic handling', 'On-speed AoA', 'Flying the ball', 'The trap', 'Carrier circuit', 'Touch-and-go', 'Engine failure', 'Emergencies', 'Night trap', 'Air refuelling'];
  const d = el(names.map((n, i) => `<div><span>${i + 1}</span>${n}<em>★★★</em></div>`).join(''), 56.05, 57.98, { right: '90px', top: '120px' }, 'lessons', { opacity: 0 }, 0.2);
  d.querySelectorAll('div').forEach((c, i) => { tl.fromTo(c, { opacity: 0, x: 40 }, { opacity: 1, x: 0, duration: 0.2, ease: 'power3.out', immediateRender: true }, 56.1 + i * 0.1); sfx(56.1 + i * 0.1, 'tick', 0.6); }); }
flash(56.0, 0.3, 0.2);
sfx(56.0, 'riser', 1);

// ================================================================ FINALE  (58 - 64.6)
const cHero = clip('hero_end', 58.0, 64.6, { frames: 420, f0: 0 }); push(cHero, 1.0, 1.06);
{ const sky = document.createElement('div'); Object.assign(sky.style, { position: 'absolute', inset: '0', background: 'linear-gradient(180deg, rgba(4,8,16,0.72) 0%, rgba(4,8,16,0.45) 38%, rgba(4,8,16,0) 58%, rgba(4,8,16,0) 82%, rgba(4,8,16,0.6) 100%)', visibility: 'hidden' }); fxL.appendChild(sky);
  tl.set(sky, { visibility: 'visible' }, 58.0); tl.fromTo(sky, { opacity: 0 }, { opacity: 1, duration: 0.8, immediateRender: true }, 58.1); tl.set(sky, { visibility: 'hidden' }, 64.6); }
flash(58.0, 1, 0.8); sfx(58.0, 'boom', 1.4); shake(58.0, 12, 0.5);
tex('flare', 58.0, 60.2, { opacity: 0, x: -600, scaleY: 0.6 }, { opacity: 0.9, x: 500 }, 'power1.out');
tex('leak', 58.2, 64.0, { opacity: 0, x: 200 }, { opacity: 0.35, x: -150 });
{ const t = document.createElement('div'); t.className = 'disp shadow'; t.innerHTML = 'MiG-29K'.split('').map(c => `<span class="ln" style="display:inline-block"><span>${c}</span></span>`).join('');
  Object.assign(t.style, { left: '0', right: '0', textAlign: 'center', top: '96px', fontSize: '230px', textTransform: 'none', letterSpacing: '0.02em' }); typeL.appendChild(t);
  tl.set(t, { visibility: 'visible' }, 58.2);
  tl.fromTo(t.querySelectorAll('.ln > span'), { yPercent: 110 }, { yPercent: 0, duration: 0.6, ease: 'power4.out', stagger: 0.06, immediateRender: false }, 58.2);
  tl.fromTo(t, { letterSpacing: '0.02em' }, { letterSpacing: '0.06em', duration: 6, ease: 'none', immediateRender: false }, 58.2);
  tl.set(t, { visibility: 'hidden' }, 64.6); }
el('<span class="disp sf" style="font-size:84px;letter-spacing:.32em">Carrier Sim</span>', 59.0, 64.6, { left: '0', right: '0', textAlign: 'center', top: '318px' }, '', { opacity: 0, letterSpacing: '0.1em', y: 0 }, 0.8);
el('Cold start to the wire. In your browser.', 60.2, 64.6, { left: '0', right: '0', textAlign: 'center', top: '428px' }, 'sub', { opacity: 0, y: 20 }, 0.6);
el('mig29.vercel.app', 61.2, 64.6, { left: '0', right: '0', textAlign: 'center', bottom: '120px' }, 'mono', { opacity: 0 }, 0.6);
vo(58.3, 'v12');
fadeBlack(63.7, 1, 0.9);
tl.set({}, {}, DUR);
