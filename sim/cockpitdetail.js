// Cockpit detail pass: attaches model/cockpit_detail.json (Blender: K-36D-3.5 seat, tub frames and looms, canopy sills,
// panel fasteners, MFD rockers, glareshield roll, mirror housings) to the aircraft, retires the airframe's simple seat,
// and gives all cockpit paint a crinkle finish: a triplanar normal / roughness / albedo variation in object space, so
// the dark panels read as painted metal instead of flat black.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// tileable crinkle-paint texture: rg = normal slope, b = height (roughness / albedo variation)
function crinkleTexture(N = 256) {
  const h = new Float32Array(N * N);
  const hash = (x, y) => { const s = Math.sin(((x % N + N) % N) * 127.1 + ((y % N + N) % N) * 311.7) * 43758.5453; return s - Math.floor(s); };
  const vn = (x, y, f) => {   // value noise with period N/f cells
    const c = N / f, X = x / c, Yy = y / c, xi = Math.floor(X), yi = Math.floor(Yy), xf = X - xi, yf = Yy - yi;
    const s = t => t * t * (3 - 2 * t), u = s(xf), v = s(yf), w = q => ((q % f) + f) % f;
    const a = hash(w(xi), w(yi)), b = hash(w(xi + 1), w(yi)), cc = hash(w(xi), w(yi + 1)), d = hash(w(xi + 1), w(yi + 1));
    return a + (b - a) * u + (cc - a) * v + (a - b - cc + d) * u * v;
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    // wrinkled ridges (|noise - 0.5|) over a soft orange-peel base
    const r = 1 - Math.abs(vn(x, y, 32) - 0.5) * 2, o = vn(x + 17, y + 5, 64);
    h[x + y * N] = r * 0.65 + o * 0.35;
  }
  const c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), img = g.createImageData(N, N), k = 2.2;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const H = (i, j) => h[((i + N) % N) + ((j + N) % N) * N];
    const dx = (H(x + 1, y) - H(x - 1, y)) * k, dy = (H(x, y + 1) - H(x, y - 1)) * k, i = (x + y * N) * 4;
    img.data[i] = 128 + Math.max(-127, Math.min(127, -dx * 127)); img.data[i + 1] = 128 + Math.max(-127, Math.min(127, -dy * 127));
    img.data[i + 2] = h[x + y * N] * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t;
}

