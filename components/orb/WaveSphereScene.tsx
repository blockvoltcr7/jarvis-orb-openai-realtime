"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";
import type { VoiceStatus } from "@/lib/voice/types";

interface WaveSphereSceneProps {
  audioLevelRef: React.MutableRefObject<number>;
  status: VoiceStatus;
  personaColor?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Wave Sphere: each particle sits on a unit-sphere base position, then
// gets displaced radially by a sum of standing waves driven by audio
// and time. Cursor creates concentric ripples on the sphere surface.
// ────────────────────────────────────────────────────────────────────────────

const POINT_COUNT = 4500;
const BASE_RADIUS = 1.3;

const VERT = /*glsl*/ `
uniform float uTime;
uniform float uAudioLevel;
uniform vec3  uCursor;        // world-space cursor target on sphere
uniform float uPixelRatio;
uniform float uSize;
attribute float aBand;        // 0..1 latitude band identifier (drives freq)
attribute float aPhase;       // per-particle phase
varying float vDisplace;
varying float vBand;

void main() {
  vec3 base = position;          // unit-radius base direction
  vec3 dir  = normalize(base);

  // Three "harmonic" radial waves at different frequencies, each
  // weighted by audio level so silence = calm sphere, loud = lots of motion.
  float w1 = sin(uTime * 1.4 + aPhase * 6.28 + dir.y * 6.0);
  float w2 = sin(uTime * 2.2 + dir.x * 8.0);
  float w3 = sin(uTime * 3.5 + dir.z * 10.0 + aBand * 4.0);
  float harmonic = (w1 + w2 * 0.7 + w3 * 0.5) / 2.2;

  // Cursor ripple: distance on sphere surface to cursor → wave that
  // radiates outward from the cursor over time.
  float angDist = acos(clamp(dot(dir, normalize(uCursor + vec3(0.001))), -1.0, 1.0));
  float ripple = sin(angDist * 14.0 - uTime * 5.0) * exp(-angDist * 2.5);

  float displace = harmonic * (0.05 + uAudioLevel * 0.55) + ripple * 0.12;
  vec3 p = dir * (length(base) + displace);

  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = uSize * uPixelRatio * (220.0 / -mvPosition.z);

  vDisplace = displace;
  vBand = aBand;
}
`;

const FRAG = /*glsl*/ `
uniform vec3 uColorLow;
uniform vec3 uColorHigh;
uniform vec3 uColorPeak;
varying float vDisplace;
varying float vBand;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  float core = smoothstep(0.5, 0.0, d);
  if (core < 0.01) discard;

  // Color by displacement magnitude — peaks are brighter.
  float t = clamp(abs(vDisplace) * 2.5, 0.0, 1.0);
  vec3 col;
  if (t < 0.5) {
    col = mix(uColorLow, uColorHigh, t * 2.0);
  } else {
    col = mix(uColorHigh, uColorPeak, (t - 0.5) * 2.0);
  }
  // Slight tint per band so the sphere doesn't read as monochrome.
  col = mix(col, col * 1.3, vBand * 0.4);

  float alpha = core * (0.45 + t * 0.55);
  gl_FragColor = vec4(col, alpha);
}
`;

function statusPalette(accent: string, status: VoiceStatus) {
  if (status === "thinking") {
    return {
      low: "#312e81",
      high: "#a855f7",
      peak: "#f5d0fe",
    };
  }
  if (status === "speaking") {
    return {
      low: accent,
      high: "#ffffff",
      peak: "#fef3c7",
    };
  }
  if (status === "error") {
    return {
      low: "#7f1d1d",
      high: "#fb923c",
      peak: "#fef9c3",
    };
  }
  return {
    low: "#0e7490",
    high: accent,
    peak: "#ffffff",
  };
}

function WaveSphere({
  audioLevelRef,
  status,
  accent,
}: {
  audioLevelRef: React.MutableRefObject<number>;
  status: VoiceStatus;
  accent: string;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const { gl } = useThree();
  const pixelRatio = Math.min(gl.getPixelRatio(), 2);
  const palette = statusPalette(accent, status);

  const built = useMemo(() => {
    // Fibonacci sphere base positions for even coverage.
    const positions = new Float32Array(POINT_COUNT * 3);
    const bands = new Float32Array(POINT_COUNT);
    const phases = new Float32Array(POINT_COUNT);
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < POINT_COUNT; i++) {
      const y = 1 - (i / (POINT_COUNT - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const theta = goldenAngle * i;
      positions[i * 3 + 0] = Math.cos(theta) * r * BASE_RADIUS;
      positions[i * 3 + 1] = y * BASE_RADIUS;
      positions[i * 3 + 2] = Math.sin(theta) * r * BASE_RADIUS;
      bands[i] = (y + 1) * 0.5; // 0..1 latitude
      phases[i] = Math.random();
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geom.setAttribute("aBand", new THREE.BufferAttribute(bands, 1));
    geom.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    return { geom };
  }, []);

  const cursor = useMemo(() => new THREE.Vector3(0, 0, 1), []);

  useFrame((state) => {
    if (!matRef.current) return;
    const t = state.clock.elapsedTime;

    // Project pointer onto a sphere in front of camera (approx).
    cursor.set(state.pointer.x, state.pointer.y, 0.5).normalize();

    matRef.current.uniforms.uTime.value = t;
    matRef.current.uniforms.uAudioLevel.value = audioLevelRef.current;
    matRef.current.uniforms.uCursor.value.copy(cursor);
    matRef.current.uniforms.uColorLow.value.set(palette.low);
    matRef.current.uniforms.uColorHigh.value.set(palette.high);
    matRef.current.uniforms.uColorPeak.value.set(palette.peak);

    if (groupRef.current) {
      groupRef.current.rotation.y += 0.0012;
      groupRef.current.rotation.x = Math.sin(t * 0.3) * 0.06;
    }
  });

  return (
    <group ref={groupRef}>
      <points geometry={built.geom}>
        <shaderMaterial
          ref={matRef}
          vertexShader={VERT}
          fragmentShader={FRAG}
          uniforms={{
            uTime: { value: 0 },
            uAudioLevel: { value: 0 },
            uCursor: { value: cursor },
            uPixelRatio: { value: pixelRatio },
            uSize: { value: 0.45 },
            uColorLow: { value: new THREE.Color(palette.low) },
            uColorHigh: { value: new THREE.Color(palette.high) },
            uColorPeak: { value: new THREE.Color(palette.peak) },
          }}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  );
}

export function WaveSphereScene({
  audioLevelRef,
  status,
  personaColor,
}: WaveSphereSceneProps) {
  const accent = personaColor ? `#${personaColor}` : "#22d3ee";
  return (
    <Canvas
      camera={{ position: [0, 0, 4.0], fov: 45 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: true }}
    >
      <Suspense fallback={null}>
        <WaveSphere
          audioLevelRef={audioLevelRef}
          status={status}
          accent={accent}
        />
      </Suspense>
    </Canvas>
  );
}
