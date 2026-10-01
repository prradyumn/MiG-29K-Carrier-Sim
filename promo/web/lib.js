// Film engine: one paused GSAP timeline, seeked per frame by the renderer. Clips are JPEG sequences from the sim
// (and the Blender turntable) swapped per frame; everything else is DOM/SVG animated by GSAP.
const FPS = 60, DUR = 64.6;
const tl = gsap.timeline({ paused: true });
const $ = s => document.querySelector(s);
const world = $('#world'), typeL = $('#type'), svg = $('#svg'), fxL = $('#fx'), texL = $('#tex');
const SFX = [], VO = [], CLIPS = [];
window.SFX = SFX; window.VO = VO;
const sfx = (t, type, gain = 1) => SFX.push({ t, type, gain });
const vo = (t, id, gain = 1) => VO.push({ t, id, gain });
// seeded hash (never Math.random: every render must be identical)
const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// ---------------------------------------------------------------- clips
// clip(shot, t0, t1, {f0, speed, frames, dir}) — frame index = f0 + (t - t0) * speed, clamped to [0, frames-1]
function clip(shot, t0, t1, o = {}) {
  const el = document.createElement('div'); el.className = 'clip';
  const img = document.createElement('img'); img.className = o.nograde ? '' : 'g'; el.appendChild(img);
  if (!o.nograde) { const t = document.createElement('div'); t.className = 'tint'; el.appendChild(t); }
  world.appendChild(el);
  const c = { shot, t0, t1, f0: o.f0 || 0, speed: o.speed ?? FPS, frames: o.frames || 99999, dir: o.dir || `../build/shots/${shot}`, el, img, cur: null, still: o.still };
  CLIPS.push(c);
  tl.set(el, { visibility: 'visible' }, t0); tl.set(el, { visibility: 'hidden' }, t1);
  return c;
}
function clipSrc(c, t) {
  if (c.still) return `${c.dir}/00000.jpg`;
  const f = Math.max(0, Math.min(c.frames - 1, Math.round(c.f0 + (t - c.t0) * c.speed)));
  return `${c.dir}/${String(f).padStart(5, '0')}.jpg`;
}
// slow push (Ken Burns) on a clip
const push = (c, s0, s1, x = 0, y = 0) => tl.fromTo(c.el, { scale: s0, x: 0, y: 0 }, { scale: s1, x, y, ease: 'none', duration: c.t1 - c.t0, immediateRender: false }, c.t0);

// ---------------------------------------------------------------- global fx
const flashEl = $('#flash'), blackEl = $('#black');
function flash(t, peak = 0.9, dur = 0.35) { tl.set(flashEl, { opacity: peak }, t); tl.to(flashEl, { opacity: 0, duration: dur, ease: 'power2.out', immediateRender: false }, t + 0.001); }
function fadeBlack(t, to, dur) { tl.to(blackEl, { opacity: to, duration: dur, ease: 'power1.inOut', immediateRender: false }, t); }
function shake(t, amp = 14, dur = 0.5) {
  const n = Math.round(dur * 30);
  for (let i = 0; i < n; i++) { const k = 1 - i / n; tl.set(world, { x: (hash(t * 99 + i) - 0.5) * 2 * amp * k, y: (hash(t * 57 + i + 3) - 0.5) * 2 * amp * k }, t + i / 30); }
  tl.set(world, { x: 0, y: 0 }, t + dur);
}
function bars(t, on, dur = 0.45) { tl.to('#bars i', { scaleY: on ? 1 : 0, duration: dur, ease: 'power3.inOut', immediateRender: false }, t); }
// a texture layer (Gemini-generated) with its own animation
function tex(name, t0, t1, from, to, ease = 'none') {
  const im = document.createElement('img'); im.src = `../assets/tex/${name}.jpg`; texL.appendChild(im);
  tl.set(im, { visibility: 'visible', ...from }, t0); tl.to(im, { ...to, duration: t1 - t0, ease, immediateRender: false }, t0); tl.set(im, { visibility: 'hidden' }, t1);
  return im;
}
// three skewed bars that cover the frame exactly at time t (the cut hides underneath)
function wipe(t, colors = ['#ff9a2e', '#07111f', '#0b1a2e'], dir = 1) {
  colors.forEach((col, i) => {
    const b = document.createElement('div');
    Object.assign(b.style, { position: 'absolute', top: '-20%', height: '140%', width: '140%', left: '-20%', background: col, transform: 'skewX(-18deg)', visibility: 'hidden' });
    fxL.appendChild(b);
    const d = 0.18 + i * 0.03;
    tl.set(b, { xPercent: -130 * dir, visibility: 'visible' }, t - d - 0.02);
    tl.to(b, { xPercent: 0, duration: d, ease: 'power3.in', immediateRender: false }, t - d);
    tl.to(b, { xPercent: 130 * dir, duration: d + 0.05, ease: 'power3.out', immediateRender: false }, t + i * 0.03);
    tl.set(b, { visibility: 'hidden' }, t + d + 0.2);
  });
  sfx(t - 0.2, 'whoosh', 0.8);
}

