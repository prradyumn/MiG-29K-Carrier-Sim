// Flight data recorder, instant replay (last 45 s) and the debrief screen with time-history charts,
// event markers and coaching on each mistake.
import * as THREE from 'three';
const R2D = 180 / Math.PI;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

const TIPS = [
  [/Hot start|Throttle moved during/i, 'Leave the throttle at IDLE until the engine settles at 70 %. If T4 passes 870 °C, switch the engine master OFF at once.'],
  [/fuel pressure|pump/i, 'Switch the fuel boost pump ON before pressing START: without fuel pressure the engine never lights.'],
  [/APU/i, 'Wait for the steady green APU lamp (about 18 s) before starting an engine.'],
  [/master OFF/i, 'The engine master opens the fuel valve: switch it ON before pressing START.'],
  [/parking brake/i, 'Release the parking brake once the restraining stops are up. The stops hold the jet, not the brakes.'],
  [/Gear still down/i, 'Gear up as soon as you have a positive climb: the jet reaches the 500 km/h limit within seconds in afterburner.'],
  [/Flaps still down/i, 'Flaps up before 400 km/h.'],
  [/MIL/i, 'Throttle to MIL the moment the wheels touch. If the hook misses you need the thrust to fly away.'],
  [/Late on the power/i, 'Power first, then attitude: MIL at touchdown is a reflex, not a decision.'],
  [/Bolter|missed the wires/i, 'Fly the ball all the way to the deck. A flare or a high ball in close lands you long, past the wires.'],
  [/Wave|waved off/i, 'Stay on glide slope, on speed and lined up inside 450 m, with gear, flaps and hook down.'],
  [/below the glide slope|red ball|low/i, 'Add power early when the ball drops. Low in close is the most dangerous place to be.'],
  [/Fire drill/i, 'Fire drill: master warning off, throttle idle, engine master OFF, then fly away from the problem.'],
  [/Large stick input on the ramp/i, 'Hold the stick neutral on the ski-jump: the ramp pitches you up and the flight controls do the rest.'],
  [/Nearly hit the sea/i, 'Single engine: keep full afterburner, raise the gear and trade nothing for altitude until you are climbing.'],
  [/hose/i, 'Close on the drogue at 1 to 2 m/s. Faster than 3 m/s the hose whips or breaks.'],
];
const tipFor = what => (TIPS.find(([re]) => re.test(what)) || [null, ''])[1];

export class Recorder {
  constructor() { this.reset(); }
  reset() { this.data = []; this.events = []; this.frames = []; this.acc = 0; this.facc = 0; this.t0 = null; }
  sample(dt, t, ac, ship, lens) {
    this.acc += dt; this.facc += dt;
    if (this.acc >= 0.1) {
      this.acc = 0;
      const L = lens && lens.dist > 0 && lens.dist < 4000 && !ac.onGround ? lens : null;
      const e = ac.engines;
      this.data.push({ t, ias: ac.t.ias * 3.6, alt: ac.pos.y, aoa: ac.t.alpha * R2D, nz: ac.t.nz, vs: ac.t.vs, thr: ac.inp.throttle,
        gs: L ? L.err : null, lu: L ? L.lineup : null, n0: e[0].N * 100, n1: e[1].N * 100, t0: e[0].egt, t1: e[1].egt, gnd: ac.onGround });
      if (this.data.length > 12000) this.data.shift();
    }
    if (this.facc >= 1 / 30) {
      this.facc = 0;
      const e = ac.engines;
      this.frames.push({ t, p: ac.pos.toArray(), q: ac.quat.toArray(), dE: ac.dE, dA: ac.dA, dD: ac.dD, dR: ac.dR, flap: ac.flap, gear: ac.gear,
        hookAng: ac.hookAng, slat: ac.slat, airbrake: ac.airbrake, fold: ac.fold, canopy: ac.canopy, probe: ac.probe,
        AB: [e[0].AB, e[1].AB], N: [e[0].N, e[1].N], comp: ac.wheels.map(w => w.comp),
        sp: ship.position.toArray(), sq: ship.quaternion.toArray(), inp: { ...ac.inp } });
      while (this.frames.length && t - this.frames[0].t > 45) this.frames.shift();
    }
  }
  event(t, kind, text, level = 'info') {
    if (this.events.length && this.events[this.events.length - 1].text === text && t - this.events[this.events.length - 1].t < 2) return;
    this.events.push({ t, kind, text, level });
  }
}

