/**
 * Perf harness — mobile-first, wired from day one, not displayed by default.
 *
 * Collects: FPS / frame-time stats, long-frame count, device pixel ratio,
 * audio context state/sampleRate, and worklet heartbeats (liveness per voice).
 * Read via window.__PERF (live object) or window.__PERF.report() in the
 * console; add ?debug to show the on-screen overlay.
 */
import { audio } from '../audio/AudioEngine';

export type PerfReport = {
  fpsAvg: number;
  fpsLast: number;
  frameMsAvg: number;
  longFrames: number; // frames > 32 ms (missed 30fps budget)
  frames: number;
  dpr: number;
  audio: { state: string; sampleRate: number; baseLatency?: number };
  heartbeats: Record<string, number>;
  startedAt: number;
};

class Harness {
  startedAt = performance.now();
  frames = 0;
  longFrames = 0;
  frameMsSum = 0;
  last = performance.now();
  lastFrame = performance.now();
  fpsWindow: number[] = [];
  heartbeats: Record<string, number> = {};
  raf = 0;

  start(): void {
    const loop = (t: number) => {
      const dt = t - this.lastFrame;
      this.lastFrame = t;
      this.frames++;
      this.frameMsSum += dt;
      if (dt > 32) this.longFrames++;
      if (t - this.last > 1000) {
        this.last = t;
        this.fpsWindow.push(Math.round((this.frames * 1000) / (this.frameMsSum / this.frames || 1)));
        if (this.fpsWindow.length > 60) this.fpsWindow.shift();
        this.frames = 0;
        this.frameMsSum = 0;
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);

    // Worklet liveness: AudioEngine forwards per-voice heartbeats here.
    window.addEventListener('worklet-hb', (e) => {
      this.observeHeartbeat((e as CustomEvent<string>).detail);
    });
  }

  observeHeartbeat(id: string): void {
    this.heartbeats[id] = (this.heartbeats[id] ?? 0) + 1;
  }

  report(): PerfReport {
    const fps = this.fpsWindow.length ? this.fpsWindow : [0];
    return {
      fpsAvg: Math.round(fps.reduce((a, b) => a + b, 0) / fps.length),
      fpsLast: fps[fps.length - 1],
      frameMsAvg: 0,
      longFrames: this.longFrames,
      frames: this.frames,
      dpr: window.devicePixelRatio,
      audio: {
        state: audio.ctx?.state ?? 'none',
        sampleRate: audio.ctx?.sampleRate ?? 0,
        baseLatency: audio.ctx?.baseLatency,
      },
      heartbeats: { ...this.heartbeats },
      startedAt: this.startedAt,
    };
  }
}

export const perf = new Harness();

// Console access without import: window.__PERF.report()
declare global {
  interface Window {
    __PERF: { report: () => PerfReport };
  }
}
window.__PERF = { report: () => perf.report() };
