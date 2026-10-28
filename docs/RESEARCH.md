# Research Dossier — Forgotten Sounds

Compiled 2026-10-27 from parallel web research (sources cited inline). Companion to BENCHMARK.md.

## 1. 3D rendering libraries

| | three.js r186 | Babylon.js 9.32 | PlayCanvas 2.10 | OGL 1.0.11 | R3F 9.8.2 |
|---|---|---|---|---|---|
| License | MIT | Apache-2.0 | MIT | MIT | MIT |
| Bundle (gzip) | ~180 kB full, tree-shakeable (~150-200 kB real apps) | ~1.7 MB core even minimized | ~622 kB, weak tree-shaking | ~33 kB, zero-dep | +56 kB over three |
| WebGPU | Core (`three/webgpu` + TSL), automatic WebGL2 fallback | Most mature (since v5, native WGSL) | Supported in v2 (GLSL transpile) | None — WebGL only | Via three WebGPURenderer; v10 alpha is "WebGPU-first" |
| Mobile perf | Battle-tested; competitive in independent benchmarks (endel/webgpu-webgl-benchmarks, mvaligursky/web-engines-compare) | Good runtime, but payload/startup is the mobile penalty | Historically mobile-optimized | Lowest overhead, but all discipline manual | Same as three; React overhead negligible for small scenes |
| React | R3F = de facto standard | Community-only (Reactylon) | None | None | Native |
| glTF | First-class (gltfjsx, DRACO/KTX2) | First-class | First-class | Loader exists | drei useGLTF (Suspense) |
| Health | r186 Sep 2026, 2000+ contributors | 9.32 Oct 2026, active | v2 active | Slow, stable | v9.8.2 Oct 2026 + v10 alphas |

Verdict: **three.js + React Three Fiber + drei.** OGL only if hand-writing shaders with minimal payload; no WebGPU path is disqualifying.

## 2. Audio synthesis

| | Tone.js 15.1.22 | Bap 0.8.0 | Raw WebAudio + custom AudioWorklet (TS) | WebAudioFont 3.0.4 |
|---|---|---|---|---|
| License | MIT | MIT | platform API | **GPL-3.0 — disallowed** |
| Bundle | ~83.5 kB gzip core (~150-160 kB unshaken) | ~25-30 kB, UMD-only | 0 kB + 5-15 kB per worklet voice | 30-40 kB + sample data files |
| AudioWorklet | None first-class | None (pre-worklet era) | Yes, audio-thread priority | None |
| Mobile perf | Native nodes off main thread, but per-voice node graphs hurt; Transport uses main-thread timers | Abandoned (archived Jan 2021) | Dozens of voices OK if `process()` is allocation-free | Network-heavy sample loading |
| Param-driven per-sample DSP | No (Poisson crackle, wow/flutter resampler impossible without dropping raw) | Minimal | **Full control** | None — sample playback paradigm |
| Maintenance | Active | Dead | W3C baseline (Chrome 66+, Safari 14.1+, Firefox 76+) | Active but wrong paradigm |

Verdict: **Raw WebAudio + custom AudioWorkletProcessors in TypeScript** + minimal in-house scheduler. Every library hits a wall on ≥1 of the 7 sounds; Tone.js Transport is the only worthwhile piece (optional, costs bundle). Key disciplines: allocation-free `process()` (seeded PRNG e.g. mulberry32, no `Math.random()`, no per-quantum postMessage), lookahead scheduler automating AudioParams on the audio clock (Chris Wilson pattern), never `setTimeout`.

### Per-device synthesis recipes
- **CRT whine**: sine/triangle pair ~4-8 kHz (transposed from 15.625/15.734 kHz flyback) with detune + slow amplitude jitter; 50/60 Hz saw-derived hum + harmonics (2f,3f) for buzz; narrow-band noise; brightness-linked gain LFO.
- **Dial-up modem**: scheduled sequence on audio clock — dial tone (350+440 Hz), DTMF pairs, ringback (440+480), 2100 Hz ANSam answer tone (phase reversals + 15 Hz wobble), V.21 FSK (980/1180 originate, 1650/1850 answer), glide + probe chord, overlapped 1200/2400 Hz scramble-pulsed carriers; all through 300-3400 Hz band-pass + line hiss. (Real V.21/V.22bis/V.34 frequencies are public — see github.com/locksec/modem.)
- **Fax**: modem chain subset — 2100 Hz CED, V.29 training (1700 Hz carrier phase-reversal segments), continuous QAM-like carrier + band-limited noise; add paper-feed roller noise.
- **Cassette**: wow & flutter via fractional-delay ring buffer, two summed sine LFOs on read pointer; sub-bass rumble, pink hiss floor, transport clunk, soft-clip d/(1+|d|), HF roll-off. Persistent worklet processor.
- **Vinyl**: band-passed hiss (~1-2 kHz) + per-sample Poisson clicks (p = rate/sampleRate, random amp 0.1-0.35, random polarity) + 1-5 ms dust bursts; "wear" parameter scales rates.
- **Rotary phone**: click trains of 1-3 ms high-passed noise bursts — fast governor (~10 Hz jittered) on return, slow irregular on wind; bell = two detuned inharmonic partials ~2-2.2 kHz, exponential ring + hammer strikes.
- **Dot-matrix**: pin-fire bursts (band-pass 1-4 kHz, rate tied to char density/head speed), carriage servo whir, line-feed thump + stepper clicks, paper hiss. Param-driven "print buffer" event queue.