// ---------------------------------------------------------------- instant replay
export class Replay {
  constructor(ctx) { Object.assign(this, ctx); this.on = false; this.el = document.getElementById('replay'); this.wire(); }
  wire() {
    const el = this.el; if (!el) return;
    this.scrub = el.querySelector('input[type=range]');
    this.scrub.oninput = () => { this.pos = parseFloat(this.scrub.value); this.playing = false; this.syncBtn(); };
    el.querySelector('[data-r=play]').onclick = () => { this.playing = !this.playing; if (this.pos >= this.t1 - 0.05) this.pos = this.t0; this.syncBtn(); };
    el.querySelector('[data-r=speed]').onclick = e => { this.speed = this.speed === 1 ? 0.5 : this.speed === 0.5 ? 0.25 : 1; e.target.textContent = this.speed + '×'; };
    el.querySelector('[data-r=exit]').onclick = () => this.stop();
  }
  syncBtn() { this.el.querySelector('[data-r=play]').textContent = this.playing ? 'Pause' : 'Play'; }
  start() {
    const F = this.rec.frames;
    if (F.length < 30) { this.flash('Nothing to replay yet', 2); return false; }
    const ac = this.ac, ship = this.ship;
    // snapshot the live state to restore afterwards
    this.saved = { p: ac.pos.clone(), q: ac.quat.clone(), f: this.pick(ac), sp: ship.position.clone(), sq: ship.quaternion.clone(), view: this.state.view, paused: this.state.paused };
    this.t0 = F[0].t; this.t1 = F[F.length - 1].t; this.pos = this.t0; this.playing = true; this.speed = 1;
    this.scrub.min = this.t0; this.scrub.max = this.t1; this.scrub.step = 0.01;
    this.on = true; this.state.replay = true;
    if (this.state.view === 'cockpit') this.state.view = 'chase';
    this.el.hidden = false; this.syncBtn();
    this.flash('Instant replay: last ' + Math.round(this.t1 - this.t0) + ' s. V cycles cameras, Z exits.', 4);
    return true;
  }
  pick(ac) { return { dE: ac.dE, dA: ac.dA, dD: ac.dD, dR: ac.dR, flap: ac.flap, gear: ac.gear, hookAng: ac.hookAng, slat: ac.slat, airbrake: ac.airbrake, fold: ac.fold, canopy: ac.canopy, probe: ac.probe,
    AB: ac.engines.map(e => e.AB), N: ac.engines.map(e => e.N), comp: ac.wheels.map(w => w.comp), inp: { ...ac.inp } }; }
  apply(fr, ac) {
    for (const k of ['dE', 'dA', 'dD', 'dR', 'flap', 'gear', 'hookAng', 'slat', 'airbrake', 'fold', 'canopy', 'probe']) ac[k] = fr[k];
    ac.engines.forEach((e, i) => { e.AB = fr.AB[i]; e.N = fr.N[i]; });
    ac.wheels.forEach((w, i) => { w.comp = fr.comp[i]; });
    Object.assign(ac.inp, fr.inp);
  }
  update(dt) {
    if (!this.on) return;
    const F = this.rec.frames;
    if (this.playing) { this.pos += dt * this.speed; if (this.pos >= this.t1) { this.pos = this.t1; this.playing = false; this.syncBtn(); } }
    this.scrub.value = this.pos;
    this.el.querySelector('.rt').textContent = '−' + (this.t1 - this.pos).toFixed(1) + ' s';
    let i = F.findIndex(f => f.t >= this.pos); if (i < 1) i = 1;
    const a = F[i - 1], b = F[i], k = clamp((this.pos - a.t) / Math.max(b.t - a.t, 1e-6), 0, 1);
    const ac = this.ac, ship = this.ship;
    ac.pos.fromArray(a.p).lerp(new THREE.Vector3().fromArray(b.p), k);
    ac.quat.fromArray(a.q).slerp(new THREE.Quaternion().fromArray(b.q), k);
    this.apply(k < 0.5 ? a : b, ac);
    ship.position.fromArray(a.sp).lerp(new THREE.Vector3().fromArray(b.sp), k);
    ship.quaternion.fromArray(a.sq).slerp(new THREE.Quaternion().fromArray(b.sq), k);
    ship.updateMatrixWorld();
  }
  stop() {
    if (!this.on) return;
    const s = this.saved, ac = this.ac;
    ac.pos.copy(s.p); ac.quat.copy(s.q); this.apply(s.f, ac);
    this.ship.position.copy(s.sp); this.ship.quaternion.copy(s.sq); this.ship.updateMatrixWorld();
    this.state.view = s.view; this.on = false; this.state.replay = false; this.el.hidden = true;
  }
}

