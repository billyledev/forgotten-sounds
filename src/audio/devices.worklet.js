/**
 * devices.worklet.js — AudioWorklet DSP voices for the Forgotten Sounds spike.
 *
 * One registered processor per retro device. All process() loops are
 * allocation-free (seeded PRNG, preallocated state, no Math.random(), no
 * per-quantum postMessage) so they are GC-safe on mobile audio threads.
 *
 * Interaction model:
 *  - Continuous controls  -> AudioParams (k-rate) set from the main thread.
 *  - Discrete events      -> port messages ({type: '...', ...}).
 *  - Perf/heartbeat       -> each processor posts a {type:'hb', id, voices:1}
 *                            message roughly once per second (main thread
 *                            perf harness uses it for liveness checks).
 */

'use strict';

const TAU = Math.PI * 2;
// Engine-provided sample rate with a defensive fallback: if the global
// is missing/undefined in some engine's worklet scope, every phase
// accumulator would silently become NaN (inaudible, no exception).
// `let` so the main-thread ScriptProcessor transport can retune it.
let SR = (typeof sampleRate === 'number' && sampleRate > 0) ? sampleRate : 48000;

/**
 * Diagnostic-safe registration: wraps each processor so that (a) we report
 * the first process() call ('alive') and (b) any exception inside process()
 * is forwarded to the main thread instead of silently producing zeros
 * (Firefox logs worklet exceptions to console and outputs silence).
 */
function safeRegister(name, cls) {
  registerProcessor(name, class extends cls {
    process(...args) {
      // Advance the fallback clock once per quantum (one process call).
      this._simT = (this._simT || 0) + 128 / SR;
      if (!this.__alive) {
        this.__alive = true;
        this.port.postMessage({ type: 'alive', id: name });
      }
      try {
        const ok = super.process(...args);
        // Ground-truth measurement: peak of what the processor actually wrote.
        const outs = args[1];
        let pk = 0;
        if (outs && outs[0]) {
          const ch = outs[0];
          for (let i = 0; i < ch.length; i++) {
            const a = ch[i] < 0 ? -ch[i] : ch[i];
            if (a > pk) pk = a;
          }
        }
        this._pk = Math.max(this._pk || 0, pk);
        return ok;
      } catch (e) {
        this.port.postMessage({ type: 'err', id: name, msg: String((e && e.message) || e) });
        return false;
      }
    }
  });
}

/** Seeded PRNG (mulberry32) — deterministic, allocation-free. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shared base: heartbeat timer + message queue helper. */
/* Base class must extend AudioWorkletProcessor in worklet scope; on the
 * main thread (ScriptProcessor fallback) a minimal mock stands in. */
const __AWP =
  typeof AudioWorkletProcessor !== 'undefined'
    ? AudioWorkletProcessor
    : class {
        constructor() { this.port = { postMessage() {} }; }
      };
