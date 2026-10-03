// Missions at the Siachen location: the valley-run course (traced up the real Siachen glacier floor from the snout
// towards Indira Col), its gates and scoring, Thoise runway lights and PAPI, and the landing grade.
import * as THREE from 'three';

// ------------------------------------------------------------------------------------------ the glacier course
// Walk up-glacier from the snout in 700 m steps, each time choosing the heading (within +-50 deg of the last) that
// climbs least, with a pull towards the head: the walk follows the valley floor round the glacier's bends.
export function glacierPath(T) {
  const M = T.meta, snout = new THREE.Vector2(...M.snout), head = new THREE.Vector2(...M.head);
  let p = snout.clone(), hd = head.clone().sub(snout).normalize();
  const pts = [p.clone()];
  for (let k = 0; k < 160 && p.distanceTo(head) > 3000; k++) {
    let best = null, bs = 1e9;
    for (let a = -50; a <= 50; a += 5) {
      const ang = a * Math.PI / 180, d = new THREE.Vector2(hd.x * Math.cos(ang) - hd.y * Math.sin(ang), hd.x * Math.sin(ang) + hd.y * Math.cos(ang));
      const q = p.clone().addScaledVector(d, 700);
      // valley floor: minimum climb, sampled a little ahead and to both sides (avoid notches in the walls)
      const hq = T.heightAt(q.x, q.y), hs = Math.max(T.heightAt(q.x - d.y * 250, q.y + d.x * 250), T.heightAt(q.x + d.y * 250, q.y - d.x * 250));
      const s = (hq - T.heightAt(p.x, p.y)) + 0.12 * (hs - hq) * 0 + 0.25 * (q.distanceTo(head) - p.distanceTo(head)) + 0.6 * Math.abs(a);
      if (s < bs) { bs = s; best = { q, d }; }
    }
    p = best.q; hd = hd.clone().lerp(best.d, 0.6).normalize(); pts.push(p.clone());
  }
  // smooth, then resample every 3.5 km
  const sm = pts.map((_, i) => { const a = pts[Math.max(0, i - 2)], b = pts[Math.min(pts.length - 1, i + 2)], c = pts[i]; return c.clone().multiplyScalar(0.4).addScaledVector(a.clone().add(b), 0.3); });
  const out = [sm[0].clone()]; let acc = 0;
  for (let i = 1; i < sm.length; i++) { acc += sm[i].distanceTo(sm[i - 1]); if (acc >= 3500) { out.push(sm[i].clone()); acc = 0; } }
  return out;
}

// ------------------------------------------------------------------------------------------ gates
export class ValleyRun {
  constructor(scene) { this.scene = scene; this.group = new THREE.Group(); this.group.visible = false; scene.add(this.group); this.active = false; }
  start(T, ac) {
    this.stop();
    const path = this.path ||= glacierPath(T);
    this.gates = [];
    const ringG = new THREE.TorusGeometry(95, 2.4, 10, 64);
    for (let i = 1; i < path.length; i++) {
      const p = path[i], prev = path[i - 1], dir = new THREE.Vector3(p.x - prev.x, 0, p.y - prev.y).normalize();
      const y = T.heightAt(p.x, p.y) + 230;
      const m = new THREE.MeshBasicMaterial({ color: 0xffa630, transparent: true, opacity: 0.85, fog: false, toneMapped: false, depthWrite: true });
      const ring = new THREE.Mesh(ringG, m); ring.position.set(p.x, y, p.y); ring.lookAt(ring.position.clone().add(dir));
      this.group.add(ring);
      this.gates.push({ pos: ring.position.clone(), dir, ring, passed: false, missed: false, side: null });
    }
    this.i = 0; this.t = 0; this.misses = 0; this.active = true; this.group.visible = true; this.done = false;
    return { start: path[0], dir: new THREE.Vector3(path[1].x - path[0].x, 0, path[1].y - path[0].y).normalize(), h: T.heightAt(path[0].x, path[0].y) };
  }
  stop() { this.active = false; this.group.visible = false; for (const c of [...this.group.children]) { this.group.remove(c); c.material.dispose(); } }
  // per physics frame: gate crossings; returns a message for the HUD when something happens
  update(dt, ac) {
    if (!this.active || this.done) return null;
    this.t += dt;
    const g = this.gates[this.i]; if (!g) return null;
    const rel = ac.pos.clone().sub(g.pos), s = rel.dot(g.dir);
    for (let k = 0; k < this.gates.length; k++) {
      const G = this.gates[k], cur = k === this.i;
      G.ring.material.color.set(G.passed ? 0x3dff7a : G.missed ? 0xff3b30 : cur ? 0xffd34a : 0xff9a2e);
      G.ring.material.opacity = cur ? 0.95 : G.passed || G.missed ? 0.25 : 0.55;
      if (cur) G.ring.scale.setScalar(1 + 0.04 * Math.sin(this.t * 6));
    }
    if (g.side === null) g.side = s;
    if (g.side < 0 && s >= 0) {
      const off = rel.addScaledVector(g.dir, -s).length();
      if (off < 95) g.passed = true; else { g.missed = true; this.misses++; }
      this.i++;
      if (this.i >= this.gates.length) { this.done = true; return { done: true, msg: `Valley run complete: ${this.fmt(this.t)}, ${this.gates.length - this.misses}/${this.gates.length} gates` }; }
      return { msg: (g.passed ? 'Gate ' : 'Missed gate ') + this.i + '/' + this.gates.length + ' · ' + this.fmt(this.t) };
    }
    g.side = s;
    return null;
  }
  fmt(t) { const m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ':' + String(s).padStart(2, '0'); }
  get next() { return this.active && !this.done ? this.gates[this.i] : null; }
}

