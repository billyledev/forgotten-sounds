/**
 * AudioEngine — singleton wrapper around WebAudio for the spike.
 *
 * Mobile discipline baked in:
 *  - The AudioContext is created AND resumed inside a user gesture
 *    (see `unlock()` called from the first tap anywhere).
 *  - We never force a sampleRate (forced mismatched rates cause iOS crackle).
 *  - The worklet module is same-origin (bundled via Vite ?url import) and is
 *    preloaded right after unlock so first-play latency is minimal.
 *
 * TRANSPORT FALLBACK: some engines (observed: Firefox on Linux) silently
 * drop AudioWorkletNode output while ordinary nodes work. At unlock() we
 * render a 200 ms probe through an OfflineAudioContext; if the worklet
 * produces no sound there, every voice runs the SAME DSP code on the main
 * thread via a ScriptProcessorNode instead (devices.worklet.js is a
 * dual-transport module: it registers processors in worklet scope and
 * exports the classes for main-thread use). Detection is automatic; the
 * rest of the app doesn't care which transport is active.
 */
import workletUrl from './devices.worklet.js?url';

export type ParamSpec = { name: string; min: number; max: number; step: number };

type ProcLike = { process: (i: unknown, o: unknown, p: unknown) => boolean; onMessage: (m: unknown) => void; port: unknown };
type PortLike = { postMessage(d: unknown): void };
type Voice = {
  transport: 'worklet' | 'spn';
  port: PortLike;
  gain: GainNode;
  analyser: AnalyserNode;
  node?: AudioWorkletNode;
  sp?: ScriptProcessorNode;
  proc?: ProcLike;
};

export class AudioEngine {
  ctx: AudioContext | null = null;
  workletReady = false;
  /** false => ScriptProcessor fallback transport (Firefox-on-Linux case). */
  workletOk = true;
  private voices = new Map<string, Voice>();
  private master: GainNode | null = null;
  private freqData: Uint8Array<ArrayBuffer> | null = null;
  private td: Uint8Array<ArrayBuffer> | null = null;
  /** Last-set param values per device (portable getParam). */
  private paramValues = new Map<string, Record<string, number>>();
  private dspMod: { DSP: Record<string, new () => ProcLike>; setSampleRate: (r: number) => void } | null = null;

