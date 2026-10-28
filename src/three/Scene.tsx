/**
 * Scene.tsx — R3F canvas: orbit camera, device model, glowing hotspots.
 * Mobile-first render settings: dpr capped, no antialias, no shadows, no post.
 */
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import { useRef } from 'react';
import { DeviceModel } from './models';
import type { DeviceDef } from '../audio/devices';

function Hotspot({
  pos,
  label,
  onTap,
}: {
  pos: [number, number, number];
  label: string;
  onTap: () => void;
}) {
  const ring = useRef<Mesh | null>(null);
  useFrame(({ clock }) => {
    if (ring.current) {
      const s = 1 + Math.sin(clock.elapsedTime * 4) * 0.15; // pulse
      ring.current.scale.setScalar(s);
    }
  });
  return (
    <group position={pos}>
      {/* glowing core (visual only — small) */}
      <mesh>
        <sphereGeometry args={[0.055, 12, 12]} />
        <meshBasicMaterial color="#7fe3ff" transparent opacity={0.95} />
      </mesh>
      {/* pulsing halo ring */}
      <mesh ref={ring}>
        <sphereGeometry args={[0.09, 12, 12]} />
        <meshBasicMaterial color="#7fe3ff" transparent opacity={0.25} />
      </mesh>
      {/* generous invisible hit target — tiny visual dots are hard to tap on mobile */}
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          onTap();
        }}
      >
        <sphereGeometry args={[0.22, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <Html center distanceFactor={6} zIndexRange={[10, 0]}>
        <div className="hotspot-label">{label}</div>
      </Html>
    </group>
  );
}

type Mesh = import('three').Mesh;

export function Scene({
  device,
  level,
  onHotspot,
}: {
  device: DeviceDef;
  level: () => number;
  onHotspot: (id: string) => void;
}) {
  return (
    <Canvas
      dpr={[1, 2]} // pixel-ratio cap — biggest mobile GPU lever
      gl={{ antialias: false, powerPreference: 'high-performance' }}
      camera={{ position: [2.4, 1.4, 2.6], fov: 50 }}
    >
      <color attach="background" args={['#101020']} />
      <ambientLight intensity={1.1} />
      <hemisphereLight args={['#cfd8ff', '#20202e', 0.8]} />
      <directionalLight position={[3, 5, 4]} intensity={1.6} />
      <directionalLight position={[-4, 2, -3]} intensity={0.6} color="#bcd0ff" />
      <group position={[0, -0.2, 0]}>
        <DeviceModel id={device.id} level={level} />
        {device.hotspots.map((h) => (
          <Hotspot key={h.id} pos={h.pos} label={h.label} onTap={() => onHotspot(h.id)} />
        ))}
      </group>
      {/* free orbit camera per brief — rotate around the device */}
      <OrbitControls enablePan={false} minDistance={2} maxDistance={7} />
    </Canvas>
  );
}
