/**
 * App.tsx — one-page shell: 3D stage + navigation (arrows, search, random)
 * + first-gesture audio unlock. Mobile-first layout.
 */
import { useCallback, useMemo, useState } from 'react';
import { Scene } from './three/Scene';
import { DEVICES } from './audio/devices';
import { audio } from './audio/AudioEngine';
import { activateDevice, handleHotspot } from './three/interactions';
import { perf } from './perf/harness';

// Append ?debug to the URL for the audio diagnostics overlay.
const DEBUG = new URLSearchParams(window.location.search).has('debug');

// Live refresh of the debug panel values (outside React state — polled).
if (DEBUG) {
  const diag: Record<string, string> = {};
  const pk: Record<string, number> = {};
  window.addEventListener('worklet-diag', (e) => {
    const d = (e as CustomEvent).detail as { type: string; id: string; msg?: string; pk?: number };
    if (d.type === 'err') diag[d.id] = `ERROR: ${d.msg}`;
    else if (d.type === 'hb') pk[d.id] = d.pk ?? 0;
    else if (d.type === 'diag') diag[d.id] = diag[d.id]?.startsWith('ERROR') ? diag[d.id] : `last event: ${d.msg}`;
    else if (d.type === 'alive') diag[d.id] = diag[d.id]?.startsWith('ERROR') ? diag[d.id] : 'process() running';
  });
  setInterval(() => {
    const el = document.getElementById('dbg-lines');
    if (!el) return;
    const snap = audio.snapshot();
    const lastErr = (window as unknown as { __DBG_ERR?: string }).__DBG_ERR ?? audioErrGlobal;
    el.innerHTML =
      `ctx=${audio.ctx?.state ?? 'none'} sr=${audio.ctx?.sampleRate ?? 0} ` +
      `worklet=${audio.workletReady} transport=${audio.workletOk ? 'worklet' : 'SPN-FALLBACK'}<br>` +
      (snap.length
        ? snap
            .map((v) => {
              const d = diag[v.id] ? ` [${diag[v.id]}]` : '';
              return `${v.id}: gain=${v.gain} peak=${v.peak} wrotePk=${pk[v.id] ?? '?'} params=[${v.params.join(',')}||${v.params.length}]${d}`;
            })
            .join('<br>')
        : 'no voices created') +
      (lastErr ? `<br><span style="color:#f88">ERR: ${lastErr}</span>` : '');
  }, 500);
}
// Last activation error, set from App handlers below.
let audioErrGlobal: string | null = null;

function reportAudioError(e: unknown): void {
  const msg = e instanceof Error ? e.message : String(e);
  console.error('[audio]', e);
  audioErrGlobal = msg;
  (window as unknown as { __DBG_ERR?: string }).__DBG_ERR = msg;
}

export default function App() {
  const [index, setIndex] = useState(0); // current device
  const [query, setQuery] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [audioErr, setAudioErr] = useState<string | null>(null);
  const device = DEVICES[index];

  const show = useCallback(
    (i: number) => {
      const d = DEVICES[(i + DEVICES.length) % DEVICES.length];
      setIndex((i + DEVICES.length) % DEVICES.length);
      activateDevice(d).catch(reportAudioError);
    },
    []
  );

  const level = useCallback(() => audio.level(device.id), [device.id]);

  const onFirstTap = useCallback(() => {
    if (unlocked) return;
    perf.start();
    void audio.unlock().then(() => {
      setUnlocked(true);
      return activateDevice(DEVICES[0]);
    }).catch((e) => {
      // Never swallow audio setup failures — surface them in the UI.
      console.error('Audio init failed:', e);
      setAudioErr(e instanceof Error ? e.message : String(e));
      reportAudioError(e);
      setUnlocked(false); // allow retry on next tap
    });
  }, [unlocked]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? DEVICES.filter((d) => d.name.toLowerCase().includes(q)) : DEVICES;
  }, [query]);

  const onHotspot = useCallback(
    (hotspotId: string) => {
      void audio.unlock()
        .then(() => handleHotspot(device, hotspotId))
        .catch(reportAudioError);
    },
    [device]
  );

  return (
    <div className="app" onPointerDown={onFirstTap}>
      <Scene device={device} level={level} onHotspot={onHotspot} />

      {/* top bar: title + search */}
      <header className="topbar">
        <h1>Forgotten Sounds</h1>
        <div className="search">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a device…"
            aria-label="Search devices"
          />
          {query && (
            <ul className="results">
              {results.map((d) => (
                <li key={d.id}>
                  <button onClick={() => { show(DEVICES.indexOf(d)); setQuery(''); }}>{d.name}</button>
                </li>
              ))}
              {results.length === 0 && <li className="empty">No device found</li>}
            </ul>
          )}
        </div>
        <button className="random" onClick={() => show(Math.floor(Math.random() * DEVICES.length))}>
          ⤫ Random
        </button>
      </header>

      {/* bottom: device name + arrows */}
      <footer className="bottombar">
        <button className="arrow" aria-label="Previous device" onClick={() => show(index - 1)}>‹</button>
        <div className="device-info">
          <h2>{device.name}</h2>
          <p>{device.tagline}</p>
        </div>
        <button className="arrow" aria-label="Next device" onClick={() => show(index + 1)}>›</button>
      </footer>

      {!unlocked && (
        <div className="unlock-hint">
          <span>{audioErr ? `Audio error: ${audioErr}` : 'Tap to wake the machines'}</span>
        </div>
      )}

      {DEBUG && (
        <div className="debug-panel">
          <b>Audio diagnostics</b>
          <div id="dbg-lines" />
          <button
            onClick={() => {
              // Raw oscillator straight to destination — bypasses ALL app DSP.
              // Silent => system/browser audio problem. Audible => our graph.
              void audio.unlock().then(() => {
                const ctx = audio.ctx!;
                const o = ctx.createOscillator();
                o.frequency.value = 440;
                const g = ctx.createGain();
                g.gain.value = 0.2;
                o.connect(g).connect(ctx.destination);
                o.start();
                o.stop(ctx.currentTime + 1);
              }).catch((e) => setAudioErr(String(e)));
            }}
          >
            Play 1s test tone
          </button>
        </div>
      )}
    </div>
  );
}