// ------------------------------------------------------------------------------------------ runway lights and PAPI
function dotTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
}
export class RunwayLights {
  constructor(scene, T) {
    const r = T.rw, along = new THREE.Vector3(r.dir.x, 0, r.dir.y), left = new THREE.Vector3(r.dir.y, 0, -r.dir.x);
    const t10 = new THREE.Vector3(r.t10.x, 0, r.t10.y), L = r.len, tex = dotTex();
    const pts = [], cols = [];
    const add = (al, sd, col, lift = 0.5) => { const p = t10.clone().addScaledVector(along, al).addScaledVector(left, sd); p.y = r.e10 + (r.e28 - r.e10) * Math.min(1, Math.max(0, al / L)) + lift; pts.push(p); cols.push(new THREE.Color(col)); };
    for (let a = 0; a <= L; a += 60) { add(a, 23.5, a > L - 600 ? 0xffc040 : 0xfff4e0); add(a, -23.5, a < 600 ? 0xffc040 : 0xfff4e0); }
    for (let s = -21; s <= 21; s += 3) { add(-1, s, 0x40ff70); add(L + 1, s, 0xff3020); }
    for (let k = 1; k <= 10; k++) for (let s = -6; s <= 6; s += 3) { add(-k * 30, s, 0xfff4e0, 1.2); add(L + k * 30, s, 0xfff4e0, 1.2); }
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols.flatMap(c => [c.r, c.g, c.b]), 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ map: tex, size: 9, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: true, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }));
    // (lights write depth: the post stack's haze pass treats depth-less pixels as distant sky and would fog them out)
    this.points.visible = false; scene.add(this.points);
    // PAPI: four units left of each runway, 300 m in; colour by the eye's angle above the touchdown point
    this.papi = [];
    for (const [end, s] of [[0, 1], [L, -1]]) {
      const set = [];
      for (let k = 0; k < 4; k++) {
        const p = t10.clone().addScaledVector(along, end + s * 300).addScaledVector(left, (23 + 15 + k * 9) * s); p.y = (end ? r.e28 : r.e10) + 1.0;
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xffffff, transparent: true, depthWrite: true, blending: THREE.AdditiveBlending, toneMapped: false, fog: false, sizeAttenuation: false }));
        sp.scale.setScalar(0.012); sp.position.copy(p); scene.add(sp); set.push(sp);
      }
      this.papi.push({ set, td: t10.clone().addScaledVector(along, end + s * 300).setY(end ? r.e28 : r.e10), out: along.clone().multiplyScalar(-s) });
    }
    this.visible = false;
  }
  setVisible(v) { this.visible = v; this.points.visible = v; for (const p of this.papi) for (const s of p.set) s.visible = v; }
  update(eye, night) {
    if (!this.visible) return;
    this.points.material.size = 6 + 5 * night; this.points.material.opacity = 0.35 + 0.65 * night;
    for (const P of this.papi) {
      const d = eye.clone().sub(P.td), horiz = Math.hypot(d.x, d.z), ang = Math.atan2(d.y, horiz) * 180 / Math.PI;
      const facing = d.clone().setY(0).normalize().dot(P.out) > 0.3;
      // standard PAPI: 3.0 deg on, units switch at 2.5 / 2.83 / 3.17 / 3.5 deg
      const sw = [3.5, 3.17, 2.83, 2.5];
      P.set.forEach((s, k) => { s.visible = facing; s.material.color.set(ang > sw[k] ? 0xffffff : 0xff2a1a); s.material.opacity = 0.6 + 0.4 * night; s.scale.setScalar(0.009 + 0.006 * night); });
    }
  }
}

// ------------------------------------------------------------------------------------------ landing grade
export function gradeLanding(T, pos, sink, landRw) {
  const { along, side } = T.runwayLocal(pos.x, pos.z), L = T.rw.len;
  const fromThr = landRw === 28 ? L - along : along;
  const zone = fromThr > 150 && fromThr < 750, sinkOK = sink < 3.2, cl = Math.abs(side);
  const grade = !(fromThr > 0 && cl < 22) ? 'Off the runway' : zone && sinkOK && cl < 6 ? 'Good landing' : !sinkOK ? 'Hard landing' : fromThr < 150 ? 'Short of the touchdown zone' : fromThr > 750 ? 'Long landing' : 'Off the centreline';
  return `${grade}: ${Math.round(fromThr)} m past the threshold, ${sink.toFixed(1)} m/s sink, ${cl.toFixed(1)} m ${side > 0 ? 'left' : 'right'} of the centreline`;
}
