import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Aircraft, DATA } from './flight.js';
import { makeSky, makeClouds, makeStars, Carrier, SHIP } from './world.js';
import { Ocean } from './ocean.js';
import { PostFX } from './postfx.js';
import { loadCockpitDetail } from './cockpitdetail.js';
import { AircraftDetail } from './aircraftdetail.js';
import { HUD, Displays } from './hud.js';
import { Sound } from './audio.js';
import { Effects } from './effects.js';
import { CarrierOps } from './ops.js';
import { Cockpit, CONTROL_INFO } from './cockpit.js';
import { Instructor, LESSONS } from './instructor.js';
import { Recorder, Replay, Debrief } from './debrief.js';
import { Tanker } from './tanker.js';
import { Bindings } from './bindings.js';

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
const skyCtl = makeSky(scene, renderer, SUN_EL, SUN_AZ);
const sun = skyCtl.sun.clone();              // direction to the main light (sun by day, moon by night)
const sunLight = new THREE.DirectionalLight(0xfff1dc, 3.4);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
Object.assign(sunLight.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 600 });
sunLight.shadow.bias = -0.0004; sunLight.shadow.normalBias = 0.03;
scene.add(sunLight, sunLight.target);
const hemiLight = new THREE.HemisphereLight(0xbcd3ea, 0x1d2c36, 0.55);
scene.add(hemiLight);

const texLoader = new THREE.TextureLoader();
const water = new Ocean(texLoader.load('assets/waternormals.jpg'));
scene.add(water);
const clouds = makeClouds(scene);
const postfx = new PostFX(renderer, scene, camera);
const acDetail = new AircraftDetail();
const night = makeStars(scene);
const ship = new Carrier({ speed: 12 });
scene.add(ship);
ship.loadDetail(renderer);
const fx = new Effects(scene);
postfx.setEffects(fx);
const WIND = V3(0, 0, 7);               // natural wind from the north, 7 m/s

// ------------------------------------------------------------------ settings
const settings = { fbw: true, units: 'metric', sound: true, voice: true, quality: 'high', sea: 1, mouseStick: false, tod: 'day', rumble: true };
try { Object.assign(settings, JSON.parse(localStorage.getItem('mig29k-settings') || '{}')); } catch (e) { }
function saveSettings() { try { localStorage.setItem('mig29k-settings', JSON.stringify(settings)); } catch (e) { } }

// ------------------------------------------------------------------ aircraft
const ac = new Aircraft();
const ckFlood = new THREE.PointLight(0xffd6b0, 0, 1.6, 1.5);
let navGlow = null;
let model = null, nodes = {}, rest = {}, flames = [], pilotNodes = [], lerxVapor = [], wheelPivots = [], nozzleGroups = [], aoaLight = null, landingLight = null, probeTip = null;
const parked = [];
const state = { paused: true, started: false, view: 'orbit', head: { yaw: 0, pitch: -13 * D2R }, fov: 64, orbit: { yaw: 2.3, pitch: 0.16, dist: 26 },
  msgT: 0, simTime: 0, shake: 0, gateAB: false, flyby: null };
const ops = new CarrierOps(ship, sound, flash);
let cockpitReady = false;
const cockpit = new Cockpit({ ac, sound, camera, canvas: $('gl'),
  onControl: id => control(id, 'click'),
  onGuard: (id, open) => { hooks.emit('guard', { id, open }); },
  onCaution: () => { sound.say('Caution', 'mc', 6); },
  onWarning: tiles => { sound.say('Warning. ' + tiles.join(', ').replace(/ L\b/g, ' left').replace(/ R\b/g, ' right'), 'mw', 5); } });
// tiny event bus for the instructor, recorder and debrief
const bindings = new Bindings();
const hooks = { fns: {}, on(k, f) { (this.fns[k] ||= []).push(f); }, emit(k, d) { for (const f of this.fns[k] || []) f(d); } };
const recorder = new Recorder();
const tanker = new Tanker(scene);
let lastLesson = null;
// the API the instructor's lessons see
const sim = {
  ac, ship, ops, cockpit, hooks, sound, camera, state, get env() { return env; }, get tanker() { return tanker.active ? tanker : null; },
  startScenario: (k, run, o) => startScenario(k, run, { ...o, lesson: true }), flash, control, lookAtControl: id => lookAtControl(id),
  shipLocal: p => ship.worldToLocal(p.clone()),
};
const instructor = new Instructor(sim);
const replay = new Replay({ rec: recorder, ac, ship, state, flash });
const debrief = new Debrief({ rec: recorder, ops,
  onReplay: () => { if (replay.start()) pause(false); },
  onRetry: r => startLesson(r.id), onNext: r => startLesson(r.next),
  onClose: () => {} });
function startLesson(id) {
  if (!id) return;
  lastLesson = id; instructor.start(id);
  $('menu').hidden = true;
}
hooks.on('lesson', e => {
  if (e.phase === 'start') recorder.event(state.simTime, 'lesson', 'Lesson started');
  if (e.phase === 'end') { renderLessons(); setTimeout(() => { debrief.show(e.result); }, 1800); }
});
hooks.on('mistake', e => { if (e.source === 'instructor') recorder.event(state.simTime, 'mistake', e.what, 'mistake'); });
hooks.on('replay', () => { if (replay.on) replay.stop(); else replay.start(); });
hooks.on('lookat', () => { if (instructor.active && instructor.step?.target) instructor.lookAt(); else if (cockpit.hover) lookAtControl(cockpit.hover.id); });
hooks.on('launch', () => {
  if (ac.fold > 0.05) recorder.event(state.simTime, 'mistake', 'Launched with the wings folded', 'mistake');
  if (ac.canopy > 0.05) recorder.event(state.simTime, 'mistake', 'Launched with the canopy open', 'mistake');
  if (ac.flap < 0.5) recorder.event(state.simTime, 'mistake', 'Launched without take-off flaps', 'mistake');
  recorder.event(state.simTime, 'launch', 'Stops released');
});
// turn the pilot's head towards a cockpit control
function lookAtControl(id) {
  const wp = cockpit.worldPos(id); if (!wp) return;
  if (state.view !== 'cockpit') state.view = 'cockpit';
  const eyeW = EYE.clone().applyQuaternion(ac.quat).add(ac.pos);
  const d = wp.sub(eyeW).applyQuaternion(ac.quat.clone().invert());
  state.lookTarget = { yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) };
}

