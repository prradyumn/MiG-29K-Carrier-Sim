// Ocean: Gerstner-wave surface on a camera-centred polar grid, shaded with three's physical material (ior 1.33
// reflectance, sun glint, sky reflections, the ship's shadow), detail ripples from scrolling normal maps, whitecaps
// on steep crests, and the carrier's wake (churned white water behind the stern widening into a V, bow wave).
// The waves are visual only: the physics sea surface stays at y = 0 and the ship motion is modelled separately.
import * as THREE from 'three';

const TAU = Math.PI * 2;
// wavelengths (m); amplitudes scale with the sea state. Directions spread around the wind (towards +z, from the north)
// 20 components from 110 m to 1.9 m, seeded; short waves spread wider around the wind than the swell does
const WAVES = (() => {
  let q = 7; const r = () => ((q = (q * 1664525 + 1013904223) >>> 0) / 4294967296);
  return Array.from({ length: 20 }, (_, i) => { const L = 110 * Math.pow(1.9 / 110, i / 19), spread = 0.45 + 0.9 * i / 19; return [L * (0.9 + 0.2 * r()), (r() * 2 - 1) * spread]; });
})();

export class Ocean extends THREE.Mesh {
  constructor(normals) {
    // polar grid: rings spaced geometrically from 1.5 m to 45 km, so detail sits where the camera is
    const RINGS = 200, SEGS = 320, r0 = 1.5, R = 45000;
    const pos = [], idx = [];
    pos.push(0, 0, 0);
    for (let i = 0; i < RINGS; i++) {
      const r = r0 * Math.pow(R / r0, i / (RINGS - 1));
      for (let j = 0; j < SEGS; j++) { const a = j / SEGS * TAU; pos.push(Math.cos(a) * r, 0, Math.sin(a) * r); }
    }
    for (let j = 0; j < SEGS; j++) idx.push(0, 1 + (j + 1) % SEGS, 1 + j);
    for (let i = 0; i < RINGS - 1; i++) for (let j = 0; j < SEGS; j++) {
      const a = 1 + i * SEGS + j, b = 1 + i * SEGS + (j + 1) % SEGS, c = a + SEGS, d = b + SEGS;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    normals.wrapS = normals.wrapT = THREE.RepeatWrapping;
    const mat = new THREE.MeshPhysicalMaterial({ color: 0x0a2a3a, roughness: 0.06, metalness: 0, ior: 1.333, specularIntensity: 1, envMapIntensity: 0.8 });
    super(g, mat);
    this.frustumCulled = false; this.receiveShadow = true;
    this.u = {
      uTime: { value: 0 }, uSea: { value: 1 }, uNormals: { value: normals }, uShip: { value: new THREE.Vector4(0, 0, 0, -1) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uSSS: { value: new THREE.Color(0x0b5c55) },
      uDeep: { value: new THREE.Color(0x02101a) }, uShallow: { value: new THREE.Color(0x0e4a5a) }, uFoamK: { value: 1 }, uFar: { value: 1 },
      uWaves: { value: WAVES.map(([L, a]) => new THREE.Vector4(L, Math.sin(a), Math.cos(a), 0)) }, uAmp: { value: new Array(WAVES.length).fill(0) },
    };
    this.setSea(1);
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, this.u);
      const common = `
        uniform float uTime, uSea, uFar; uniform vec4 uWaves[${WAVES.length}]; uniform float uAmp[${WAVES.length}];
        varying vec3 vWPos; varying vec2 vP0;\n`;
      sh.vertexShader = common + sh.vertexShader
        .replace('#include <beginnormal_vertex>', `
          // Gerstner sum in world space (the grid follows the camera; the pattern stays put)
          vec3 wp0 = (modelMatrix * vec4(position, 1.0)).xyz;
          float camD = length(position.xz);
          vec3 disp = vec3(0.0); vec3 nrm = vec3(0.0, 1.0, 0.0); float jac = 1.0;
          for (int i = 0; i < ${WAVES.length}; i++) {
            float L = uWaves[i].x; vec2 dir = uWaves[i].yz;
            // long waves reach further than short ones; a wave is only displaced where the grid can carry it
            // (radial ring spacing ~5.3% of the range), the shading normal is evaluated per pixel instead
            float fade = (1.0 - smoothstep(L * 28.0, L * 75.0, camD * uFar)) * (1.0 - smoothstep(L * 0.2, L * 0.4, camD * 0.053));
            float A = uAmp[i] * fade; if (A <= 0.0) continue;
            float k = 6.2831853 / L, w = sqrt(9.81 * k), ph = k * dot(dir, wp0.xz) - w * uTime + float(i) * 1.7;
            float Q = min(0.62 / (k * A * float(${WAVES.length}) + 1e-4), 1.0) * 0.85;
            float c = cos(ph), s = sin(ph);
            disp += vec3(Q * A * dir.x * c, A * s, Q * A * dir.y * c);
            nrm -= vec3(dir.x * k * A * c, Q * k * A * s, dir.y * k * A * c);
            jac -= Q * k * A * s;
          }
          vP0 = wp0.xz;
          vec3 objectNormal = normalize(nrm);`)
        .replace('#include <begin_vertex>', 'vec3 transformed = position + disp;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = `
        uniform float uTime, uSea, uFoamK; uniform sampler2D uNormals; uniform vec4 uShip; uniform vec3 uDeep, uShallow;
        uniform float uFar; uniform vec4 uWaves[${WAVES.length}]; uniform float uAmp[${WAVES.length}];
        uniform vec3 uSunDir, uSunCol, uSSS;
        varying vec3 vWPos; varying vec2 vP0;
        vec3 ripple(vec2 p, float s, vec2 v) { return texture2D(uNormals, p / s + v * uTime).rbg * 2.0 - 1.0; }
        float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash2(i), hash2(i + vec2(1, 0)), u.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), u.x), u.y); }
        float fbm(vec2 p) { return vnoise(p) * 0.5 + vnoise(p * 2.03 + 7.1) * 0.3 + vnoise(p * 4.1 - 3.3) * 0.2; }
        float foamNoise(vec2 p) { return fbm(p * 0.045 + vec2(uTime * 0.01, 0.0)); }
