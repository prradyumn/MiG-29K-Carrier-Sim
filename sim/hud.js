// Head-up display (conformal, drawn on a screen overlay and clipped to the HUD combiner)
// and the three MFI-10-7 multifunction displays + UFCP, drawn to canvas textures.
import * as THREE from 'three';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const HUDG = '#7dff9c';

export class HUD {
  constructor(canvas) {
    this.cv = canvas; this.g = canvas.getContext('2d');
    this.units = 'metric';
    this.tmpV = new THREE.Vector3();
  }
  resize(w, h, dpr) { this.cv.width = w * dpr; this.cv.height = h * dpr; this.cv.style.width = w + 'px'; this.cv.style.height = h + 'px'; this.dpr = dpr; }

  project(camera, dirWorld, camPos) {
    const p = this.tmpV.copy(dirWorld).multiplyScalar(5000).add(camPos).project(camera);
    if (p.z > 1) return null;
    return [(p.x * 0.5 + 0.5) * this.cv.width, (-p.y * 0.5 + 0.5) * this.cv.height];
  }

  clear() { this.g.clearRect(0, 0, this.cv.width, this.cv.height); }

  // draws conformal HUD. clipPoly: screen polygon of the combiner (null = full screen box)
  draw(camera, ac, env, clipPoly, mode) {
    const g = this.g, W = this.cv.width, H = this.cv.height, dpr = this.dpr;
    g.clearRect(0, 0, W, H);
    if (!ac.t.fwd) return;
    const pw = ac.power();
    if (pw !== 'gen' && pw !== 'apu') return;           // HUD needs AC power
    if (!this.onAt) this.onAt = performance.now();
    const camPos = camera.getWorldPosition(new THREE.Vector3());
    const f = (H / 2) / Math.tan(camera.fov * D2R / 2);   // px per rad (approx near centre)
    g.save();
    if (clipPoly) { g.beginPath(); clipPoly.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.clip(); }
    g.strokeStyle = HUDG; g.fillStyle = HUDG; g.lineWidth = 1.6 * dpr;
    g.shadowColor = 'rgba(80,255,130,0.55)'; g.shadowBlur = 4 * dpr;
    const fs = Math.max(10, Math.round(f * 0.0125));
    g.font = `${fs}px "JetBrains Mono", ui-monospace, monospace`;
    const t = ac.t;
    const fwd = t.fwd, up = t.upv;
    const bore = this.project(camera, fwd, camPos);
    if (!bore) { g.restore(); return; }
    const [bx, by] = bore;
    // boresight (waterline) symbol
    g.beginPath(); g.moveTo(bx - 18 * dpr, by); g.lineTo(bx - 7 * dpr, by); g.lineTo(bx - 3 * dpr, by + 5 * dpr); g.lineTo(bx, by);
    g.lineTo(bx + 3 * dpr, by + 5 * dpr); g.lineTo(bx + 7 * dpr, by); g.lineTo(bx + 18 * dpr, by); g.stroke();
    // flight path marker
    const vI = ac.vel.clone().sub(env.shipVelocity && ac.onGround ? env.shipVelocity : new THREE.Vector3());
    let fpm = null;
    if (vI.length() > 15) {
      fpm = this.project(camera, vI.clone().normalize(), camPos);
      if (fpm) {
        const [fx, fy] = fpm, rr = 6 * dpr;
        g.beginPath(); g.arc(fx, fy, rr, 0, 7); g.moveTo(fx - rr, fy); g.lineTo(fx - rr * 2.6, fy); g.moveTo(fx + rr, fy); g.lineTo(fx + rr * 2.6, fy);
        g.moveTo(fx, fy - rr); g.lineTo(fx, fy - rr * 2); g.stroke();
      }
    }
    // pitch ladder centred on the velocity track
    const trk = vI.length() > 15 ? vI.clone().setY(0) : fwd.clone().setY(0);
    if (trk.lengthSq() < 1e-6) trk.set(0, 0, -1);
    trk.normalize();
    const rightH = new THREE.Vector3().crossVectors(trk, new THREE.Vector3(0, 1, 0)).normalize();
    for (let pa = -85; pa <= 85; pa += 5) {
      const pr = pa * D2R;
      const c = trk.clone().multiplyScalar(Math.cos(pr)).add(new THREE.Vector3(0, Math.sin(pr), 0));
      const half = (pa === 0 ? 14 : 5.5) * D2R, gap = (pa === 0 ? 2.5 : 2.2) * D2R;
      const seg = (s0, s1) => {
        const a = this.project(camera, c.clone().addScaledVector(rightH, Math.tan(s0)).normalize(), camPos);
        const b = this.project(camera, c.clone().addScaledVector(rightH, Math.tan(s1)).normalize(), camPos);
        if (!a || !b) return null;
        if (pa < 0) { g.setLineDash([6 * dpr, 5 * dpr]); } else g.setLineDash([]);
        g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
        return [a, b];
      };
      const L = seg(-half, -gap), R = seg(gap, half);
      if (pa !== 0 && L && R) {
        g.setLineDash([]);
        // end ticks toward the horizon
        const tick = (p, q) => { const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1; const nx = -dy / l, ny = dx / l, s = (pa > 0 ? 1 : -1) * 6 * dpr;
          g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(p[0] + nx * s, p[1] + ny * s); g.stroke(); };
        tick(L[0], L[1]); tick(R[1], R[0]);
        g.fillText(String(Math.abs(pa)), R[1][0] + 5 * dpr, R[1][1] + fs * 0.35);
      }
    }
    g.setLineDash([]);
    // fixed scales (relative to boresight)
    const sx = f * 0.105, sy = f * 0.085;
    const ias = t.ias * 3.6, alt = ac.pos.y, hdg = t.heading;
    const imp = this.units === 'imperial';
    const spdTxt = imp ? Math.round(t.ias * 1.94384) : Math.round(ias);
    const altTxt = imp ? Math.round(alt * 3.28084 / 10) * 10 : Math.round(alt);
    // speed & altitude boxes
    const boxTxt = (x, y, txt, al) => { g.textAlign = al; const w = g.measureText(txt).width + 10 * dpr; const bx0 = al === 'right' ? x - w : x;
      g.strokeRect(bx0, y - fs, w, fs * 1.4); g.fillText(txt, al === 'right' ? x - 5 * dpr : x + 5 * dpr, y + fs * 0.1); g.textAlign = 'left'; };
    boxTxt(bx - sx, by - sy * 0.2, String(spdTxt), 'right');
    boxTxt(bx + sx, by - sy * 0.2, String(altTxt), 'left');
    g.textAlign = 'right'; g.fillText(imp ? 'KT' : 'KM/H', bx - sx, by - sy * 0.2 - fs * 1.4);
    g.textAlign = 'left'; g.fillText(imp ? 'FT' : 'M', bx + sx, by - sy * 0.2 - fs * 1.4);
    // vertical speed
    g.fillText((t.vs >= 0 ? '+' : '') + (imp ? Math.round(t.vs * 196.85 / 10) * 10 : t.vs.toFixed(0)), bx + sx, by - sy * 0.2 + fs * 1.6);
    // radar altitude below 1500 m
    const rAlt = alt - (env.groundUnder || 0);
    if (rAlt < 1500) g.fillText('R ' + (imp ? Math.round(rAlt * 3.28) : Math.round(rAlt)), bx + sx, by - sy * 0.2 + fs * 3.0);
    // heading tape
    const hy = by - sy * 1.25;
    g.textAlign = 'center';
    for (let d = -30; d <= 30; d += 5) {
      const hv = Math.round(hdg / 5) * 5 + d, x = bx + (hv - hdg) * f * 0.006;
      const hh = ((hv % 360) + 360) % 360;
      g.beginPath(); g.moveTo(x, hy); g.lineTo(x, hy - (hh % 10 === 0 ? 8 : 4) * dpr); g.stroke();
      if (hh % 10 === 0) g.fillText(String(hh / 10).padStart(2, '0'), x, hy - 11 * dpr);
    }
    g.beginPath(); g.moveTo(bx, hy + 2 * dpr); g.lineTo(bx - 5 * dpr, hy + 9 * dpr); g.lineTo(bx + 5 * dpr, hy + 9 * dpr); g.closePath(); g.stroke();
    // bottom-left data block
    g.textAlign = 'left';
    const lx = bx - sx * 1.05, ly = by + sy * 0.75;
    g.fillText('α ' + (t.alpha * R2D).toFixed(1), lx, ly);
    g.fillText('n ' + t.nz.toFixed(1), lx, ly + fs * 1.3);
    g.fillText('M ' + t.M.toFixed(2), lx, ly + fs * 2.6);
    // throttle / afterburner
    g.textAlign = 'right';
    const rx = bx + sx * 1.05;
    const ab = Math.max(ac.AB[0], ac.AB[1]);
    g.fillText(ab > 0.05 ? 'AFTERBURNER' : ('THR ' + Math.round(Math.min(ac.inp.throttle / 0.85, 1) * 100)), rx, ly);
    g.fillText('T ' + Math.round(ac.fuel) + ' KG', rx, ly + fs * 1.3);
    const cfg = [];
    if (ac.gear > 0.5) cfg.push('GEAR'); if (ac.flap > 0.3) cfg.push('FLAPS'); if (ac.hook > 0.5) cfg.push('HOOK'); if (ac.airbrake > 0.2) cfg.push('SPDBRK');
    if (ac.maxG) g.fillText('n max ' + ac.maxG.toFixed(1), rx, ly + fs * 2.6);
    if (cfg.length) { g.textAlign = 'center'; g.fillText(cfg.join(' '), bx, ly + fs * 3.9); }
    // landing mode: AoA indexer + carrier approach deviations (SN-K 'Uzel' guidance from the ship)
    if (ac.gear > 0.9 && !ac.onGround) {
      const ad = t.alpha * R2D, target = 10.5;
      const ex = bx - sx * 0.55, ey = by;
      const err = clamp(ad - target, -3, 3);
      g.beginPath(); g.moveTo(ex, ey - 22 * dpr); g.lineTo(ex, ey + 22 * dpr); g.stroke();
      g.beginPath(); g.arc(ex - 6 * dpr, ey + err * 7 * dpr, 4 * dpr, 0, 7); g.stroke();
      g.textAlign = 'center';
      g.fillText(ad > target + 1 ? 'SLOW' : ad < target - 1 ? 'FAST' : 'ON SPEED', ex, ey - 28 * dpr);
      const L = env.lens;
      if (L && L.dist > 0 && L.dist < 12000 && Math.abs(L.lineup) < 1500) {
        const gx = bx + sx * 0.62, gy = by, span = 40 * dpr;
        for (let k = -2; k <= 2; k++) { g.beginPath(); g.arc(gx, gy + k * span / 2, 2 * dpr, 0, 7); g.stroke(); }
        const dv = clamp(-L.err / 2.5, -1, 1) * span;
        g.beginPath(); g.moveTo(gx - 7 * dpr, gy + dv); g.lineTo(gx, gy + dv - 5 * dpr); g.lineTo(gx + 7 * dpr, gy + dv); g.lineTo(gx, gy + dv + 5 * dpr); g.closePath(); g.stroke();
        const lyy = by + sy * 0.42;
        for (let k = -2; k <= 2; k++) { g.beginPath(); g.arc(bx + k * span / 2, lyy, 2 * dpr, 0, 7); g.stroke(); }
        const dl = clamp(-L.lineup / 12, -1, 1) * span;
        g.beginPath(); g.moveTo(bx + dl, lyy - 7 * dpr); g.lineTo(bx + dl, lyy + 7 * dpr); g.stroke();
        g.fillText('CV ' + (L.dist / 1000).toFixed(1), gx, gy - span - 8 * dpr);
      }
      g.textAlign = 'left';
    }
    // refuelling: range and closure to the drogue
    if (env.tanker) {
      const T = env.tanker; g.textAlign = 'right';
      g.fillText(T.contact ? (T.state === 'fuel' ? 'FUEL +' + Math.round(T.transfer) + ' KG' : 'CONTACT') : 'DROGUE ' + (T.range < 99 ? T.range.toFixed(1) : '--') + ' M', rx, ly + fs * 5.2);
      // the hose reel wants 1 to 3.5 m of push-in for the fuel valve to open
      if (T.contact) g.fillText(T.pushIn < 0.8 ? 'PUSH IN' : T.pushIn > 3.3 ? 'BACK OFF' : 'IN RANGE', rx, ly + fs * 6.5);
      if (!T.contact && T.range < 60) g.fillText('VC ' + (T.closure >= 0 ? '+' : '') + T.closure.toFixed(1), rx, ly + fs * 6.5);
      g.textAlign = 'left';
    }
    // flight-control law annunciation
    if (ac.lawName && ac.lawName !== 'NORMAL') { g.textAlign = 'center'; g.fillText(ac.lawName === 'LANDING' ? 'ПОС' : ac.lawName === 'GROUND' ? '' : 'DIRECT', bx, by - sy * 0.9); g.textAlign = 'left'; }
    if (!ac.fbwReady) { g.textAlign = 'center'; g.fillText('FCS TEST ' + Math.round(ac.fbwBit * 100) + '%', bx, by + sy * 0.25); }
    if (env.waveOff && (performance.now() % 500) < 300) { g.textAlign = 'center'; g.font = `bold ${fs * 1.6}px "JetBrains Mono", monospace`; g.fillText('WAVE OFF', bx, by - sy * 0.55); g.font = `${fs}px "JetBrains Mono", ui-monospace, monospace`; }
    if (ac.engines.some(e => e.chr)) { g.textAlign = 'center'; g.fillText('ЧР', bx, by + sy * 0.6); }
    // warnings
    g.textAlign = 'center';
    const warn = [];
    if (!ac.onGround && t.alpha * R2D > 24) warn.push('AOA LIMIT');
    if (t.nz > 7.5) warn.push('OVER-G');
    if (!ac.onGround && alt < 150 && t.vs < -25 && ac.gear < 0.5) warn.push('PULL UP');
    if (ac.fuel < 600) warn.push('BINGO FUEL');
    if (warn.length && (performance.now() % 700) < 450) { g.font = `bold ${fs * 1.2}px "JetBrains Mono", monospace`; g.fillText(warn.join('  '), bx, by + sy * 0.45); }
    g.restore();
  }
}

