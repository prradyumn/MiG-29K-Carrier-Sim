# MiG-29K Carrier Sim: project context

This file is the hand-off context for this project. It tells a new Claude session (or a person) what exists, how it fits together, and what is left to do. Read it before changing anything.

## What this is

A browser flight simulator of the Indian Navy MiG-29K (INAS 303 "Black Panthers", side number 817) flying from a Vikramaditya-style carrier with a ski-jump. It runs on three.js r160. The aircraft model was built procedurally in headless Blender 4.2.

The user's brief (Pradyumn): "very realistic", "as realistic as possible", with first- and third-person views. Environment: ocean plus carrier. The pacing is mission checkpoints. The last instruction was that the opening, flying and landing should all behave like the real MiG-29K.

- **Live version:** https://claude.ai/artifact/DTw8N2wUQ23GrYhJ1hVqJR (private artifact, version 2).
  - To update it, republish `sim/index.html` with the other files passed through `files`, and pass the URL above as `url`.
  - Artifact pages get no `<!doctype>`/`<head>`: the host wraps them. The `sim/index.html` in this folder DOES have a doctype, for running locally, so strip the first and last lines before publishing.
  - The artifact host will not serve `.gltf` or `.bin`. That is why the model is a single glTF JSON with the buffer base64-embedded (`model/mig29k.json`).
  - Every file must be 15 MB or less.

## Folder map

| Path | What it is |
|---|---|
| `sim/` | Runnable simulator. Serve it over http (`python3 -m http.server 8000` inside `sim/`); ES modules won't load from `file://`. It needs internet access for three.js from jsdelivr. |
| `sim/main.js` | Scene, missions, cameras, input, cold-start checklist, model animation, sound and effect hooks, LSO report. It exposes `window.__sim` for testing (`advance(secs, ctl)` steps physics synchronously). |
| `sim/flight.js` | The physics. `DATA` (aircraft data), `Engine` (RD-33MK), `Aircraft` (6-DOF body, systems, FBW laws, gear, hook, arrest, damage). |
| `sim/world.js` | Sky, sea, clouds, and the procedural carrier. `SHIP` holds the deck geometry, wires and start spots. `Carrier` handles deck motion, `surfaceAt`, `wakeAt` (air wake behind the ship) and `updateLens` (landing light). |
| `sim/ops.js` | `CarrierOps`: wire engagement, LSO voice calls, wave-off, bolter and hook-skip detection, grading. |
| `sim/hud.js` | Conformal HUD drawn in a 2D canvas and clipped to the combiner glass, plus the MFI-10-7 display canvases (boot test, engine page). |
| `sim/audio.js` | WebAudio sound synthesis (engines, APU, afterburner, wind, rolling, AoA tone) and speechSynthesis voice warnings and LSO calls. |
| `sim/effects.js` | Sprite effects: tyre smoke, hook sparks, wingtip vortices, contrails, transonic vapour cone, deck exhaust haze. |
| `sim/model/` | `mig29k.json` (the aircraft, 7.8 MB) and `tex/` (4K PBR maps: `SkinA/B_{base,orm,normal}.jpg`). |
| `blender/mig29k_indian_navy.blend` | The finished Blender model, textures packed. Every part is a separate object; moving parts pivot on their hinge lines. |
| `blender/scripts/` | The build pipeline that generated the model (see below). |
| `tests/` | Node physics harness `ftest.mjs`, Playwright browser harness `run.py`, approach autopilot `ap.js`. |
| `renders/` | Blender renders and in-sim screenshots from development. |
| `mig29k_carrier_sim.zip` | The same runnable sim, zipped for sharing. |

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

## Systems modelled (all in `flight.js` unless noted)

- **Engines** (two RD-33MK):
  - States: off → starting → running.
  - The starter needs APU air: it spins to 26%, lights off at 18% and settles at 70% idle.
  - Spool rates are limited. Afterburner needs N above 97.5%. EGT is modelled. The ЧР emergency take-off rating applies on the holdback, and for 6 s after launch, at full afterburner.
  - Thrust: dry 53 kN, afterburner 88.3 kN each.
- **Electrics and hydraulics:**
  - `power()` returns gen, apu, bat or none; the HUD and displays need gen or APU power.
  - The APU starts in 18 s and shuts itself down later.
  - Hydraulics come from running engines. Wing fold only works on deck, below 6 m/s relative to the deck, with hydraulic pressure.
