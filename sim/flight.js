// MiG-29K flight dynamics and aircraft systems.
// 6-DOF rigid body with tabulated aerodynamics (incl. LERX vortex lift, ground effect, high-AoA departure
// characteristics), two RD-33MK engines with start sequence / spool dynamics / EGT / afterburner / take-off
// emergency rating, GTDE-117 APU, electrics, hydraulics, KSU-941-style fly-by-wire (normal, landing, direct),
// operating limits with damage, landing gear with oleo struts, brakes, nose-wheel steering, tail hook dynamics
// and arresting gear.
import * as THREE from 'three';

const D2R = Math.PI / 180, R2D = 180 / Math.PI, G0 = 9.80665;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const approach = (cur, tgt, rate) => cur + clamp(tgt - cur, -rate, rate);

function tab(t, x) {
  if (x <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (x <= t[i][0]) { const [x0, y0] = t[i - 1], [x1, y1] = t[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  }
  return t[t.length - 1][1];
}

// ---------------------------------------------------------------- atmosphere (ISA)
export function atmosphere(h) {
  h = Math.max(h, -500);
  let T, p;
  if (h < 11000) { T = 288.15 - 0.0065 * h; p = 101325 * Math.pow(T / 288.15, 5.2559); }
  else { T = 216.65; p = 22632 * Math.exp(-(h - 11000) / 6341.6); }
  const rho = p / (287.05 * T);
  return { T, p, rho, a: Math.sqrt(1.4 * 287.05 * T), sigma: rho / 1.225 };
}

// ---------------------------------------------------------------- aircraft data
export const DATA = {
  S: 42.0, b: 11.99, c: 3.9,
  emptyMass: 12700, pilotEtc: 250, fuelMax: 4460,
  storesMass: 910,             // 2x R-73, 4x RVV-AE
  I: { roll: 22000, pitch: 108000, yaw: 124000 },
  engine: { dry: 53000, ab: 88300, idleFrac: 0.055, chr: 1.045 },   // N per engine SL static; ЧР take-off rating
  sfcDry: 2.18e-5, sfcAB: 5.75e-5,
  N_IDLE: 0.70, N_MIL: 1.0,
  alphaLimit: 26 * D2R, alphaLimitLanding: 20 * D2R, nMax: 8.0, nMin: -3.0, nMaxStores: 7.0, nMaxLanding: 4.0,
  pMax: 240 * D2R,
  surf: { stabUp: 30 * D2R, stabDn: 15 * D2R, stabDiff: 10 * D2R, ail: 25 * D2R, rud: 25 * D2R, flap: 25 * D2R, droop: 12 * D2R },
  // operating limits (IAS in m/s)
  vGear: 500 / 3.6, vGearDamage: 600 / 3.6, vFlaps: 400 / 3.6, vCanopy: 60 / 3.6, vCanopyLoss: 230 / 3.6,
  vMaxIAS: 1500 / 3.6, vHook: 550 / 3.6, nOverstress: 9.0, nFailure: 11.5,
  hookMaxSpeedEngage: 290 / 3.6,
};

const CL_TAB = [[-90, 0], [-40, -0.75], [-20, -1.0], [-15, -0.9], [0, 0.05], [10, 0.66], [18, 1.16], [24, 1.48],
  [28, 1.62], [32, 1.58], [40, 1.30], [50, 1.05], [60, 0.85], [75, 0.45], [90, 0], [180, 0]];
const CLA_MACH = [[0, 1.0], [0.6, 1.08], [0.9, 1.28], [1.05, 1.18], [1.3, 0.95], [1.6, 0.8], [2.2, 0.62]];
const CD0_MACH = [[0, 0.0205], [0.7, 0.0208], [0.85, 0.0225], [0.95, 0.031], [1.05, 0.047], [1.2, 0.053], [1.5, 0.050], [2.0, 0.047], [2.5, 0.046]];
const K_MACH = [[0, 0.118], [0.8, 0.122], [1.0, 0.16], [1.5, 0.23], [2.0, 0.30]];
const CMA_MACH = [[0, -0.10], [0.8, -0.14], [1.0, -0.35], [1.2, -0.55], [2.0, -0.45]];
const CNB_MACH = [[0, 0.115], [0.9, 0.12], [1.2, 0.10], [2.0, 0.065]];

// ---------------------------------------------------------------- RD-33MK engine
class Engine {
  constructor(side) {
    this.side = side; this.i = side < 0 ? 0 : 1; this.state = 'off'; this.N = 0; this.AB = 0; this.egt = 25; this.T = 0; this.ff = 0;
    this.startT = 0; this.lit = false; this.chr = false; this.damaged = false; this.hotT = 0;
  }
  get name() { return this.side < 0 ? 'Left' : 'Right'; }
  running() { return this.state === 'running'; }
  update(dt, ac, thr, M, sigma, Vias, air) {
    const idle = DATA.N_IDLE;
    // fuel reaches the engine through its master (shut-off) valve; the boost pump gives the start pressure
    const master = ac.sw.eng[this.i];
    const fuel = ac.fuel > 0 && !this.cut && master && !ac.fail.eng[this.i];
    if (this.state === 'starting') {
      this.startT += dt;
      const bleed = ac.apu.state === 'running' || ac.groundAir;
      const airstart = air && Vias > 90;          // windmilling relight in flight
      if (!master) { this.state = 'off'; this.lit = false; ac.msg(this.name + ' engine start aborted: master OFF', 3); ac.event('startabort', { i: this.i }); }
      else if (!bleed && !airstart && this.N < 0.45) { this.state = 'off'; this.lit = false; ac.msg('Engine start aborted: no APU air', 3); ac.event('startabort', { i: this.i }); }
      // starter spins the core to ~25%, ignition near 18%, self-sustaining above ~45%, idle ~70%
      const target = this.N < 0.25 ? 0.26 : idle;
      const rate = this.N < 0.25 ? (airstart && !bleed ? 0.012 : 0.022) : (this.lit ? 0.018 + 0.03 * (this.N - 0.25) : 0.004);
      this.N = Math.min(this.N + rate * dt, target + 0.001);
      const pressure = ac.sw.pump || air;
      if (!this.lit && this.N > 0.18 && fuel && pressure) { this.lit = true; ac.event('lightoff', { i: this.i }); }
      if (this.lit) {
        // throttle forward during a ground start over-fuels the engine: a hot start (in flight the start fuel control meters it)
        const over = thr > 0.12 && !air;
        this.egt = approach(this.egt, over ? 1020 : this.N < 0.5 ? 640 : 460, (over ? 170 : 90) * dt);
        if (this.egt > 870) {
          if (this.hotT === 0) { ac.msg('HOT START: ' + this.name + ' T4 over 870°C! Throttle IDLE and engine master OFF now', 4); ac.event('hotstart', { i: this.i }); }
          this.hotT += dt;
          if (this.hotT > 2.5) { this.damaged = true; this.state = 'off'; this.lit = false; ac.msg(this.name + ' engine damaged by over-temperature (turbine overheated)', 6); ac.event('mistake', { what: 'Hot start: throttle advanced during the engine start', i: this.i }); }
        } else this.hotT = Math.max(0, this.hotT - dt);
      } else this.egt = approach(this.egt, 40, 20 * dt);
      if (this.state === 'starting' && this.N >= idle - 0.002) { this.state = 'running'; this.N = idle; this.hotT = 0; ac.msg(this.name + ' engine at idle', 2.5); ac.event('engidle', { i: this.i }); }
      if (this.state === 'starting' && !this.lit && this.startT > 30) {
        this.state = 'off'; ac.msg('No light-off on the ' + this.name.toLowerCase() + ' engine: ' + (!ac.sw.pump && !air ? 'no fuel pressure (fuel pump OFF)' : 'no fuel'), 4);
        ac.event('mistake', { what: 'Engine start without fuel pressure (fuel pump off)', i: this.i });
      }
      if (this.state === 'starting' && this.startT > 90) { this.state = 'off'; ac.msg('Hung start', 3); }
    } else if (this.state === 'running') {
      if (!fuel) { this.state = 'off'; this.lit = false; ac.msg(this.name + (master ? ' engine flame-out' : ' engine shut down'), 4); ac.event(master ? 'flameout' : 'engoff', { i: this.i }); }
      const milCmd = clamp(thr / 0.85, 0, 1);
      const target = idle + (DATA.N_MIL - idle) * milCmd;
      const k = target > this.N ? 1.9 : 1.6;
      this.N += clamp((target - this.N) * k * dt, -0.16 * dt, 0.13 * dt);
    } else {
      // off: windmilling in the air, spool down on the ground
      const wm = air ? clamp(Vias / 250, 0, 1) * 0.28 : 0;
      this.AB = approach(this.AB, 0, 3 * dt);
      this.N = approach(this.N, wm, 0.03 * dt);
      this.lit = false;
      this.egt = approach(this.egt, 25, 6 * dt);
    }
    // afterburner: needs full MIL rpm
    const abCmd = thr > 0.86 ? (thr - 0.86) / 0.14 : 0;
    const abTarget = (this.running() && this.N > 0.975 && abCmd > 0) ? 0.3 + 0.7 * abCmd : 0;
    this.AB = approach(this.AB, abTarget, (abTarget > this.AB ? 1.1 : 1.8) * dt);
    // thrust
    const e = DATA.engine;
    const nf = this.state === 'off' ? 0 : clamp((this.N - idle) / (DATA.N_MIL - idle), 0, 1);
    const dryF = 1 - 0.16 * M + 0.20 * M * M;
    const abF = 1 + 0.26 * M + 0.24 * M * M - 0.4 * Math.max(M - 2.0, 0);
    const lapse = Math.pow(sigma, 0.78);
    let T = 0;
    if (this.state !== 'off') {
      const f = this.state === 'starting' ? Math.max(0, (this.N - 0.45) / (idle - 0.45)) * e.idleFrac : e.idleFrac + (1 - e.idleFrac) * Math.pow(nf, 1.7);
      T = e.dry * f * dryF * lapse;
      if (this.AB > 0.01) T += (e.ab * abF - e.dry * dryF) * lapse * this.AB;
      this.chr = !!(ac.holdback || ac.launchT < 6) && this.AB > 0.95 && ac.onDeck;
      if (this.chr) T *= e.chr;
    } else this.chr = false;
    this.T = T;
    this.ff = this.state === 'off' ? 0 : Math.max(T, 1200) * (this.AB > 0.01 ? lerp(DATA.sfcDry, DATA.sfcAB, this.AB) : DATA.sfcDry) * (0.65 + 0.35 * nf);
    if (this.state === 'running') {
      const egtT = 440 + 330 * Math.pow(nf, 1.6) + 60 * this.AB + 25 * M + (ac.fail.fire[this.i] ? 260 : 0);
      this.egt = approach(this.egt, egtT, 120 * dt);
    }
    return T;
  }
}

export class Aircraft {
  constructor() {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.omega = new THREE.Vector3();   // body rates, model axes (x right, y up, z aft)
    this.fuel = DATA.fuelMax * 0.9;
    this.stores = true;
    this.inp = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: 0 };
    // configuration
    this.gearCmd = 1; this.gear = 1;
    this.flapCmd = 0; this.flap = 0;
    this.brakeCmd = 0; this.airbrake = 0;
    this.hookCmd = 0; this.hook = 0; this.hookAng = 0; this.hookBounce = 0; this.hookOnDeck = false;
    this.canopyCmd = 0; this.canopy = 0; this.canopyLost = false;
    this.foldCmd = 0; this.fold = 0;
    this.parkBrake = false; this.nws = true;
    // systems
    this.battery = true; this.batCharge = 1; this.apu = { state: 'off', N: 0, t: 0 }; this.groundAir = false;
    // cockpit switches (the start panel on the left wall, lights on the right panel)
    this.sw = { pump: true, apu: false, eng: [true, true], gen: [true, true], navlt: true, beacon: true, ldglt: false };
    this.probeCmd = 0; this.probe = 0;
    // failures: engine flame-out, engine fire, flight-control computer ('transient' resets, 'hard' does not), hydraulic systems
    this.fail = { eng: [false, false], fire: [false, false], fireT: [0, 0], fireOffT: [0, 0], fcs: false, hyd: [false, false] };
    this.tyresBurst = false; this.shaker = 0;
    this.engines = [new Engine(-1), new Engine(1)];
    this.fbwMode = 'normal';   // 'normal' | 'direct'
    this.fbwBit = 1;           // 0..1 self-test progress (1 = passed)
    this.fbwReady = true;
    this.damage = { gear: false, flaps: false, overstress: 0, canopy: false };
    this.maxG = 0;
    // surfaces (rad)
    this.dE = 0; this.dD = 0; this.dA = 0; this.dR = 0; this.slat = 0;
    this.onGround = false; this.onDeck = false; this.wow = [false, false, false];
    this.holdback = null; this.launchT = 99;
    this.arrest = null;
    this.crashed = null;
    this.events = [];          // transient events for the UI (touchdown, trap, ...)
    this.t = { alpha: 0, beta: 0, V: 0, M: 0, qbar: 0, nz: 1, ias: 0, gVec: new THREE.Vector3(), vs: 0, gamma: 0, heightAGL: 999 };
    this.gammaRef = null; this.stickFree = 0;
    this._msgQ = [];
    this.wheels = [
      { name: 'nose', p: new THREE.Vector3(0, -1.575, -3.03), vis: 0.12, r: 0.285, k: 520000, c: 45000, travel: 0.42, steer: true, brake: false, mu: 0.8 },
      { name: 'mainL', p: new THREE.Vector3(-1.56, -1.54, 0.92), vis: 0.22, r: 0.42, k: 600000, c: 70000, travel: 0.48, steer: false, brake: true, mu: 0.8 },
      { name: 'mainR', p: new THREE.Vector3(1.56, -1.54, 0.92), vis: 0.22, r: 0.42, k: 600000, c: 70000, travel: 0.48, steer: false, brake: true, mu: 0.8 },
    ];
    for (const w of this.wheels) { w.comp = 0; w.spin = 0; w.load = 0; w.contact = false; }
    this.hardPoints = [
      [new THREE.Vector3(0, 0, -9.3), 0.05], [new THREE.Vector3(0, -0.2, 6.9), 0.35], [new THREE.Vector3(-6.0, -0.1, 2.2), 0.05], [new THREE.Vector3(6.0, -0.1, 2.2), 0.05],
      [new THREE.Vector3(0, -0.85, 1.0), 0.05], [new THREE.Vector3(-0.87, -0.85, 6.0), 0.35], [new THREE.Vector3(0.87, -0.85, 6.0), 0.35], [new THREE.Vector3(0, -0.5, -4.5), 0.05],
      [new THREE.Vector3(-1.8, 3.0, 5.9), 0.05], [new THREE.Vector3(1.8, 3.0, 5.9), 0.05]];
    this.scrape = 0;
    this.hookPivot = new THREE.Vector3(0, -0.30, 3.90);
    this.hookLen = 2.52;
  }

  get N() { return [this.engines[0].N, this.engines[1].N]; }
  get AB() { return [this.engines[0].AB, this.engines[1].AB]; }
  get thrust() { return [this.engines[0].T, this.engines[1].T]; }
  get fbw() { return this.fbwMode === 'normal'; }
  set fbw(v) { this.fbwMode = v ? 'normal' : 'direct'; }
  get mass() { return DATA.emptyMass + DATA.pilotEtc + this.fuel + (this.stores ? DATA.storesMass : 0); }
  msg(text, secs = 3) { this._msgQ.push([text, secs]); }
  event(kind, data = {}) { this.events.push({ kind, ...data }); }

  // electrical power available: 'gen' | 'apu' | 'bat' | 'none'
  power() {
    if (this.engines.some((e, i) => e.running() && e.N > 0.6 && this.sw.gen[i])) return 'gen';
    if (this.apu.state === 'running') return 'apu';
    return this.battery && this.batCharge > 0 ? 'bat' : 'none';
  }
  genOnline(i) { return this.engines[i].running() && this.engines[i].N > 0.6 && this.sw.gen[i]; }
  // both hydraulic systems are driven from the accessory gearbox (either engine); a failed system halves actuator rate
  hydSys(i) { return this.fail.hyd[i] ? 0 : clamp(Math.max(this.engines[0].N, this.engines[1].N) / 0.55, 0, 1); }
  hydraulics() { return (this.hydSys(0) + this.hydSys(1)) / 2; }

  setEnginesRunning() {
    for (const e of this.engines) { e.state = 'running'; e.N = DATA.N_IDLE; e.egt = 440; e.lit = true; }
    this.apu.state = 'off'; this.fbwBit = 1; this.fbwReady = true; this.battery = true; this.batCharge = 1;
    Object.assign(this.sw, { pump: true, apu: false, eng: [true, true], gen: [true, true], navlt: true, beacon: true });
  }
  coldAndDark() {
    for (const e of this.engines) { e.state = 'off'; e.N = 0; e.egt = 28; e.lit = false; }
    this.battery = false; this.apu = { state: 'off', N: 0, t: 0 }; this.fbwBit = 0; this.fbwReady = false;
    Object.assign(this.sw, { pump: false, apu: false, eng: [false, false], gen: [false, false], navlt: false, beacon: false, ldglt: false });
    this.canopyCmd = this.canopy = 1; this.inp.throttle = 0;
  }
  setBattery(on) {
    this.battery = on;
    if (!on && this.apu.state !== 'off' && this.power() !== 'gen') { this.apu.state = 'off'; this.msg('APU shut down: no battery', 2.5); }
    this.event('switch', { sw: 'bat', on });
  }
  // APU master switch: ON starts the GTDE-117 and keeps it running until switched OFF
  setApu(on) {
    this.sw.apu = on;
    this.event('switch', { sw: 'apu', on });
    if (!on) { if (this.apu.state !== 'off') { this.apu.state = 'off'; this.msg('APU off', 2); } return; }
    if (!this.battery || this.batCharge <= 0.05) { this.msg('APU needs battery power: battery ON first', 3); return; }
    if (this.apu.state !== 'off') return;
    this.apu.state = 'starting'; this.apu.t = 0; this.msg('APU start', 2);
  }
  startApu() { this.setApu(!this.sw.apu); }
  setEngineMaster(i, on) {
    this.sw.eng[i] = on; this.event('switch', { sw: 'eng', i, on });
    if (!on && this.fail.fire[i]) this.msg((i ? 'Right' : 'Left') + ' engine fuel shut off: fire extinguisher discharged', 3);
  }
  setGen(i, on) { this.sw.gen[i] = on; this.event('switch', { sw: 'gen', i, on }); }
  setPump(on) { this.sw.pump = on; this.event('switch', { sw: 'pump', on }); }
  startEngine(i) {
    const e = this.engines[i];
    if (e.state !== 'off') return false;
    const air = !this.onGround;
    if (e.damaged) { this.msg(e.name + ' engine is damaged: it will not start', 3); return false; }
    if (!this.sw.eng[i]) { this.msg(e.name + ' engine master is OFF: no fuel to the engine. Switch it ON first', 3.5); this.event('mistake', { what: 'Start button pressed with the engine master OFF' }); return false; }
    if (!air && this.apu.state !== 'running' && !this.groundAir) { this.msg('Engine start needs APU air: start the APU first and wait for on-speed', 3.5); this.event('mistake', { what: 'Engine start attempted before the APU was on speed' }); return false; }
    if (air && this.t.ias < 90 && this.apu.state !== 'running') { this.msg('Airstart needs more than 330 km/h to windmill the engine', 3); return false; }
    if (!air && this.inp.throttle > 0.05) { this.msg('Throttle must be at IDLE for engine start', 3); return false; }
    e.state = 'starting'; e.startT = 0; e.lit = false; e.hotT = 0;
    this.msg(e.name + ' engine start', 2.5); this.event('startbtn', { i });
    return true;
  }
  shutdown() { for (let i = 0; i < 2; i++) this.sw.eng[i] = false; this.msg('Engine masters OFF: engines shutting down', 2.5); }
  // failure injection (emergency training)
  failEngine(i) { this.fail.eng[i] = true; this.event('fail', { what: 'eng', i }); }
  fireEngine(i) { this.fail.fire[i] = true; this.fail.fireT[i] = 0; this.event('fail', { what: 'fire', i }); }
  failFcs(kind = 'transient') { this.fail.fcs = kind; this.event('fail', { what: 'fcs' }); }
  failHyd(i) { this.fail.hyd[i] = true; this.event('fail', { what: 'hyd', i }); }
  fcsReset() {
    if (!this.fail.fcs) { this.msg('FCS reset: no fault', 2); return; }
    if (this.fail.fcs === 'transient') { this.fail.fcs = false; this.msg('FCS reset: normal law restored', 3); this.event('fcsrestored'); }
    else this.msg('FCS reset failed: fault persists, stay in DIRECT law and land', 3.5);
  }

  updateSystems(dt, air, Vias) {
    // APU (GTDE-117): ~18 s to on-speed; auto shut-down once both engines are running
    const apu = this.apu;
    if (apu.state === 'starting') { apu.t += dt; apu.N = Math.min(1, apu.t / 18); if (apu.N >= 1) { apu.state = 'running'; this.msg('APU on speed', 2); } }
    else if (apu.state === 'running') apu.N = 1;
    else apu.N = approach(apu.N, 0, dt / 6);
    // battery: about 15 minutes on its own, recharged by the generators
    const pw0 = this.power();
    if (pw0 === 'bat') this.batCharge = Math.max(0, this.batCharge - dt / 900 - (apu.state === 'starting' ? dt / 300 : 0));
    else if (pw0 === 'gen' && this.battery) this.batCharge = Math.min(1, this.batCharge + dt / 300);
    // engine fire: extinguished a few seconds after the fuel is shut off, otherwise it spreads
    for (let i = 0; i < 2; i++) {
      if (!this.fail.fire[i]) continue;
      this.fail.fireT[i] += dt;
      if (!this.sw.eng[i] && this.engines[i].N < 0.5) { if ((this.fail.fireOffT[i] += dt) > 3) { this.fail.fire[i] = false; this.fail.fireOffT[i] = 0; this.msg('Fire out', 3); this.event('fireout', { i }); } }
      else if (this.fail.fireT[i] > 45) { this.crash('Engine fire spread through the airframe'); return; }
    }
    // retractable refuelling probe (3 s), hydraulic
    this.probe += clamp(this.probeCmd - this.probe, -dt / 3 * Math.max(this.hydraulics(), 0.1), dt / 3 * Math.max(this.hydraulics(), 0.1));
    // FBW built-in test once hydraulics and generators are up
    const hyd = this.hydraulics(), pw = this.power();
    if (!this.fbwReady) {
      if (hyd > 0.95 && pw === 'gen') { this.fbwBit += dt / 9; if (this.fbwBit >= 1) { this.fbwBit = 1; this.fbwReady = true; this.msg('FBW self-test passed', 2.5); this.event('bit'); } }
    }
    // actuators need hydraulic pressure
    const h = Math.max(hyd, this.onGround ? 0 : 0.15);
    // landing gear (6 s), with WOW interlock and damage
    if (this.damage.gear) this.gearCmd = this.gear > 0.5 ? 1 : this.gearCmd;
    this.gear += clamp(this.gearCmd - this.gear, -dt / 6 * h, dt / 6 * h);
    if (this.gear > 0.02 && Vias > DATA.vGearDamage && !this.damage.gear) { this.damage.gear = true; this.msg('Gear doors torn off: landing gear overspeed', 5); this.event('warn', { v: 'overspeed' }); }
    // flaps with auto-retraction above the limit speed
    if (Vias > DATA.vFlaps && this.flapCmd > 0 && air) { this.flapCmd = 0; this.msg('Flaps blown up: above 400 km/h', 3); }
    this.flap += clamp(this.flapCmd - this.flap, -dt / 5 * h, dt / 5 * h);
    // speed brake: not with gear down (retracts automatically)
    const sbCmd = this.brakeCmd && this.gear < 0.5 ? 1 : 0;
    this.airbrake += clamp(sbCmd - this.airbrake, -dt / 2 * h, dt / 3 * h);
    // canopy: electro-hydraulic, only below 60 km/h; lost if open at speed
    if (this.canopyCmd && Vias > DATA.vCanopy && this.canopy < 0.05) this.canopyCmd = 0;
    this.canopy += clamp(this.canopyCmd - this.canopy, -dt / 4, dt / 4);
    if (this.canopy > 0.1 && Vias > DATA.vCanopyLoss && !this.canopyLost) { this.canopyLost = true; this.canopy = 0; this.msg('Canopy torn off!', 6); this.event('warn', { v: 'canopy' }); }
    // wing fold: hydraulic, only on deck with low speed
    const foldOk = this.onGround && (this.vDeckRel || 0) < 6;
    if (foldOk) this.fold += clamp(this.foldCmd - this.fold, -dt / 14 * h, dt / 14 * h);
  }

  // --------------------------------------------------------- aerodynamic coefficients
  coeffs(a, b, M, p, q, r, V, dE, dD, dA, dR, hAGL = 999) {
    const ad = a * R2D;
    const flap = this.flap;
    const mf = tab(CLA_MACH, M);
    const clBase = tab(CL_TAB, ad);
    const buffetCap = 1.62 * (1 - 0.40 * clamp((M - 0.55) / 0.7, 0, 1));
    let CL = Math.abs(ad) < 18 ? clBase * mf : Math.sign(clBase) * Math.min(Math.abs(clBase) * lerp(mf, 1, clamp((Math.abs(ad) - 18) / 10, 0, 1)), buffetCap);
    const droop = flap * DATA.surf.droop / DATA.surf.ail;   // flaperon droop in landing configuration
    CL += (0.48 * flap + 0.06 * droop) * (ad < 26 ? 1 : 0.3) + 0.45 * dE + 0.08 * this.slat;
    // wings folded: outer panels carry no lift
    if (this.fold > 0.05) CL *= 1 - 0.45 * this.fold;
    // ground effect (within one span of the surface)
    const ge = clamp(1 - hAGL / DATA.b, 0, 1);
    CL *= 1 + 0.12 * ge * ge;
    const cd0 = tab(CD0_MACH, M) + (this.stores ? 0.0065 : 0) + 0.024 * this.gear * (this.damage.gear ? 1.6 : 1) + 0.052 * this.airbrake
      + 0.038 * flap + 0.0015 * this.hook + 0.012 * this.canopy + (this.canopyLost ? 0.018 : 0) + 0.004 * this.fold + 0.002 * this.probe;
    let K = tab(K_MACH, M);
    const hb = Math.max(hAGL, 0.5) / DATA.b * 16;
    K *= ge > 0 ? (hb * hb) / (1 + hb * hb) * 0.4 + 0.6 : 1;
    const cdLow = cd0 + K * CL * CL;
    const sa = Math.sin(a);
    const cdHigh = cd0 + 1.35 * sa * sa + 0.05;
    const bl = clamp((Math.abs(ad) - 20) / 15, 0, 1);
    const CD = lerp(cdLow, Math.max(cdHigh, cdLow), bl) + 0.35 * b * b;
    const CY = -0.95 * b + 0.30 * dR;
    const Vs = Math.max(V, 20);
    const qh = q * DATA.c / (2 * Vs), ph = p * DATA.b / (2 * Vs), rh = r * DATA.b / (2 * Vs);
    const cma = tab(CMA_MACH, M);
    let Cm = 0.012 + cma * a - 0.05 * flap + 0.95 * dE - 4.6 * qh + 0.005 * this.gear - 0.01 * this.airbrake;
    if (ad > 30) Cm -= 0.55 * (a - 30 * D2R);
    if (ad < -15) Cm += 0.4 * (-15 * D2R - a);
    const clb = -0.06 - 0.10 * Math.sin(clamp(a, 0, 0.8));
    // roll damping degrades past the stall (wing rock / autorotation tendency in direct law)
    const clp = -0.30 * (1 - 0.8 * clamp((ad - 24) / 12, 0, 1));
    const Cl = clb * b + 0.10 * dA + 0.09 * dD + 0.012 * dR + clp * ph + 0.09 * rh * (0.5 + CL);
    const cnb = tab(CNB_MACH, M) * (1 - clamp((ad - 22) / 16, 0, 1.25)) * (this.fold > 0.5 ? 0.8 : 1);
    const Cn = cnb * b + 0.095 * dR - 0.006 * dA - 0.30 * rh - 0.04 * ph;
    return { CL, CD, CY, Cm, Cl, Cn };
  }

  // --------------------------------------------------------- fly-by-wire (KSU-941 style)
  fbwLaw(dt, st) {
    const { a, b, M, V, qbar, p, q, r, theta, phi, gamma, onGround, hAGL } = st;
    const I = this.inertia();
    const S = DATA.S, B = DATA.b, C = DATA.c;
    const inp = this.inp;
    const Vs = Math.max(V, 30);
    const hyd = this.hydraulics();
    let dE, dA, dD, dR;
    const landing = this.gear > 0.5 && !onGround;
    const direct = this.fbwMode === 'direct' || !this.fbwReady || !!this.fail.fcs || this.power() === 'none' || this.power() === 'bat';
    this.lawName = onGround ? 'GROUND' : direct ? 'DIRECT' : landing ? 'LANDING' : 'NORMAL';
    // stick shaker: 3 degrees before the AoA limit of the active law (DIRECT has no limiter: warn from 20 degrees)
    const aWarn = (direct ? 20 : (landing || this.flap > 0.5 ? 17 : 23)) * D2R;
    this.shaker = !onGround && qbar > 400 ? clamp((a - aWarn) / (3 * D2R), 0, 1) : 0;
    // stick-free detection for flight-path hold
    this.stickFree = Math.abs(inp.pitch) < 0.03 ? this.stickFree + dt : 0;
    if (direct || qbar < 250 || onGround) {
      dE = inp.pitch > 0 ? inp.pitch * DATA.surf.stabUp : inp.pitch * DATA.surf.stabDn;
      dA = inp.roll * DATA.surf.ail; dD = inp.roll * DATA.surf.stabDiff;
      dR = inp.yaw * DATA.surf.rud;
      if (!direct && !onGround) { dE += -0.25 * q; dA += -0.15 * p; dR += 0.25 * r; }
      if (direct && !onGround) { dE += -0.08 * q; dR += 0.1 * r; }   // mechanical backup only damps lightly
      this.gammaRef = null;
    } else {
      const aLim = landing || this.flap > 0.5 ? DATA.alphaLimitLanding : DATA.alphaLimit;
      const nMax = landing ? DATA.nMaxLanding : (this.stores ? DATA.nMaxStores : DATA.nMax);
      const cg = Math.cos(gamma), cph = Math.cos(phi);
      const bankComp = Math.abs(phi) < 1.1 ? cg / Math.max(cph, 0.5) : cg * cph;
      // flight-path hold, blended in as the stick returns to neutral
      const act = clamp(Math.abs(inp.pitch) / 0.05, 0, 1);
      if (this.gammaRef === null || Math.abs(phi) > 1.1) this.gammaRef = gamma;
      this.gammaRef += (gamma - this.gammaRef) * Math.min(1, dt * (0.05 + 8 * act));
      let nBase = bankComp + (1 - act) * clamp(0.9 * (this.gammaRef - gamma) * Vs / G0, -1.2, 1.2);
      const nCmd = inp.pitch >= 0 ? lerp(nBase, nMax, inp.pitch) : lerp(nBase, DATA.nMin, -inp.pitch);
      let qCmd = G0 * (nCmd - cg * cph) / Vs;
      qCmd = Math.min(qCmd, 2.8 * (aLim - a) + 0.02);
      qCmd = Math.max(qCmd, 2.8 * (-10 * D2R - a) - 0.02);
      qCmd = Math.min(qCmd, G0 * (nMax + 0.3 - cg * cph) / Vs);
      qCmd = Math.max(qCmd, G0 * (DATA.nMin - cg * cph) / Vs);
      const qdot = 5.5 * (qCmd - q);
      const Mreq = I.pitch * qdot + (I.roll - I.yaw) * p * r;
      const base = this.coeffs(a, b, M, p, q, r, V, 0, 0, 0, 0, hAGL);
      dE = (Mreq / (qbar * S * C) - base.Cm) / 0.95;
      let pMax = DATA.pMax * (this.stores ? 0.85 : 1) * (1 - 0.65 * clamp((a - 12 * D2R) / (14 * D2R), 0, 1)) * (landing ? 0.5 : 1);
      pMax *= clamp(qbar / 9000, 0.35, 1);
      const pCmdS = inp.roll * pMax;
      const pCmd = pCmdS * Math.cos(a);
      const pdot = 7 * (pCmd - p);
      const Lreq = I.roll * pdot - (I.pitch - I.yaw) * q * r;
      dA = (Lreq / (qbar * S * B) - base.Cl) / (0.10 + 0.09 * 0.4);
      dD = 0.4 * dA;
      const rCoord = G0 * Math.sin(phi) * Math.cos(theta) / Vs;
      const rCmd = rCoord * Math.cos(a) + pCmdS * Math.sin(a) + inp.yaw * 0.30 * clamp(300 / Vs, 0.4, 1.5);
      const betaCmd = -inp.yaw * 6 * D2R * clamp(150 / Vs, 0.3, 1);
      const rdot = 3.2 * (rCmd - r) + 4.0 * (b - betaCmd);
      const Nreq = I.yaw * rdot - (I.roll - I.pitch) * p * q;
      dR = (Nreq / (qbar * S * B) - base.Cn) / 0.095;
    }
    const sf = DATA.surf;
    dE = clamp(dE, -sf.stabDn, sf.stabUp);
    dA = clamp(dA, -sf.ail, sf.ail); dD = clamp(dD, -sf.stabDiff, sf.stabDiff); dR = clamp(dR, -sf.rud, sf.rud);
    const hr = Math.max(hyd, 0.05);
    this.dE = approach(this.dE, dE, 60 * D2R * dt * hr);
    this.dA = approach(this.dA, dA, 90 * D2R * dt * hr);
    this.dD = approach(this.dD, dD, 60 * D2R * dt * hr);
    this.dR = approach(this.dR, dR, 80 * D2R * dt * hr);
    const slatT = clamp((a * R2D - 4) / 10, 0, 1) * (M < 0.85 ? 1 : 0) + 0.6 * this.flap;
    this.slat = approach(this.slat, clamp(slatT, 0, 1), 1.5 * dt * hr);
  }

  inertia() {
    const f = this.mass / 17500;
    return { roll: DATA.I.roll * (0.7 + 0.3 * f), pitch: DATA.I.pitch * (0.8 + 0.2 * f), yaw: DATA.I.yaw * (0.8 + 0.2 * f) };
  }

  // --------------------------------------------------------- main step
  step(dt, env) {
    if (this.crashed) return;
    const m = this.mass;
    const q_ = this.quat, qi = q_.clone().invert();
    // air data
    const wind = env.windAt ? env.windAt(this.pos) : env.wind;
    const vRelW = this.vel.clone().sub(wind);
    const vb = vRelW.clone().applyQuaternion(qi);
    const u = -vb.z, v = vb.x, w = -vb.y;
    const V = vRelW.length();
    const atm = atmosphere(this.pos.y);
    const M = V / atm.a;
    const qbar = 0.5 * atm.rho * V * V;
    const Vias = Math.sqrt(2 * qbar / 1.225);
    const a = V > 2 ? Math.atan2(w, u) : 0;
    const bta = V > 2 ? Math.asin(clamp(v / V, -1, 1)) : 0;
    const p = -this.omega.z, q = this.omega.x, r = -this.omega.y;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q_);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q_);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q_);
    const theta = Math.asin(clamp(fwd.y, -1, 1));
    const phi = Math.atan2(-right.y, up.y);
    const vIn = this.vel.length();
    const gamma = vIn > 5 ? Math.asin(clamp(this.vel.y / vIn, -1, 1)) : 0;
    const under = env.surface(this.pos.x, this.pos.z);
    const hAGL = under ? this.pos.y - 1.2 - under.h : 999;
    this.updateSystems(dt, !this.onGround, Vias);
    if (this.crashed) return;
    this.fbwLaw(dt, { a, b: bta, M, V, qbar, p, q, r, theta, phi, gamma, onGround: this.onGround, hAGL });
    const cf = this.coeffs(a, bta, M, p, q, r, V, this.dE, this.dD, this.dA, this.dR, hAGL);
    const S = DATA.S;
    const L = qbar * S * cf.CL, D = qbar * S * cf.CD, Yf = qbar * S * cf.CY;
    const ca = Math.cos(a), sa = Math.sin(a);
    const Xa = -D * ca + L * sa, Za = -D * sa - L * ca;
    // engines
    let Tsum = 0, ff = 0;
    for (const e of this.engines) { Tsum += e.update(dt, this, this.inp.throttle, M, atm.sigma, Vias, !this.onGround); ff += e.ff; }
    this.fuel = Math.max(0, this.fuel - ff * dt);
    this.fuelFlow = ff;
    // asymmetric thrust yaw
    const dT = this.engines[1].T - this.engines[0].T;
    const Fb = new THREE.Vector3(Yf, -Za, -(Xa + Tsum));
    const Mom = new THREE.Vector3(qbar * S * DATA.c * cf.Cm, -qbar * S * DATA.b * cf.Cn + dT * 0.87, -qbar * S * DATA.b * cf.Cl);
    const Fw = Fb.clone().applyQuaternion(q_);
    Fw.y -= m * G0;
    // ------------------------------------------------ gear / deck contact
    const wasOnGround = this.onGround;
    this.onGround = false; this.onDeck = false;
    const tmpP = new THREE.Vector3(), rArm = new THREE.Vector3();
    const steerMax = this.nws ? (V < 12 ? 55 : 12) * D2R : 0;
    const steer = clamp(-this.inp.yaw, -1, 1) * steerMax * clamp(1 - (V - 20) / 30, 0, 1);
    let sinkAtTouch = 0, vRelMax = 0;
    for (let i = 0; i < this.wheels.length; i++) {
      const wh = this.wheels[i];
      const ext = this.gear;
      tmpP.copy(wh.p); tmpP.y += (1 - ext) * 1.1;
      rArm.copy(tmpP).applyQuaternion(q_);
      const wp = rArm.clone().add(this.pos);
      const surf = env.surface(wp.x, wp.z);
      const had = wh.contact;
      wh.contact = false; this.wow[i] = false;
      if (!surf || ext < 0.95) { wh.comp = 0; continue; }
      const pen = (surf.h - (wp.y - wh.r)) * surf.n.y;
      if (pen <= 0) { wh.comp = 0; continue; }
      if (surf.water) { this.crash('Ditched in the sea'); return; }
      wh.contact = true; this.wow[i] = true; this.onGround = true; this.onDeck = !!surf.deck;
      const wl = this.omega.clone().cross(tmpP).applyQuaternion(q_);
      const pv = this.vel.clone().add(wl).sub(surf.v);
      const vn = pv.dot(surf.n);
      vRelMax = Math.max(vRelMax, pv.length());
      if (!had && -vn > 0.8) { this.event('touch', { wheel: i, sink: -vn, pos: wp.clone(), vRel: pv.length() }); sinkAtTouch = Math.max(sinkAtTouch, -vn); }
      const comp = Math.min(pen, wh.travel + 0.05);
      let Nf = wh.k * comp * (1 + 2.5 * Math.max(0, comp / wh.travel - 0.7)) - wh.c * vn;
      if (pen > wh.travel) {
        Nf += 8e6 * (pen - wh.travel);
        if (-vn > 7.5) { this.crash('Landing gear collapsed (sink rate ' + (-vn).toFixed(1) + ' m/s)'); return; }
      }
      Nf = Math.max(0, Nf);
      wh.comp = comp; wh.load = Nf;
      let rollDir = fwd.clone();
      if (wh.steer && Math.abs(steer) > 1e-4) rollDir.applyAxisAngle(up, steer);
      rollDir.addScaledVector(surf.n, -rollDir.dot(surf.n)).normalize();
      const latDir = surf.n.clone().cross(rollDir).normalize();
      const vL = pv.dot(rollDir), vLat = pv.dot(latDir);
      wh.spin = vL / wh.r;
      const brakeIn = wh.brake ? Math.max(this.inp.brake, this.parkBrake ? 1 : 0, this.holdback ? 1 : 0) : 0;
      // the parking brake bypasses anti-skid: rolling on it at speed locks and bursts the main tyres
      if (wh.brake && this.parkBrake && !this.holdback && Math.abs(vL) > 22 && !this.tyresBurst) {
        this.tyresBurst = true; this.msg('Tyres burst: rolling with the parking brake set!', 5); this.event('tyres', { pos: wp.clone() });
        this.event('mistake', { what: 'Rolled with the parking brake set: main tyres burst' });
      }
      // anti-skid limits braking to ~0.45 mu; rolling resistance 0.02 (0.35 on burst tyres, rims dragging)
      const muRoll = (wh.brake && this.tyresBurst ? 0.35 : 0.02) + 0.45 * brakeIn;
      // a held brake grips statically: stiffer friction near zero slip, so a braked jet does not creep on a moving deck
      const fL = -Math.tanh(vL / (brakeIn > 0.5 ? 0.04 : 0.35)) * muRoll * Nf;
      const fLat = -Math.tanh(vLat / 0.25) * wh.mu * Nf;
      const Fc = surf.n.clone().multiplyScalar(Nf).addScaledVector(rollDir, fL).addScaledVector(latDir, fLat);
      Fw.add(Fc);
      Mom.add(tmpP.clone().cross(Fc.clone().applyQuaternion(qi)));
    }
    this.vDeckRel = this.onGround ? vRelMax : 1e9;
    if (this.onGround && !wasOnGround) this.event('touchdown', { sink: sinkAtTouch, alpha: a, ias: Vias });
    if (!this.onGround && wasOnGround) this.event('airborne', { ias: Vias, onDeck: this.lastDeck });
    this.lastDeck = this.onDeck || (this.lastDeck && !this.onGround ? this.lastDeck : false);
    if (this.onGround) this.lastDeck = this.onDeck;
    // restraining stops
    if (this.holdback) {
      const hb = this.holdback;
      const target = hb.ship.localToWorld(hb.local.clone());
      const d = target.sub(this.pos); d.y = 0; if (d.length() > 0.4) d.setLength(0.4);
      const rv = this.vel.clone().sub(hb.ship.velocity); rv.y = 0;
      Fw.add(d.multiplyScalar(2.5e6).addScaledVector(rv, -4e5));
      this.launchT = 0;
    } else this.launchT += dt;
    // ------------------------------------------------ tail hook: damped arm riding on the deck, with bounce
    this.updateHook(dt, env);
    if (this.arrest) {
      const ar = this.arrest;
      const rv = this.vel.clone().sub(ar.ship.velocity);
      const dirW = ar.dirL.clone().applyQuaternion(ar.ship.quaternion);
      const along = rv.dot(dirW);
      const lp = ar.ship.worldToLocal(this.pos.clone());
      const run = lp.clone().sub(ar.p0).dot(ar.dirL);
      ar.run = run; ar.t = (ar.t || 0) + dt;
      // arresting engine: the hydraulic brake is metered for a constant run-out, so the pull adapts to closure speed,
      // weight and engine thrust (pilots go to MIL at touchdown in case of a bolter)
      let F = 0;
      const rise = clamp(ar.t / 0.35, 0, 1);
      const remaining = Math.max(ar.stop - run, 0.4);
      if (!ar.stopped) {
        const need = m * Math.max(along, 0) ** 2 / (2 * remaining) + Math.max(Tsum, 0) * 0.98;
        F = clamp(rise * need, 0, 4.5 * m * G0);
        if (along < 0.7 && run > 5) { ar.stopped = true; ar.stopRun = run; this.event('stopped', { run }); }
      } else {
        // after the stop the cable keeps some tension and pulls the jet back a metre or so
        F = Math.max(0, Math.max(Tsum, 0) + 2.5e4 * (run - ar.stopRun + 1.2) + 1.2e5 * along);
      }
      if (run < -1) F = 0;
      // horizontal cable pull acts at the hook pivot under the tail; the tip riding on the deck adds a small nose-down pull
      const Fapplied = dirW.clone().multiplyScalar(-F);
      Fapplied.y -= 0.12 * F;
      Fw.add(Fapplied);
      Mom.add(this.hookPivot.clone().cross(Fapplied.clone().applyQuaternion(qi)));
      ar.load = F; ar.decel = F / m / G0;
    }
    // ------------------------------------------------ integrate
    const acc = Fw.divideScalar(m);
    this.t.gVec.copy(acc).setY(acc.y + G0).applyQuaternion(qi).divideScalar(G0);
    this.vel.addScaledVector(acc, dt);
    this.pos.addScaledVector(this.vel, dt);
    const I = this.inertia();
    const Iv = new THREE.Vector3(I.pitch, I.yaw, I.roll);
    const Lw = this.omega.clone().multiply(Iv);
    const gyro = this.omega.clone().cross(Lw);
    const wdot = Mom.sub(gyro).divide(Iv);
    this.omega.addScaledVector(wdot, dt);
    if (this.onGround && V < 3 && this.arrest == null) this.omega.multiplyScalar(0.95);
    const wq = new THREE.Quaternion(this.omega.x * dt * 0.5, this.omega.y * dt * 0.5, this.omega.z * dt * 0.5, 0);
    const dq = this.quat.clone().multiply(wq);
    this.quat.set(this.quat.x + dq.x, this.quat.y + dq.y, this.quat.z + dq.z, this.quat.w + dq.w).normalize();
    // hard points
    this.scrape = Math.max(0, this.scrape - dt);
    for (const [hp, tol] of this.hardPoints) {
      const wp = hp.clone().applyQuaternion(this.quat).add(this.pos);
      const surf = env.surface(wp.x, wp.z);
      if (!surf) continue;
      const pen = surf.h - wp.y;
      if (pen > 0 && surf.water) { this.crash('Impact with the sea'); return; }
      if (pen > tol) { this.crash(tol > 0.1 ? 'Tail strike: the nozzles hit the deck' : 'Airframe struck the deck'); return; }
      if (pen > 0) {
        if (this.scrape === 0) this.event('scrape', { pos: wp.clone() });
        this.scrape = 1.5;
        const pv = this.vel.clone().add(this.omega.clone().cross(hp).applyQuaternion(this.quat)).sub(surf.v);
        const Fc = surf.n.clone().multiplyScalar(Math.max(0, 1.2e6 * pen - 1.2e5 * Math.min(pv.dot(surf.n), 0))).addScaledVector(pv.setY(0), -1.5e4);
        this.vel.addScaledVector(Fc, dt / m);
        const tb = hp.clone().cross(Fc.clone().applyQuaternion(qi));
        this.omega.addScaledVector(tb.divide(Iv), dt);
      }
    }
    if (env.obstacle && env.obstacle(this.pos)) { this.crash('Collision with the carrier'); return; }
    // ------------------------------------------------ limits & damage
    const nz = this.t.gVec.y;
    // wing structural load comes from aerodynamic lift, not from gear or cable reactions
    const nzS = this.onGround || this.arrest ? Za / (m * G0) : nz;
    if (!this.onGround) this.maxG = Math.max(this.maxG, nz);
    if (nzS > DATA.nOverstress) { this.damage.overstress += (nzS - DATA.nOverstress) * dt; if (!this.overWarned) { this.overWarned = true; this.msg('OVER-G: airframe overstressed', 4); this.event('warn', { v: 'overg' }); } }
    if (nzS > DATA.nFailure || this.damage.overstress > 1.5) { this.crash('Structural failure: wing overstressed at ' + nzS.toFixed(1) + ' g'); return; }
    if (Vias > DATA.vMaxIAS * 1.08) { this.crash('Structural failure: dynamic pressure limit exceeded'); return; }
    // telemetry
    const tt = this.t;
    tt.alpha = a; tt.beta = bta; tt.V = V; tt.M = M; tt.qbar = qbar; tt.theta = theta; tt.phi = phi; tt.gamma = gamma;
    tt.nz = nz; tt.ias = Vias; tt.vs = this.vel.y; tt.thrust = Tsum; tt.p = p; tt.q = q; tt.r = r; tt.L = L; tt.D = D;
    tt.heading = (Math.atan2(fwd.x, -fwd.z) * R2D + 360) % 360;
    tt.fwd = fwd; tt.upv = up; tt.rightv = right; tt.atm = atm; tt.hAGL = hAGL;
  }

  updateHook(dt, env) {
    // commanded position up or down (down = free to swing, damper holds it on the deck)
    const maxA = 38 * D2R;
    const target = this.hookCmd ? maxA : 0;
    this.hookBounce = Math.max(0, this.hookBounce - dt);
    let ang = this.hookAng;
    const rate = this.hookCmd ? 1.6 : 0.6;
    if (this.hookBounce > 0) ang = Math.max(ang - 1.2 * dt, 10 * D2R);
    else ang = approach(ang, target, rate * dt);
    // keep the tip above the deck
    this.hookOnDeck = false;
    const tip = this.hookTip(ang);
    const surf = env.surface(tip.x, tip.z);
    if (surf && !surf.water && ang > 2 * D2R) {
      const pen = surf.h - tip.y;
      if (pen > 0) {
        // solve the angle that puts the tip on the deck
        const pw = this.hookPivot.clone().applyQuaternion(this.quat).add(this.pos);
        const depth = clamp((pw.y - surf.h) / this.hookLen, -1, 1);
        const pitch = Math.asin(clamp(new THREE.Vector3(0, 0, 1).applyQuaternion(this.quat).y, -1, 1));
        const newAng = clamp(Math.asin(depth) + pitch, 0, maxA);
        // a hard first contact makes the hook bounce (hook skip)
        const vy = -this.vel.y;
        if (!this.hookWasOnDeck && vy > 4.2 && this.hookBounce === 0) { this.hookBounce = 0.18 + 0.1 * Math.random(); this.event('hookbounce'); }
        ang = Math.min(ang, newAng);
        this.hookOnDeck = true;
      }
    }
    this.hookWasOnDeck = this.hookOnDeck;
    this.hookAng = ang;
    this.hook = ang / maxA;
  }

  hookTip(ang = this.hookAng) {
    const tip = new THREE.Vector3(0, -Math.sin(ang) * this.hookLen, Math.cos(ang) * this.hookLen).add(this.hookPivot);
    return tip.applyQuaternion(this.quat).add(this.pos);
  }
  hookTipWorld() { return this.hookTip(); }

  crash(msg) { this.crashed = msg; this.vel.set(0, 0, 0); this.omega.set(0, 0, 0); this.event('crash', { msg }); }
}
