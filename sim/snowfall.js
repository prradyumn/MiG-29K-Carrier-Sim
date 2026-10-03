// Falling snow around the camera: one Points draw of 9,000 flakes in a 360 m box that wraps with the camera, drifting
// with the wind and swaying; flakes fade with distance so the box edge never shows.
import * as THREE from 'three';
export class Snowfall extends THREE.Points {
  constructor(n = 9000, box = 360) {
    const g = new THREE.BufferGeometry(), p = new Float32Array(n * 3), r = new Float32Array(n);
    for (let i = 0; i < n; i++) { p[i * 3] = Math.random() * box; p[i * 3 + 1] = Math.random() * box; p[i * 3 + 2] = Math.random() * box; r[i] = Math.random(); }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('seed', new THREE.BufferAttribute(r, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    const m = new THREE.ShaderMaterial({
      uniforms: { uCam: { value: new THREE.Vector3() }, uT: { value: 0 }, uBox: { value: box }, uWind: { value: new THREE.Vector3(3, 0, 1) }, uK: { value: 0 }, uLight: { value: 1 } },
      vertexShader: `#include <common>
        #include <logdepthbuf_pars_vertex>
        uniform vec3 uCam, uWind; uniform float uT, uBox; attribute float seed; varying float vA;
        void main() {
          vec3 q = position + uWind * uT + vec3(sin(uT * 0.7 + seed * 40.0) * 1.5, -uT * (1.0 + seed * 0.8), cos(uT * 0.5 + seed * 30.0) * 1.5);
          q = mod(q - uCam + uBox * 0.5, uBox) - uBox * 0.5;      // wrap round the camera
          vec4 mv = viewMatrix * vec4(uCam + q, 1.0);
          float d = -mv.z; vA = (1.0 - smoothstep(uBox * 0.25, uBox * 0.5, length(q))) * smoothstep(0.5, 3.0, d);
          gl_PointSize = clamp(260.0 / d, 1.0, 10.0) * (0.6 + seed * 0.8);
          gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `#include <common>
        #include <logdepthbuf_pars_fragment>
        uniform float uK, uLight; varying float vA;
        void main() {
          #include <logdepthbuf_fragment>
          vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.15, length(c)) * vA * uK;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vec3(0.92, 0.94, 0.97) * uLight, a * 0.85);
        }`,
      transparent: true, depthWrite: false,
    });
    super(g, m); this.frustumCulled = false; this.visible = false; this.renderOrder = 4;
  }
  update(dt, camera, wind, k, light) {
    this.visible = k > 0.01; if (!this.visible) return;
    const u = this.material.uniforms; u.uT.value += dt; u.uCam.value.copy(camera.position); u.uK.value = k; u.uLight.value = light;
    if (wind) u.uWind.value.set(wind.x, 0, wind.z);
  }
}