// ================================================================= MFDs
export class Displays {
  constructor() {
    this.mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return { c, g: c.getContext('2d'), t }; };
    this.L = this.mk(512, 670); this.C = this.mk(512, 670); this.R = this.mk(512, 670); this.U = this.mk(512, 150);
    this.last = 0;
  }
  frame(d, title) {
    const g = d.g, W = d.c.width, H = d.c.height;
    g.fillStyle = '#020403'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#1d3a26'; g.lineWidth = 2; g.strokeRect(6, 6, W - 12, H - 12);
    g.fillStyle = '#8affb0'; g.font = '600 22px "JetBrains Mono", monospace'; g.textAlign = 'left';
    const tabs = title.split('|');
    tabs.forEach((s, i) => { const x = 20 + i * 96; g.fillStyle = i === 0 ? '#0e2a18' : '#020403'; g.fillRect(x - 6, 14, 88, 30); g.fillStyle = i === 0 ? '#caffd9' : '#5fb07a'; g.fillText(s, x, 37); });
  }
  blank(d, text) {
    const g = d.g; g.fillStyle = '#000'; g.fillRect(0, 0, d.c.width, d.c.height);
    if (text) { g.fillStyle = '#6fe89a'; g.font = '600 26px "JetBrains Mono", monospace'; g.textAlign = 'center'; text.split('\n').forEach((l, i) => g.fillText(l, d.c.width / 2, d.c.height / 2 - 20 + i * 36)); }
  }
  update(ac, env, now) {
    if (now - this.last < 90) return;
    this.last = now;
    const pw = ac.power();
    const on = pw === 'gen' || pw === 'apu';
    if (!on) { this.onAt = null; for (const d of [this.L, this.C, this.R, this.U]) { this.blank(d); d.t.needsUpdate = true; } return; }
    if (!this.onAt) this.onAt = now;
    if (now - this.onAt < 3500) {
      const p = Math.min(100, Math.round((now - this.onAt) / 35));
      for (const d of [this.L, this.C, this.R]) this.blank(d, 'MFI-10-7\nSELF TEST ' + p + '%');
      this.blank(this.U, 'BIT'); for (const d of [this.L, this.C, this.R, this.U]) d.t.needsUpdate = true; return;
    }
    this.engine(ac); this.nav(ac, env); this.pfd(ac); this.ufcp(ac, env);
    for (const d of [this.L, this.C, this.R, this.U]) d.t.needsUpdate = true;
  }
  engine(ac) {
    const d = this.L, g = d.g; this.frame(d, 'ENG|FUEL|SYS|WPN');
    g.font = '20px "JetBrains Mono", monospace';
    for (let i = 0; i < 2; i++) {
      const e = ac.engines[i];
      const x = 70 + i * 150, y0 = 520, h = 330;
      // N2 rpm tape (0-105 %), idle and MIL marks
      g.strokeStyle = '#4bd27a'; g.lineWidth = 2; g.strokeRect(x, y0 - h, 46, h);
      const frac = Math.min(e.N / 1.05, 1);
      g.fillStyle = e.AB > 0.05 ? '#ffb347' : e.state === 'starting' ? '#e8e27a' : '#3ef07a';
      g.fillRect(x + 4, y0 - h * frac, 38, h * frac);
      g.fillStyle = '#e8fff0';
      for (const [v, l] of [[0.70, 'IDLE'], [1.0, 'MIL']]) { const yy = y0 - h * v / 1.05; g.fillRect(x - 8, yy, 8, 2); g.font = '14px "JetBrains Mono", monospace'; g.fillText(l, x - 50, yy + 5); }
      g.font = '20px "JetBrains Mono", monospace'; g.textAlign = 'center';
      g.fillText((e.N * 100).toFixed(0) + '%', x + 23, y0 + 28);
      g.fillStyle = '#9fe8b6'; g.fillText(i ? 'RIGHT' : 'LEFT', x + 23, y0 + 54);
      const egtC = e.egt > 880 ? '#ff5a4a' : e.egt > 800 ? '#ffb347' : '#e8fff0';
      g.fillStyle = egtC; g.fillText('T4 ' + Math.round(e.egt), x + 23, y0 - h - 44);
      g.fillStyle = e.state === 'running' ? '#3ef07a' : e.state === 'starting' ? '#e8e27a' : '#5a6f60';
      g.fillText(e.state === 'running' ? (e.AB > 0.05 ? 'AB ' + Math.round(e.AB * 100) : 'RUN') : e.state === 'starting' ? 'START' : 'OFF', x + 23, y0 - h - 18);
      g.textAlign = 'left';
    }
    g.fillStyle = '#e8fff0'; g.textAlign = 'left';
    const T = (ac.engines[0].T + ac.engines[1].T) / 1000;
    const X = 360;
    g.fillText('THRUST', X, 110); g.fillText(T.toFixed(0) + ' kN', X, 136);
    g.fillText('FUEL', X, 176); g.fillText(Math.round(ac.fuel) + ' kg', X, 202);
    g.fillText('FF ' + Math.round((ac.fuelFlow || 0) * 3600) + ' kg/h', X - 20, 232);
    g.fillText('APU ' + (ac.apu.state === 'running' ? 'ON' : ac.apu.state === 'starting' ? Math.round(ac.apu.N * 100) + '%' : 'OFF'), X, 268);
    g.fillText('PWR ' + ac.power().toUpperCase(), X, 296);
    g.fillStyle = ac.fbwReady ? (ac.fbw ? '#3ef07a' : '#ffb347') : '#e8e27a';
    g.fillText(ac.fbwReady ? (ac.fbw ? 'FCS ' + (ac.lawName || 'NORM').slice(0, 4) : 'FCS DIRECT') : 'FCS BIT ' + Math.round(ac.fbwBit * 100), X - 20, 330);
    const flags = [['GEAR', ac.gear > 0.95, ac.gear > 0.05 && ac.gear < 0.95, ac.damage.gear], ['FLAPS', ac.flap > 0.9, ac.flap > 0.05 && ac.flap < 0.9], ['HOOK', ac.hook > 0.95, ac.hook > 0.05 && ac.hook < 0.95],
      ['SPDBRK', ac.airbrake > 0.9, ac.airbrake > 0.05 && ac.airbrake < 0.9], ['CANOPY', ac.canopy < 0.02 && !ac.canopyLost, ac.canopy > 0.02, ac.canopyLost], ['WINGS', ac.fold < 0.02, ac.fold > 0.02],
      ['HOLDBACK', !!ac.holdback, false], ['PARK BRK', ac.parkBrake, false]];
    flags.forEach(([n, on, tr, bad], i) => { g.fillStyle = bad ? '#ff5a4a' : tr ? '#ffb347' : on ? '#3ef07a' : '#2c4a36'; g.fillText((on ? '■ ' : '□ ') + n, X - 20, 372 + i * 30); });
  }
  nav(ac, env) {
    const d = this.C, g = d.g; this.frame(d, 'NAV|MAP|RDR|COM');
    const W = 512, cx = W / 2, cy = 380, R = 210;
    const hdg = ac.t.heading || 0;
    g.save(); g.translate(cx, cy);
    g.strokeStyle = '#2f8a50'; g.lineWidth = 1.5;
    for (const r of [R / 3, (2 * R) / 3, R]) { g.beginPath(); g.arc(0, 0, r, 0, 7); g.stroke(); }
    g.rotate(-hdg * D2R);
    g.fillStyle = '#9fe8b6'; g.font = '20px "JetBrains Mono", monospace'; g.textAlign = 'center';
    for (let a = 0; a < 360; a += 10) {
      g.save(); g.rotate(a * D2R);
      g.beginPath(); g.moveTo(0, -R); g.lineTo(0, -R + (a % 30 === 0 ? 16 : 8)); g.stroke();
      if (a % 30 === 0) g.fillText(a === 0 ? 'N' : a === 90 ? 'E' : a === 180 ? 'S' : a === 270 ? 'W' : String(a / 10), 0, -R + 38);
      g.restore();
    }
    // ship
    const scale = R / 20000; // 20 km full range
    if (env.ship) {
      const dx = env.ship.position.x - ac.pos.x, dz = env.ship.position.z - ac.pos.z;
      const px = dx * scale, py = dz * scale;
      const r = Math.hypot(px, py);
      const k = r > R ? R / r : 1;
      g.save(); g.translate(px * k, py * k); g.rotate(0);
      g.fillStyle = '#ffd36b'; g.beginPath(); g.moveTo(0, -12); g.lineTo(6, 10); g.lineTo(-6, 10); g.closePath(); g.fill();
      g.restore();
      env.shipRange = Math.hypot(dx, dz); env.shipBrg = (Math.atan2(dx, -dz) * R2D + 360) % 360;
    }
    g.restore();
    // own aircraft symbol
    g.strokeStyle = '#e8fff0'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(cx, cy - 16); g.lineTo(cx, cy + 14); g.moveTo(cx - 14, cy); g.lineTo(cx + 14, cy); g.moveTo(cx - 6, cy + 12); g.lineTo(cx + 6, cy + 12); g.stroke();
    g.fillStyle = '#e8fff0'; g.textAlign = 'left'; g.font = '20px "JetBrains Mono", monospace';
    g.fillText('HDG ' + String(Math.round(hdg)).padStart(3, '0'), 22, 80);
    if (env.shipRange != null) {
      g.fillText('CARRIER ' + String(Math.round(env.shipBrg)).padStart(3, '0') + '° ' + (env.shipRange / 1000).toFixed(1) + ' KM', 22, 108);
    }
    g.textAlign = 'right'; g.fillText('20 KM', W - 22, 80);
    g.fillText('WIND ' + Math.round(env.windKt || 0) + ' KT', W - 22, 108);
  }
  pfd(ac) {
    const d = this.R, g = d.g; this.frame(d, 'PFD|ADI|APP|TEST');
    const t = ac.t, W = 512, cx = W / 2, cy = 330, R = 170;
    g.save();
    g.beginPath(); g.arc(cx, cy, R, 0, 7); g.clip();
    g.translate(cx, cy); g.rotate(-(t.phi || 0));
    const pp = (t.theta || 0) * R2D * 4.2;
    g.fillStyle = '#2a6fb0'; g.fillRect(-400, -800 + pp, 800, 800);
    g.fillStyle = '#6b4a2a'; g.fillRect(-400, pp, 800, 800);
    g.strokeStyle = '#f0f0f0'; g.lineWidth = 2; g.fillStyle = '#f0f0f0'; g.font = '16px "JetBrains Mono", monospace'; g.textAlign = 'center';
    g.beginPath(); g.moveTo(-400, pp); g.lineTo(400, pp); g.stroke();
    for (let a = -60; a <= 60; a += 10) { if (!a) continue; const y = pp - a * 4.2; g.beginPath(); g.moveTo(-40, y); g.lineTo(40, y); g.stroke(); g.fillText(String(a), 60, y + 6); }
    g.restore();
    g.strokeStyle = '#ffd36b'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(cx - 80, cy); g.lineTo(cx - 25, cy); g.lineTo(cx - 12, cy + 12); g.moveTo(cx + 80, cy); g.lineTo(cx + 25, cy); g.lineTo(cx + 12, cy + 12); g.stroke();
    g.strokeStyle = '#4bd27a'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke();
    g.fillStyle = '#e8fff0'; g.font = '24px "JetBrains Mono", monospace'; g.textAlign = 'left';
    g.fillText('V ' + Math.round(t.ias * 3.6), 20, 570);
    g.fillText('H ' + Math.round(ac.pos.y), 20, 604);
    g.textAlign = 'right';
    g.fillText('α ' + (t.alpha * R2D).toFixed(1), W - 20, 570);
    g.fillText('n ' + t.nz.toFixed(1), W - 20, 604);
    g.textAlign = 'center';
    g.fillText('M ' + t.M.toFixed(2) + '   Vy ' + t.vs.toFixed(0), cx, 640);
  }
  ufcp(ac, env) {
    const d = this.U, g = d.g;
    g.fillStyle = '#031207'; g.fillRect(0, 0, 512, 150);
    g.fillStyle = '#7dff9c'; g.font = '600 40px "JetBrains Mono", monospace'; g.textAlign = 'left';
    g.fillText('UHF 124.300', 20, 60);
    g.fillText(env.mode || 'NAV', 20, 120);
    g.textAlign = 'right'; g.fillText(ac.onGround ? 'WOW' : 'AIR', 492, 120);
  }
}