const CRINKLE = { tex: null };
function crinkle(m, strength = 0.35, albedoVar = 0.3, scale = 9) {
  if (m.userData.crinkle) return;
  m.userData.crinkle = true;
  CRINKLE.tex ||= crinkleTexture();
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev && prev.call(m, sh, r);
    sh.uniforms.uCrinkle = { value: CRINKLE.tex }; sh.uniforms.uTriK = { value: strength }; sh.uniforms.uAlbV = { value: albedoVar }; sh.uniforms.uTriS = { value: scale };
    sh.vertexShader = 'varying vec3 vTriP; varying vec3 vTriN;\n' + sh.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vTriP = position; vTriN = normal;');
    sh.fragmentShader = 'uniform sampler2D uCrinkle; uniform float uTriK, uAlbV, uTriS; uniform mat3 normalMatrix; varying vec3 vTriP; varying vec3 vTriN;\n' +
      `vec4 triSample(vec3 p, vec3 w) { return texture2D(uCrinkle, p.zy) * w.x + texture2D(uCrinkle, p.xz) * w.y + texture2D(uCrinkle, p.xy) * w.z; }\n` + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 triW = abs(normalize(vTriN)); triW /= (triW.x + triW.y + triW.z);
        // large soft blotches: handling wear and uneven sheen, so the dark paint is not a flat colour
        float blotch = triSample(vTriP * 1.4, triW).b * 0.6 + triSample(vTriP * 3.7 + 0.3, triW).b * 0.4;
        diffuseColor.rgb *= 1.0 - uAlbV * 0.5 + uAlbV * blotch;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor * (0.8 + 0.4 * blotch), 0.05, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 n0 = normalize(vTriN); vec3 p = vTriP * uTriS;          // paint: ~11 cm tile of 0.4 mm crinkle ridges; fabric finer
          vec2 tx = texture2D(uCrinkle, p.zy).xy * 2.0 - 1.0, ty = texture2D(uCrinkle, p.xz).xy * 2.0 - 1.0, tz = texture2D(uCrinkle, p.xy).xy * 2.0 - 1.0;
          vec3 pert = triW.x * vec3(0.0, tx.y, tx.x) + triW.y * vec3(ty.x, 0.0, ty.y) + triW.z * vec3(tz.x, tz.y, 0.0);
          vec3 d = normalize(normalMatrix * normalize(n0 + pert * uTriK)) - normalize(normalMatrix * n0);
          normal = normalize(normal + d);
        }`);
  };
  const key0 = m.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : () => '';
  m.customProgramCacheKey = () => key0() + '|crinkle';
  m.envMapIntensity = 0.55;   // the canopy lets the whole sky in: shaded cockpit paint still sees a lot of skylight
  m.needsUpdate = true;
}

// cockpit paint is very dark grey, not black: lift the airframe cockpit's base colours to painted-metal values
const LIFT = { CkPanel: 1.9, CkConsole: 1.7, CkPlate: 2.0, CkCoaming: 1.3, CkBezel: 1.6, CkGrip: 1.4, CkBoot: 1.3, CkKnob: 1.3 };

export function loadCockpitDetail(model, nodes) {
  // the airframe's own cockpit materials
  const seen = new Set();
  model.traverse(o => {
    if (!o.isMesh || !o.material || seen.has(o.material)) return;
    const m = o.material, n = m.name || ''; seen.add(m);
    if (LIFT[n]) m.color.multiplyScalar(LIFT[n]);
    if (n === 'Mirror') { m.color.setScalar(0.5); m.roughness = 0.06; }   // silvered glass, not a chrome block
    if (/^(CkPanel|CkConsole|CkPlate|CkCoaming|CkBezel|CkGrip|CkBoot|CtlPanel|CtlBezel|CtlKnob)$/.test(n)) crinkle(m, n === 'CkCoaming' ? 0.2 : 0.35);
  });
  return new Promise((res, rej) => new GLTFLoader().load('model/cockpit_detail.json', g => {
    const root = g.scene; model.add(root);
    const list = []; root.traverse(o => list.push(o));
    for (const o of list) {
      nodes[o.name] = o;
      if (!o.isMesh) continue;
      o.castShadow = false; o.receiveShadow = true;
      const n = o.material.name || '';
      if (/^Ckd(SeatFrame|Paint|Sill|Clamp|Rocker|MirrorFrame)$/.test(n)) crinkle(o.material);
      else if (/^Ckd(Cushion|Chute|HeadPad|Webbing|Leather|FlightSuit|Vest|GSuit|Mask)$/.test(n)) crinkle(o.material, 0.25, 0.4, 34);   // fabric / leather grain
    }
    // the airframe's simple seat is replaced (its harness stays: it is hidden with the pilot figure)
    for (const nm of ['Seat_frame', 'Seat_cushion', 'Seat_head', 'Seat_handle']) if (nodes[nm]) nodes[nm].visible = false;
    // the glareshield was lowered 5 cm at runtime (over-nose view): its leather roll follows
    if (nodes.Ckd_Glareshield) nodes.Ckd_Glareshield.position.y -= 0.05;
    // mirror housings open with the canopy
    if (nodes.Ckd_MirrorFrames && nodes.CanopyHinge) { model.updateMatrixWorld(true); nodes.CanopyHinge.attach(nodes.Ckd_MirrorFrames); }
    res(root);
  }, undefined, rej));
}
