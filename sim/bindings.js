// Controller mapping: bind any gamepad / joystick / HOTAS axis or button to the sim's actions.
// Axes support invert, dead zone and response curve; a bound throttle axis is absolute (HOTAS) with the
// afterburner past the detent. Stored in localStorage.
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export const AXES = [
  ['pitch', 'Pitch (stick fore / aft)'], ['roll', 'Roll (stick left / right)'], ['yaw', 'Rudder (pedals / twist)'],
  ['throttle', 'Throttle (absolute axis, HOTAS)'], ['lookX', 'Look left / right'], ['lookY', 'Look up / down'],
];
export const BUTTONS = [
  ['thrUp', 'Throttle up (hold)'], ['thrDn', 'Throttle down (hold)'], ['gear', 'Landing gear'], ['hook', 'Tail hook'], ['flaps', 'Flaps'],
  ['launch', 'Release stops (launch)'], ['ab', 'Afterburner / MIL'], ['brake', 'Wheel brakes (hold)'], ['speedbrake', 'Speed brake'],
  ['view', 'Cockpit / chase view'], ['mcaut', 'Master caution reset'], ['lookat', 'Look at highlighted control'], ['replay', 'Instant replay'], ['pause', 'Pause / menu'],
  ['yawL', 'Rudder left (hold)'], ['yawR', 'Rudder right (hold)'],
];
// standard-mapping gamepad defaults (same as the built-in layout)
const DEFAULTS = {
  axes: { pitch: { a: 1 }, roll: { a: 0 }, yaw: null, throttle: null, lookX: { a: 2 }, lookY: { a: 3 } },
  buttons: { thrUp: { b: 7, analog: true }, thrDn: { b: 6, analog: true }, gear: { b: 0 }, hook: { b: 1 }, flaps: { b: 2 }, view: { b: 3 }, launch: { b: 8 },
    pause: { b: 9 }, ab: { b: 10 }, yawL: { b: 4 }, yawR: { b: 5 }, brake: null, speedbrake: null, mcaut: null, lookat: null, replay: null },
  dz: 0.08, curve: 2, inv: {},
};

export class Bindings {
  constructor() {
    this.cfg = JSON.parse(JSON.stringify(DEFAULTS));
    try { const s = JSON.parse(localStorage.getItem('mig29k-bindings') || 'null'); if (s) this.cfg = { ...this.cfg, ...s, axes: { ...this.cfg.axes, ...s.axes }, buttons: { ...this.cfg.buttons, ...s.buttons } }; } catch (e) { }
    this.prev = {}; this.capture = null;
    this.el = document.getElementById('bindings');
    if (this.el) this.buildUI();
  }
  save() { try { localStorage.setItem('mig29k-bindings', JSON.stringify(this.cfg)); } catch (e) { } }
  reset() { this.cfg = JSON.parse(JSON.stringify(DEFAULTS)); this.save(); this.renderUI(); }

