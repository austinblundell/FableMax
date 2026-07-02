import { clamp, clamp01, rand } from './utils.js';

/**
 * Fully procedural audio: crowd bed, bounces, rim clanks, swishes, buzzer,
 * whistle, sneaker squeaks. No audio assets required.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this._crowd = null;
    this.excitement = 0.12;
    this._target = 0.12;
    this._squeakTimer = 0;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;

    this.master = c.createGain();
    this.master.gain.value = 0.9;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(c.destination);

    // --- crowd bed: looping filtered noise
    const len = 4 * c.sampleRate;
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let brown = 0;
      for (let i = 0; i < len; i++) {
        brown = (brown + (Math.random() * 2 - 1) * 0.02) * 0.995;
        d[i] = brown * 6 + (Math.random() * 2 - 1) * 0.06;
      }
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 750;
    bp.Q.value = 0.45;
    const crowdGain = c.createGain();
    crowdGain.gain.value = 0.05;
    src.connect(bp).connect(crowdGain).connect(this.master);
    src.start();
    this._crowd = { gain: crowdGain, filter: bp };
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.9;
  }

  excite(amount) { this._target = Math.min(1, this._target + amount); }

  update(dt) {
    if (!this.ctx || !this._crowd) return;
    this._target = Math.max(0.12, this._target - dt * 0.16);
    this.excitement += (this._target - this.excitement) * (1 - Math.exp(-2.5 * dt));
    const t = this.ctx.currentTime;
    this._crowd.gain.gain.setTargetAtTime(0.05 + this.excitement * 0.35, t, 0.1);
    this._crowd.filter.frequency.setTargetAtTime(650 + this.excitement * 900, t, 0.2);
  }

  // ---- one-shot helpers ------------------------------------------------

  _env(gainVal, dur, curve = 0.015) {
    const c = this.ctx;
    const g = c.createGain();
    const t = c.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gainVal, t + curve);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    g.connect(this.master);
    return g;
  }

  _noise(dur) {
    const c = this.ctx;
    const n = Math.ceil(dur * c.sampleRate);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    return src;
  }

  bounce(speed = 5) {
    if (!this.ctx) return;
    const c = this.ctx;
    const v = clamp01(speed / 9);
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(95 + v * 25, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.09);
    o.connect(this._env(0.5 * (0.25 + v), 0.12));
    o.start(t); o.stop(t + 0.13);
    const n = this._noise(0.05);
    const f = c.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 900;
    n.connect(f).connect(this._env(0.12 * v + 0.03, 0.05));
    n.start(t);
  }

  dribble() { this.bounce(3.2); }

  rim(strength = 5) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const v = clamp01(strength / 8);
    for (const [freq, gain] of [[512, 0.20], [787, 0.13], [1290, 0.07]]) {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = freq * rand(0.99, 1.01);
      o.connect(this._env(gain * (0.4 + v), 0.5));
      o.start(t); o.stop(t + 0.55);
    }
    this.bounce(strength * 0.7);
  }

  board() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.08);
    const f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 900;
    o.connect(f).connect(this._env(0.22, 0.16));
    o.start(t); o.stop(t + 0.18);
  }

  swish() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const n = this._noise(0.28);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.1;
    f.frequency.setValueAtTime(2600, t);
    f.frequency.exponentialRampToValueAtTime(700, t + 0.22);
    n.connect(f).connect(this._env(0.30, 0.28));
    n.start(t);
  }

  squeak() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    const f0 = rand(1900, 3300);
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f0 * rand(1.15, 1.5), t + 0.07);
    const f = c.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 1400;
    o.connect(f).connect(this._env(0.045, 0.09, 0.008));
    o.start(t); o.stop(t + 0.1);
  }

  maybeSqueak(dt, intensity) {
    this._squeakTimer -= dt;
    if (this._squeakTimer <= 0 && Math.random() < intensity) {
      this.squeak();
      this._squeakTimer = rand(0.12, 0.5);
    }
  }

  whistle() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    for (const fr of [2093, 2793]) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = fr;
      const lfo = c.createOscillator();
      lfo.frequency.value = 28;
      const lg = c.createGain();
      lg.gain.value = 90;
      lfo.connect(lg).connect(o.frequency);
      o.connect(this._env(0.10, 0.45));
      o.start(t); o.stop(t + 0.5);
      lfo.start(t); lfo.stop(t + 0.5);
    }
  }

  buzzer() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    for (const fr of [112, 224, 335]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = fr;
      const g = c.createGain();
      g.gain.setValueAtTime(0.14, t);
      g.gain.setValueAtTime(0.14, t + 0.9);
      g.gain.linearRampToValueAtTime(0, t + 1.0);
      o.connect(g).connect(this.master);
      o.start(t); o.stop(t + 1.0);
    }
  }

  horn() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 170;
    o.connect(this._env(0.2, 0.5));
    o.start(t); o.stop(t + 0.5);
  }

  block() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const n = this._noise(0.1);
    const f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 700;
    n.connect(f).connect(this._env(0.3, 0.1));
    n.start(t);
    this.bounce(8);
  }

  dunk() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    o.connect(this._env(0.55, 0.3));
    o.start(t); o.stop(t + 0.32);
    this.rim(9);
  }

  uiClick() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = 660;
    o.connect(this._env(0.07, 0.07, 0.004));
    o.start(t); o.stop(t + 0.08);
  }
}