// ------------------------------------------------------------------ time of day
const TOD = {
  day: { el: SUN_EL, az: SUN_AZ, light: [0xfff1dc, 3.4], hemi: [0xbcd3ea, 0x1d2c36, 0.55], exp: 0.62, fog: [0xa3bbd0, 0.000032], sea: 0x06202e, sunCol: 1, night: 0, cloud: 1 },
  dusk: { el: 2.5, az: 262, light: [0xffa35c, 1.7], hemi: [0x8a8fb5, 0x1a1a24, 0.32], exp: 0.78, fog: [0x8c7f86, 0.000038], sea: 0x0a1822, sunCol: 0.8, night: 0.6, cloud: 0.62, lightEl: 6 },
  night: { el: -24, az: 262, light: [0x9fb4ff, 0.32], hemi: [0x1c2638, 0x020304, 0.10], exp: 0.95, fog: [0x04070c, 0.000028], sea: 0x01060a, sunCol: 0.018, night: 1, cloud: 0.022, lightEl: 28, lightAz: 115,
    sky: { skyK: 1 }, seaK: 0.06 },
};
let tod = TOD.day;
function applyTimeOfDay(mode) {
  const T = TOD[mode] || TOD.day; tod = T;
  skyCtl.setSun(T.el, T.az, mode === 'night' ? 0x010305 : 0x0b1e2a, T.sky || {});
  ckFlood.intensity = T.night > 0.9 ? 0.16 : T.night > 0.3 ? 0.06 : 0;
  const le = T.lightEl ?? T.el, la = T.lightAz ?? T.az;
  sun.setFromSphericalCoords(1, (90 - le) * D2R, la * D2R);
  sunLight.color.set(T.light[0]); sunLight.intensity = T.light[1];
  water.u.uSunDir.value.copy(sun); water.u.uSunCol.value.copy(sunLight.color).multiplyScalar(sunLight.intensity * (T.night > 0.9 ? 0.2 : 1));
  hemiLight.color.set(T.hemi[0]); hemiLight.groundColor.set(T.hemi[1]); hemiLight.intensity = T.hemi[2];
  renderer.toneMappingExposure = T.exp;
  scene.fog.color.set(T.fog[0]); scene.fog.density = T.fog[1];
  fx.setLight(T.night > 0.9 ? 0.05 : T.night > 0.3 ? 0.5 : 1);
  water.u.uDeep.value.set(T.night > 0.9 ? 0x00060b : T.night > 0.3 ? 0x041018 : 0x02101a); water.u.uShallow.value.set(T.night > 0.9 ? 0x02141a : T.night > 0.3 ? 0x0b3038 : 0x0e4a5a);
  water.u.uFoamK.value = T.night > 0.9 ? 0.35 : 1;
  night.stars.visible = T.night > 0.9; night.moon.visible = T.night > 0.9;
  ship.setNight(T.night);
  cockpit.backlight = T.night;
  clouds.traverse(o => { if (o.isSprite && !o.material.userData.c0) o.material.userData.c0 = o.material.color.clone(); });
  const seen = new Set(); clouds.traverse(o => { if (o.isSprite && !seen.has(o.material)) { seen.add(o.material); o.material.color.copy(o.material.userData.c0).multiplyScalar(T.cloud); } });
}

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
  postfx.setMovers([{ obj: model, r: 11 }, { obj: tanker.group, r: 26 }]);
  acDetail.apply(model);
  // seat harness hangs in mid-air without the pilot figure: hide it from the cockpit view with the pilot
  model.traverse(o => { if (/^Seat_strap/.test(o.name)) pilotNodes.push(o); });
  model.updateMatrixWorld(true);
  tanker.load(model).catch(e => console.warn('tanker', e));
  Promise.all([cockpit.load(model, nodes), loadCockpitDetail(model, nodes).catch(e => console.warn('cockpit detail', e))])
    .then(() => {
      // the detailed pilot replaces the airframe's simple figure (both are hidden in first person)
      if (nodes.Pilot2) { const old = p => /^Pilot($|_)/.test(p.name); for (const p of pilotNodes) if (old(p)) p.visible = false; pilotNodes = pilotNodes.filter(p => !old(p)); pilotNodes.push(nodes.Pilot2); }
      cockpitReady = true;
    }).catch(e => console.warn('cockpit controls', e));
  // glow halos for the navigation lights (red port, green starboard, white tail) and the red beacons: visible at night from afar
  navGlow = [];
  for (const [n, col, sz] of [['NavLight_L', 0xff2a1a, 0.9], ['NavLight_R', 0x2aff5a, 0.9], ['TailLight', 0xffffff, 0.7], ['Beacon_Top', 0xff2010, 1.1], ['Beacon_Bot', 0xff2010, 1.1]]) {
    const o = nodes[n]; if (!o) continue;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex(), color: col, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }));
    s.scale.setScalar(sz); const c = new THREE.Box3().setFromObject(o).getCenter(V3()); s.position.copy(model.worldToLocal(c)); model.add(s); navGlow.push(s);
  }
  // soft cockpit flood light for night flying (instrument panel and consoles)
  model.add(ckFlood); ckFlood.position.set(0, 1.02, st2z(3.9));
  // nose-gear landing light (lights the deck and the sea at night)
  landingLight = new THREE.SpotLight(0xfff2dc, 0, 700, 0.2, 0.45, 1.2);
  landingLight.position.set(0, -1.2, st2z(5.9)); landingLight.target.position.set(0, -14, st2z(5.9) - 200);
  model.add(landingLight, landingLight.target);
  // refuelling probe tip, from the probe's geometry (its farthest vertex from the hinge)
  if (nodes.IFRProbe) { let far = V3(), best = 0; nodes.IFRProbe.traverse(o => { if (!o.isMesh) return; const P = o.geometry.attributes.position;
    for (let i = 0; i < P.count; i++) { const v = V3().fromBufferAttribute(P, i); if (v.length() > best) { best = v.length(); far = v; } } }); probeTip = far; }
  // parked aircraft (wings folded)
  for (const [x, z, yaw] of [[16.5, 72, 0.55], [16.5, 92, 0.55], [16.0, 112, 0.55]]) {
    const c = model.clone(true);
    c.traverse(o => { if (o.isSprite || o.isLight || o.userData.flame || o.userData.ab || /^Pilot/.test(o.name)) o.visible = false; if (/^(R77_|R73_)/.test(o.name)) o.visible = true; if (o.isMesh && o.geometry.type === 'CylinderGeometry' && o.material.type === 'ShaderMaterial') o.visible = false; });
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
let scenario = 'deck', scenarioOpts = {};
const yawPitchQuat = (yaw, pitch, roll = 0) => new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));

function resetShip() {
  ship.base = V3(0, 0, 0); ship.time = 0; ship.setSea(settings.sea); water.setSea(settings.sea); ship.update(0);
}

function placeOnDeck(sp) {
  const local = V3(sp.x, SHIP.deckY + 1.84, sp.z);
  ac.pos.copy(ship.localToWorld(local.clone()));
  ac.vel.copy(ship.velocity);
  ac.quat.copy(ship.quaternion);
  return local;
}

