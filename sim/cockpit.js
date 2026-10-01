// Interactive cockpit: clickable switches, guards, levers and handles (geometry from the Blender-built
// model/controls.json), painted panel legends with night backlighting, live standby / engine gauges, the caution
// panel with master caution / master warning, rudder pedals and the pilot's gloved hands on stick and throttle.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const approach = (c, t, r) => c + clamp(t - c, -r, r);
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const S0 = 9.25, st2z = s => -(S0 - s);
const PAINT = '#e9ece6', PAINT_DIM = '#9aa39c';

// what each control means, for tooltips and the instructor
export const CONTROL_INFO = {
  bat: { name: 'Battery', panel: 'left wall, start panel', guard: true },
  pump: { name: 'Fuel boost pump', panel: 'left wall, start panel' },
  apu: { name: 'APU (auxiliary power unit)', panel: 'left wall, start panel' },
  engL: { name: 'Left engine master (fuel shut-off valve)', panel: 'left wall, start panel' },
  engR: { name: 'Right engine master (fuel shut-off valve)', panel: 'left wall, start panel' },
  startL: { name: 'Left engine START button', panel: 'left wall, start panel', guard: true },
  startR: { name: 'Right engine START button', panel: 'left wall, start panel', guard: true },
  genL: { name: 'Left generator', panel: 'left wall, start panel' },
  genR: { name: 'Right generator', panel: 'left wall, start panel' },
  gear: { name: 'Landing gear lever', panel: 'left front panel' },
  flaps: { name: 'Flaps (take-off / landing)', panel: 'left front panel' },
  hook: { name: 'Arrester hook handle', panel: 'left front panel' },
  park: { name: 'Parking brake handle', panel: 'left front panel' },
  canopy: { name: 'Canopy open / close', panel: 'right front panel' },
  fold: { name: 'Wing fold', panel: 'right front panel', guard: true },
  navlt: { name: 'Navigation lights', panel: 'right front panel' },
  beacon: { name: 'Anti-collision beacon', panel: 'right front panel' },
  ldglt: { name: 'Landing light', panel: 'right front panel' },
  probe: { name: 'Refuelling probe', panel: 'right front panel' },
  fcsrst: { name: 'Flight control system RESET', panel: 'right front panel' },
  mwarn: { name: 'MASTER WARNING (press to silence)', panel: 'main panel, top left' },
  mcaut: { name: 'MASTER CAUTION (press to reset)', panel: 'main panel, top right' },
};

function canvasTex(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.anisotropy = 8;
  return { c, g: c.getContext('2d'), t };
}

export class Cockpit {
  constructor(opts) {
    Object.assign(this, opts);     // ac, sound, onControl(id), camera, canvas
    this.controls = {}; this.guards = {}; this.faces = {}; this.gauges = {}; this.lamps = {};
    this.pickables = []; this.hover = null; this.highlightId = null; this.backlight = 0;
    this.guardOpen = {}; this.pressT = {};
    this.cwpPrev = {}; this.mcFlash = false; this.mwFlash = false; this.lampTestT = 0;
    this.ray = new THREE.Raycaster(); this.ray.near = 0.02; this.ray.far = 3;
    this.ready = false; this.visibleHands = true;
    this.tip = document.getElementById('ctltip');
  }

  load(model, nodes) {
    this.model = model; this.nodes = nodes;
    return new Promise((res, rej) => new GLTFLoader().load('model/controls.json', g => { this.setup(g.scene); res(); }, undefined, rej));
  }

