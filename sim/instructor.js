// Flight instructor: guided lessons with step-by-step instructions, the reason behind each step, a highlighted
// control, spoken coaching, mistake tracking and a score. Lessons run on top of the normal missions.
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const kmh = ac => ac.t.ias * 3.6;
const aoa = ac => ac.t.alpha * R2D;
const hdgErr = (a, b) => ((a - b + 540) % 360) - 180;

// ---------------------------------------------------------------- lesson catalogue
// step: { say, why, target (cockpit control id), done(sim, I, dt), fail?(sim, I) -> text, hint, enter?(sim, I), tick? }
export const LESSONS = [
  {
    id: 'cold', n: 1, title: 'Cold start', scenario: 'cold', minutes: 6,
    summary: 'Bring a cold, dark MiG-29K to life on the deck: electrics, APU, both RD-33MK engines, flight controls, then configure for launch.',
    steps: [
      { say: 'Welcome aboard. The jet is cold and dark, wings folded, canopy open. Look down at the left cockpit wall: that is the engine start panel. Lift the red guard and switch the BATTERY on.', target: 'bat',
        why: 'The battery powers the caution panel, the standby instruments and the APU starter. Guarded switches stop you knocking a vital switch by accident.',
        done: s => s.ac.battery },
      { say: 'Good, lamp test. Every caution light flashes once so you know the bulbs work. Now the FUEL PUMP on.', target: 'pump',
        why: 'The boost pump pressurises fuel to the engines. Without it the engine turns but never lights: a "no light-off".', done: s => s.ac.sw.pump },
      { say: 'Switch the APU on. Wait for the green lamp beside the switch: it takes about eighteen seconds.', target: 'apu',
        why: 'The APU is a small gas turbine behind the cockpit. It supplies compressed air to spin the engine starters and electrical power while the engines are off.',
        done: s => s.ac.apu.state === 'running', hint: 'The APU lamp flashes amber while it spools up and turns steady green when it is on speed.' },
      { say: 'Press the master caution light, top right of the main panel, to acknowledge the cautions.', target: 'mcaut',
        why: 'Master caution flashes whenever a new caution lights. Acknowledging it re-arms it, so the next new fault gets your attention.',
        done: s => !s.cockpit.mcFlash, skipIf: s => !s.cockpit.mcFlash },
      { say: 'Throttle must be at idle. Switch the LEFT engine master on.', target: 'engL',
        why: 'The engine master opens the fuel shut-off valve to that engine. It is also how you shut an engine down or cut the fuel in a fire.', done: s => s.ac.sw.eng[0] },
      { say: 'Lift the guard and press START L. Watch the RPM and T4 gauges on the left front panel. Keep your hand off the throttle.', target: 'startL',
        why: 'The starter spins the core to about 25 per cent, fuel lights at 18 per cent, and the engine accelerates itself to 70 per cent idle. Advancing the throttle now over-fuels it: a hot start.',
        done: s => s.ac.engines[0].state === 'running',
        fail: s => s.ac.engines[0].state === 'starting' && s.ac.inp.throttle > 0.12 ? 'Throttle moved during the engine start' : null,
        hint: 'RPM should rise to 26, light off, then climb to 70. T4 peaks around 640 degrees.' },
      { say: 'Left engine at idle. Now the RIGHT engine master on.', target: 'engR', why: 'Same sequence for the right engine. Start one engine at a time so the APU air goes to one starter.', done: s => s.ac.sw.eng[1] },
      { say: 'Lift the guard and press START R.', target: 'startR', why: 'Watch the second needle on the RPM and T4 gauges.', done: s => s.ac.engines[1].state === 'running',
        fail: s => s.ac.engines[1].state === 'starting' && s.ac.inp.throttle > 0.12 ? 'Throttle moved during the engine start' : null },
      { say: 'Both engines at idle. Switch on both generators, left then right.', target: 'genL',
        why: 'The generators take the electrical load off the APU and the battery. The flight control computers will not self-test on APU power.',
        done: s => s.ac.sw.gen[0] && s.ac.sw.gen[1], tick: s => { s.cockpit.highlightId = s.ac.sw.gen[0] ? 'genR' : 'genL'; } },
      { say: 'Switch the APU off. It has done its job.', target: 'apu', why: 'The engines now supply air and power. Running the APU longer only burns fuel and hours.', done: s => s.ac.apu.state === 'off' && !s.ac.sw.apu },
      { say: 'The fly-by-wire system is running its self-test. Wait for FCS TEST to finish on the HUD, about nine seconds.', target: null,
        why: 'The KSU-941 flight control system checks its computers, sensors and actuators. You cannot fly until it passes.', done: s => s.ac.fbwReady },
      { say: 'Spread the wings: lift the yellow guard on the right front panel and set WING FOLD to spread.', target: 'fold',
        why: 'Folded wings let the deck crew park more jets. They spread hydraulically, so an engine must be running.', done: s => s.ac.fold < 0.02 && !s.ac.foldCmd,
        hint: 'The wing fold switch is on the right front panel, under the yellow guard. Spreading takes about 14 seconds.' },
      { say: 'Close the canopy.', target: 'canopy', why: 'The canopy must be closed and locked before the launch. Above 230 kilometres per hour an open canopy tears off.', done: s => s.ac.canopy < 0.02 && !s.ac.canopyCmd },
      { say: 'Set the flaps down for take-off.', target: 'flaps', why: 'Take-off flaps and drooped ailerons add lift for the short ski-jump launch.', done: s => s.ac.flap > 0.95 },
      { say: 'Navigation lights and anti-collision beacon on.', target: 'navlt', why: 'So the deck crew and other aircraft can see you.',
        done: s => s.ac.sw.navlt && s.ac.sw.beacon, tick: s => { s.cockpit.highlightId = s.ac.sw.navlt ? 'beacon' : 'navlt'; } },
      { say: 'The deck crew raise the restraining stops in front of your main wheels and the blast deflector behind you.', target: null,
        why: 'Vikramaditya has no catapult. The stops hold the jet while the engines reach full afterburner, then drop to release it.', done: s => !!s.ac.holdback },
      { say: 'Release the parking brake: push the red handle in.', target: 'park', why: 'The stops hold the jet now. Launching with the parking brake set would burst the tyres.', done: s => !s.ac.parkBrake },
      { say: 'You are ready for launch. Well done. Continue into the launch lesson, or take a break.', target: null, why: '', done: (s, I, dt) => I.hold(true, 3, dt) },
    ],
    next: 'launch',
  },
  {
    id: 'launch', n: 2, title: 'Ski-jump launch', scenario: 'deck', minutes: 3,
    summary: 'Full afterburner on the restraining stops, release, and let the 14° ramp throw you into the air. Then clean up: gear, flaps, climb.',
    steps: [
      { say: 'You are on the long launch position, 195 metres to the ramp. Push the throttle to MIL: hold Shift until it stops at the detent.', target: null,
        why: 'MIL is maximum dry thrust. The throttle has a detent here so you cannot slip into afterburner by accident.',
        done: s => s.ac.inp.throttle >= 0.849 && s.ac.engines.every(e => e.N > 0.97), hint: 'Hold Shift or R to advance the throttle. It stops at 85 per cent, the MIL detent.' },
      { say: 'Check the engines: RPM 100 per cent, T4 below 870. Now full afterburner: press Tab, or release Shift and press it again.', target: null,
        why: 'The afterburner adds about 35 kilonewtons per engine. On the stops the engines go to the ЧР emergency rating for maximum thrust.',
        done: s => s.ac.engines.every(e => e.AB > 0.9) },
      { say: 'Stick neutral, hand steady. Release the stops: press Space.', target: null,
        why: 'The jet accelerates at about 1.6 g. The ramp throws the nose up to 14 degrees; the flight controls then hold the attitude.',
        done: s => !s.ac.holdback },
      { say: 'Keep the stick neutral through the ramp.', target: null, why: 'The ramp gives you a ballistic climb before the wings are fully flying. Pulling now can stall the jet.',
        done: s => !s.ac.onGround && s.ac.launchT > 1, fail: s => s.ac.onGround && Math.abs(s.ac.inp.pitch) > 0.4 ? 'Large stick input on the ramp' : null },
      { say: 'Airborne. Hold about 12 degrees nose up with gentle back stick. Positive climb: gear up now.', target: 'gear',
        why: 'The gear limit is 500 kilometres per hour. The jet accelerates fast in afterburner, so gear up promptly.',
        done: s => s.ac.gearCmd === 0, fail: s => s.ac.t.ias * 3.6 > 500 && s.ac.gear > 0.05 ? 'Gear still down above 500 km/h' : null },
      { say: 'Flaps up before 400 kilometres per hour.', target: 'flaps', why: 'Flaps are limited to 400. Above that they blow up automatically, but it is your job.', done: s => s.ac.flapCmd === 0,
        fail: s => s.ac.t.ias * 3.6 > 400 && s.ac.flap > 0.5 ? 'Flaps still down above 400 km/h' : null },
      { say: 'Come out of afterburner to MIL: press Tab. Climb to 1,500 metres.', target: null,
        why: 'Afterburner burns fuel four times faster. Carrier jets are always short of fuel.',
        done: s => s.ac.pos.y > 1500 && s.ac.engines.every(e => e.AB < 0.05), hint: 'Tab toggles between full afterburner and MIL.' },
      { say: 'Level off at 1,500 metres. Good launch.', target: null, why: '', done: (s, I, dt) => I.hold(Math.abs(s.ac.t.vs) < 8, 3, dt) },
    ],
    next: 'handling',
  },
  {
    id: 'handling', n: 3, title: 'Basic handling', scenario: 'free', minutes: 5,
    summary: 'Straight and level, level turns, climbing and holding altitude. Learn how the fly-by-wire responds to your stick.',
    steps: [
      { say: 'You are at 3,000 metres. Let go of the stick: the flight controls hold your flight path. Keep the altitude within 50 metres for ten seconds using small throttle and pitch inputs.', target: null,
        why: 'The KSU-941 holds the flight path when the stick is centred. Small, smooth inputs are the key to precise flying.',
        enter: (s, I) => { I.ref = { alt: s.ac.pos.y }; }, done: (s, I, dt) => I.hold(Math.abs(s.ac.pos.y - I.ref.alt) < 50 && Math.abs(s.ac.t.phi) < 0.15, 10, dt) },
      { say: 'Roll left to 60 degrees of bank, then pull gently to hold your altitude in the turn. Turn through 180 degrees.', target: null,
        why: 'At 60 degrees of bank you need 2 g to hold altitude. Watch the n readout on the HUD.',
        enter: (s, I) => { I.ref = { alt: s.ac.pos.y, hdg: s.ac.t.heading, turned: 0, last: s.ac.t.heading }; },
        tick: (s, I) => { const d = hdgErr(s.ac.t.heading, I.ref.last); I.ref.last = s.ac.t.heading; I.ref.turned += d; I.metric('turnAltErr', Math.abs(s.ac.pos.y - I.ref.alt)); },
        done: (s, I) => I.ref.turned < -175, hint: 'Press A to roll left. At 60 degrees, release A and pull back gently with S.' },
      { say: 'Roll out wings level, then roll right and turn 180 degrees the other way.', target: null, why: 'Lead the roll-out by about 15 degrees of heading.',
        enter: (s, I) => { I.ref = { alt: s.ac.pos.y, turned: 0, last: s.ac.t.heading }; },
        tick: (s, I) => { const d = hdgErr(s.ac.t.heading, I.ref.last); I.ref.last = s.ac.t.heading; I.ref.turned += d; I.metric('turnAltErr', Math.abs(s.ac.pos.y - I.ref.alt)); },
        done: (s, I) => I.ref.turned > 175 },
      { say: 'Roll wings level. Now pull to 5 g for a few seconds: feel the grey-out creep in at the edges.', target: null,
        why: 'Sustained g drains blood from your eyes. Tense your legs and stomach: the anti-g strain. The FBW limits you to 8 g clean.',
        done: (s, I, dt) => I.hold(s.ac.t.nz > 4.6, 3, dt) },
      { say: 'Roll level and climb to 4,000 metres, then level off within 50 metres.', target: null, why: 'Lead the level-off by about five seconds of climb: climbing at 20 metres a second, start easing the nose down 100 metres below the target.',
        done: (s, I, dt) => I.hold(Math.abs(s.ac.pos.y - 4000) < 50 && Math.abs(s.ac.t.vs) < 5, 4, dt) },
      { say: 'Excellent. That is the core of precise flying.', target: null, why: '', done: (s, I, dt) => I.hold(true, 2, dt) },
    ],
    next: 'onspeed',
  },
  {
    id: 'onspeed', n: 4, title: 'On-speed angle of attack', scenario: 'free', minutes: 4,
    opts: { alt: 1200, speed: 125, heading: 0 },
    summary: 'Configure for landing and fly the approach angle of attack, 10.5°, using power for the glide path and pitch for speed.',
    steps: [
      { say: 'Slow down: throttle back towards idle and extend the speed brake with B until you are below 450 kilometres per hour.', target: null,
        why: 'Gear and flap limits are 500 and 400 kilometres per hour.', done: s => kmh(s.ac) < 450 },
      { say: 'Speed brake in with B. Gear down.', target: 'gear', why: 'The speed brake is inhibited with the gear down anyway.', done: s => s.ac.gearCmd === 1 && s.ac.brakeCmd === 0,
        hint: 'Press B to retract the speed brake and G or the gear lever for the gear.' },
      { say: 'Flaps down below 400.', target: 'flaps', why: 'Landing flaps and drooped ailerons lower the approach speed.', done: s => s.ac.flapCmd === 1 },
      { say: 'Now fly 10.5 degrees angle of attack: the indexer on the left of the HUD says ON SPEED. Hold it for fifteen seconds while keeping your altitude with the throttle.', target: null,
        why: 'Carrier pilots fly angle of attack, not airspeed: the right AoA gives the right hook-to-eye geometry and touchdown speed at any weight.',
        enter: (s, I) => { I.ref = { alt: s.ac.pos.y }; },
        tick: (s, I) => I.metric('aoaErr', Math.abs(aoa(s.ac) - 10.5)),
        done: (s, I, dt) => I.hold(Math.abs(aoa(s.ac) - 10.5) < 1.0 && Math.abs(s.ac.t.vs) < 4, 15, dt),
        hint: 'Nose up to increase AoA, then add power so you do not sink. Too slow: SLOW shows. Too fast: FAST.' },
      { say: 'Now descend at about 3 metres a second while staying on speed: take a little power off, keep the nose where it is.', target: null,
        why: 'This is the 4 degree glide slope at approach speed. Power controls the descent rate, pitch holds the AoA.',
        done: (s, I, dt) => I.hold(Math.abs(aoa(s.ac) - 10.5) < 1.2 && s.ac.t.vs < -2 && s.ac.t.vs > -4.5, 10, dt) },
      { say: 'That is exactly what you fly in the groove. Well done.', target: null, why: '', done: (s, I, dt) => I.hold(true, 2, dt) },
    ],
    next: 'glideslope',
  },
  {
    id: 'glideslope', n: 5, title: 'Flying the ball', scenario: 'approach', minutes: 3,
    summary: 'Follow the optical landing system (the "ball") down the 4° glide slope, keep lined up, then wave off before the deck.',
    steps: [
      { say: 'You are on final, five kilometres behind the ship. The amber light on the left edge of the deck is the ball: level with the green datum lights you are on the glide slope.', target: null,
        why: 'The lens projects a light beam down the glide slope. Ball high: you are high. Ball low: you are low. Red: dangerously low.', done: (s, I, dt) => I.hold(true, 4, dt) },
      { say: 'Keep the ball centred with power, the angle of attack on speed with pitch, and the deck centreline straight ahead. Fly it down to 800 metres.', target: null,
        why: 'The HUD also shows the glide slope and lineup errors from the ship on the right and bottom scales.',
        tick: (s, I) => { const L = s.env.lens; if (L && L.dist < 4000) { I.metric('gsErr', Math.abs(L.err)); I.metric('luErr', Math.abs(L.lineup)); I.metric('aoaErr', Math.abs(aoa(s.ac) - 10.5)); } },
        done: s => s.env.lens && s.env.lens.dist < 800, fail: s => s.env.lens && s.env.lens.err < -2.2 ? 'Well below the glide slope (red ball)' : null },
      { say: 'Wave off: full power, climb straight ahead. Tab for afterburner, then MIL.', target: null, why: 'Practising the wave-off makes it automatic. Gear stays down until you are climbing away.',
        enter: s => s.ops.call?.('Wave off!', 'waveoff', 3), done: s => s.ac.t.vs > 5 && s.ac.inp.throttle > 0.84 },
      { say: 'Good pass. Next lesson: the full trap.', target: null, why: '', done: (s, I, dt) => I.hold(true, 3, dt) },
    ],
    next: 'trap',
  },
  {
    id: 'trap', n: 6, title: 'The trap', scenario: 'approach', minutes: 3,
    summary: 'Fly the ball to touchdown, go to MIL as the wheels hit, and catch a wire. The LSO grades your pass.',
    steps: [
      { say: 'Same approach, all the way to the deck this time. Fly the ball, on speed, lined up.', target: null, why: 'Aim for wire 2: the lens is set for it.',
        tick: (s, I) => { const L = s.env.lens; if (L && L.dist < 2500) { I.metric('gsErr', Math.abs(L.err)); I.metric('luErr', Math.abs(L.lineup)); I.metric('aoaErr', Math.abs(aoa(s.ac) - 10.5)); } },
        done: s => s.env.lens && s.env.lens.dist < 450 },
      { say: 'In close: do not flare, fly it into the deck. At touchdown, throttle to MIL.', target: null,
        why: 'There is no flare on a carrier: the hook needs a firm arrival. MIL at touchdown means you can fly away if the hook misses.',
        done: s => s.ac.onGround || !!s.ac.arrest, fail: s => s.ops.waveOff ? 'Waved off by the LSO' : null, abort: s => s.ops.waveOff && s.ac.t.vs > 3 && s.ac.pos.y > 60 ? 'Waved off by the LSO: you climbed away safely. Check the debrief for why, then try again.' : null },
      { say: 'MIL power now!', target: null, why: '', done: (s, I, dt) => (!!s.ac.arrest && s.ac.inp.throttle > 0.83) || (I.stepT > 1.2),
        exit: (s, I) => { if (!(s.ac.inp.throttle > 0.83)) I.mistake('Throttle not at MIL at touchdown'); } },
      { say: 'Wait for the jet to stop.', target: null, why: 'The arresting engine stops you in about 80 metres at 2 g.', done: s => s.ac.arrest && s.ac.arrest.stopped,
        abort: s => (!s.ac.arrest && s.ops.bolter) ? 'Bolter: the hook missed the wires. You flew away safely; try again.' : null },
      { say: 'Trapped. Throttle to idle, hook up to release the wire.', target: 'hook', why: 'The cable pulls you back a metre. Raising the hook drops it.', done: s => s.ac.inp.throttle < 0.05 && !s.ac.hookCmd },
      { say: 'Fold the wings and taxi clear. Welcome back aboard.', target: 'fold', why: 'The deck must be cleared for the next jet within a minute.', done: s => s.ac.foldCmd === 1 },
    ],
    next: 'circuit',
  },
  {
    id: 'circuit', n: 7, title: 'Carrier circuit', scenario: 'circuit', minutes: 7,
    summary: 'Fly the full visual pattern: run in over the ship, break, downwind with landing checks, the 180° turn and roll out in the groove.',
    steps: [
      { say: 'You are behind the ship at 300 metres, 650 kilometres per hour. Fly up the right side of the ship, about 600 metres out, heading with it.', target: null,
        why: 'The initial: joining the pattern fast and level lets the ship see you and plan the recovery.',
        done: s => { const lp = s.shipLocal(s.ac.pos); return lp.z < -60; }, hint: 'The carrier is ahead of you. The centre display shows its bearing.' },
      { say: 'Abeam the bow: break left. Throttle idle, roll 60 to 70 degrees left and pull about 4 g.', target: null,
        why: 'The break bleeds off speed quickly and puts you downwind about 1,500 metres abeam.',
        enter: (s, I) => { I.ref = { hdg: s.ac.t.heading }; }, done: (s, I) => Math.abs(hdgErr(s.ac.t.heading, (I.ref.hdg + 180) % 360)) < 20 },
      { say: 'Roll out downwind at 250 metres. Below 500: gear down. Below 400: flaps down. Hook down.', target: 'gear',
        why: 'The landing checks: gear, flaps, hook. The LSO waves you off if any is missing.',
        done: s => s.ac.gear > 0.95 && s.ac.flap > 0.9 && s.ac.hook > 0.9, tick: s => { s.cockpit.highlightId = !s.ac.gearCmd ? 'gear' : !s.ac.flapCmd ? 'flaps' : !s.ac.hookCmd ? 'hook' : null; } },
      { say: 'Fly on speed, 10.5 degrees, level at 250 metres. Start the turn when you pass abeam the stern of the ship.', target: null,
        why: 'This is the 180: a descending turn onto the final approach.', done: s => { const lp = s.shipLocal(s.ac.pos); return lp.z > 150; } },
      { say: 'Turn left now. About 25 to 30 degrees of bank, on speed, descending gently. Aim to roll out behind the ship, lined up with the angled deck.', target: null,
        why: 'The landing area is angled 6 degrees to the left of the ship\'s heading. Roll out about 1,500 metres behind the ship.',
        done: s => { const L = s.env.lens; return L && L.dist > 300 && L.dist < 2200 && Math.abs(L.lineup) < 60 && Math.abs(s.ac.t.phi) < 0.3; } },
      { say: 'You are in the groove. Call the ball and fly it to the wire.', target: null, why: '', done: s => s.ac.arrest && s.ac.arrest.stopped,
        fail: s => s.ops.bolter ? 'Bolter' : null, hint: 'Keep the ball centred with power and the AoA on speed.',
        redo: s => s.ops.bolter && !s.ac.onGround && s.ac.pos.y > 60 ? { goto: 3, say: 'Bolter. Climb straight ahead to 250 metres, turn left downwind and fly the pattern again.' } : null },
      { say: 'Trapped from the pattern. That is a real carrier recovery.', target: null, why: '', done: (s, I, dt) => I.hold(true, 3, dt) },
    ],
    next: 'bolter',
  },
  {
    id: 'bolter', n: 8, title: 'Touch-and-go (bolter practice)', scenario: 'approach', opts: { hook: false }, minutes: 3,
    summary: 'Land with the hook up, go to MIL at touchdown and fly off the angled deck: exactly what happens when the hook misses.',
    steps: [
      { say: 'The hook is up for this pass. Fly the ball as normal.', target: null, why: 'A bolter is a missed wire. Pilots practise touch-and-goes so the reaction is automatic.',
        done: s => s.ac.onGround, fail: s => s.ops.waveOff ? 'Waved off' : null, abort: s => s.ops.waveOff && s.ac.t.vs > 3 && s.ac.pos.y > 60 ? 'Waved off by the LSO: you climbed away safely. Check the debrief for why, then try again.' : null },
      { say: 'Touchdown: MIL power now, keep the attitude, fly off the end of the angled deck!', target: null, why: 'Do not pull hard: let the speed build and the jet fly itself off.',
        enter: (s, I) => { I.ref = { t: 0 }; }, tick: (s, I, dt) => { I.ref.t += dt; },
        done: s => !s.ac.onGround && s.ac.t.vs > 2, exit: (s, I) => { if (I.ref.t > 1.5) I.mistake('Late on the power after touchdown'); } },
      { say: 'Airborne. Climb straight ahead to 200 metres. That was a textbook bolter.', target: null, why: '', done: s => s.ac.pos.y > 200 },
    ],
    next: 'efail',
  },
  {
    id: 'efail', n: 9, title: 'Engine failure on launch', scenario: 'deck', minutes: 4,
    summary: 'The right engine fails just after the ramp. Keep flying on one engine in afterburner, clean up, climb, then relight in the air.',
    steps: [
      { say: 'Normal launch: MIL, full afterburner, release with Space. Be ready for anything.', target: null, why: 'Emergencies happen at the worst time. Fly the aircraft first.',
        done: s => !s.ac.onGround && s.ac.launchT > 1.5 && s.ac.launchT < 20 },
      { say: 'Engine failure! The right engine has flamed out. Keep full afterburner on the left, wings level, hold 10 degrees nose up. Gear up now.', target: 'gear',
        enter: s => s.ac.failEngine(1), why: 'A single RD-33MK in afterburner will climb the jet. Drag is your enemy: gear up immediately.',
        done: s => s.ac.gearCmd === 0, fail: s => s.ac.pos.y < 8 ? 'Nearly hit the sea' : null },
      { say: 'Flaps up above 350 kilometres per hour. Climb to 500 metres.', target: 'flaps', why: 'Gain height and speed before troubleshooting.', done: s => s.ac.flapCmd === 0 && s.ac.pos.y > 500 },
      { say: 'Now relight the right engine: its engine master OFF, then ON, then START R. Keep above 330 kilometres per hour so it windmills. Leave the throttle where it is.', target: 'engR',
        enter: s => { s.ac.fail.eng[1] = false; }, why: 'An airstart uses the airflow through the engine instead of the APU, and the start fuel control meters the fuel. This engine flamed out; it did not break.',
        tick: (s, I) => { s.cockpit.highlightId = s.ac.engines[1].state === 'off' && s.ac.sw.eng[1] ? 'startR' : 'engR'; },
        done: s => s.ac.engines[1].state === 'running', hint: 'The right engine master and START R are on the start panel on the left wall.' },
      { say: 'Both engines running. You handled that like a professional.', target: null, why: '', done: (s, I, dt) => I.hold(true, 3, dt) },
    ],
    next: 'emerg',
  },
  {
    id: 'emerg', n: 10, title: 'In-flight emergencies', scenario: 'free', minutes: 5,
    summary: 'An engine fire, a flight-control failure and a hydraulic failure. Read the caution panel, silence the warning, run the drill.',
    steps: [
      { say: 'Cruise at 3,000 metres. Keep an eye on the caution panel on the right front panel.', target: null, why: 'Warnings are red, cautions amber.', done: (s, I, dt) => I.hold(true, 6, dt) },
      { say: 'FIRE R! Master warning. Press the master warning light to silence it.', target: 'mwarn', enter: s => s.ac.fireEngine(1),
        why: 'Silence the alarm so you can think. Then the drill: throttle idle, engine master OFF, which also fires the extinguisher.', done: s => !s.cockpit.mwFlash },
      { say: 'Right engine: throttle back, then right engine master OFF.', target: 'engR', why: 'Cutting the fuel starves the fire.', done: s => !s.ac.fail.fire[1],
        fail: (s, I) => I.stepT > 35 ? 'Fire drill too slow' : null, hint: 'The engine masters are on the start panel on the left wall.' },
      { say: 'Fire out. Stay on the left engine. Now: FCS caution. The flight control computer has dropped to DIRECT law: no g or AoA protection. Fly gently.', target: 'fcsrst',
        enter: s => s.ac.failFcs('transient'), why: 'In DIRECT law the stick moves the surfaces directly. You can overstress or stall the jet.', done: (s, I, dt) => I.hold(true, 5, dt) },
      { say: 'Press FCS RESET on the right front panel.', target: 'fcsrst', why: 'Many flight-control faults are transient and clear with a reset.', done: s => !s.ac.fail.fcs },
      { say: 'Normal law restored. Last one: HYD 1 caution. One hydraulic system has failed. The controls respond at half rate: small, smooth inputs.', target: null,
        enter: s => s.ac.failHyd(0), why: 'Two hydraulic systems each drive all the surfaces. With one, you still have full control, just slower.', done: (s, I, dt) => I.hold(true, 6, dt) },
      { say: 'Press master caution to acknowledge. Then turn back towards the ship.', target: 'mcaut', why: 'With a hydraulic failure and one engine you would declare an emergency and land as soon as possible.', done: s => !s.cockpit.mcFlash },
      { say: 'Emergencies handled. Remember the order: aviate, navigate, communicate.', target: null, why: '', done: (s, I, dt) => I.hold(true, 3, dt) },
    ],
    next: 'night',
  },
  {
    id: 'night', n: 11, title: 'Night trap', scenario: 'approach', opts: { night: true }, minutes: 4,
    summary: 'The same approach in the dark: the ball, the deck lights and the centreline lights are all you have.',
    steps: [
      { say: 'Night. Trust your instruments, not your eyes. The drop lights hanging below the stern line up with the centreline lights when you are lined up.', target: null,
        why: 'At night there is no horizon. The lens, the centreline lights and the vertical drop lights at the stern give glide slope and lineup.',
        tick: (s, I) => { const L = s.env.lens; if (L && L.dist < 2500) { I.metric('gsErr', Math.abs(L.err)); I.metric('luErr', Math.abs(L.lineup)); } }, done: s => s.env.lens && s.env.lens.dist < 450, abort: s => s.ops.waveOff && s.ac.t.vs > 3 && s.ac.pos.y > 60 ? 'Waved off by the LSO: you climbed away safely. Check the debrief for why, then try again.' : null },
      { say: 'Fly it into the deck, MIL at touchdown.', target: null, why: '', done: s => s.ac.arrest && s.ac.arrest.stopped, fail: s => s.ops.bolter ? 'Bolter' : null,
        abort: s => s.ops.bolter && !s.ac.onGround ? 'Bolter at night: the hook missed the wires. Try again.' : null },
      { say: 'A night trap. Most pilots say it is the hardest thing in aviation.', target: null, why: '', done: (s, I, dt) => I.hold(true, 3, dt) },
    ],
    next: 'tanker',
  },
  {
    id: 'tanker', n: 12, title: 'Air-to-air refuelling', scenario: 'tanker', minutes: 6,
    summary: 'Join a buddy tanker MiG-29K with its refuelling pod, extend the probe, and plug the drogue at a gentle closing speed.',
    steps: [
      { say: 'The tanker is ahead, 600 metres, trailing the hose and drogue from the centreline pod. Extend the refuelling probe.', target: 'probe',
        why: 'The probe swings out from the left side of the nose, in front of the canopy.', done: s => s.ac.probe > 0.95 },
      { say: 'Close to about 20 metres behind the drogue. Match the tanker\'s speed: 500 kilometres per hour.', target: null,
        why: 'Stabilise before plugging. Watch the tanker, not the drogue: the drogue moves with the air.', done: s => s.tanker && s.tanker.range < 25,
        hint: 'The HUD shows the range and closure to the drogue at the bottom right.' },
      { say: 'Now close slowly, 1 to 2 metres a second, and fly the probe into the basket.', target: null,
        why: 'Too fast and the hose whips or the probe breaks; too slow and the basket pushes away on your bow wave.', done: s => s.tanker && s.tanker.contact,
        fail: s => s.tanker && s.tanker.broken ? 'Contact too fast: hose broke' : null },
      { say: 'Contact! Push in about two metres until the pod light turns green, then hold that position and take on 800 kilograms.', target: null,
        why: 'The hose reel has to be pushed back 1 to 3.5 metres before the fuel valve opens. Too far and the hose overruns. The HUD shows PUSH IN, IN RANGE or BACK OFF.',
        enter: (s, I) => { I.ref = { f0: s.ac.fuel }; }, done: (s, I) => s.ac.fuel > I.ref.f0 + 800 },
      { say: 'Back out gently, probe in. Well done: that is a full carrier syllabus.', target: 'probe', why: '', done: s => s.ac.probeCmd === 0 },
    ],
  },
];