function startScenario(kind, run = true, opts = {}) {
  if (replay.on) replay.stop();
  if (!opts.lesson && instructor.active) instructor.stop();
  scenario = kind; scenarioOpts = opts;
  resetShip();
  Object.assign(ac, new Aircraft());
  ac.fbw = settings.fbw;
  ops.reset();
  cockpit.guardOpen = {}; cockpit.mcFlash = cockpit.mwFlash = false; cockpit.cwpPrev = {}; cockpit.highlightId = null;
  state.head.dyn = null; state.gEff = 1;
  state.simTime = 0; state.fold = false; state.gateAB = false; state.flyby = null; chaseSmooth = null;
  state.orbit = { yaw: Math.PI, pitch: 0.26, dist: 24 };
  state.checklist = null; state.lookTarget = null;
  recorder.reset(); tanker.stop(); debrief.el.hidden = true; $('report').hidden = true;
  applyTimeOfDay(opts.night ? 'night' : settings.tod);
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
      state.checklist = opts.lesson ? null : coldChecklist();
      if (!opts.lesson) flash('Cold and dark on position 2. Work through the start checklist (top right).', 7);
      state.view = 'cockpit'; state.head = { yaw: -0.35, pitch: -22 * D2R };
    } else {
      ac.setEnginesRunning();
      ac.holdback = { ship, local: local.clone() };
      if (!opts.lesson) flash((kind === 'short' ? 'Short position 1 (105 m run, 16.4 t). ' : 'Long position 2 (195 m run, 18.8 t). ') + 'On the restraining stops: throttle to full afterburner (Tab), check the ЧР take-off rating, then Space to launch.', 9);
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
    ac.gearCmd = ac.gear = 1; ac.flapCmd = ac.flap = 1;
    if (opts.hook !== false) { ac.hookCmd = 1; ac.hookAng = 38 * D2R; ac.hook = 1; }
    ops.touchAndGo = opts.hook === false;
    ac.fuel = 1600; ac.stores = false; ac.sw.ldglt = !!opts.night;
    ac.inp.throttle = 0.30; for (const e of ac.engines) e.N = 0.83;
    if (!opts.lesson) flash('On final, 5 km, 4° glide slope. Fly the ball (amber light, left of the landing area) at 10.5° AoA. Full MIL power at touchdown; catch wire 2 or 3.', 10);
    state.view = 'cockpit'; state.head = { yaw: 0, pitch: -6 * D2R };
  } else if (kind === 'circuit') {
    // the initial: 4 km astern, 600 m to starboard of the ship's track, 300 m, 650 km/h
    const p = ship.localToWorld(V3(600, 0, 4000)); ac.pos.set(p.x, 300, p.z);
    const fwd = V3(0, 0, -1).applyQuaternion(ship.quaternion); fwd.y = 0; fwd.normalize();
    ac.vel.copy(fwd).multiplyScalar(180); ac.quat.copy(yawPitchQuat(Math.atan2(-fwd.x, -fwd.z), 1.5 * D2R));
    ac.setEnginesRunning(); ac.gearCmd = ac.gear = 0; ac.flapCmd = ac.flap = 0; ac.stores = false; ac.fuel = 2200;
    ac.inp.throttle = 0.62; for (const e of ac.engines) e.N = 0.9;
    if (!opts.lesson) flash('Carrier circuit: fly up the starboard side, break over the bow, downwind with gear, flaps and hook, then the 180 into the groove.', 9);
    state.view = 'cockpit'; state.head = { yaw: 0, pitch: -9 * D2R };
  } else if (kind === 'tanker') {
    ac.pos.set(-8000, 5000, -6000); ac.vel.set(0, 0, -142); ac.quat.copy(yawPitchQuat(0, 3 * D2R));
    ac.setEnginesRunning(); ac.gearCmd = ac.gear = 0; ac.flapCmd = ac.flap = 0; ac.stores = false; ac.fuel = 1300;
    ac.inp.throttle = 0.55; for (const e of ac.engines) e.N = 0.86;
    tanker.start(ac, 600, 5015);
    if (!opts.lesson) flash('Tanker 600 m ahead. Probe out (I), close to 20 m, then plug the drogue at 1 to 2 m/s closure.', 9);
    state.view = 'cockpit'; state.head = { yaw: 0, pitch: -4 * D2R };
  } else {
    const alt = opts.alt ?? 3000, spd = opts.speed ?? 230;
    ac.pos.set(-3000, alt, 4000); ac.vel.set(0, 0, -spd);
    ac.quat.copy(yawPitchQuat(0, 2.2 * D2R));
    ac.setEnginesRunning();
    ac.gearCmd = ac.gear = 0; ac.flapCmd = ac.flap = 0;
    ac.inp.throttle = spd < 150 ? 0.35 : 0.72; for (const e of ac.engines) e.N = spd < 150 ? 0.82 : 0.95;
    ac.fuel = DATA.fuelMax * 0.8;
    if (!opts.lesson) flash('Free flight at ' + alt.toLocaleString() + ' m. The carrier is north-east: the centre display shows range and bearing.', 8);
    state.view = opts.lesson ? 'cockpit' : 'chase'; state.head = { yaw: 0, pitch: -6 * D2R };
  }
  if (opts.lesson) state.checklist = null;
  if (!run) { $('msg').hidden = true; return; }
  state.started = true; state.paused = false; $('menu').hidden = true; $('resume').hidden = false;
  if (settings.sound) { sound.start(); sound.suspend(false); if (sound.master) sound.master.gain.value = 0.7; }
  sound.voiceOn = settings.voice;
}

// ------------------------------------------------------------------ cold-start checklist
function coldChecklist() {
  return [
    { k: '1', t: 'Battery ON (lift the red guard)', done: () => ac.battery },
    { k: '5', t: 'Fuel boost pump ON', done: () => ac.sw.pump },
    { k: '2', t: 'APU ON, wait for the green lamp', done: () => ac.apu.state === 'running' || ac.engines.every(e => e.running()) },
    { k: '3', t: 'Left engine master ON, START L (throttle IDLE)', done: () => ac.engines[0].running() },
    { k: '4', t: 'Right engine master ON, START R', done: () => ac.engines[1].running() },
    { k: '6', t: 'Generators ON', done: () => ac.genOnline(0) && ac.genOnline(1) },
    { k: '2', t: 'APU OFF', done: () => ac.apu.state === 'off' && ac.engines.every(e => e.running()) },
    { k: '', t: 'FBW self-test (automatic)', done: () => ac.fbwReady },
    { k: 'O', t: 'Spread wings', done: () => ac.fold < 0.02 && !ac.foldCmd },
    { k: 'K', t: 'Close canopy', done: () => ac.canopy < 0.02 && !ac.canopyCmd },
    { k: 'L', t: 'Take-off flaps', done: () => ac.flap > 0.95 },
    { k: '', t: 'Nav lights and anti-collision beacon ON', done: () => ac.sw.navlt && ac.sw.beacon },
    { k: '', t: 'Restraining stops raised (automatic)', done: () => !!ac.holdback || (!ac.pendingHoldback && ac.launchT > 0.5 && ac.launchT < 99) },
    { k: 'N', t: 'Release parking brake', done: () => !ac.parkBrake },
    { k: 'Tab', t: 'Full afterburner, then Space', done: () => !ac.holdback && ac.launchT > 0.5 && ac.launchT < 99 },
  ];
}
function raiseStops() {
  // the deck crew raise the stops once the jet is configured for launch and sitting on its spot
  if (ac.pendingHoldback && ac.fbwReady && ac.fold < 0.02 && ac.canopy < 0.02) {
    const off = ac.pendingHoldback.ship.localToWorld(ac.pendingHoldback.local.clone()).sub(ac.pos); off.y = 0;
    if (off.length() < 1.0 && ac.vDeckRel < 0.5) { ac.holdback = ac.pendingHoldback; ac.pendingHoldback = null; flash('Restraining stops raised, blast deflector up. Release the parking brake, full afterburner, then Space.', 6); }
    else if (off.length() > 3 && !ac.parkBrake) { ac.pendingHoldback = null; flash('Rolled off the launch position: the stops cannot be raised. Restart (Backspace).', 6); }
  }
}
function updateChecklist() {
  const el = $('checklist');
  raiseStops();
  if (!state.checklist || !state.started) { el.hidden = true; return; }
  el.hidden = false;
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
  $('opt-tod').value = settings.tod; $('opt-rumble').checked = settings.rumble;
  hud.units = settings.units; ac.fbw = settings.fbw; sound.voiceOn = settings.voice; ship.setSea(settings.sea); water.setSea(settings.sea);
  // graphics presets: low = plain forward rendering; medium adds clouds and bloom; high adds AO and motion blur; ultra full DPR
  const Q = settings.quality = ['low', 'medium', 'high', 'ultra'].includes(settings.quality) ? settings.quality : 'high';
  renderer.setPixelRatio(Q === 'ultra' ? Math.min(devicePixelRatio, 2) : Q === 'high' ? Math.min(devicePixelRatio, 1.5) : 1);
  const sm = Q === 'low' ? 1024 : Q === 'medium' ? 2048 : 4096;
  if (sunLight.shadow.mapSize.x !== sm) { sunLight.shadow.mapSize.set(sm, sm); if (sunLight.shadow.map) { sunLight.shadow.map.dispose(); sunLight.shadow.map = null; } }
  postfx.setQuality(Q);
  clouds.visible = !postfx.enabled || !postfx.post.opts.clouds;
  resize();
}
$('opt-fbw').onchange = e => { settings.fbw = e.target.checked; ac.fbw = settings.fbw; saveSettings(); };
$('opt-units').onchange = e => { settings.units = e.target.value; hud.units = settings.units; saveSettings(); };
$('opt-sound').onchange = e => { settings.sound = e.target.checked; saveSettings(); if (sound.master) sound.master.gain.value = settings.sound ? 0.7 : 0; };
$('opt-voice').onchange = e => { settings.voice = e.target.checked; sound.voiceOn = settings.voice; saveSettings(); };
$('opt-quality').onchange = e => { settings.quality = e.target.value; saveSettings(); syncSettingsUI(); };
$('opt-sea').onchange = e => { settings.sea = parseFloat(e.target.value); ship.setSea(settings.sea); water.setSea(settings.sea); saveSettings(); };
$('opt-mouse').onchange = e => { settings.mouseStick = e.target.checked; saveSettings(); };
for (const b of document.querySelectorAll('[data-scn]')) b.onclick = () => { lastLesson = null; startScenario(b.dataset.scn, true, b.dataset.night ? { night: true } : {}); };
// a clicked button must not keep keyboard focus: Space / Enter are flight controls and would 'press' it again
document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('button, select'); if (b && b.tagName === 'BUTTON') b.blur(); }, true);
window.addEventListener('keydown', e => { if ((e.code === 'Space' || e.code === 'Enter') && document.activeElement && document.activeElement.tagName === 'BUTTON' && state.started && !state.paused) { e.preventDefault(); document.activeElement.blur(); } }, true);
// training / free-mission tabs and the lesson list (with earned stars)
function renderLessons() {
  let done = {}; try { done = JSON.parse(localStorage.getItem('mig29k-lessons') || '{}'); } catch (e) { }
  $('lessons').innerHTML = LESSONS.map(L => `<button class="lesson" data-lesson="${L.id}"><span class="n">${L.n}</span><b>${L.title}</b>
    <span class="st" aria-label="${done[L.id] || 0} of 3 stars">${'★'.repeat(done[L.id] || 0)}${'☆'.repeat(3 - (done[L.id] || 0))}</span><span class="d">${L.summary} · ${L.minutes} min</span></button>`).join('');
  for (const b of document.querySelectorAll('[data-lesson]')) b.onclick = () => startLesson(b.dataset.lesson);
}
renderLessons();
for (const [t, p] of [['tab-train', 'pane-train'], ['tab-free', 'pane-free']]) $(t).onclick = () => {
  for (const [t2, p2] of [['tab-train', 'pane-train'], ['tab-free', 'pane-free']]) { $(t2).setAttribute('aria-selected', String(t2 === t)); $(p2).hidden = t2 !== t; }
};
$('opt-tod').onchange = e => { settings.tod = e.target.value; saveSettings(); if (!instructor.active && !scenarioOpts.night) applyTimeOfDay(settings.tod); };
$('opt-rumble').onchange = e => { settings.rumble = e.target.checked; saveSettings(); };
$('opt-bind').onclick = () => bindings.open();
$('resume').onclick = () => { if (model && state.started) pause(false); };
$('report-close').onclick = () => { $('report').hidden = true; };

