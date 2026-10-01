// Post-processing stack (HDR, linear until the output pass):
//   scene -> [ambient occlusion + volumetric clouds, composited] -> [motion blur / depth of field] -> bloom
//   -> tone mapping (OutputPass) -> grade (vignette, chromatic edge, grain)
// The renderer uses a logarithmic depth buffer (4 cm .. 120 km); every pass decodes it to view depth itself:
//   d = log2(1 + w) / log2(far + 1)   =>   w = exp2(d * log2(far + 1)) - 1
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const DEPTH = `
  uniform sampler2D tDepth; uniform float uLogFar; uniform vec2 uTan;     // tan(fov/2) * aspect, tan(fov/2)
  float viewDepth(vec2 uv) { float d = texture2D(tDepth, uv).x; return exp2(d * uLogFar) - 1.0; }
  vec3 viewPos(vec2 uv, float w) { return vec3((uv * 2.0 - 1.0) * uTan * w, -w); }
`;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s2 = new THREE.Vector2();
const VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// ---------------------------------------------------------------- 3D noise for the clouds (generated once, 64^3)
function noise3D(N = 64) {
  const data = new Uint8Array(N * N * N), h = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
  // tileable value-noise fbm + inverted Worley cells: billowy cumulus shapes
  const pts = []; const C = 6; for (let i = 0; i < C; i++) for (let j = 0; j < C; j++) for (let k = 0; k < C; k++) pts.push([(i + h(i, j, k)) / C, (j + h(j, k, i)) / C, (k + h(k, i, j)) / C]);
  const vn = (x, y, z, f) => {
    const X = x * f, Y = y * f, Z = z * f, xi = Math.floor(X), yi = Math.floor(Y), zi = Math.floor(Z), xf = X - xi, yf = Y - yi, zf = Z - zi;
    const sm = t => t * t * (3 - 2 * t), u = sm(xf), v = sm(yf), w = sm(zf), m = q => ((q % f) + f) % f;
    const g = (a, b, c) => h(m(xi + a), m(yi + b), m(zi + c));
    const l = (a, b, t) => a + (b - a) * t;
    return l(l(l(g(0, 0, 0), g(1, 0, 0), u), l(g(0, 1, 0), g(1, 1, 0), u), v), l(l(g(0, 0, 1), g(1, 0, 1), u), l(g(0, 1, 1), g(1, 1, 1), u), v), w);
  };
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const px = x / N, py = y / N, pz = z / N;
    let wd = 9;
    for (const p of pts) for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = -1; oz <= 1; oz++) {
      if (Math.abs(px - p[0] - ox) > 0.34 || Math.abs(py - p[1] - oy) > 0.34 || Math.abs(pz - p[2] - oz) > 0.34) continue;
      const d = Math.hypot(px - p[0] - ox, py - p[1] - oy, pz - p[2] - oz); if (d < wd) wd = d;
    }
    const worley = 1 - Math.min(1, wd * C * 0.9);
    const fbm = vn(px, py, pz, 4) * 0.55 + vn(px, py, pz, 8) * 0.3 + vn(px, py, pz, 16) * 0.15;
    data[x + y * N + z * N * N] = Math.max(0, Math.min(255, (worley * 0.62 + fbm * 0.48) * 255));
  }
  const t = new THREE.Data3DTexture(data, N, N, N); t.format = THREE.RedFormat; t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.minFilter = t.magFilter = THREE.LinearFilter; t.unpackAlignment = 1; t.needsUpdate = true; return t;
}
function coverage2D(N = 256) {
  const c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'); const img = g.createImageData(N, N);
  const h = (x, y) => { const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return s - Math.floor(s); };
  const vn = (x, y, f) => { const X = x * f, Y = y * f, xi = Math.floor(X), yi = Math.floor(Y), xf = X - xi, yf = Y - yi, sm = t => t * t * (3 - 2 * t), m = q => ((q % f) + f) % f;
    const a = h(m(xi), m(yi)), b = h(m(xi + 1), m(yi)), cc = h(m(xi), m(yi + 1)), d = h(m(xi + 1), m(yi + 1)); const u = sm(xf), v = sm(yf);
    return a + (b - a) * u + (cc - a) * v + (a - b - cc + d) * u * v; };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const v = vn(x / N, y / N, 4) * 0.5 + vn(x / N, y / N, 8) * 0.3 + vn(x / N, y / N, 16) * 0.2;
    const i = (x + y * N) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = v * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

// ---------------------------------------------------------------- AO + clouds + composite, then motion blur / DOF
class ScenePost extends Pass {
  constructor(renderer, camera) {
    super();
    this.camera = camera; this.needsSwap = true;
    const half = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.aoRT = half(); this.cloudRT = half(); this.mixRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    const common = { tDepth: { value: null }, uLogFar: { value: 1 }, uTan: { value: new THREE.Vector2(1, 1) } };
    this.ao = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(common), uRadius: { value: 0.7 }, uRes: { value: new THREE.Vector2() } },
      vertexShader: VERT, fragmentShader: DEPTH + `
        uniform float uRadius; uniform vec2 uRes; varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          float w = viewDepth(vUv); if (w > 400.0) { gl_FragColor = vec4(1.0); return; }
          vec3 P = viewPos(vUv, w);
          vec3 N = normalize(cross(dFdx(P), dFdy(P)));
          float occ = 0.0, a0 = hash(vUv * uRes) * 6.2831853, rad = uRadius * clamp(w / 6.0, 0.35, 4.0);
          for (int i = 0; i < 12; i++) {
            float fi = float(i) + 0.5, a = a0 + fi * 2.39996, r = rad * sqrt(fi / 12.0);
            vec3 t = normalize(cross(N, abs(N.y) < 0.9 ? vec3(0,1,0) : vec3(1,0,0))), b = cross(N, t);
            vec3 S = P + (t * cos(a) + b * sin(a)) * r + N * r * 0.35;
            vec2 suv = (S.xy / (-S.z) / uTan) * 0.5 + 0.5;
            float sw = viewDepth(suv);
            float range = smoothstep(0.0, 1.0, rad / max(abs(w - sw), 1e-3));
            occ += (sw < -S.z - 0.03 - w * 0.004 ? 1.0 : 0.0) * range;   // bias grows with depth precision
          }
          // contact shading only: fades out by 150-400 m (beyond that it would just shade wave faces)
          gl_FragColor = vec4(vec3(1.0 - occ / 12.0 * 0.85 * (1.0 - smoothstep(150.0, 400.0, w))), 1.0);
        }` }));
    this.noise = noise3D(); this.cov = coverage2D();
    this.cloud = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(common), tNoise: { value: this.noise }, tCov: { value: this.cov }, uCam: { value: new THREE.Vector3() },
        uInvView: { value: new THREE.Matrix4() }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) },
        uSkyTop: { value: new THREE.Color(0.5, 0.6, 0.8) }, uSkyBot: { value: new THREE.Color(0.3, 0.32, 0.36) }, uFogCol: { value: new THREE.Color() },
        uFogD: { value: 0.00003 }, uCover: { value: 0.45 }, uTime: { value: 0 }, uBase: { value: 1500 }, uTop: { value: 3200 }, uFrame: { value: 0 }, uRes: { value: new THREE.Vector2() } },
      vertexShader: VERT, fragmentShader: DEPTH + `
        precision highp sampler3D;
        uniform sampler3D tNoise; uniform sampler2D tCov; uniform vec3 uCam, uSun, uSunCol, uSkyTop, uSkyBot, uFogCol; uniform mat4 uInvView;
        uniform float uFogD, uCover, uTime, uBase, uTop, uFrame; uniform vec2 uRes; varying vec2 vUv;
        // interleaved gradient noise, rotated every frame: an even, stable dither that the temporal resolve averages out
        float ign(vec2 p) { return fract(52.9829189 * fract(dot(p + uFrame * 5.588238, vec2(0.06711056, 0.00583715)))); }
        float density(vec3 p) {
          float h = (p.y - uBase) / (uTop - uBase); if (h < 0.0 || h > 1.0) return 0.0;
          vec2 wind = vec2(0.0, uTime * 6.0);
          float cov = texture2D(tCov, (p.xz + wind) / 38000.0).r;
          cov = smoothstep(1.0 - uCover, 1.0 - uCover + 0.32, cov);
          float shape = smoothstep(0.0, 0.12, h) * (1.0 - smoothstep(0.45, 1.0, h)) * (1.0 - h * 0.35);   // flat bases, rounded tops
          float n = texture(tNoise, (p + vec3(wind.x, 0.0, wind.y)) / 2600.0).r;
          float d = clamp((n * shape - (1.0 - cov)) * 2.4, 0.0, 1.0);
          if (d > 0.0) d *= 0.7 + 0.6 * texture(tNoise, (p + vec3(0.0, -uTime * 2.0, wind.y)) / 520.0).r;    // erode edges
          return d;
        }
        float lightMarch(vec3 p) { float t = 0.0; for (int i = 0; i < 5; i++) { p += uSun * 140.0; t += density(p); } return exp(-t * 0.9); }
        float lightMarch3(vec3 p) { float t = 0.0; for (int i = 0; i < 3; i++) { p += uSun * 220.0; t += density(p); } return exp(-t * 1.3); }
        // the clouds seen in the sea: a rough mirror shows them as soft shapes, so one sample of the cloud coverage
        // where the reflected ray crosses the middle of the layer is enough (and cannot alias into blocks)
        vec4 reflectClouds(vec3 o, vec3 r, float j) {
          if (r.y <= 0.02) return vec4(0.0, 0.0, 0.0, 1.0);
          float tm = (mix(uBase, uTop, 0.3) - o.y) / r.y; if (tm > 40000.0) return vec4(0.0, 0.0, 0.0, 1.0);
          vec2 q = o.xz + r.xz * tm + vec2(0.0, uTime * 6.0);
          float cov = texture2D(tCov, q / 38000.0).r;
          cov = smoothstep(1.0 - uCover + 0.06, 1.0 - uCover + 0.42, cov);
          float n = texture(tNoise, vec3(q.x, 900.0, q.y) / 2600.0).r;
          float a = clamp(cov * (0.55 + 0.6 * n), 0.0, 0.85);
          vec3 L = uSunCol * 0.35 * (0.6 + 0.4 * max(uSun.y, 0.0)) + mix(uSkyBot, uSkyTop, 0.6) * 0.8;
          return vec4(L * a, 1.0 - a);
        }
        void main() {
          float w = viewDepth(vUv);
          vec3 vd = normalize(viewPos(vUv, 1.0));
          vec3 rd = normalize((uInvView * vec4(vd, 0.0)).xyz);
          float sceneT = (w > 100000.0) ? 1e9 : w / max(-vd.z, 1e-3);
          float jit = ign(gl_FragCoord.xy);
          // reflections of the clouds in the sea (where the view ray ends on the water, not the ship or the jet)
          vec4 refl = vec4(0.0, 0.0, 0.0, 1.0); float fres = 0.0;
          if (sceneT < 1e8) {
            vec3 hp = uCam + rd * sceneT;
            if (abs(hp.y) < 4.0 && sceneT > 25.0) {
              vec3 rr = reflect(rd, vec3(0.0, 1.0, 0.0));
              // wobble from the swell, more with distance (the water is a rough mirror)
              rr.xz += (vec2(sin(hp.x * 0.05 + uTime * 0.7), cos(hp.z * 0.043 - uTime * 0.6)) * 0.02) * (1.0 + sceneT / 4000.0);
              rr = normalize(rr);
              float cosI = clamp(-rd.y, 0.0, 1.0); fres = 0.02 + 0.98 * pow(1.0 - cosI, 5.0);
              refl = reflectClouds(hp, rr, jit);
            }
          }
          // intersect the cloud slab
          float t0, t1;
          // the reflection replaces some of the sky the water was reflecting with the cloud (dark bases, bright tops)
          float rk = fres * (1.0 - refl.a) * 0.8;
          vec3 reflAdd = fres * refl.rgb * 0.8;
          if (abs(rd.y) < 1e-4) { if (uCam.y < uBase || uCam.y > uTop) { gl_FragColor = vec4(reflAdd, 1.0 - rk); return; } t0 = 0.0; t1 = 60000.0; }
          else { float ta = (uBase - uCam.y) / rd.y, tb = (uTop - uCam.y) / rd.y; t0 = max(min(ta, tb), 0.0); t1 = max(ta, tb); }
          // never march more than 40 km of slab: long grazing rays otherwise take kilometre steps and turn to noise
          t1 = min(t1, min(sceneT, t0 + 40000.0));
          if (t1 <= t0) { gl_FragColor = vec4(reflAdd, 1.0 - rk); return; }
          float steps = 56.0, dt = (t1 - t0) / steps, t = t0 + dt * jit;
          float cosT = dot(rd, uSun), g = 0.55;
          float phase = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosT, 1.5) * 0.08 + 0.6;
          vec3 col = vec3(0.0); float T = 1.0;
          for (int i = 0; i < 56; i++) {
            if (T < 0.02 || t > t1) break;
            vec3 p = uCam + rd * t;
            float d = density(p);
            if (d > 0.002) {
              float h = (p.y - uBase) / (uTop - uBase);
              float sig = d * 0.012 * min(dt, 240.0) / 4.0;
              vec3 amb = mix(uSkyBot, uSkyTop, h);
              vec3 L = uSunCol * lightMarch(p) * phase * (1.0 - exp(-d * 4.0)) * 1.6 + amb * 0.75;
              float a = 1.0 - exp(-sig * 4.0);
              float fogF = 1.0 - exp(-uFogD * uFogD * t * t * 0.6);       // aerial perspective, as the scene fog
              col += T * a * mix(L, uFogCol, fogF); T *= 1.0 - a;
            }
            t += dt;
          }
          // the reflection sits behind any cloud between the eye and the water
          gl_FragColor = vec4(col + T * reflAdd, T * (1.0 - rk));
        }` }));
    // temporal resolve of the half-resolution clouds: the previous result, reprojected by camera rotation (clouds
    // are kilometres away, so translation hardly matters), clamped to this frame's 3x3 neighbourhood (no ghosts)
    // and blended 85 / 15. Removes the march noise without smearing.
    this.cloudHist = [half(), half()]; this.histI = 0; this.histOK = false; this.frame = 0;
    this.resolve = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tCur: { value: null }, tHist: { value: null }, uPrevVPr: { value: new THREE.Matrix4() }, uInvViewR: { value: new THREE.Matrix4() }, uTan: { value: new THREE.Vector2(1, 1) },
        uTexel: { value: new THREE.Vector2() }, uBlend: { value: 0 } },
      vertexShader: VERT, fragmentShader: `
        uniform sampler2D tCur, tHist; uniform mat4 uPrevVPr, uInvViewR; uniform vec2 uTan, uTexel; uniform float uBlend; varying vec2 vUv;
        void main() {
          vec4 c = texture2D(tCur, vUv), mn = c, mx = c;
          for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec4 s = texture2D(tCur, vUv + vec2(float(x), float(y)) * uTexel); mn = min(mn, s); mx = max(mx, s); }
          vec3 rd = mat3(uInvViewR) * normalize(vec3((vUv * 2.0 - 1.0) * uTan, -1.0));
          vec4 pc = uPrevVPr * vec4(rd, 0.0); vec2 pu = pc.xy / pc.w * 0.5 + 0.5;
          float ok = (pc.w > 0.0 && pu.x > 0.0 && pu.x < 1.0 && pu.y > 0.0 && pu.y < 1.0) ? uBlend : 0.0;
          vec4 h = clamp(texture2D(tHist, pu), mn, mx);
          vec4 o = mix(c, h, ok);
          gl_FragColor = (any(isnan(o)) || any(isinf(o))) ? vec4(0.0, 0.0, 0.0, 1.0) : o;
        }` }));
    this.mix = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(common), tColor: { value: null }, tAO: { value: null }, tCloud: { value: null }, uAO: { value: 1 }, uClouds: { value: 1 }, uTexel: { value: new THREE.Vector2() },
        uSunUV: { value: new THREE.Vector2(-9, -9) }, uFlare: { value: 0 }, uAspect: { value: 1 },
        uPl: { value: [new THREE.Vector4(0, 0, 0, -1), new THREE.Vector4(0, 0, 0, -1)] }, uPd: { value: [new THREE.Vector4(), new THREE.Vector4()] },
        uHzInv: { value: new THREE.Matrix4() }, uCamP: { value: new THREE.Vector3() }, uHzT: { value: 0 } },
      vertexShader: VERT, fragmentShader: DEPTH + `
        uniform sampler2D tColor, tAO, tCloud; uniform float uAO, uClouds, uFlare, uAspect; uniform vec2 uTexel, uSunUV; varying vec2 vUv;
        uniform vec4 uPl[2], uPd[2]; uniform mat4 uHzInv; uniform vec3 uCamP; uniform float uHzT;
        // heat haze: the view ray is tested against each exhaust plume (a widening cone along the jet axis); where it
        // passes through hot gas in front of the scene, the image behind is refracted by scrolling turbulence
        vec2 heatHaze() {
          vec2 hz = vec2(0.0);
          float w = min(viewDepth(vUv), 60000.0);
          vec3 wp = (uHzInv * vec4(viewPos(vUv, w), 1.0)).xyz, rd = normalize(wp - uCamP); float tmax = length(wp - uCamP);
          for (int k = 0; k < 2; k++) {
            if (uPl[k].w <= 0.0) continue;
            vec3 a = uPl[k].xyz, d = uPd[k].xyz, w0 = uCamP - a; float L = uPd[k].w;
            float b = dot(rd, d), dd = dot(rd, w0), e = dot(d, w0), den = 1.0 - b * b;
            float sp = den > 1e-4 ? clamp((e - b * dd) / den, 0.0, L) : 0.0;
            vec3 q = a + d * sp; float t = dot(q - uCamP, rd);
            if (t <= 0.0 || t > tmax) continue;
            float r = 0.35 + sp * 0.07, dist = length(uCamP + rd * t - q);
            float f = (1.0 - smoothstep(r * 0.3, r, dist)) * (1.0 - sp / L) * smoothstep(0.0, 0.6, sp) * smoothstep(2.0, 8.0, t) * uPl[k].w;
            float n1 = sin(sp * 2.7 - uHzT * 31.0 + dist * 7.0), n2 = sin(sp * 6.1 - uHzT * 47.0 + (vUv.x + vUv.y) * 260.0);
            hz += vec2(n1 + 0.6 * n2, cos(n1 * 1.7 + n2)) * f;
          }
          return hz;
        }
        vec3 disc(vec2 p, vec2 c, float r, vec3 col) { vec2 d = (p - c) * vec2(uAspect, 1.0); return col * smoothstep(r, r * 0.2, length(d)); }
        void main() {
          vec2 hz = heatHaze();
          vec4 c = texture2D(tColor, vUv + hz * uTexel * 2.5);
          if (uAO > 0.5) {   // 4-tap blur of the half-resolution occlusion
            float ao = 0.0; for (int i = 0; i < 4; i++) { vec2 o = vec2(float(i - (i / 2) * 2) - 0.5, float(i / 2) - 0.5) * uTexel * 3.0; ao += texture2D(tAO, vUv + o).r; }
            c.rgb *= ao * 0.25;
          }
          if (uClouds > 0.5) {   // 5-tap smoothing of the half-resolution cloud march
            vec4 cl = texture2D(tCloud, vUv) * 0.4;
            cl += texture2D(tCloud, vUv + vec2(uTexel.x, 0.0) * 1.5) * 0.15; cl += texture2D(tCloud, vUv - vec2(uTexel.x, 0.0) * 1.5) * 0.15;
            cl += texture2D(tCloud, vUv + vec2(0.0, uTexel.y) * 1.5) * 0.15; cl += texture2D(tCloud, vUv - vec2(0.0, uTexel.y) * 1.5) * 0.15;
            c.rgb = c.rgb * cl.a + cl.rgb;
          }
          if (uFlare > 0.0) {      // sun flare, hidden when anything (or a cloud) covers the sun
            float occ = 0.0;
            for (int i = 0; i < 5; i++) { vec2 o = vec2(float(i - 2) * 0.004, float(i - 2) * 0.003); occ += viewDepth(uSunUV + o) > 100000.0 ? 1.0 : 0.0; }
            float cloudT = uClouds > 0.5 ? texture2D(tCloud, uSunUV).a : 1.0;
            float vis = occ / 5.0 * cloudT * uFlare;
            if (vis > 0.0) {
              vec2 axis = vec2(0.5) - uSunUV; vec3 f = vec3(0.0);
              f += disc(vUv, uSunUV, 0.09, vec3(1.0, 0.92, 0.8)) * 0.35;
              f += disc(vUv, uSunUV + axis * 0.55, 0.035, vec3(0.35, 0.55, 1.0)) * 0.22;
              f += disc(vUv, uSunUV + axis * 1.1, 0.06, vec3(1.0, 0.6, 0.3)) * 0.12;
              f += disc(vUv, uSunUV + axis * 1.5, 0.025, vec3(0.4, 1.0, 0.7)) * 0.18;
              f += disc(vUv, uSunUV + axis * 1.9, 0.11, vec3(0.6, 0.5, 1.0)) * 0.07;
              float streak = exp(-abs(vUv.y - uSunUV.y) * 140.0) * exp(-abs(vUv.x - uSunUV.x) * 2.2);
              f += vec3(0.75, 0.85, 1.0) * streak * 0.25;
              c.rgb += f * vis * 3.0;
            }
          }
          if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
          gl_FragColor = vec4(min(c.rgb, vec3(60000.0)), 1.0);
        }` }));
    this.blur = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(common), tColor: { value: null }, uPrevVP: { value: new THREE.Matrix4() }, uInvView: { value: new THREE.Matrix4() },
        uCurVP: { value: new THREE.Matrix4() }, uObj: { value: [new THREE.Vector4(0, 0, 0, -1), new THREE.Vector4(0, 0, 0, -1)] }, uObjVP: { value: [new THREE.Matrix4(), new THREE.Matrix4()] }, uMB: { value: 0.0 }, uFocus: { value: 0.0 }, uDOF: { value: 0.0 }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: VERT, fragmentShader: DEPTH + `
        uniform sampler2D tColor; uniform mat4 uPrevVP, uInvView, uCurVP; uniform vec4 uObj[2]; uniform mat4 uObjVP[2]; uniform float uMB, uFocus, uDOF; uniform vec2 uTexel; varying vec2 vUv;
        void main() {
          float w = min(viewDepth(vUv), 60000.0);
          vec3 wp = (uInvView * vec4(viewPos(vUv, w), 1.0)).xyz;
          vec4 pc = uPrevVP * vec4(wp, 1.0); vec2 prev = pc.w > 0.0 ? pc.xy / pc.w * 0.5 + 0.5 : vUv;
          // moving objects (own jet, tanker) are reprojected with their own motion, not the world's
          for (int k = 0; k < 2; k++) if (uObj[k].w > 0.0) {
            float inside = 1.0 - smoothstep(uObj[k].w * 0.8, uObj[k].w, distance(wp, uObj[k].xyz));
            if (inside > 0.0) { vec4 po = uObjVP[k] * vec4(wp, 1.0); prev = mix(prev, po.xy / po.w * 0.5 + 0.5, inside); }
          }
          vec2 vel = (vUv - prev) * uMB * smoothstep(3.0, 6.0, w);            // the cockpit moves with the camera: no blur
          if (any(isnan(vel)) || any(isinf(vel))) vel = vec2(0.0);
          float vl = length(vel / uTexel); if (vl > 24.0) vel *= 24.0 / vl;       // a streak, never a smear
          vec3 acc = texture2D(tColor, vUv).rgb; float n = 1.0;
          if (uMB > 0.0 && vl > 0.5) for (int i = 1; i <= 8; i++) { float f = float(i) / 8.0 - 0.5; acc += texture2D(tColor, vUv - vel * f).rgb; n += 1.0; }
          vec3 c = acc / n;
          if (uDOF > 0.0) {   // circle of confusion around the focus distance
            float coc = clamp(abs(w - uFocus) / max(w, 1.0) * uDOF * 9.0, 0.0, 6.0);
            if (coc > 0.6) { vec3 b = c; float m = 1.0;
              for (int i = 0; i < 12; i++) { float a = float(i) * 2.39996, r = sqrt(float(i) / 12.0) * coc; b += texture2D(tColor, vUv + vec2(cos(a), sin(a)) * r * uTexel).rgb; m += 1.0; }
              c = b / m; }
          }
          if (any(isnan(c)) || any(isinf(c))) c = texture2D(tColor, vUv).rgb;
          gl_FragColor = vec4(c, 1.0);
        }` }));
    this.prevVP = new THREE.Matrix4(); this.movers = []; this.opts = { ao: true, clouds: true, mb: 0.35, dof: 0, focus: 50 };
    this.prevCam = { p: new THREE.Vector3(), q: new THREE.Quaternion(), fov: 0, valid: false };
  }
  setSize(w, h) {
    this.aoRT.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1)); this.cloudRT.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1)); this.mixRT.setSize(w, h);
    for (const r of this.cloudHist) r.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1)); this.histOK = false;
    this.resolve.material.uniforms.uTexel.value.set(2 / w, 2 / h);
    this.ao.material.uniforms.uRes.value.set(w >> 1, h >> 1); this.cloud.material.uniforms.uRes.value.set(w >> 1, h >> 1);
    this.mix.material.uniforms.uTexel.value.set(1 / w, 1 / h); this.blur.material.uniforms.uTexel.value.set(1 / w, 1 / h);
  }
  render(renderer, writeBuffer, readBuffer) {
    const cam = this.camera, o = this.opts;
    const logFar = Math.log2(cam.far + 1), tanY = Math.tan(cam.fov * Math.PI / 360), tan = new THREE.Vector2(tanY * cam.aspect, tanY);
    for (const q of [this.ao, this.cloud, this.blur, this.mix]) { const u = q.material.uniforms; u.tDepth.value = readBuffer.depthTexture; u.uLogFar.value = logFar; u.uTan.value.copy(tan); }
    // a camera cut (mission start, view change, replay jump): nothing on screen continues from the last frame, so
    // motion blur and the cloud history must not reach back across it
    const pc = this.prevCam, cq = cam.getWorldQuaternion(_q), cp = cam.getWorldPosition(_v2);
    const cut = !pc.valid || cp.distanceTo(pc.p) > 60 || 2 * Math.acos(Math.min(1, Math.abs(cq.dot(pc.q)))) > 0.5 || Math.abs(cam.fov - pc.fov) > 8;
    const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    if (cut) { this.prevVP.copy(vp); this.histOK = false; for (const mv of this.movers) mv.prev = null; }
    if (o.ao) { renderer.setRenderTarget(this.aoRT); this.ao.render(renderer); }
    let cloudTex = this.cloudRT.texture;
    if (o.clouds) { const u = this.cloud.material.uniforms; u.uCam.value.copy(cam.position); u.uInvView.value.copy(cam.matrixWorld); u.uFrame.value = (this.frame++) % 64;
      renderer.setRenderTarget(this.cloudRT); this.cloud.render(renderer);
      const r = this.resolve.material.uniforms, out = this.cloudHist[this.histI], hist = this.cloudHist[1 - this.histI];
      r.tCur.value = this.cloudRT.texture; r.tHist.value = hist.texture; r.uTan.value.copy(tan); r.uBlend.value = this.histOK ? 0.85 : 0;
      r.uInvViewR.value.extractRotation(cam.matrixWorld); r.uPrevVPr.value.copy(this.prevVPr || vp);
      renderer.setRenderTarget(out); this.resolve.render(renderer);
      cloudTex = out.texture; this.histI = 1 - this.histI; this.histOK = true;
      // rotation-only view-projection of this frame, for the next frame's reprojection
      (this.prevVPr ||= new THREE.Matrix4()).multiplyMatrices(cam.projectionMatrix, _m2.extractRotation(cam.matrixWorld).invert());
    }
    pc.p.copy(cp); pc.q.copy(cq); pc.fov = cam.fov; pc.valid = true;
    const m = this.mix.material.uniforms; m.tColor.value = readBuffer.texture; m.uHzInv.value.copy(cam.matrixWorld); m.uCamP.value.copy(cam.position); m.tAO.value = this.aoRT.texture; m.tCloud.value = cloudTex; m.uAO.value = o.ao ? 1 : 0; m.uClouds.value = o.clouds ? 1 : 0;
    const b = this.blur.material.uniforms;
    if (o.mb > 0 || o.dof > 0) {
      renderer.setRenderTarget(this.mixRT); this.mix.render(renderer);
      // per mover: previous view-projection composed with the object's motion since the last frame
      for (let k = 0; k < 2; k++) {
        const mv = this.movers[k], o4 = b.uObj.value[k];
        if (!mv || !mv.obj.visible || !mv.prev) { o4.w = -1; continue; }
        mv.obj.getWorldPosition(_v); o4.set(_v.x, _v.y, _v.z, mv.r);
        b.uObjVP.value[k].copy(this.prevVP).multiply(mv.prev).multiply(_m.copy(mv.obj.matrixWorld).invert());
      }
      b.tColor.value = this.mixRT.texture; b.uPrevVP.value.copy(this.prevVP); b.uInvView.value.copy(cam.matrixWorld); b.uMB.value = o.mb; b.uDOF.value = o.dof; b.uFocus.value = o.focus;
      renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); this.blur.render(renderer);
    } else { renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); this.mix.render(renderer); }
    // particles (smoke, spray, fire) after the clouds and fog, soft-depth-tested against the scene
    if (this.fx) {
      const sz = renderer.getDrawingBufferSize(_s2);
      this.fx.setDepth({ depth: readBuffer.depthTexture, logFar, w: sz.x, h: sz.y });
      const ac = renderer.autoClear; renderer.autoClear = false; renderer.render(this.fx.fxScene, cam); renderer.autoClear = ac;
    }
    this.prevVP.copy(vp);
    for (const mv of this.movers) (mv.prev ||= new THREE.Matrix4()).copy(mv.obj.matrixWorld);
  }
}

