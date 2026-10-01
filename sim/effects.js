// Particle effects: tyre smoke, hook sparks, wingtip vortices, contrails, transonic vapour, deck exhaust haze, the
// carrier's funnel exhaust, bow spray in a heavy sea, the rooster tail of a jet flying very low over the water, the
// splash of a ditching, and smoke / fire from an engine fire or a wreck.
// All particles are camera-facing quads drawn by two instanced meshes (alpha-blended and additive), so a thick smoke
// column costs two draw calls, not hundreds. They use the renderer's logarithmic depth and the scene fog.
import * as THREE from 'three';

// texture atlas, 4 tiles across: 0 soft puff, 1 billowy smoke, 2 spray droplets, 3 flame tongue
function atlas() {
  const T = 128, c = document.createElement('canvas'); c.width = T * 4; c.height = T; const g = c.getContext('2d');
  let q = 5; const r = () => ((q = (q * 1664525 + 1013904223) >>> 0) / 4294967296);
  // puff
  let grd = g.createRadialGradient(T / 2, T / 2, 2, T / 2, T / 2, T / 2 - 1);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, T, T);
  // smoke: overlapping soft blobs inside a round falloff
  for (let k = 0; k < 40; k++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * T * 0.28, x = T + T / 2 + Math.cos(a) * d, y = T / 2 + Math.sin(a) * d, rad = T * (0.10 + r() * 0.16);
    grd = g.createRadialGradient(x, y, 0, x, y, rad); grd.addColorStop(0, `rgba(255,255,255,${0.22 + r() * 0.2})`); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(T, 0, T, T);
  }
  // spray: a cloud of droplets and a faint mist
  grd = g.createRadialGradient(T * 2.5, T / 2, 0, T * 2.5, T / 2, T / 2); grd.addColorStop(0, 'rgba(255,255,255,0.7)'); grd.addColorStop(0.6, 'rgba(255,255,255,0.25)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(T * 2, 0, T, T);
  for (let k = 0; k < 260; k++) {
    const a = r() * Math.PI * 2, d = Math.pow(r(), 0.7) * T * 0.45, x = T * 2.5 + Math.cos(a) * d, y = T / 2 + Math.sin(a) * d;
    g.fillStyle = `rgba(255,255,255,${0.4 + r() * 0.6})`; g.beginPath(); g.arc(x, y, 0.6 + r() * 1.6, 0, Math.PI * 2); g.fill();
  }
  // flame: hot core with ragged tongues
  for (let k = 0; k < 14; k++) {
    const x = T * 3.5 + (r() - 0.5) * T * 0.35, y = T * (0.35 + r() * 0.4), rad = T * (0.12 + r() * 0.2);
    grd = g.createRadialGradient(x, y, 0, x, y, rad); grd.addColorStop(0, 'rgba(255,255,255,0.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(T * 3, 0, T, T);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const VERT = `
  attribute vec3 iPos; attribute vec4 iCol; attribute vec3 iMisc;    // colour + alpha; size, rotation, tile
  varying vec2 vUv; varying vec4 vCol; varying float vDepth;
  #include <common>
  #include <fog_pars_vertex>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
    float c = cos(iMisc.y), s = sin(iMisc.y);
    mvPosition.xy += mat2(c, s, -s, c) * position.xy * iMisc.x;
    vUv = vec2((uv.x + iMisc.z) * 0.25, uv.y); vCol = iCol; vDepth = -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
    #include <logdepthbuf_vertex>
    #include <fog_vertex>
  }`;
const FRAG = `
  uniform sampler2D map; uniform float uLight; uniform float uAdd;
  // soft particles (post stack): the scene's log depth decoded to view depth; fade where the particle meets geometry
  uniform sampler2D tDepth; uniform float uSoft, uLogFar; uniform vec2 uRes;
  varying vec2 vUv; varying vec4 vCol; varying float vDepth;
  #include <common>
  #include <fog_pars_fragment>
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    vec4 t = texture2D(map, vUv);
    float soft = 1.0;
    if (uSoft > 0.5) {
      float w = exp2(texture2D(tDepth, gl_FragCoord.xy / uRes).x * uLogFar) - 1.0;
      soft = clamp((w - vDepth) / 1.5, 0.0, 1.0);
    }
    gl_FragColor = vec4(vCol.rgb * (uAdd > 0.5 ? 1.0 : uLight), t.a * vCol.a * soft);
    if (gl_FragColor.a < 0.003) discard;
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

class Layer {
  constructor(scene, n, additive, tex) {
    this.n = n; this.count = 0;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.pos = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.col = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.misc = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.pos); g.setAttribute('iCol', this.col); g.setAttribute('iMisc', this.misc);
    g.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null }, uLight: { value: 1 }, uAdd: { value: additive ? 1 : 0 },
        tDepth: { value: null }, uSoft: { value: 0 }, uLogFar: { value: 1 }, uRes: { value: new THREE.Vector2(1, 1) } }]),
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mat.uniforms.map.value = tex;
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = additive ? 3 : 2;
    scene.add(this.mesh);
    // particle state (structure of arrays)
    this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3); this.c = new Float32Array(n * 3);
    this.life = new Float32Array(n); this.max = new Float32Array(n); this.size = new Float32Array(n); this.grow = new Float32Array(n);
    this.op = new Float32Array(n); this.g = new Float32Array(n); this.drag = new Float32Array(n); this.rot = new Float32Array(n); this.spin = new Float32Array(n); this.tile = new Float32Array(n);
    this.next = 0;
  }
  spawn(pos, vel, size, grow, life, opacity, color, o = {}) {
    // reuse a dead slot if the ring position is taken by a long-lived particle
    let i = this.next; for (let k = 0; k < 8 && this.life[i] > 0; k++) i = (i + 1) % this.n;
    this.next = (i + 1) % this.n;
    this.p[i * 3] = pos.x; this.p[i * 3 + 1] = pos.y; this.p[i * 3 + 2] = pos.z;
    this.v[i * 3] = vel.x; this.v[i * 3 + 1] = vel.y; this.v[i * 3 + 2] = vel.z;
    const col = _c.set(color); this.c[i * 3] = col.r; this.c[i * 3 + 1] = col.g; this.c[i * 3 + 2] = col.b;
    this.life[i] = this.max[i] = life; this.size[i] = size; this.grow[i] = grow; this.op[i] = opacity;
    this.g[i] = o.g ?? 0; this.drag[i] = o.drag ?? 0.6; this.rot[i] = Math.random() * 6.283; this.spin[i] = (Math.random() - 0.5) * (o.spin ?? 0.4);
    this.tile[i] = o.tile ?? 0;
  }
  update(dt, additive) {
    let n = 0;
    const P = this.pos.array, C = this.col.array, M = this.misc.array;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt; if (this.life[i] <= 0) continue;
      const k = this.life[i] / this.max[i], d = Math.max(0, 1 - this.drag[i] * dt);
      this.v[i * 3] *= d; this.v[i * 3 + 2] *= d; this.v[i * 3 + 1] = this.v[i * 3 + 1] * d - this.g[i] * dt;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      this.rot[i] += this.spin[i] * dt;
      P[n * 3] = this.p[i * 3]; P[n * 3 + 1] = this.p[i * 3 + 1]; P[n * 3 + 2] = this.p[i * 3 + 2];
      // fade in over the first 8 % of the life, out with k (squared for soft smoke)
      const fin = Math.min(1, (1 - k) / 0.08);
      C[n * 4] = this.c[i * 3]; C[n * 4 + 1] = this.c[i * 3 + 1]; C[n * 4 + 2] = this.c[i * 3 + 2];
      C[n * 4 + 3] = this.op[i] * fin * (additive ? k : k * k);
      M[n * 3] = this.size[i] + this.grow[i] * (1 - k); M[n * 3 + 1] = this.rot[i]; M[n * 3 + 2] = this.tile[i];
      n++;
    }
    this.mesh.geometry.instanceCount = n;
    if (n) { this.pos.needsUpdate = this.col.needsUpdate = this.misc.needsUpdate = true;
      }
  }
}
const _c = new THREE.Color(), _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();
const TILE = { puff: 0, smoke: 1, spray: 2, flame: 3 };

