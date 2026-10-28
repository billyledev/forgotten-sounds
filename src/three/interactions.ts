/**
 * Interaction controller — maps hotspot taps to synth actions per device.
 * Kept separate from the scene so model swaps (GLB assets later) don't
 * touch audio logic. Synth params live in devices.ts; they are adjustable
 * here in code but intentionally not exposed in the UI yet.
 */
import { audio } from '../audio/AudioEngine';
import type { DeviceDef } from '../audio/devices';

export function handleHotspot(device: DeviceDef, hotspotId: string): void {
  const id = device.id;
  switch (id) {
    case 'crt': {
      if (hotspotId === 'power') {
        const on = audio.getParam(id, 'on') < 0.5 ? 1 : 0;
        audio.setParam(id, 'on', on);
      } else if (hotspotId === 'brightness') {
        // cycle brightness 0.2 -> 0.5 -> 0.8
        const cur = audio.getParam(id, 'brightness');
        const next = cur < 0.35 ? 0.5 : cur < 0.65 ? 0.8 : 0.2;
        audio.setParam(id, 'brightness', next);
      }
      break;
    }
    case 'modem': {
      if (hotspotId === 'connect') audio.send(id, { type: 'handshake' });
      break;
    }
    case 'fax': {
      if (hotspotId === 'send') audio.send(id, { type: 'send' });
      break;
    }
    case 'cassette': {
      if (hotspotId === 'play') {
        const playing = audio.getParam(id, 'playing') > 0.5 ? 0 : 1;
        audio.setParam(id, 'playing', playing);
        audio.send(id, { type: 'clunk' });
      } else if (hotspotId === 'eject') {
        audio.send(id, { type: 'clunk' });
      }
      break;
    }
    case 'vinyl': {
      if (hotspotId === 'spin') {
        const spin = audio.getParam(id, 'spinning') > 0.5 ? 0 : 1;
        audio.setParam(id, 'spinning', spin);
      } else if (hotspotId === 'wear') {
        const cur = audio.getParam(id, 'wear');
        audio.setParam(id, 'wear', cur > 0.7 ? 0.1 : cur + 0.3);
      }
      break;
    }
    case 'rotary': {
      if (hotspotId === 'dial') audio.send(id, { type: 'dial', n: 1 + Math.floor(Math.random() * 9) });
      else if (hotspotId === 'ring') audio.send(id, { type: 'ring' });
      break;
    }
    case 'printer': {
      if (hotspotId === 'print') {
        const p = audio.getParam(id, 'printing') > 0.5 ? 0 : 1;
        audio.setParam(id, 'printing', p);
      } else if (hotspotId === 'linefeed') {
        audio.send(id, { type: 'linefeed' });
      }
      break;
    }
  }
}

/** Discrete events sent to each device when it becomes active, so every
 *  device audibly "wakes up" when shown (perceived-liveliness fix). */
const WAKE_ACTION: Record<string, () => void> = {
  crt: () => audio.setParam('crt', 'on', 1),
  modem: () => audio.send('modem', { type: 'handshake' }),
  fax: () => audio.send('fax', { type: 'send' }),
  cassette: () => { audio.setParam('cassette', 'playing', 1); audio.send('cassette', { type: 'clunk' }); },
  vinyl: () => audio.setParam('vinyl', 'spinning', 1),
  rotary: () => audio.send('rotary', { type: 'dial', n: 1 + Math.floor(Math.random() * 9) }),
  printer: () => audio.setParam('printer', 'printing', 1),
};

/** Activate one device (and silence the rest — one device at a time). */
export async function activateDevice(device: DeviceDef): Promise<void> {
  await audio.unlock();
  audio.voice(device.id);
  // Push the device's declared params (kept in code per brief).
  for (const [k, v] of Object.entries(device.params)) audio.setParam(device.id, k, v);
  for (const other of ['crt', 'modem', 'fax', 'cassette', 'vinyl', 'rotary', 'printer']) {
    if (other !== device.id && audio.ctx) void audio.setActive(other, false);
  }
  await audio.setActive(device.id, true);
  // Fire the wake action slightly after the fade-in starts so the first
  // moments are audible (e.g. transport clunk lands as the gain rises).
  WAKE_ACTION[device.id]?.();
}
