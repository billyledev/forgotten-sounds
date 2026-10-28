/**
 * models.tsx — procedural low-poly device meshes.
 *
 * Spike scope: hand-built primitive compositions (boxes/cylinders) so the
 * demo has zero external asset dependency. Later these are swapped per-device
 * for Poly Pizza / Sketchfab GLBs (see docs/BENCHMARK.md §Assets) — the
 * interface below (`DeviceModel` keyed by device id) is the swap point.
 * Hotspot anchor positions in src/audio/devices.ts match these models.
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';

const MAT = {
  body: { color: '#4a4a55', roughness: 0.7, metalness: 0.1 },
  dark: { color: '#2a2a33', roughness: 0.8 },
  bezel: { color: '#1b1b22', roughness: 0.5 },
  accent: { color: '#c8b26a', roughness: 0.4, metalness: 0.4 },
  paper: { color: '#ddd8c8', roughness: 0.9 },
} as const;

/** Subtle scale pulse with the audio level — the "audio-reactive" hook. */
function Reactive({ level, children }: { level: () => number; children: React.ReactNode }) {
  const ref = useRef<Group>(null);
  useFrame(() => {
    if (ref.current) {
      const l = level();
      ref.current.scale.setScalar(1 + l * 0.02);
    }
  });
  return <group ref={ref}>{children}</group>;
}

export function DeviceModel({ id, level }: { id: string; level: () => number }) {
  switch (id) {
    case 'crt': return <Crt level={level} />;
    case 'modem': return <Modem level={level} />;
    case 'fax': return <Fax level={level} />;
    case 'cassette': return <Cassette level={level} />;
    case 'vinyl': return <Vinyl level={level} />;
    case 'rotary': return <Rotary level={level} />;
    case 'printer': return <Printer level={level} />;
    default: return null;
  }
}

type P = { level: () => number };

function Crt({ level }: P) {
  const screen = useRef<Group>(null);
  useFrame(() => {
    if (screen.current) screen.current.scale.y = 0.9 + level() * 0.15; // scanline flicker proxy
  });
  return (
    <Reactive level={level}>
      <group>
        <mesh castShadow position={[0, -0.1, 0]}>
          <boxGeometry args={[1.6, 1.2, 1.1]} />
          <meshStandardMaterial {...MAT.body} />
        </mesh>
        {/* convex-ish screen: box + slight forward box */}
        <group ref={screen} position={[0, 0.05, 0.56]}>
          <mesh>
            <boxGeometry args={[1.2, 0.9, 0.04]} />
            <meshStandardMaterial color="#1d3a3a" emissive="#0f2a2a" emissiveIntensity={0.6 + level()} />
          </mesh>
        </group>
        <mesh position={[0.62, -0.1, 0.56]}>
          <boxGeometry args={[0.28, 0.9, 0.06]} />
          <meshStandardMaterial {...MAT.dark} />
        </mesh>
        <mesh position={[0.62, -0.1, 0.6]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.05, 0.05, 0.05, 8]} />
          <meshStandardMaterial {...MAT.accent} />
        </mesh>
        <mesh position={[0, -0.75, 0]}>
          <boxGeometry args={[1.7, 0.14, 1.2]} />
          <meshStandardMaterial {...MAT.dark} />
        </mesh>
      </group>
    </Reactive>
  );
}

function Modem({ level }: P) {
  const led = useRef<Group>(null);
  useFrame(() => {
    if (led.current) led.current.visible = level() > 0.02;
  });
  return (
    <Reactive level={level}>
      <group>
        <mesh castShadow>
          <boxGeometry args={[1.5, 0.45, 1.0]} />
          <meshStandardMaterial {...MAT.body} />
        </mesh>
        {/* speaker grille */}
        <mesh position={[0, 0.05, 0.51]}>
          <boxGeometry args={[0.9, 0.25, 0.03]} />
          <meshStandardMaterial {...MAT.bezel} />
        </mesh>
        {/* blinking LEDs — visible while handshake runs */}
        <group ref={led} position={[0.55, 0.05, 0.51]}>
          {[-0.12, 0, 0.12].map((x, i) => (
            <mesh key={i} position={[x, 0, 0.02]}>
              <boxGeometry args={[0.06, 0.06, 0.03]} />
              <meshStandardMaterial color="#41ff6a" emissive="#1fae3a" emissiveIntensity={2} />
            </mesh>
          ))}
        </group>
        <mesh position={[-0.6, 0.05, 0.51]}>
          <boxGeometry args={[0.2, 0.2, 0.03]} />
          <meshStandardMaterial {...MAT.accent} />
        </mesh>
      </group>
    </Reactive>
  );
}

