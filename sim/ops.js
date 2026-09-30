// Carrier operations: arresting-wire engagement, LSO calls and wave-offs, landing and launch reports.
import * as THREE from 'three';
import { SHIP } from './world.js';
const R2D = 180 / Math.PI;

export class CarrierOps {
  constructor(ship, sound, flash) {
    this.ship = ship; this.sound = sound; this.flash = flash;
    this.reset();
  }
  reset() {
    this.lastWireS = null; this.waveOff = false; this.callT = 0; this.lastCall = ''; this.ballCalled = false;
    this.pass = null; this.report = null; this.launch = null; this.touchSink = 0; this.bolter = false; this.onDeckLanding = false;
  }

  call(text, key = text, gap = 2.5) {
    if (this.callT > 0 && key === this.lastCall) return;
    if (this.callT > 0.9 && key !== 'waveoff') return;
    this.callT = gap; this.lastCall = key;
    this.flash('LSO: ' + text, 2.2);
    this.sound.say(text, 'lso-' + key, gap, 'lso');
  }

  // called every physics step
  checkWires(ac) {
    const ship = this.ship;
    if (ac.arrest || ac.hook < 0.75) { this.lastWireS = null; return; }
    const tip = ac.hookTipWorld();
    const tl = ship.worldToLocal(tip.clone());
    const deck = ship.deckAt(tl.x, tl.z);
    const cur = ship.wires.map(w => tl.clone().sub(w.c).dot(ship.landDir));
    if (deck && this.lastWireS) {
      const above = tl.y - deck.h;
      for (let i = 0; i < ship.wires.length; i++) {
        const w = ship.wires[i];
        const perp = Math.abs(tl.clone().sub(w.c).dot(ship.landPerp));
        if (this.lastWireS[i] < 0 && cur[i] >= 0 && perp < SHIP.wireSpan) {
          if (above > 0.14 || ac.hookBounce > 0) { if (above < 0.6) this.skipped = i + 1; continue; }
          const rv = ac.vel.clone().sub(ship.velocity);
          const dirW = ship.landDir.clone().applyQuaternion(ship.quaternion);
          const v = Math.max(rv.dot(dirW), 5);
          if (v > 290 / 3.6) { this.flash('Cable parted: engagement speed ' + Math.round(v * 3.6) + ' km/h. Full power!', 5); this.sound.say('Cable parted', 'cable', 5); continue; }
          ac.arrest = { ship, dirL: ship.landDir.clone(), p0: ship.worldToLocal(ac.pos.clone()), stop: 82, wire: i + 1, v0: v, t: 0 };
          this.sound.cable();
          this.pass = this.pass || {};
          this.pass.wire = i + 1; this.pass.closure = v; this.pass.aoaTrap = ac.t.alpha * R2D; this.pass.sink = this.touchSink || -ac.vel.y;
          this.pass.waveOff = this.waveOff;
          break;
        }
      }
    }
    this.lastWireS = cur;
  }