export class Effects {
  constructor(scene, n = 1600) {
    this.scene = scene;
    const tex = atlas();
    // particles live in their own scene: the post stack draws them after the clouds and aerial fog (which would
    // otherwise treat them as distant background), depth-tested in the shader against the scene depth
    this.fxScene = new THREE.Scene(); this.fxScene.fog = scene.fog;
    this.norm = new Layer(this.fxScene, n, false, tex);
    this.addl = new Layer(this.fxScene, 360, true, tex);
    this.lastTrail = [null, null, null, null];
    this.acc = { funnel: 0, bow: 0, rooster: 0, fire: [0, 0], wreck: 0 };
    this.wreck = null;
    // transonic vapour cone (Prandtl-Glauert condensation)
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 1.2, 4.5, 40, 1, true),
      new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { k: { value: 0 } },
        vertexShader: '#include <common>\n#include <logdepthbuf_pars_vertex>\nvarying vec3 vN; varying vec3 vV; varying vec2 vUv; void main(){ vUv=uv; vec4 mv=modelViewMatrix*vec4(position,1.); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv;\n#include <logdepthbuf_vertex>\n}',
        fragmentShader: '#include <common>\n#include <logdepthbuf_pars_fragment>\nuniform float k; varying vec3 vN; varying vec3 vV; varying vec2 vUv; void main(){\n#include <logdepthbuf_fragment>\nfloat f = pow(1.0-abs(dot(vN,vV)),1.5); float e = smoothstep(0.0,0.35,vUv.y)*smoothstep(1.0,0.55,vUv.y); gl_FragColor = vec4(vec3(1.0), f*e*k*0.55); }' }));
    cone.rotation.x = Math.PI / 2; cone.visible = false;
    this.cone = cone;
  }
  attach(model) { model.add(this.cone); this.cone.position.set(0, 0.4, -0.5); }
  // ambient light on the (unlit) smoke and spray: 1 by day, a few per cent at night
  setLight(k) { this.norm.mat.uniforms.uLight.value = k; }
  // soft = { depth, logFar, w, h } from the post stack, or null for the plain renderer (hardware depth test)
  setDepth(soft) {
    for (const L of [this.norm, this.addl]) {
      const u = L.mat.uniforms; L.mat.depthTest = !soft; u.uSoft.value = soft ? 1 : 0;
      if (soft) { u.tDepth.value = soft.depth; u.uLogFar.value = soft.logFar; u.uRes.value.set(soft.w, soft.h); }
    }
  }

  spawn(pos, vel, size, grow, life, opacity, color = 0xffffff, additive = false, o = {}) {
    if (typeof o.tile === 'string') o = { ...o, tile: TILE[o.tile] };
    (additive ? this.addl : this.norm).spawn(pos, vel, size, grow, life, opacity, color, o);
  }

  tyreSmoke(p, shipV, intensity = 1) {
    for (let k = 0; k < 6 * intensity; k++) {
      const v = shipV.clone().add(_v.set((Math.random() - 0.5) * 3, 0.8 + Math.random() * 1.5, 4 + Math.random() * 6));
      this.spawn(p.clone().add(_w.set((Math.random() - 0.5) * 0.4, 0.2, 0)), v, 0.8, 2.6, 1.6 + Math.random(), 0.55, 0xdcdcd8, false, { tile: 'smoke' });
    }
  }
  sparks(p, v) {
    for (let k = 0; k < 4; k++) {
      const vv = v.clone().add(_v.set((Math.random() - 0.5) * 4, 1 + Math.random() * 2, (Math.random() - 0.5) * 4));
      this.spawn(p, vv, 0.12, 0, 0.25 + Math.random() * 0.2, 1, 0xffb040, true, { g: 6, drag: 0 });
    }
  }
  // a ditching / sea impact: a column of white water, a ring of spray and a lingering mist
  splash(p, vel = new THREE.Vector3()) {
    const base = _w.set(p.x, 0.3, p.z).clone();
    for (let k = 0; k < 90; k++) {
      const a = Math.random() * 6.283, sp = 3 + Math.random() * 10, up = 10 + Math.random() * 24;
      this.spawn(base.clone().add(_v.set(Math.cos(a) * 1.5, 0, Math.sin(a) * 1.5)), _v.set(Math.cos(a) * sp + vel.x * 0.15, up, Math.sin(a) * sp + vel.z * 0.15).clone(),
        1.5 + Math.random() * 2, 5, 2.5 + Math.random() * 1.5, 0.75, 0xf2f6f8, false, { tile: 'spray', g: 9.8, drag: 0.25 });
    }
    for (let k = 0; k < 30; k++) {
      const a = Math.random() * 6.283;
      this.spawn(base.clone().add(_v.set(Math.cos(a) * 4, 1, Math.sin(a) * 4)), _v.set(Math.cos(a) * 6, 1.5, Math.sin(a) * 6).clone(), 4, 18, 8 + Math.random() * 4, 0.35, 0xe8eef0, false, { tile: 'smoke' });
    }
  }
  // a burning wreck on the deck (or a fire on the water): flames and a black smoke column for a minute
  burn(p, ship) { this.wreck = { p: p.clone(), t: 60, ship }; if (ship) this.wreck.local = ship.worldToLocal(p.clone()); }

  update(dt, ac, model, env, world = {}) {
    this.norm.update(dt, false); this.addl.update(dt, true);
    if (dt <= 0) return;
    this.worldFx(dt, ac, world, env);
    if (!model || ac.crashed) return;
    const t = ac.t;
    const hum = ac.pos.y < 4000 ? 1 : 0.3;
    // wingtip vortices at high lift
    const vort = Math.max(0, (t.alpha * 57.3 - 9) / 10) * Math.min(1, t.qbar / 15000) * hum;
    // contrails above 8.5 km
    const contrail = ac.pos.y > 8500 && ac.pos.y < 13500 ? Math.min(1, (ac.pos.y - 8500) / 800) : 0;
    const pts = [[-6.05, 0, 2.3], [6.05, 0, 2.3], [-0.87, -0.45, 7.5], [0.87, -0.45, 7.5]];
    for (let i = 0; i < 4; i++) {
      const on = i < 2 ? vort > 0.05 && !ac.onGround : contrail > 0 && ac.engines[i - 2].state === 'running';
      const wp = _v.set(...pts[i]).applyQuaternion(ac.quat).add(ac.pos);
      if (!on) { this.lastTrail[i] = null; continue; }
      const last = this.lastTrail[i];
      const spacing = i < 2 ? 2.5 : 10;
      if (last && last.distanceTo(wp) < spacing) continue;
      this.lastTrail[i] = wp.clone();
      if (i < 2) this.spawn(wp, _w.set(0, 0, 0), 0.35, 0.9, 0.9, Math.min(0.5, vort * 0.35), 0xffffff);
      else this.spawn(wp, _w.set(0, 0, 0), 1.4, 9, 26, 0.55 * contrail, 0xffffff, false, { tile: 'smoke', drag: 0 });
    }
    // transonic vapour cone
    const m = t.M;
    const k = Math.max(0, 1 - Math.abs(m - 0.98) / 0.05) * (ac.pos.y < 3500 ? 1 : 0.3) * Math.min(1, t.qbar / 40000);
    this.cone.visible = k > 0.02;
    this.cone.material.uniforms.k.value = k * (0.8 + 0.2 * Math.random());
    // exhaust shimmer on deck at high power: faint puffs of heated air
    if (ac.onGround && ac.engines.some(e => e.N > 0.95)) {
      if (Math.random() < 0.3) {
        const side = Math.random() < 0.5 ? -0.87 : 0.87;
        const wp = _v.set(side, -0.45, 8 + Math.random() * 4).applyQuaternion(ac.quat).add(ac.pos).clone();
        const v = _w.set(0, 1.5, 22).applyQuaternion(ac.quat).add(env.shipVelocity || new THREE.Vector3()).clone();
        this.spawn(wp, v, 1.2, 5, 1.2, ac.AB[0] > 0.1 ? 0.12 : 0.06, 0xbfbfbf);
      }
    }
    // engine fire: flames licking out of the engine bay and a thick dark trail
    for (let i = 0; i < 2; i++) {
      if (!ac.fail || !ac.fail.fire[i]) continue;
      this.acc.fire[i] += dt;
      while (this.acc.fire[i] > 0.008) {
      this.acc.fire[i] -= 0.008;
      const sd = i ? 0.87 : -0.87;
      // spread the puffs over the distance flown since the last frame, so the trail is continuous
      const wp = _v.set(sd, -0.2, 4.2 + Math.random() * 1.6).applyQuaternion(ac.quat).add(ac.pos).addScaledVector(ac.vel, -Math.random() * dt).clone();
      const v = ac.vel.clone().multiplyScalar(0.85).add(_w.set((Math.random() - 0.5) * 2, 1.5, (Math.random() - 0.5) * 2));
      this.spawn(wp, v, 1.1, 2.2, 0.35, 1.0, 0xff8a30, true, { tile: 'flame', spin: 3 });
      this.spawn(wp, ac.vel.clone().multiplyScalar(0.6), 1.4, 9, 6, 0.5, 0x1c1a18, false, { tile: 'smoke', drag: 0.9 });
      }
    }
  }

  // ship and sea effects (independent of the aircraft state)
  worldFx(dt, ac, w, env) {
    const ship = w.ship, sea = w.sea || 0;
    if (ship) {
      // funnel exhaust: hot gas and a faint grey haze from the boiler uptakes, drifting with the relative wind
      if ((this.acc.funnel += dt) > 0.22) {
        this.acc.funnel = 0;
        const p = ship.localToWorld(_v.set(20.6 + (Math.random() - 0.5) * 3, 43.8, 18.6 + (Math.random() - 0.5) * 5)).clone();
        this.spawn(p, _w.set((Math.random() - 0.5) * 0.6, 3.5 + Math.random(), (Math.random() - 0.5) * 0.6).clone(), 4, 26, 16, 0.2, 0x7d7f80, false, { tile: 'smoke', drag: 0.25, spin: 0.15 });
      }
      // bow spray: in a heavy sea the bow slams into the swell and throws sheets of water aft over the forecastle
      if (sea > 0.6) {
        this.acc.bow += dt * sea * sea * 0.35;
        if (this.acc.bow > 1 + Math.random() * 2) {
          this.acc.bow = 0;
          const sv = ship.velocity || new THREE.Vector3();
          for (const sd of [-1, 1]) for (let k = 0; k < 18 * Math.min(1.6, sea); k++) {
            const p = ship.localToWorld(_v.set(sd * (5 + Math.random() * 6), 1 + Math.random() * 3, -132 + Math.random() * 14)).clone();
            const out = _w.set(sd * (3 + Math.random() * 6), 6 + Math.random() * 10 * sea, 4 + Math.random() * 8).applyQuaternion(ship.quaternion).add(sv).clone();
            this.spawn(p, out, 2 + Math.random() * 2, 9, 2.6 + Math.random(), 0.85, 0xf4f7f8, false, { tile: 'spray', g: 9.8, drag: 0.3 });
          }
        }
      }
    }
    // rooster tail: below ~20 m over open water, the jet's wake throws up a sheet of spray behind it
    if (ac && !ac.crashed && !ac.onGround && ac.pos.y < 22 && env && env.surface) {
      const s = env.surface(ac.pos.x, ac.pos.z);
      const spd = ac.vel.length();
      if (s && s.water && spd > 70) {
        const k = (1 - ac.pos.y / 22) * Math.min(1, (spd - 70) / 120);
        if ((this.acc.rooster += dt * 60 * k) > 1) {
          this.acc.rooster = 0;
          const back = _w.copy(ac.vel).setY(0).normalize();
          const p = _v.set(ac.pos.x - back.x * 6, 0.4, ac.pos.z - back.z * 6).clone();
          for (let j = 0; j < 5; j++) this.spawn(p.clone().add(_w.set((Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 6)),
            _w.set(ac.vel.x * 0.25 + (Math.random() - 0.5) * 4, 6 + 14 * k * Math.random(), ac.vel.z * 0.25 + (Math.random() - 0.5) * 4).clone(),
            2.2, 9, 1.6 + Math.random(), Math.min(1, 1.2 * k), 0xf2f5f6, false, { tile: 'spray', g: 9.8, drag: 0.5 });
        }
      }
    }
    // a burning wreck
    if (this.wreck) {
      const W = this.wreck; W.t -= dt;
      if (W.t <= 0) { this.wreck = null; return; }
      const p = W.local && W.ship ? W.ship.localToWorld(W.local.clone()) : W.p;
      if ((this.acc.wreck += dt) > 0.05) {
        this.acc.wreck = 0;
        const sv = W.ship && W.ship.velocity ? W.ship.velocity : new THREE.Vector3(), f = Math.min(1, W.t / 20);
        this.spawn(p.clone().add(_v.set((Math.random() - 0.5) * 6, 0.5, (Math.random() - 0.5) * 6)), sv.clone().add(_w.set(0, 2 + Math.random() * 3, 0)), 1.5, 2.5, 0.6, 0.9 * f, 0xff7a28, true, { tile: 'flame', spin: 2 });
        this.spawn(p.clone().add(_v.set((Math.random() - 0.5) * 4, 2, (Math.random() - 0.5) * 4)), _w.set((Math.random() - 0.5), 5 + Math.random() * 3, (Math.random() - 0.5)).clone(), 3, 30, 14, 0.5 * f + 0.15, 0x161514, false, { tile: 'smoke', drag: 0.15, spin: 0.2 });
      }
    }
  }
}
