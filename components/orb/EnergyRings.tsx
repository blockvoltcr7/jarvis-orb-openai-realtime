"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { VoiceStatus } from "@/lib/voice/types";

interface EnergyRingsProps {
  audioLevelRef: React.MutableRefObject<number>;
  status: VoiceStatus;
}

export function EnergyRings({ audioLevelRef, status }: EnergyRingsProps) {
  const a = useRef<THREE.Mesh>(null);
  const b = useRef<THREE.Mesh>(null);
  const c = useRef<THREE.Mesh>(null);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const level = audioLevelRef.current;
    const speed = status === "speaking" ? 1.6 : status === "listening" ? 1.0 : 0.5;
    const op = status === "idle" ? 0.18 : 0.32 + level * 0.4;

    if (a.current) {
      a.current.rotation.x = t * 0.2 * speed;
      a.current.rotation.y = t * 0.3 * speed;
      (a.current.material as THREE.MeshBasicMaterial).opacity = op;
    }
    if (b.current) {
      b.current.rotation.x = -t * 0.25 * speed;
      b.current.rotation.z = t * 0.35 * speed;
      (b.current.material as THREE.MeshBasicMaterial).opacity = op * 0.85;
    }
    if (c.current) {
      c.current.rotation.y = -t * 0.18 * speed;
      c.current.rotation.z = -t * 0.22 * speed;
      (c.current.material as THREE.MeshBasicMaterial).opacity = op * 0.65;
    }
  });

  return (
    <group>
      <mesh ref={a}>
        <torusGeometry args={[1.55, 0.012, 16, 128]} />
        <meshBasicMaterial color="#22d3ee" transparent opacity={0.3} />
      </mesh>
      <mesh ref={b} rotation={[Math.PI / 3, 0, 0]}>
        <torusGeometry args={[1.75, 0.008, 16, 128]} />
        <meshBasicMaterial color="#67e8f9" transparent opacity={0.2} />
      </mesh>
      <mesh ref={c} rotation={[0, 0, Math.PI / 4]}>
        <torusGeometry args={[1.95, 0.006, 16, 128]} />
        <meshBasicMaterial color="#a855f7" transparent opacity={0.15} />
      </mesh>
    </group>
  );
}