  // per frame: approach monitoring, LSO calls, bolter detection, reports
  update(dt, ac, lens) {
    this.callT = Math.max(0, this.callT - dt);
    const ship = this.ship;
    const lp = ship.worldToLocal(ac.pos.clone());
    const inGroove = lens && lens.dist > 0 && lens.dist < 2200 && Math.abs(lens.lineup) < 250 && !ac.onGround && ac.pos.y < ship.position.y + 260;
    const aoa = ac.t.alpha * R2D;
    if (inGroove) {
      if (!this.pass) this.pass = { gs: [], lu: [], aoa: [], start: performance.now() };
      const P = this.pass;
      if (lens.dist < 1500) { P.gs.push(lens.err); P.lu.push(lens.lineup); P.aoa.push(aoa); }
      if (!this.ballCalled && lens.dist < 1300) {
        this.ballCalled = true;
        this.flash('"817, Fulcrum ball, ' + (ac.fuel / 1000).toFixed(1) + '"   LSO: "Roger ball."', 3);
        this.sound.say('Roger ball', 'rogerball', 10, 'lso');
      }
      // wave-off criteria inside ~450 m
      const dirty = ac.gear < 0.95 || ac.hook < 0.8;
      if (!this.waveOff && lens.dist < 450 && (lens.err < -2.0 || Math.abs(lens.lineup) > 11 || dirty || aoa > 15 || aoa < 5.5)) {
        this.waveOff = true; this.call('Wave off! Wave off!', 'waveoff', 3); this.flash('WAVE OFF: full power, climb straight ahead', 4);
      }
      if (!this.waveOff && lens.dist < 1600 && lens.dist > 60) {
        if (lens.err < -1.4) this.call('Power!', 'power');
        else if (lens.err < -0.8) this.call("You're low", 'low');
        else if (lens.err > 1.2) this.call("You're high", 'high');
        else if (lens.lineup > 5) this.call('Come left', 'left');
        else if (lens.lineup < -5) this.call('Right for lineup', 'right');
        else if (aoa > 12.5) this.call("You're slow", 'slow');
        else if (aoa < 8.5 && lens.dist < 1200) this.call("You're fast", 'fast');
      }
    }
    // touchdown / bolter bookkeeping
    for (const e of ac.events) {
      if (e.kind === 'touchdown' && ac.onDeck && ac.hook > 0.5 && !ac.holdback && e.sink > 0.8) { this.touchSink = e.sink; this.onDeckLanding = true; if (this.pass) this.pass.sink = e.sink; }
      if (e.kind === 'airborne' && this.onDeckLanding && !ac.arrest && lp.z < 140 && !ac.holdback && ac.launchT > 5) {
        this.bolter = true; this.onDeckLanding = false;
        this.flash(this.skipped ? 'Hook skip over wire ' + this.skipped + ': bolter! Full power, climb and come around.' : 'Bolter! Missed the wires: full power, climb out and come around.', 5);
        this.sound.say('Bolter, bolter', 'bolter', 5, 'lso');
        this.pass = null; this.skipped = 0;
      }
      if (e.kind === 'stopped' && ac.arrest) this.finishReport(ac);
      if (e.kind === 'airborne' && ac.launchT < 8) this.launch = { ias: e.ias, t: ac.launchT };
    }
    if (ac.arrest) { this.pass && (this.pass.peakDecel = Math.max(this.pass.peakDecel || 0, ac.arrest.decel || 0)); }
    // pass abandoned (climbing away)
    if (this.pass && !ac.arrest && lens && (lens.dist < -300 || lens.dist > 2600)) { this.pass = null; this.waveOff = false; this.ballCalled = false; }
    if (!ac.onGround && lens && lens.dist > 2600) { this.waveOff = false; this.ballCalled = false; this.onDeckLanding = false; }
  }

  finishReport(ac) {
    const P = this.pass || {};
    const avg = a => a && a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
    const late = a => a && a.length ? a.slice(Math.floor(a.length * 0.7)) : [];
    const gsLate = avg(late(P.gs)), luLate = avg(late(P.lu)), aoaAvg = avg(late(P.aoa));
    const faults = [];
    if (gsLate > 0.7) faults.push('high in close'); if (gsLate < -0.7) faults.push('low in close');
    if (Math.abs(luLate) > 4) faults.push(luLate > 0 ? 'lined up right' : 'lined up left');
    if (aoaAvg > 12) faults.push('slow'); if (aoaAvg < 9) faults.push('fast');
    if ((P.sink || 0) > 5.5) faults.push('hard landing');
    let grade;
    if (P.waveOff) grade = 'Cut pass (landed on a wave-off)';
    else if (faults.length === 0 && (P.wire === 2 || P.wire === 3)) grade = 'OK';
    else if (faults.length <= 1 && P.wire) grade = 'Fair';
    else grade = 'No grade';
    this.report = { wire: P.wire, closure: (P.closure || 0) * 3.6, sink: P.sink || 0, aoa: P.aoaTrap || aoaAvg, peak: P.peakDecel || 0, run: ac.arrest ? ac.arrest.run : 0, grade, faults };
    this.flash(`Trap: wire ${P.wire}. LSO grade: ${grade}${faults.length ? ' (' + faults.join(', ') + ')' : ''}. Throttle to idle, hook up (H), fold wings (O).`, 10);
    this.sound.say(grade === 'OK' ? 'Nice pass. OK, ' + P.wire + ' wire' : grade + ', ' + P.wire + ' wire', 'grade', 5, 'lso');
    this.pass = null;
  }
}
