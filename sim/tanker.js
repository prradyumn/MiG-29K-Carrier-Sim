// Buddy tanker: a second MiG-29K carrying the refuelling pod (Blender model/upaz.json), a simulated hose
// (point masses with distance constraints, gravity and air drag) and the drogue. Contact, fuel transfer and
// break-away are judged at the receiver's probe tip.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const S0 = 9.25, st2z = s => -(S0 - s);
const NSEG = 14, HOSE = 15.5;                   // hose trailed length (m)

export class Tanker {
  constructor(scene) {
    this.scene = scene; this.active = false; this.ready = false;
    this.group = new THREE.Group(); this.group.visible = false; scene.add(this.group);
    this.pos = V3(); this.quat = new THREE.Quaternion(); this.vel = V3();
    this.contact = false; this.broken = false; this.range = 999; this.closure = 0; this.transfer = 0;
  }
  load(model) {
    // clone the airframe now, before the cockpit controls are attached to it
    const jet = model.clone(true);
    return new Promise((res, rej) => new GLTFLoader().load('model/upaz.json', g => {
      jet.traverse(o => {
        if (o.isSprite || o.userData.flame || o.userData.ab) o.visible = false;
        if (o.isMesh && o.geometry.type === 'CylinderGeometry' && o.material.type === 'ShaderMaterial') o.visible = false;
        if (/^(Gear_|NoseGearDoors|MainBayDoor|TailHook|IFRProbe|Pilot_Mask|Hand_|Panel|Ctl_|Guard_|R77_|R73_)/.test(o.name)) o.visible = false;
      });
      // gear retracted: hide the struts, keep the doors closed (the bay doors are the belly skin)
      this.jet = jet; this.group.add(jet);
      const pod = g.scene.getObjectByName('UPAZ_Pod'), drogue = g.scene.getObjectByName('Drogue');
      pod.position.set(0, -0.86, st2z(9.3)); jet.add(pod);
      this.pod = pod; this.rat = g.scene.getObjectByName('UPAZ_RAT');
      this.lights = [0, 1, 2].map(k => pod.getObjectByName('PodLight' + k));
      this.lights.forEach(l => { if (l) l.material = l.material.clone(); });
      this.drogue = drogue; this.group.add(drogue);
      // hose exit in pod-local coordinates: the tail of the pod (pod is 4.6 m long, pylon attach near its middle)
      this.exitLocal = V3(0, -0.48, 2.55);
      this.hoseMat = new THREE.MeshStandardMaterial({ color: 0x1e2124, roughness: 0.6, metalness: 0.2 });
      this.hose = new THREE.Mesh(new THREE.BufferGeometry(), this.hoseMat); this.group.add(this.hose);
      // node state in the tanker frame
      this.P = []; this.O = [];
      for (let i = 0; i <= NSEG; i++) { const p = V3(0, -i * 0.2, i * HOSE / NSEG); this.P.push(p.clone()); this.O.push(p.clone()); }
      this.ready = true; res();
    }, undefined, rej));
  }
  // place the tanker ahead of the receiver, same heading
  start(ac, dist = 600, alt = null) {
    if (!this.ready) return;
    const fwd = V3(0, 0, -1).applyQuaternion(ac.quat); fwd.y = 0; fwd.normalize();
    this.pos.copy(ac.pos).addScaledVector(fwd, dist); this.pos.y = alt ?? ac.pos.y + 15;
    this.speed = 139;                                    // 500 km/h
    this.heading = Math.atan2(-fwd.x, -fwd.z);
    this.quat.setFromEuler(new THREE.Euler(2.2 * Math.PI / 180, this.heading, 0, 'YXZ'));
    this.vel.copy(fwd).multiplyScalar(this.speed);
    this.active = true; this.group.visible = true; this.contact = false; this.broken = false; this.t = 0; this.transfer = 0;
    const exit = this.exitTanker();
    for (let i = 0; i <= NSEG; i++) { const p = exit.clone().add(V3(0, -i * 0.25, i * HOSE / NSEG)); this.P[i].copy(p); this.O[i].copy(p); }
  }
  stop() { this.active = false; this.group.visible = false; this.contact = false; }
  exitTanker() {                                   // hose exit in the tanker (jet) frame
    return this.exitLocal.clone().add(this.pod.position);
  }
  update(dt, ac, probeTipWorld, sound, flash) {
    if (!this.active || !this.ready) return;
    this.t += dt;
    // tanker flies straight and level at 500 km/h with a gentle bob
    this.pos.addScaledVector(this.vel, dt);
    const bob = 0.25 * Math.sin(this.t * 0.4) + 0.12 * Math.sin(this.t * 1.1);
    this.jet.position.set(0, bob, 0); this.group.position.copy(this.pos); this.group.quaternion.copy(this.quat);
    this.group.updateMatrixWorld(true);
    if (this.rat) this.rat.rotation.z += dt * 40;
    // --- hose: Verlet in the tanker frame. Air streams aft at the tanker's speed: drag pulls nodes aft, gravity down.
    const exit = this.exitTanker().add(V3(0, bob, 0));
    const toLocal = new THREE.Matrix4().copy(this.group.matrixWorld).invert();
    const tip = probeTipWorld ? probeTipWorld.clone().applyMatrix4(toLocal) : null;
    const g = V3(0, -9.81, 0).applyQuaternion(this.quat.clone().invert());
    const turb = V3(Math.sin(this.t * 1.7) * 0.6 + Math.sin(this.t * 3.9) * 0.3, Math.sin(this.t * 1.3 + 1) * 0.5, 0);
    const n = this.P.length, seg = HOSE / NSEG;
    for (let i = 1; i < n; i++) {
      const p = this.P[i], o = this.O[i];
      const v = p.clone().sub(o);
      const drag = i === n - 1 ? 60 : 26;                       // the basket carries most of the drag
      const acc = g.clone().add(V3(0, 0, drag)).add(turb.clone().multiplyScalar(i / n));
      // bow wave: the receiver's nose pushes the basket away when it is close
      if (tip && i === n - 1 && !this.contact) { const d = p.clone().sub(tip); d.z = 0; const L = d.length(); if (L < 1.2 && L > 0.05 && tip.z > p.z + 1.2) acc.addScaledVector(d.normalize(), (1.2 - L) * 2.0); }
      o.copy(p); p.addScaledVector(v, 0.965).addScaledVector(acc, dt * dt);
    }
    this.P[0].copy(exit);
    if (this.contact && tip) this.P[n - 1].copy(tip);
    for (let it = 0; it < 10; it++) {
      for (let i = 0; i < n - 1; i++) {
        const a = this.P[i], b = this.P[i + 1], d = b.clone().sub(a), L = d.length() || 1e-6;
        // the reel takes up slack when the receiver pushes in (hose can shorten, never stretch)
        const target = this.contact ? Math.min(seg, L) : seg;
        const k = (L - target) / L;
        if (i === 0) b.addScaledVector(d, -k);
        else if (i + 1 === n - 1 && this.contact) a.addScaledVector(d, k);
        else { a.addScaledVector(d, k * 0.5); b.addScaledVector(d, -k * 0.5); }
      }
      this.P[0].copy(exit); if (this.contact && tip) this.P[n - 1].copy(tip);
    }
    // --- contact logic at the drogue coupling
    const end = this.P[n - 1], prev = this.P[n - 2];
    const dir = end.clone().sub(prev).normalize();
    this.state = 'trail';
    if (tip) {
      const rel = tip.clone().sub(end);
      this.range = rel.length();
      const recvVel = ac.vel.clone().sub(this.vel).applyQuaternion(this.quat.clone().invert());
      this.closure = -recvVel.dot(dir);                          // + = closing on the basket
      const pulled = end.distanceTo(this.P[0]); this.pushIn = HOSE - pulled;
      // capture: the probe tip inside the basket cone (0.37 m radius at its mouth, 0.97 m aft of the coupling) funnels into the coupling
      const axial = rel.dot(dir), radial = rel.clone().addScaledVector(dir, -axial).length();
      const inCone = axial > -0.05 && axial < 1.05 && radial < 0.06 + 0.29 * clamp(axial / 0.97, 0, 1);
      this.inBasket = inCone;
      if (!this.contact && !this.broken && ac.probe > 0.95 && inCone && axial < 0.35) {
        if (this.closure > 3.2) { this.broken = true; flash('Hose broke: closure ' + this.closure.toFixed(1) + ' m/s is too fast!', 5); sound.burst?.(900, 0.4, 0.7, 'bandpass'); this.hoseMat.color.set(0x552222); }
        else if (this.closure > 0.3) { this.contact = true; flash('Contact! Fuel flowing', 3); sound.clunk?.(); }
      }
      if (this.contact) {
        if (pulled > HOSE + 1.2 || ac.probe < 0.9) { this.contact = false; flash('Disconnect', 2); }
        else if (pulled < HOSE - 4) { this.contact = false; flash('Too far in: hose overrun, disconnect', 3); }
        else {
          const inRange = pulled < HOSE - 0.8;
          this.state = inRange ? 'fuel' : 'contact';
          if (inRange && ac.fuel < 4460) { const q = 13.3 * dt; ac.fuel = Math.min(4460, ac.fuel + q); this.transfer += q; }
        }
      }
    }
    // pod signal lights: amber = ready, green = fuel flowing, red = disconnect / fault
    const L = this.lights, st = this.broken ? 0 : this.state === 'fuel' ? 2 : 1;
    L.forEach((l, k) => { if (l) l.material.emissiveIntensity = k === st ? 6 : 0; });
    // drogue orientation and the hose mesh (world space)
    const endW = end.clone().applyMatrix4(this.group.matrixWorld);
    this.drogue.position.copy(end); this.drogue.quaternion.setFromUnitVectors(V3(0, 0, 1), dir);
    const pts = this.P.map(p => p.clone());
    this.hose.geometry.dispose();
    this.hose.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.045, 8, false);
    this.drogueWorld = endW;
    // collision with the tanker itself
    if (ac.pos.distanceTo(this.pos) < 9) ac.crash('Collision with the tanker');
  }
}
