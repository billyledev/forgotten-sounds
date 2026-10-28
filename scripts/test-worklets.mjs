/**
 * Headless DSP validation: stub the AudioWorklet environment, instantiate
 * every registered processor, drive process() for N blocks, assert nonzero
 * output for active states. Catches silent-output/NaN bugs without a browser.
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

// Import the DSP module directly (the same file the worklet loads).
const mod = await import(pathToFileURL('src/audio/devices.worklet.js').href);
mod.setSampleRate(48000);
const registry = mod.DSP;

let currentTime = 0;
globalThis.sampleRate = 48000;
class AudioWorkletProcessor {}
AudioWorkletProcessor.prototype.port = { onmessage: null, postMessage() {} };
Object.defineProperty(AudioWorkletProcessor.prototype, 'currentTime', { get: () => currentTime });
globalThis.currentTime = 0;

function makeBuffer(n) {
  // Real AudioWorkletNode outputs: out[ch] is a Float32Array.
  return [new Float32Array(n), new Float32Array(n)];
}

function drive(proc, seconds, params = {}, messages = []) {
  // Params go through the message path (portable); the k-rate AudioParam
  // arrays are still passed below for backward compatibility.
  Object.entries(params).forEach(([name, v]) => proc.onMessage({ type: 'param', name, value: v[0] }));
  messages.forEach((m) => proc.onMessage(m));
  const block = 128, blocks = Math.ceil((seconds * 48000) / block);
  let energy = 0, nan = false;
  for (let b = 0; b < blocks; b++) {
    currentTime += block / 48000;
    const out = makeBuffer(block);
    proc.process(null, out, params);
    for (const arr of out) {
      for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (Number.isNaN(v)) nan = true;
        energy += v * v;
      }
    }
  }
  return { rms: Math.sqrt(energy / (blocks * block * 2)), nan };
}

const kp = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, [v]]));
const results = {};

// CRT: silent when off, audible when on
{
  const p = new registry.crt();
  const off = drive(p, 0.2, kp({ on: 0, brightness: 0.5, whine: 0.6 }));
  const on = drive(p, 0.5, kp({ on: 1, brightness: 0.8, whine: 0.6 }));
  results.crt = { offRms: off.rms, onRms: on.rms, nan: off.nan || on.nan, ok: off.rms < 1e-6 && on.rms > 1e-4 && !on.nan };
}
// Modem: handshake stages ramp up after dial stage
{
  const p = new registry.modem();
  const idle = drive(p, 0.2, kp({ level: 0.9 }));
  const hs = drive(p, 16, kp({ level: 0.9 }), [{ type: 'handshake' }]);
  results.modem = { idleRms: idle.rms, hsRms: hs.rms, nan: hs.nan, ok: hs.rms > 0.01 && !hs.nan };
}
// Fax
{
  const p = new registry.fax();
  const s = drive(p, 10, kp({ level: 0.9 }), [{ type: 'send' }]);
  results.fax = { rms: s.rms, nan: s.nan, ok: s.rms > 0.01 && !s.nan };
}
// Cassette: playing vs stopped
{
  const p = new registry.cassette();
  const stopped = drive(p, 0.3, kp({ playing: 0, flutter: 0.5 }), [{ type: 'clunk' }]);
  const play = drive(p, 1, kp({ playing: 1, flutter: 0.5 }));
  results.cassette = { stoppedRms: stopped.rms, playRms: play.rms, nan: play.nan, ok: play.rms > 0.002 && !play.nan };
}
// Vinyl: silent when not spinning, crackle when spinning
{
  const p = new registry.vinyl();
  const idle = drive(p, 0.3, kp({ spinning: 0, wear: 0.5 }));
  const spin = drive(p, 2, kp({ spinning: 1, wear: 0.8 }));
  results.vinyl = { idleRms: idle.rms, spinRms: spin.rms, nan: spin.nan, ok: idle.rms < 1e-6 && spin.rms > 0.01 && !spin.nan };
}
// Rotary: dial clicks + ring
{
  const p = new registry.rotary();
  const d = drive(p, 1.5, kp({ level: 0.9 }), [{ type: 'dial', n: 5 }, { type: 'ring' }]);
  results.rotary = { rms: d.rms, nan: d.nan, ok: d.rms > 0.005 && !d.nan };
}
// Printer: silent idle, pin-fire when printing
{
  const p = new registry.printer();
  const idle = drive(p, 0.3, kp({ printing: 0, speed: 0.5 }));
  const pr = drive(p, 1, kp({ printing: 1, speed: 0.8 }), [{ type: 'linefeed' }]);
  results.printer = { idleRms: idle.rms, printRms: pr.rms, nan: pr.nan, ok: idle.rms < 1e-6 && pr.rms > 0.01 && !pr.nan };
}

let pass = true;
for (const [k, r] of Object.entries(results)) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${k}`, JSON.stringify(r));
  if (!r.ok) pass = false;
}
process.exit(pass ? 0 : 1);
