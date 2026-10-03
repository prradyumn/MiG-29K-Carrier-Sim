// Siachen / Nubra terrain from real elevation data (Copernicus GLO-30, see glacier/scripts/dem.py), rendered as a
// camera-centred geometry clipmap: LEVELS square grids, each twice the spacing of the one inside it, snapped to its
// own grid (no swimming), morphing to the coarser spacing at its outer edge (no cracks) and discarding the area the
// finer level covers. Heights come from a float texture; the shading is per pixel:
//   normals from the height field (+ Blender-baked detail normals), materials (rock, snow, glacier ice, moraine
//   debris, river gravel) blended by the dem.py masks and the slope, the Blender geology tint and ambient
//   occlusion, and sun shadows ray-marched through the height field (peaks shadow the valleys).
// World frame: x east, y metres above sea level, z south. Also answers physics queries (heightAt / surface).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const LEVELS = 11, N = 128, S0 = 2.0;                 // finest spacing 2 m; level 10 spacing 2048 m (262 km across)
const _v = new THREE.Vector3();

function loadImage(url) { return new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = url; }); }

export class Terrain extends THREE.Group {
  constructor(renderer) {
    super();
    this.renderer = renderer; this.name = 'Terrain'; this.ready = false; this.visible = false;
    this.floatLinear = renderer.extensions.has('OES_texture_float_linear');
  }