\n` + sh.fragmentShader
        .replace('#include <normal_fragment_maps>', `
          // detail ripples on top of the swell, faded with distance so the far sea does not sparkle
          float dist = length(vWPos - cameraPosition);
          float dfade = 1.0 - smoothstep(250.0, 3500.0, dist);
          // swell normal and crest steepness per pixel; waves shorter than a few pixels fade out (no shimmer)
          float foot = length(fwidth(vP0)) + 1e-3, camD = length(vWPos.xz - cameraPosition.xz);
          vec3 nrm = vec3(0.0, 1.0, 0.0); float jac = 1.0, slopeVar = 0.0;
          for (int i = 0; i < ${WAVES.length}; i++) {
            float L = uWaves[i].x; vec2 dir = uWaves[i].yz;
            float keep = (1.0 - smoothstep(L * 150.0, L * 400.0, camD)) * (1.0 - smoothstep(L * 0.12, L * 0.3, foot));
            float k = 6.2831853 / L;
            // a wave too small to resolve is not gone: its slopes roughen the surface (Toksvig / LEAN filtering)
            slopeVar += 0.5 * pow(k * uAmp[i], 2.0) * (1.0 - keep);
            float A = uAmp[i] * keep;
            if (A <= 0.0) continue;
            float w = sqrt(9.81 * k), ph = k * dot(dir, vP0) - w * uTime + float(i) * 1.7;
            float Q = min(0.62 / (k * A * float(${WAVES.length}) + 1e-4), 1.0) * 0.85;
            float c = cos(ph), s = sin(ph);
            nrm -= vec3(dir.x * k * A * c, Q * k * A * s, dir.y * k * A * c);
            jac -= Q * k * A * s;
          }
          float vCrest = clamp((1.0 - jac) / 0.42, 0.0, 1.0);       // 0 flat .. 1 at the steepest the sum allows

          // whitecaps on steep crests and the carrier's wake / bow wave in ship-local coordinates
          float fn = foamNoise(vWPos.xz);
          // whitecaps: steep crests break; more of them, and bigger, as the wind (sea state) rises
          float foam = smoothstep(0.36, 0.72, vCrest + (fn - 0.5) * 0.5) * smoothstep(0.35, 1.5, uSea) * 0.85;
          float slick = 0.0;
          if (uShip.w > 0.0) {
            vec2 rel = vWPos.xz - uShip.xy; vec2 fwd = vec2(sin(uShip.z), -cos(uShip.z));
            float along = -dot(rel, fwd) - 140.0;                 // metres aft of the stern
            float side = abs(rel.x * fwd.y - rel.y * fwd.x);
            float W = 12.0 + max(along, 0.0) * 0.035;               // turbulent wake: about the beam, slowly widening
            float churn = (along > -6.0) ? exp(-max(along, 0.0) / 450.0) * (1.0 - smoothstep(W * 0.25, W, side)) * smoothstep(-6.0, 4.0, along) : 0.0;
            float vw = 4.0 + along * 0.03;                          // the arms spread and diffuse with distance
            float vee = (along > 0.0) ? exp(-along / 600.0) * smoothstep(vw, 0.0, abs(side - (18.0 + along * 0.33))) * 0.12 : 0.0;
            float bowAlong = -dot(rel, fwd) + 142.0;              // metres aft of the bow
            float bow = (bowAlong > 0.0 && bowAlong < 120.0) ? smoothstep(4.0, 0.0, abs(side - (8.0 + bowAlong * 0.09))) * exp(-bowAlong / 70.0) : 0.0;
            // white water breaks into patches and streaks; brightest just aft of the screws, fading over ~1 km
            float patchy = smoothstep(0.3, 0.75, fn * 0.7 + fbm(vWPos.xz * 0.012) * 0.5);
            // white water right behind the screws, then broken streaks over a turquoise bubble trail
            float streak = fbm(vec2(side * 0.09, (along + uTime * 8.0) * 0.012));   // stretched along the track
            float white = churn * (0.25 + 0.75 * exp(-max(along, 0.0) / 160.0)) * smoothstep(0.3, 0.7, streak * 0.75 + patchy * 0.4) * 1.15;
            foam = max(foam, clamp(white * 0.85 + bow * patchy - 0.03, 0.0, 0.75) + vee * patchy);
            slick = churn;                                         // the turbulent wake flattens the ripples
          }
          vec3 rp = ripple(vWPos.xz, 9.0, vec2(0.012, 0.019)) + ripple(vWPos.xz, 37.0, vec2(-0.006, 0.011)) * 0.8 + ripple(vWPos.xz, 3.1, vec2(0.03, -0.02)) * 0.35 * dfade;
          // ripple slopes on top of the swell
          float rk = 0.06 * (0.4 + 0.6 * dfade) * (1.0 - 0.6 * slick);
          vec3 nW = normalize(normalize(nrm) + vec3(rp.x * rk, 0.0, rp.z * rk));
          // keep the facet facing the eye and its mirror ray above the horizon (a ray reflected downwards would
          // hit the next wave, which itself reflects sky); without this steep seas show black blotches
          vec3 V = normalize(cameraPosition - vWPos);
          float nv = dot(nW, V); if (nv < 0.06) nW = normalize(nW + V * (0.06 - nv));
          float ry = reflect(-V, nW).y; if (ry < 0.04) nW = normalize(mix(nW, vec3(0.0, 1.0, 0.0), clamp((0.04 - ry) * 3.0, 0.0, 1.0)));
          normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
          // wind slicks and cat's paws: large patches of smoother and rougher water (breaks up the far sea)
          float paws = smoothstep(0.2, 0.8, fbm(vWPos.xz * 0.0011 + vec2(uTime * 0.0012, -uTime * 0.0007)));
          float rippleVar = (0.0025 + 0.004 * uSea) * (1.0 - dfade) * (0.5 + paws);
          roughnessFactor = clamp(sqrt(0.05 * 0.05 + (slopeVar + rippleVar) * 2.2) * mix(0.75, 1.3, paws) * (1.0 - 0.45 * slick), 0.04, 0.42);
          foam *= uFoamK;
          vec3 waterCol = mix(uDeep, uShallow, clamp(vCrest * 0.5 + vWPos.y * 0.12 + 0.1, 0.0, 1.0) * 0.6);   // light through thin crests
          waterCol = mix(waterCol, uShallow * 1.5, slick * 0.35);   // bubbles under the wake scatter turquoise
          diffuseColor.rgb = mix(waterCol, vec3(0.82, 0.86, 0.88), foam);
          roughnessFactor = mix(roughnessFactor, 0.85, foam);
          float crestH = clamp(vCrest * 0.7 + vWPos.y * 0.25 + 0.15, 0.0, 1.0);`)
        // foam is a diffuse scatterer: it should not mirror the sun
        .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
          material.specularColor *= 1.0 - foam * 0.85; material.specularF90 *= 1.0 - foam * 0.85;`)
        // light through the waves: sun entering a crest from behind glows turquoise towards the eye, and sunlit
        // crests show a little of the same scattered colour; thin crests (high, steep) glow most
        .replace('#include <opaque_fragment>', `
          {
            vec3 Vw = normalize(cameraPosition - vWPos), nw = normalize(nW);
            float back = pow(clamp(dot(Vw, -normalize(uSunDir + nw * 0.35)), 0.0, 1.0), 4.0);
            float wrap = clamp(dot(nw, uSunDir) * 0.5 + 0.5, 0.0, 1.0);
            float sunUp = smoothstep(-0.05, 0.25, uSunDir.y);
            outgoingLight += uSunCol * uSSS * (back * 0.9 + wrap * 0.12) * crestH * sunUp * (1.0 - foam) * dfade;
          }
          #include <opaque_fragment>`);
      this.shader = sh;
    };
    mat.customProgramCacheKey = () => 'ocean-v4';
  }
  setSea(s) {
    this.u.uSea.value = s;
    // calm still has a long low swell; rough seas grow faster than linearly. 20 random phases add in RMS
    const k = 0.0062 * Math.SQRT1_2 * (0.28 + 0.3 * s + 2.2 * s * s);   // Hs about 0.3 / 1.8 / 4 m at sea 0 / 1 / 1.8
    this.u.uAmp.value = WAVES.map(([L]) => k * Math.pow(L, 0.85) * (L > 50 ? 0.8 : 1));
  }
  update(dt, camera, ship) {
    this.u.uTime.value += dt;
    // follow the camera in 2 m steps (the wave pattern is in world space, so this does not swim)
    this.position.set(Math.round(camera.position.x / 2) * 2, 0, Math.round(camera.position.z / 2) * 2);
    // far sea: at altitude the near grid covers less of the view, fade the waves out quicker
    this.u.uFar.value = 1 + Math.max(0, camera.position.y - 200) / 400;
    if (ship) {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion);
      this.u.uShip.value.set(ship.position.x, ship.position.z, Math.atan2(fwd.x, -fwd.z), 1);
    }
  }
}
