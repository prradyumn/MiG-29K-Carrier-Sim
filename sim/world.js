// Environment: sky, sea, clouds and an INS Vikramaditya-style STOBAR carrier (procedural).
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';

const D2R = Math.PI / 180;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
function tab(t, x) {
  if (x <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) if (x <= t[i][0]) { const [a, b] = t[i - 1], [c, d] = t[i]; return b + (d - b) * (x - a) / (c - a); }
  return t[t.length - 1][1];
}
function rnd(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// ================================================================= SKY / SUN
export function makeSky(scene, renderer, sunElev = 28, sunAz = 215) {
  const sky = new Sky();
  sky.scale.setScalar(450000);
  const u = sky.material.uniforms;
  u.turbidity.value = 3.2; u.rayleigh.value = 2.0; u.mieCoefficient.value = 0.003; u.mieDirectionalG.value = 0.82;
  const sun = new THREE.Vector3().setFromSphericalCoords(1, (90 - sunElev) * D2R, sunAz * D2R);
  u.sunPosition.value.copy(sun);
  scene.add(sky);
  // environment map from the sky (for PBR reflections)
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const sky2 = new Sky(); sky2.scale.setScalar(1000);
  for (const k in u) if (sky2.material.uniforms[k]) sky2.material.uniforms[k].value = u[k].value;
  envScene.add(sky2);
  // a dark 'sea' hemisphere so reflections below the horizon are water-coloured
  const seaHemi = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x0b1e2a, side: THREE.BackSide }));
  envScene.add(seaHemi);
  const env = pmrem.fromScene(envScene, 0.02).texture;
  scene.environment = env;
  return { sky, sun, env };
}

// ================================================================= SEA
export function makeWater(scene, sunDir, normalsTex) {
  normalsTex.wrapS = normalsTex.wrapT = THREE.RepeatWrapping;
  const water = new Water(new THREE.PlaneGeometry(60000, 60000, 1, 1), {
    textureWidth: 1024, textureHeight: 1024, waterNormals: normalsTex,
    sunDirection: sunDir.clone().normalize(), sunColor: 0xfff4e0, waterColor: 0x06202e, distortionScale: 3.2, fog: true,
  });
  water.rotation.x = -Math.PI / 2;
  water.material.uniforms.size.value = 1.6;
  scene.add(water);
  return water;
}

// ================================================================= CLOUDS
function puffTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const r = rnd(7);
  for (let i = 0; i < 40; i++) {
    const x = 128 + (r() - 0.5) * 110, y = 128 + (r() - 0.5) * 80, rad = 30 + r() * 60;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, 'rgba(255,255,255,0.22)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeClouds(scene) {
  const tex = puffTexture();
  const group = new THREE.Group();
  const r = rnd(42);
  const mats = [0xffffff, 0xf2f4f7, 0xe4e8ee].map(c => new THREE.SpriteMaterial({ map: tex, color: c, transparent: true, depthWrite: false, fog: true, opacity: 0.95 }));
  for (let k = 0; k < 90; k++) {
    const cx = (r() - 0.5) * 50000, cz = (r() - 0.5) * 50000;
    if (Math.hypot(cx, cz) < 2500) continue;
    const cy = 1400 + r() * 900;
    const n = 6 + Math.floor(r() * 9);
    const size = 500 + r() * 900;
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(mats[Math.floor(r() * 3)]);
      s.position.set(cx + (r() - 0.5) * size * 1.6, cy + (r() - 0.3) * size * 0.35, cz + (r() - 0.5) * size * 1.2);
      const sc = size * (0.6 + r() * 0.7);
      s.scale.set(sc, sc * 0.62, 1);
      group.add(s);
    }
  }
  scene.add(group);
  return group;
}

