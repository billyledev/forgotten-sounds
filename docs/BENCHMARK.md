# Benchmark Report — Forgotten Sounds
*One-page interactive audiovisual web experience: synthesized retro-device audio + interactive 3D models. Mobile-first, Vite + TypeScript + React, MIT-only licenses, self-hosted, no paid services. Weighting: mobile performance first.*

Date: 2026-10-27. Full data & sources: `RESEARCH.md`. Project brief: `PROJECT_NOTES.md`.

## Recommendation matrix

Scores 1-5 (5 = best). Weighted total uses the project priority: **Mobile perf ×3**, bundle ×2, license ×2, ergonomics ×1, ecosystem ×1, risk ×1.

### Rendering

| Candidate | License | Bundle (gzip) | Mobile perf | Ergonomics | Ecosystem | Risk | Weighted |
|---|---|---|---|---|---|---|---|
| **three.js r186 + R3F 9.8.2 + drei** | MIT (5) | ~236 kB (3) | 5 | 5 (R3F/drei: OrbitControls, useGLTF, Html hotspots) | 5 | 5 | **49** |
| Babylon.js 9.32 | Apache-2.0 (5) | ~1.7 MB (1) | 3 | 2 (no official React renderer) | 4 | 4 | 33 |
| PlayCanvas 2.10 | MIT (5) | ~622 kB (2) | 4 | 2 | 3 | 4 | 34 |
| OGL 1.0.11 | MIT (5) | ~33 kB (5) | 3 (all manual) | 1 | 1 | 2 (no WebGPU path) | 31 |

**Winner: three.js + React Three Fiber + drei.** Trivially cheap scene profile (single low-poly device, orbit camera, hotspot sprites). WebGPURenderer (`three/webgpu` + TSL) gives one shader codebase with automatic WebGL2 fallback — matches the WebGPU-with-fallback requirement with zero extra code paths. Babylon's payload is disqualifying for a one-page mobile site; OGL is too raw and WebGPU-less.

### Audio synthesis

| Candidate | License | Bundle | Mobile perf | Param-driven per-sample DSP | Risk | Weighted |
|---|---|---|---|---|---|---|
| **Raw WebAudio + custom AudioWorklet (TS)** | platform (5) | ~5-15 kB/voice (5) | 5 (allocation-free process(), dozens of voices) | 5 — full control | 4 | **49** |
| Tone.js 15.1.22 (+ our worklets anyway) | MIT (5) | ~83.5 kB (3) | 3 (per-voice node graphs, main-thread Transport timers) | 2 — walls on crackle/wow-flutter/pin-fire | 4 | 31 |
| Bap 0.8.0 | MIT (5) | ~30 kB (4) | 1 (abandoned 2021, pre-worklet) | 1 | 1 | 20 |
| WebAudioFont | **GPL-3.0 (0)** | heavy sample data (1) | 1 | 0 (sample playback) | 2 | disqualified |

**Winner: raw WebAudio graph + custom AudioWorkletProcessors in TypeScript**, with a minimal in-house lookahead scheduler (automating AudioParams on the audio clock — Chris Wilson pattern; never `setTimeout`). Every library hits a hard wall on at least one of the 7 sounds (Poisson vinyl crackle, fractional-delay wow/flutter, pin-fire bursts, staged modem handshake); all recipes decompose into cheap per-sample primitives that run comfortably in pure-JS worklets on mobile. Optional: borrow Tone.js only for Transport-based event timelines if the modem/fax sequencing gets complex — otherwise skip it. All 7 devices have concrete DSP recipes in `RESEARCH.md` §2.

### Assets

**Primary: Poly Pizza (CC0-filter, API) + Sketchfab CC0/CC-BY** for whatever Poly Pizza lacks; **no Kenney/Quaternius for the devices themselves** (no retro-device coverage). Expect procedural Three.js fallbacks for modem, fax, and dot-matrix printer (no good free stylized models). Every GLB passes through `@gltf-transform/cli optimize --compress meshopt --texture-compress webp --texture-size 512`. No Blender — Node/web tooling only (gltf-transform, gltf-pipeline).

## Mobile performance plan (from research)
- Ship **WebGL2 as primary path**; WebGPU as progressive enhancement (three.js automatic fallback). WebGPU: Chrome Android since 121, **iOS Safari 26 only** — pre-iOS-26 iPhones have none; not Baseline late 2026.
- `dpr={[1, 2]}`, antialias off on mobile, ≤200 draw calls, single mesh/atlas per device, KTX2/WebP textures ≤1024px with mipmaps, no shadows.
- Audio: AudioContext created+resumed inside first user gesture; never force `sampleRate`; AudioWorklet module (same-origin) preloaded before first play; allocation-free `process()`; param changes via AudioParams.
- Audio-reactive: AnalyserNode (fftSize 64-256) → preallocated arrays → few smoothed uniforms per frame.
- Bundle budget: <170 kB compressed critical path; code-split the 3D/audio layers via React.lazy; CI size-limit.

## Stack decision (for the spike)
- **Rendering:** three.js (r186) + @react-three/fiber + @react-three/drei
- **Audio:** WebAudio + custom TypeScript AudioWorkletProcessors, per-device voice modules, in-house param store + lookahead scheduler
- **Assets:** Poly Pizza/Sketchfab CC0-CC-BY + gltf-transform pipeline; procedural fallback
- **Spike:** dial-up modem (staged handshake synth + interactive low-poly modem + glowing hotspots + perf harness, unhidden but wired)

## Risks
- iOS Safari audio quirks (resume discipline, no `outputLatency`) — mitigated by gesture-unlock pattern and runtime sampleRate read.
- Asset cohesion: no single source guarantees a matching stylized retro set — budget time for procedural devices.
- WebGPU on older iPhones absent — WebGL2-first is mandatory, already the chosen path.