  async load(base = 'model/glacier/') {
    const meta = this.meta = await (await fetch(base + 'meta.json')).json();
    const tl = new THREE.TextureLoader();
    // map-aligned images are stored north row first, like the height data: no vertical flip on upload
    const tex = (f, srgb = false, rep = true) => new Promise(res => tl.load(base + f, t => {
      t.flipY = false;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = this.renderer.capabilities.getMaxAnisotropy(); res(t); }));
    // heights: 16 bits packed in R/G of a PNG, decoded once to floats (used by the GPU and by the physics)
    const img = await loadImage(base + 'height.png');
    const W = meta.W, H = meta.H, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, W, H).data, hs = new Float32Array(W * H), span = (meta.hmax - meta.hmin) / 65535;
    for (let i = 0, j = 0; i < hs.length; i++, j += 4) hs[i] = (px[j] * 256 + px[j + 1]) * span + meta.hmin;
    this.h = hs;
    const ht = new THREE.DataTexture(hs, W, H, THREE.RedFormat, THREE.FloatType);
    ht.minFilter = ht.magFilter = this.floatLinear ? THREE.LinearFilter : THREE.NearestFilter; ht.needsUpdate = true;
    const [mask, ao, geo] = await Promise.all([tex('mask.png', false, false), tex('ao.jpg', false, false), tex('geo.jpg', true, false)]);
    // the five ground materials as three texture arrays (layers: rock, snow, ice, debris, gravel): 3 samplers, not 15
    const names = ['rock', 'snow', 'ice', 'debris', 'gravel'];
    const arr = async (kind, srgb) => {
      const imgs = await Promise.all(names.map(n => loadImage(base + `tex/${n}_${kind}.jpg`)));
      const S = imgs[0].width, cv = document.createElement('canvas'); cv.width = cv.height = S; const cg = cv.getContext('2d', { willReadFrequently: true });
      const data = new Uint8Array(S * S * 4 * imgs.length);
      imgs.forEach((im, k) => { cg.drawImage(im, 0, 0, S, S); data.set(cg.getImageData(0, 0, S, S).data, k * S * S * 4); });
      const t = new THREE.DataArrayTexture(data, S, S, imgs.length);
      t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
      t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true; return t;
    };
    const [albA, nrmA, rghA] = await Promise.all([arr('albedo', true), arr('normal', false), arr('rough', false)]);
    for (const t of [mask, ao, geo]) { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; }
    const r = meta.runway, rx = r.t28[0] - r.t10[0], rz = r.t28[1] - r.t10[1], rl = Math.hypot(rx, rz);
    this.rw = { mid: new THREE.Vector2(...r.mid), dir: new THREE.Vector2(rx / rl, rz / rl), len: rl, e10: r.e10, e28: r.e28, t10: new THREE.Vector2(...r.t10) };
    this.u = {
      uH: { value: ht }, uMask: { value: mask }, uAO: { value: ao }, uGeo: { value: geo },
      uAlb: { value: albA }, uNrm: { value: nrmA }, uRgh: { value: rghA },
      uMap: { value: new THREE.Vector4(meta.x0, meta.z0, W * meta.cell, H * meta.cell) }, uTexel: { value: new THREE.Vector2(1 / W, 1 / H) },
      uCell: { value: meta.cell }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uCamP: { value: new THREE.Vector3() }, uSnowExtra: { value: 0 },
      uRwMid: { value: this.rw.mid }, uRwDir: { value: this.rw.dir }, uRwLen: { value: rl }, uTime: { value: 0 },
    };
    this.buildLevels();
    // the airbase (Blender), placed on the graded platform along the runway
    await new Promise((res) => new GLTFLoader().load(base + 'airbase.json', gl => { this.placeAirbase(gl.scene); res(); }, undefined, e => { console.warn('airbase', e); res(); }));
    this.ready = true;
    return this;
  }

  // ------------------------------------------------------------------------------------------ geometry clipmap
  buildLevels() {
    const g = new THREE.BufferGeometry(), pos = [], idx = [];
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) pos.push(i, 0, j);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
      // alternate the diagonal (better silhouettes on ridges)
      if ((i + j) & 1) idx.push(a, c, b, b, c, d); else idx.push(a, c, d, a, d, b);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.levels = [];
    for (let l = 0; l < LEVELS; l++) {
      const m = this.material(l), mesh = new THREE.Mesh(g, m);
      mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.castShadow = false; mesh.renderOrder = -1;
      mesh.userData.lu = m.userData.lu;
      this.add(mesh); this.levels.push(mesh);
    }
  }

  material(l) {
    const lu = { uLvl: { value: new THREE.Vector3() }, uInner: { value: new THREE.Vector4(1, 1, -1, -1) }, uN: { value: N } };
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, envMapIntensity: 1.0 });
    m.userData.lu = lu;
    const U = this.u, fl = this.floatLinear;
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, U, lu);
      const common = `
        uniform sampler2D uH; uniform vec4 uMap; uniform vec2 uTexel; uniform float uCell, uTime;
        uniform vec2 uRwMid, uRwDir; uniform float uRwLen; uniform vec3 uCamP;
        vec2 mapUV(vec2 p) { return (p - uMap.xy) / uMap.zw; }
        float hRaw(vec2 uv) {
          ${fl ? 'return textureLod(uH, uv, 0.0).r;' : `
          vec2 t = uv / uTexel - 0.5; vec2 f = fract(t); ivec2 i = ivec2(floor(t)); ivec2 m = ivec2(1.0 / uTexel) - 1;
          float a = texelFetch(uH, clamp(i, ivec2(0), m), 0).r, b = texelFetch(uH, clamp(i + ivec2(1, 0), ivec2(0), m), 0).r;
          float c = texelFetch(uH, clamp(i + ivec2(0, 1), ivec2(0), m), 0).r, d = texelFetch(uH, clamp(i + ivec2(1, 1), ivec2(0), m), 0).r;
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);`}
        }
        float terrainH(vec2 p) { return hRaw(clamp(mapUV(p), uTexel * 0.5, 1.0 - uTexel * 0.5)); }
        // the graded airfield platform (no rock detail there): 0 on the platform, 1 away from it
        float offField(vec2 p) {
          vec2 d = p - uRwMid; float al = dot(d, uRwDir), sd = dot(d, vec2(-uRwDir.y, uRwDir.x));
          float a = max(abs(al) - uRwLen * 0.5 - 300.0, 0.0), s = max(sd > 0.0 ? sd - 480.0 : -sd - 180.0, 0.0);   // base and taxiway lie south (sd > 0)
          return clamp(max(a, s) / 250.0, 0.0, 1.0);
        }
        float tHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }   // sin-free
        float tNoise(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
          return mix(mix(tHash(i), tHash(i + vec2(1, 0)), u.x), mix(tHash(i + vec2(0, 1)), tHash(i + vec2(1, 1)), u.x), u.y); }
        // sub-30 m relief the elevation data cannot carry: rock steps and boulders, strongest near the camera
        float detailH(vec2 p, float dist) {
          float k = (1.0 - smoothstep(600.0, 2500.0, dist)) * offField(p);
          if (k <= 0.0) return 0.0;
          float n = tNoise(p / 23.0) * 0.55 + tNoise(p / 9.0) * 0.3 + tNoise(p / 3.7) * 0.15;
          return (n - 0.5) * 5.0 * k;
        }
      `;
      sh.vertexShader = common + `
        uniform vec3 uLvl; uniform float uN; varying vec3 vWP; varying float vDist;
      ` + sh.vertexShader
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
        .replace('#include <begin_vertex>', `
          // grid vertex -> world xz; morph odd vertices onto the coarser grid towards the level's outer edge
          vec2 gp = position.xz;
          vec2 p = uLvl.xy + gp * uLvl.z;
          vec2 c = uLvl.xy + vec2(uN * 0.5) * uLvl.z;
          vec2 dd = abs(p - c) / (uN * 0.5 * uLvl.z);
          float morph = smoothstep(0.72, 0.94, max(dd.x, dd.y));
          vec2 odd = mod(gp, 2.0);
          p -= odd * uLvl.z * morph;
          float dist = length(p - uCamP.xz);
          // the graded platform sits half a metre under the paved surfaces (the Blender airbase), so they always win
          vec3 transformed = vec3(p.x, terrainH(p) + detailH(p, dist) - 1.5 * (1.0 - offField(p)), p.y);
          vWP = transformed; vDist = dist;`)
        .replace('#include <project_vertex>', 'vec4 mvPosition = viewMatrix * vec4(transformed, 1.0); gl_Position = projectionMatrix * mvPosition;')
        .replace('#include <worldpos_vertex>', 'vec4 worldPosition = vec4(transformed, 1.0);');
      sh.fragmentShader = common + `
        uniform vec4 uInner; uniform sampler2D uMask, uAO, uGeo;
        uniform highp sampler2DArray uAlb, uNrm, uRgh;
        uniform vec3 uSun; uniform float uSnowExtra;
        varying vec3 vWP; varying float vDist;
        // two scales of the same tile, rotated, so the repeat does not show from the air
        vec4 tri2(highp sampler2DArray t, float layer, vec2 p, float s) { return mix(texture(t, vec3(p / s, layer)), texture(t, vec3(mat2(0.8, -0.6, 0.6, 0.8) * p / (s * 7.3), layer)), 0.4); }
      ` + sh.fragmentShader
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          if (vWP.x > uInner.x && vWP.z > uInner.y && vWP.x < uInner.z && vWP.z < uInner.w) discard;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec2 P = vWP.xz; vec2 uvM = mapUV(P);
          // normal from the height field, sampled over the pixel footprint (so distant ridges do not alias)
          float e = max(uCell, length(fwidth(P)) * 1.2);
          float hx = terrainH(P + vec2(e, 0.0)) - terrainH(P - vec2(e, 0.0)), hz = terrainH(P + vec2(0.0, e)) - terrainH(P - vec2(0.0, e));
          vec3 nG = normalize(vec3(-hx, 2.0 * e, -hz));
          float slope = 1.0 - nG.y;                                  // 0 flat .. ~0.3 at 45 deg
          // curvature over ~90 m: gullies (concave, > 0) gather snow and scree, ridges (convex) are scoured bare
          float ec = max(90.0, e * 2.0), hc = terrainH(P);
          float curv = clamp((terrainH(P + vec2(ec, 0.0)) + terrainH(P - vec2(ec, 0.0)) + terrainH(P + vec2(0.0, ec)) + terrainH(P - vec2(0.0, ec)) - 4.0 * hc) / (ec * 0.6), -1.0, 1.0);
          vec2 fall = normalize(vec2(hx, hz) + 1e-5), perp = vec2(-fall.y, fall.x);
          float across = dot(P, perp), alongF = dot(P, fall);
          vec4 mk = texture2D(uMask, uvM);
          float ice = mk.r, snow = clamp(mk.g + uSnowExtra * smoothstep(3300.0, 4200.0, vWP.y), 0.0, 1.0), deb = mk.b, riv = mk.a;
          float br = tNoise(P / 40.0);
          snow *= smoothstep(0.40, 0.22, slope + (br - 0.5) * 0.10 - curv * 0.12);   // holds to ~50 deg; deeper in gullies
          snow = clamp(snow + curv * 0.25 * smoothstep(4300.0, 5200.0, vWP.y) * (1.0 - smoothstep(0.35, 0.5, slope)), 0.0, 1.0);
          float scree = smoothstep(0.08, 0.25, slope) * smoothstep(0.32, 0.18, slope) * smoothstep(0.0, 0.5, curv + 0.2) * (1.0 - snow);
          float field = 1.0 - offField(P);
          float wIce = ice * (1.0 - deb) * (1.0 - snow * 0.5), wDeb = deb, wSnow = snow * (1.0 - deb * 0.6), wGrv = max(riv, field * 0.85);
          float wRock = max(0.0, 1.0 - wIce - wDeb - wSnow - wGrv);
          float tot = wIce + wDeb + wSnow + wGrv + wRock; wIce /= tot; wDeb /= tot; wSnow /= tot; wGrv /= tot; wRock /= tot;
          float near = 1.0 - smoothstep(2000.0, 9000.0, vDist);
          vec3 geo = texture2D(uGeo, uvM).rgb;
          // each material contributes only where it is present (usually one or two per pixel), and the tiled photo
          // detail only within ~9 km; beyond that the macro colours carry the look
          vec3 alb = vec3(0.0), dn = vec3(0.0); float tRough = 0.0, pond = 0.0;
          bool tex = near > 0.0;
          if (wRock > 0.01) {
            float streak = tNoise(vec2(across / 16.0, alongF / 420.0));
            vec3 c = geo * 0.85 * vec3(1.02, 0.97, 0.9) * (0.72 + 0.56 * streak) * (1.0 - curv * 0.35);
            float r = 0.8;
            if (tex) { c = mix(c, tri2(uAlb, 0.0, P, 9.0).rgb * geo * 1.9 * (0.8 + 0.4 * streak), near * 0.75); r = tri2(uRgh, 0.0, P, 9.0).r; dn += (tri2(uNrm, 0.0, P, 9.0).xyz * 2.0 - 1.0) * wRock; }
            c = mix(c, vec3(0.42, 0.38, 0.33) * (0.85 + 0.3 * br), scree * 0.7);
            alb += c * wRock; tRough += r * wRock;
          }
          if (wSnow > 0.01) {
            vec3 c = vec3(0.86, 0.89, 0.93); float r = 0.6;
            if (tex) { c = mix(c, tri2(uAlb, 1.0, P, 14.0).rgb * vec3(1.02, 1.03, 1.05), near); r = tri2(uRgh, 1.0, P, 14.0).r * 0.9; dn += (tri2(uNrm, 1.0, P, 14.0).xyz * 2.0 - 1.0) * wSnow; }
            alb += c * wSnow; tRough += r * wSnow;
          }
          if (wIce > 0.01) {
            vec3 c = vec3(0.62, 0.74, 0.82); float r = 0.25;
            if (tex) { c = mix(c, tri2(uAlb, 2.0, P, 22.0).rgb, near); r = tri2(uRgh, 2.0, P, 22.0).r; dn += (tri2(uNrm, 2.0, P, 22.0).xyz * 2.0 - 1.0) * wIce; }
            // glacier flow: medial moraines as long stripes downhill, crevasse fields where the ice steepens
            float mor = smoothstep(0.62, 0.8, tNoise(vec2(across / 70.0, alongF / 1800.0)));
            c = mix(c, vec3(0.30, 0.29, 0.28) * (0.8 + 0.4 * br), mor * 0.85);
            if (slope > 0.03) { float crev = smoothstep(0.035, 0.11, slope) * smoothstep(0.86, 0.97, abs(sin(alongF / 9.0 + br * 6.0))); c = mix(c, vec3(0.05, 0.14, 0.22), crev * 0.8 * (1.0 - mor)); }
            alb += c * wIce; tRough += r * wIce;
          }
          if (wDeb > 0.01) {
            float hum = tNoise(P / 140.0), pn = tNoise(P / 95.0 + 17.0);
            vec3 c = vec3(0.28, 0.26, 0.24) * mix(vec3(1.0), geo * 2.2, 0.4); float r = 0.85;
            if (tex) { c = mix(c, tri2(uAlb, 3.0, P, 6.0).rgb * mix(vec3(1.0), geo * 2.2, 0.4), near); r = tri2(uRgh, 3.0, P, 6.0).r; dn += (tri2(uNrm, 3.0, P, 6.0).xyz * 2.0 - 1.0) * wDeb; }
            c *= 0.7 + 0.6 * hum;
            // debris-covered ice: ice cliffs and turquoise meltwater ponds
            pond = smoothstep(0.83, 0.86, pn) * smoothstep(0.2, 0.5, deb) * smoothstep(0.3, 0.6, ice) * (1.0 - smoothstep(0.03, 0.07, slope));
            float cliff = smoothstep(0.7, 0.74, pn) * (1.0 - pond) * smoothstep(0.2, 0.5, deb);
            c = mix(mix(c, vec3(0.56, 0.66, 0.70), cliff * 0.7), vec3(0.06, 0.30, 0.33), pond);
            alb += c * wDeb; tRough += r * wDeb;
          }
          if (wGrv > 0.01) {
            vec3 c = vec3(0.21, 0.18, 0.15); float r = 0.85;
            if (tex) { c = mix(c, tri2(uAlb, 4.0, P, 5.0).rgb * vec3(0.56, 0.49, 0.40), near); r = tri2(uRgh, 4.0, P, 5.0).r; dn += (tri2(uNrm, 4.0, P, 5.0).xyz * 2.0 - 1.0) * wGrv; }
            float sand = tNoise(P / 420.0);
            c *= 0.8 + 0.4 * br; c = mix(c, vec3(0.42, 0.36, 0.27), smoothstep(0.55, 0.75, sand) * 0.6);
            alb += c * wGrv; tRough += r * wGrv;
          }
          float ao = mix(1.0, texture2D(uAO, uvM).r, 0.75);
          diffuseColor.rgb = alb * mix(0.7, 1.0, ao);`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = clamp(mix(tRough, 0.05, pond), 0.05, 1.0);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          {
            vec3 nW = normalize(nG + vec3(dn.x, 0.0, -dn.y) * near * 0.9);
            normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
          }`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          {
            // sun shadow: march from the surface towards the sun through the height field, growing steps
            float shd = 1.0;
            if (uSun.y < -0.05 || dot(nG, uSun) < 0.0) shd = 0.0;          // facing away from the sun: no march needed
            else {
              vec3 o = vWP + nG * 3.0; float t = 15.0;
              for (int i = 0; i < 16; i++) {
                vec3 q = o + uSun * t; float dh = q.y - terrainH(q.xz);
                shd = min(shd, clamp(dh / (t * 0.04) + 0.15, 0.0, 1.0));
                if (shd <= 0.0 || q.y > 8200.0) break;
                t *= 1.5;
              }
            }
            reflectedLight.directDiffuse *= shd; reflectedLight.directSpecular *= shd;
            reflectedLight.indirectDiffuse *= mix(0.7, 1.15, ao);
          }`);
      this.shader = sh;
    };
    m.customProgramCacheKey = () => 'terrain-' + (fl ? 'l' : 'n');
    return m;
  }

  placeAirbase(root) {
    const r = this.rw, mid = r.mid;
    // runway-local Blender frame: X along 10 -> 28, Y left (north), Z up; glTF: x along, y up, z = -left
    const along = new THREE.Vector3(r.dir.x, 0, r.dir.y), up = new THREE.Vector3(0, 1, 0), right = new THREE.Vector3().crossVectors(along, up);
    const slope = (r.e28 - r.e10) / r.len; along.y = slope; along.normalize();
    const m = new THREE.Matrix4().makeBasis(along, up, right);
    root.applyMatrix4(m);
    root.position.set(mid.x, (r.e10 + r.e28) / 2 + 0.02, mid.y);
    root.traverse(o => { if (o.isMesh) { o.receiveShadow = true; o.castShadow = o.position.y > 2 || /Shelter|Hangar|Tower|Tank|Building|hangar|blk/i.test(o.name); if (o.material.map) o.material.map.anisotropy = this.renderer.capabilities.getMaxAnisotropy(); } });
    this.airbase = root; this.add(root);
  }

  // ------------------------------------------------------------------------------------------ queries (physics)
  heightAt(x, z) {
    const M = this.meta; if (!this.h) return 0;
    const fx = (x - M.x0) / M.cell - 0.5, fz = (z - M.z0) / M.cell - 0.5;
    const i = Math.max(0, Math.min(M.W - 2, Math.floor(fx))), j = Math.max(0, Math.min(M.H - 2, Math.floor(fz)));
    const tx = Math.min(1, Math.max(0, fx - i)), tz = Math.min(1, Math.max(0, fz - j)), W = M.W, h = this.h;
    const a = h[j * W + i], b = h[j * W + i + 1], c = h[(j + 1) * W + i], d = h[(j + 1) * W + i + 1];
    return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * tz;
  }
  // runway-local position: along (from the 10 threshold) and side (+ left / north)
  runwayLocal(x, z) { const r = this.rw, dx = x - r.t10.x, dz = z - r.t10.y; return { along: dx * r.dir.x + dz * r.dir.y, side: -(dx * -r.dir.y + dz * r.dir.x) }; }
  onPavement(x, z) {
    const { along, side } = this.runwayLocal(x, z), L = this.rw.len;
    if (along > -60 && along < L + 60 && Math.abs(side) < 22 + 7.5) return 'runway';
    if (along > 40 && along < L - 40 && Math.abs(side + 200) < 11.5) return 'taxiway';
    for (const xc of [60, L / 2, L - 60]) if (Math.abs(along - xc) < 11.5 && side < -22 && side > -200) return 'taxiway';
    if (Math.abs(along - L / 2) < 300 && side < -211 && side > -360) return 'apron';
    return null;
  }
  paveHeight(x, z) {
    const r = this.rw, { along } = this.runwayLocal(x, z), slope = (r.e28 - r.e10) / r.len;
    return (r.e10 + r.e28) / 2 + 0.02 + (along - r.len / 2) * slope + 0.06;
  }
  surface(x, z) {
    const e = 6, h = this.heightAt(x, z);
    const n = _v.set(this.heightAt(x - e, z) - this.heightAt(x + e, z), 2 * e, this.heightAt(x, z - e) - this.heightAt(x, z + e)).normalize().clone();
    const pave = this.onPavement(x, z);
    // paved surfaces: the exact graded profile of the Blender airbase (the rendered ground sits below it)
    const ph = pave ? this.paveHeight(x, z) : h;
    return { h: ph, n: pave ? new THREE.Vector3(0, 1, 0) : n, v: new THREE.Vector3(), terrain: true, runway: pave === 'runway', pavement: !!pave, rough: !pave };
  }

  // ------------------------------------------------------------------------------------------ per frame
  update(camera, sun, dt = 0) {
    if (!this.ready) return;
    this.u.uCamP.value.copy(camera.position); this.u.uSun.value.copy(sun); this.u.uTime.value += dt;
    const cx = camera.position.x, cz = camera.position.z;
    let inner = null;
    for (let l = 0; l < LEVELS; l++) {
      const s = S0 * (1 << l), snap = 2 * s;
      const ox = Math.floor(cx / snap) * snap - N * 0.5 * s, oz = Math.floor(cz / snap) * snap - N * 0.5 * s;
      const lu = this.levels[l].userData.lu;
      lu.uLvl.value.set(ox, oz, s);
      if (inner) lu.uInner.value.copy(inner); else lu.uInner.value.set(1, 1, -1, -1);
      // the next (coarser) level discards this level's square, shrunk by one of its cells against seams
      inner = new THREE.Vector4(ox + s * 0.5, oz + s * 0.5, ox + N * s - s * 0.5, oz + N * s - s * 0.5);
    }
  }
  // range and bearing helpers
  get runwayHeading() { return this.meta.runway.hdg; }
}