  setup(root) {
    this.root = root;
    this.model.add(root);
    this.model.updateMatrixWorld(true);
    const list = [];
    root.traverse(o => list.push(o));
    for (const o of list) {
      const ud = o.userData || {};
      const n = o.name || '';
      if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; if (o.material) o.material = o.material.clone(); }
      if (ud.face === 'panel') this.makePanelFace(o, ud);
      else if (ud.face === 'gauge') this.makeGauge(o, ud.gauge);
      else if (ud.face === 'cwp') this.makeCwp(o);
      else if (ud.face === 'lamp') this.makeLamp(o, ud.ctl);
      if (/^Ctl_/.test(n) && ud.ctl) {
        const c = { id: ud.ctl, kind: ud.kind, obj: o, q0: o.quaternion.clone(), p0: o.position.clone(), a: 0, u: ud.u, v: ud.v, panel: ud.panel, label: ud.label };
        this.controls[ud.ctl] = c;
        this.addPick(o, ud.ctl, 'ctl');
      } else if (/^Guard_/.test(n) && ud.ctl) {
        this.guards[ud.ctl] = { obj: o, q0: o.quaternion.clone(), a: 0 };
        this.addPick(o, ud.ctl, 'guard');
      } else if (/^Pedal_/.test(n)) {
        (this.pedals ||= []).push({ obj: o, side: ud.side, q0: o.quaternion.clone() });
      }
    }
    // dimmable master lights
    for (const id of ['mwarn', 'mcaut']) { const c = this.controls[id]; if (c) c.obj.traverse(m => { if (m.isMesh) c.mat = m.material; }); }
    // the placeholder caution strips and standby dials of the airframe model are replaced by live ones
    for (const nm of ['ck_caution', 'StandbyFaces']) if (this.nodes[nm]) this.nodes[nm].visible = false;
    // the airframe cockpit's lit buttons (MFD bezels, consoles, UFCP keys) are dark without power
    this.litMats = new Set();
    this.model.traverse(o => { if (o.isMesh && o.material && /^CkButtonLit$/.test(o.material.name) && o.material.emissive) this.litMats.add(o.material); });
    for (const m of this.litMats) m.userData.e0 = m.emissiveIntensity;
    // pilot hands ride on the stick and throttle
    this.hands = [];
    for (const [nm, parent, elbow, shoulder] of [['Hand_R', 'Stick', V3(0.215, 0.70, st2z(4.16)), V3(0.20, 0.93, st2z(4.33))],
                                                  ['Hand_L', 'Throttle', V3(-0.25, 0.73, st2z(4.42)), V3(-0.20, 0.93, st2z(4.35))]]) {
      const h = root.getObjectByName(nm), p = this.nodes[parent];
      if (!h || !p) continue;
      const wrist = V3(...(h.userData.wrist || [0, 0, 0]));
      p.attach(h);
      const wl = h.worldToLocal(this.model.localToWorld(wrist.clone()));
      // flight-suit forearm: a short tapered sleeve from the glove cuff towards the elbow, leaving the view downwards
      const sleeve = new THREE.MeshStandardMaterial({ color: 0x323b27, roughness: 0.92 });
      const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.030, 1, 16, 1, true), sleeve);
      this.model.add(fore); fore.castShadow = false;
      this.hands.push({ h, wl, elbow, fore, side: nm === 'Hand_L' ? -1 : 1 });
    }
    this.ready = true;
    this.drawStaticFaces();
  }

  addPick(o, id, what) { o.traverse(m => { if (m.isMesh) { m.userData.pick = { id, what }; this.pickables.push(m); } }); }

  // ------------------------------------------------------------ faces
  makePanelFace(o, ud) {
    const ppm = 2000;                              // pixels per metre (0.5 mm per pixel)
    const W = Math.round(ud.w * ppm), H = Math.round(ud.h * ppm);
    const paint = canvasTex(W, H), glow = canvasTex(W, H);
    o.material = new THREE.MeshStandardMaterial({ map: paint.t, emissiveMap: glow.t, emissive: 0xffffff, emissiveIntensity: 1, roughness: 0.8, metalness: 0 });
    this.faces[ud.panel] = { o, paint, glow, W, H, w: ud.w, h: ud.h, ppm };
  }
  makeGauge(o, id) {
    const g = canvasTex(256, 256);
    o.material = new THREE.MeshStandardMaterial({ map: g.t, emissiveMap: g.t, emissive: 0xffffff, emissiveIntensity: 0.12, roughness: 0.25, metalness: 0 });
    g.mat = o.material; this.gauges[id] = g;
  }
  makeCwp(o) {
    this.cwp = canvasTex(512, 272);
    o.material = new THREE.MeshBasicMaterial({ map: this.cwp.t, toneMapped: false });
  }
  makeLamp(o, id) {
    const g = canvasTex(96, 72);
    o.material = new THREE.MeshBasicMaterial({ map: g.t, toneMapped: false });
    this.lamps[id] = g;
  }

  // legends: stencil-white paint on the dark panels, backlit at night
  drawStaticFaces() {
    for (const [pid, f] of Object.entries(this.faces)) {
      const g = f.paint.g, W = f.W, H = f.H, px = f.ppm / 1000;       // px per mm
      g.fillStyle = '#2b2f33'; g.fillRect(0, 0, W, H);
      // panel screws and fasteners
      g.fillStyle = '#4a4f54';
      for (const [x, y] of [[8, 8], [W - 8, 8], [8, H - 8], [W - 8, H - 8]]) { g.beginPath(); g.arc(x, y, 3.5 * px, 0, 7); g.fill(); }
      g.strokeStyle = '#1b1e21'; g.lineWidth = 1.5; g.strokeRect(1, 1, W - 2, H - 2);
      const title = { L: 'LANDING GEAR  ·  ENGINE', R: 'CAUTION  ·  CANOPY  ·  LIGHTS', S: 'ENGINE START' }[pid];
      g.fillStyle = PAINT_DIM; g.font = `600 ${4.2 * px}px "IBM Plex Sans", sans-serif`; g.textAlign = 'left';
      g.fillText(title, 5 * px, 7 * px);
      for (const c of Object.values(this.controls)) {
        if (c.panel !== pid) continue;
        const x = c.u * W, y = (1 - c.v) * H;
        g.fillStyle = PAINT; g.textAlign = 'center';
        g.font = `600 ${4.6 * px}px "IBM Plex Sans", sans-serif`;
        if (c.kind === 'toggle') {
          const guarded = !!this.guards[c.id];
          g.fillText(c.label, x, y - (guarded ? 24 : 13) * px);
          g.font = `500 ${3.4 * px}px "IBM Plex Sans", sans-serif`; g.fillStyle = PAINT_DIM;
          const on = { canopy: 'OPEN', fold: 'FOLD', flaps: 'DOWN', probe: 'OUT' }[c.id] || 'ON';
          const off = { canopy: 'CLOSE', fold: 'SPREAD', flaps: 'UP', probe: 'IN' }[c.id] || 'OFF';
          g.fillText(on, x + 9 * px, y - 5 * px); g.fillText(off, x + 9 * px, y + 8 * px);
          g.strokeStyle = PAINT_DIM; g.lineWidth = 0.4 * px; g.beginPath(); g.arc(x, y, 8 * px, 0, 7); g.stroke();
        } else if (c.kind === 'button') {
          g.fillText(c.label, x, y + 16 * px);
        } else if (c.kind === 'pull') {
          g.fillText(c.label, x, y + 14 * px);
          g.font = `500 ${3.2 * px}px "IBM Plex Sans", sans-serif`; g.fillStyle = PAINT_DIM;
          g.fillText(c.id === 'hook' ? 'PULL = DOWN' : 'PULL = SET', x, y + 19 * px);
        } else if (c.kind === 'lever') {
          g.fillText('GEAR', x, y - 58 * px);
          g.font = `600 ${4 * px}px "IBM Plex Sans", sans-serif`;
          g.fillText('UP', x - 13 * px, y - 40 * px); g.fillText('DN', x - 13 * px, y + 44 * px);
          // gear safe lamps: nose, left, right
          g.font = `500 ${3 * px}px "IBM Plex Sans", sans-serif`; g.fillStyle = PAINT_DIM;
          for (const [k, t] of [[0, 'N'], [1, 'L'], [2, 'R']]) g.fillText(t, x + 30 * px, y - 22 * px + k * 16 * px + 11 * px);
          // yellow/black striped surround for the wheel
          g.strokeStyle = '#c9a227'; g.lineWidth = 1.2 * px; g.strokeRect(x - 10 * px, y - 52 * px, 20 * px, 104 * px);
        }
      }
      // gauge captions on the left panel
      if (pid === 'L') { g.fillStyle = PAINT; g.font = `600 ${4 * px}px "IBM Plex Sans", sans-serif`; g.textAlign = 'center';
        g.fillText('T4 °C ×100', (0.5 + 0.020 / f.w) * W, (1 - (0.5 + 0.045 / f.h - 0.042 / f.h)) * H);
        g.fillText('RPM %', (0.5 + 0.095 / f.w) * W, (1 - (0.5 + 0.045 / f.h - 0.042 / f.h)) * H); }
      if (pid === 'S') { // start-sequence arrow
        g.strokeStyle = PAINT_DIM; g.lineWidth = 0.5 * px; g.setLineDash([2 * px, 2 * px]);
        g.beginPath(); g.moveTo(8 * px, H - 7 * px); g.lineTo(W - 12 * px, H - 7 * px); g.stroke(); g.setLineDash([]);
        g.fillStyle = PAINT_DIM; g.font = `500 ${3 * px}px "IBM Plex Sans", sans-serif`; g.textAlign = 'right';
        g.fillText('START SEQUENCE →', W - 12 * px, H - 9 * px);
      }
      f.paint.t.needsUpdate = true;
    }
  }

  // ------------------------------------------------------------ interaction
  pick(ndcX, ndcY) {
    if (!this.ready) return null;
    this.ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const hits = this.ray.intersectObjects(this.pickables, false);
    if (!hits.length) return null;
    const p = hits[0].object.userData.pick;
    return p ? { ...p } : null;
  }
  setHover(p, clientX, clientY) {
    const key = p ? p.what + ':' + p.id : null;
    if (key !== this.hoverKey) this.hoverKey = key;
    this.hover = p;
    if (!this.tip) return;
    if (!p) { this.tip.hidden = true; return; }
    const info = CONTROL_INFO[p.id] || { name: p.id };
    const st = this.stateText(p.id);
    this.tip.innerHTML = `<b>${p.what === 'guard' ? 'Guard: ' + info.name : info.name}</b>${st ? '<span>' + st + '</span>' : ''}`;
    this.tip.style.left = (clientX + 16) + 'px'; this.tip.style.top = (clientY + 14) + 'px'; this.tip.hidden = false;
  }
  stateText(id) {
    const ac = this.ac, onoff = v => v ? 'ON' : 'OFF';
    switch (id) {
      case 'bat': return onoff(ac.battery) + (this.guards.bat && !this.guardOpen.bat ? ' · guard closed' : '');
      case 'pump': return onoff(ac.sw.pump);
      case 'apu': return onoff(ac.sw.apu) + ' · ' + ac.apu.state.toUpperCase();
      case 'engL': return onoff(ac.sw.eng[0]); case 'engR': return onoff(ac.sw.eng[1]);
      case 'genL': return onoff(ac.sw.gen[0]) + (ac.genOnline(0) ? ' · ONLINE' : ''); case 'genR': return onoff(ac.sw.gen[1]) + (ac.genOnline(1) ? ' · ONLINE' : '');
      case 'startL': return ac.engines[0].state.toUpperCase(); case 'startR': return ac.engines[1].state.toUpperCase();
      case 'gear': return ac.gearCmd ? 'DOWN' : 'UP'; case 'flaps': return ac.flapCmd ? 'DOWN' : 'UP';
      case 'hook': return ac.hookCmd ? 'DOWN' : 'UP'; case 'park': return ac.parkBrake ? 'SET' : 'RELEASED';
      case 'canopy': return ac.canopyCmd ? 'OPEN' : 'CLOSED'; case 'fold': return ac.foldCmd ? 'FOLDED' : 'SPREAD';
      case 'navlt': return onoff(ac.sw.navlt); case 'beacon': return onoff(ac.sw.beacon); case 'ldglt': return onoff(ac.sw.ldglt);
      case 'probe': return ac.probeCmd ? 'OUT' : 'IN';
      case 'fcsrst': return ac.fail.fcs ? 'FAULT' : 'NO FAULT';
      default: return '';
    }
  }
  // click on a control or guard
  click(p) {
    if (!p) return;
    if (p.what === 'guard') { this.setGuard(p.id, !this.guardOpen[p.id]); return; }
    if (this.guards[p.id] && !this.guardOpen[p.id]) { this.setGuard(p.id, true); return; }   // first click lifts the guard
    this.activate(p.id);
  }
  setGuard(id, open) {
    if (!this.guards[id] || !!this.guardOpen[id] === open) return;
    this.guardOpen[id] = open;
    this.sound?.switchClick('guard');
    this.onGuard?.(id, open);
  }
  // any control, from a click, the keyboard or the instructor
  activate(id) {
    if (this.guards[id] && !this.guardOpen[id]) this.setGuard(id, true);
    const kind = this.controls[id]?.kind || 'button';
    if (kind === 'button') this.pressT[id] = 0.18;
    this.sound?.switchClick(kind);
    this.onControl?.(id);
  }

  // ------------------------------------------------------------ per frame
  update(dt, st) {
    if (!this.ready) return;
    const ac = this.ac;
    const inside = st.inside;
    this.root.visible = true;
    // the left hand leaves the throttle to work the switches while the pilot looks at the left wall panels
    const leftAway = inside && st.headYaw > 0.55 && st.headPitch < 0.1 && !st.throttleMoving;
    for (const h of this.hands) { const v = inside && !(h.side < 0 && leftAway); h.h.visible = v; h.fore.visible = v; }
    // keep the hover tooltip current as the switch states change
    if (this.hover && this.tip && !this.tip.hidden && (this.tipT = (this.tipT || 0) + dt) > 0.25) { this.tipT = 0; const x = parseFloat(this.tip.style.left) - 16, y = parseFloat(this.tip.style.top) - 14; this.setHover(this.hover, x, y); }
    // target positions from the aircraft state
    const T = {
      bat: ac.battery, pump: ac.sw.pump, apu: ac.sw.apu, engL: ac.sw.eng[0], engR: ac.sw.eng[1], genL: ac.sw.gen[0], genR: ac.sw.gen[1],
      gear: !!ac.gearCmd, flaps: !!ac.flapCmd, hook: !!ac.hookCmd, park: !!ac.parkBrake, canopy: !!ac.canopyCmd, fold: !!ac.foldCmd,
      navlt: ac.sw.navlt, beacon: ac.sw.beacon, ldglt: ac.sw.ldglt, probe: !!ac.probeCmd,
    };
    const tq = new THREE.Quaternion(), ax = V3(1, 0, 0);
    for (const c of Object.values(this.controls)) {
      const o = c.obj;
      if (c.kind === 'toggle') {
        c.a = approach(c.a, T[c.id] ? 1 : 0, dt / 0.07);
        o.quaternion.copy(c.q0).multiply(tq.setFromAxisAngle(ax, (25 - 50 * c.a) * D2R));
      } else if (c.kind === 'lever') {
        c.a = approach(c.a, T[c.id] ? 1 : 0, dt / 0.35);        // 1 = down
        o.quaternion.copy(c.q0).multiply(tq.setFromAxisAngle(ax, (-28 + 56 * c.a) * D2R));
      } else if (c.kind === 'pull') {
        c.a = approach(c.a, T[c.id] ? 1 : 0, dt / 0.15);
        o.position.copy(c.p0).addScaledVector(V3(0, 0, 1).applyQuaternion(c.q0), 0.028 * c.a);
      } else if (c.kind === 'button') {
        this.pressT[c.id] = Math.max(0, (this.pressT[c.id] || 0) - dt);
        c.a = approach(c.a, this.pressT[c.id] > 0 ? 1 : 0, dt / 0.04);
        o.position.copy(c.p0).addScaledVector(V3(0, 0, 1).applyQuaternion(c.q0), -0.0035 * c.a);
      }
    }
    for (const [id, g] of Object.entries(this.guards)) {
      g.a = approach(g.a, this.guardOpen[id] ? 1 : 0, dt / 0.22);
      g.obj.quaternion.copy(g.q0).multiply(tq.setFromAxisAngle(ax, -105 * D2R * g.a));
    }
    // rudder pedals follow the rudder input
    for (const p of this.pedals || []) p.obj.quaternion.copy(p.q0).multiply(tq.setFromAxisAngle(ax, -p.side * ac.inp.yaw * 0.22));
    // forearms from the (moving) wrists to fixed elbows, upper arms to the shoulders
    if (inside) for (const h of this.hands) {
      const w = this.model.worldToLocal(h.h.localToWorld(h.wl.clone()));
      const e = V3().subVectors(h.elbow, w); e.setLength(Math.min(e.length(), 0.19)).add(w);
      place(h.fore, w, e);
    }
    // highlight (instructor) and hover glow
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180);
    for (const [id, c] of Object.entries(this.controls)) this.glow(c.obj, id === this.highlightId ? 0.5 + 0.9 * pulse : (this.hover && this.hover.id === id && this.hover.what === 'ctl' ? 0.35 : 0));
    for (const [id, g] of Object.entries(this.guards)) this.glow(g.obj, id === this.highlightId && !this.guardOpen[id] ? 0.5 + 0.9 * pulse : (this.hover && this.hover.id === id && this.hover.what === 'guard' ? 0.35 : 0));
    // lamps, caution panel, gauges (about 30 Hz)
    this.acc = (this.acc || 0) + dt;
    this.lampTestT = Math.max(0, this.lampTestT - dt);
    if (this.acc > 1 / 30) { this.acc = 0; this.drawDynamic(st); }
    // master lights
    const pw = ac.power() !== 'none';
    const blink = (performance.now() % 600) < 380;
    const mw = this.controls.mwarn, mc = this.controls.mcaut;
    const test = this.lampTestT > 0;
    if (mw?.mat) mw.mat.emissiveIntensity = pw && (test || (this.mwFlash && blink)) ? 3.2 : 0;
    if (mc?.mat) mc.mat.emissiveIntensity = pw && (test || (this.mcFlash && blink)) ? 2.6 : 0;
    for (const g of Object.values(this.gauges)) g.mat.emissiveIntensity = 0.12 + (pw ? 0.55 * this.backlight : 0);
    const avionics = ac.power() === 'gen' || ac.power() === 'apu';
    for (const m of this.litMats) m.emissiveIntensity = avionics || test ? (m.userData.e0 ?? 0.3) * (1 + 1.5 * this.backlight) : 0;
  }
  glow(obj, k) {
    obj.traverse(m => { if (m.isMesh && m.material && m.material.emissive && m.material.name !== 'CtlMasterWarn' && m.material.name !== 'CtlMasterCaution') {
      m.material.emissive.setRGB(1.0 * k, 0.62 * k, 0.12 * k); m.material.emissiveIntensity = 1; } });
  }
  lampTest() { this.lampTestT = 2.2; }

  // caution / warning logic: returns tiles [label, level ('w' red, 'c' amber, 'a' green advisory), on]
  cwpTiles() {
    const ac = this.ac, air = !ac.onGround;
    const anyRun = ac.engines.some(e => e.running());
    const eng = i => ac.engines[i].state !== 'running' && (air || ac.engines[i].state === 'off');
    return [
      ['FIRE L', 'w', ac.fail.fire[0]], ['FIRE R', 'w', ac.fail.fire[1]], ['ENG L', air ? 'w' : 'c', eng(0)], ['ENG R', air ? 'w' : 'c', eng(1)],
      ['GEN L', 'c', !ac.genOnline(0)], ['GEN R', 'c', !ac.genOnline(1)], ['HYD 1', 'c', ac.hydSys(0) < 0.5], ['HYD 2', 'c', ac.hydSys(1) < 0.5],
      ['FUEL PRESS', 'c', !ac.sw.pump], ['LOW FUEL', 'c', ac.fuel < 800], ['BATT', 'c', !ac.battery || ac.batCharge < 0.3], ['APU ON', 'a', ac.apu.state === 'running'],
      ['FCS', ac.fail.fcs ? 'w' : 'c', !!ac.fail.fcs || (!ac.fbwReady && anyRun) || ac.fbwMode === 'direct'], ['CANOPY', 'c', ac.canopy > 0.02 || ac.canopyLost],
      ['PARK BRK', 'c', ac.parkBrake], ['WING FOLD', 'c', ac.fold > 0.02],
    ];
  }

  drawDynamic(st) {
    const ac = this.ac, pw = ac.power() !== 'none', test = this.lampTestT > 0;
    // ---- caution panel
    const sig = (k, v) => { if (this.sigs[k] === v) return false; this.sigs[k] = v; return true; };
    this.sigs ||= {};
    if (this.cwp) {
      const g = this.cwp.g, tiles = this.cwpTiles();
      const changed = sig('cwp', pw + '|' + test + '|' + tiles.map(t => t[1] + (t[2] ? 1 : 0)).join(''));
      if (changed) { g.fillStyle = '#07090a'; g.fillRect(0, 0, 512, 272); }
      let newC = false, newW = false;
      tiles.forEach(([label, lvl, on], i) => {
        const cx = i % 4, cy = Math.floor(i / 4), x = 6 + cx * 126, y = 6 + cy * 66;
        const lit = pw && (on || test);
        if (pw && on && !this.cwpPrev[label]) { if (lvl === 'w') newW = true; else if (lvl === 'c') newC = true; }
        this.cwpPrev[label] = pw && on;
        if (!changed) return;
        const col = lvl === 'w' ? ['#ff3b2e', '#3a0d0a'] : lvl === 'a' ? ['#5dff7a', '#0b2410'] : ['#ffb21e', '#33240a'];
        g.fillStyle = lit ? col[0] : col[1]; g.fillRect(x, y, 118, 58);
        g.fillStyle = lit ? '#120a02' : 'rgba(255,255,255,0.13)';
        g.font = '700 22px "IBM Plex Sans", sans-serif'; g.textAlign = 'center'; g.fillText(label, x + 59, y + 37);
      });
      if (newC && !test) { this.mcFlash = true; this.onCaution?.(); }
      if (newW && !test) { this.mwFlash = true; this.onWarning?.(tiles.filter(t => t[1] === 'w' && t[2]).map(t => t[0])); }
      if (!pw) { this.mcFlash = this.mwFlash = false; }
      if (changed) this.cwp.t.needsUpdate = true;
    }
    // ---- panel lamps (gear safe lights, APU, start) on the glow layer; legends backlit at night
    const apuBlink = ac.apu.state === 'starting' && (performance.now() % 500) < 260;
    const gearSig = ac.gear >= 0.98 ? 'd' + ac.damage.gear : ac.gear > 0.02 ? 't' : 'u';
    for (const [pid, f] of Object.entries(this.faces)) {
      if (!sig('face' + pid, [pw, test, this.backlight.toFixed(2), pid === 'L' ? gearSig : pid === 'S' ? ac.apu.state + apuBlink : ''].join('|'))) continue;
      const g = f.glow.g, W = f.W, H = f.H, px = f.ppm / 1000;
      g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
      if (this.backlight > 0.02 && pw) { g.globalAlpha = this.backlight * 0.55; g.drawImage(f.paint.c, 0, 0); g.globalAlpha = 1;
        g.globalCompositeOperation = 'multiply'; g.fillStyle = '#ff9a70'; g.fillRect(0, 0, W, H); g.globalCompositeOperation = 'source-over'; }
      if (pid === 'L') {
        const c = this.controls.gear; if (c) {
          const x = c.u * W, y = (1 - c.v) * H;
          const inTransit = ac.gear > 0.02 && ac.gear < 0.98, down = ac.gear >= 0.98;
          for (let k = 0; k < 3; k++) {
            const lit = pw && (test || down || inTransit);
            g.fillStyle = !lit ? '#000' : test ? '#5dff7a' : down && !ac.damage.gear ? '#3dff66' : '#ff3322';
            g.fillRect(x + 22 * px, y - 26 * px + k * 16 * px, 7 * px, 7 * px);
          }
        }
      }
      if (pid === 'S') {
        const c = this.controls.apu; if (c) {
          const x = c.u * W, y = (1 - c.v) * H;
          const s = ac.apu.state, blink = (performance.now() % 500) < 260;
          const lit = pw && (test || s === 'running' || (s === 'starting' && blink));
          g.fillStyle = lit ? (s === 'running' || test ? '#3dff66' : '#ffb21e') : '#000';
          g.beginPath(); g.arc(x, y + 17 * px, 3 * px, 0, 7); g.fill();
        }
      }
      f.glow.t.needsUpdate = true;
    }
    // lamp legends on the push buttons
    for (const [id, l] of Object.entries(this.lamps)) {
      const g = l.g; let on = false, col = '#ffb21e', txt = '';
      if (id === 'startL' || id === 'startR') { const e = ac.engines[id === 'startL' ? 0 : 1]; on = e.state === 'starting'; col = '#5dff7a'; txt = 'START'; }
      if (id === 'fcsrst') { on = !!ac.fail.fcs; txt = 'RESET'; }
      on = pw && (on || test);
      if (!sig('lamp' + id, String(on))) continue;
      g.fillStyle = on ? col : '#15181a'; g.fillRect(0, 0, 96, 72);
      g.fillStyle = on ? '#101010' : '#8a9096'; g.font = '700 22px "IBM Plex Sans", sans-serif'; g.textAlign = 'center'; g.fillText(txt, 48, 44);
      l.t.needsUpdate = true;
    }
    // ---- gauges
    const gz = this.gauges, e = ac.engines, R = (v, q) => Math.round(v / q);
    const gs = { rpm: [pw, R(e[0].N, 0.004), R(e[1].N, 0.004)], egt: [pw, R(e[0].egt, 4), R(e[1].egt, 4)], asi: [pw, R(ac.t.ias * 3.6, 1.5)],
      adi: [pw, R(ac.t.theta || 0, 0.004), R(ac.t.phi || 0, 0.004)], alt: [pw, R(ac.pos.y, 2)] };
    const dirty = {}; for (const k in gs) dirty[k] = sig('g' + k, gs[k].join('|'));
    if (gz.rpm && dirty.rpm) dial(gz.rpm, pw, { min: 0, max: 110, a0: -135, a1: 135, major: 10, labelEvery: 20, arcs: [[70, 100, '#3ec86a'], [100, 110, '#ffb21e']], needles: ac.engines.map((e, i) => [e.N * 100, i ? '#ffd36b' : '#ffffff', i ? '2' : '1']), title: 'ОБ %' });
    if (gz.egt && dirty.egt) dial(gz.egt, pw, { min: 0, max: 10, a0: -135, a1: 135, major: 1, labelEvery: 2, arcs: [[3, 8.5, '#3ec86a'], [8.5, 8.7, '#ffb21e'], [8.7, 10, '#ff3b2e']], needles: ac.engines.map((e, i) => [e.egt / 100, i ? '#ffd36b' : '#ffffff', i ? '2' : '1']), title: 'T4 ×100' });
    if (gz.asi && dirty.asi) asi(gz.asi, pw, ac.t.ias * 3.6);
    if (gz.adi && dirty.adi) adi(gz.adi, pw, ac.t.theta || 0, ac.t.phi || 0);
    if (gz.alt && dirty.alt) alt(gz.alt, pw, ac.pos.y);
    for (const [k, g] of Object.entries(gz)) if (dirty[k]) g.t.needsUpdate = true;
  }

  worldPos(id) {
    const c = this.controls[id] || this.guards[id];
    if (!c) return null;
    const box = new THREE.Box3().setFromObject(c.obj);
    return box.getCenter(V3());
  }
}

