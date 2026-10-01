# MiG-29K Carrier Sim: project context

This file is the hand-off context for this project. It tells a new Claude session (or a person) what exists, how it fits together, and what is left to do. Read it before changing anything.

## What this is

A browser flight simulator of the Indian Navy MiG-29K (INAS 303 "Black Panthers", side number 817) flying from a Vikramaditya-style carrier with a ski-jump. It runs on three.js r160. The aircraft model was built procedurally in headless Blender 4.2.

The user's brief (Pradyumn): "very realistic", "as realistic as possible", with first- and third-person views. Environment: ocean plus carrier. The pacing is mission checkpoints. Later instructions: the opening, flying and landing should all behave like the real MiG-29K; then (September 2026) "a sense of realism and an actual teaching simulation", where the start feels like working the real controls. That round added the clickable cockpit, the instructor with 12 lessons, the debrief and replay, emergencies, the carrier circuit, night, the tanker and controller mapping.

- **Live version:** https://claude.ai/artifact/DTw8N2wUQ23GrYhJ1hVqJR (private artifact, version 2).
  - To update it, republish `sim/index.html` with the other files passed through `files`, and pass the URL above as `url`.
  - Artifact pages get no `<!doctype>`/`<head>`: the host wraps them. The `sim/index.html` in this folder DOES have a doctype, for running locally, so strip the first and last lines before publishing.
  - The artifact host will not serve `.gltf` or `.bin`. That is why the model is a single glTF JSON with the buffer base64-embedded (`model/mig29k.json`).
  - Every file must be 15 MB or less.

## Folder map

| Path | What it is |
|---|---|
| `sim/` | Runnable simulator. Serve it over http (`python3 -m http.server 8000` inside `sim/`); ES modules won't load from `file://`. It needs internet access for three.js from jsdelivr. |
| `sim/main.js` | Scene, missions, cameras (with the head spring model), input, `control(id)` (the one place every cockpit control is actioned, from click, key, gamepad or instructor), time of day, model animation, sound and effect hooks, LSO report. It exposes `window.__sim` for testing: `advance(secs, ctl)` steps physics only; `tick(secs, ctl)` runs physics, ops, events, cockpit, instructor, recorder and tanker without rendering. |
| `sim/cockpit.js` | `Cockpit`: loads `model/controls.json`, raycast hover and click, switch, guard, lever and handle animation, panel legends with night backlight, live gauges (RPM, T4, ASI, ADI, altimeter), caution panel, master caution and warning, rudder pedals, gloved hands on stick and throttle, instructor highlight. `CONTROL_INFO` names every control. |
| `sim/instructor.js` | `LESSONS` (12 lessons: steps with `say`, `why`, `target`, `done`, `fail`, `hint`) and `Instructor` (step engine, speech, highlight, off-screen arrow, mistakes, score, stars in localStorage). |
| `sim/debrief.js` | `Recorder` (10 Hz flight data, events, 30 Hz frames for the last 45 s), `Replay` (instant replay with scrub and speed), `Debrief` (charts, event markers, mistakes with coaching tips, numbers). |
| `sim/tanker.js` | `Tanker`: buddy MiG-29K with the refuelling pod, Verlet hose, drogue, basket capture, push-in range, fuel transfer, hose break, pod lights. |
| `sim/bindings.js` | `Bindings`: gamepad, joystick and HOTAS mapping (bind, invert, dead zone, curve, absolute throttle axis), saved in localStorage. |
| `sim/flight.js` | The physics. `DATA` (aircraft data), `Engine` (RD-33MK), `Aircraft` (6-DOF body, systems, FBW laws, gear, hook, arrest, damage). |
| `sim/world.js` | Sky, sea, clouds, and the procedural carrier. `SHIP` holds the deck geometry, wires and start spots. `Carrier` handles deck motion, `surfaceAt`, `wakeAt` (air wake behind the ship) and `updateLens` (landing light). |
| `sim/ops.js` | `CarrierOps`: wire engagement, LSO voice calls, wave-off, bolter and hook-skip detection, grading. |
| `sim/hud.js` | Conformal HUD drawn in a 2D canvas and clipped to the combiner glass, plus the MFI-10-7 display canvases (boot test, engine page). |
| `sim/audio.js` | WebAudio sound synthesis (engines, APU, afterburner, wind, rolling, AoA tone, switch clicks) and speechSynthesis voice warnings, LSO and instructor calls. |
| `sim/effects.js` | Sprite effects: tyre smoke, hook sparks, wingtip vortices, contrails, transonic vapour cone, deck exhaust haze. |
| `sim/model/` | `mig29k.json` (the aircraft, 7.8 MB), `tex/` (4K PBR maps: `tex_SkinA/B_{base,orm,normal}.jpg`), `controls.json` (cockpit controls, 0.6 MB) and `upaz.json` (refuelling pod and drogue, 0.2 MB). |
| `blender/mig29k_indian_navy.blend` | The finished Blender model, textures packed. Every part is a separate object; moving parts pivot on their hinge lines. |
| `blender/cockpit_controls.blend`, `blender/upaz_refuel_pod.blend` | Sources for `controls.json` and `upaz.json`. |
| `blender/scripts/` | The build pipeline that generated the model (see below). |
| `tests/` | Node physics harness `ftest.mjs`, systems tests `systems.mjs`, Playwright step harness `run.py`, lesson tests `lessons.py` (scripted student), approach autopilot `ap.js`. |
| `renders/` | Blender renders and in-sim screenshots from development. |
| `promo/` | The 64.6 s launch film ("Cleared Hot") and everything that builds it: shot scripts, GSAP composition, audio and render scripts (see `promo/README.md`). The LinkedIn cut lives in `promo/out/`; the 1080p60 master is too big for GitHub and is kept locally only. |
| `mig29k_carrier_sim.zip` | The same runnable sim, zipped for sharing. |