// ---------------------------------------------------------------- the instructor
export class Instructor {
  constructor(sim) {
    this.sim = sim; this.lesson = null;
    this.el = { box: document.getElementById('coach'), title: document.querySelector('#coach .ct'), step: document.querySelector('#coach .cs'),
      say: document.querySelector('#coach .say'), why: document.querySelector('#coach .why'), bar: document.querySelector('#coach .bar i'),
      arrow: document.getElementById('coacharrow') };
    const b = document.getElementById('coach');
    if (b) {
      b.querySelector('[data-c=show]').onclick = () => this.lookAt();
      b.querySelector('[data-c=repeat]').onclick = () => this.speak(this.step?.say, true);
      b.querySelector('[data-c=skip]').onclick = () => this.skip();
      b.querySelector('[data-c=quit]').onclick = () => this.stop(true);
    }
  }
  get step() { return this.lesson ? this.lesson.steps[this.i] : null; }
  get active() { return !!this.lesson; }

  start(id, opts = {}) {
    const L = LESSONS.find(l => l.id === id);
    if (!L) return;
    this.lesson = L; this.i = -1; this.t = 0; this.mistakes = []; this.metrics = {}; this.skipped = 0; this.ref = {};
    this.done = false;
    if (!opts.continueFlight) this.sim.startScenario(L.scenario, true, L.opts || {});
    this.sim.hooks.emit('lesson', { id, phase: 'start' });
    this.el.box.hidden = false;
    this.el.title.textContent = L.n + '. ' + L.title;
    this.next();
  }
  stop(user = false) {
    if (!this.lesson) return;
    this.sim.cockpit.highlightId = null;
    if (user) this.sim.hooks.emit('lesson', { id: this.lesson.id, phase: 'quit' });
    this.lesson = null; this.el.box.hidden = true; if (this.el.arrow) this.el.arrow.hidden = true;
    try { speechSynthesis.cancel(); } catch (e) { }
  }
  skip() { if (!this.step) return; this.skipped++; this.mistake('Skipped step: ' + this.step.say.split('.')[0]); this.advance(); }
  advance() { const st = this.step; st?.exit?.(this.sim, this); this.next(); }
  next(quiet = false) {
    this.i++; this.stepT = 0; this.holdT = 0; this.hinted = false;
    const st = this.step;
    if (!st) return this.finish(true);
    if (st.skipIf && st.skipIf(this.sim, this)) return this.next(quiet);
    st.enter?.(this.sim, this);
    this.sim.cockpit.highlightId = st.target || null;
    this.el.step.textContent = 'Step ' + (this.i + 1) + ' of ' + this.lesson.steps.length;
    this.el.say.textContent = st.say; this.el.why.textContent = st.why || ''; this.el.why.hidden = !st.why;
    this.el.bar.style.width = (100 * this.i / this.lesson.steps.length) + '%';
    this.el.box.querySelector('[data-c=show]').hidden = !st.target;
    if (!quiet) this.speak(st.say);
  }
  speak(text, force = false) {
    if (!text) return;
    this.sim.sound.say(text, 'instr', force ? 0 : 0.5, 'instructor');
  }
  // hold a condition for secs (resets when it breaks)
  hold(cond, secs, dt) { this.holdT = cond ? this.holdT + dt : 0; return this.holdT >= secs; }
  metric(k, v) { const m = this.metrics[k] ||= { sum: 0, n: 0, max: 0 }; m.sum += v; m.n++; m.max = Math.max(m.max, v); }
  mistake(what) {
    if (this.mistakes.some(m => m.what === what)) return;
    this.mistakes.push({ what, t: this.sim.state.simTime });
    this.sim.hooks.emit('mistake', { what, source: 'instructor' });
  }
  lookAt() { if (this.step?.target) this.sim.lookAtControl(this.step.target); }

