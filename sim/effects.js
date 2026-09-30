// Particle effects: tyre smoke, hook sparks, wingtip vortices, contrails, transonic vapour, deck exhaust haze.
import * as THREE from 'three';

function puffTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Effects {
  constructor(scene, n = 700) {
    this.scene = scene;
    const tex = puffTex();
    this.pool = [];
    for (let i = 0; i < n; i++) {
      const add = i >= n - 120;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0, fog: true,
        blending: add ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: !add }));
      s.visible = false; s.userData = { life: 0, add };
      scene.add(s); this.pool.push(s);
    }
    this.i = 0; this.ia = 0;
    this.lastTrail = [null, null, null, null];
    // transonic vapour cone (Prandtl-Glauert condensation)
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 1.2, 4.5, 40, 1, true),
      new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { k: { value: 0 } },
        vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec2 vUv; void main(){ vUv=uv; vec4 mv=modelViewMatrix*vec4(position,1.); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }',
        fragmentShader: 'uniform float k; varying vec3 vN; varying vec3 vV; varying vec2 vUv; void main(){ float f = pow(1.0-abs(dot(vN,vV)),1.5); float e = smoothstep(0.0,0.35,vUv.y)*smoothstep(1.0,0.55,vUv.y); gl_FragColor = vec4(vec3(1.0), f*e*k*0.55); }' }));
    cone.rotation.x = Math.PI / 2; cone.visible = false;
    this.cone = cone;
  }
  attach(model) { model.add(this.cone); this.cone.position.set(0, 0.4, -0.5); }

  spawn(pos, vel, size, grow, life, opacity, color = 0xffffff, additive = false) {
    let s;
    if (additive) { s = this.pool[this.pool.length - 120 + (this.ia++ % 120)]; }
    else { s = this.pool[this.i++ % (this.pool.length - 120)]; }
    s.position.copy(pos);
    s.userData.vel = vel.clone(); s.userData.life = life; s.userData.max = life; s.userData.size = size; s.userData.grow = grow; s.userData.op = opacity;
    s.material.color.set(color); s.material.opacity = opacity; s.scale.setScalar(size); s.visible = true;
  }

  tyreSmoke(p, shipV, intensity = 1) {
    for (let k = 0; k < 6 * intensity; k++) {
      const v = shipV.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 0.8 + Math.random() * 1.5, 4 + Math.random() * 6));
      this.spawn(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.2, 0)), v, 0.8, 2.6, 1.6 + Math.random(), 0.55, 0xdcdcd8);
    }
  }
  sparks(p, v) {
    for (let k = 0; k < 4; k++) {
      const vv = v.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, 1 + Math.random() * 2, (Math.random() - 0.5) * 4));
      this.spawn(p, vv, 0.12, 0, 0.25 + Math.random() * 0.2, 1, 0xffb040, true);
    }
  }

  update(dt, ac, model, env) {
    const g = new THREE.Vector3(0, -3, 0);
    for (const s of this.pool) {
      if (!s.visible) continue;
      const u = s.userData;
      u.life -= dt;
      if (u.life <= 0) { s.visible = false; continue; }
      const k = u.life / u.max;
      s.position.addScaledVector(u.vel, dt);
      if (u.add) u.vel.addScaledVector(g, dt * 2); else u.vel.multiplyScalar(1 - 0.6 * dt);
      s.scale.setScalar(u.size + u.grow * (1 - k));
      s.material.opacity = u.op * (u.add ? k : k * k);
    }
    if (!model || ac.crashed) return;
    const t = ac.t;
    const hum = ac.pos.y < 4000 ? 1 : 0.3;
    // wingtip vortices at high lift
    const cl = t.L / Math.max(t.qbar * 42, 1);
    const vort = Math.max(0, (t.alpha * 57.3 - 9) / 10) * Math.min(1, t.qbar / 15000) * hum;
    // contrails above 8.5 km
    const contrail = ac.pos.y > 8500 && ac.pos.y < 13500 ? Math.min(1, (ac.pos.y - 8500) / 800) : 0;
    const pts = [new THREE.Vector3(-6.05, 0, 2.3), new THREE.Vector3(6.05, 0, 2.3), new THREE.Vector3(-0.87, -0.45, 7.5), new THREE.Vector3(0.87, -0.45, 7.5)];
    for (let i = 0; i < 4; i++) {
      const on = i < 2 ? vort > 0.05 && !ac.onGround : contrail > 0 && ac.engines[i - 2].state === 'running';
      const wp = pts[i].clone().applyQuaternion(ac.quat).add(ac.pos);
      if (!on) { this.lastTrail[i] = null; continue; }
      const last = this.lastTrail[i];
      const spacing = i < 2 ? 2.5 : 10;
      if (last && last.distanceTo(wp) < spacing) continue;
      this.lastTrail[i] = wp.clone();
      if (i < 2) this.spawn(wp, new THREE.Vector3(), 0.35, 0.9, 0.9, Math.min(0.5, vort * 0.35), 0xffffff);
      else this.spawn(wp, new THREE.Vector3(), 1.4, 9, 26, 0.55 * contrail, 0xffffff);
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
        const wp = new THREE.Vector3(side, -0.45, 8 + Math.random() * 4).applyQuaternion(ac.quat).add(ac.pos);
        const v = new THREE.Vector3(0, 1.5, 22).applyQuaternion(ac.quat).add(env.shipVelocity || new THREE.Vector3());
        this.spawn(wp, v, 1.2, 5, 1.2, ac.AB[0] > 0.1 ? 0.12 : 0.06, 0xbfbfbf);
      }
    }
  }
}