  // read one pad: returns shaped axes and button states (edge detection is done by the caller with .edge())
  read(gp) {
    const c = this.cfg, out = { axes: {}, held: {}, pressed: {} };
    const shape = (v, k) => { const d = c.dz; v = Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d); if (c.inv[k]) v = -v; return Math.sign(v) * Math.pow(Math.abs(v), k === 'throttle' ? 1 : c.curve); };
    for (const [k] of AXES) {
      const b = c.axes[k]; if (!b || gp.axes[b.a] == null) continue;
      const raw = gp.axes[b.a];
      out.axes[k] = k === 'throttle' ? clamp(((c.inv[k] ? -raw : raw) * -1 + 1) / 2, 0, 1) : shape(raw, k);
    }
    for (const [k] of BUTTONS) {
      const b = c.buttons[k]; if (!b) continue;
      const btn = gp.buttons[b.b]; if (!btn) continue;
      const v = b.analog ? btn.value : btn.pressed ? 1 : 0;
      out.held[k] = v > 0.05 ? v : 0;
      const key = gp.index + ':' + k, was = this.prev[key];
      out.pressed[k] = v > 0.5 && !was;
      this.prev[key] = v > 0.5;
    }
    return out;
  }
  describe(k, isAxis) {
    const b = isAxis ? this.cfg.axes[k] : this.cfg.buttons[k];
    if (!b) return '—';
    return isAxis ? 'Axis ' + b.a + (this.cfg.inv[k] ? ' (inverted)' : '') : 'Button ' + b.b;
  }
  // capture: wait for the next moved axis or pressed button on any pad
  poll() {
    if (!this.capture) return;
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    if (!pads.length) { this.status('No controller detected. Press any button on it so the browser can see it.'); return; }
    const cap = this.capture;
    if (!cap.base) { cap.base = pads.map(p => ({ axes: [...p.axes], buttons: p.buttons.map(b => b.value) })); this.status('Move the axis or press the button now…'); return; }
    pads.forEach((p, pi) => {
      const base = cap.base[pi]; if (!base) return;
      if (cap.axis) {
        p.axes.forEach((v, i) => { if (Math.abs(v - base.axes[i]) > 0.5 && !cap.done) { cap.done = true; this.cfg.axes[cap.k] = { a: i }; } });
      } else {
        p.buttons.forEach((b, i) => { if (b.value > 0.5 && base.buttons[i] < 0.5 && !cap.done) { cap.done = true; this.cfg.buttons[cap.k] = { b: i, analog: b.value < 0.99 && b.value > 0.01 }; } });
      }
    });
    if (cap.done) { this.capture = null; this.save(); this.renderUI(); this.status('Saved.'); }
  }
  status(t) { const s = this.el?.querySelector('.bstatus'); if (s) s.textContent = t; }
  buildUI() {
    const el = this.el;
    el.querySelector('[data-b=close]').onclick = () => { el.hidden = true; this.capture = null; };
    el.querySelector('[data-b=reset]').onclick = () => this.reset();
    const dz = el.querySelector('[data-b=dz]'), cv = el.querySelector('[data-b=curve]');
    dz.value = this.cfg.dz; cv.value = this.cfg.curve;
    dz.oninput = () => { this.cfg.dz = parseFloat(dz.value); this.save(); };
    cv.oninput = () => { this.cfg.curve = parseFloat(cv.value); this.save(); };
    this.renderUI();
  }
  renderUI() {
    const tb = this.el.querySelector('.brows');
    const row = (k, label, isAxis) => `<div class="brow"><span>${label}</span><code>${this.describe(k, isAxis)}</code>
      <button data-k="${k}" data-ax="${isAxis ? 1 : 0}" class="bbind">Bind</button><button data-k="${k}" data-ax="${isAxis ? 1 : 0}" class="bclear">Clear</button>
      ${isAxis ? `<label class="binv"><input type="checkbox" data-k="${k}" ${this.cfg.inv[k] ? 'checked' : ''}> invert</label>` : '<span></span>'}</div>`;
    tb.innerHTML = '<h3>Axes</h3>' + AXES.map(([k, l]) => row(k, l, true)).join('') + '<h3>Buttons</h3>' + BUTTONS.map(([k, l]) => row(k, l, false)).join('');
    tb.querySelectorAll('.bbind').forEach(b => b.onclick = () => { this.capture = { k: b.dataset.k, axis: b.dataset.ax === '1' }; this.status('Hold still…'); });
    tb.querySelectorAll('.bclear').forEach(b => b.onclick = () => { if (b.dataset.ax === '1') this.cfg.axes[b.dataset.k] = null; else this.cfg.buttons[b.dataset.k] = null; this.save(); this.renderUI(); });
    tb.querySelectorAll('.binv input').forEach(c => c.onchange = () => { this.cfg.inv[c.dataset.k] = c.checked; this.save(); this.renderUI(); });
  }
  open() { this.el.hidden = false; this.renderUI(); this.status(navigator.getGamepads && [...navigator.getGamepads()].some(Boolean) ? 'Controller connected.' : 'Connect a controller and press any button on it.'); }
}