function Fax({ level }: P) {
  return (
    <Reactive level={level}>
      <group>
        <mesh castShadow position={[0, -0.25, 0]}>
          <boxGeometry args={[1.4, 0.5, 1.0]} />
          <meshStandardMaterial {...MAT.body} />
        </mesh>
        <mesh position={[0, 0.15, -0.1]} rotation={[-0.35, 0, 0]}>
          <boxGeometry args={[1.3, 0.5, 0.25]} />
          <meshStandardMaterial {...MAT.dark} />
        </mesh>
        {/* paper sheet */}
        <mesh position={[0, 0.55, -0.28]} rotation={[-0.35, 0, 0]}>
          <boxGeometry args={[0.8, 0.55, 0.02]} />
          <meshStandardMaterial {...MAT.paper} />
        </mesh>
        {/* keypad */}
        <mesh position={[0.35, -0.2, 0.51]}>
          <boxGeometry args={[0.5, 0.3, 0.04]} />
          <meshStandardMaterial {...MAT.bezel} />
        </mesh>
        <mesh position={[-0.45, -0.2, 0.51]}>
          <boxGeometry args={[0.3, 0.12, 0.04]} />
          <meshStandardMaterial color="#3aa050" emissive="#1c5a2a" emissiveIntensity={0.8 + level()} />
        </mesh>
      </group>
    </Reactive>
  );
}

function Cassette({ level }: P) {
  const reels = useRef<Group>(null);
  useFrame((_, dt) => {
    if (reels.current) reels.current.rotation.z -= dt * (0.5 + level() * 4); // spin while playing
  });
  return (
    <Reactive level={level}>
      <group>
        <mesh castShadow>
          <boxGeometry args={[1.3, 0.8, 0.25]} />
          <meshStandardMaterial {...MAT.body} />
        </mesh>
        <mesh position={[0, 0, 0.13]}>
          <boxGeometry args={[1.1, 0.62, 0.02]} />
          <meshStandardMaterial {...MAT.bezel} />
        </mesh>
        <group ref={reels} position={[0, 0, 0.15]}>
          {[-0.3, 0.3].map((x) => (
            <mesh key={x} position={[x, 0, 0]}>
              <cylinderGeometry args={[0.14, 0.14, 0.04, 12]} />
              <meshStandardMaterial {...MAT.paper} />
            </mesh>
          ))}
        </group>
        <mesh position={[0, -0.12, 0.15]}>
          <boxGeometry args={[0.7, 0.14, 0.01]} />
          <meshStandardMaterial color="#5a4632" />
        </mesh>
      </group>
    </Reactive>
  );
}

function Vinyl({ level }: P) {
  const platter = useRef<Group>(null);
  useFrame((_, dt) => {
    if (platter.current) platter.current.rotation.y += dt * (0.8 + level() * 2.5);
  });
  return (
    <Reactive level={level}>
      <group>
        <mesh castShadow position={[0, -0.3, 0]}>
          <boxGeometry args={[1.6, 0.3, 1.2]} />
          <meshStandardMaterial {...MAT.body} />
        </mesh>
        <group ref={platter} position={[-0.15, -0.1, 0]}>
          <mesh>
            <cylinderGeometry args={[0.55, 0.55, 0.06, 24]} />
            <meshStandardMaterial color="#111114" roughness={0.4} />
          </mesh>
          <mesh position={[0, 0.04, 0]}>
            <cylinderGeometry args={[0.08, 0.08, 0.03, 12]} />
            <meshStandardMaterial {...MAT.accent} />
          </mesh>
        </group>
        {/* tonearm */}
        <mesh position={[0.6, -0.05, 0.25]} rotation={[0, -0.4, 0]}>
          <boxGeometry args={[0.7, 0.04, 0.04]} />
          <meshStandardMaterial {...MAT.dark} />
        </mesh>
        <mesh position={[0.3, -0.05, 0.02]}>
          <cylinderGeometry args={[0.04, 0.04, 0.12, 8]} />
          <meshStandardMaterial {...MAT.dark} />
        </mesh>
      </group>
    </Reactive>
  );
}