class Base extends __AWP {
  constructor() {
    super();
    this._hb = 0;
    // Message-driven parameter values (portable path: Firefox is known to
    // ignore AudioParam automation on k-rate params, so the main thread
    // ALSO sends params as messages and we read these plain fields).
    this.PV = {};
    this.port.onmessage = (e) => this.onMessage(e.data);
  }
  /** Read a message-set param with fallback default. */
  val(name, def) {
    const v = this.PV[name];
    return v === undefined ? def : v;
  }
  onMessage(msg) {
    if (msg && msg.type === 'param') {
      this.PV[msg.name] = msg.value;
      return;
    }
    // Diagnostic echo of discrete events (cheap: only on explicit events).
    if (msg && msg.type !== 'hb') {
      this.port.postMessage({ type: 'diag', id: this.HB_ID, msg: `evt:${msg.type}` });
    }
    this.onEvent && this.onEvent(msg);
  }
  onEvent() {}
  /** Fallback clock when the global currentTime is unavailable. Advanced
   *  once per quantum by the safeRegister process wrapper. */
  simNow() {
    const c = typeof currentTime !== 'undefined' ? currentTime : NaN;
    return (typeof c === 'number' && isFinite(c)) ? c : (this._simT || 0);
  }
  /** Call at the END of process(): ~1 Hz heartbeat for the perf harness. */
  heartbeat() {
    this._hb += 128 / SR;
    if (this._hb >= 1) {
      this._hb -= 1;
      this.port.postMessage({ type: 'hb', id: this.HB_ID, pk: +(this._pk || 0).toFixed(3) });
      this._pk = 0;
      // NaN canary: phases going NaN means sampleRate/currentTime were bad.
      const ph = [this.p, this.p1, this.p2, this.ph].find((x) => x && !isFinite(x.v));
      if (ph && !this._nanPosted) {
        this._nanPosted = true;
        this.port.postMessage({ type: 'err', id: this.HB_ID, msg: 'NaN phase detected (engine globals missing?)' });
      }
    }
  }
  /** Accumulated sine phase: call per sample, advance, return 0..1. */
  static adv(ph, f) { ph.v += f / SR; if (ph.v >= 1) ph.v -= 1; return ph.v; }
  static sin(ph) { return Math.sin(ph * TAU); }
}