function releaseStops() {
  if (!ac.holdback) return;
  if (ac.engines.some(en => en.N < 0.97)) flash('Check both engines at full power before release', 2.5);
  ac.holdback = null; state.shake = 0.6; flash('Launch!', 2); hooks.emit('launch');
}
function flash(text, secs = 4) { state.msgT = secs; const el = $('msg'); el.textContent = text; el.hidden = false; }
function pause(on) { state.paused = on; $('menu').hidden = !on; sound.suspend(on); $('resume').hidden = !state.started; }

// refuelling probe tip in the world, from the current physics pose (not last frame's model transform)
function probeTipWorld() {
  if (!probeTip || !nodes.IFRProbe || ac.probe < 0.5) return null;
  model.position.copy(ac.pos); model.quaternion.copy(ac.quat);
  nodes.IFRProbe.quaternion.copy(rest[nodes.IFRProbe.uuid]).multiply(new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), ac.probe * 22 * D2R));
  model.updateMatrixWorld(true);
  return nodes.IFRProbe.localToWorld(probeTip.clone());
}

// ------------------------------------------------------------------ cockpit controls (click, keyboard, gamepad, instructor)
const onoff = v => v ? 'ON' : 'OFF';
function control(id, via = 'key') {
  const E = i => (i ? 'Right' : 'Left');
  switch (id) {
    case 'bat': ac.setBattery(!ac.battery); if (ac.battery) cockpit.lampTest(); flash('Battery ' + onoff(ac.battery) + (ac.battery ? ': lamp test' : ''), 2); break;
    case 'pump': ac.setPump(!ac.sw.pump); flash('Fuel boost pump ' + onoff(ac.sw.pump), 2); break;
    case 'apu': ac.setApu(!ac.sw.apu); break;
    case 'engL': case 'engR': { const i = id === 'engR' ? 1 : 0; ac.setEngineMaster(i, !ac.sw.eng[i]); flash(E(i) + ' engine master ' + onoff(ac.sw.eng[i]), 2); break; }
    case 'startL': case 'startR': ac.startEngine(id === 'startR' ? 1 : 0); break;
    case 'genL': case 'genR': { const i = id === 'genR' ? 1 : 0; ac.setGen(i, !ac.sw.gen[i]); flash(E(i) + ' generator ' + onoff(ac.sw.gen[i]), 2); break; }
    case 'gear':
      if (ac.onGround && ac.gearCmd) { flash('Gear lever locked: weight on wheels'); return; }
      if (!ac.gearCmd && ac.t.ias > DATA.vGear) { flash('Gear extension limit is 500 km/h'); return; }
      ac.gearCmd = ac.gearCmd ? 0 : 1; sound.clunk(); flash(ac.gearCmd ? 'Gear down' : 'Gear up', 2); break;
    case 'flaps':
      if (!ac.flapCmd && ac.t.ias > DATA.vFlaps) { flash('Flap limit is 400 km/h'); return; }
      ac.flapCmd = ac.flapCmd ? 0 : 1; flash(ac.flapCmd ? 'Flaps down (take-off / landing), ailerons drooped' : 'Flaps up', 2); break;
    case 'hook': ac.hookCmd = ac.hookCmd ? 0 : 1; if (!ac.hookCmd && ac.arrest && ac.arrest.stopped) { ac.arrest = null; flash('Hook up: wire released', 2); } else flash(ac.hookCmd ? 'Hook down' : 'Hook up', 2); break;
    case 'park': ac.parkBrake = !ac.parkBrake; flash('Parking brake ' + (ac.parkBrake ? 'set' : 'released'), 2); break;
    case 'canopy':
      if (ac.canopyLost) return;
      if (!ac.canopyCmd && ac.t.ias > DATA.vCanopy) { flash('Canopy opens only below 60 km/h'); return; }
      ac.canopyCmd = ac.canopyCmd ? 0 : 1; flash(ac.canopyCmd ? 'Canopy opening' : 'Canopy closing', 2); break;
    case 'fold':
      if (!ac.onGround || ac.vDeckRel > 6) { flash('Wing fold only when stopped on deck'); return; }
      if (ac.hydraulics() < 0.9) { flash('Wing fold needs hydraulic pressure (an engine running)'); return; }
      ac.foldCmd = ac.foldCmd ? 0 : 1; flash(ac.foldCmd ? 'Folding wings' : 'Spreading wings', 2); break;
    case 'navlt': ac.sw.navlt = !ac.sw.navlt; flash('Navigation lights ' + onoff(ac.sw.navlt), 1.5); break;
    case 'beacon': ac.sw.beacon = !ac.sw.beacon; flash('Anti-collision beacon ' + onoff(ac.sw.beacon), 1.5); break;
    case 'ldglt': ac.sw.ldglt = !ac.sw.ldglt; flash('Landing light ' + onoff(ac.sw.ldglt), 1.5); break;
    case 'probe': ac.probeCmd = ac.probeCmd ? 0 : 1; flash(ac.probeCmd ? 'Refuelling probe out' : 'Refuelling probe in', 2); break;
    case 'fcsrst': ac.fcsReset(); break;
    case 'mwarn': cockpit.mwFlash = false; break;
    case 'mcaut': cockpit.mcFlash = false; break;
    default: return;
  }
  hooks.emit('control', { id, via });
}
// keyboard shortcuts drive the same controls (and flip the switch in the cockpit, guard included)
function key(id) { if (cockpitReady) cockpit.activate(id); else control(id); }

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
    case 'KeyG': key('gear'); break;
    case 'KeyL': key('flaps'); break;
    case 'KeyH': key('hook'); break;
    case 'KeyB': ac.brakeCmd = ac.brakeCmd ? 0 : 1; if (ac.brakeCmd && ac.gear > 0.5) flash('Speed brake inhibited with the gear down', 2.5); break;
    case 'Space': releaseStops(); break;
    case 'Tab': ac.inp.throttle = ac.inp.throttle < 0.95 ? 1.0 : 0.85; state.gateAB = ac.inp.throttle > 0.9; break;
    case 'Digit0': ac.inp.throttle = 0; break;
    case 'Digit1': key('bat'); break;
    case 'Digit2': key('apu'); break;
    case 'Digit5': key('pump'); break;
    // 3 / 4: engine master ON first, then the START button
    case 'Digit3': key(ac.sw.eng[0] ? 'startL' : 'engL'); break;
    case 'Digit4': key(ac.sw.eng[1] ? 'startR' : 'engR'); break;
    case 'Digit6': { const on = !(ac.sw.gen[0] && ac.sw.gen[1]); if (ac.sw.gen[0] !== on) key('genL'); if (ac.sw.gen[1] !== on) key('genR'); break; }
    case 'Digit7': key('navlt'); if (ac.sw.beacon !== ac.sw.navlt) key('beacon'); break;
    case 'End': if (ac.onGround) { if (ac.sw.eng[0]) key('engL'); if (ac.sw.eng[1]) key('engR'); } else flash('Engine shutdown is inhibited in flight: use the engine master switches on the start panel'); break;
    case 'KeyN': key('park'); break;
    case 'KeyZ': hooks.emit('replay'); break;
    case 'KeyT': hooks.emit('lookat'); break;
    case 'KeyJ': key('mcaut'); key('mwarn'); break;
    case 'KeyC': state.view = state.view === 'cockpit' ? 'chase' : 'cockpit'; break;
    case 'KeyV': { const order = ['cockpit', 'chase', 'orbit', 'flyby', 'deck']; state.view = order[(order.indexOf(state.view) + 1) % order.length]; state.flyby = null; flash('View: ' + state.view, 1.5); break; }
    case 'KeyM': settings.fbw = !settings.fbw; ac.fbw = settings.fbw; saveSettings(); flash(ac.fbw ? 'FBW normal law' : 'FBW direct law: no AoA or g protection', 3); break;
    case 'KeyU': settings.units = settings.units === 'metric' ? 'imperial' : 'metric'; hud.units = settings.units; saveSettings(); break;
    case 'KeyY': settings.mouseStick = !settings.mouseStick; saveSettings(); flash(settings.mouseStick ? 'Mouse stick ON: the mouse position is the stick (centre = neutral)' : 'Mouse stick OFF', 3); break;
    case 'KeyO': key('fold'); break;
    case 'KeyK': key('canopy'); break;
    case 'KeyI': key('probe'); break;
    case 'Backspace': if (instructor.active || lastLesson) startLesson(instructor.lesson?.id || lastLesson); else startScenario(scenario, true, scenarioOpts); break;
    case 'KeyP': case 'Escape': if (replay.on && e.code === 'Escape') { replay.stop(); break; } if (debrief.open) { debrief.hide(); break; } if (state.started) pause(!state.paused); break;
  }
});
window.addEventListener('keyup', e => {
  keys[e.code] = false;
  if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyR') && ac.inp.throttle >= 0.849) state.gateAB = true;
});
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
window.addEventListener('mousemove', e => { mouse.x = e.clientX / innerWidth; mouse.y = e.clientY / innerHeight; });