// ---------------------------------------------------------------- debrief screen
export class Debrief {
  constructor(ctx) {
    Object.assign(this, ctx);
    this.el = document.getElementById('debrief');
    this.cv = this.el.querySelector('canvas');
    this.el.querySelector('[data-d=close]').onclick = () => this.hide();
    this.el.querySelector('[data-d=replay]').onclick = () => { this.hide(); this.onReplay?.(); };
    this.el.querySelector('[data-d=retry]').onclick = () => { this.hide(); this.onRetry?.(this.result); };
    this.el.querySelector('[data-d=next]').onclick = () => { this.hide(); this.onNext?.(this.result); };
    addEventListener('resize', () => { if (!this.el.hidden) this.draw(); });
  }
  get open() { return !this.el.hidden; }
  hide() { this.el.hidden = true; this.onClose?.(); }
  show(result = {}) {
    this.result = result;
    const rec = this.rec, el = this.el;
    el.querySelector('.dt').textContent = result.title || 'Flight debrief';
    const stars = result.stars != null ? '★★★'.slice(0, result.stars) + '☆☆☆'.slice(0, 3 - result.stars) : '';
    el.querySelector('.dr').innerHTML = result.ok === false ? `<b class="bad">Not completed</b> <span>${result.why || ''}</span>`
      : result.pts != null ? `<b>${stars}</b> <span>${result.pts} / 100 · ${Math.round(result.time || 0)} s</span>` : `<span>${result.summary || ''}</span>`;
    // mistakes and coaching
    const ev = rec.events.filter(e => e.level === 'mistake');
    const all = [...(result.mistakes || []).map(m => ({ t: m.t, text: m.what })), ...ev.map(e => ({ t: e.t, text: e.text }))];
    const seen = new Set(), list = all.filter(m => !seen.has(m.text) && seen.add(m.text)).sort((a, b) => a.t - b.t);
    const ul = el.querySelector('.dm');
    ul.innerHTML = list.length ? list.map(m => `<li><span class="tt">${fmt(m.t)}</span><div><b>${esc(m.text)}</b>${tipFor(m.text) ? '<p>' + esc(tipFor(m.text)) + '</p>' : ''}</div></li>`).join('')
      : '<li class="clean"><div><b>No mistakes recorded.</b><p>Clean flying.</p></div></li>';
    const met = result.metrics || {}, rows = [];
    if (met.gs != null) rows.push(['Glide slope error (avg)', met.gs.toFixed(2) + ' ball']);
    if (met.lu != null) rows.push(['Lineup error (avg)', met.lu.toFixed(1) + ' m']);
    if (met.aoa != null) rows.push(['AoA deviation (avg)', met.aoa.toFixed(1) + '°']);
    if (met.turnAlt != null) rows.push(['Altitude in turns (avg dev.)', Math.round(met.turnAlt) + ' m']);
    if (this.ops?.report) { const r = this.ops.report; rows.push(['LSO grade', r.grade + ' · wire ' + r.wire]); }
    const D = rec.data;
    if (D.length) {
      const pk = k => Math.max(...D.map(d => d[k]));
      if (pk('t0') > 200) rows.push(['Peak T4, left engine', Math.round(pk('t0')) + ' °C']);
      if (pk('t1') > 200) rows.push(['Peak T4, right engine', Math.round(pk('t1')) + ' °C']);
      const ev = rec.events;
      for (const [i, n] of [[0, 'left'], [1, 'right']]) {
        const a = ev.find(e => e.kind === 'startbtn' && e.i === i), b = a && ev.find(e => e.kind === 'engidle' && e.i === i && e.t > a.t);
        if (a && b) rows.push(['Start time, ' + n + ' engine', (b.t - a.t).toFixed(0) + ' s']);
      }
      if (!D.every(d => d.gnd)) rows.push(['Max load', pk('nz').toFixed(1) + ' g'], ['Max airspeed', Math.round(pk('ias')) + ' km/h']);
    }
    el.querySelector('.dk').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    el.querySelector('[data-d=next]').hidden = !result.next;
    el.querySelector('[data-d=retry]').hidden = !result.id;
    el.querySelector('[data-d=replay]').hidden = rec.frames.length < 30;
    el.hidden = false;
    this.draw();
  }
  draw() {
    const D = this.rec.data; const cv = this.cv;
    const dpr = Math.min(devicePixelRatio, 2), W = cv.clientWidth, H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    if (D.length < 3) { g.fillStyle = '#93a6bb'; g.font = '13px "IBM Plex Sans"'; g.fillText('Not enough flight data yet.', 12, 24); return; }
    const t0 = D[0].t, t1 = D[D.length - 1].t;
    const hasGs = D.some(d => d.gs != null);
    const ground = D.filter(d => d.gnd).length > D.length * 0.8;
    // on the deck the story is the engines; in the air it is the flying
    const series = ground ? [
      ['RPM', '%', [d => d.n0, d => d.n1], ['#7dff9c', '#ffd36b'], [70, 100]], ['T4', '°C', [d => d.t0, d => d.t1], ['#ff8a7a', '#ffb347'], [870]], ['Throttle', '', d => d.thr * 100, '#8ec5ff'],
    ] : [
      ['Airspeed', 'km/h', d => d.ias, '#7dff9c'], ['Altitude', 'm', d => d.alt, '#8ec5ff'], ['AoA', '°', d => d.aoa, '#ffb347', [10.5]], ['Load', 'g', d => d.nz, '#ff8a7a', [1]],
    ];
    if (hasGs && !ground) series.push(['Glide slope', 'ball', d => d.gs, '#e7d36a', [0]]);
    const n = series.length, padL = 64, padR = 12, top = 6, rowH = (H - top - 18) / n;
    const X = t => padL + (t - t0) / Math.max(t1 - t0, 1e-6) * (W - padL - padR);
    series.forEach(([name, unit, fs, cols, refs], k) => {
      const y0 = top + k * rowH, h = rowH - 8;
      const F = Array.isArray(fs) ? fs : [fs], C = Array.isArray(cols) ? cols : [cols];
      const vals = F.flatMap(f => D.map(f)).filter(v => v != null);
      let lo = Math.min(...vals), hi = Math.max(...vals); if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
      const pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
      const Y = v => y0 + h - (v - lo) / (hi - lo) * h;
      g.fillStyle = 'rgba(255,255,255,0.03)'; g.fillRect(padL, y0, W - padL - padR, h);
      g.fillStyle = '#93a6bb'; g.font = '600 11px "IBM Plex Sans", sans-serif'; g.textAlign = 'right';
      g.fillText(name, padL - 8, y0 + 12); g.font = '10px "JetBrains Mono", monospace';
      g.fillText(fmtN(hi) + ' ' + unit, padL - 8, y0 + 26); g.fillText(fmtN(lo), padL - 8, y0 + h);
      for (const r of refs || []) if (r > lo && r < hi) { g.strokeStyle = 'rgba(255,255,255,0.18)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(padL, Y(r)); g.lineTo(W - padR, Y(r)); g.stroke(); g.setLineDash([]); }
      F.forEach((f, j) => {
        g.strokeStyle = C[j % C.length]; g.lineWidth = 1.6; g.beginPath(); let pen = false;
        for (const d of D) { const v = f(d); if (v == null) { pen = false; continue; } const x = X(d.t), y = Y(v); if (!pen) { g.moveTo(x, y); pen = true; } else g.lineTo(x, y); }
        g.stroke();
      });
      if (F.length > 1) { g.textAlign = 'left'; g.font = '10px "JetBrains Mono", monospace'; ['L', 'R'].forEach((t, j) => { g.fillStyle = C[j]; g.fillText(t, padL + 6 + j * 14, y0 + 12); }); }
    });
    // event markers across all rows
    for (const e of this.rec.events) {
      if (e.t < t0 || e.t > t1) continue;
      const x = X(e.t); const col = e.level === 'mistake' ? '#ff5c47' : e.level === 'good' ? '#7dff9c' : '#93a6bb';
      g.strokeStyle = col; g.globalAlpha = 0.7; g.beginPath(); g.moveTo(x, top); g.lineTo(x, H - 18); g.stroke(); g.globalAlpha = 1;
      g.fillStyle = col; g.beginPath(); g.moveTo(x - 4, H - 16); g.lineTo(x + 4, H - 16); g.lineTo(x, H - 10); g.fill();
    }
    g.fillStyle = '#93a6bb'; g.font = '10px "JetBrains Mono", monospace'; g.textAlign = 'left'; g.fillText(fmt(t0), padL, H - 2);
    g.textAlign = 'right'; g.fillText(fmt(t1), W - padR, H - 2);
    // hover readout
    cv.onmousemove = ev => {
      const r = cv.getBoundingClientRect(), x = ev.clientX - r.left;
      const t = t0 + (x - padL) / (W - padL - padR) * (t1 - t0);
      const e = this.rec.events.reduce((b, e) => Math.abs(e.t - t) < Math.abs((b?.t ?? 1e9) - t) ? e : b, null);
      cv.title = e && Math.abs(e.t - t) < (t1 - t0) * 0.02 ? fmt(e.t) + '  ' + e.text : '';
    };
  }
}
const fmt = t => { t = Math.max(0, t || 0); return Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0'); };
const fmtN = v => Math.abs(v) >= 100 ? Math.round(v) : v.toFixed(1);
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
