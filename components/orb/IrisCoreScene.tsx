"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";
import type { VoiceStatus } from "@/lib/voice/types";

interface IrisCoreSceneProps {
  audioLevelRef: React.MutableRefObject<number>;
  status: VoiceStatus;
  personaColor?: string;
}

const IRIS_VERT = /*glsl*/ `
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const IRIS_FRAG = /*glsl*/ `
uniform vec3 uAccent;
uniform vec3 uSecondary;
uniform vec3 uHot;
uniform float uAudioLevel;
uniform float uTime;
uniform float uStateBoost;
varying vec2 vUv;

float ring(float r, float radius, float width) {
  return 1.0 - smoothstep(width, width * 1.9, abs(r - radius));
}

void main() {
  vec2 p = vUv;
  float r = length(p);
  if (r > 1.0) discard;

  float a = atan(p.y, p.x);
  float audio = clamp(uAudioLevel, 0.0, 1.0);
  float pupil = 0.22 + audio * 0.055 - uStateBoost * 0.015;

  float blades = abs(sin(a * 6.0 + uTime * 0.34));
  float aperture = smoothstep(pupil, pupil + 0.045, r) *
    (0.55 + 0.45 * smoothstep(0.14, 1.0, blades));

  float ribs = pow(abs(sin(a * 48.0 + uTime * 0.8 + r * 4.0)), 16.0);
  float fineRibs = pow(abs(sin(a * 96.0 - uTime * 0.45)), 26.0);
  float rings =
    ring(r, 0.36 + audio * 0.035, 0.012) +
    ring(r, 0.55, 0.01) * 0.7 +
    ring(r, 0.76 - audio * 0.025, 0.012) * 0.75 +
    ring(r, 0.91, 0.018) * 0.9;

  float scan = exp(-48.0 * pow(fract(a / 6.2831853 + uTime * 0.075) - 0.5, 2.0));
  float innerShadow = smoothstep(pupil + 0.09, pupil, r);
  float rim = smoothstep(0.62, 0.98, r);
  float lens = 0.08 + aperture * (0.28 + ribs * 0.26 + fineRibs * 0.12);

  vec3 color = mix(uSecondary * 0.42, uAccent, smoothstep(0.18, 0.92, r));
  color = mix(color, uHot, clamp(rings + scan * 0.42 + audio * 0.25, 0.0, 1.0));
  color += uAccent * ribs * 0.26;
  color += uHot * rings * 0.45;
  color *= 1.0 - innerShadow * 0.84;
  color += uSecondary * pow(1.0 - r, 3.0) * 0.24;

  float alpha = smoothstep(1.0, 0.82, r) * (0.42 + lens + rim * 0.22);
  alpha = max(alpha, rings * 0.42);

  gl_FragColor = vec4(color, alpha);
}
`;

function statusPalette(accent: string, status: VoiceStatus) {
  if (status === "thinking") {
    return {
      accent: "#a855f7",
      secondary: "#22d3ee",
      hot: "#f5d0fe",
      speed: 1.15,
      boost: 0.18,
    };
  }
  if (status === "speaking") {
    return {
      accent,
      secondary: "#67e8f9",
      hot: "#ffffff",
      speed: 1.45,
      boost: 0.28,
    };
  }
  if (status === "error") {
    return {
      accent: "#ef4444",
      secondary: "#fb923c",
      hot: "#fed7aa",
      speed: 1.25,
      boost: 0.22,
    };
  }
  return {
    accent,
    secondary: "#6366f1",
    hot: "#e0f7ff",
    speed: status === "listening" ? 0.95 : 0.72,
    boost: status === "listening" ? 0.12 : 0.06,
  };
}

function IrisCore({
  audioLevelRef,
  status,
  accent,
}: {
  audioLevelRef: React.MutableRefObject<number>;
  status: VoiceStatus;
  accent: string;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const irisMatRef = useRef<THREE.ShaderMaterial>(null);
  const ringMatsRef = useRef<THREE.MeshBasicMaterial[]>([]);
  const fiberMatRef = useRef<THREE.LineBasicMaterial>(null);
  const targetScale = useRef(new THREE.Vector3(1, 1, 1));
  const { gl } = useThree();
  const palette = statusPalette(accent, status);

  const fibers = useMemo(() => {
    const count = 96;
    const positions = new Float32Array(count * 2 * 3);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const jitter = (i % 3) * 0.018;
      const inner = 0.38 + jitter;
      const outer = 0.88 - jitter * 0.7;
      const base = i * 6;
      positions[base + 0] = Math.cos(a) * inner;
      positions[base + 1] = Math.sin(a) * inner;
      positions[base + 2] = -0.01;
      positions[base + 3] = Math.cos(a) * outer;
      positions[base + 4] = Math.sin(a) * outer;
      positions[base + 5] = -0.01;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geom;
  }, []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const audio = audioLevelRef.current;
    const g = groupRef.current;

    if (irisMatRef.current) {
      irisMatRef.current.uniforms.uTime.value = t * palette.speed;
      irisMatRef.current.uniforms.uAudioLevel.value = audio;
      irisMatRef.current.uniforms.uStateBoost.value = palette.boost;
      irisMatRef.current.uniforms.uAccent.value.set(palette.accent);
      irisMatRef.current.uniforms.uSecondary.value.set(palette.secondary);
      irisMatRef.current.uniforms.uHot.value.set(palette.hot);
    }

    if (g) {
      targetScale.current.setScalar(1 + Math.sin(t * 1.2) * 0.012 + audio * 0.07);
      g.scale.lerp(targetScale.current, 0.12);
      g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, state.pointer.y * -0.12, 0.05);
      g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, state.pointer.x * 0.12, 0.05);
      g.rotation.z += 0.0018 * palette.speed;
    }

    ringMatsRef.current.forEach((mat, index) => {
      mat.color.set(index === 1 ? palette.hot : palette.accent);
      mat.opacity = (index === 1 ? 0.25 : 0.14) + audio * 0.08;
    });
    if (fiberMatRef.current) {
      fiberMatRef.current.color.set(palette.secondary);
      fiberMatRef.current.opacity = 0.12 + audio * 0.12;
    }
  });

  return (
    <group ref={groupRef}>
      <mesh renderOrder={-2}>
        <sphereGeometry args={[1.22, 48, 48]} />
        <meshBasicMaterial
          color={palette.accent}
          transparent
          opacity={0.035}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.BackSide}
        />
      </mesh>

      <mesh>
        <planeGeometry args={[2.55, 2.55, 1, 1]} />
        <shaderMaterial
          ref={irisMatRef}
          vertexShader={IRIS_VERT}
          fragmentShader={IRIS_FRAG}
          uniforms={{
            uAccent: { value: new THREE.Color(palette.accent) },
            uSecondary: { value: new THREE.Color(palette.secondary) },
            uHot: { value: new THREE.Color(palette.hot) },
            uAudioLevel: { value: 0 },
            uTime: { value: 0 },
            uStateBoost: { value: palette.boost },
          }}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      <lineSegments geometry={fibers}>
        <lineBasicMaterial
          ref={fiberMatRef}
          color={palette.secondary}
          transparent
          opacity={0.12}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>

      {[0.76, 1.02, 1.22].map((radius, index) => (
        <mesh key={radius} rotation={[0, 0, index * 0.42]}>
          <torusGeometry args={[radius, index === 1 ? 0.008 : 0.005, 8, 192]} />
          <meshBasicMaterial
            ref={(mat) => {
              if (mat) ringMatsRef.current[index] = mat;
            }}
            color={index === 1 ? palette.hot : palette.accent}
            transparent
            opacity={index === 1 ? 0.25 : 0.14}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}

      <mesh position={[0.22, 0.28, 0.03]}>
        <circleGeometry args={[0.055, 32]} />
        <meshBasicMaterial
          color="#f8feff"
          transparent
          opacity={0.68}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

export function IrisCoreScene({
  audioLevelRef,
  status,
  personaColor,
}: IrisCoreSceneProps) {
  const accent = personaColor ? `#${personaColor}` : "#22d3ee";

  return (
    <Canvas
      camera={{ position: [0, 0, 4.0], fov: 45 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
    >
      <Suspense fallback={null}>
        <IrisCore audioLevelRef={audioLevelRef} status={status} accent={accent} />
      </Suspense>
    </Canvas>
  );
}