function Rotary({ level }: P) {
  const dial = useRef<Group>(null);
  useFrame((_, dt) => {
    if (dial.current) dial.current.rotation.z -= dt * level() * 3; // slow return spin while dialing
  });
  return (
    <Reactive level={level}>
      <group>
        <mesh castShadow position={[0, -0.35, 0]}>
          <boxGeometry args={[1.2, 0.45, 1.0]} />
          <meshStandardMaterial {...MAT.body} />
        </mesh>
        {/* handset bar */}
        <mesh position={[0, 0.12, -0.3]}>
          <boxGeometry args={[1.1, 0.12, 0.2]} />
          <meshStandardMaterial {...MAT.bezel} />
        </mesh>
        {[-0.42, 0.42].map((x) => (
          <mesh key={x} position={[x, 0.06, -0.3]}>
            <cylinderGeometry args={[0.08, 0.08, 0.16, 8]} />
            <meshStandardMaterial {...MAT.bezel} />
          </mesh>
        ))}
        {/* rotary plate */}
        <mesh position={[0.15, -0.12, 0.28]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.3, 0.3, 0.06, 20]} />
          <meshStandardMaterial {...MAT.bezel} />
        </mesh>
        <group ref={dial} position={[0.15, -0.12, 0.28]}>
          {Array.from({ length: 10 }, (_, i) => {
            const a = (i / 10) * Math.PI * 2;
            return (
              <mesh key={i} position={[Math.cos(a) * 0.24, 0.04, Math.sin(a) * 0.24]}>
                <cylinderGeometry args={[0.035, 0.035, 0.03, 8]} />
                <meshStandardMaterial {...MAT.paper} />
              </mesh>
            );
          })}
        </group>
        {/* dial center cap */}
        <mesh position={[0.15, -0.08, 0.28]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.08, 0.08, 0.1, 12]} />
          <meshStandardMaterial {...MAT.accent} />
        </mesh>
      </group>
    </Reactive>
  );
}

function Printer({ level }: P) {
  const head = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (head.current) head.current.position.x = Math.sin(clock.elapsedTime * (1 + level() * 6)) * 0.45; // carriage sweep
  });
  return (
    <Reactive level={level}>
      <group>
        <mesh castShadow>
          <boxGeometry args={[1.5, 0.5, 1.0]} />
          <meshStandardMaterial {...MAT.body} />
        </mesh>
        {/* tractor-fed paper rising from the top */}
        <mesh position={[0, 0.6, -0.1]}>
          <boxGeometry args={[0.9, 0.7, 0.02]} />
          <meshStandardMaterial {...MAT.paper} />
        </mesh>
        {[-0.47, 0.47].map((x) => (
          <mesh key={x} position={[x, 0.6, -0.1]}>
            <boxGeometry args={[0.06, 0.72, 0.06]} />
            <meshStandardMaterial {...MAT.dark} />
          </mesh>
        ))}
        {/* moving print head */}
        <group ref={head}>
          <mesh position={[0, 0.3, 0.25]}>
            <boxGeometry args={[0.18, 0.18, 0.18]} />
            <meshStandardMaterial {...MAT.bezel} />
          </mesh>
        </group>
        <mesh position={[0, 0.28, 0]}>
          <boxGeometry args={[1.2, 0.08, 0.4]} />
          <meshStandardMaterial {...MAT.dark} />
        </mesh>
      </group>
    </Reactive>
  );
}
