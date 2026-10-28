/**
 * Device registry — single source of truth for the 7 spike devices.
 *
 * Each device declares:
 *  - synth params (kept in code, NOT surfaced in the UI yet — per brief)
 *  - hotspot actions: discrete interactions triggered by tapping a glowing
 *    marker on the 3D model.
 */

export type Hotspot = {
  id: string;
  label: string;
  /** Model-space position (unit ~ model scale used in models.tsx). */
  pos: [number, number, number];
};

export type DeviceDef = {
  id: string; // matches registered worklet processor name
  name: string;
  tagline: string;
  hotspots: Hotspot[];
  /** Tweakable synth params — hidden UI for now, wired for later fine-tuning. */
  params: Record<string, number>;
};

export const DEVICES: DeviceDef[] = [
  {
    id: 'crt',
    name: 'CRT Television',
    tagline: 'Flyback whine, transposed down, with 50 Hz hum & buzz layers',
    params: { brightness: 0.5, whine: 0.6 },
    hotspots: [
      { id: 'power', label: 'Power', pos: [0, -0.45, 0.62] },
      { id: 'brightness', label: 'Brightness', pos: [0.62, -0.1, 0.55] },
    ],
  },
  {
    id: 'modem',
    name: 'Dial-up Modem',
    tagline: 'Full staged V-series handshake: dial, DTMF, answer, FSK, carrier',
    params: { level: 0.9 },
    hotspots: [{ id: 'connect', label: 'Connect', pos: [0, 0.35, 0.65] }],
  },
  {
    id: 'fax',
    name: 'Fax Machine',
    tagline: 'CED tone, V.29 training, carrier + paper roller',
    params: { level: 0.9 },
    hotspots: [{ id: 'send', label: 'Send', pos: [0, 0.62, 0.45] }],
  },
  {
    id: 'cassette',
    name: 'Cassette Tape',
    tagline: 'Motor, hiss floor, wow & flutter, transport clunk',
    params: { flutter: 0.5 },
    hotspots: [
      { id: 'play', label: 'Play / Stop', pos: [0, -0.12, 0.45] },
      { id: 'eject', label: 'Eject clunk', pos: [0.55, -0.12, 0.4] },
    ],
  },
  {
    id: 'vinyl',
    name: 'Vinyl Turntable',
    tagline: 'Poisson crackle, dust bursts, rumble — wear adjustable',
    params: { wear: 0.35 },
    hotspots: [
      { id: 'spin', label: 'Spin / Stop', pos: [-0.55, 0.1, 0.4] },
      { id: 'wear', label: 'Wear', pos: [0.62, 0.05, 0.3] },
    ],
  },
  {
    id: 'rotary',
    name: 'Rotary Phone',
    tagline: 'Governor click trains + inharmonic bell',
    params: { level: 0.9 },
    hotspots: [
      { id: 'dial', label: 'Dial a digit', pos: [0.42, -0.15, 0.42] },
      { id: 'ring', label: 'Ring', pos: [-0.5, 0.1, 0.35] },
    ],
  },
  {
    id: 'printer',
    name: 'Dot-matrix Printer',
    tagline: 'Pin-fire bursts, carriage whir, line-feed clunk',
    params: { speed: 0.5 },
    hotspots: [
      { id: 'print', label: 'Print / Stop', pos: [0, 0.55, 0.4] },
      { id: 'linefeed', label: 'Line feed', pos: [0.55, 0.15, 0.4] },
    ],
  },
];