## 3. Assets & Node tooling

| Site | License | GLB | Retro-device coverage |
|---|---|---|---|
| Poly Pizza (poly.pizza, API key, CC0 filter) | CC0/CC-BY per model, no NC | Native GLB | Cassette (51 hits), TV, telephone; fax/printer sparse |
| Sketchfab (Download API) | per-model CC0/CC-BY (avoid NC/ND) | glTF/GLB variants | Broad; dot-matrix printer rare |
| Kenney / KayKit / Quaternius | CC0 | GLB (Kenney/KayKit); Quaternius FBX-only (avoid — no Blender) | No retro devices — environment dressing only |
| OpenGameArt | per-asset verify | rarely glTF | last resort |

**Pipeline**: every GLB → `gltf-transform optimize --compress meshopt --texture-compress webp --texture-size 512` (meshopt over Draco for fast mobile decode; KTX2/Basis only if GPU memory bound). `gltf-pipeline` = simpler fallback (glTF↔GLB, Draco only). No source guarantees a cohesive stylized set — expect procedural Three.js fallbacks for modem, fax, dot-matrix printer.

## 4. Mobile performance notes

- **iOS audio unlock**: create AND resume AudioContext inside a direct user gesture; re-check `state==='suspended'` and resume before every playback. Don't force `sampleRate` — mismatched forced rate inserts a software resampler (crackling). Read `ctx.sampleRate` at runtime.
- **AudioWorklet on iOS**: supported since iOS 14.5; module must be same-origin; worklet scope has no fetch/setTimeout/TextEncoder; `outputLatency` undefined in Safari. Known iOS 26 PWA resume bug (WebKit 291892, fixed 26.2) — irrelevant (not a PWA) but noted.
- **WebGPU availability**: Chrome Android default-on since 121 (Android 12+, Qualcomm/ARM/Intel); iOS Safari 26 only (Sept 2025) — pre-iOS-26 iPhones have none; Firefox Android not yet. **Not Baseline as of late 2026 → ship WebGL2 as primary path, WebGPU as progressive enhancement** (three.js gives this for free via automatic fallback).
- **WebGL mobile**: cap pixel ratio at `Math.min(devicePixelRatio, 1.5-2)` (dpr={[1,2]} in R3F), disable antialias on mobile, <50-200 draw calls, InstancedMesh/merge, one atlas, KTX2/Basis textures ≤1024px with mipmaps, no shadows / low-res, <100k visible triangles. Test on real mid-tier phones.
- **Audio-reactive visuals**: AnalyserNode → getByteFrequencyData into a preallocated Uint8Array → few smoothed scalar uniforms. Use small fftSize (64-256), smoothingTimeConstant, never allocate per frame. One wiring path, generation-counter pattern for rAF loops.
- **Bundle budget**: <170 kB compressed critical path (web.dev); ceiling ~350 kB JS before mid-tier INP suffers. React.lazy per route, manualChunks for vendor caching, named imports only, rollup-plugin-visualizer + CI size budget, precompressed gzip/brotli.

## Key sources
Rendering: bundlephobia.com/package/{three@0.186.0, @babylonjs/core@9.32.0, playcanvas@2.10.1, ogl@1.0.11, @react-three/fiber@9.8.2}; github.com/mrdoob/three.js/releases; doc.babylonjs.com/setup/support/webGPU; github.com/endel/webgpu-webgl-benchmarks.
Audio: github.com/Tonejs/Tone.js; github.com/adamrenklint/bap; developer.chrome.com/blog/audio-worklet; MDN AudioWorklet; github.com/surikov/webaudiofont (GPL); github.com/locksec/modem; github.com/ShinChanU/vinyl-crackle; github.com/reagan-pius/vinyl-player.
Assets: poly.pizza; sketchfab.com/developers/download-api; kenney.nl/assets; npmjs.com/package/@gltf-transform/cli; npmjs.com/package/gltf-pipeline.
Mobile: caniuse.com/webgpu; github.com/gpuweb/gpuweb/wiki/Implementation-Status; bugs.webkit.org/show_bug.cgi?id=291892; web.dev/articles/your-first-performance-budget; MDN AnalyserNode.
