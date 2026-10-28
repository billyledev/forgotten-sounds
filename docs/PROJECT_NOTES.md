# Forgotten Sounds — Project Brief & Q&A

One-page interactive audiovisual web experience: synthesized audio from old technologies,
accompanied by a 3D visual of the device that emits the sound.

## Q&A (recorded 2026-10-27)

### 1. Scope & audience
- **Q:** One-page museum vs guided linear experience?
  **A:** One page, interactive. Features a "random device" button and a search bar to find a dedicated device.
- **Q:** Desktop / mobile?
  **A:** **Mobile first** — optimize 3D models and audio generation accordingly.
- **Q:** Offline / PWA?
  **A:** Works online; no installable PWA needed.

### 2. Devices & audio
- **Q:** Must-have devices for v1?
  **A:** CRT TV whine, dial-up modem, fax, cassette tape, vinyl, rotary phone, dot-matrix printer.
- **Q:** Synthesized vs sample-based?
  **A:** **Fully synthesized on device** (no mp3 loops) — as close to the original as possible, with
  parameter-driven variations. Requires web research + benchmarks of synthesis solutions/libraries.
- **Q:** Interactive/mutable?
  **A:** Yes — the user interacts with the device to produce the sounds. A cursor/indicator shows where
  to tap. One device at a time (no multi-device soundscape).

### 3. Visuals
- **Q:** Asset style?
  **A:** Stylized low-poly for the start. Free models online; user can also search specific models or
  provide Blender access for custom design.
- **Q:** Audio-reactive?
  **A:** Yes — models are audio reactive and interactive.
- **Q:** Camera?
  **A:** Orbit/free camera (rotate around device). No click-to-zoom, no cinematic shots.

### 4. Tech & constraints
- **Q:** Tooling?
  **A:** Vite + TypeScript project, React for the UI layer. Codebase must stay maintainable and clean.
- **Q:** Perf floor?
  **A:** No fixed target device, but must run on modern (non-high-end) smartphones.
- **Q:** Constraints?
  **A:** No paid assets/services. Self-hosted. Open licenses only — **no copyleft, no closed licenses;
  MIT is the main target**.
- **Q:** WebGPU?
  **A:** Yes, consider WebGPU (performance benefits), with WebGL fallback presumably required for mobile.

### 5. Deliverable & criteria
- **Q:** Benchmark format?
  **A:** Written report with a **recommendation matrix** + a **working spike** (small demo: one device,
  synthesized audio + 3D model, top candidate stack).
- **Q:** Weighting?
  **A:** Focus primarily on **performance** (mobile).

## Open questions (round 2 — answered 2026-10-27)
- **CRT whine:** model *aesthetically*, not strictly realist — transpose down, add hum/buzz layers.
  All sounds: recognizable & pleasant over realistic. Keep the experience joyful.
  Custom **AudioWorklet** DSP is in scope if it wins on aesthetic quality.
- **Tap targets:** simple glowing hotspot markers are fine for the demo.
- **Mutable parameters:** each device gets a set of tweakable params, kept cleanly in code
  (NOT exposed in the UI yet) for later fine-tuning.
- **Spike device:** **dial-up modem**. Include the mobile perf harness from day one
  (not displayed yet). Code should be well commented for later modifications.
- **Assets:** agent searches the web for multiple candidate models per device (user will pick/switch
  between them). CC0 / CC-BY licenses fine. If no good free model exists, generate low-poly devices
  procedurally in Three.js. **No Blender** — NodeJS/web tooling only.
- **Benchmark weighting:** performance first (mobile).

## Engine pitfalls discovered during the spike (2026-10-27)

Verified on Firefox Desktop (PopOS Linux); the app now auto-handles all of these.

1. **Firefox-on-Linux silently drops ALL AudioWorkletNode output** (any topology,
   any context sample rate) while ordinary nodes (oscillators) play fine.
   → `AudioEngine.detectWorkletOutput()` renders a 200 ms probe through an
   OfflineAudioContext at unlock; on silence it switches every voice to a
   ScriptProcessorNode transport running the SAME DSP classes on the main
   thread (`devices.worklet.js` is a dual-transport module: registers
   processors in worklet scope, exports classes for main-thread import).
   Keep this detection when porting to the real implementation.
2. **Firefox ignores AudioParam automation on k-rate worklet params.**
   → Params are 100% message-driven: `setParam` posts `{type:'param'}` and
   processors read them via `this.val(name, default)` — AudioParams are
   declared but never automated.
3. **Series-analyser between a worklet source and the output is fragile.**
   → AnalyserNode is a sink-only parallel TAP off the voice gain; the audio
   path is `source → gain → master → destination` directly.
4. **NaN-in-worklet is invisible**: exceptions in `process()` and NaN phases
   both produce silence without app-level errors. The worklet wrapper
   (`safeRegister`) catches process() exceptions and posts a NaN canary —
   keep it (or equivalents) during development.
5. **ScriptProcessor needs a feeder**: create with 1 input channel (0 throws
   on some FF versions) and park a muted oscillator on its input, or it is
   never pulled. SPN param/event messages must call `proc.onMessage`
   directly — they do not flow through the port shim dispatcher.
6. General mobile rules still apply: create AND resume the AudioContext
   inside a user gesture; never force `sampleRate`; allocation-free
   `process()` (seeded PRNG, no Math.random, no per-quantum postMessage).

## Known issues / TODO for next session (2026-10-27, end of day)

- **Devices not interactive yet**: hotspot taps fire synth events, but the
  models themselves don't respond visually (no animation of buttons/dials/
  levers tied to interactions). Next: wire tap events to model sub-part
  animations (e.g. press modem button, spin rotary plate, move print head).
- **Some procedural models are malformed/badly designed** — needs a visual
  pass on models.tsx (proportions, missing parts, awkward primitives).
  Real GLB assets from Poly Pizza/Sketchfab (see BENCHMARK.md §Assets) may
  replace several of them anyway — decide per device: asset vs rework.