function place(mesh, a, b) {
  const d = V3().subVectors(b, a), L = d.length();
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.scale.set(1, L, 1);
  mesh.quaternion.setFromUnitVectors(V3(0, 1, 0), d.normalize());
}

// ------------------------------------------------------------ instrument drawing
function face(G, pw) {
  const g = G.g; g.save(); g.clearRect(0, 0, 256, 256);
  g.fillStyle = '#0a0b0c'; g.fillRect(0, 0, 256, 256);
  g.beginPath(); g.arc(128, 128, 124, 0, 7); g.fillStyle = '#121416'; g.fill();
  return g;
}
function dial(G, pw, o) {
  const g = face(G, pw);
  const ang = v => (o.a0 + (o.a1 - o.a0) * (clamp(v, o.min, o.max) - o.min) / (o.max - o.min)) * D2R - Math.PI / 2;
  for (const [a, b, col] of o.arcs) { g.strokeStyle = col; g.lineWidth = 7; g.beginPath(); g.arc(128, 128, 108, ang(a), ang(b)); g.stroke(); }
  g.strokeStyle = '#e8ebe6'; g.fillStyle = '#e8ebe6'; g.textAlign = 'center'; g.font = '600 22px "IBM Plex Sans", sans-serif';
  for (let v = o.min; v <= o.max + 1e-6; v += o.major) {
    const a = ang(v), big = Math.abs((v / o.labelEvery) - Math.round(v / o.labelEvery)) < 1e-6;
    g.lineWidth = big ? 3.5 : 2; g.beginPath(); g.moveTo(128 + Math.cos(a) * 116, 128 + Math.sin(a) * 116); g.lineTo(128 + Math.cos(a) * (big ? 96 : 104), 128 + Math.sin(a) * (big ? 96 : 104)); g.stroke();
    if (big) g.fillText(String(Math.round(v)), 128 + Math.cos(a) * 76, 128 + Math.sin(a) * 76 + 8);
  }
  g.font = '600 18px "IBM Plex Sans", sans-serif'; g.fillStyle = '#9aa39c'; g.fillText(o.title, 128, 176);
  for (const [v, col, tag] of pw ? o.needles : o.needles.map(n => [o.min, n[1], n[2]])) {
    const a = ang(v);
    g.save(); g.translate(128, 128); g.rotate(a);
    g.fillStyle = col; g.beginPath(); g.moveTo(-14, -4); g.lineTo(100, -1.5); g.lineTo(100, 1.5); g.lineTo(-14, 4); g.closePath(); g.fill();
    g.fillStyle = '#101010'; g.font = '700 13px sans-serif'; g.fillText(tag, 60, 5);
    g.restore();
  }
  g.fillStyle = '#2a2d30'; g.beginPath(); g.arc(128, 128, 11, 0, 7); g.fill();
  g.restore();
}
function asi(G, pw, kmh) {
  // non-linear scale: 0-1600 km/h, expanded at low speed where carrier work happens
  const f = v => Math.sqrt(clamp(v, 0, 1600) / 1600);
  const g = face(G, pw);
  const ang = v => (-150 + 300 * f(v)) * D2R - Math.PI / 2;
  g.strokeStyle = '#e8ebe6'; g.fillStyle = '#e8ebe6'; g.textAlign = 'center';
  g.strokeStyle = '#ffb21e'; g.lineWidth = 7; g.beginPath(); g.arc(128, 128, 108, ang(220), ang(260)); g.stroke();
  g.strokeStyle = '#e8ebe6';
  for (const v of [0, 100, 200, 300, 400, 500, 600, 800, 1000, 1200, 1400, 1600]) {
    const a = ang(v); g.lineWidth = 3; g.beginPath(); g.moveTo(128 + Math.cos(a) * 116, 128 + Math.sin(a) * 116); g.lineTo(128 + Math.cos(a) * 98, 128 + Math.sin(a) * 98); g.stroke();
    if (v % 200 === 0 && v <= 600 || v % 400 === 0) { g.font = '600 19px "IBM Plex Sans", sans-serif'; g.fillText(String(v / 100), 128 + Math.cos(a) * 76, 128 + Math.sin(a) * 76 + 7); }
  }
  g.font = '600 16px "IBM Plex Sans", sans-serif'; g.fillStyle = '#9aa39c'; g.fillText('KM/H ×100', 128, 176);
  const a = ang(pw ? kmh : 0);
  g.save(); g.translate(128, 128); g.rotate(a); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(-14, -4); g.lineTo(104, -1.5); g.lineTo(104, 1.5); g.lineTo(-14, 4); g.fill(); g.restore();
  g.fillStyle = '#2a2d30'; g.beginPath(); g.arc(128, 128, 11, 0, 7); g.fill();
  g.restore();
}
function adi(G, pw, theta, phi) {
  const g = G.g; g.save(); g.fillStyle = '#0a0b0c'; g.fillRect(0, 0, 256, 256);
  g.beginPath(); g.arc(128, 128, 118, 0, 7); g.clip();
  g.translate(128, 128); g.rotate(pw ? -phi : 0.25);
  const p = (pw ? theta : -0.1) * R2D * 3.2;
  g.fillStyle = '#3d7fc0'; g.fillRect(-200, -400 + p, 400, 400);
  g.fillStyle = '#5a3d22'; g.fillRect(-200, p, 400, 400);
  g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.moveTo(-200, p); g.lineTo(200, p); g.stroke();
  g.lineWidth = 2; g.fillStyle = '#fff'; g.font = '600 14px sans-serif'; g.textAlign = 'center';
  for (let a = -30; a <= 30; a += 10) { if (!a) continue; const y = p - a * 3.2; g.beginPath(); g.moveTo(-22, y); g.lineTo(22, y); g.stroke(); g.fillText(String(Math.abs(a)), 38, y + 5); }
  g.restore();
  g.save();
  g.strokeStyle = '#ffb21e'; g.lineWidth = 5; g.beginPath(); g.moveTo(58, 128); g.lineTo(106, 128); g.lineTo(116, 140); g.moveTo(198, 128); g.lineTo(150, 128); g.lineTo(140, 140); g.stroke();
  g.fillStyle = '#ffb21e'; g.beginPath(); g.arc(128, 128, 5, 0, 7); g.fill();
  if (!pw) { g.fillStyle = '#d02a1c'; g.fillRect(150, 36, 46, 26); g.fillStyle = '#fff'; g.font = '700 16px sans-serif'; g.fillText('OFF', 173, 55); }
  g.restore();
}
function alt(G, pw, h) {
  const g = face(G, pw);
  g.strokeStyle = '#e8ebe6'; g.fillStyle = '#e8ebe6'; g.textAlign = 'center';
  for (let k = 0; k < 50; k++) {
    const a = k / 50 * 2 * Math.PI - Math.PI / 2, big = k % 5 === 0;
    g.lineWidth = big ? 3.5 : 1.6; g.beginPath(); g.moveTo(128 + Math.cos(a) * 116, 128 + Math.sin(a) * 116); g.lineTo(128 + Math.cos(a) * (big ? 98 : 106), 128 + Math.sin(a) * (big ? 98 : 106)); g.stroke();
    if (big) { g.font = '600 21px "IBM Plex Sans", sans-serif'; g.fillText(String(k / 5), 128 + Math.cos(a) * 78, 128 + Math.sin(a) * 78 + 8); }
  }
  // drum counter: altitude in metres
  const hh = pw ? Math.max(0, h) : 0;
  g.fillStyle = '#000'; g.fillRect(84, 150, 88, 30); g.strokeStyle = '#5a5f63'; g.lineWidth = 2; g.strokeRect(84, 150, 88, 30);
  g.fillStyle = '#fff'; g.font = '700 22px "JetBrains Mono", monospace'; g.fillText(String(Math.round(hh / 10) * 10).padStart(5, '0'), 128, 173);
  g.font = '600 13px sans-serif'; g.fillStyle = '#9aa39c'; g.fillText('M', 128, 104);
  const a = (hh % 1000) / 1000 * 2 * Math.PI - Math.PI / 2;
  g.save(); g.translate(128, 128); g.rotate(a); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(-14, -4); g.lineTo(104, -1.5); g.lineTo(104, 1.5); g.lineTo(-14, 4); g.fill(); g.restore();
  g.fillStyle = '#2a2d30'; g.beginPath(); g.arc(128, 128, 11, 0, 7); g.fill();
  g.restore();
}
