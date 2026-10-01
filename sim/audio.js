// Synthesised aircraft audio (WebAudio) + spoken warnings / LSO calls (speechSynthesis).
export class Sound {
  constructor() { this.ok = false; this.voiceOn = true; this.lastSpoken = {}; }
  start() {
    if (this.ok) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b0 = 0.997 * b0 + w * 0.03; b1 = 0.985 * b1 + w * 0.06; b2 = 0.9 * b2 + w * 0.2; d[i] = (b0 + b1 + b2) * 0.6; }
    this.noiseBuf = noiseBuf;
    const noise = () => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.start(); return s; };
    this.master = ctx.createGain(); this.master.gain.value = 0.7; this.master.connect(ctx.destination);
    const chain = (src, type, f, q = 1) => { const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = ctx.createGain(); g.gain.value = 0; src.connect(fl); fl.connect(g); g.connect(this.master); return { f: fl, g }; };
    this.whine = [];
    for (let i = 0; i < 2; i++) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.start();
      const c = chain(o, 'bandpass', 1500, 6);
      this.whine.push({ o, ...c });
    }
    this.roar = chain(noise(), 'lowpass', 400);
    this.ab = chain(noise(), 'lowpass', 180);
    this.wind = chain(noise(), 'bandpass', 900, 0.6);
    this.roll = chain(noise(), 'lowpass', 220);
    const ao = ctx.createOscillator(); ao.type = 'triangle'; ao.start();
    this.apu = { o: ao, ...chain(ao, 'bandpass', 2400, 3) };
    const tone = ctx.createOscillator(); tone.type = 'square'; tone.frequency.value = 880; tone.start();
    this.tone = chain(tone, 'lowpass', 2000);
    this.ok = true;
  }
  burst(freq = 120, dur = 0.35, gain = 0.8, type = 'lowpass') {
    if (!this.ok) return;
    const ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = ctx.createGain(); const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  thump(k = 1) { this.burst(90, 0.4, 0.9 * k); this.burst(1800, 0.12, 0.12 * k, 'highpass'); }
  clunk() { this.burst(260, 0.18, 0.35); }
  cable() { this.burst(600, 1.6, 0.5, 'bandpass'); this.burst(70, 1.2, 0.8); }
  // step-complete chime for the instructor: two soft notes
  chime() {
    if (!this.ok) return;
    const ctx = this.ctx, t = ctx.currentTime;
    [[880, 0], [1320, 0.11]].forEach(([f, d]) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.05, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.35);
      o.connect(g); g.connect(this.master); o.start(t + d); o.stop(t + d + 0.4); });
  }
  // cockpit controls: toggle snap, guard flip, button, heavy gear lever, T-handle pull
  switchClick(kind = 'toggle') {
    if (!this.ok) return;
    const k = { toggle: [3200, 0.035, 0.45], guard: [1500, 0.06, 0.4], button: [2200, 0.03, 0.3], lever: [420, 0.18, 0.6], pull: [900, 0.09, 0.45] }[kind] || [2400, 0.04, 0.35];
    this.burst(k[0], k[1], k[2], 'bandpass');
    if (kind === 'lever' || kind === 'pull') this.burst(160, 0.12, 0.35);
  }
  squeal() { if (!this.ok) return; const ctx = this.ctx, o = ctx.createOscillator(); o.type = 'sawtooth'; const g = ctx.createGain(); const t = ctx.currentTime;
    o.frequency.setValueAtTime(1400, t); o.frequency.exponentialRampToValueAtTime(700, t + 0.35); g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1200; o.connect(f); f.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.45); }

  say(text, key = text, minGap = 4, voice = 'warn') {
    if (!this.voiceOn || !window.speechSynthesis) return;
    const now = performance.now() / 1000;
    if (this.lastSpoken[key] && now - this.lastSpoken[key] < minGap) return;
    this.lastSpoken[key] = now;
    try {
      const u = new SpeechSynthesisUtterance(text);
      const ins = voice === 'instructor';
      u.rate = voice === 'lso' ? 1.15 : ins ? 1.02 : 1.05; u.pitch = voice === 'lso' ? 0.8 : ins ? 1.0 : 1.25; u.volume = 0.9;
      const vs = speechSynthesis.getVoices();
      // three distinct voices: the LSO (male, clipped), the instructor (Indian or British English), cockpit warnings (female)
      const pick = (ins && (vs.find(v => /en[-_]IN/i.test(v.lang)) || vs.find(v => /en[-_]GB/i.test(v.lang) && !/female/i.test(v.name))))
        || vs.find(v => /en[-_](GB|IN|US)/i.test(v.lang) && (voice === 'lso' ? /male|daniel|rishi|alex/i.test(v.name) : /female|samantha|veena|karen|serena/i.test(v.name))) || vs.find(v => /^en/i.test(v.lang));
      if (pick) u.voice = pick;
      // a new LSO call or instructor step replaces whatever was still being said
      if (voice === 'lso' || ins) speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch (e) { }
  }

  update(ac, inside, paused, extra = {}) {
    if (!this.ok) return;
    const t = this.ctx.currentTime, k = 0.08;
    const mute = paused || ac.crashed ? 0 : 1;
    const open = ac.canopy > 0.2 || ac.canopyLost;
    const inF = inside ? (open ? 0.85 : 0.45) : 1;
    for (let i = 0; i < 2; i++) {
      const n = ac.engines[i].N, w = this.whine[i];
      w.o.frequency.setTargetAtTime(120 + 1400 * n + i * 7, t, k);
      w.f.frequency.setTargetAtTime(700 + 2800 * n, t, k);
      w.g.gain.setTargetAtTime(mute * (n > 0.02 ? 0.01 + 0.032 * n : 0) * (inside ? 0.8 : 1), t, k);
    }
    const n = (ac.engines[0].N + ac.engines[1].N) / 2, ab = (ac.engines[0].AB + ac.engines[1].AB) / 2;
    const lit = ac.engines.filter(e => e.state !== 'off' && e.lit).length / 2;
    this.roar.g.gain.setTargetAtTime(mute * inF * lit * (0.04 + 0.36 * n * n), t, k);
    this.roar.f.frequency.setTargetAtTime((inside ? 250 : 400) + 1400 * n, t, k);
    this.ab.g.gain.setTargetAtTime(mute * inF * 0.9 * ab, t, k);
    const q = Math.min(ac.t.qbar / 60000, 1.5);
    this.wind.g.gain.setTargetAtTime(mute * (inside ? (open ? 0.5 : 0.12) : 0.25) * q, t, 0.2);
    this.wind.f.frequency.setTargetAtTime(600 + 1500 * q, t, 0.2);
    const rolling = ac.onGround ? Math.min(ac.t.V / 60, 1) : 0;
    this.roll.g.gain.setTargetAtTime(mute * 0.25 * rolling, t, 0.1);
    const apuN = ac.apu.N;
    this.apu.o.frequency.setTargetAtTime(200 + 2200 * apuN, t, 0.3);
    this.apu.g.gain.setTargetAtTime(mute * 0.05 * apuN * (inside ? 0.6 : 1), t, 0.3);
    // AoA warning tone: beeps faster as AoA approaches the limit
    const aoa = ac.t.alpha * 57.3;
    const on = !ac.onGround && aoa > 21 && ac.power() !== 'none';
    const rate = on ? 2 + (aoa - 21) * 1.5 : 0;
    const beep = on && ((t * rate) % 1) < 0.5;
    this.tone.g.gain.setTargetAtTime(mute * (beep ? 0.05 : 0), t, 0.01);
  }
  suspend(v) { if (this.ok) v ? this.ctx.suspend() : this.ctx.resume(); if (v && window.speechSynthesis) try { speechSynthesis.cancel(); } catch (e) { } }
}