- **Fly-by-wire:**
  - Laws: GROUND, DIRECT, LANDING, NORMAL. NORMAL uses dynamic inversion with a flight-path hold.
  - Limits: 8 g clean, 7 g with stores, 4 g in landing configuration. AoA limit 26°, or 20° in landing configuration.
  - There is a 9 s self-test at start-up.
- **Configuration limits:** gear 500 km/h (damaged above 600); flaps 400; canopy 60 (lost above 230). Speed brake is inhibited with the gear down.
- **Structure:** over-g accumulates above 9 g; failure at 11.5 g. On deck or during an arrest, the structural g is taken from aerodynamic lift only, because gear and cable loads would otherwise trip false failures.
- **Landing gear:** spring/damper struts with oleo extension, anti-skid brakes and nose-wheel steering. Gear collapses above 7.5 m/s sink. Tail scrapes are not fatal within tolerance.
- **Hook:** the arm is damped and rides on the deck. It bounces if sink at first contact exceeds 4.2 m/s. Engagement needs the hook tip within 0.14 m of the deck; the cable parts above 290 km/h (`ops.js`).
- **Arresting engine:**
  - The pull is metered each step as F = m·v²/(2·remaining) + thrust, capped at 4.5 g. The result is an ~82 m run-out at about 2 g peak.
  - After the stop, the cable keeps tension and rolls the jet back about a metre. Raising the hook (H) releases the wire.
- **Restraining stops (holdback):**
  - A spring holds the jet on the stop, with the offset clamped to 0.4 m.
  - In the cold-start mission the stops rise only when the jet is within 1 m of its spot, stopped, with the FBW ready, wings spread and canopy closed. If it rolls more than 3 m away, it has to restart.
- **Carrier:** deck heave, pitch and roll, and an air wake with a downdraft about 240 m behind the stern, all scaled by the sea-state setting. The landing light is gyro-stabilised and flashes red for a wave-off.

## Missions (`data-scn` in `index.html`, `startScenario()` in `main.js`)

- `cold`: cold and dark with wings folded; the checklist is shown top right.
- `deck`: long launch at 18.8 t.
- `short`: short launch at 16.4 t with light fuel.
- `approach`: 5.2 km final on the 4° slope, gear, flaps and hook down, 1,600 kg fuel.
- `free`: 3,000 m, clean.

## Controls

- W/S pitch, A/D roll, Q/E rudder.
- Shift/R and F throttle. The throttle stops at the MIL detent; press again for afterburner. Tab toggles full afterburner and MIL; 0 is idle.
- Start and shutdown: 1 battery, 2 APU, 3 and 4 engine start, End shutdown on deck.
- Space releases the restraining stops.
- Configuration: G gear, L flaps, H hook, B speed brake, X wheel brakes, N parking brake, O wing fold, K canopy, I refuelling probe.
- Views: C cockpit/chase, V cycles views.
- Settings: Y mouse stick, M FBW law, U units.
- P or Esc pauses, Backspace restarts.

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

Run: `cd tests && npm i three@0.160.0 && node ftest.mjs <launch [short] | level | turn | slow | approach | trap <dist>>`, with `SEA=0|1|1.8`. The harness imports `../sim/flight.js` and `../sim/world.js`.

The browser tests (`run.py`) use headless Playwright with SwiftShader. They serve `sim/`, route jsdelivr requests to the local `node_modules/three`, and load `sim/index.html`. Each step is a JSON list such as `["click", sel]`, `["press", key]`, `["eval", js]`, `["shot", path]`. SwiftShader frames take seconds, so drive the physics with `window.__sim.advance()` rather than waiting on wall-clock time.

## Blender pipeline (`blender/scripts/`)

- **Environment:** run with the pip `bpy==4.2.0` module; headless is fine. The scripts use absolute paths `/home/claude/mig/...` from the cloud session, so change `sys.path` and the `out/` paths to run them locally.
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

- The carrier is procedural and fairly plain (a box-like island, no deck crew, no jet blast deflector animation, no catapult shuttle; Vikramaditya has none anyway).
- Over-nose view is about 12°, so the deck slides under the HUD in the last ~300 m.
- No weapons, radar modes, air-to-air refuelling tanker, or damage visuals.
- A gamepad is supported, but a HOTAS mapping UI does not exist.
- Possible upgrades:
  - bake the cockpit tweaks into the model;
  - add a detailed Vikramaditya island;
  - add a case III night approach with deck lighting;
  - add a tanker for probe refuelling;
  - replace the LSO speechSynthesis voice with recorded audio.
