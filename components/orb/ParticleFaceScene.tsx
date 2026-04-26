"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";
import { FlowFieldParticles as FlowFieldParticlesUntyped } from "./FlowFieldParticles";
import type { VoiceStatus } from "@/lib/voice/types";

const FlowFieldParticles = FlowFieldParticlesUntyped as unknown as React.FC<{
  shape?: "disc" | "ring" | "sphere" | "square";
  size?: number;
  colors?: [string, string];
  disturbIntensity?: number;
  repulsionForce?: number;
  interactive?: boolean;
  children: React.ReactNode;
}>;

interface ParticleFaceSceneProps {
  audioLevelRef: React.MutableRefObject<number>;
  status: VoiceStatus;
  /** Hex color (no `#`) used as the persona accent. */
  personaColor?: string;
}

// Pre-prep the head geometry once: center it on the origin and normalize
// scale so the FlowFieldParticles GPGPU sim has a clean coordinate space.
// Returned geometry is reused across mounts via useGLTF's internal cache.
function useHeadGeometry(): THREE.BufferGeometry | null {
  const gltf = useGLTF("/models/LeePerrySmith.glb") as any;

  return useMemo(() => {
    // Pick the LARGEST mesh — LeePerrySmith GLB has the head as the
    // dominant mesh with eyeball/teeth submeshes that we want to skip.
    // Picking by max vertex count avoids the "glowing eye orb" artifact.
    let bestMesh: THREE.Mesh | null = null;
    let bestCount = 0;
    gltf.scene.traverse((obj: THREE.Object3D) => {
      const m = obj as THREE.Mesh;
      if (m.isMesh && m.geometry?.attributes?.position) {
        const c = m.geometry.attributes.position.count;
        if (c > bestCount) {
          bestCount = c;
          bestMesh = m;
        }
      }
    });
    if (!bestMesh) return null;

    const sourceGeom = (bestMesh as THREE.Mesh).geometry.clone();

    // Center on origin BEFORE filtering so y-thresholds are intuitive.
    sourceGeom.computeBoundingBox();
    const bbox = sourceGeom.boundingBox!;
    const center = new THREE.Vector3();
    bbox.getCenter(center);
    sourceGeom.translate(-center.x, -center.y, -center.z);

    const size = new THREE.Vector3();
    bbox.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = 2.0 / maxDim;
    sourceGeom.scale(scale, scale, scale);

    // Filter: keep only vertices ABOVE the neckline so the bust doesn't
    // create a messy splatted base. After centering+scaling, neck is
    // roughly at y = -0.35. Drop everything below so the scene reads as
    // a head/face instead of a bust with shoulder artifacts.
    const NECK_Y = -0.35;
    const srcPos = sourceGeom.attributes.position.array as Float32Array;
    const srcNormal = sourceGeom.attributes.normal?.array as
      | Float32Array
      | undefined;
    const srcUv = sourceGeom.attributes.uv?.array as Float32Array | undefined;

    const keptPositions: number[] = [];
    const keptNormals: number[] = [];
    const keptUvs: number[] = [];

    for (let i = 0; i < srcPos.length / 3; i++) {
      const x = srcPos[i * 3 + 0];
      const y = srcPos[i * 3 + 1];
      const z = srcPos[i * 3 + 2];
      if (y < NECK_Y) continue;
      keptPositions.push(x, y, z);
      if (srcNormal) {
        keptNormals.push(
          srcNormal[i * 3 + 0],
          srcNormal[i * 3 + 1],
          srcNormal[i * 3 + 2]
        );
      }
      if (srcUv) {
        keptUvs.push(srcUv[i * 2 + 0], srcUv[i * 2 + 1]);
      }
    }

    const filtered = new THREE.BufferGeometry();
    filtered.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(keptPositions), 3)
    );
    if (keptNormals.length) {
      filtered.setAttribute(
        "normal",
        new THREE.BufferAttribute(new Float32Array(keptNormals), 3)
      );
    }
    if (keptUvs.length) {
      filtered.setAttribute(
        "uv",
        new THREE.BufferAttribute(new Float32Array(keptUvs), 2)
      );
    }

    // Lift slightly so the head sits visually centered after neck trim.
    filtered.translate(0, 0.08, 0);

    return filtered;
  }, [gltf]);
}

// Drives breathing, audio reactivity, and a subtle parallax tilt that
// follows the cursor — so the face appears to look at the user. R3F
// exposes the normalized pointer (-1..1) on every frame via state.pointer.
function HeadAnimator({
  audioLevelRef,
  status,
  groupRef,
}: {
  audioLevelRef: React.MutableRefObject<number>;
  status: VoiceStatus;
  groupRef: React.MutableRefObject<THREE.Group | null>;
}) {
  const targetRotation = useRef(new THREE.Vector2(0, 0));
  const targetScale = useRef(new THREE.Vector3(1, 1, 1));

  useFrame((state) => {
    const g = groupRef.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    const level = audioLevelRef.current;
    const pointer = state.pointer; // -1..1 normalized

    // Cursor-tracking parallax — head looks toward mouse with damping.
    targetRotation.current.x = THREE.MathUtils.lerp(
      targetRotation.current.x,
      pointer.y * 0.25,
      0.06
    );
    targetRotation.current.y = THREE.MathUtils.lerp(
      targetRotation.current.y,
      pointer.x * 0.4,
      0.06
    );

    g.rotation.x = -targetRotation.current.x + Math.sin(t * 0.5) * 0.02;
    g.rotation.y = targetRotation.current.y;

    // Breathing + audio-reactive scale (gentle, no rubber-band).
    const breathe = 1 + Math.sin(t * 1.1) * 0.015;
    const speakingBoost = status === "speaking" ? 0.08 : 0;
    const target = breathe + level * 0.18 + speakingBoost;
    targetScale.current.setScalar(target);
    g.scale.lerp(targetScale.current, 0.12);
  });
  return null;
}