  /** Call from a user-gesture handler. Idempotent. */
  async unlock(): Promise<void> {
    if (!this.ctx) {
      const Ctor: typeof AudioContext =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor(); // no sampleRate override — see header comment
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (!('audioWorklet' in this.ctx)) {
      throw new Error('AudioWorklet is not available in this browser');
    }
    if (!this.workletReady) {
      await this.ctx.audioWorklet.addModule(workletUrl);
      this.workletReady = true;
      // Decide the transport once: does worklet output actually get rendered?
      this.workletOk = await this.detectWorkletOutput();
      if (!this.workletOk) {
        // Load the SAME module on the main thread (exports the DSP classes).
        this.dspMod = (await import(/* @vite-ignore */ workletUrl)) as typeof this.dspMod;
        this.dspMod!.setSampleRate(this.ctx.sampleRate);
      }
    }
  }

  /**
   * Render a 200 ms 'crt' voice offline; audible RMS proves the engine
   * actually outputs worklet audio. Cheap, silent, one-time.
   */
  private async detectWorkletOutput(): Promise<boolean> {
    try {
      const off = new OfflineAudioContext(1, 9600, 48000);
      await off.audioWorklet.addModule(workletUrl);
      const n = new AudioWorkletNode(off, 'crt', { outputChannelCount: [2] });
      n.port.postMessage({ type: 'param', name: 'on', value: 1 });
      n.connect(off.destination);
      const buf = await off.startRendering();
      const d = buf.getChannelData(0);
      let e = 0;
      for (let i = 0; i < d.length; i++) e += d[i] * d[i];
      return Math.sqrt(e / d.length) > 0.002;
    } catch {
      return false;
    }
  }

  /** Get (or lazily create) the persistent voice for a device. */
  voice(id: string): void {
    if (!this.ctx || !this.workletReady) throw new Error('AudioEngine not unlocked');
    if (this.voices.has(id)) return;
    const gain = this.ctx.createGain();
    gain.gain.value = 0; // silence until activated
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 128; // small FFT: cheap, enough bands for visuals
    analyser.smoothingTimeConstant = 0.8;
    // Shared master stage: gentle boost (voices are deliberately quiet)
    // so the result is audible on phone speakers without per-voice clipping.
    if (!this.master) {
      this.master = this.ctx.createGain();
      this.master.gain.value = 1.5;
      this.master.connect(this.ctx.destination);
    }
    const v: Voice = { transport: this.workletOk ? 'worklet' : 'spn', port: null!, gain, analyser };
    if (v.transport === 'worklet') {
      const node = new AudioWorkletNode(this.ctx, id, { outputChannelCount: [2] });
      v.node = node;
      v.port = node.port;
      node.connect(gain);
    } else {
      // ScriptProcessor fallback: identical DSP classes, main thread.
      const Ctor = this.dspMod!.DSP[id];
      const proc = new Ctor();
      const shim: { onmessage: ((e: { data: unknown }) => void) | null; postMessage: (d: unknown) => void } = {
        onmessage: null,
        postMessage: (d) => shim.onmessage?.({ data: d }),
      };
      proc.port = shim; // processor's postMessage (hb/diag) lands in shim
      // 1 input channel (silence): 0-input SPN throws on some Firefox versions.
      const sp = this.ctx.createScriptProcessor(1024, 1, 2);
      sp.onaudioprocess = (e) => {
        try {
          const out = [e.outputBuffer.getChannelData(0), e.outputBuffer.getChannelData(1)];
          proc.process(null, out, {});
        } catch (err) {
          // Surface main-thread DSP errors instead of glitching silently.
          window.dispatchEvent(new CustomEvent('worklet-diag', {
            detail: { type: 'err', id, msg: String((err as Error)?.message ?? err) },
          }));
        }
      };
      // SPN is only pulled when something feeds its input — park a muted
      // oscillator on the input channel (zero contribution to the mix).
      const feeder = this.ctx.createOscillator();
      const feederGate = this.ctx.createGain();
      feederGate.gain.value = 0;
      feeder.connect(feederGate);
      feederGate.connect(sp);
      feeder.start();
      v.sp = sp;
      v.proc = proc;
      v.port = shim;
      sp.connect(gain);
    }
    // Voice diagnostics + heartbeat -> perf harness (via window event,
    // avoids a circular import between AudioEngine and the harness).
    attachInbound(v.port, (d) => {
      const m = d as { type?: string; id?: string; pk?: number; msg?: string };
      if (m.type === 'hb') {
        window.dispatchEvent(new CustomEvent('worklet-hb', { detail: m.id }));
        window.dispatchEvent(new CustomEvent('worklet-diag', { detail: { type: 'hb', id: m.id, pk: m.pk } }));
      } else if (m.type === 'diag' || m.type === 'err' || m.type === 'alive') {
        window.dispatchEvent(new CustomEvent('worklet-diag', { detail: m }));
      }
    });
    gain.connect(this.master);
    gain.connect(analyser);
    this.voices.set(id, v);
    this.paramValues.set(id, {});
  }

  /** Fade a device in/out (others stay silent — one device at a time). */
  async setActive(id: string, on: boolean): Promise<void> {
    if (!this.ctx) return;
    const v = this.voices.get(id);
    if (!v) return;
    const t = this.ctx.currentTime;
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(v.gain.gain.value, t);
    v.gain.gain.linearRampToValueAtTime(on ? 1 : 0, t + (on ? 0.15 : 0.3));
    // Audio-reactive visual feed.
    if (on && !this.freqData) this.freqData = new Uint8Array(v.analyser.frequencyBinCount);
  }

  /** Set a device param. Message-driven only: the processors read params
   *  from message-set fields (see devices.worklet.js `val()`), NOT from
   *  AudioParams — Firefox ignores k-rate AudioParam automation, so we
   *  never rely on it. Single code path for both transports. */
  setParam(id: string, name: string, value: number): void {
    const v = this.voices.get(id);
    if (!v) return;
    this.paramValues.get(id)![name] = value;
    if (v.proc) v.proc.onMessage({ type: 'param', name, value });
    else v.port.postMessage({ type: 'param', name, value });
  }

  /** Read a param's last set value (drives toggle logic). */
  getParam(id: string, name: string): number {
    return this.paramValues.get(id)?.[name] ?? 0;
  }

  /** Send a discrete event message to a device voice. */
  send(id: string, msg: Record<string, unknown>): void {
    const v = this.voices.get(id);
    if (!v) return;
    if (v.proc) v.proc.onMessage(msg);
    else v.port.postMessage(msg);
  }

  /**
   * RMS band energy 0..1 of the ACTIVE device — drives audio-reactive
   * visuals. Preallocated buffer, no per-frame allocation.
   */
  level(id: string): number {
    const v = this.voices.get(id);
    if (!v || !this.freqData || v.gain.gain.value < 0.01) return 0;
    v.analyser.getByteFrequencyData(this.freqData);
    let sum = 0;
    for (let i = 0; i < this.freqData.length; i++) sum += this.freqData[i];
    return Math.min(1, sum / this.freqData.length / 160);
  }

  /** True while the given device's gain is audibly up. */
  isActive(id: string): boolean {
    const v = this.voices.get(id);
    return !!v && v.gain.gain.value > 0.01;
  }

  /** Live peak level of a device's output (time domain, 0..1). */
  peak(id: string): number {
    const v = this.voices.get(id);
    if (!v) return -1;
    if (!this.td) this.td = new Uint8Array(v.analyser.fftSize);
    v.analyser.getByteTimeDomainData(this.td);
    let peak = 0;
    for (let i = 0; i < this.td.length; i++) {
      const d = Math.abs(this.td[i] - 128) / 128;
      if (d > peak) peak = d;
    }
    return peak;
  }

  /** Snapshot of all voices for diagnostics. */
  snapshot(): Array<{ id: string; gain: number; peak: number; params: string[] }> {
    return [...this.voices.entries()].map(([id, v]) => ({
      id,
      gain: +v.gain.gain.value.toFixed(2),
      peak: +this.peak(id).toFixed(3),
      params: v.node ? [...v.node.parameters.keys()] : Object.keys(this.paramValues.get(id) ?? {}),
    }));
  }
}

/** Attach an inbound-message handler to either transport's port. */
function attachInbound(port: PortLike, handler: (d: unknown) => void): void {
  const p = port as unknown as { onmessage?: unknown };
  if (p.onmessage === undefined && v_hasOnmessageSetter(port)) {
    // SPN shim: plain object with an onmessage slot.
    p.onmessage = (e: { data: unknown }) => handler(e.data);
  } else {
    // AudioWorkletNode port: real MessagePort.
    (port as unknown as MessagePort).onmessage = (e) => handler(e.data);
  }
}
function v_hasOnmessageSetter(port: PortLike): boolean {
  // The SPN shim is a plain object literal with an onmessage key.
  return Object.prototype.hasOwnProperty.call(port, 'onmessage') || !(port instanceof MessagePort);
}

export const audio = new AudioEngine();
export { workletUrl };
