// Airframe weathering on top of the baked 4K skin maps (shader-side, no extra downloads):
//  - grime settled into panel lines and crevices (from the baked occlusion map, so it also darkens direct light),
//  - salt / water streaks running aft and down the way spray and rain dry on a carrier jet,
//  - exhaust soot round the nozzles, the engine bay and the tail stinger, streaked by the flow,
//  - fine paint grain and wear (roughness / albedo variation at a few cm, scratches at grazing light),
//  - wet skin (darker, glossier) when the deck is awash in a rough sea.
// Positions are taken in the model frame (x right, y up, z aft, metres) so every moving part shares one pattern.
import * as THREE from 'three';

function grainTexture(N = 256) {
  // tileable: r = fbm grain, g = scratches (thin random strokes), b = blotches
  const c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d');
  const img = g.createImageData(N, N);
  const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  const vn = (x, y, f) => { const cs = N / f, X = x / cs, Yy = y / cs, xi = Math.floor(X), yi = Math.floor(Yy), u0 = X - xi, v0 = Yy - yi, s = t => t * t * (3 - 2 * t), u = s(u0), v = s(v0), w = q => ((q % f) + f) % f;
    const a = hash(w(xi), w(yi)), b = hash(w(xi + 1), w(yi)), cc = hash(w(xi), w(yi + 1)), d = hash(w(xi + 1), w(yi + 1)); return a + (b - a) * u + (cc - a) * v + (a - b - cc + d) * u * v; };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (x + y * N) * 4;
    img.data[i] = (vn(x, y, 64) * 0.5 + vn(x, y, 32) * 0.3 + vn(x, y, 128) * 0.2) * 255;
    img.data[i + 1] = 0;
    img.data[i + 2] = (vn(x, y, 4) * 0.6 + vn(x, y, 8) * 0.4) * 255;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // scratches: short faint strokes in the green channel (drawn with wrap-around)
  g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
  let q = 11; const r = () => ((q = (q * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let k = 0; k < 260; k++) {
    const x0 = r() * N, y0 = r() * N, a = r() * Math.PI, L = 4 + r() * 22;
    g.strokeStyle = `rgba(0,${Math.round(40 + r() * 120)},0,1)`; g.lineWidth = 0.6 + r() * 0.6;
    for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) { g.beginPath(); g.moveTo(x0 + ox, y0 + oy); g.lineTo(x0 + ox + Math.cos(a) * L, y0 + oy + Math.sin(a) * L); g.stroke(); }
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; return t;
}

export class AircraftDetail {
  constructor() {
    this.u = { uGrain: { value: grainTexture() }, uToModel: { value: new THREE.Matrix4() }, uWet: { value: 0 }, uSoot: { value: 1 } };
    this.mats = [];
  }
  apply(model) {
    this.model = model;
    const seen = new Set();
    model.traverse(o => {
      if (!o.isMesh || !o.material || seen.has(o.material)) return;
      const m = o.material; seen.add(m);
      if (m.name === 'SkinA' || m.name === 'SkinB') this.patch(m, true);
      else if (/^(GearPaint|AirframeMisc|Dielectric|Hook|WheelHub)$/.test(m.name)) this.patch(m, false);
      else if (m.name === 'NozzleMetal') this.patchNozzle(m);
    });
  }
  patch(m, skin) {
    const U = this.u;
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = 'uniform mat4 uToModel; varying vec3 vMP; varying vec3 vMN;\n' + sh.vertexShader
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
          vMP = (uToModel * modelMatrix * vec4(transformed, 1.0)).xyz;
          vMN = normalize(mat3(uToModel) * mat3(modelMatrix) * objectNormal);`);
      sh.fragmentShader = `uniform sampler2D uGrain; uniform float uWet, uSoot; varying vec3 vMP; varying vec3 vMN;
        float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float wNoise(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
          return mix(mix(wHash(i), wHash(i + vec2(1, 0)), u.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), u.x), u.y); }
        \n` + sh.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec3 an = abs(vMN); vec3 tw = an / (an.x + an.y + an.z);
          vec4 gr = texture2D(uGrain, vMP.zy * 0.9) * tw.x + texture2D(uGrain, vMP.xz * 0.9) * tw.y + texture2D(uGrain, vMP.xy * 0.9) * tw.z;
          vec4 gf = texture2D(uGrain, vMP.zy * 7.0) * tw.x + texture2D(uGrain, vMP.xz * 7.0) * tw.y + texture2D(uGrain, vMP.xy * 7.0) * tw.z;
          // streaks: run aft on the top surfaces, aft-and-down on the sides
          vec2 sc = vec2((vMP.x + vMP.y * 0.7) * 26.0, vMP.z * 1.1 + vMP.y * 2.4);
          float streak = wNoise(sc) * 0.65 + wNoise(sc * vec2(2.3, 1.7) + 3.1) * 0.35;
          float salt = smoothstep(0.62, 0.95, streak) * (0.5 + 0.5 * gr.b);
          float grime = smoothstep(0.55, 0.15, streak) * 0.5 + gr.b * 0.5;
          ${skin ? `
          // occlusion-driven dirt in panel seams and corners (the baked AO is in the ORM texture's red channel)
          #ifdef USE_AOMAP
            float aoG = texture2D(aoMap, vAoMapUv).r;
            diffuseColor.rgb *= mix(1.0, aoG, 0.45);
          #endif` : ''}
          diffuseColor.rgb *= 0.93 + 0.1 * gr.b - 0.05 * grime;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.62, 0.60), salt * 0.10);
          // exhaust soot: engine bay, nozzle surrounds and the tail stinger, darkest underneath and streaked aft
          float sootZ = smoothstep(3.3, 5.0, vMP.z) * (1.0 - smoothstep(6.4, 7.2, vMP.z));
          float sootX = 1.0 - smoothstep(1.35, 1.75, abs(vMP.x));
          float sootN = 0.55 + 0.45 * wNoise(vec2(vMP.x * 9.0, vMP.z * 1.6 + vMP.y * 4.0));
          float soot = sootZ * sootX * sootN * (0.55 + 0.45 * smoothstep(0.2, -0.6, vMP.y)) * uSoot;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.035, 0.032, 0.03), clamp(soot * 0.75, 0.0, 0.85));
          float wetK = uWet * (0.6 + 0.4 * smoothstep(-0.2, 0.6, vMN.y));
          diffuseColor.rgb *= 1.0 - 0.28 * wetK;`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor *= 0.86 + 0.28 * gf.r + 0.15 * grime - 0.25 * salt;
          roughnessFactor = mix(roughnessFactor, 0.85, soot * 0.6);
          roughnessFactor = mix(roughnessFactor, max(0.08, roughnessFactor * 0.35), wetK);
          roughnessFactor = clamp(roughnessFactor - gf.g * 0.18, 0.04, 1.0);   // scratches: burnished, catch the light`);
    };
    const k0 = m.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : () => '';
    m.customProgramCacheKey = () => k0() + '|weather' + (skin ? 'S' : 'P');
    m.needsUpdate = true; this.mats.push(m);
  }
  // RD-33MK nozzle petals: heat-tinted titanium / Inconel, straw and bronze fading to blue then sooty black at the lip,
  // with streaks along the petals
  patchNozzle(m) {
    const U = this.u;
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = 'uniform mat4 uToModel; varying vec3 vMP;\n' + sh.vertexShader
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vMP = (uToModel * modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = 'uniform sampler2D uGrain; varying vec3 vMP;\n' + sh.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
          float zt = clamp((vMP.z - 4.85) / 1.26, 0.0, 1.0);                     // 0 at the nozzle root .. 1 at the lip
          float ang = atan(vMP.y + 0.45, abs(vMP.x) - 0.87);
          float petal = texture2D(uGrain, vec2(ang * 1.9, zt * 0.35)).r;          // streaks along each petal
          vec3 straw = vec3(0.55, 0.42, 0.25), bronze = vec3(0.42, 0.26, 0.16), blue = vec3(0.16, 0.18, 0.28), burnt = vec3(0.05, 0.045, 0.045);
          vec3 tint = mix(straw, bronze, smoothstep(0.1, 0.45, zt + petal * 0.15));
          tint = mix(tint, blue, smoothstep(0.4, 0.75, zt + petal * 0.2));
          tint = mix(tint, burnt, smoothstep(0.7, 1.0, zt + petal * 0.25));
          diffuseColor.rgb *= mix(vec3(1.0), tint * 1.6, 0.85);`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = clamp(roughnessFactor * (0.8 + 0.5 * petal) + zt * 0.25, 0.1, 1.0);`);
    };
    const k0 = m.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : () => '';
    m.customProgramCacheKey = () => k0() + '|nozzle';
    m.needsUpdate = true;
  }
  update(wet) {
    if (!this.model) return;
    this.u.uToModel.value.copy(this.model.matrixWorld).invert();
    this.u.uWet.value += (wet - this.u.uWet.value) * 0.02;
  }
}
