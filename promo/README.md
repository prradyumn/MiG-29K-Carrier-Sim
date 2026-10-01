# Launch film: "Cleared Hot" (64.6 s)

Motion-graphics launch film for the sim. Everything is generated from code in this folder.

| Part | Tool | Where |
|---|---|---|
| Sim footage (19 shots + 2 UI stills, 60 fps) | the sim itself in `?capture` mode, headless Chrome on the GPU (Playwright) | `scripts/shots.js`, `scripts/capture.py` |
| Hero turntable (beauty + glowing wireframe) | Blender 4.2 Cycles, Metal GPU | `../blender/scripts/promo_turntable.py` |
| Score | Gemini `lyria-3.5` | `build/t_music.mp3` |
| Voice-over (12 lines + LSO radio call) | Gemini `gemini-3.8-flash-tts`, voices Algenib / Iapetus | `assets/vo/` |
| Textures (flare, light leak, blueprint, smoke) | Gemini `gemini-3-pro-image` | `assets/tex/` |
| Motion graphics | GSAP timeline + HTML/SVG, seeked per frame | `web/index.html`, `web/lib.js`, `web/scenes.js` |
| SFX and mix | numpy / scipy synthesis, cues exported from the timeline | `scripts/cues.py`, `scripts/audio.py` |
| Encode | FFmpeg (H.264 CRF 16, AAC 320k, loudnorm −14 LUFS) | `scripts/render.py`, `scripts/mux.sh` |

Rebuild (Python env with bpy, playwright, scipy: `~/.venvs/migsim`):
```
export GEMINI_API_KEY=...            # only for regenerating music / voice / textures (scripts/gem.py)
python scripts/capture.py all        # sim footage  -> build/shots/
python ../blender/scripts/promo_turntable.py build/tt/beauty beauty 20 259 48    # and 'wire' for the wireframe pass
python scripts/cues.py && python scripts/audio.py                                   # soundtrack -> build/mix.wav
python scripts/render.py 0 960 build/seg/a.mp4 && python scripts/render.py 960 1200 build/seg/b.mp4 \
  && python scripts/render.py 1200 2400 build/seg/c1.mp4 && python scripts/render.py 2400 3876 build/seg/c2.mp4
./scripts/mux.sh                     # -> out/
```
`python scripts/stills.py sheet.jpg 12.5 40.2 ...` renders review stills at given times. `build/` holds the large intermediates and is gitignored.
