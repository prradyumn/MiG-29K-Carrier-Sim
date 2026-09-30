import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Aircraft, DATA } from './flight.js';
import { makeSky, makeWater, makeClouds, Carrier, SHIP } from './world.js';
import { HUD, Displays } from './hud.js';
import { Sound } from './audio.js';
import { Effects } from './effects.js';
import { CarrierOps } from './ops.js';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const $ = id => document.getElementById(id);
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const S0 = 9.25;                        // nose-tip station offset used by the Blender model
const st2z = s => -(S0 - s);            // model z for a fuselage station

// ------------------------------------------------------------------ renderer / scene
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.62;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xa3bbd0, 0.000032);
const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 120000);
const hud = new HUD($('hud'));
const displays = new Displays();
const sound = new Sound();

const SUN_EL = 30, SUN_AZ = 215;
const { sun } = makeSky(scene, renderer, SUN_EL, SUN_AZ);
const sunLight = new THREE.DirectionalLight(0xfff1dc, 3.4);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
Object.assign(sunLight.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 600 });
sunLight.shadow.bias = -0.0004; sunLight.shadow.normalBias = 0.03;
scene.add(sunLight, sunLight.target);
scene.add(new THREE.HemisphereLight(0xbcd3ea, 0x1d2c36, 0.55));

const texLoader = new THREE.TextureLoader();
const water = makeWater(scene, sun, texLoader.load('assets/waternormals.jpg'));
makeClouds(scene);
const ship = new Carrier({ speed: 12 });
scene.add(ship);
const fx = new Effects(scene);
const WIND = V3(0, 0, 7);               // natural wind from the north, 7 m/s

// ------------------------------------------------------------------ settings
const settings = { fbw: true, units: 'metric', sound: true, voice: true, quality: 'high', sea: 1, mouseStick: false };
try { Object.assign(settings, JSON.parse(localStorage.getItem('mig29k-settings') || '{}')); } catch (e) { }
function saveSettings() { try { localStorage.setItem('mig29k-settings', JSON.stringify(settings)); } catch (e) { } }

// ------------------------------------------------------------------ aircraft
const ac = new Aircraft();
let model = null, nodes = {}, rest = {}, flames = [], pilotNodes = [], lerxVapor = [], wheelPivots = [], nozzleGroups = [], aoaLight = null;
const parked = [];
const state = { paused: true, started: false, view: 'orbit', head: { yaw: 0, pitch: -13 * D2R }, fov: 64, orbit: { yaw: 2.3, pitch: 0.16, dist: 26 },
  msgT: 0, simTime: 0, shake: 0, gateAB: false, flyby: null };
const ops = new CarrierOps(ship, sound, flash);