## Running it locally (and the "keeps restarting" bug)

- Serve `sim/` over http (`python3 -m http.server` in `sim/`), or use VS Code Live Server.
- `.vscode/settings.json` sets Live Server to serve `/sim` (http://127.0.0.1:5501/) and to ignore `promo/`, `blender/`, `tests/`, `renders/`, zips, `.blend` and logs.
- Live Server reloads the page when any watched file changes, so film renders or test captures written elsewhere in the workspace used to reload the sim mid-mission. Keep that ignore list if you add new output folders.
- `?capture` mode stops the real-time loop. A recorder then steps frames with `__sim.renderStep(dt)`, and a shot script can take the camera with `window.__camHook`. `promo/scripts/shots.js` uses this.
- `tests/stability.py` plays every mission and some lessons in real time with keyboard input, in GPU Chrome. It flags reloads, resets, errors, crashes and heap growth. Last run: none, at 46–56 fps.

## Conventions (important)

- **Model and body frame (three.js):** x = right, y = up, z = aft (+z points to the tail); the nose points to −z. `st2z(s)` converts a Blender fuselage station `s` (metres from the nose) to model z. The pipeline uses `S0 = 9.25` and `Y(s) = S0 − s`.
- **Aerodynamic tables** are in body axes. Angles are in radians internally; the UI shows degrees.
- **Ship-local frame:**
  - Bow is −z and the deck is at `SHIP.deckY = 19`.
  - The angled deck runs 6° to port. `landA` = (0, 139) at the stern ramp, and `landDir` points forward along the landing centreline.
  - Wires sit at t = 38, 50 and 62 m from `landA`. Wire 2 is the target.
  - Launch spots: `SHIP.start[0]` is the long run (195 m), `SHIP.start[1]` the short run (105 m).
- **Landing light geometry:** the aimed hook touchdown point is 5 m short of wire 2. The light is set for a hook-to-eye height of 4.3 m and a 10.5 m aft offset at 10.5° AoA, on a 4° glide slope. On a calm sea a steady approach catches wire 2.
- **Cockpit eye:** `EYE = (0, 1.16, st2z(4.20))`. At runtime `main.js` lowers `ck_coaming` by 5 cm and `HUD_Base` by 3 cm, which gives about 12° of view over the nose. These tweaks are NOT in the .blend file. Bake them into `cockpit.py` if the model is ever rebuilt.
- **Cockpit controls** (`controls.json`): each moving part is an object named `Ctl_<id>` or `Guard_<id>` whose origin is on its hinge, with local X = hinge axis, Y = panel up and Z = panel normal. Toggles and levers rotate about X, and buttons and T-handles slide along Z. glTF extras carry `ctl`, `kind`, `panel`, and the legend position `u`, `v`. The faces `PanelFace_*`, `Gauge_*`, `CWP_Screen` and `Lamp_*` have 0–1 UVs and are drawn live on canvases (`flipY = false`). Panels: `L` left front (gear, flaps, hook, park brake, RPM and T4), `R` right front (caution panel, canopy, wing fold, lights, probe, FCS reset), `S` start panel on the left wall (battery, pump, APU, engine masters, START buttons, generators), `M` master warning and caution on the main panel.

## Systems modelled (all in `flight.js` unless noted)

- **Engines** (two RD-33MK):
  - States: off → starting → running.
  - The starter needs APU air: it spins to 26%, lights off at 18% and settles at 70% idle.
  - Spool rates are limited. Afterburner needs N above 97.5%. EGT is modelled. The ЧР emergency take-off rating applies on the holdback, and for 6 s after launch, at full afterburner.
  - Thrust: dry 53 kN, afterburner 88.3 kN each.
  - Switches (`ac.sw`): fuel boost pump, engine masters (fuel valves), generators. A ground start needs the master ON, APU air and throttle at idle; with the pump OFF there is no light-off after 30 s. Advancing the throttle during a ground start is a hot start: above 870 °C for 2.5 s the engine is damaged and will not restart; master OFF in time saves it. Airstart: windmilling above 330 km/h, no APU needed, and the start fuel control ignores the throttle.
- **Electrics and hydraulics:**
  - `power()` returns gen, apu, bat or none; `gen` needs a running engine with its generator switch ON. The HUD, MFDs and FBW self-test need gen or APU power; the standby gauges and caution panel run on the battery.
  - The battery lasts about 15 minutes on its own and recharges from the generators.
  - The APU starts in 18 s and runs until its switch is turned OFF.
  - Two hydraulic systems, both driven from either engine; a failed system halves actuator rates. Wing fold only works on deck, below 6 m/s relative to the deck, with hydraulic pressure.
- **Failures** (for training): `failEngine(i)` flame-out, `fireEngine(i)` (put out 3 s after that engine's master is OFF, otherwise the aircraft is lost after 45 s), `failFcs('transient'|'hard')` (DIRECT law until FCS RESET clears a transient fault), `failHyd(i)`.
- **Stick shaker:** `ac.shaker` 0–1, from 3° below the active law's AoA limit (from 20° in DIRECT). It shakes the stick and the view and rumbles the controller.
- **Fly-by-wire:**
  - Laws: GROUND, DIRECT, LANDING, NORMAL. NORMAL uses dynamic inversion with a flight-path hold.
  - Limits: 8 g clean, 7 g with stores, 4 g in landing configuration. AoA limit 26°, or 20° in landing configuration.
  - There is a 9 s self-test at start-up.
- **Configuration limits:** gear 500 km/h (damaged above 600); flaps 400; canopy 60 (lost above 230). Speed brake is inhibited with the gear down.
- **Structure:** over-g accumulates above 9 g; failure at 11.5 g. On deck or during an arrest, the structural g is taken from aerodynamic lift only, because gear and cable loads would otherwise trip false failures.
- **Landing gear:** spring/damper struts with oleo extension, anti-skid brakes and nose-wheel steering. A held brake grips statically (stiff friction near zero slip), so a braked jet does not creep on the moving deck. Rolling on the parking brake above 22 m/s bursts the main tyres. Gear collapses above 7.5 m/s sink. Tail scrapes are not fatal within tolerance.
- **LSO wave-off:** "dirty" means gear not down or hook handle not down (`hookCmd`). It deliberately does not use the hook's current angle, because the hook swinging up over the stern edge used to trigger a false wave-off at touchdown. The hook-up rule is skipped for touch-and-go passes (`ops.touchAndGo`).
- **Hook:** the arm is damped and rides on the deck. It bounces if sink at first contact exceeds 4.2 m/s. Engagement needs the hook tip within 0.14 m of the deck; the cable parts above 290 km/h (`ops.js`).
- **Arresting engine:**
  - The pull is metered each step as F = m·v²/(2·remaining) + thrust, capped at 4.5 g. The result is an ~82 m run-out at about 2 g peak.
  - After the stop, the cable keeps tension and rolls the jet back about a metre. Raising the hook (H) releases the wire.
- **Restraining stops (holdback):**
  - A spring holds the jet on the stop, with the offset clamped to 0.4 m.
  - In the cold-start mission the stops rise only when the jet is within 1 m of its spot, stopped, with the FBW ready, wings spread and canopy closed. If it rolls more than 3 m away, it has to restart.
- **Carrier:** deck heave, pitch and roll, and an air wake with a downdraft about 240 m behind the stern, all scaled by the sea-state setting. The landing light is gyro-stabilised and flashes red for a wave-off. At night: deck edge, landing-area edge and centreline lights, vertical drop lights under the stern, red ramp lights, masthead and navigation lights, and two island floodlights (`Carrier.setNight`).
- **Refuelling** (`tanker.js`): hose 15.5 m, basket radius 0.37 m. Capture happens when the probe tip enters the basket cone closing at 0.3–3.2 m/s; faster breaks the hose. Fuel flows at 13.3 kg/s once the hose is pushed in 1–3.5 m; the HUD shows PUSH IN, IN RANGE or BACK OFF. `probeTipWorld()` in `main.js` takes the tip from the current physics pose.
- **Pilot's body** (`updateCamera`): the head is a damped spring (2.1 Hz, ζ 0.42) driven by body accelerations. It shoves back at launch, sinks under g, bobs at touchdown and pitches forward in the trap. Grey-out builds with a g-tolerance time constant (grayscale filter and vignette); red-out below −1.8 g.

## Missions (`data-scn` in `index.html`, `startScenario(kind, run, opts)` in `main.js`)

- `cold`: cold and dark with wings folded; the checklist is shown top right (not during lessons).
- `deck`: long launch at 18.8 t.
- `short`: short launch at 16.4 t with light fuel.
- `approach`: 5.2 km final on the 4° slope, gear, flaps and hook down, 1,600 kg fuel. `opts.night`, and `opts.hook: false` for touch-and-go practice.
- `circuit`: 4 km astern, 600 m to starboard, 300 m, 650 km/h, for the full pattern.
- `tanker`: 5,000 m, the tanker 600 m ahead at 500 km/h, 1,300 kg fuel.
- `free`: 3,000 m, clean (`opts.alt`, `opts.speed`).
- Time of day (`applyTimeOfDay`): day, dusk or night, from Settings or a lesson's `opts.night`.

## Lessons (`instructor.js`)

1 cold start, 2 ski-jump launch, 3 basic handling, 4 on-speed AoA, 5 flying the ball (wave-off), 6 the trap, 7 carrier circuit, 8 touch-and-go (bolter), 9 engine failure on launch (with airstart), 10 in-flight emergencies (fire, FCS, hydraulics), 11 night trap, 12 air refuelling.

Each step speaks its instruction and shows why. The step's control is highlighted in the cockpit and points by an arrow when off screen; T turns the head to it. Mistakes come from the lesson's `fail` checks and from `ac.event('mistake')`. The score is 100 minus mistakes and flying errors (glide slope, lineup, AoA, altitude in turns), shown as 1–3 stars. The debrief opens at the end.

## Controls

- Mouse: click any cockpit switch, guard, lever or handle (the first click on a guarded control lifts its guard); hover for its name and state. Drag to look, wheel to zoom.
- W/S pitch, A/D roll, Q/E rudder.
- Shift/R and F throttle. The throttle stops at the MIL detent; press again for afterburner. Tab toggles full afterburner and MIL; 0 is idle.
- Start panel: 1 battery, 5 fuel pump, 2 APU, 3 and 4 left and right engine (the first press sets the master ON, the second presses START), 6 generators, 7 nav lights and beacon, End engine masters off (deck), J master caution and warning reset.
- Space releases the restraining stops.
- Configuration: G gear, L flaps, H hook, B speed brake, X wheel brakes, N parking brake, O wing fold, K canopy, I refuelling probe.
- Views: C cockpit/chase, V cycles views. T looks at the highlighted control, Z instant replay.
- Settings: Y mouse stick, M FBW law, U units. Controllers are mapped under Settings → Controllers.
- P or Esc pauses (Esc also closes the debrief or replay). Backspace restarts the mission or lesson.

## Verified numbers (Node harness, `tests/ftest.mjs`)

- **Launches:** the long run leaves the ramp at about 286 km/h airspeed. The short run is airborne at about 241 km/h at 16.4 t.
- **Speed:** about 1,500 km/h airspeed at sea level with afterburner; about 1,150 km/h at MIL. It reaches Mach 1.7 at 11 km.
- **Handling:**
  - roll rate about 205°/s;
  - the 7–7.5 g limiter holds;
  - the AoA limiter holds at 25–26°.
- **Approach:** hands-off, the path hold settles at about −3.3 m/s at 230 km/h and AoA 10.5–11°.
- **Traps:**
  - Calm sea (`SEA=0`): wire 2 every time, stopping in 82.7 m at 1.9 g.
  - Moderate or rough sea: the harness autopilot sometimes lands short or skips its hook in the air-wake downdraft. A human needs to add power in close.

- `level` at sea level on full afterburner passes 1,620 km/h airspeed after about 85 s and fails on the dynamic-pressure limit. That is correct and unchanged.

Run: `cd tests && npm i three@0.160.0 && node ftest.mjs <launch [short] | level | turn | slow | approach | trap <dist>>`, with `SEA=0|1|1.8`. The harness imports `../sim/flight.js` and `../sim/world.js`, which import bare `three`: from the project root, `ln -s tests/node_modules node_modules` first (it is gitignored).

`node systems.mjs` runs 27 checks: the correct cold start, the hot start (and saving it), no fuel pump, start before the APU, battery drain, fire handled and ignored, flame-out and airstart, FCS failure and reset, hydraulic failure, and tyres burst on the parking brake.

The browser tests use headless Playwright with SwiftShader. Environment on this Mac: `~/.venvs/migsim` (Python 3.11 from `uv`, with `bpy==4.2.0`, `playwright` and chromium).
- `run.py` takes a JSON list of steps such as `["click", sel]`, `["press", key]`, `["eval", js]` or `["shot", path]`.
- `lessons.py <id,id|all> [shots]` runs lessons with a scripted student that follows the instructor. It clicks the highlighted controls through `cockpit.click`, uses `ap.js` for approaches and adds its own circuit and formation flying. It also makes a real mouse click on the battery guard. All 12 lessons complete with a calm sea. SwiftShader frames take seconds, so drive time with `window.__sim.tick()` rather than wall-clock time, and wait for `state.lookTarget` to clear before aiming real mouse clicks.

## Blender pipeline (`blender/scripts/`)

- **Environment:** run with the pip `bpy==4.2.0` module (Python 3.11; `~/.venvs/migsim/bin/python` here); headless is fine. The original airframe scripts use absolute paths `/home/claude/mig/...` from the cloud session, so change `sys.path` and the `out/` paths to run them locally. The newer scripts (`controls.py`, `upaz.py`, `embed_gltf.py`) run from anywhere.
- **`controls.py <out_dir>`:** builds the interactive cockpit controls (panels, toggles, guards, gear lever, T-handles, gauge and caution faces, pedals, gloved hands) in the cockpit's own coordinates, then exports `controls.gltf` and `controls.blend`. `python embed_gltf.py <out>/controls.gltf sim/model/controls.json` embeds it.
- **`upaz.py <out_dir>`:** builds the buddy refuelling pod (ram-air turbine, signal lights) and the drogue basket; embed it to `sim/model/upaz.json` the same way.
- **`lib.py`:** geometry helpers (`loft`, `superellipse_ring`, `surface_panel`, `lathe`, `set_pivot_frame`, and others).
- **`build_airframe.py`:** fuselage, wings, tails and canopy from section tables (`FUS`, `BODY`, `NAC`, `BOOM`, `CAN`).
- **`parts.py`:** nozzles, landing gear, stores and other details.
- **Build order (approximate):**
  1. `main.py` builds `out/geo.blend`.
  2. UV unwrap and `bake_maps.py`: position, normal, ID and AO maps.
  3. `texpaint.py` and `decals.py`: numpy-painted base, ORM and normal maps with the roundel, panther badge, "817" and warning markings.
  4. `apply_tex.py`, `patch_ifr.py` and `fix_mats.py`: material and small geometry fixes.
  5. `cockpit.py` and `add_cockpit.py` produce `out/final.blend`.
  6. `export_gltf.py` writes `sim/model/mig29k.gltf`; convert it to a single JSON with the buffer base64-embedded.
- **`hero.py`:** Cycles renders on a deck and ocean scene.

## Known limitations and ideas for next steps

- The carrier is procedural and fairly plain (a box-like island, no deck crew, no catapult shuttle; Vikramaditya has none anyway).
- Over-nose view is about 12°, so the deck slides under the HUD in the last ~300 m.
- There is one throttle for both engines, so single-engine drills use the engine masters.
- No weapons, radar modes or damage visuals.
- The original merged random switch fields on the consoles are still decorative; only the new panels are live.
- Possible upgrades:
  - bake the cockpit tweaks into the model;
  - add a detailed Vikramaditya island and deck crew;
  - split the throttle into two levers;
  - a hand that reaches for the clicked switch;
  - replace the speechSynthesis voices with recorded audio.
