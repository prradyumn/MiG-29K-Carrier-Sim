MiG-29K Carrier Sim  (INAS 303 "Black Panthers", INS Vikramaditya)
=====================================================================

Run it locally
--------------
Browsers block ES modules on file:// pages, so serve the folder over http:

    cd path/to/this/folder
    python3 -m http.server 8000

then open http://localhost:8000/ in Chrome, Edge or Safari.
three.js (r160) is loaded from cdn.jsdelivr.net, so you need to be online.

Files
-----
index.html, main.js       page, missions, cameras, input, cold-start checklist
flight.js                 6-DOF flight model, RD-33MK engines + APU, electrics/hydraulics,
                          FBW laws, oleo landing gear, tail hook, arresting engine, damage
ops.js                    carrier ops: wire engagement, LSO calls, wave-off, bolter, grading
effects.js                tyre smoke, hook sparks, wingtip vortices, contrails, vapour cone
world.js                  sky, sea, clouds, procedural Vikramaditya-style carrier
hud.js                    conformal HUD + MFI-10-7 displays (canvas textures)
audio.js                  synthesised engine / APU / afterburner / wind sound, voice warnings
model/mig29k.json (+ tex/)   the Blender-built aircraft (glTF 2.0, geometry embedded), 4K PBR textures
assets/waternormals.jpg   generated sea normal map

Blender source: mig29k_indian_navy.blend (textures packed) - all parts are separate,
hinged objects (flaps, slats, ailerons, stabilators, rudders, wing fold,
canopy, gear, hook, airbrake, IFR probe) with pivots on their hinge lines.

Missions
--------
Cold start & launch  battery (1), APU (2), engines (3, 4), FBW self-test, spread wings (O),
                     close canopy (K), flaps (L); the stops rise, release the brake (N),
                     full afterburner (Tab), Space to launch.
Ski-jump launch      long position, 195 m, 18.8 t.     Short launch   105 m, 16.4 t.
Carrier trap         5 km final on the 4 deg lens. On-speed AoA 10.5 deg, MIL at touchdown.
Free flight          3,000 m over the Arabian Sea.

Realism notes: engine start needs APU air; FBW self-test before launch; gear/flap/canopy
speed limits with damage; wing fold only when stopped on deck; the arresting engine is
metered for an ~82 m run-out (about 2 g); the lens is set for MiG-29K hook-to-eye geometry;
deck motion and ship air wake scale with the sea-state setting.
