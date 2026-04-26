"use client";

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { MeshDistortMaterial } from "@react-three/drei";
import * as THREE from "three";
import type { VoiceStatus } from "@/lib/voice/types";

interface AiOrbProps {
  audioLevelRef: React.MutableRefObject<number>;
  status: VoiceStatus;
  accent?: string;
}

function statusColors(accent: string): Record<VoiceStatus, [string, string]> {
  // Persona accent drives idle/listening/speaking; thinking/connecting/error
  // keep distinct semantic hues so the orb still communicates state clearly.
  const darken = darkenHex(accent, 0.7);
  const brighten = brightenHex(accent, 1.2);
  return {
    idle: [accent, darken],
    connecting: ["#a855f7", "#6366f1"],
    listening: [accent, darken],
    thinking: ["#a855f7", "#6366f1"],
    speaking: [brighten, accent],
    error: ["#f97316", "#dc2626"],
  };
}

function darkenHex(hex: string, factor: number): string {
  const c = hex.replace("#", "");
  const n = parseInt(c, 16);
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 0xff) * factor)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 0xff) * factor)));
  const b = Math.max(0, Math.min(255, Math.round((n & 0xff) * factor)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function brightenHex(hex: string, factor: number): string {
  return darkenHex(hex, factor);
}

export function AiOrb({ audioLevelRef, status, accent = "#22d3ee" }: AiOrbProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<any>(null);
  const innerRef = useRef<THREE.Mesh>(null);
  const colorTargets = useMemo(() => new THREE.Color(), []);
  const colorCurrent = useMemo(() => new THREE.Color("#22d3ee"), []);
  const emissiveCurrent = useMemo(() => new THREE.Color("#0ea5e9"), []);
  const emissiveTarget = useMemo(() => new THREE.Color(), []);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const level = audioLevelRef.current;
    const mesh = meshRef.current;
    const mat = matRef.current;
    const inner = innerRef.current;
    if (!mesh || !mat) return;

    // idle breathing + audio reactive scale
    const breathe = 1 + Math.sin(t * 1.2) * 0.025;
    const target = breathe + level * 0.35;
    mesh.scale.lerp(new THREE.Vector3(target, target, target), 0.15);
    mesh.rotation.y += delta * 0.15;
    mesh.rotation.x = Math.sin(t * 0.4) * 0.1;

    // distortion intensity follows status + level
    const baseDistort =
      status === "speaking" ? 0.55 : status === "listening" ? 0.35 : status === "thinking" ? 0.45 : 0.25;
    mat.distort = baseDistort + level * 0.4;
    mat.speed = status === "speaking" ? 4 : status === "thinking" ? 2.5 : 1.5;

    // color tween
    const [c1, c2] = statusColors(accent)[status];
    colorTargets.set(c1);
    emissiveTarget.set(c2);
    colorCurrent.lerp(colorTargets, 0.08);
    emissiveCurrent.lerp(emissiveTarget, 0.08);
    mat.color = colorCurrent;
    mat.emissive = emissiveCurrent;
    mat.emissiveIntensity = 0.6 + level * 1.2 + (status === "speaking" ? 0.5 : 0);

    if (inner) {
      inner.rotation.y -= delta * 0.4;
      inner.rotation.x += delta * 0.2;
      const s = 0.62 + level * 0.15;
      inner.scale.setScalar(s);
    }
  });

  return (
    <group>
      {/* outer glowing orb */}
      <mesh ref={meshRef}>
        <icosahedronGeometry args={[1, 32]} />
        <MeshDistortMaterial
          ref={matRef}
          color="#22d3ee"
          emissive="#0ea5e9"
          emissiveIntensity={0.8}
          roughness={0.15}
          metalness={0.4}
          distort={0.35}
          speed={2}
          transparent
          opacity={0.85}
        />
      </mesh>

      {/* inner core */}
      <mesh ref={innerRef}>
        <icosahedronGeometry args={[1, 8]} />
        <meshBasicMaterial color="#e0f7ff" transparent opacity={0.18} wireframe />
      </mesh>
    </group>
  );
}