// ---------------------------------------------------------------- typography
// big display lines, each line revealed from below with a stagger
function display(html, t0, t1, css, o = {}) {
  const d = document.createElement('div'); d.className = 'disp ' + (o.cls || ''); d.innerHTML = html.split('|').map(l => `<span class="ln"><span>${l}</span></span>`).join('');
  Object.assign(d.style, css); typeL.appendChild(d);
  const spans = d.querySelectorAll('.ln > span');
  tl.set(d, { visibility: 'visible' }, t0);
  tl.fromTo(spans, { yPercent: 110 }, { yPercent: 0, duration: o.dur || 0.55, ease: 'power4.out', stagger: o.stagger ?? 0.09, immediateRender: true }, t0);
  if (o.drift) tl.fromTo(d, { x: 0 }, { x: o.drift, duration: t1 - t0, ease: 'none', immediateRender: false }, t0);
  if (o.out === 'blur') tl.to(d, { opacity: 0, filter: 'blur(14px)', duration: 0.35, immediateRender: false }, t1 - 0.35);
  else tl.to(spans, { yPercent: -110, duration: 0.35, ease: 'power3.in', stagger: 0.04, immediateRender: false }, t1 - 0.4);
  tl.set(d, { visibility: 'hidden' }, t1);
  return d;
}
function el(html, t0, t1, css, cls = '', inA = { opacity: 0, y: 16 }, dur = 0.4) {
  const d = document.createElement('div'); d.className = cls; d.innerHTML = html; Object.assign(d.style, css); typeL.appendChild(d);
  tl.set(d, { visibility: 'visible' }, t0);
  const toA = {}; for (const k in inA) toA[k] = { opacity: 1, y: 0, x: 0, scale: 1, rotate: 0 }[k] ?? '';
  tl.fromTo(d, inA, { ...toA, duration: dur, ease: 'power3.out', immediateRender: true }, t0);
  tl.to(d, { opacity: 0, duration: 0.3, immediateRender: false }, t1 - 0.3);
  tl.set(d, { visibility: 'hidden' }, t1);
  return d;
}
// chips that tick in one by one
function chips(items, t0, t1, css, step = 0.18, sound = 'tick') {
  const d = document.createElement('div'); d.className = 'chips'; Object.assign(d.style, css); typeL.appendChild(d);
  const cs = items.map(txt => { const c = document.createElement('div'); c.className = 'chip'; c.innerHTML = txt; d.appendChild(c); return c; });
  tl.set(d, { visibility: 'visible' }, t0);
  cs.forEach((c, i) => { tl.fromTo(c, { opacity: 0, x: -24 }, { opacity: 1, x: 0, duration: 0.25, ease: 'power3.out', immediateRender: true }, t0 + i * step); if (sound) sfx(t0 + i * step, sound, 0.5); });
  tl.to(d, { opacity: 0, duration: 0.3, immediateRender: false }, t1 - 0.3);
  tl.set(d, { visibility: 'hidden' }, t1);
  return d;
}
// typewriter into an element
function typeText(node, text, t0, dur) {
  const o = { n: 0 };
  tl.to(o, { n: text.length, duration: dur, ease: 'none', immediateRender: false, onUpdate: () => { node.textContent = text.slice(0, Math.round(o.n)); } }, t0);
  tl.set(node, { textContent: '' }, 0);
}
// number counter
function counter(node, a, b, t0, dur, fmt = v => Math.round(v), ease = 'power2.out') {
  const o = { v: a };
  tl.set(o, { v: a }, 0);
  tl.to(o, { v: b, duration: dur, ease, immediateRender: false, onUpdate: () => { node.textContent = fmt(o.v); } }, t0);
  tl.call(() => { node.textContent = fmt(a); }, null, 0);
}