  update(dt) {
    if (!this.lesson || this.done) return;
    const s = this.sim, st = this.step;
    if (!st) return;
    if (s.state.paused || s.state.replay) return;
    this.stepT += dt; this.t += dt;
    if (s.ac.crashed) return this.finish(false, s.ac.crashed);
    st.tick?.(s, this, dt);
    const f = st.fail?.(s, this);
    if (f) this.mistake(f);
    // a step can end the lesson (abort) or send the student back to an earlier step to try again (redo)
    const ab = st.abort?.(s, this);
    if (ab) return this.finish(false, ab);
    const rd = st.redo?.(s, this);
    if (rd) { this.speak(rd.say); this.i = rd.goto - 1; s.ops.bolter = false; return this.next(true); }
    if (st.done(s, this, dt)) { s.sound.chime?.(); this.advance(); return; }
    if (!this.hinted && this.stepT > (st.hintAfter || 28)) {
      this.hinted = true;
      const h = st.hint || (st.target ? 'Look for the highlighted control, or press T to look at it.' : '');
      if (h) { this.el.why.textContent = h; this.el.why.hidden = false; this.speak(h); }
    }
    this.arrow();
  }
  // screen-edge arrow towards a highlighted control that is out of view
  arrow() {
    const a = this.el.arrow; if (!a) return;
    const id = this.sim.cockpit.highlightId;
    if (!id || this.sim.state.view !== 'cockpit') { a.hidden = true; return; }
    const wp = this.sim.cockpit.worldPos(id); if (!wp) { a.hidden = true; return; }
    const cam = this.sim.camera;
    const v = wp.clone().project(cam);
    const behind = wp.clone().applyMatrix4(cam.matrixWorldInverse).z > 0;
    const on = !behind && Math.abs(v.x) < 0.92 && Math.abs(v.y) < 0.9;
    if (on) { a.hidden = true; return; }
    let x = v.x, y = v.y; if (behind) { x = -x; y = -y; }
    const ang = Math.atan2(-y, x);
    const W = innerWidth, H = innerHeight, r = 0.42;
    a.style.left = (W / 2 + Math.cos(ang) * W * r) + 'px'; a.style.top = (H / 2 + Math.sin(ang) * H * r) + 'px';
    a.style.transform = `translate(-50%,-50%) rotate(${ang}rad)`; a.hidden = false;
  }
  score() {
    const m = this.metrics, avg = k => m[k] ? m[k].sum / m[k].n : null;
    let pts = 100 - this.mistakes.length * 15 - this.skipped * 10;
    if (avg('gsErr') != null) pts -= clamp((avg('gsErr') - 0.4) * 25, 0, 30);
    if (avg('luErr') != null) pts -= clamp((avg('luErr') - 3) * 2, 0, 20);
    if (avg('aoaErr') != null) pts -= clamp((avg('aoaErr') - 0.6) * 12, 0, 20);
    if (avg('turnAltErr') != null) pts -= clamp((avg('turnAltErr') - 40) * 0.2, 0, 20);
    pts = clamp(Math.round(pts), 0, 100);
    return { pts, stars: pts >= 85 ? 3 : pts >= 60 ? 2 : 1 };
  }
  finish(ok, why = '') {
    if (this.done) return;
    this.done = true;
    const L = this.lesson;
    const sc = ok ? this.score() : { pts: 0, stars: 0 };
    const m = this.metrics, avg = k => m[k] ? m[k].sum / m[k].n : null;
    const result = { id: L.id, title: L.n + '. ' + L.title, ok, why, time: this.t, mistakes: this.mistakes.slice(), skipped: this.skipped, ...sc,
      metrics: { gs: avg('gsErr'), lu: avg('luErr'), aoa: avg('aoaErr'), turnAlt: avg('turnAltErr') }, next: L.next };
    try { const done = JSON.parse(localStorage.getItem('mig29k-lessons') || '{}'); done[L.id] = Math.max(done[L.id] || 0, sc.stars); localStorage.setItem('mig29k-lessons', JSON.stringify(done)); } catch (e) { }
    this.el.bar.style.width = '100%';
    this.sim.cockpit.highlightId = null;
    if (this.el.arrow) this.el.arrow.hidden = true;
    this.speak(ok ? 'Lesson complete.' : 'Lesson ended. ' + why);
    this.sim.hooks.emit('lesson', { id: L.id, phase: 'end', result });
    setTimeout(() => { if (this.lesson === L) { this.lesson = null; this.el.box.hidden = true; } }, 2500);
  }
}