// ---------------------------------------------------------------- final grade (after tone mapping, display space)
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVig: { value: 0.32 }, uGrain: { value: 0.01 }, uCA: { value: 0.0006 }, uSat: { value: 1.06 }, uCon: { value: 1.04 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uVig, uGrain, uCA, uSat, uCon; varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 d = vUv - 0.5; float r2 = dot(d, d);
      vec3 c = vec3(texture2D(tDiffuse, vUv - d * uCA * r2 * 8.0).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv + d * uCA * r2 * 8.0).b);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat); c = (c - 0.5) * uCon + 0.5;
      c *= 1.0 - uVig * smoothstep(0.12, 0.62, r2 * 1.6);
      c += (hash(vUv * 1931.7 + uTime) - 0.5) * uGrain;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }` };

// ---------------------------------------------------------------- the stack
export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer; this.scene = scene; this.camera = camera; this.enabled = true;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    rt.depthTexture = new THREE.DepthTexture(size.x, size.y, THREE.FloatType);
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.post = new ScenePost(renderer, camera); this.composer.addPass(this.post);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.32, 0.55, 1.05); this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader); this.composer.addPass(this.grade);
    // sun lens flare (procedural textures)
    this._sp = new THREE.Vector3();
  }
  setSize(w, h) { this.composer.setSize(w, h); }
  // objects that move with (or near) the camera: [{ obj, r }] (radius in metres)
  setMovers(list) { this.post.movers = list; }
  setEffects(fx) { this.post.fx = fx; }
  // exhaust plumes for the heat haze: [{ o: exit point (world), d: unit axis (world), len, k }]
  setPlumes(list, dt) {
    const m = this.post.mix.material.uniforms; m.uHzT.value = (m.uHzT.value + dt) % 1000;
    for (let i = 0; i < 2; i++) { const p = list[i]; if (!p || p.k <= 0) { m.uPl.value[i].w = -1; continue; }
      m.uPl.value[i].set(p.o.x, p.o.y, p.o.z, p.k); m.uPd.value[i].set(p.d.x, p.d.y, p.d.z, p.len); }
  }
  setQuality(q) {
    const o = this.post.opts;
    this.enabled = q !== 'low';
    o.ao = q === 'high' || q === 'ultra'; o.clouds = q !== 'low'; o.mb = q === 'high' || q === 'ultra' ? 0.35 : 0;
    this.bloom.enabled = q !== 'low';
  }
  // per frame: sky colours for the clouds, sun flare position, DOF focus
  update(dt, { sun, sunCol, skyTop, skyBot, fogCol, fogD, night, cover, dof, focus, flare }) {
    const u = this.post.cloud.material.uniforms;
    u.uSun.value.copy(sun); u.uSunCol.value.copy(sunCol); u.uSkyTop.value.copy(skyTop); u.uSkyBot.value.copy(skyBot); u.uFogCol.value.copy(fogCol);
    u.uFogD.value = fogD; u.uTime.value += dt; u.uCover.value = cover;
    this.post.opts.dof = dof || 0; this.post.opts.focus = focus || 50;
    this.grade.uniforms.uTime.value = (this.grade.uniforms.uTime.value + dt * 37.1) % 100;
    // bloom threshold in scene-linear units: daylight is far above 1.0 before the exposure is applied
    const exp = this.renderer.toneMappingExposure; this.bloom.threshold = 2.4 / exp; this.bloom.strength = night > 0.9 ? 0.45 : 0.22;
    // sun position on screen for the flare
    const m = this.post.mix.material.uniforms; this._sp.copy(this.camera.position).addScaledVector(sun, 10000).project(this.camera);
    const onScreen = this._sp.z < 1 && Math.abs(this._sp.x) < 1.3 && Math.abs(this._sp.y) < 1.3;
    m.uSunUV.value.set(this._sp.x * 0.5 + 0.5, this._sp.y * 0.5 + 0.5); m.uFlare.value = flare && onScreen && sun.y > -0.02 ? 1 : 0; m.uAspect.value = this.camera.aspect;
  }
  render() { this.composer.render(); }
}