let drag = null, down = null;
const ndc = e => [e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1];
canvas.addEventListener('pointerdown', e => {
  down = { x: e.clientX, y: e.clientY, t: e.timeStamp, moved: 0 };
  if (settings.mouseStick && e.button === 0) return;
  drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (down) down.moved = Math.max(down.moved, Math.hypot(e.clientX - down.x, e.clientY - down.y));
  if (drag && down && down.moved > 4) { cockpit.setHover(null); return; }
  if (state.view === 'cockpit' && cockpitReady) cockpit.setHover(cockpit.pick(...ndc(e)), e.clientX, e.clientY);
  else cockpit.setHover(null);
});
canvas.addEventListener('pointerleave', () => cockpit.setHover(null));
canvas.addEventListener('pointerup', e => {
  // a click without dragging operates the control under the cursor
  if (down && down.moved < 5 && e.timeStamp - down.t < 600 && state.view === 'cockpit' && cockpitReady && e.button === 0) {
    const p = cockpit.pick(...ndc(e)); if (p) cockpit.click(p);
    cockpit.setHover(cockpit.pick(...ndc(e)), e.clientX, e.clientY);
  }
  down = null;
});
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY };
  if (state.view === 'cockpit') { state.lookTarget = null; state.head.yaw = clamp(state.head.yaw - dx * 0.004, -2.6, 2.6); state.head.pitch = clamp(state.head.pitch - dy * 0.004, -1.2, 1.3); }
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
  if (CAPTURE && window.__holdInputs) return;   // film shots drive ac.inp themselves
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
  bindings.poll();
  for (const gp of pads) {
    if (!gp || bindings.capture) continue;
    const R = bindings.read(gp), A = R.axes, H = R.held, P = R.pressed;
    if (A.pitch || A.roll) { tgt.roll = A.roll || 0; tgt.pitch = A.pitch || 0; analog = true; }
    if (A.yaw) { tgt.yaw = A.yaw; }
    else if (H.yawL || H.yawR) tgt.yaw = (H.yawR ? 1 : 0) - (H.yawL ? 1 : 0);
    if (A.throttle != null) {
      // absolute HOTAS throttle: the last 12 % of travel is the afterburner, past the detent
      const a = A.throttle; ac.inp.throttle = a > 0.88 ? 0.86 + (a - 0.88) / 0.12 * 0.14 : a / 0.88 * 0.85; state.gateAB = a > 0.88; thrRate = 0;
    } else if (H.thrUp || H.thrDn) thrRate = ((H.thrUp || 0) - (H.thrDn || 0)) * 0.5;
    if (H.brake) ac.inp.brake = 1;
    const lx = A.lookX || 0, ly = A.lookY || 0;
    if (lx || ly) { if (state.view === 'cockpit') { state.lookTarget = null; state.head.yaw = clamp(state.head.yaw - lx * dt * 2.2, -2.6, 2.6); state.head.pitch = clamp(state.head.pitch - ly * dt * 1.6, -1.2, 1.3); }
      else { state.orbit.yaw -= lx * dt * 2; state.orbit.pitch = clamp(state.orbit.pitch + ly * dt * 1.5, -1.2, 1.4); } }
    if (P.gear) key('gear'); if (P.hook) key('hook'); if (P.flaps) key('flaps');
    if (P.view) state.view = state.view === 'cockpit' ? 'chase' : 'cockpit';
    if (P.launch) releaseStops();
    if (P.pause && state.started) pause(!state.paused);
    if (P.ab) { ac.inp.throttle = ac.inp.throttle < 0.95 ? 1.0 : 0.85; state.gateAB = ac.inp.throttle > 0.9; }
    if (P.speedbrake) ac.brakeCmd = ac.brakeCmd ? 0 : 1;
    if (P.mcaut) { key('mcaut'); key('mwarn'); }
    if (P.lookat) hooks.emit('lookat');
    if (P.replay) hooks.emit('replay');
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

// controller force feedback (dual-rumble where the browser and pad support it)
function rumble(weak, strong, ms) {
  if (!settings.rumble || !navigator.getGamepads) return;
  for (const gp of navigator.getGamepads()) { const a = gp && gp.vibrationActuator; if (a && a.playEffect) a.playEffect('dual-rumble', { duration: ms, weakMagnitude: clamp(weak, 0, 1), strongMagnitude: clamp(strong, 0, 1) }).catch(() => {}); }
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
const EVT_TEXT = { hotstart: 'Hot start', lightoff: 'Engine light-off', engidle: 'Engine at idle', flameout: 'Engine flame-out', startabort: 'Engine start aborted',
  tyres: 'Tyres burst', fireout: 'Fire out', fcsrestored: 'FCS restored', hookbounce: 'Hook bounced (hook skip)', scrape: 'Tail scrape' };
function handleEvents() {
  const T = state.simTime;
  for (const e of ac.events) {
    if (e.kind === 'mistake') recorder.event(T, 'mistake', e.what, 'mistake');
    else if (e.kind === 'touchdown') recorder.event(T, 'touchdown', 'Touchdown, ' + e.sink.toFixed(1) + ' m/s sink', e.sink > 5.5 ? 'mistake' : 'info');
    else if (e.kind === 'airborne') recorder.event(T, 'airborne', 'Airborne at ' + Math.round(e.ias * 3.6) + ' km/h');
    else if (e.kind === 'stopped') recorder.event(T, 'trap', 'Trapped, wire ' + (ac.arrest?.wire || '?'), 'good');
    else if (e.kind === 'crash') recorder.event(T, 'crash', e.msg, 'mistake');
    else if (e.kind === 'fail') recorder.event(T, 'fail', { eng: 'Engine failure', fire: 'Engine fire', fcs: 'FCS failure', hyd: 'Hydraulic failure' }[e.what] + (e.i != null && e.what !== 'hyd' ? (e.i ? ' (right)' : ' (left)') : ''), 'warn');
    else if (e.kind === 'startbtn' || e.kind === 'engidle') recorder.events.push({ t: T, kind: e.kind, i: e.i, text: (e.i ? 'Right' : 'Left') + (e.kind === 'startbtn' ? ' engine START' : ' engine at idle'), level: 'info' });
    else if (EVT_TEXT[e.kind]) recorder.event(T, e.kind, EVT_TEXT[e.kind], e.kind === 'hotstart' || e.kind === 'tyres' || e.kind === 'scrape' ? 'mistake' : 'info');
    if (e.kind === 'lightoff') { state.shake = Math.max(state.shake, 0.22); sound.thump?.(0.35); rumble(0.3, 0.5, 250); }
    if (e.kind === 'hotstart') sound.say('Engine overheat', 'egt', 4);
    if (e.kind === 'tyres') { sound.thump(1.2); fx.sparks(e.pos, ship.velocity); }
    if (e.kind === 'fail' && e.what === 'eng') { state.shake = Math.max(state.shake, 0.5); sound.thump(0.8); }
    if (e.kind === 'touch') { const k = clamp(e.sink / 3, 0.3, 1.5); sound.thump(k); if (e.vRel > 25) { fx.tyreSmoke(e.pos, env.surface(e.pos.x, e.pos.z).v, 1); sound.squeal(); } state.shake = Math.max(state.shake, 0.25 * k); }
    if (e.kind === 'touchdown' && e.sink > 5.2) flash('Hard landing: ' + e.sink.toFixed(1) + ' m/s sink', 4);
    if (e.kind === 'scrape') { fx.sparks(e.pos, ship.velocity); flash('Tail scrape!', 2); }
    if (e.kind === 'hookbounce') flash('Hook bounced off the deck', 2);
    if (e.kind === 'airborne' && ac.launchT < 8) { flash('Airborne off the ramp at ' + Math.round(e.ias * 3.6) + ' km/h. Positive climb: gear up (G), flaps up above 300 m (L).', 6); sound.say('Positive climb', 'climb', 20); }
    if (e.kind === 'stopped') { state.shake = 0.4; rumble(0.8, 1, 600); if (!instructor.active) setTimeout(showReport, 600); }
    if (e.kind === 'touch') rumble(0.3 * Math.min(e.sink / 3, 1.5), 0.6, 160);
    if (e.kind === 'crash') { flash(e.msg + '. Press Backspace to try again.', 999); sound.thump(2); rumble(1, 1, 700);
      // the aftermath: white water for a sea impact, a burning wreck on (or against) the carrier
      if (/sea|Ditched/i.test(e.msg)) fx.splash(ac.pos); else if (!/Structural|fire spread/.test(e.msg) || ac.pos.y < 60) fx.burn(ac.pos, ac.pos.distanceTo(ship.position) < 400 ? ship : null);
      if (!instructor.active) setTimeout(() => { if (ac.crashed) debrief.show({ title: 'Flight debrief', ok: false, why: e.msg }); }, 2500); }
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
  if (ac.onGround && ac.holdback && ac.inp.throttle > 0.9) {
    if (ac.fold > 0.05) say('Wings folded', 'cfgfold', 6);
    else if (ac.canopy > 0.05) say('Canopy open', 'cfgcan', 6);
    else if (ac.flap < 0.5) say('Flaps up', 'cfgflap', 8);
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
let beacon = 0;
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
  if (nodes.IFRProbe) nodes.IFRProbe.quaternion.copy(rest[nodes.IFRProbe.uuid]).multiply(tq.setFromAxisAngle(axY, ac.probe * 22 * D2R));
  // stick follows the pilot's input; the stick shaker rattles it near the AoA limit
  const shk = ac.shaker > 0 ? ac.shaker * 0.012 * Math.sin(time * 2 * Math.PI * 17) : 0;
  if (nodes.Stick) nodes.Stick.quaternion.copy(rest[nodes.Stick.uuid]).multiply(tq.setFromEuler(new THREE.Euler(-ac.inp.pitch * 0.25 + shk, 0, -ac.inp.roll * 0.25 + shk * 0.6)));
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
  for (const n of ['Beacon_Top', 'Beacon_Bot']) if (nodes[n]) nodes[n].visible = powered && ac.sw.beacon && (beacon % 1.2) < 0.12;
  for (const n of ['NavLight_L', 'NavLight_R', 'TailLight']) if (nodes[n]) nodes[n].visible = powered && ac.sw.navlt;
  for (const n of ['R77_R_33', 'R77_R_45', 'R73_R_52', 'R73_R_52_dome', 'R77_L_33', 'R77_L_45', 'R73_L_52', 'R73_L_52_dome']) if (nodes[n]) nodes[n].visible = ac.stores;
  if (navGlow) { const on = powered && ac.sw.navlt, bc = powered && ac.sw.beacon && (beacon % 1.2) < 0.12; navGlow.forEach((g, i) => { g.visible = i < 3 ? on : bc; }); }
  const inside = state.view === 'cockpit';
  for (const p of pilotNodes) p.visible = !inside;
}

// ------------------------------------------------------------------ cameras
const EYE = V3(0, 1.16, st2z(4.20));   // seat raised for carrier ops: about 14.5° over-nose view
let chaseSmooth = null;
function updateCamera(dt) {
  const inside = state.view === 'cockpit';
  if (state.lookTarget) {
    const L = state.lookTarget, k = Math.min(1, dt * 5);
    state.head.yaw += (L.yaw - state.head.yaw) * k; state.head.pitch += (L.pitch - state.head.pitch) * k;
    if (Math.abs(L.yaw - state.head.yaw) + Math.abs(L.pitch - state.head.pitch) < 0.01) state.lookTarget = null;
  }
  camera.near = inside ? 0.04 : 0.3;
  // shake: buffet near the AoA limit, touchdown/arrest jolts, deck rumble in afterburner
  const aoa = ac.t.alpha * R2D;
  const buffet = !ac.onGround ? clamp((aoa - 15) / 10, 0, 1) * clamp(ac.t.qbar / 15000, 0, 1) : 0;
  const rumble = ac.onGround ? Math.max(ac.AB[0], ac.AB[1]) * 0.25 + clamp(ac.t.V / 80, 0, 1) * 0.15 : 0;
  state.shake = Math.max(0, state.shake - dt * 1.6);
  const sh = (buffet * 0.5 + rumble * 0.3 + state.shake + ac.shaker * 0.35) * 0.012;
  // smooth band-limited noise (7-19 Hz) instead of per-frame random jumps, which read as screen flicker
  const tt = state.simTime;
  const nx = Math.sin(tt * 47.1) * 0.5 + Math.sin(tt * 73.7 + 1.3) * 0.3 + Math.sin(tt * 119.3 + 2.1) * 0.2;
  const ny = Math.sin(tt * 53.9 + 0.7) * 0.5 + Math.sin(tt * 88.1 + 2.9) * 0.3 + Math.sin(tt * 111.7 + 0.4) * 0.2;
  const jitter = V3(nx * sh * 0.5, ny * sh * 0.5, 0);
  if (inside) {
    // the pilot's head on its neck: a damped spring pushed by the body accelerations (launch shove, g, touchdown, trap)
    const H = state.head.dyn ||= { p: V3(), v: V3(), pitch: 0 };
    const f = ac.t.gVec, onStops = !!ac.holdback;
    const tgt = V3(clamp(-f.x * 0.012, -0.03, 0.03), clamp(-(f.y - 1) * 0.0095, -0.07, 0.035), clamp(-f.z * 0.026, -0.045, 0.055));
    if (onStops) tgt.set(0, 0, 0);
    const w = 2 * Math.PI * 2.1, z = 0.42;
    for (let k = 0, n = Math.max(1, Math.ceil(dt / 0.005)); k < n; k++) {
      const h = dt / n;
      H.v.addScaledVector(V3().subVectors(tgt, H.p).multiplyScalar(w * w).addScaledVector(H.v, -2 * z * w), h);
      H.p.addScaledVector(H.v, h);
    }
    // eyes drop with the head under g, and the head tips back under a longitudinal shove
    const nod = -H.p.y * 0.9 + H.p.z * 0.6;
    const p = EYE.clone().add(jitter).add(H.p);
    camera.position.copy(p).applyQuaternion(ac.quat).add(ac.pos);
    camera.quaternion.copy(ac.quat).multiply(yawPitchQuat(state.head.yaw + jitter.x * 2, state.head.pitch + jitter.y * 2 - nod));
    camera.fov += (state.fov - camera.fov) * Math.min(1, dt * 8);
  } else {
    camera.fov += (50 - camera.fov) * Math.min(1, dt * 4);
    const o = state.orbit;
    if (state.view === 'chase') {
      const off = V3(0, 0, o.dist).applyEuler(new THREE.Euler(-o.pitch, o.yaw - Math.PI, 0, 'YXZ'));
      // smooth the offset relative to the jet, not the world position: a world-space lag plus vel*dt
      // turns every frame-time wobble into a metre-scale camera jump at fighter speeds
      const want = off.applyQuaternion(ac.quat);
      chaseSmooth = chaseSmooth ? chaseSmooth.lerp(want, 1 - Math.exp(-dt * 6)) : want.clone();
      camera.position.copy(ac.pos).add(chaseSmooth).add(jitter.multiplyScalar(6));
      const upv = ac.t.upv ? V3(0, 1, 0).lerp(ac.t.upv, 0.35).normalize() : V3(0, 1, 0);
      camera.up.copy(upv);
      camera.lookAt(ac.pos.clone().addScaledVector(ac.t.upv || axY, 1.2));
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
function draw() {
  if (postfx.enabled) { postfx.render(); return; }
  renderer.render(scene, camera);
  fx.setDepth(null); renderer.autoClear = false; renderer.render(fx.fxScene, camera); renderer.autoClear = true;
}
// per-frame inputs for the post stack: cloud lighting from the time of day, cinematic depth of field
const _sc = new THREE.Color(), _top = new THREE.Color(), _bot = new THREE.Color();
function postUpdate(dt) {
  const n = tod.night || 0;
  // green water and spray: in a rough sea the deck runs wet, and so does a jet sitting on it
  const wet = Math.max(0, Math.min(1, (settings.sea - 0.9) / 0.9));
  ship.setWet(wet); acDetail.update(ac.onDeck ? wet * 0.8 : 0);
  // exhaust plumes for the heat haze: stronger and longer with power and reheat
  const plumes = [];
  if (model && !ac.crashed) for (let i = 0; i < 2; i++) {
    const e = ac.engines[i], N = e.N || 0, ab = e.AB || 0;
    const k = e.state === 'off' ? 0 : Math.max(0, N - 0.15) * (0.6 + 0.6 * ab);
    plumes.push({ o: model.localToWorld(V3(i ? 0.87 : -0.87, -0.45, st2z(15.4))), d: V3(0, 0, 1).applyQuaternion(model.quaternion), len: 10 + 22 * N * N + 14 * ab, k });
  }
  postfx.setPlumes(plumes, state.paused ? 0 : dt);
  // the haze lives in the lowest ~2 km: looking down from altitude the line of sight crosses less of it
  scene.fog.density = tod.fog[1] / (1 + Math.max(0, camera.position.y) / 1500);
  _sc.copy(sunLight.color).multiplyScalar(sunLight.intensity * (n > 0.9 ? 0.6 : 1.0));
  _top.set(n > 0.9 ? 0x0b1220 : n > 0.3 ? 0x6a6f8e : 0x8fb2dc).multiplyScalar(n > 0.9 ? 0.25 : 1.0);
  _bot.set(n > 0.9 ? 0x05070b : n > 0.3 ? 0x4a3c3c : 0x7d8894);
  const cine = state.replay || state.view === 'flyby';   // depth of field for cinematic views only, never while flying
  postfx.update(state.paused ? 0 : dt, { sun, sunCol: _sc, skyTop: _top, skyBot: _bot, fogCol: scene.fog.color, fogD: scene.fog.density, night: n,
    cover: n > 0.9 ? 0.38 : n > 0.3 ? 0.5 : 0.44, dof: cine ? 1 : 0, focus: camera.position.distanceTo(ac.pos), flare: n < 0.3 });
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  postfx.setSize(w, h);
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
  if (interp.apos.distanceToSquared(ac.pos) > 400 || ac.crashed || state.paused || state.replay) { interp.on = false; return; }
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
// capture mode (?capture): no real-time loop; a recorder steps frames with __sim.renderStep(dt) for film capture
const CAPTURE = new URLSearchParams(location.search).has('capture');
function frame(now) {
  if (!CAPTURE) requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1); last = now;
  const time = now / 1000;
  if (!model) { draw(); return; }
  if (!state.started) state.orbit.yaw += dt * 0.08;
  const live = !state.paused && !state.replay;
  if (state.replay) replay.update(state.paused ? 0 : dt);
  if (state.paused || !state.started) { bindings.poll(); if (state.started && navigator.getGamepads && !bindings.capture) for (const gp of navigator.getGamepads()) if (gp && bindings.read(gp).pressed.pause) pause(false); }
  if (live && !ac.crashed) {
    readInputs(dt);
    physics(dt);
    if (tanker.active) tanker.update(dt, ac, probeTipWorld(), sound, flash);
    const jbdT = ac.holdback || (ac.onGround && scenario !== 'approach' && ac.launchT < 3) ? 40 * D2R : 90 * D2R;
    const ji = scenario === 'short' ? 1 : 0;
    ship.jbd[ji].rotation.x += (jbdT - ship.jbd[ji].rotation.x) * Math.min(1, dt * 1.5);
  }
  beginInterp();
  env.groundUnder = env.surface(ac.pos.x, ac.pos.z).h;
  const eyeW = EYE.clone().applyQuaternion(ac.quat).add(ac.pos);
  const lens = ac.pos.distanceTo(ship.position) < 9000 ? ship.updateLens(eyeW, ops.waveOff, time) : null;
  env.lens = lens;
  if (live) ops.update(dt, ac, lens);
  handleEvents();
  if (live && state.started) {
    recorder.sample(dt, state.simTime, ac, ship, lens);
    if (ops.waveOff && !state.woEdge) recorder.event(state.simTime, 'waveoff', 'Waved off by the LSO', 'mistake');
    if (ops.bolter && !state.bolEdge) recorder.event(state.simTime, 'bolter', 'Bolter: missed the wires', 'mistake');
    state.woEdge = ops.waveOff; state.bolEdge = ops.bolter;
    if (ac.shaker > 0.05 && (state.rumT = (state.rumT || 0) - dt) <= 0) { state.rumT = 0.12; rumble(0.6 * ac.shaker, 0.2 * ac.shaker, 130); }
  }
  instructor.update(live ? dt : 0);
  voiceWarnings(dt);
  updateChecklist();
  if (state.msgT > 0 && state.msgT < 900) { state.msgT -= dt; if (state.msgT <= 0) $('msg').hidden = true; }
  animateModel(dt, time);
  fx.update(state.paused ? 0 : dt, ac, model, env, { ship, sea: settings.sea });
  sunLight.position.copy(ac.pos).addScaledVector(sun, 250); sunLight.target.position.copy(ac.pos);
  water.update(dt, camera, ship);   // the sea keeps moving behind the menu and the pause screen
  // night sky follows the camera; landing light on with the gear down
  night.stars.position.copy(camera.position);
  night.moon.position.copy(camera.position).addScaledVector(sun, 80000);
  // lights left at zero intensity still cost a shading pass per material: switch them off entirely when unused
  if (landingLight) { landingLight.intensity = ac.sw.ldglt && ac.gear > 0.9 && ac.power() !== 'none' ? 60000 : 0; landingLight.visible = landingLight.intensity > 0; }
  ckFlood.visible = ckFlood.intensity > 0 && state.view === 'cockpit';
  updateCamera(dt);
  postUpdate(dt);
  // film capture: a shot script can take over the camera after the normal camera logic
  if (CAPTURE && window.__camHook) { window.__camHook(camera, dt); camera.updateProjectionMatrix(); camera.updateMatrixWorld(); }
  if (cockpitReady) cockpit.update(dt, { inside: state.view === 'cockpit', headYaw: state.head.yaw, headPitch: state.head.pitch,
    throttleMoving: !!(keys.ShiftLeft || keys.ShiftRight || keys.KeyR || keys.KeyF || keys.Equal || keys.Minus) });
  // HUD in the cockpit, clipped to the combiner
  const inside = state.view === 'cockpit';
  const envHud = { ...env, shipVelocity: ship.velocity, waveOff: ops.waveOff, mouseStick: settings.mouseStick ? mouse : null,
    tanker: tanker.active ? { range: tanker.range, closure: tanker.closure, contact: tanker.contact, state: tanker.state, transfer: tanker.transfer, pushIn: tanker.pushIn } : null };
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
  // g tolerance builds with time: grey-out creeps in over a few seconds of sustained g, clears faster
  const gIn = ac.crashed ? 1 : ac.t.nz;
  state.gEff = (state.gEff ?? 1) + (gIn - (state.gEff ?? 1)) * Math.min(1, dt / (gIn > (state.gEff ?? 1) ? 2.8 : 1.2));
  const grey = clamp((state.gEff - 5.8) / 3.2, 0, 0.92), red = clamp((-state.gEff - 1.8) / 1.8, 0, 0.7);
  const vg = $('vignette');
  vg.style.opacity = inside ? Math.max(grey, red) : 0;
  vg.classList.toggle('red', red > grey);
  canvas.style.filter = inside && grey > 0.05 ? `grayscale(${Math.min(1, grey * 1.3).toFixed(2)}) brightness(${(1 - grey * 0.35).toFixed(2)})` : '';
  $('stickmark').hidden = !(settings.mouseStick && state.started && !state.paused);
  if (settings.mouseStick) { const sm = $('stickmark'); sm.style.left = (mouse.x * 100) + '%'; sm.style.top = (mouse.y * 100) + '%'; }
  sound.update(ac, inside, state.paused);
  draw();
  endInterp();
}
window.__sim = { postfx, water, renderStep(dt) { frame(last + dt * 1000); }, get renderer() { return renderer; }, get model() { return model; }, fx, tod: () => tod, keys, probeTipWorld, ac, state, ship, env, camera, nodes, hud, ops, settings, cockpit, instructor, recorder, replay, debrief, tanker, bindings, control, startLesson, startScenario, applyTimeOfDay, lookAtControl, get ready() { return cockpitReady && tanker.ready; },
  // run the whole sim without rendering (for tests): physics, carrier ops, events, instructor, recorder, tanker
  tick(secs, ctl) {
    const h = 1 / 60, n = Math.round(secs / h);
    for (let i = 0; i < n && !ac.crashed; i++) {
      ctl && ctl(ac, i * h);
      physics(h);
      if (tanker.active) tanker.update(h, ac, probeTipWorld(), sound, flash);
      const eyeW = EYE.clone().applyQuaternion(ac.quat).add(ac.pos);
      env.lens = ac.pos.distanceTo(ship.position) < 9000 ? ship.updateLens(eyeW, ops.waveOff, 0) : null;
      ops.update(h, ac, env.lens); handleEvents(); updateChecklist();
      recorder.sample(h, state.simTime, ac, ship, env.lens);
      if (ops.waveOff && !state.woEdge) recorder.event(state.simTime, 'waveoff', 'Waved off by the LSO', 'mistake');
      if (ops.bolter && !state.bolEdge) recorder.event(state.simTime, 'bolter', 'Bolter: missed the wires', 'mistake');
      state.woEdge = ops.waveOff; state.bolEdge = ops.bolter;
      if (cockpitReady) cockpit.update(h, { inside: state.view === 'cockpit', headYaw: state.head.yaw, headPitch: state.head.pitch });
      instructor.update(h);
      model.position.copy(ac.pos); model.quaternion.copy(ac.quat);
    }
    return ac.t;
  },
  advance(secs, ctl) { const n = Math.round(secs / DT); for (let i = 0; i < n && !ac.crashed; i++) { ctl && ctl(ac, i * DT); ship.update(DT); ac.step(DT, env); ops.checkWires(ac); state.simTime += DT; } return ac.t; } };
if (CAPTURE) { document.documentElement.classList.add('capture'); last = 0; setInterval(() => { if (!model) frame(last + 16); }, 50); }
else requestAnimationFrame(frame);
camera.position.set(-60, 40, 120); camera.lookAt(0, 20, 40);
$('resume').hidden = true;
