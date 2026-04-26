"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

export function HologramGlow({
  audioLevelRef,
}: {
  audioLevelRef: React.MutableRefObject<number>;
}) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    const m = ref.current;
    if (!m) return;
    const level = audioLevelRef.current;
    const t = state.clock.elapsedTime;
    const s = 1.4 + Math.sin(t * 1.5) * 0.05 + level * 0.4;
    m.scale.setScalar(s);
    (m.material as THREE.MeshBasicMaterial).opacity = 0.08 + level * 0.18;
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[1, 32, 32]} />
      <meshBasicMaterial
        color="#22d3ee"
        transparent
        opacity={0.12}
        side={THREE.BackSide}
        depthWrite={false}
      />
    </mesh>
  );
}