function FaceAnchorCloud({
  audioLevelRef,
  geometry,
  accent,
  status,
}: {
  audioLevelRef: React.MutableRefObject<number>;
  geometry: THREE.BufferGeometry;
  accent: string;
  status: VoiceStatus;
}) {
  const matRef = useRef<THREE.PointsMaterial>(null);

  useFrame(() => {
    const mat = matRef.current;
    if (!mat) return;
    const level = audioLevelRef.current;
    mat.size =
      status === "speaking" ? 0.015 + level * 0.018 : 0.011 + level * 0.01;
    mat.opacity =
      status === "thinking" ? 0.24 : status === "speaking" ? 0.3 : 0.17;
  });

  return (
    <points geometry={geometry} renderOrder={-1}>
      <pointsMaterial
        ref={matRef}
        size={0.011}
        sizeAttenuation
        color={accent}
        transparent
        opacity={0.17}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

function FaceHalo({ accent }: { accent: string }) {
  return (
    <mesh scale={[1.2, 1.35, 0.95]} renderOrder={-2}>
      <sphereGeometry args={[1, 48, 48]} />
      <meshBasicMaterial
        color={accent}
        transparent
        opacity={0.035}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        side={THREE.BackSide}
      />
    </mesh>
  );
}

function statusColors(
  accent: string,
  status: VoiceStatus
): [string, string] {
  // Brighter colors on top of the head, deeper accent at the jaw —
  // creates a "lit from above" volumetric feel without real lighting.
  const palette: Record<VoiceStatus, [string, string]> = {
    idle: ["#e0f7ff", accent],
    connecting: ["#f5d0fe", "#a855f7"],
    listening: ["#e0f7ff", accent],
    thinking: ["#f0abfc", "#7c3aed"],
    speaking: ["#ffffff", accent],
    error: ["#fed7aa", "#dc2626"],
  };
  return palette[status];
}

function HeadParticles({
  audioLevelRef,
  status,
  accent,
  groupRef,
}: {
  audioLevelRef: React.MutableRefObject<number>;
  status: VoiceStatus;
  accent: string;
  groupRef: React.MutableRefObject<THREE.Group | null>;
}) {
  const geometry = useHeadGeometry();
  const colors = statusColors(accent, status);

  // Idle MUST stay crisp so the face is readable. Only ramp chaos when
  // the assistant is actively speaking or thinking.
  const disturbIntensity =
    status === "speaking" ? 0.35 : status === "thinking" ? 0.25 : 0.04;

  if (!geometry) return null;

  return (
    <>
      <group ref={groupRef}>
        <FaceHalo accent={accent} />
        <FaceAnchorCloud
          audioLevelRef={audioLevelRef}
          geometry={geometry}
          accent={accent}
          status={status}
        />
        <FlowFieldParticles
          shape="disc"
          size={0.28}
          colors={colors}
          disturbIntensity={disturbIntensity}
          repulsionForce={0.65}
          interactive
        >
          {/* The mesh is invisible (childMeshVisible defaults to false in
              the upstream component). Its geometry's vertex positions
              become particle seed positions in the GPGPU sim. */}
          <mesh>
            <primitive object={geometry} attach="geometry" />
            <meshStandardMaterial color={accent} />
          </mesh>
        </FlowFieldParticles>
      </group>

      <HeadAnimator
        audioLevelRef={audioLevelRef}
        status={status}
        groupRef={groupRef}
      />
    </>
  );
}

// Loading fallback — a faint pulsing dot so the canvas isn't empty
// during the GLB fetch (only shown for ~100-300ms after first load).
function LoadingPulse({ accent }: { accent: string }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!ref.current) return;
    const s = 0.3 + Math.sin(state.clock.elapsedTime * 3) * 0.1;
    ref.current.scale.setScalar(s);
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.5, 16, 16]} />
      <meshBasicMaterial color={accent} transparent opacity={0.4} />
    </mesh>
  );
}

export function ParticleFaceScene({
  audioLevelRef,
  status,
  personaColor,
}: ParticleFaceSceneProps) {
  const accent = personaColor ? `#${personaColor}` : "#22d3ee";
  const groupRef = useRef<THREE.Group | null>(null);

  return (
    <Canvas
      camera={{ position: [0, 0, 3.2], fov: 45 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: true }}
    >
      <ambientLight intensity={0.5} />
      <pointLight position={[3, 3, 3]} intensity={1.2} color={accent} />
      <pointLight position={[-3, -2, -3]} intensity={0.7} color="#a855f7" />

      <Suspense fallback={<LoadingPulse accent={accent} />}>
        <HeadParticles
          audioLevelRef={audioLevelRef}
          status={status}
          accent={accent}
          groupRef={groupRef}
        />
      </Suspense>
    </Canvas>
  );
}

// Pre-warm the GLTF cache so first toggle to "Face" mode is instant.
useGLTF.preload("/models/LeePerrySmith.glb");