// ================================================================= CARRIER
export const SHIP = {
  deckY: 19.0, bowZ: -142, sternZ: 142, rampStart: -97, rampR: 182,
  xmax: [[-142, 7], [-128, 13], [-100, 18], [-60, 22], [-20, 24], [40, 25], [100, 23], [130, 20], [142, 14]],
  xmin: [[-142, -7], [-128, -12], [-100, -15], [-60, -17], [-10, -22], [20, -30], [60, -33], [100, -31], [130, -24], [142, -16]],
  angle: 6 * D2R, landA: new THREE.Vector2(0, 139), wires: [38, 50, 62], wireSpan: 15,
  start: [new THREE.Vector3(3, 0, 53), new THREE.Vector3(3, 0, -37)],   // run to the bow: 195 m (long) and 105 m (short)
  island: { x0: 13.5, x1: 24.5, z0: -34, z1: 26, top: 44 },
};

export function rampHeight(z) {
  if (z >= SHIP.rampStart) return { h: 0, dhdz: 0 };
  const t = Math.min(SHIP.rampStart - z, SHIP.rampStart - SHIP.bowZ);
  const R = SHIP.rampR;
  const h = R - Math.sqrt(R * R - t * t);
  return { h, dhdz: -t / Math.sqrt(R * R - t * t) };
}

function deckTexture() {
  const W = 1024, H = 4096;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const X = x => (x + 34) / 68 * W, Z = z => (z + 145) / 290 * H, S = W / 68;
  g.fillStyle = '#3a3d41'; g.fillRect(0, 0, W, H);
  // non-skid speckle and wear
  const r = rnd(3);
  for (let i = 0; i < 90000; i++) {
    const v = 50 + Math.floor(r() * 26);
    g.fillStyle = `rgb(${v},${v + 2},${v + 5})`;
    g.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2);
  }
  // exhaust staining at the take-off spots and tyre marks
  const stain = (x, z, rx, rz, a) => { const grd = g.createRadialGradient(X(x), Z(z), 0, X(x), Z(z), rx * S);
    grd.addColorStop(0, `rgba(15,14,13,${a})`); grd.addColorStop(1, 'rgba(15,14,13,0)'); g.save(); g.translate(X(x), Z(z)); g.scale(1, rz / rx); g.translate(-X(x), -Z(z));
    g.fillStyle = grd; g.beginPath(); g.arc(X(x), Z(z), rx * S, 0, 7); g.fill(); g.restore(); };
  for (const s of SHIP.start) stain(s.x, s.z + 12, 5, 16, 0.55);
  // landing area tyre marks along the angled deck
  const ca = Math.cos(SHIP.angle), sa = Math.sin(SHIP.angle);
  const la = SHIP.landA;
  const LX = t => la.x - sa * t, LZ = t => la.y - ca * t;
  g.save();
  for (let i = 0; i < 260; i++) {
    const t = 20 + r() * 110, off = (r() - 0.5) * 7;
    g.strokeStyle = `rgba(18,18,18,${0.12 + r() * 0.2})`; g.lineWidth = 1.5 + r() * 2;
    g.beginPath(); g.moveTo(X(LX(t) + off * ca), Z(LZ(t) - off * sa)); g.lineTo(X(LX(t + 12) + off * ca), Z(LZ(t + 12) - off * sa)); g.stroke();
  }
  g.restore();
  // landing area: edge lines and dashed centre line
  const line = (x0, z0, x1, z1, col, w, dash) => { g.strokeStyle = col; g.lineWidth = w * S; g.setLineDash(dash ? dash.map(d => d * S) : []);
    g.beginPath(); g.moveTo(X(x0), Z(z0)); g.lineTo(X(x1), Z(z1)); g.stroke(); g.setLineDash([]); };
  const L = 175;
  for (const off of [-11, 11]) line(LX(0) + off * ca, LZ(0) - off * sa, LX(L) + off * ca, LZ(L) - off * sa, '#d8d8d2', 0.4, null);
  line(LX(0), LZ(0), LX(L), LZ(L), '#e8e8e0', 0.35, [6, 6]);
  // foul line (red/white) along starboard edge of landing area
  for (let t = 0; t < L; t += 3) { const off = 12.5; line(LX(t) + off * ca, LZ(t) - off * sa, LX(t + 1.5) + off * ca, LZ(t + 1.5) - off * sa, t % 6 < 3 ? '#b8322c' : '#dddddd', 0.35, null); }
  // wires
  for (const t of SHIP.wires) { const px = -ca, pz = sa; // not used
    line(LX(t) - SHIP.wireSpan * ca, LZ(t) + SHIP.wireSpan * sa, LX(t) + SHIP.wireSpan * ca, LZ(t) - SHIP.wireSpan * sa, '#9aa0a6', 0.25, null); }
  // touchdown aim box
  g.strokeStyle = '#e0e0d8'; g.lineWidth = 0.3 * S;
  // take-off lanes: yellow lines from start positions to the bow
  for (const s of SHIP.start) {
    line(s.x, s.z + 8, s.x, SHIP.bowZ + 1, '#d9b21e', 0.35, null);
    g.fillStyle = '#d9b21e';
    g.fillRect(X(s.x - 4), Z(s.z) - 0.2 * S, 8 * S, 0.4 * S);
    g.font = `bold ${5 * S}px sans-serif`; g.textAlign = 'center';
    g.fillText(s === SHIP.start[0] ? '2' : '1', X(s.x - 7), Z(s.z) + 2 * S);
  }
  // deck edge lines
  for (let z = -140; z < 140; z += 2) {
    line(tab(SHIP.xmax, z) - 0.8, z, tab(SHIP.xmax, z + 2) - 0.8, z + 2, '#cfcfc8', 0.25, null);
    line(tab(SHIP.xmin, z) + 0.8, z, tab(SHIP.xmin, z + 2) + 0.8, z + 2, '#cfcfc8', 0.25, null);
  }
  // elevators
  g.strokeStyle = '#8c8f92'; g.lineWidth = 0.25 * S;
  g.strokeRect(X(12), Z(40), 10 * S, 17 * S);
  g.strokeRect(X(-8), Z(95), 16 * S, 18 * S);
  // helicopter spots on starboard aft
  for (let i = 0; i < 2; i++) { g.strokeStyle = '#e8e8e0'; g.lineWidth = 0.3 * S; g.beginPath(); g.arc(X(15), Z(66 + i * 22), 5.5 * S, 0, 7); g.stroke();
    g.fillStyle = '#e8e8e0'; g.font = `bold ${3.4 * S}px sans-serif`; g.textAlign = 'center'; g.fillText(String(i + 3), X(15), Z(66 + i * 22) + 1.2 * S); }
  // pennant number on the ski-jump approach
  g.save(); g.fillStyle = 'rgba(235,235,228,0.9)'; g.font = `bold ${14 * S}px sans-serif`; g.textAlign = 'center';
  g.translate(X(-4), Z(-78)); g.rotate(Math.PI); g.fillText('33', 0, 0); g.restore();
  // ski-jump chevrons
  for (let z = -140; z < -98; z += 6) { g.fillStyle = 'rgba(210,210,200,0.6)'; g.fillRect(X(-5), Z(z), 10 * S, 0.5 * S); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.anisotropy = 8;
  return t;
}

function lsoTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return { c, t };
}

export class Carrier extends THREE.Group {
  constructor(opts = {}) {
    super();
    this.velocity = new THREE.Vector3(0, 0, -(opts.speed ?? 12));
    this.build();
  }

  xRange(z) { return [tab(SHIP.xmin, z), tab(SHIP.xmax, z)]; }

  deckAt(xl, zl) {
    if (zl < SHIP.bowZ || zl > SHIP.sternZ) return null;
    const [a, b] = this.xRange(zl);
    if (xl < a || xl > b) return null;
    const r = rampHeight(zl);
    return { h: SHIP.deckY + r.h, dhdz: r.dhdz };
  }

  build() {
    const deckMat = new THREE.MeshStandardMaterial({ map: deckTexture(), roughness: 0.92, metalness: 0.0 });
    const grey = new THREE.MeshStandardMaterial({ color: 0x70787f, roughness: 0.72, metalness: 0.15 });
    const greyD = new THREE.MeshStandardMaterial({ color: 0x5b6268, roughness: 0.75, metalness: 0.15 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1f22, roughness: 0.5, metalness: 0.3 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x0c1418, roughness: 0.08, metalness: 0.8 });
    const red = new THREE.MeshStandardMaterial({ color: 0x6a1f1a, roughness: 0.8 });
    // ---- flight deck slab (top follows ski-jump)
    const rows = [], NZ = 286, NX = 18;
    const pos = [], uv = [], idx = [];
    for (let k = 0; k <= NZ; k++) {
      const z = SHIP.bowZ + (SHIP.sternZ - SHIP.bowZ) * k / NZ;
      const [a, b] = this.xRange(z);
      const h = SHIP.deckY + rampHeight(z).h;
      for (let j = 0; j <= NX; j++) {
        const x = a + (b - a) * j / NX;
        pos.push(x, h, z); uv.push((x + 34) / 68, (z + 145) / 290);
      }
    }
    for (let k = 0; k < NZ; k++) for (let j = 0; j < NX; j++) {
      const i0 = k * (NX + 1) + j, i1 = i0 + 1, i2 = i0 + NX + 1, i3 = i2 + 1;
      idx.push(i0, i2, i1, i1, i2, i3);
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    dg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    dg.setIndex(idx); dg.computeVertexNormals();
    const deck = new THREE.Mesh(dg, deckMat); deck.receiveShadow = true; deck.name = 'deck';
    this.add(deck);
    // deck edge walls (from edge down to 16.5 m) + ramp side skirts
    const wall = [], widx = [];
    const addWall = (side) => {
      const base = wall.length / 3;
      for (let k = 0; k <= NZ; k++) {
        const z = SHIP.bowZ + (SHIP.sternZ - SHIP.bowZ) * k / NZ;
        const [a, b] = this.xRange(z);
        const x = side > 0 ? b : a;
        const h = SHIP.deckY + rampHeight(z).h;
        wall.push(x, h, z, x, 16.2, z);
      }
      for (let k = 0; k < NZ; k++) { const i = base + k * 2; if (side > 0) widx.push(i, i + 1, i + 2, i + 2, i + 1, i + 3); else widx.push(i, i + 2, i + 1, i + 2, i + 3, i + 1); }
    };
    addWall(1); addWall(-1);
    // bow face and stern face
    const addEnd = (z, flip) => {
      const [a, b] = this.xRange(z); const h = SHIP.deckY + rampHeight(z).h; const base = wall.length / 3;
      wall.push(a, h, z, b, h, z, a, 16.2, z, b, 16.2, z);
      if (flip) widx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2); else widx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    };
    addEnd(SHIP.bowZ, false); addEnd(SHIP.sternZ, true);
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wall, 3)); wg.setIndex(widx); wg.computeVertexNormals();
    const walls = new THREE.Mesh(wg, greyD); walls.receiveShadow = true; this.add(walls);
    // deck underside
    const us = new THREE.Shape();
    for (let z = SHIP.bowZ; z <= SHIP.sternZ; z += 4) us.lineTo(tab(SHIP.xmax, z), z);
    for (let z = SHIP.sternZ; z >= SHIP.bowZ; z -= 4) us.lineTo(tab(SHIP.xmin, z), z);
    const ug = new THREE.ShapeGeometry(us); ug.rotateX(Math.PI / 2); ug.translate(0, 16.2, 0);
    // ShapeGeometry is built in XY; after rotating X by +90deg, y->z. Fix mapping of shape y to world z:
    const up = ug.attributes.position;
    for (let i = 0; i < up.count; i++) { /* already x, 16.2, y */ }
    this.add(new THREE.Mesh(ug, greyD));
    // ---- hull
    const HB = [[-142, 0.4], [-130, 5], [-110, 11], [-80, 15], [-40, 16.5], [60, 16.5], [110, 15.6], [142, 13.5]];
    const hp = [], hi = [];
    const NZH = 72, prof = [[1.0, 16.2], [0.99, 8], [0.96, 0], [0.88, -5], [0.62, -9.5], [0.0, -10.2]];
    for (let k = 0; k <= NZH; k++) {
      const z = SHIP.bowZ + (SHIP.sternZ - SHIP.bowZ) * k / NZH;
      const hw = tab(HB, z);
      const bowRake = z < -120 ? (z + 120) * -0.35 : 0;
      for (let s = -1; s <= 1; s += 2) for (const [f, y] of prof) hp.push(s * hw * f, y, z + (y < 10 ? bowRake * (10 - y) / 26 : 0));
    }
    const P = prof.length * 2;
    for (let k = 0; k < NZH; k++) {
      for (let j = 0; j < prof.length - 1; j++) {
        // starboard strip
        const a = k * P + prof.length + j, b = a + 1, c = a + P, d = c + 1;
        hi.push(a, b, c, b, d, c);
        const a2 = k * P + j, b2 = a2 + 1, c2 = a2 + P, d2 = c2 + 1;
        hi.push(a2, c2, b2, b2, c2, d2);
      }
    }
    // transom
    const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.Float32BufferAttribute(hp, 3)); hg.setIndex(hi); hg.computeVertexNormals();
    // colour: grey above waterline, dark red below, black boot-top
    const cols = [];
    for (let i = 0; i < hp.length; i += 3) { const y = hp[i + 1]; const c = y > 0.8 ? [0.39, 0.42, 0.45] : y > -0.6 ? [0.05, 0.05, 0.05] : [0.30, 0.09, 0.07]; cols.push(...c); }
    hg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const hull = new THREE.Mesh(hg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.1, side: THREE.DoubleSide }));
    hull.receiveShadow = true; this.add(hull);
    const tr = new THREE.Mesh(new THREE.PlaneGeometry(27, 26), greyD); tr.position.set(0, 3.2, SHIP.sternZ); this.add(tr);
    // hull pennant number
    const pc = document.createElement('canvas'); pc.width = 256; pc.height = 128; const pg = pc.getContext('2d');
    pg.fillStyle = '#e8e8e2'; pg.font = 'bold 110px sans-serif'; pg.textAlign = 'center'; pg.fillText('R33', 128, 108);
    const ptex = new THREE.CanvasTexture(pc); ptex.colorSpace = THREE.SRGBColorSpace;
    for (const s of [1, -1]) {
      const pm = new THREE.Mesh(new THREE.PlaneGeometry(14, 7), new THREE.MeshBasicMaterial({ map: ptex, transparent: true, fog: true }));
      pm.position.set(s * 12.2, 11, -112); pm.rotation.y = s * Math.PI / 2 + s * 0.30; this.add(pm);
    }
    // ---- island
    const I = SHIP.island, D = SHIP.deckY;
    const box = (w, h, d, x, y, z, m = grey) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = b.receiveShadow = true; this.add(b); return b; };
    const cyl = (r0, r1, h, x, y, z, m = grey, seg = 12) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), m); c.position.set(x, y, z); c.castShadow = true; this.add(c); return c; };
    const cx = (I.x0 + I.x1) / 2, W = I.x1 - I.x0, L = I.z1 - I.z0, cz = (I.z0 + I.z1) / 2;
    // tiered superstructure with door and port rows
    box(W, 7, L, cx, D + 3.5, cz);
    box(W + 0.3, 0.35, L + 0.3, cx, D + 7.1, cz, greyD);
    box(W - 1.2, 6, L - 8, cx + 0.3, D + 10.2, cz - 3);
    box(W - 0.9, 0.3, L - 7.7, cx + 0.3, D + 13.3, cz - 3, greyD);
    for (let z = I.z0 + 3; z < I.z1 - 2; z += 3.2) { box(0.1, 0.55, 0.8, I.x0 - 0.02, D + 5.2, z, dark); box(0.1, 0.5, 0.7, I.x0 + 0.58, D + 11.6, z - 3, dark); }
    for (const z of [I.z0 + 6, cz + 4, I.z1 - 7]) box(0.12, 2.2, 1.2, I.x0 - 0.03, D + 1.1, z, greyD);
    // navigation bridge with raked windows + bridge wings
    const bz = I.z0 + 16;
    box(W - 0.6, 3.6, 22, cx + 0.2, D + 15.1, bz);
    const win = box(W - 0.2, 1.3, 22.4, cx + 0.2, D + 15.9, bz, glass);
    box(W + 4.5, 0.35, 3.2, cx - 1.5, D + 13.9, bz - 9, greyD);
    // primary flight control (glassed, looking over the deck)
    box(5.5, 3.4, 12, I.x0 + 2.2, D + 19.0, I.z1 - 16);
    box(5.8, 1.5, 12.3, I.x0 + 2.2, D + 19.6, I.z1 - 16, glass);
    // radar block: four phased-array faces
    box(8.5, 7, 12, cx + 0.7, D + 20.5, bz - 1);
    for (const [x, z, w2, d2] of [[cx + 0.7 - 4.3, bz - 1, 0.25, 5], [cx + 0.7 + 4.3, bz - 1, 0.25, 5], [cx + 0.7, bz - 7.05, 5, 0.25], [cx + 0.7, bz + 5.05, 5, 0.25]])
      box(w2, 4.2, d2, x, D + 21, z, dark);
    // funnel with raked cap
    box(6.2, 7, 11, cx + 1.4, D + 16.5, I.z1 - 4.5, greyD);
    box(5.6, 0.8, 10.2, cx + 1.4, D + 20.3, I.z1 - 4.5, dark);
    // main mast, yards, platforms and domes
    const mastX = cx + 0.7, mastZ = bz - 1;
    cyl(0.45, 0.8, 18, mastX, D + 33, mastZ);
    for (const [y, w2] of [[D + 29, 10], [D + 35, 7], [D + 39.5, 4.5]]) box(w2, 0.3, 0.3, mastX, y, mastZ, grey);
    box(3.2, 0.25, 3.2, mastX, D + 31, mastZ, greyD);
    const white = new THREE.MeshStandardMaterial({ color: 0xdcdedf, roughness: 0.6 });
    for (const [x, y, z, r] of [[mastX, D + 43.2, mastZ, 1.5], [cx - 2.5, D + 25.5, bz + 4, 1.7], [cx + 3.5, D + 25.5, bz + 4, 1.7], [cx - 2, D + 22.5, I.z1 - 14, 1.1], [cx + 3, D + 24.8, bz - 6, 1.0]]) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 12), white); s.position.set(x, y, z); s.castShadow = true; this.add(s);
      cyl(0.25, 0.35, 1.2, x, y - r - 0.3, z, greyD, 8);
    }
    const rad = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.6, 7), dark); rad.position.set(mastX, D + 37.2, mastZ); this.add(rad); this.radar = rad;
    // whip antennas
    for (const [x, z, h] of [[I.x1 - 0.5, I.z0 + 3, 9], [I.x1 - 0.5, I.z1 - 2, 8], [cx + 3, bz + 9, 7], [I.x0 + 1, I.z0 + 1, 6]]) cyl(0.05, 0.08, h, x, D + 14 + h / 2, z, greyD, 5);
    // pennant number on the island
    const pc2 = document.createElement('canvas'); pc2.width = 256; pc2.height = 128; const pg2 = pc2.getContext('2d');
    pg2.fillStyle = '#e8e8e2'; pg2.font = 'bold 110px sans-serif'; pg2.textAlign = 'center'; pg2.fillText('R33', 128, 108);
    const pt2 = new THREE.CanvasTexture(pc2); pt2.colorSpace = THREE.SRGBColorSpace;
    const pn = new THREE.Mesh(new THREE.PlaneGeometry(9, 4.5), new THREE.MeshBasicMaterial({ map: pt2, transparent: true, fog: true }));
    pn.position.set(I.x0 - 0.06, D + 9.8, cz + 6); pn.rotation.y = -Math.PI / 2; this.add(pn);
    // ---- arresting wires & jet blast deflectors
    const ca = Math.cos(SHIP.angle), sa = Math.sin(SHIP.angle);
    const la = SHIP.landA;
    this.wires = [];
    const wireMat = new THREE.MeshStandardMaterial({ color: 0x8b9096, roughness: 0.35, metalness: 0.9 });
    for (const t of SHIP.wires) {
      const cx = la.x - sa * t, cz = la.y - ca * t;
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, SHIP.wireSpan * 2, 6), wireMat);
      w.rotation.z = Math.PI / 2; w.rotation.y = -SHIP.angle;
      w.position.set(cx, D + 0.09, cz);
      this.add(w);
      this.wires.push({ t, c: new THREE.Vector3(cx, D, cz), mesh: w });
    }
    this.landDir = new THREE.Vector3(-sa, 0, -ca);  // landing direction in ship coords
    this.landPerp = new THREE.Vector3(ca, 0, -sa);
    this.jbd = [];
    for (const s of SHIP.start) {
      const pivot = new THREE.Group(); pivot.position.set(s.x, D, s.z + 12); this.add(pivot);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(11, 3.6, 0.25), greyD); plate.position.set(0, 1.8, 0); plate.castShadow = true;
      pivot.add(plate); pivot.rotation.x = Math.PI / 2; this.jbd.push(pivot);
    }
    // deck tractors / equipment
    const yel = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.7 });
    for (const [x, z] of [[19.5, 38], [20, 128], [-26, 30]]) box(2.2, 1.4, 4.2, x, D + 0.7, z, yel);
    // optical landing system (lens) on the port sponson
    const tl = SHIP.wires[1] - 5;                 // hook touchdown target: 5 m short of wire 2, the target wire
    // the lens is set for the MiG-29K hook-to-eye geometry at on-speed AoA: eye 4.3 m above and 10.5 m ahead of the hook tip
    const ta = tl + 4.3 / Math.tan(4 * D2R) + 10.5;
    const lensT = ta - 8;
    const lx = tab(SHIP.xmin, la.y - ca * lensT) + 1.2;
    const lso = lsoTexture();
    this.lens = lso;
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.8), new THREE.MeshBasicMaterial({ map: lso.t, toneMapped: false }));
    lens.position.set(lx, D + 2.6, la.y - ca * lensT); lens.rotation.y = 0.05;
    this.add(lens);
    box(1.8, 2.6, 0.8, lx, D + 1.3, la.y - ca * lensT - 0.45, dark);
    this.touchdown = new THREE.Vector3(la.x - sa * tl, D, la.y - ca * tl);
    this.lensAim = new THREE.Vector3(la.x - sa * ta, D, la.y - ca * ta);
    // deck edge lights
    const lg = new THREE.SphereGeometry(0.12, 6, 4);
    const lm = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
    for (let z = -130; z <= 138; z += 12) for (const s of [0, 1]) {
      const m = new THREE.Mesh(lg, lm); m.position.set(s ? tab(SHIP.xmax, z) - 0.3 : tab(SHIP.xmin, z) + 0.3, SHIP.deckY + rampHeight(z).h + 0.1, z); this.add(m);
    }
    // wake
    this.add(this.makeWake());
    this.traverse(o => { if (o.isMesh && o !== deck) o.castShadow = true; });
  }

  makeWake() {
    const c = document.createElement('canvas'); c.width = 256; c.height = 1024; const g = c.getContext('2d');
    const r = rnd(11);
    for (let i = 0; i < 5000; i++) {
      const y = r() * 1024, spread = 20 + y * 0.2, x = 128 + (r() - 0.5) * 2 * spread * Math.sqrt(r());
      const a = 0.18 * (1 - y / 1024) * (0.4 + r());
      g.fillStyle = `rgba(255,255,255,${a})`; g.beginPath(); g.ellipse(x, y, 2 + r() * 5, 4 + r() * 14, 0, 0, 7); g.fill();
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(90, 900), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, fog: true }));
    m.rotation.x = -Math.PI / 2; m.position.set(0, 0.35, SHIP.sternZ + 440);
    const bow = new THREE.Mesh(new THREE.PlaneGeometry(40, 120), m.material.clone()); bow.material.opacity = 0.7;
    bow.rotation.x = -Math.PI / 2; bow.position.set(0, 0.3, -90);
    const g2 = new THREE.Group(); g2.add(m); g2.add(bow); return g2;
  }

  // optical landing system: gyro-stabilised, so the glide slope is referenced to the horizon, not the deck
  updateLens(worldPos, waveOff = false, time = 0) {
    const td = this.localToWorld(this.lensAim.clone());
    const dirW = this.landDir.clone().applyQuaternion(this.quaternion); dirW.y = 0; dirW.normalize();
    const perpW = new THREE.Vector3(-dirW.z, 0, dirW.x);
    const d = worldPos.clone().sub(td);
    const dist = -d.dot(dirW);
    const ang = Math.atan2(d.y, Math.max(dist, 1)) / D2R;
    const lineup = d.dot(perpW);             // + = right of centreline
    const err = clamp((ang - 4.0) / 0.75, -2.5, 2.5);
    const { c, t } = this.lens;
    const g = c.getContext('2d');
    g.fillStyle = '#050607'; g.fillRect(0, 0, 128, 256);
    g.fillStyle = '#29ff5a'; g.fillRect(4, 124, 34, 10); g.fillRect(90, 124, 34, 10);
    for (let i = 0; i < 5; i++) { g.fillStyle = '#1d1f22'; g.fillRect(44, 22 + i * 44, 40, 40); }
    const y = 128 - err * 44;
    g.fillStyle = err < -1.9 ? '#ff2a1a' : '#ffb21e';
    g.beginPath(); g.arc(64, clamp(y, 30, 226), 16, 0, 7); g.fill();
    if (waveOff && (time % 0.5) < 0.3) { g.fillStyle = '#ff1a10'; g.fillRect(4, 20, 30, 90); g.fillRect(94, 20, 30, 90); g.fillRect(4, 150, 30, 90); g.fillRect(94, 150, 30, 90); }
    t.needsUpdate = true;
    return { err, dist, ang, lineup };
  }

  setSea(state) { this.sea = state; }

  update(dt) {
    this.time = (this.time || 0) + dt;
    const s = this.sea ?? 1, T = this.time;
    const w1 = 2 * Math.PI / 8.6, w2 = 2 * Math.PI / 9.8, w3 = 2 * Math.PI / 13.4;
    const heave = 0.45 * s * Math.sin(w1 * T), pitch = 0.32 * s * D2R * Math.sin(w2 * T + 1.0), roll = 0.55 * s * D2R * Math.sin(w3 * T + 2.1);
    this.angVel = new THREE.Vector3(0.32 * s * D2R * w2 * Math.cos(w2 * T + 1.0), 0, 0.55 * s * D2R * w3 * Math.cos(w3 * T + 2.1));
    this.heaveRate = 0.45 * s * w1 * Math.cos(w1 * T);
    this.base = this.base || new THREE.Vector3();
    this.base.addScaledVector(this.velocity, dt);
    this.position.set(this.base.x, heave, this.base.z);
    this.rotation.set(pitch, 0, roll);
    this.updateMatrixWorld();
    if (this.radar) this.radar.rotation.y += dt * 2.2;
  }

  // deck surface under a world point: height, normal and velocity of the deck at that point
  surfaceAt(x, z) {
    const lp = this.worldToLocal(new THREE.Vector3(x, this.position.y + SHIP.deckY, z));
    const d = this.deckAt(lp.x, lp.z);
    if (!d) return null;
    const P = this.localToWorld(new THREE.Vector3(lp.x, d.h, lp.z));
    const n = new THREE.Vector3(0, 1, -d.dhdz).normalize().applyQuaternion(this.quaternion);
    const r = P.clone().sub(this.position);
    const v = this.velocity.clone().add(new THREE.Vector3(0, this.heaveRate || 0, 0)).add((this.angVel || new THREE.Vector3()).clone().cross(r));
    return { h: P.y, n, v, water: false, deck: true };
  }

  // air wake behind the ship ("burble"): downdraft and turbulence in the last kilometre of the approach
  wakeAt(p, time) {
    const lp = this.worldToLocal(p.clone());
    const out = new THREE.Vector3();
    if (lp.z > 100 && lp.z < 1200 && Math.abs(lp.x) < 120 && lp.y < 180) {
      const f = Math.exp(-Math.pow((lp.z - 380) / 260, 2)) * Math.exp(-Math.pow(lp.x / 70, 2)) * clamp(1 - lp.y / 180, 0, 1);
      out.y -= 1.0 * f * (this.sea ?? 1);
      const turb = (0.3 + 0.5 * (this.sea ?? 1)) * clamp(1 - (lp.z - 140) / 900, 0, 1) * clamp(1 - lp.y / 180, 0, 1);
      out.x += turb * (Math.sin(time * 1.7 + lp.z * 0.02) * 0.7 + Math.sin(time * 3.1) * 0.3);
      out.y += turb * (Math.sin(time * 2.3 + lp.z * 0.013) * 0.6 + Math.sin(time * 4.7 + 1) * 0.25);
    }
    return out;
  }
}