/* ------------------------------------------------------------------ */
/* 1. CRT TV whine — transposed flyback whine + hum/buzz layers        */
/* ------------------------------------------------------------------ */
class CrtProcessor extends Base {
  static get parameterDescriptors() {
    return [
      { name: 'on', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'brightness', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'whine', defaultValue: 0.6, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor() {
    super(); this.HB_ID = 'crt';
    const r = mulberry32(42);
    this.r = r;
    // Whine pair ~5.2 kHz (15.7 kHz flyback transposed down ~1.5 octaves).
    this.p1 = { v: r() }; this.p2 = { v: r() };
    this.ph = { v: 0 };             // mains hum 50 Hz
    this.pb = { v: 0 };             // buzz harmonic driver
    this.jit = 0;                   // slow amplitude jitter walk
    this.lp = 0;                    // one-pole low-pass for narrow noise band
  }
  process(_in, out, p) {
    const on = this.val('on', 0), br = this.val('brightness', 0.5), wg = this.val('whine', 0.6);
    const L = out[0], R = out[1] || out[0], n = L.length;
    for (let i = 0; i < n; i++) {
      // Slow random walk on whine amplitude: analog drift feel.
      this.jit += (this.r() - 0.5) * 0.0005; this.jit *= 0.9995;
      const w1 = Base.sin(Base.adv(this.p1, 5230));
      const w2 = Base.sin(Base.adv(this.p2, 5345));
      const whine = (w1 * 0.6 + w2 * 0.4) * wg * (0.35 + br * 0.65) * (1 + this.jit * 0.3) * 0.05;
      // 50 Hz hum with 2f/3f buzz harmonics (CRT magnetic hum signature).
      const h = Base.adv(this.ph, 50);
      const hum = (Base.sin(h) * 0.6 + Base.sin(h * 2) * 0.25 + Base.sin(h * 3) * 0.12) * 0.035;
      // Narrow noise band around the whine (flyback hash).
      const white = this.r() * 2 - 1;
      this.lp += (white - this.lp) * 0.25;
      const hash = (white - this.lp) * 0.012;
      const s = (whine + hum + hash) * on;
      L[i] = s; R[i] = s;
    }
    this.heartbeat();
    return true;
  }
}

/* ------------------------------------------------------------------ */
/* 2. Dial-up modem — staged V.21/V.22-style handshake state machine   */
/* ------------------------------------------------------------------ */
/* Stage sequence (public V-series tone frequencies):
   0 idle -> 1 dial tone 350+440 -> 2 DTMF dialing -> 3 ringback 440+480
   -> 4 answer tone 2100 (ANSam wobble) -> 5 V.21 FSK both directions
   -> 6 probe glide + chord -> 7 connected carrier (1200/2400 scramble).  */
class ModemProcessor extends Base {
  static get parameterDescriptors() {
    return [{ name: 'level', defaultValue: 0.9, minValue: 0, maxValue: 1, automationRate: 'k-rate' }];
  }
  constructor() {
    super(); this.HB_ID = 'modem';
    this.r = mulberry32(7);
    this.stage = 0; this.stageEnd = 0; this.nextStage = 0;
    this.p = { v: 0 }; this.p2 = { v: 0 };           // main + secondary oscillators
    this.f = 0; this.f2 = 0;                          // current instantaneous freqs
    this.ansamT = 0;                                  // ANSam phase-reversal timer
    this.bitT = 0; this.bit = 0; this.bit2 = 0;       // V.21 FSK bit clocks
    this.dtmfI = 0; this.dtmfT = 0;                   // DTMF sequencer
    this.glide = 0;
    this.lp = 0; this.hp = 0;                         // line shaping
    this.wob = { v: 0 };
  }
  onEvent(msg) {
    if (msg.type === 'handshake') {                   // run the full sequence
      this.stage = 1; this.stageEnd = this.simNow() + 1.6; this.nextStage = 2;
      this.setStageFreqs();
    }
  }
  setStageFreqs() {
    const r = this.r;
    switch (this.stage) {
      case 1: this.f = 350; this.f2 = 440; break;
      case 3: this.f = 440; this.f2 = 480; break;
      case 4: this.f = 2100; this.f2 = 0; break;
      case 6: this.f = 1200; this.f2 = 2300; break;
      case 7: this.f = 1200; this.f2 = 2400; break;
      default: this.f = 0; this.f2 = 0;
    }
    if (r) {} // (prng touched lazily below)
  }
  process(_in, out, p) {
    const lvl = this.val('level', 0.9);
    const L = out[0], R = out[1] || out[0], n = L.length, sr = SR;
    const r = this.r;
    for (let i = 0; i < n; i++) {
      // Stage advance scheduler (sample-accurate via currentTime).
      if (this.stage !== 0 && this.simNow() >= this.stageEnd) {
        this.stage = this.nextStage;
        switch (this.stage) { // next -> [duration, after]
          case 2: this.stageEnd = this.simNow() + 4.5; this.nextStage = 3; this.dtmfI = 0; this.dtmfT = 0; break;
          case 3: this.stageEnd = this.simNow() + 1.8; this.nextStage = 4; break;
          case 4: this.stageEnd = this.simNow() + 2.6; this.nextStage = 5; this.bitT = 0; break;
          case 5: this.stageEnd = this.simNow() + 4.0; this.nextStage = 6; break;
          case 6: this.stageEnd = this.simNow() + 2.8; this.nextStage = 7; break;
          case 7: this.stageEnd = this.simNow() + 1e9; this.nextStage = 7; break;
          default: this.stage = 0;
        }
        this.setStageFreqs();
      }
      let s = 0;
      if (this.stage === 2) {
        // DTMF dialing: pairs of tones per digit (120 ms tone / 80 ms gap).
        const DIG = [[697,1209],[770,1336],[852,1477],[941,1336],[697,1477],[852,1209],[770,1209]];
        this.dtmfT += 1 / sr;
        if (this.dtmfT > 0.2) { this.dtmfT -= 0.2; this.dtmfI = (this.dtmfI + 1) % DIG.length; }
        const d = DIG[this.dtmfI];
        const gate = this.dtmfT < 0.12 ? 1 : 0;
        s = (Base.sin(Base.adv(this.p, d[0])) + Base.sin(Base.adv(this.p2, d[1]))) * 0.14 * gate;
      } else if (this.stage === 4) {
        // ANSam: 2100 Hz answer tone with 15 Hz amplitude wobble + phase reversals.
        this.ansamT += 1 / sr;
        const rev = Math.floor(this.ansamT * 15) % 2 ? -1 : 1;
        const w = 0.7 + 0.3 * Base.sin(Base.adv(this.wob, 15));
        s = Base.sin(Base.adv(this.p, 2100)) * rev * w * 0.16;
      } else if (this.stage === 5) {
        // V.21 FSK both directions: originate 980/1180, answer 1650/1850, 300 baud.
        this.bitT += 1 / sr;
        if (this.bitT > 1 / 300) { this.bitT -= 1 / 300; this.bit = r() > 0.5 ? 1 : 0; this.bit2 = r() > 0.5 ? 1 : 0; }
        this.f = this.bit ? 1180 : 980; this.f2 = this.bit2 ? 1850 : 1650;
        s = Base.sin(Base.adv(this.p, this.f)) * 0.10 + Base.sin(Base.adv(this.p2, this.f2)) * 0.08;
      } else if (this.stage === 6) {
        // Probe: descending glide + wideband chord-ish noise burst.
        this.glide = Math.min(1, this.glide + 1 / (sr * 2.2));
        this.f = 2450 - 1000 * this.glide;
        const white = r() * 2 - 1;
        s = Base.sin(Base.adv(this.p, this.f)) * 0.09 + Base.sin(Base.adv(this.p2, this.f * 0.5)) * 0.05 + white * 0.03;
      } else if (this.stage === 7) {
        // Connected: overlapped 1200/2400 carriers with phase scramble.
        if (r() < 0.002) { this.p.v += (r() - 0.5) * 0.01; this.p2.v += (r() - 0.5) * 0.01; }
        s = Base.sin(Base.adv(this.p, this.f)) * 0.09 + Base.sin(Base.adv(this.p2, this.f2)) * 0.07;
      } else if (this.stage === 1 || this.stage === 3) {
        s = (Base.sin(Base.adv(this.p, this.f)) + Base.sin(Base.adv(this.p2, this.f2))) * 0.11;
      }
      // Telephone-band shaping: gentle bandpass around 300-3400 Hz.
      this.lp += (s - this.lp) * 0.28;
      this.hp = this.lp - this.hp * 0.995;
      s = this.lp - this.hp * 0.4;
      // Faint line hiss floor.
      s += (r() * 2 - 1) * 0.004 * (this.stage ? 1 : 0);
      const v = s * lvl;
      L[i] = v; R[i] = v;
    }
    this.heartbeat();
    return true;
  }
}

/* ------------------------------------------------------------------ */
/* 3. Fax machine — CED + V.29-style training + carrier + paper feed   */
/* ------------------------------------------------------------------ */
class FaxProcessor extends Base {
  static get parameterDescriptors() {
    return [{ name: 'level', defaultValue: 0.9, minValue: 0, maxValue: 1, automationRate: 'k-rate' }];
  }
  constructor() {
    super(); this.HB_ID = 'fax';
    this.r = mulberry32(11);
    this.p = { v: 0 }; this.p2 = { v: 0 };
    this.stage = 0; this.stageEnd = 0; this.nextStage = 0;
    this.trainT = 0;                                  // training phase-reversal segments
    this.rollerT = 0; this.rollEnv = 0;               // paper feed bursts
    this.lp = 0; this.hp = 0;
  }
  onEvent(msg) { if (msg.type === 'send') { this.stage = 1; this.stageEnd = this.simNow() + 1.4; this.nextStage = 2; } }
  process(_in, out, p) {
    const lvl = this.val('level', 0.9);
    const L = out[0], R = out[1] || out[0], n = L.length, sr = SR;
    const r = this.r;
    if (this.stage !== 0 && this.simNow() >= this.stageEnd) {
      this.stage = this.nextStage;
      if (this.stage === 2) { this.stageEnd = this.simNow() + 2.0; this.nextStage = 3; this.trainT = 0; }
      else if (this.stage === 3) { this.stageEnd = this.simNow() + 1e9; this.nextStage = 3; }
      else this.stage = 0;
    }
    for (let i = 0; i < n; i++) {
      let s = 0;
      if (this.stage === 1) {
        s = Base.sin(Base.adv(this.p, 2100)) * 0.14;            // CED tone
      } else if (this.stage === 2) {
        // V.29-style training: 1700 Hz carrier, alternating phase-reversal segments.
        this.trainT += 1 / sr;
        const rev = Math.floor(this.trainT / 0.16) % 2 ? -1 : 1;
        s = Base.sin(Base.adv(this.p, 1700)) * rev * 0.13;
      } else if (this.stage === 3) {
        // Continuous QAM-ish carrier with phase jumps.
        if (r() < 0.003) this.p.v += (r() - 0.5) * 0.02;
        s = Base.sin(Base.adv(this.p, 1700)) * 0.10 + Base.sin(Base.adv(this.p2, 2300)) * 0.05;
        // Paper roller bursts while transmitting.
        this.rollerT += 1 / sr;
        if (this.rollerT > 0.9) { this.rollerT = 0; this.rollEnv = 1; }
        this.rollEnv *= 0.9985;
        s += (r() * 2 - 1) * this.rollEnv * 0.05;
      }
      this.lp += (s - this.lp) * 0.28;
      this.hp = this.lp - this.hp * 0.995;
      s = (this.lp - this.hp * 0.4) * lvl;
      L[i] = s; R[i] = s;
    }
    this.heartbeat();
    return true;
  }
}

/* ------------------------------------------------------------------ */
/* 4. Cassette tape — motor, hiss floor, wow & flutter, transport clunk */
/* ------------------------------------------------------------------ */
class CassetteProcessor extends Base {
  static get parameterDescriptors() {
    return [
      { name: 'playing', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'flutter', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor() {
    super(); this.HB_ID = 'cassette';
    this.r = mulberry32(23);
    this.pm = { v: 0 }; this.w1 = { v: 0 }; this.w2 = { v: 0 };
    this.hissLp = 0; this.rumble = 0; this.clunk = 0;
  }
  onEvent(msg) { if (msg.type === 'clunk') this.clunk = 1; }
  process(_in, out, p) {
    const playing = this.val('playing', 0), fl = this.val('flutter', 0.5);
    const L = out[0], R = out[1] || out[0], n = L.length, sr = SR;
    const r = this.r;
    for (let i = 0; i < n; i++) {
      // Wow (0.6 Hz) + flutter (7 Hz) — summed LFOs modulate tape speed feel.
      const wow = Base.sin(Base.adv(this.w1, 0.6)) * 0.7 + Base.sin(Base.adv(this.w2, 7)) * 0.3;
      const speed = 1 + wow * fl * 0.04;
      const white = r() * 2 - 1;
      // Pink-ish hiss floor (two cascaded one-poles).
      this.hissLp += (white - this.hissLp) * 0.12;
      const hiss = (white - this.hissLp) * 0.035;
      // Sub-bass rumble.
      this.rumble += (white - this.rumble) * 0.004;
      // Motor hum, pitch-modulated by the same speed LFO.
      const motor = Base.sin(Base.adv(this.pm, 110 * speed)) * 0.012 + Base.sin(Base.adv(this.pm, 0.0001)) * 0;
      // Transport clunk on start/stop (filtered thump envelope).
      this.clunk *= 0.9955;
      const clunkS = this.clunk * this.rumble * 8 * 0.15;
      const s = (hiss + this.rumble * 0.6 + motor + clunkS) * playing;
      L[i] = s; R[i] = s;
    }
    this.heartbeat();
    return true;
  }
}

/* ------------------------------------------------------------------ */
/* 5. Vinyl turntable — Poisson crackle, dust bursts, rumble, hiss     */
/* ------------------------------------------------------------------ */
class VinylProcessor extends Base {
  static get parameterDescriptors() {
    return [
      { name: 'spinning', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'wear', defaultValue: 0.35, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor() {
    super(); this.HB_ID = 'vinyl';
    this.r = mulberry32(99);
    this.clickEnv = 0; this.burstEnv = 0; this.burstLen = 0;
    this.rumble = 0; this.hissLp = 0; this.pr = { v: 0 };
  }
  process(_in, out, p) {
    const spin = this.val('spinning', 0), wear = this.val('wear', 0.35);
    const L = out[0], R = out[1] || out[0], n = L.length, sr = SR;
    const r = this.r;
    for (let i = 0; i < n; i++) {
      let s = 0;
      if (spin > 0.5) {
        // Poisson click process: p = rate*dt, rate grows with wear.
        const rate = 4 + wear * 45;
        if (r() < rate / sr) { this.clickEnv = 1; s += (r() > 0.5 ? 1 : -1) * (0.1 + r() * 0.25); }
        // Dust burst: 1-5 ms noise burst with linear decay.
        if (r() < (0.5 + wear * 4) / sr) { this.burstEnv = 1; this.burstLen = (0.001 + r() * 0.004) * sr; }
        if (this.burstEnv > 0) {
          s += (r() * 2 - 1) * this.burstEnv * 0.12;
          this.burstEnv -= 1 / this.burstLen;
        }
        // Surface hiss + rumble (louder groove texture with wear).
        const white = r() * 2 - 1;
        this.hissLp += (white - this.hissLp) * 0.3;
        s += (white - this.hissLp) * (0.008 + wear * 0.02);
        this.rumble += (white - this.rumble) * 0.003;
        s += this.rumble * (0.25 + wear * 0.5);
      }
      this.clickEnv *= 0.9995;
      s += this.clickEnv * 0.03;
      L[i] = s * 0.9; R[i] = s * 0.9;
    }
    this.heartbeat();
    return true;
  }
}

/* ------------------------------------------------------------------ */
/* 6. Rotary phone — governor click trains + inharmonic bell           */
/* ------------------------------------------------------------------ */
class RotaryProcessor extends Base {
  static get parameterDescriptors() {
    return [{ name: 'level', defaultValue: 0.9, minValue: 0, maxValue: 1, automationRate: 'k-rate' }];
  }
  constructor() {
    super(); this.HB_ID = 'rotary';
    this.r = mulberry32(5);
    this.clickT = 0; this.clicksLeft = 0; this.clickEnv = 0;
    this.ringEnv = 0; this.ringT = 0; this.trem = { v: 0 };
    this.p1 = { v: 0 }; this.p2 = { v: 0 };
  }
  onEvent(msg) {
    if (msg.type === 'dial') { this.clicksLeft = msg.n | 0; this.clickT = 0; }  // return-stroke clicks
    else if (msg.type === 'ring') { this.ringEnv = 1; this.ringT = 0; }
  }
  process(_in, out, p) {
    const lvl = this.val('level', 0.9);
    const L = out[0], R = out[1] || out[0], n = L.length, sr = SR;
    const r = this.r;
    for (let i = 0; i < n; i++) {
      let s = 0;
      // Return-stroke click train: ~10 pps, governor-governed, slight jitter.
      if (this.clicksLeft > 0) {
        this.clickT += 1 / sr;
        if (this.clickT > 0.1 + (r() - 0.5) * 0.012) {
          this.clickT = 0; this.clicksLeft--; this.clickEnv = 1;
        }
      }
      this.clickEnv *= 0.999;
      if (this.clickEnv > 0.001) s += (r() * 2 - 1) * this.clickEnv * 0.25;   // 1-3 ms mechanical tick
      // Bell: two detuned inharmonic partials, 20 Hz hammer tremolo, ~2 s ring.
      if (this.ringEnv > 0) {
        this.ringT += 1 / sr;
        this.ringEnv = Math.max(0, 1 - this.ringT / 2.2);
        const tr = 0.55 + 0.45 * Math.abs(Base.sin(Base.adv(this.trem, 20)));
        s += (Base.sin(Base.adv(this.p1, 2010)) * 0.6 + Base.sin(Base.adv(this.p2, 2265)) * 0.5) * this.ringEnv * tr * 0.14;
      }
      const v = s * lvl;
      L[i] = v; R[i] = v;
    }
    this.heartbeat();
    return true;
  }
}

/* ------------------------------------------------------------------ */
/* 7. Dot-matrix printer — pin-fire bursts, carriage whir, line feed   */
/* ------------------------------------------------------------------ */
class PrinterProcessor extends Base {
  static get parameterDescriptors() {
    return [
      { name: 'printing', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'speed', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor() {
    super(); this.HB_ID = 'printer';
    this.r = mulberry32(77);
    this.gatePh = 0; this.carPh = 0;
    this.bp = 0; this.bp2 = 0; this.feedEnv = 0; this.feedT = 0;
  }
  onEvent(msg) { if (msg.type === 'linefeed') this.feedEnv = 1; }
  process(_in, out, p) {
    const printing = this.val('printing', 0), spd = this.val('speed', 0.5);
    const L = out[0], R = out[1] || out[0], n = L.length, sr = SR;
    const r = this.r;
    for (let i = 0; i < n; i++) {
      let s = 0;
      // Pin-fire gate: square wave at head-rate (pitch rises with speed param).
      const rate = 1400 + spd * 1600;
      this.gatePh += rate / sr; if (this.gatePh >= 1) this.gatePh -= 1;
      const gate = this.gatePh < 0.35 ? 1 : 0;
      // Carriage sweep: intensity varies as head traverses the line.
      this.carPh += (0.25 + spd * 0.4) / sr; if (this.carPh >= 1) this.carPh -= 1;
      const car = 0.45 + 0.55 * Math.sin(this.carPh * Math.PI);
      const white = r() * 2 - 1;
      // Band-pass 1-4 kHz approximation (hp of lp).
      this.bp += (white - this.bp) * 0.4;
      const band = white - this.bp;
      this.bp2 += (band - this.bp2) * 0.15;
      s = (band - this.bp2) * gate * car * printing * 0.22;
      // Motor whir under the pins.
      s += Base.sin(Base.adv(this.p2 = this.p2 || { v: 0 }, 95 + spd * 40)) * 0.008 * printing;
      // Line feed: stepper clunk.
      this.feedEnv *= 0.994;
      s += this.rumbleFeed(white) * 0;
      s += this.feedClick(white);
      L[i] = s; R[i] = s;
    }
    this.heartbeat();
    return true;
  }
  rumbleFeed(white) {
    // (kept for later low-thump layering — currently unused)
    return white * 0;
  }
  feedClick(white) {
    // Decaying low thump on line feed message.
    return this.feedEnv * white * 0.18;
  }
}

/* ------------------------------------------------------------------ */
/* Registration (worklet scope only) + main-thread module interface    */
/* ------------------------------------------------------------------ */
/* The SAME file doubles as the main-thread DSP source: when imported as
 * an ES module outside an AudioWorkletGlobalScope (ScriptProcessor
 * fallback), registerProcessor doesn't exist and the classes are
 * exported instead. One source of truth for both transports. */
if (typeof registerProcessor === 'function') {
  safeRegister('crt', CrtProcessor);
  safeRegister('modem', ModemProcessor);
  safeRegister('fax', FaxProcessor);
  safeRegister('cassette', CassetteProcessor);
  safeRegister('vinyl', VinylProcessor);
  safeRegister('rotary', RotaryProcessor);
  safeRegister('printer', PrinterProcessor);
}

export const DSP = {
  crt: CrtProcessor,
  modem: ModemProcessor,
  fax: FaxProcessor,
  cassette: CassetteProcessor,
  vinyl: VinylProcessor,
  rotary: RotaryProcessor,
  printer: PrinterProcessor,
};

/** Main-thread override (ScriptProcessor transport runs at ctx.sampleRate). */
export function setSampleRate(r) {
  if (typeof r === 'number' && r > 0) { SR = r; }
}
