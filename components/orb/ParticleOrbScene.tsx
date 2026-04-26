"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense, useRef } from "react";
import * as THREE from "three";
import { FlowFieldParticles as FlowFieldParticlesUntyped } from "./FlowFieldParticles";

// FlowFieldParticles is a vendored .tsx file with @ts-nocheck — its prop
// types get inferred from default values (e.g. `colors = null`). Cast to
// `any` so consumers can pass real values without fighting the inferred type.
const FlowFieldParticles = FlowFieldParticlesUntyped as unknown as React.FC<{
  shape?: "disc" | "ring" | "sphere" | "square";
  size?: number;
  colors?: [string, string];
  disturbIntensity?: number;
  repulsionForce?: number;
  interactive?: boolean;
  children: React.ReactNode;
}>;
import type { VoiceStatus } from "@/lib/voice/types";

interface ParticleOrbSceneProps {
  audioLevelRef: React.MutableRefObject<number>;
  status: VoiceStatus;
  /** Hex color (no `#`) used as the persona accent. */
  personaColor?: string;
}

// Drives orb breathing + audio-reactive scale. Lives inside Canvas so it can
// useFrame. Pulses the parent <group>, leaving particles' relative positions
// intact (the GPGPU sim handles all per-particle motion).
function OrbAnimator({
  audioLevelRef,
  status,
  groupRef,
}: {
  audioLevelRef: React.MutableRefObject<number>;
  status: VoiceStatus;
  groupRef: React.MutableRefObject<THREE.Group | null>;
}) {
  useFrame((state) => {
    const g = groupRef.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    const level = audioLevelRef.current;

    const breathe = 1 + Math.sin(t * 1.2) * 0.03;
    const speakingBoost = status === "speaking" ? 0.15 : 0;
    const target = breathe + level * 0.35 + speakingBoost;
    g.scale.lerp(new THREE.Vector3(target, target, target), 0.15);

    // Slow ambient rotation so the particle sphere has life when idle.
    g.rotation.y += 0.0015;
    g.rotation.x = Math.sin(t * 0.3) * 0.08;
  });
  return null;
}

function statusColors(
  accent: string,
  status: VoiceStatus
): [string, string] {
  // 2-color gradient mixed across the sphere. Both ends kept BRIGHT so
  // the orb pops against the near-black page background.
  const palette: Record<VoiceStatus, [string, string]> = {
    idle: [accent, "#7c3aed"],
    connecting: ["#a855f7", "#6366f1"],
    listening: [accent, "#8b5cf6"],
    thinking: ["#c084fc", "#6366f1"],
    speaking: [accent, "#f0abfc"],
    error: ["#fb923c", "#ef4444"],
  };
  return palette[status];
}

export function ParticleOrbScene({
  audioLevelRef,
  status,
  personaColor,
}: ParticleOrbSceneProps) {
  const accent = personaColor ? `#${personaColor}` : "#22d3ee";
  const groupRef = useRef<THREE.Group | null>(null);
  const colors = statusColors(accent, status);

  // Status drives flow-field intensity: more chaos when speaking/thinking.
  const disturbIntensity =
    status === "speaking" ? 0.55 : status === "thinking" ? 0.45 : 0.25;

  return (
    <Canvas
      camera={{ position: [0, 0, 3.5], fov: 45 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: true }}
    >
      <ambientLight intensity={0.4} />
      <pointLight position={[4, 4, 4]} intensity={1.2} color={accent} />
      <pointLight position={[-4, -2, -3]} intensity={0.6} color="#a855f7" />

      <Suspense fallback={null}>
        <group ref={groupRef}>
          <FlowFieldParticles
            shape="sphere"
            size={0.6}
            colors={colors}
            disturbIntensity={disturbIntensity}
            repulsionForce={1.0}
            interactive
          >
            {/* Child mesh defines the orb shape — every vertex becomes a
                particle. Higher subdivisions = denser cloud. 64x64 ≈ 4225 pts. */}
            <mesh>
              <sphereGeometry args={[1.2, 64, 64]} />
              <meshStandardMaterial color={accent} />
            </mesh>
          </FlowFieldParticles>
        </group>

        <OrbAnimator
          audioLevelRef={audioLevelRef}
          status={status}
          groupRef={groupRef}
        />
      </Suspense>
    </Canvas>
  );
}