function setupModel(gltf) {
  model = gltf.scene;
  model.traverse(o => {
    if (o.name) nodes[o.name] = o;
    rest[o.uuid] = o.quaternion.clone();
    if (!o.isMesh || !o.material) return;
    const m = o.material, n = m.name || '';
    if (n === 'CanopyGlass') {
      o.material = new THREE.MeshPhysicalMaterial({ color: 0xdfe6de, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.16,
        envMapIntensity: 1.4, clearcoat: 1, clearcoatRoughness: 0.03, side: THREE.DoubleSide, depthWrite: false });
      o.renderOrder = 10; o.castShadow = false;
    } else if (n === 'HUDGlass') {
      o.material = new THREE.MeshBasicMaterial({ color: 0x9fd8a8, transparent: true, opacity: 0.08, depthWrite: false });
    } else if (n === 'ABGlow') {
      o.material = new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false });
      o.userData.ab = true;
    } else if (/^Screen_/.test(n)) {
      const map = { MFD_L: displays.L, MFD_C: displays.C, MFD_R: displays.R, UFCP_Screen: displays.U }[o.name];
      if (map) { map.t.flipY = false; o.material = new THREE.MeshBasicMaterial({ map: map.t, toneMapped: false }); }
    }
    if (o.material.map) o.material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
    if (/^(Ck|Seat|Strap|Gauge|Flight|Helmet|OxyMask)/.test(n) && o.material.envMapIntensity !== undefined) o.material.envMapIntensity = 0.3;
    if (n === 'CkButtonLit' || n === 'CkCaution') o.userData.lit = true;
    o.castShadow = !o.material.transparent; o.receiveShadow = true;
  });
  // MiG-29K cockpit: the glareshield sits low enough for about 13.5 deg of over-nose view (the deck must stay visible in the groove)
  if (nodes.ck_coaming) { nodes.ck_coaming.position.y -= 0.05; nodes.ck_coaming.updateMatrix(); }
  if (nodes.HUD_Base) { nodes.HUD_Base.position.y -= 0.03; nodes.HUD_Base.updateMatrix(); }
  // canopy hinged at its rear frame
  const hinge = new THREE.Group(); hinge.position.set(0, 1.0, st2z(6.36));
  model.add(hinge); nodes.CanopyHinge = hinge;
  for (const n of ['Canopy', 'CanopyFrame', 'Mirrors']) if (nodes[n]) hinge.attach(nodes[n]);
  model.traverse(o => { if (/^Pilot/.test(o.name)) pilotNodes.push(o); });
  // wheel pivots (tyres and hubs spin about their axles)
  const pivotize = (names, parent, axle) => {
    const objs = names.map(n => nodes[n]).filter(Boolean);
    if (!objs.length) return;
    const g = new THREE.Group(); g.position.copy(axle); parent.add(g);
    for (const o of objs) g.attach(o);
    wheelPivots.push(g);
  };
  model.updateMatrixWorld(true);
  if (nodes.Gear_Nose) pivotize(['NoseTires', 'NoseHubs'], nodes.Gear_Nose, nodes.Gear_Nose.worldToLocal(V3(0, -1.455, st2z(6.22))));
  for (const [sd, nm] of [[-1, 'L'], [1, 'R']]) {
    const g = nodes['Gear_Main_' + nm];
    if (g) pivotize(['MainWheel_' + nm + '_Tire', 'MainWheel_' + nm + '_Hub'], g, g.worldToLocal(V3(sd * 1.56, -1.32, st2z(10.17))));
  }
  // nozzle groups (petals open at idle and in afterburner, close at MIL)
  for (const [sd, nm] of [[-1, 'L'], [1, 'R']]) {
    const g = new THREE.Group(); g.position.set(sd * 0.87, -0.45, st2z(14.1)); model.add(g);
    for (const n of ['NozzleOuter_' + nm, 'NozzleInner_' + nm, 'ABGlow_' + nm]) if (nodes[n]) g.attach(nodes[n]);
    nozzleGroups.push(g);
    const f = makeFlame(); f.position.set(sd * 0.87, -0.45, st2z(15.33)); model.add(f); flames.push(f);
  }
  // LERX vortex vapour
  const vt = softTex();
  for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: vt, transparent: true, opacity: 0, depthWrite: false }));
    s.position.set(sx * (0.75 + i * 0.28), 0.42, st2z(5.4 + i * 0.9)); s.scale.set(1.4 + i * 0.4, 0.9, 1);
    model.add(s); lerxVapor.push(s);
  }
  // three-colour approach indexer light on the nose-gear strut (for the LSO)
  aoaLight = new THREE.Sprite(new THREE.SpriteMaterial({ map: vt, color: 0xffb020, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  aoaLight.scale.setScalar(0.35);
  if (nodes.Gear_Nose) { nodes.Gear_Nose.add(aoaLight); aoaLight.position.copy(nodes.Gear_Nose.worldToLocal(V3(0, -0.95, st2z(5.93)))); }
  fx.attach(model);
  scene.add(model);
  // parked aircraft (wings folded)
  for (const [x, z, yaw] of [[16.5, 72, 0.55], [16.5, 92, 0.55], [16.0, 112, 0.55]]) {
    const c = model.clone(true);
    c.traverse(o => { if (o.isSprite || o.userData.flame || o.userData.ab || /^Pilot/.test(o.name)) o.visible = false; if (o.isMesh && o.geometry.type === 'CylinderGeometry' && o.material.type === 'ShaderMaterial') o.visible = false; });
    c.position.set(x, SHIP.deckY + 1.74, z); c.rotation.y = yaw;
    ship.add(c);
    const on = {}; c.traverse(o => on[o.name] = o);
    foldWings(on, 1);
    if (on.CanopyHinge) on.CanopyHinge.rotation.x = 0;
    parked.push(c);
  }
  startScenario('deck', false);
  state.view = 'orbit'; state.orbit = { yaw: 2.3, pitch: 0.16, dist: 26 };
  $('loading').hidden = true; $('startbox').hidden = false;
}

function foldWings(nd, f) {
  const a = f * 92 * D2R;
  const L = nd.WingOuter_L, R = nd.WingOuter_R;
  if (L) { L.quaternion.copy(rest[L.uuid] || L.userData.q0 || (L.userData.q0 = L.quaternion.clone())); L.rotateX(-a); }
  if (R) { R.quaternion.copy(rest[R.uuid] || R.userData.q0 || (R.userData.q0 = R.quaternion.clone())); R.rotateX(a); }
}

let _soft = null;
function softTex() {
  if (_soft) return _soft;
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62); grd.addColorStop(0, 'rgba(255,255,255,0.85)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return (_soft = new THREE.CanvasTexture(c));
}
let _dtex = null;
function diamondTex() {
  if (_dtex) return _dtex;
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32); grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.35, 'rgba(255,200,150,0.55)'); grd.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return (_dtex = new THREE.CanvasTexture(c));
}
function makeFlame() {
  const grp = new THREE.Group(); grp.userData.flame = true;
  const mk = (r0, r1, colA, colB, opa) => {
    const geo = new THREE.CylinderGeometry(r1, r0, 1, 32, 24, true);
    geo.translate(0, -0.5, 0); geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: { t: { value: 0 }, ab: { value: 0 }, colA: { value: new THREE.Color(colA) }, colB: { value: new THREE.Color(colB) }, opa: { value: opa } },
      vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv=uv; vec4 mv=modelViewMatrix*vec4(position,1.); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `uniform float t, ab, opa; uniform vec3 colA, colB; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main(){ float y = 1.0 - vUv.y; float rim = 0.35 + 0.65 * pow(abs(dot(vN, vV)), 1.2);
          float diamonds = 0.55 + 0.45 * pow(abs(sin(y * 17.0 - t * 3.0)), 3.0) * (1.0 - y);
          float fade = smoothstep(1.0, 0.15, y) * smoothstep(0.0, 0.04, y);
          float flick = 0.85 + 0.15 * sin(t * 57.0 + y * 20.0);
          vec3 col = mix(colA, colB, smoothstep(0.1, 0.8, y));
          gl_FragColor = vec4(col * diamonds * flick * 1.6, fade * rim * opa * ab); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(geo, mat); m.userData.flame = true; m.castShadow = false; m.frustumCulled = false;
    return m;
  };
  const outer = mk(0.40, 0.10, 0xffb070, 0xff5a18, 0.75), core = mk(0.30, 0.02, 0xbfd8ff, 0xffc890, 0.9);
  grp.add(outer, core); grp.userData.parts = [outer, core];
  const dm = new THREE.SpriteMaterial({ map: diamondTex(), color: 0xffe2c0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
  grp.userData.diamonds = [];
  for (let i = 0; i < 5; i++) { const s = new THREE.Sprite(dm.clone()); s.userData.flame = true; grp.add(s); grp.userData.diamonds.push(s); }
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: diamondTex(), color: 0xffb070, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }));
  glow.userData.flame = true; grp.add(glow); grp.userData.glow = glow;
  return grp;
}

const manager = new THREE.LoadingManager();
manager.onProgress = (url, a, b) => { $('loadbar').style.width = Math.round(a / b * 100) + '%'; };
new GLTFLoader(manager).load('model/mig29k.json', setupModel, undefined, e => { $('loadtext').textContent = 'Could not load the aircraft model: ' + e.message; });

// ------------------------------------------------------------------ scenarios
let scenario = 'deck';
const yawPitchQuat = (yaw, pitch, roll = 0) => new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));

function resetShip() {
  ship.base = V3(0, 0, 0); ship.time = 0; ship.setSea(settings.sea); ship.update(0);
}

function placeOnDeck(sp) {
  const local = V3(sp.x, SHIP.deckY + 1.84, sp.z);
  ac.pos.copy(ship.localToWorld(local.clone()));
  ac.vel.copy(ship.velocity);
  ac.quat.copy(ship.quaternion);
  return local;
}

function startScenario(kind, run = true) {
  scenario = kind;
  resetShip();
  Object.assign(ac, new Aircraft());
  ac.fbw = settings.fbw;
  ops.reset();
  state.simTime = 0; state.fold = false; state.gateAB = false; state.flyby = null; chaseSmooth = null;
  state.orbit = { yaw: Math.PI, pitch: 0.26, dist: 24 };
  state.checklist = null;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  if (kind === 'deck' || kind === 'short' || kind === 'cold') {
    const sp = kind === 'short' ? SHIP.start[1] : SHIP.start[0];
    const local = placeOnDeck(sp);
    ac.gearCmd = ac.gear = 1; ac.flapCmd = ac.flap = 1;
    ac.fuel = kind === 'short' ? 2600 : DATA.fuelMax * 0.95;
    ac.stores = kind !== 'short';
    if (kind === 'cold') {
      ac.coldAndDark(); ac.flapCmd = ac.flap = 0; ac.foldCmd = ac.fold = 1; ac.parkBrake = true;
      ac.pendingHoldback = { ship, local: local.clone() };
      state.checklist = coldChecklist();
      flash('Cold and dark on position 2. Work through the start checklist (top right).', 7);
      state.view = 'cockpit'; state.head = { yaw: -0.35, pitch: -22 * D2R };
    } else {
      ac.setEnginesRunning();
      ac.holdback = { ship, local: local.clone() };
      flash((kind === 'short' ? 'Short position 1 (105 m run, 16.4 t). ' : 'Long position 2 (195 m run, 18.8 t). ') + 'On the restraining stops: throttle to full afterburner (Tab), check the ЧР take-off rating, then Space to launch.', 9);
      state.view = 'cockpit'; state.head = { yaw: 0, pitch: -9 * D2R };
    }
  } else if (kind === 'approach') {
    const dir = ship.landDir.clone().applyQuaternion(ship.quaternion); dir.y = 0; dir.normalize();
    const td = ship.localToWorld(ship.lensAim.clone());
    const dist = 5200, gs = 4.0 * D2R, vGround = 57;
    ac.pos.copy(td).addScaledVector(dir, -dist); ac.pos.y = td.y + dist * Math.tan(gs) - 0.9;
    ac.vel.copy(dir).multiplyScalar(vGround); ac.vel.y = -(vGround - ship.velocity.dot(dir)) * Math.tan(gs);
    ac.quat.copy(yawPitchQuat(Math.atan2(-dir.x, -dir.z), 7.5 * D2R));
    ac.setEnginesRunning();
    ac.gearCmd = ac.gear = 1; ac.flapCmd = ac.flap = 1; ac.hookCmd = 1; ac.hookAng = 38 * D2R; ac.hook = 1;
    ac.fuel = 1600; ac.stores = false;
    ac.inp.throttle = 0.30; for (const e of ac.engines) e.N = 0.83;
    flash('On final, 5 km, 4° glide slope. Fly the ball (amber light, left of the landing area) at 10.5° AoA. Full MIL power at touchdown; catch wire 2 or 3.', 10);
    state.view = 'cockpit'; state.head = { yaw: 0, pitch: -6 * D2R };
  } else {
    ac.pos.set(-3000, 3000, 4000); ac.vel.set(0, 0, -230);
    ac.quat.copy(yawPitchQuat(0, 2.2 * D2R));
    ac.setEnginesRunning();
    ac.gearCmd = ac.gear = 0; ac.flapCmd = ac.flap = 0;
    ac.inp.throttle = 0.72; for (const e of ac.engines) e.N = 0.95;
    ac.fuel = DATA.fuelMax * 0.8;
    flash('Free flight at 3,000 m. The carrier is north-east: the centre display shows range and bearing.', 8);
    state.view = 'chase';
  }
  if (!run) { $('msg').hidden = true; return; }
  state.started = true; state.paused = false; $('menu').hidden = true; $('resume').hidden = false;
  if (settings.sound) { sound.start(); sound.suspend(false); if (sound.master) sound.master.gain.value = 0.7; }
  sound.voiceOn = settings.voice;
}

// ------------------------------------------------------------------ cold-start checklist
function coldChecklist() {
  return [
    { k: '1', t: 'Battery ON', done: () => ac.battery },
    { k: '2', t: 'APU start, wait for on-speed', done: () => ac.apu.state === 'running' || ac.engines.every(e => e.running()) },
    { k: '3', t: 'Left engine start (throttle IDLE)', done: () => ac.engines[0].running() },
    { k: '4', t: 'Right engine start', done: () => ac.engines[1].running() },
    { k: '', t: 'FBW self-test (automatic)', done: () => ac.fbwReady },
    { k: 'O', t: 'Spread wings', done: () => ac.fold < 0.02 && !ac.foldCmd },
    { k: 'K', t: 'Close canopy', done: () => ac.canopy < 0.02 && !ac.canopyCmd },
    { k: 'L', t: 'Take-off flaps', done: () => ac.flap > 0.95 },
    { k: '', t: 'Restraining stops raised (automatic)', done: () => !!ac.holdback || (!ac.pendingHoldback && ac.launchT > 0.5 && ac.launchT < 99) },
    { k: 'N', t: 'Release parking brake', done: () => !ac.parkBrake },
    { k: 'Tab', t: 'Full afterburner, then Space', done: () => !ac.holdback && ac.launchT > 0.5 && ac.launchT < 99 },
  ];
}
function updateChecklist() {
  const el = $('checklist');
  if (!state.checklist || !state.started) { el.hidden = true; return; }
  el.hidden = false;
  // raise the stops once the jet is configured for launch
  if (ac.pendingHoldback && ac.fbwReady && ac.fold < 0.02 && ac.canopy < 0.02) {
    const off = ac.pendingHoldback.ship.localToWorld(ac.pendingHoldback.local.clone()).sub(ac.pos); off.y = 0;
    if (off.length() < 1.0 && ac.vDeckRel < 0.5) { ac.holdback = ac.pendingHoldback; ac.pendingHoldback = null; flash('Restraining stops raised, blast deflector up. Release the parking brake, full afterburner, then Space.', 6); }
    else if (off.length() > 3 && !ac.parkBrake) { ac.pendingHoldback = null; flash('Rolled off the launch position: the stops cannot be raised. Restart (Backspace).', 6); }
  }
  let firstOpen = true;
  const rows = state.checklist.map(c => {
    const d = c.done();
    const cls = d ? 'done' : firstOpen ? 'next' : '';
    if (!d) firstOpen = false;
    return `<li class="${cls}"><kbd>${c.k || '·'}</kbd><span>${c.t}</span></li>`;
  }).join('');
  if (el.dataset.html !== rows) { el.querySelector('ol').innerHTML = rows; el.dataset.html = rows; }
  if (state.checklist.every(c => c.done())) setTimeout(() => { state.checklist = null; }, 4000);
}

// ------------------------------------------------------------------ settings UI
function syncSettingsUI() {
  $('opt-fbw').checked = settings.fbw; $('opt-units').value = settings.units; $('opt-sound').checked = settings.sound; $('opt-voice').checked = settings.voice;
  $('opt-quality').value = settings.quality; $('opt-sea').value = String(settings.sea); $('opt-mouse').checked = settings.mouseStick;
  hud.units = settings.units; ac.fbw = settings.fbw; sound.voiceOn = settings.voice; ship.setSea(settings.sea);
  renderer.setPixelRatio(settings.quality === 'high' ? Math.min(devicePixelRatio, 2) : 1);
  sunLight.shadow.mapSize.set(settings.quality === 'high' ? 2048 : 1024, settings.quality === 'high' ? 2048 : 1024);
  resize();
}
$('opt-fbw').onchange = e => { settings.fbw = e.target.checked; ac.fbw = settings.fbw; saveSettings(); };
$('opt-units').onchange = e => { settings.units = e.target.value; hud.units = settings.units; saveSettings(); };
$('opt-sound').onchange = e => { settings.sound = e.target.checked; saveSettings(); if (sound.master) sound.master.gain.value = settings.sound ? 0.7 : 0; };
$('opt-voice').onchange = e => { settings.voice = e.target.checked; sound.voiceOn = settings.voice; saveSettings(); };
$('opt-quality').onchange = e => { settings.quality = e.target.value; saveSettings(); syncSettingsUI(); };
$('opt-sea').onchange = e => { settings.sea = parseFloat(e.target.value); ship.setSea(settings.sea); saveSettings(); };
$('opt-mouse').onchange = e => { settings.mouseStick = e.target.checked; saveSettings(); };
for (const b of document.querySelectorAll('[data-scn]')) b.onclick = () => startScenario(b.dataset.scn);
$('resume').onclick = () => { if (model && state.started) pause(false); };
$('report-close').onclick = () => { $('report').hidden = true; };

function flash(text, secs = 4) { state.msgT = secs; const el = $('msg'); el.textContent = text; el.hidden = false; }
function pause(on) { state.paused = on; $('menu').hidden = !on; sound.suspend(on); $('resume').hidden = !state.started; }

// ------------------------------------------------------------------ input
const keys = {};
const axes = { pitch: 0, roll: 0, yaw: 0 };
const mouse = { x: 0.5, y: 0.5 };
window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'tab'].includes(k) || e.code === 'Space' || e.code === 'Tab') e.preventDefault();
  if (keys[e.code]) return;
  keys[e.code] = true;
  if (state.paused && e.code !== 'Escape' && e.code !== 'KeyP') return;
  const flying = !ac.onGround;
  switch (e.code) {
    case 'KeyG':
      if (ac.onGround && ac.gearCmd) { flash('Gear handle locked: weight on wheels'); break; }
      if (!ac.gearCmd && ac.t.ias > DATA.vGear) { flash('Gear extension limit is 500 km/h'); break; }
      ac.gearCmd = ac.gearCmd ? 0 : 1; sound.clunk(); flash(ac.gearCmd ? 'Gear down' : 'Gear up', 2); break;
    case 'KeyL':
      if (!ac.flapCmd && ac.t.ias > DATA.vFlaps) { flash('Flap limit is 400 km/h'); break; }
      ac.flapCmd = ac.flapCmd ? 0 : 1; flash(ac.flapCmd ? 'Flaps down (take-off / landing), ailerons drooped' : 'Flaps up', 2); break;
    case 'KeyH': ac.hookCmd = ac.hookCmd ? 0 : 1; if (!ac.hookCmd && ac.arrest && ac.arrest.stopped) { ac.arrest = null; flash('Hook up: wire released', 2); } else flash(ac.hookCmd ? 'Hook down' : 'Hook up', 2); break;
    case 'KeyB': ac.brakeCmd = ac.brakeCmd ? 0 : 1; if (ac.brakeCmd && ac.gear > 0.5) flash('Speed brake inhibited with the gear down', 2.5); break;
    case 'Space': if (ac.holdback) { if (ac.engines.some(en => en.N < 0.97)) flash('Check both engines at full power before release', 2.5); ac.holdback = null; state.shake = 0.6; flash('Launch!', 2); } break;
    case 'Tab': ac.inp.throttle = ac.inp.throttle < 0.95 ? 1.0 : 0.85; state.gateAB = ac.inp.throttle > 0.9; break;
    case 'Digit0': ac.inp.throttle = 0; break;
    case 'Digit1': ac.battery = !ac.battery; flash('Battery ' + (ac.battery ? 'ON' : 'OFF'), 2); break;
    case 'Digit2': ac.startApu(); break;
    case 'Digit3': ac.startEngine(0); break;
    case 'Digit4': ac.startEngine(1); break;
    case 'End': if (ac.onGround) ac.shutdown(); else flash('Engine shutdown is inhibited in flight in this sim'); break;
    case 'KeyN': ac.parkBrake = !ac.parkBrake; flash('Parking brake ' + (ac.parkBrake ? 'set' : 'released'), 2); break;
    case 'KeyC': state.view = state.view === 'cockpit' ? 'chase' : 'cockpit'; break;
    case 'KeyV': { const order = ['cockpit', 'chase', 'orbit', 'flyby', 'deck']; state.view = order[(order.indexOf(state.view) + 1) % order.length]; state.flyby = null; flash('View: ' + state.view, 1.5); break; }
    case 'KeyM': settings.fbw = !settings.fbw; ac.fbw = settings.fbw; saveSettings(); flash(ac.fbw ? 'FBW normal law' : 'FBW direct law: no AoA or g protection', 3); break;
    case 'KeyU': settings.units = settings.units === 'metric' ? 'imperial' : 'metric'; hud.units = settings.units; saveSettings(); break;
    case 'KeyY': settings.mouseStick = !settings.mouseStick; saveSettings(); flash(settings.mouseStick ? 'Mouse stick ON: the mouse position is the stick (centre = neutral)' : 'Mouse stick OFF', 3); break;
    case 'KeyO':
      if (!ac.onGround || ac.vDeckRel > 6) { flash('Wing fold only when stopped on deck'); break; }
      if (ac.hydraulics() < 0.9) { flash('Wing fold needs hydraulic pressure (an engine running)'); break; }
      ac.foldCmd = ac.foldCmd ? 0 : 1; flash(ac.foldCmd ? 'Folding wings' : 'Spreading wings', 2); break;
    case 'KeyK':
      if (ac.canopyLost) break;
      if (!ac.canopyCmd && ac.t.ias > DATA.vCanopy) { flash('Canopy opens only below 60 km/h'); break; }
      ac.canopyCmd = ac.canopyCmd ? 0 : 1; flash(ac.canopyCmd ? 'Canopy opening' : 'Canopy closing', 2); break;
    case 'KeyI': state.probe = !state.probe; flash(state.probe ? 'Refuelling probe out' : 'Refuelling probe in', 2); break;
    case 'Backspace': startScenario(scenario); break;
    case 'KeyP': case 'Escape': if (state.started) pause(!state.paused); break;
  }
});
window.addEventListener('keyup', e => {
  keys[e.code] = false;
  if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyR') && ac.inp.throttle >= 0.849) state.gateAB = true;
});
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
window.addEventListener('mousemove', e => { mouse.x = e.clientX / innerWidth; mouse.y = e.clientY / innerHeight; });

let drag = null;
canvas.addEventListener('pointerdown', e => { if (settings.mouseStick && e.button === 0) return; drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY };
  if (state.view === 'cockpit') { state.head.yaw = clamp(state.head.yaw - dx * 0.004, -2.6, 2.6); state.head.pitch = clamp(state.head.pitch - dy * 0.004, -1.2, 1.3); }
  else { state.orbit.yaw -= dx * 0.005; state.orbit.pitch = clamp(state.orbit.pitch + dy * 0.004, -1.2, 1.4); }
});
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('dblclick', () => { state.head.yaw = 0; state.head.pitch = -13 * D2R; state.fov = 64; });
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  if (state.view === 'cockpit') state.fov = clamp(state.fov + e.deltaY * 0.03, 22, 80);
  else state.orbit.dist = clamp(state.orbit.dist * (1 + e.deltaY * 0.001), 8, 400);
}, { passive: false });

function readInputs(dt) {
  const k = code => !!keys[code];
  const tgt = {
    pitch: (k('ArrowDown') || k('KeyS') ? 1 : 0) - (k('ArrowUp') || k('KeyW') ? 1 : 0),
    roll: (k('ArrowRight') || k('KeyD') ? 1 : 0) - (k('ArrowLeft') || k('KeyA') ? 1 : 0),
    yaw: (k('KeyE') ? 1 : 0) - (k('KeyQ') ? 1 : 0),
  };
  let thrRate = (k('ShiftLeft') || k('ShiftRight') || k('KeyR') || k('Equal') ? 0.4 : 0) - (k('KeyF') || k('Minus') ? 0.4 : 0);
  ac.inp.brake = k('KeyX') ? 1 : 0;
  let analog = false;
  if (settings.mouseStick && !state.paused) {
    const sx = (mouse.x - 0.5) / 0.32, sy = (mouse.y - 0.5) / 0.32;
    const shape = v => Math.sign(v) * Math.min(1, Math.abs(v)) ** 1.6;
    tgt.roll = shape(sx); tgt.pitch = shape(sy); analog = true;
  }
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of pads) {
    if (!gp) continue;
    const dz = v => Math.abs(v) < 0.08 ? 0 : (v - Math.sign(v) * 0.08) / 0.92;
    const lx = dz(gp.axes[0] || 0), ly = dz(gp.axes[1] || 0), rx = dz(gp.axes[2] || 0), ry = dz(gp.axes[3] || 0);
    if (lx || ly) { tgt.roll = Math.sign(lx) * lx * lx; tgt.pitch = Math.sign(ly) * ly * ly; analog = true; }
    const lb = gp.buttons[4]?.pressed, rb = gp.buttons[5]?.pressed;
    if (lb || rb) tgt.yaw = (rb ? 1 : 0) - (lb ? 1 : 0);
    const lt = gp.buttons[6]?.value || 0, rt = gp.buttons[7]?.value || 0;
    if (lt > 0.05 || rt > 0.05) thrRate = (rt - lt) * 0.5;
    if (rx || ry) { if (state.view === 'cockpit') { state.head.yaw = clamp(state.head.yaw - rx * dt * 2.2, -2.6, 2.6); state.head.pitch = clamp(state.head.pitch - ry * dt * 1.6, -1.2, 1.3); }
      else { state.orbit.yaw -= rx * dt * 2; state.orbit.pitch = clamp(state.orbit.pitch + ry * dt * 1.5, -1.2, 1.4); } }
    const edge = (i, fn) => { const p = gp.buttons[i]?.pressed; const key = 'gp' + i; if (p && !state[key]) fn(); state[key] = p; };
    edge(0, () => { if (!ac.onGround) ac.gearCmd = ac.gearCmd ? 0 : 1; });
    edge(1, () => { ac.hookCmd = ac.hookCmd ? 0 : 1; });
    edge(2, () => { ac.flapCmd = ac.flapCmd ? 0 : 1; });
    edge(3, () => { state.view = state.view === 'cockpit' ? 'chase' : 'cockpit'; });
    edge(8, () => { if (ac.holdback) ac.holdback = null; });
    edge(9, () => { if (state.started) pause(!state.paused); });
    edge(10, () => { state.gateAB = true; ac.inp.throttle = 1; });
  }
  for (const a of ['pitch', 'roll', 'yaw']) {
    if (analog && a !== 'yaw') { axes[a] = tgt[a]; continue; }
    const rate = Math.abs(tgt[a]) > Math.abs(axes[a]) ? 2.6 : 4.5;
    axes[a] += clamp(tgt[a] - axes[a], -rate * dt, rate * dt);
  }
  ac.inp.pitch = axes.pitch; ac.inp.roll = axes.roll; ac.inp.yaw = axes.yaw;
  // throttle with MIL detent: pushing past 85 % needs a second push (afterburner gate)
  let thr = clamp(ac.inp.throttle + thrRate * dt, 0, 1);
  if (thrRate > 0 && ac.inp.throttle < 0.85 && thr > 0.85 && !state.gateAB) thr = 0.85;
  if (thr < 0.85) state.gateAB = false;
  ac.inp.throttle = thr;
}

// ------------------------------------------------------------------ environment for physics
const zero = V3();
const env = {
  wind: WIND, shipVelocity: ship.velocity,
  surface(x, z) {
    const d = ship.surfaceAt(x, z);
    if (d) return d;
    return { h: 0, n: V3(0, 1, 0), v: zero, water: true };
  },
  windAt(p) {
    const w = WIND.clone();
    // light boundary-layer turbulence + ship air wake
    const t = state.simTime;
    const tb = p.y < 1500 ? (0.25 + 0.35 * settings.sea) * (1 - p.y / 1500) : 0;
    w.x += tb * (Math.sin(t * 0.9 + p.z * 0.003) + 0.5 * Math.sin(t * 2.1 + p.x * 0.004));
    w.y += tb * 0.6 * Math.sin(t * 1.3 + p.x * 0.002 + p.z * 0.002);
    w.z += tb * 0.6 * Math.sin(t * 0.7 + 2);
    return w.add(ship.wakeAt(p, t));
  },
  obstacle(p) {
    const l = ship.worldToLocal(p.clone());
    const I = SHIP.island;
    if (l.x > I.x0 - 3 && l.x < I.x1 + 2 && l.z > I.z0 - 5 && l.z < I.z1 + 5 && l.y < SHIP.deckY + I.top) return true;
    if (l.z > SHIP.bowZ - 2 && l.z < SHIP.sternZ + 1) {
      const [a, b] = ship.xRange(clamp(l.z, SHIP.bowZ, SHIP.sternZ));
      if (l.x > a - 1 && l.x < b + 1 && l.y < SHIP.deckY - 1.2 && l.y > -12) return true;
    }
    for (const c of parked) { const d = l.clone().sub(c.position); d.y = 0; if (d.length() < 5.5 && l.y < SHIP.deckY + 6) return true; }
    return false;
  },
  windKt: 7 * 1.944, groundUnder: 0,
};

// ------------------------------------------------------------------ events (sounds, effects, messages)
let lastWarn = {};
function handleEvents() {
  for (const e of ac.events) {
    if (e.kind === 'touch') { const k = clamp(e.sink / 3, 0.3, 1.5); sound.thump(k); if (e.vRel > 25) { fx.tyreSmoke(e.pos, env.surface(e.pos.x, e.pos.z).v, 1); sound.squeal(); } state.shake = Math.max(state.shake, 0.25 * k); }
    if (e.kind === 'touchdown' && e.sink > 5.2) flash('Hard landing: ' + e.sink.toFixed(1) + ' m/s sink', 4);
    if (e.kind === 'scrape') { fx.sparks(e.pos, ship.velocity); flash('Tail scrape!', 2); }
    if (e.kind === 'hookbounce') flash('Hook bounced off the deck', 2);
    if (e.kind === 'airborne' && ac.launchT < 8) { flash('Airborne off the ramp at ' + Math.round(e.ias * 3.6) + ' km/h. Positive climb: gear up (G), flaps up above 300 m (L).', 6); sound.say('Positive climb', 'climb', 20); }
    if (e.kind === 'stopped') { state.shake = 0.4; setTimeout(showReport, 600); }
    if (e.kind === 'crash') { flash(e.msg + '. Press Backspace to try again.', 999); sound.thump(2); }
    if (e.kind === 'bit') sound.say('Flight control system ready', 'bit', 20);
  }
  ac.events.length = 0;
  for (const [text, secs] of ac._msgQ) flash(text, secs);
  ac._msgQ.length = 0;
}

function voiceWarnings(dt) {
  if (ac.crashed || !state.started || state.paused || ac.power() === 'none') return;
  const t = ac.t, aoa = t.alpha * R2D;
  const say = (txt, key, gap = 5) => sound.say(txt, key, gap);
  if (!ac.onGround) {
    if (aoa > 24) say('Critical angle of attack', 'aoa', 4);
    if (t.nz > (ac.stores ? DATA.nMaxStores : DATA.nMax) - 0.3) say('Maximum G', 'g', 4);
    if (ac.pos.y - (env.groundUnder || 0) < 300 && t.vs < -30 && ac.gear < 0.5) say('Pull up, pull up', 'pullup', 3);
    if (ac.gear < 0.5 && ac.pos.y - env.groundUnder < 150 && t.ias < 330 / 3.6 && t.vs < -2) say('Check landing gear', 'gear', 6);
    if (t.ias > DATA.vMaxIAS * 0.97) say('Overspeed', 'overspeed', 4);
  }
  if (ac.fuel < 800 && ac.fuel > 0) say('Bingo fuel', 'bingo', 60);
  if (ac.engines.some(e => e.state === 'running' && e.egt > 900)) say('Engine overheat', 'egt', 10);
}

function showReport() {
  const r = ops.report; if (!r) return;
  const el = $('report');
  el.querySelector('.grade').textContent = r.grade;
  const rows = [['Wire', String(r.wire)], ['Closure', Math.round(r.closure) + ' km/h'], ['Sink at touchdown', r.sink.toFixed(1) + ' m/s'],
    ['AoA at the wire', r.aoa.toFixed(1) + '°'], ['Peak deceleration', r.peak.toFixed(1) + ' g'], ['Run-out', Math.round(r.run) + ' m'],
    ['LSO comments', r.faults.length ? r.faults.join(', ') : 'none']];
  el.querySelector('dl').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  el.hidden = false;
}

// ------------------------------------------------------------------ model animation
const tq = new THREE.Quaternion(), axX = V3(1, 0, 0), axY = V3(0, 1, 0);
function hinge(name, angle, axis = axX) { const o = nodes[name]; if (!o) return; o.quaternion.copy(rest[o.uuid]).multiply(tq.setFromAxisAngle(axis, angle)); }
let probeT = 0, beacon = 0;
function animateModel(dt, time) {
  if (!model) return;
  model.position.copy(ac.pos); model.quaternion.copy(ac.quat);
  const droop = ac.flap * DATA.surf.droop;
  hinge('Stabilator_L', -(ac.dE - ac.dD)); hinge('Stabilator_R', -(ac.dE + ac.dD));
  hinge('Aileron_L', ac.dA + droop); hinge('Aileron_R', -ac.dA + droop);
  hinge('Rudder_L', ac.dR); hinge('Rudder_R', ac.dR);
  hinge('Flap_L', ac.flap * DATA.surf.flap); hinge('Flap_R', ac.flap * DATA.surf.flap);
  for (const n of ['SlatInner_L', 'SlatInner_R', 'SlatOuter_L', 'SlatOuter_R']) hinge(n, -ac.slat * 18 * D2R);
  hinge('Airbrake', -ac.airbrake * 55 * D2R);
  const hk = nodes.TailHook; if (hk) hk.quaternion.copy(rest[hk.uuid]).multiply(tq.setFromAxisAngle(axX, ac.hookAng * 36 / 38));
  // gear: nose retracts aft, mains forward; oleo compression
  const gu = 1 - ac.gear;
  const gn = nodes.Gear_Nose, gl = nodes.Gear_Main_L, gr = nodes.Gear_Main_R;
  if (gn) { gn.quaternion.copy(rest[gn.uuid]).multiply(tq.setFromAxisAngle(axX, -gu * 100 * D2R)); gn.visible = ac.gear > 0.02;
    gn.position.y = (gn.userData.y0 ??= gn.position.y) + (ac.wheels[0].comp - ac.wheels[0].vis * ac.gear); }
  for (const [g, w] of [[gl, ac.wheels[1]], [gr, ac.wheels[2]]]) {
    if (!g) continue;
    g.quaternion.copy(rest[g.uuid]).multiply(tq.setFromAxisAngle(axX, gu * 88 * D2R));
    g.position.y = (g.userData.y0 ??= g.position.y) + (w.comp - w.vis * ac.gear);
    g.visible = ac.gear > 0.02;
  }
  wheelPivots.forEach((p, i) => { const w = ac.wheels[i]; if (w && w.contact) p.userData.spin = w.spin; else p.userData.spin = (p.userData.spin || 0) * (1 - dt * 0.8); p.rotation.x -= (p.userData.spin || 0) * dt; });
  for (const n of ['NoseGearDoors', 'MainBayDoor_L', 'MainBayDoor_R']) if (nodes[n]) nodes[n].visible = ac.gear > 0.25 && !ac.damage.gear;
  if (nodes.CanopyHinge) { nodes.CanopyHinge.rotation.x = ac.canopy * 28 * D2R; nodes.CanopyHinge.visible = !ac.canopyLost; }
  foldWings(nodes, ac.fold);
  probeT += clamp((state.probe ? 1 : 0) - probeT, -dt / 3, dt / 3);
  if (nodes.IFRProbe) nodes.IFRProbe.quaternion.copy(rest[nodes.IFRProbe.uuid]).multiply(tq.setFromAxisAngle(axY, probeT * 22 * D2R));
  if (nodes.Stick) nodes.Stick.quaternion.copy(rest[nodes.Stick.uuid]).multiply(tq.setFromEuler(new THREE.Euler(-ac.inp.pitch * 0.25, 0, -ac.inp.roll * 0.25)));
  if (nodes.Throttle) nodes.Throttle.position.z = (nodes.Throttle.userData.z0 ??= nodes.Throttle.position.z) - ac.inp.throttle * 0.12;
  // engines: afterburner plume, nozzle petals
  for (let i = 0; i < 2; i++) {
    const e = ac.engines[i], f = flames[i], ab = e.AB;
    const len = 2.2 + 4.2 * ab + 0.8 * Math.sin(time * 31 + i);
    f.visible = ab > 0.02;
    for (const p of f.userData.parts) { p.scale.set(1, 1, len); p.material.uniforms.t.value = time; p.material.uniforms.ab.value = ab; }
    f.userData.diamonds.forEach((s, k) => { s.position.set(0, 0, 0.5 + k * len * 0.16); const sc = (0.55 - k * 0.07) * (0.6 + 0.4 * ab); s.scale.set(sc, sc, 1);
      s.material.opacity = ab * (0.75 - k * 0.12) * (0.85 + 0.15 * Math.sin(time * 40 + k)); });
    f.userData.glow.position.set(0, 0, 0.2); f.userData.glow.scale.setScalar(1.3); f.userData.glow.material.opacity = 0.8 * ab;
    const nf = clamp((e.N - 0.7) / 0.3, 0, 1);
    const area = e.state === 'off' ? 1.0 : 1.06 - 0.12 * nf + 0.14 * ab;
    const g = nozzleGroups[i]; if (g) g.scale.set(area, area, 1);
  }
  model.traverse(o => { if (o.userData.ab) o.material.opacity = 0.95 * Math.max(ac.AB[0], ac.AB[1]) + 0.08 * Math.max(0, ac.N[0] - 0.7); });
  const vap = clamp((ac.t.alpha * R2D - 11) / 8, 0, 1) * clamp((ac.t.qbar - 7000) / 12000, 0, 1) * (ac.pos.y < 6000 ? 1 : 0.2);
  lerxVapor.forEach((s, i) => { s.material.opacity = vap * (0.35 + 0.2 * Math.sin(time * 20 + i)); });
  // approach indexer light: amber on-speed, green fast, red slow
  if (aoaLight) { const a = ac.t.alpha * R2D; aoaLight.visible = ac.gear > 0.9 && !ac.onGround && ac.power() !== 'none';
    aoaLight.material.color.set(a > 12 ? 0xff2a1a : a < 9 ? 0x30ff60 : 0xffb020); }
  beacon += dt;
  const powered = ac.power() !== 'none';
  for (const n of ['Beacon_Top', 'Beacon_Bot']) if (nodes[n]) nodes[n].visible = powered && (beacon % 1.2) < 0.12;
  for (const n of ['NavLight_L', 'NavLight_R', 'TailLight']) if (nodes[n]) nodes[n].visible = powered;
  const inside = state.view === 'cockpit';
  for (const p of pilotNodes) p.visible = !inside;
}

// ------------------------------------------------------------------ cameras
const EYE = V3(0, 1.16, st2z(4.20));   // seat raised for carrier ops: about 14.5° over-nose view
let chaseSmooth = null;
function updateCamera(dt) {
  const inside = state.view === 'cockpit';
  camera.near = inside ? 0.04 : 0.3;
  // shake: buffet near the AoA limit, touchdown/arrest jolts, deck rumble in afterburner
  const aoa = ac.t.alpha * R2D;
  const buffet = !ac.onGround ? clamp((aoa - 15) / 10, 0, 1) * clamp(ac.t.qbar / 15000, 0, 1) : 0;
  const rumble = ac.onGround ? Math.max(ac.AB[0], ac.AB[1]) * 0.25 + clamp(ac.t.V / 80, 0, 1) * 0.15 : 0;
  state.shake = Math.max(0, state.shake - dt * 1.6);
  const sh = (buffet * 0.5 + rumble * 0.3 + state.shake) * 0.012;
  // smooth band-limited noise (7-19 Hz) instead of per-frame random jumps, which read as screen flicker
  const tt = state.simTime;
  const nx = Math.sin(tt * 47.1) * 0.5 + Math.sin(tt * 73.7 + 1.3) * 0.3 + Math.sin(tt * 119.3 + 2.1) * 0.2;
  const ny = Math.sin(tt * 53.9 + 0.7) * 0.5 + Math.sin(tt * 88.1 + 2.9) * 0.3 + Math.sin(tt * 111.7 + 0.4) * 0.2;
  const jitter = V3(nx * sh * 0.5, ny * sh * 0.5, 0);
  if (inside) {
    const gSag = -clamp(ac.t.nz - 1, -2, 8) * 0.004;
    const arrestLean = ac.arrest ? -clamp(ac.arrest.decel || 0, 0, 5) * 0.012 : 0;
    const p = EYE.clone().add(jitter).add(V3(0, gSag, arrestLean));
    camera.position.copy(p).applyQuaternion(ac.quat).add(ac.pos);
    camera.quaternion.copy(ac.quat).multiply(yawPitchQuat(state.head.yaw + jitter.x * 2, state.head.pitch + jitter.y * 2));
    camera.fov += (state.fov - camera.fov) * Math.min(1, dt * 8);
  } else {
    camera.fov += (50 - camera.fov) * Math.min(1, dt * 4);
    const o = state.orbit;
    if (state.view === 'chase') {
      const off = V3(0, 0, o.dist).applyEuler(new THREE.Euler(-o.pitch, o.yaw - Math.PI, 0, 'YXZ'));
      const want = off.applyQuaternion(ac.quat).add(ac.pos);
      chaseSmooth = chaseSmooth ? chaseSmooth.lerp(want, 1 - Math.exp(-dt * 6)) : want.clone();
      camera.position.copy(chaseSmooth).add(jitter.multiplyScalar(6));
      const upv = ac.t.upv ? V3(0, 1, 0).lerp(ac.t.upv, 0.35).normalize() : V3(0, 1, 0);
      camera.up.copy(upv);
      camera.lookAt(ac.pos.clone().addScaledVector(ac.t.upv || axY, 1.2));
      chaseSmooth.addScaledVector(ac.vel, dt);
    } else if (state.view === 'orbit') {
      const off = V3(0, 0, o.dist).applyEuler(new THREE.Euler(-o.pitch, o.yaw, 0, 'YXZ'));
      camera.position.copy(ac.pos).add(off); camera.up.set(0, 1, 0); camera.lookAt(ac.pos);
    } else if (state.view === 'flyby') {
      if (!state.flyby || camera.position.distanceTo(ac.pos) > 900) {
        const ahead = ac.vel.clone().sub(ac.onGround ? ship.velocity : zero);
        if (ahead.length() < 5) ahead.set(0, 0, -1);
        ahead.normalize().multiplyScalar(Math.max(ac.t.V * 3, 150));
        const side = V3().crossVectors(ahead, axY).normalize().multiplyScalar(25);
        state.flyby = ac.pos.clone().add(ahead).add(side).add(V3(0, -6, 0));
        if (state.flyby.y < 3) state.flyby.y = 3;
      }
      camera.position.copy(state.flyby); camera.up.set(0, 1, 0); camera.lookAt(ac.pos);
      camera.fov = clamp(2 * Math.atan(18 / camera.position.distanceTo(ac.pos)) * R2D, 8, 60);
    } else if (state.view === 'deck') {
      camera.position.copy(ship.localToWorld(V3(-31, SHIP.deckY + 3.5, 112)));
      camera.up.set(0, 1, 0); camera.lookAt(ac.pos);
      camera.fov = clamp(2 * Math.atan(22 / camera.position.distanceTo(ac.pos)) * R2D, 5, 65);
    }
  }
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  if (model) model.updateMatrixWorld();
}

// ------------------------------------------------------------------ status bar (external views)
function statusBar() {
  const t = ac.t, imp = settings.units === 'imperial';
  $('sb-spd').textContent = imp ? Math.round(t.ias * 1.94384) + ' kt' : Math.round(t.ias * 3.6) + ' km/h';
  $('sb-alt').textContent = imp ? Math.round(ac.pos.y * 3.28084) + ' ft' : Math.round(ac.pos.y) + ' m';
  $('sb-mach').textContent = 'M ' + t.M.toFixed(2);
  $('sb-g').textContent = t.nz.toFixed(1) + ' g';
  $('sb-aoa').textContent = (t.alpha * R2D).toFixed(1) + '°';
  const e = ac.engines;
  $('sb-thr').textContent = e[0].AB > 0.05 ? 'AB ' + Math.round(e[0].AB * 100) + '%' + (e[0].chr ? ' ЧР' : '') : Math.round((e[0].N + e[1].N) / 2 * 100) + '% rpm';
  $('sb-fuel').textContent = Math.round(ac.fuel) + ' kg';
  const cfg = [ac.gear > 0.5 ? 'GEAR' : '', ac.flap > 0.5 ? 'FLAPS' : '', ac.hook > 0.5 ? 'HOOK' : '', ac.airbrake > 0.3 ? 'SPDBRK' : '', ac.holdback ? 'HOLDBACK' : '',
    ac.arrest ? 'TRAPPED' : '', ac.fold > 0.05 ? 'WINGS FOLDED' : '', ac.canopy > 0.05 ? 'CANOPY OPEN' : '', ac.parkBrake ? 'PARK BRK' : '', ac.lawName || ''].filter(Boolean).join(' · ');
  $('sb-cfg').textContent = cfg || 'CLEAN';
}

// ------------------------------------------------------------------ main loop
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  hud.resize(w, h, Math.min(devicePixelRatio, 2));
}
window.addEventListener('resize', resize);
syncSettingsUI();

let last = performance.now(), acc = 0;
const DT = 1 / 240;
// Render-state interpolation: physics runs at a fixed 240 Hz, the screen at 60-120 Hz. Without blending the two,
// the jet is drawn at whichever step last finished and jumps up to one step (1.2 m at Mach 0.9) frame to frame.
const interp = { apos: V3(), aquat: new THREE.Quaternion(), spos: V3(), squat: new THREE.Quaternion(),
  phys: { apos: V3(), aquat: new THREE.Quaternion(), spos: V3(), squat: new THREE.Quaternion() }, on: false };
function beginInterp() {
  const P = interp.phys;
  P.apos.copy(ac.pos); P.aquat.copy(ac.quat); P.spos.copy(ship.position); P.squat.copy(ship.quaternion);
  // after a teleport (mission start) or a crash there is nothing sensible to blend from
  if (interp.apos.distanceToSquared(ac.pos) > 400 || ac.crashed || state.paused) { interp.on = false; return; }
  const a = clamp(acc / DT, 0, 1);
  ac.pos.lerpVectors(interp.apos, P.apos, a); ac.quat.slerpQuaternions(interp.aquat, P.aquat, a);
  ship.position.lerpVectors(interp.spos, P.spos, a); ship.quaternion.slerpQuaternions(interp.squat, P.squat, a);
  ship.updateMatrix(); ship.updateWorldMatrix(false, false);
  interp.on = true;
}
function endInterp() {
  if (!interp.on) return;
  const P = interp.phys;
  ac.pos.copy(P.apos); ac.quat.copy(P.aquat); ship.position.copy(P.spos); ship.quaternion.copy(P.squat);
  ship.updateMatrix(); ship.updateWorldMatrix(false, false);
  interp.on = false;
}
function physics(dt) {
  acc += dt;
  let n = 0;
  while (acc >= DT && n < 40) {
    // keep the previous physics state so rendering can interpolate between fixed steps
    interp.apos.copy(ac.pos); interp.aquat.copy(ac.quat); interp.spos.copy(ship.position); interp.squat.copy(ship.quaternion);
    ship.update(DT);
    ac.step(DT, env);
    ops.checkWires(ac);
    state.simTime += DT;
    acc -= DT; n++;
    if (ac.crashed) break;
  }
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1); last = now;
  const time = now / 1000;
  if (!model) { renderer.render(scene, camera); return; }
  if (!state.started) state.orbit.yaw += dt * 0.08;
  if (!state.paused && !ac.crashed) {
    readInputs(dt);
    physics(dt);
    const jbdT = ac.holdback || (ac.onGround && scenario !== 'approach' && ac.launchT < 3) ? 40 * D2R : 90 * D2R;
    const ji = scenario === 'short' ? 1 : 0;
    ship.jbd[ji].rotation.x += (jbdT - ship.jbd[ji].rotation.x) * Math.min(1, dt * 1.5);
  }
  beginInterp();
  env.groundUnder = env.surface(ac.pos.x, ac.pos.z).h;
  const eyeW = EYE.clone().applyQuaternion(ac.quat).add(ac.pos);
  const lens = ac.pos.distanceTo(ship.position) < 9000 ? ship.updateLens(eyeW, ops.waveOff, time) : null;
  env.lens = lens;
  if (!state.paused) ops.update(dt, ac, lens);
  handleEvents();
  voiceWarnings(dt);
  updateChecklist();
  if (state.msgT > 0 && state.msgT < 900) { state.msgT -= dt; if (state.msgT <= 0) $('msg').hidden = true; }
  animateModel(dt, time);
  fx.update(state.paused ? 0 : dt, ac, model, env);
  sunLight.position.copy(ac.pos).addScaledVector(sun, 250); sunLight.target.position.copy(ac.pos);
  water.material.uniforms.time.value += dt * 0.6;
  water.position.set(Math.round(camera.position.x / 200) * 200, 0, Math.round(camera.position.z / 200) * 200);
  // from altitude the small waves are sub-pixel: calm the normal distortion and sun glints so the sea doesn't sparkle and alias
  { const k = clamp((camera.position.y - 300) / 2500, 0, 1), U = water.material.uniforms;
    U.distortionScale.value = 3.2 - 2.5 * k; if (U.sunColor) U.sunColor.value.setRGB(1, 0.957, 0.878).multiplyScalar(1 - 0.7 * k); }
  updateCamera(dt);
  // HUD in the cockpit, clipped to the combiner
  const inside = state.view === 'cockpit';
  const envHud = { ...env, shipVelocity: ship.velocity, waveOff: ops.waveOff, mouseStick: settings.mouseStick ? mouse : null };
  if (inside && nodes.HUD_Glass) {
    const g = nodes.HUD_Glass; g.updateWorldMatrix(true, false);
    const pos = g.geometry.attributes.position; const poly = [];
    for (let i = 0; i < pos.count; i++) {
      const v = V3().fromBufferAttribute(pos, i).applyMatrix4(g.matrixWorld).project(camera);
      poly.push([(v.x * 0.5 + 0.5) * hud.cv.width, (-v.y * 0.5 + 0.5) * hud.cv.height]);
    }
    const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length, cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;
    const ex = poly.map(p => [cx + (p[0] - cx) * 1.12, cy + (p[1] - cy) * 1.12]);
    ex.sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
    hud.draw(camera, ac, envHud, ex);
  } else hud.clear(envHud);
  $('statusbar').hidden = inside || !state.started;
  if (!inside) statusBar();
  displays.update(ac, { ship, windKt: env.windKt, lens, mode: ac.onGround ? 'DECK' : ac.gear > 0.5 ? 'LAND' : 'NAV' }, now);
  const gl = clamp((ac.t.nz - 7) / 2.5, 0, 0.85) + clamp((-ac.t.nz - 2) / 2, 0, 0.6);
  $('vignette').style.opacity = inside ? gl : 0;
  $('stickmark').hidden = !(settings.mouseStick && state.started && !state.paused);
  if (settings.mouseStick) { const sm = $('stickmark'); sm.style.left = (mouse.x * 100) + '%'; sm.style.top = (mouse.y * 100) + '%'; }
  sound.update(ac, inside, state.paused);
  renderer.render(scene, camera);
  endInterp();
}
window.__sim = { ac, state, ship, env, camera, nodes, hud, ops,
  advance(secs, ctl) { const n = Math.round(secs / DT); for (let i = 0; i < n && !ac.crashed; i++) { ctl && ctl(ac, i * DT); ship.update(DT); ac.step(DT, env); ops.checkWires(ac); state.simTime += DT; } return ac.t; } };
requestAnimationFrame(frame);
camera.position.set(-60, 40, 120); camera.lookAt(0, 20, 40);
$('resume').hidden = true;