// ---------------------------------------------------------------- SVG
const NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs, parent = svg) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent.appendChild(e); return e; }
function group(t0, t1) { const g = svgEl('g', { visibility: 'hidden' }); tl.set(g, { attr: { visibility: 'visible' } }, t0); tl.set(g, { attr: { visibility: 'hidden' } }, t1); return g; }
// stroke-draw any path/line/circle
function draw(node, t, dur, ease = 'power2.inOut') {
  const L = node.getTotalLength ? node.getTotalLength() : 1000;
  node.style.strokeDasharray = L; tl.set(node, { strokeDashoffset: L }, 0);
  tl.to(node, { strokeDashoffset: 0, duration: dur, ease, immediateRender: false }, t);
}
// HUD corner brackets
function brackets(t0, t1, pad = 60, col = 'rgba(238,243,248,0.7)') {
  const g = group(t0, t1), L = 46;
  for (const [x, y, sx, sy] of [[pad, pad, 1, 1], [1920 - pad, pad, -1, 1], [pad, 1080 - pad, 1, -1], [1920 - pad, 1080 - pad, -1, -1]]) {
    const p = svgEl('path', { d: `M${x},${y + sy * L} L${x},${y} L${x + sx * L},${y}`, fill: 'none', stroke: col, 'stroke-width': 2.5 }, g);
    draw(p, t0, 0.35);
  }
  return g;
}
// pulsing target ring with a leader line and label
function target(x, y, r, t0, t1, label, lx, ly, col = '#ff9a2e') {
  const g = group(t0, t1);
  const c = svgEl('circle', { cx: x, cy: y, r, fill: 'none', stroke: col, 'stroke-width': 3 }, g);
  const c2 = svgEl('circle', { cx: x, cy: y, r, fill: 'none', stroke: col, 'stroke-width': 2, opacity: 0.8 }, g);
  draw(c, t0, 0.4);
  for (let k = 0; t0 + 0.4 + k * 0.7 < t1; k++) tl.fromTo(c2, { attr: { r }, opacity: 0.9 }, { attr: { r: r * 1.8 }, opacity: 0, duration: 0.7, ease: 'power1.out', immediateRender: false }, t0 + 0.4 + k * 0.7);
  if (label) {
    const ln = svgEl('path', { d: `M${x + (lx > x ? r : -r)},${y} L${lx},${ly}`, fill: 'none', stroke: col, 'stroke-width': 2 }, g);
    draw(ln, t0 + 0.2, 0.35);
    const tx = svgEl('text', { x: lx + (lx > x ? 12 : -12), y: ly + 7, fill: col, 'font-family': 'Mono', 'font-weight': 600, 'font-size': 22, 'letter-spacing': 3, 'text-anchor': lx > x ? 'start' : 'end' }, g);
    tx.textContent = label; tl.fromTo(tx, { opacity: 0 }, { opacity: 1, duration: 0.3, immediateRender: true }, t0 + 0.45);
  }
  return g;
}
// radial gauge ring that sweeps to a value
function ring(cx, cy, r, t0, t1, frac, col, width = 10) {
  const g = group(t0, t1);
  svgEl('circle', { cx, cy, r, fill: 'none', stroke: 'rgba(255,255,255,0.14)', 'stroke-width': width }, g);
  const a = svgEl('circle', { cx, cy, r, fill: 'none', stroke: col, 'stroke-width': width, 'stroke-linecap': 'round', transform: `rotate(-225 ${cx} ${cy})` }, g);
  const L = 2 * Math.PI * r, arc = L * 0.75;
  a.style.strokeDasharray = `${arc} ${L}`; tl.set(a, { strokeDashoffset: arc }, 0);
  return { g, a, arc, sweep: (t, f, dur) => tl.to(a, { strokeDashoffset: arc * (1 - f), duration: dur, ease: 'power2.out', immediateRender: false }, t) };
}

// ---------------------------------------------------------------- grain (8 pre-generated noise tiles)
const grainC = $('#grain'), gctx = grainC.getContext('2d');
const tiles = [];
for (let k = 0; k < 8; k++) {
  const d = gctx.createImageData(960, 540);
  for (let i = 0; i < d.data.length; i += 4) { const v = hash(i * 0.013 + k * 91.7) * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
  tiles.push(d);
}

// ---------------------------------------------------------------- per-frame render entry point
window.renderFrame = async f => {
  const t = f / FPS;
  tl.seek(t, false);
  gctx.putImageData(tiles[Math.floor(f / 2) % 8], 0, 0);
  const waits = [];
  for (const c of CLIPS) {
    if (t < c.t0 || t >= c.t1) continue;
    const src = clipSrc(c, t);
    if (src !== c.cur) { c.cur = src; c.img.src = src; waits.push(c.img.decode().catch(() => {})); }
  }
  await Promise.all(waits);
  return true;
};
window.DUR = DUR; window.FPS = FPS;
