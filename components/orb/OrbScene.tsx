"use client";

import { Canvas } from "@react-three/fiber";
import { Suspense } from "react";
import { AiOrb } from "./AiOrb";
import { EnergyRings } from "./EnergyRings";
import { ParticleField } from "./ParticleField";
import { HologramGlow } from "./HologramGlow";
import type { VoiceStatus } from "@/lib/voice/types";

interface OrbSceneProps {
  audioLevelRef: React.MutableRefObject<number>;
  status: VoiceStatus;
  /** Hex color (no `#`) used as the persona accent for idle/listening tints. */
  personaColor?: string;
}

export function OrbScene({ audioLevelRef, status, personaColor }: OrbSceneProps) {
  const accent = personaColor ? `#${personaColor}` : "#22d3ee";
  return (
    <Canvas
      camera={{ position: [0, 0, 5], fov: 45 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: true }}
    >
      <ambientLight intensity={0.3} />
      <pointLight position={[4, 4, 4]} intensity={1.2} color={accent} />
      <pointLight position={[-4, -2, -3]} intensity={0.8} color="#a855f7" />
      <Suspense fallback={null}>
        <HologramGlow audioLevelRef={audioLevelRef} />
        <AiOrb audioLevelRef={audioLevelRef} status={status} accent={accent} />
        <EnergyRings audioLevelRef={audioLevelRef} status={status} />
        <ParticleField audioLevelRef={audioLevelRef} />
      </Suspense>
    </Canvas>
  );
}
