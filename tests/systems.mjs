// Systems tests: cold start procedure, start mistakes, failures. Run: node systems.mjs
import * as THREE from 'three';
import { Aircraft } from '../sim/flight.js';
const DT = 1 / 240, zero = new THREE.Vector3();
const deck = { h: 0, n: new THREE.Vector3(0, 1, 0), v: zero, water: false, deck: true };
const envDeck = { wind: new THREE.Vector3(), windAt() { return new THREE.Vector3(); }, surface() { return deck; } };
const envAir = { wind: new THREE.Vector3(), windAt() { return new THREE.Vector3(); }, surface() { return { h: 0, n: new THREE.Vector3(0, 1, 0), v: zero, water: true }; } };
let fails = 0;
const check = (name, ok, info = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  (' + info + ')' : '')); if (!ok) fails++; };
const run = (ac, env, secs, ctl) => { for (let t = 0; t < secs && !ac.crashed; t += DT) { ctl && ctl(ac, t); ac.step(DT, env); } };
function onDeck() {
  const ac = new Aircraft(); ac.pos.set(0, 1.84, 0); ac.coldAndDark(); ac.parkBrake = true; return ac;
}
const msgs = ac => ac._msgQ.map(m => m[0]).join(' | ');
const mistakes = ac => ac.events.filter(e => e.kind === 'mistake').map(e => e.what);

// 1. correct cold start
{
  const ac = onDeck();
  run(ac, envDeck, 1);
  ac.setBattery(true); ac.setPump(true); ac.setApu(true);
  run(ac, envDeck, 20);
  check('APU on speed ~18 s', ac.apu.state === 'running');
  ac.setEngineMaster(0, true); ac.setEngineMaster(1, true);
  check('left start accepted', ac.startEngine(0));
  run(ac, envDeck, 60);
  check('left engine at idle', ac.engines[0].state === 'running' && Math.abs(ac.engines[0].N - 0.70) < 0.01, 'N ' + ac.engines[0].N.toFixed(2));
  check('left EGT stayed below 870 °C', ac.engines[0].egt < 870, 'EGT ' + ac.engines[0].egt.toFixed(0));
  check('power still APU with generators OFF', ac.power() === 'apu');
  ac.startEngine(1); run(ac, envDeck, 60);
  ac.setGen(0, true); ac.setGen(1, true);
  check('generators online', ac.power() === 'gen');
  run(ac, envDeck, 12);
  check('FBW self-test passes on generator power', ac.fbwReady);
  ac.setApu(false); run(ac, envDeck, 1);
  check('APU shuts down when switched off', ac.apu.state === 'off');
  check('no mistakes logged', mistakes(ac).length === 0, mistakes(ac).join('; '));
}
// 2. hot start: throttle forward during the start
{
  const ac = onDeck(); ac.setBattery(true); ac.setPump(true); ac.setApu(true); run(ac, envDeck, 20);
  ac.setEngineMaster(0, true); ac.startEngine(0);
  run(ac, envDeck, 40, (a, t) => { if (a.engines[0].lit) a.inp.throttle = 0.5; });
  check('hot start damages the engine', ac.engines[0].damaged && ac.engines[0].state === 'off', 'EGT ' + ac.engines[0].egt.toFixed(0));
  check('hot start logged as a mistake', mistakes(ac).some(m => /Hot start/.test(m)));
  ac.inp.throttle = 0; check('damaged engine refuses to start', ac.startEngine(0) === false);
}
// 3. hot start caught in time: master OFF within the limit
{
  const ac = onDeck(); ac.setBattery(true); ac.setPump(true); ac.setApu(true); run(ac, envDeck, 20);
  ac.setEngineMaster(0, true); ac.startEngine(0);
  let cut = false;
  run(ac, envDeck, 30, (a) => { if (a.engines[0].lit && !cut) a.inp.throttle = 0.5; if (a.engines[0].egt > 880 && !cut) { cut = true; a.inp.throttle = 0; a.setEngineMaster(0, false); } });
  check('aborting a hot start saves the engine', !ac.engines[0].damaged && ac.engines[0].state === 'off');
}
// 4. no fuel pump: no light-off
{
  const ac = onDeck(); ac.setBattery(true); ac.setApu(true); run(ac, envDeck, 20);
  ac.setEngineMaster(0, true); ac.startEngine(0); run(ac, envDeck, 35);
  check('no light-off without the fuel pump', ac.engines[0].state === 'off' && !ac.engines[0].lit);
  check('no-light-off message names the pump', /fuel pump/.test(msgs(ac)));
}
// 5. start before the APU is on speed / with master off
{
  const ac = onDeck(); ac.setBattery(true); ac.setPump(true);
  check('start refused with master OFF', ac.startEngine(0) === false);
  ac.setEngineMaster(0, true);
  check('start refused without APU air', ac.startEngine(0) === false);
}
// 6. battery drains in ~15 min on its own
{
  const ac = onDeck(); ac.setBattery(true); run(ac, envDeck, 16 * 60);
  check('battery flat after 16 min alone', ac.power() === 'none', 'charge ' + ac.batCharge.toFixed(2));
}
// 7. airborne: engine fire handled vs ignored, flame-out + airstart, FCS failure + reset
function airborne() {
  const ac = new Aircraft(); ac.pos.set(0, 3000, 0); ac.vel.set(0, 0, -220); ac.gear = ac.gearCmd = 0; ac.setEnginesRunning(); ac.inp.throttle = 0.7;
  for (const e of ac.engines) e.N = 0.93; run(ac, envAir, 2); return ac;
}
{
  const ac = airborne(); ac.fireEngine(0); run(ac, envAir, 3);
  ac.inp.throttle = 0.7; ac.setEngineMaster(0, false); run(ac, envAir, 20);
  check('fire goes out after fuel shut-off', !ac.fail.fire[0] && !ac.crashed);
  const b = airborne(); b.fireEngine(1); run(b, envAir, 50);
  check('ignored fire destroys the aircraft', /fire/.test(b.crashed || ''));
}
{
  const ac = airborne(); ac.failEngine(0); run(ac, envAir, 5);
  check('engine failure flames the engine out', ac.engines[0].state === 'off');
  ac.fail.eng[0] = false; ac.inp.throttle = 0; ac.startEngine(0); run(ac, envAir, 60, a => { a.inp.throttle = 0; });
  check('windmill airstart relights', ac.engines[0].state === 'running', ac.engines[0].state + ' N ' + ac.engines[0].N.toFixed(2));
}
{
  const ac = airborne(); ac.failFcs('transient'); run(ac, envAir, 0.5);
  check('FCS failure drops to DIRECT law', ac.lawName === 'DIRECT');
  ac.fcsReset(); run(ac, envAir, 0.5);
  check('FCS reset restores NORMAL law', ac.lawName === 'NORMAL');
  ac.failFcs('hard'); ac.fcsReset(); run(ac, envAir, 0.5);
  check('hard FCS fault survives reset', ac.lawName === 'DIRECT');
}
{
  const ac = airborne(); ac.failHyd(0); run(ac, envAir, 1);
  check('single hydraulic failure halves pressure', Math.abs(ac.hydraulics() - 0.5) < 0.01);
}
// 8. parking brake on the take-off roll bursts the tyres
{
  const ac = new Aircraft(); ac.pos.set(0, 1.84, 0); ac.setEnginesRunning(); ac.parkBrake = true; ac.vel.set(0, 0, -30);
  run(ac, envDeck, 1);
  check('rolling on the parking brake bursts the tyres', ac.tyresBurst);
}
console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
process.exit(fails ? 1 : 0);
