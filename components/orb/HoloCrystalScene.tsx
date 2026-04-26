"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";
import type { VoiceStatus } from "@/lib/voice/types";

interface HoloCrystalSceneProps {
  audioLevelRef: React.MutableRefObject<number>;
  status: VoiceStatus;
  personaColor?: string;
}

const CRYSTAL_TUBULAR_SEGMENTS = 320;
const CRYSTAL_RADIAL_SEGMENTS = 20;

// ────────────────────────────────────────────────────────────────────────────
// Holographic crystal: a TorusKnotGeometry traced in iridescent particles
// with a faint wireframe overlay. Slowly rotates + cursor parallax.
// ────────────────────────────────────────────────────────────────────────────

const POINT_VERT = /*glsl*/ `
uniform float uPixelRatio;
uniform float uSize;
uniform float uTime;
uniform float uAudioLevel;
attribute float aFlow; // position along the knot, 0..1
varying float vFlow;
varying vec3 vPosition;
void main() {
  // Pulse outward from origin gently with audio.
  vec3 p = position * (1.0 + uAudioLevel * 0.06);
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  // Per-vertex size flicker — like circuit-trace points blinking.
  float blink = 0.72 + 0.28 * sin(uTime * 2.5 + aFlow * 60.0);
  gl_PointSize = uSize * uPixelRatio * blink * (220.0 / -mvPosition.z);
  vFlow = aFlow;
  vPosition = p;
}
`;

const POINT_FRAG = /*glsl*/ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
uniform float uTime;
varying float vFlow;
varying vec3 vPosition;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  float core = smoothstep(0.5, 0.0, d);
  if (core < 0.01) discard;

  // Iridescent gradient — a traveling color band around the knot.
  float band = fract(vFlow * 3.0 - uTime * 0.15);
  vec3 col;
  if (band < 0.33) {
    col = mix(uColorA, uColorB, band * 3.0);
  } else if (band < 0.66) {
    col = mix(uColorB, uColorC, (band - 0.33) * 3.0);
  } else {
    col = mix(uColorC, uColorA, (band - 0.66) * 3.0);
  }

  float alpha = core * 0.46;
  gl_FragColor = vec4(col * (0.36 + core * 0.62), alpha);
}
`;

function statusPalette(accent: string, status: VoiceStatus) {
  if (status === "thinking") {
    return {
      a: "#a855f7",
      b: "#ec4899",
      c: "#22d3ee",
      wireOpacity: 0.18,
      rotateSpeed: 0.4,
    };
  }
  if (status === "speaking") {
    return {
      a: accent,
      b: "#ffffff",
      c: "#a855f7",
      wireOpacity: 0.25,
      rotateSpeed: 0.55,
    };
  }
  if (status === "error") {
    return {
      a: "#fb923c",
      b: "#ef4444",
      c: "#fde68a",
      wireOpacity: 0.18,
      rotateSpeed: 0.45,
    };
  }
  return {
    a: accent,
    b: "#67e8f9",
    c: "#a855f7",
    wireOpacity: 0.15,
    rotateSpeed: 0.25,
  };
}

function Crystal({
  audioLevelRef,
  status,
  accent,
}: {
  audioLevelRef: React.MutableRefObject<number>;
  status: VoiceStatus;
  accent: string;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const wireRef = useRef<THREE.LineSegments>(null);
  const wireMatRef = useRef<THREE.LineBasicMaterial>(null);
  const { gl } = useThree();
  const pixelRatio = Math.min(gl.getPixelRatio(), 2);
  const palette = statusPalette(accent, status);
  const baseRotation = useRef(new THREE.Vector2(0.35, -0.2));
  const targetScale = useRef(new THREE.Vector3(1, 1, 1));

  // Build TorusKnotGeometry, extract its vertices for our particle cloud.
  const built = useMemo(() => {
    // (radius, tube, tubularSegments, radialSegments, p, q)
    // Higher tubular = denser particle ring along the knot's length.
    const knot = new THREE.TorusKnotGeometry(
      1.0,
      0.3,
      CRYSTAL_TUBULAR_SEGMENTS,
      CRYSTAL_RADIAL_SEGMENTS,
      2,
      3
    );
    const positions = (knot.attributes.position as THREE.BufferAttribute).array
      .slice() as Float32Array;
    const count = positions.length / 3;
    // aFlow = how far along the knot this vertex sits (0..1 sweep).
    // Radial vertices vary fastest in TorusKnotGeometry's vertex order.
    const flow = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const tubularIndex = Math.floor(i / (CRYSTAL_RADIAL_SEGMENTS + 1));
      flow[i] = Math.min(1, tubularIndex / CRYSTAL_TUBULAR_SEGMENTS);
    }
    const pointGeom = new THREE.BufferGeometry();
    pointGeom.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3)
    );
    pointGeom.setAttribute("aFlow", new THREE.BufferAttribute(flow, 1));

    // Wireframe geometry from the same knot — thin lines tracing the
    // surface for that "holographic" lattice feel.
    const wireGeom = new THREE.WireframeGeometry(knot);

    return { pointGeom, wireGeom };
  }, []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const audio = audioLevelRef.current;

    if (matRef.current) {
      matRef.current.uniforms.uTime.value = t;
      matRef.current.uniforms.uAudioLevel.value = audio;
      matRef.current.uniforms.uColorA.value.set(palette.a);
      matRef.current.uniforms.uColorB.value.set(palette.b);
      matRef.current.uniforms.uColorC.value.set(palette.c);
    }

    if (wireMatRef.current) {
      wireMatRef.current.opacity = palette.wireOpacity;
      wireMatRef.current.color.set(palette.a);
    }

    const g = groupRef.current;
    if (g) {
      baseRotation.current.x += 0.003 * palette.rotateSpeed;
      baseRotation.current.y += 0.005 * palette.rotateSpeed;
      const targetX = baseRotation.current.x + state.pointer.y * -0.18;
      const targetY = baseRotation.current.y + state.pointer.x * 0.18;
      g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, targetX, 0.045);
      g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, targetY, 0.045);

      // Audio-reactive scale.
      const target = 1 + audio * 0.08 + Math.sin(t * 0.9) * 0.01;
      targetScale.current.setScalar(target);
      g.scale.lerp(targetScale.current, 0.1);
    }
  });

  return (
    <group ref={groupRef}>
      <mesh scale={1.05} renderOrder={-2}>
        <icosahedronGeometry args={[1.35, 2]} />
        <meshBasicMaterial
          color={palette.c}
          wireframe
          transparent
          opacity={palette.wireOpacity * 0.55}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh scale={0.82} renderOrder={-3}>
        <icosahedronGeometry args={[1.35, 1]} />
        <meshBasicMaterial
          color={palette.a}
          transparent
          opacity={0.02}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <lineSegments ref={wireRef} geometry={built.wireGeom}>
        <lineBasicMaterial
          ref={wireMatRef}
          color={palette.a}
          transparent
          opacity={palette.wireOpacity}
          depthWrite={false}
        />
      </lineSegments>
      <points ref={pointsRef} geometry={built.pointGeom}>
        <shaderMaterial
          ref={matRef}
          vertexShader={POINT_VERT}
          fragmentShader={POINT_FRAG}
          uniforms={{
            uColorA: { value: new THREE.Color(palette.a) },
            uColorB: { value: new THREE.Color(palette.b) },
            uColorC: { value: new THREE.Color(palette.c) },
            uPixelRatio: { value: pixelRatio },
            uSize: { value: 0.18 },
            uTime: { value: 0 },
            uAudioLevel: { value: 0 },
          }}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  );
}

export function HoloCrystalScene({
  audioLevelRef,
  status,
  personaColor,
}: HoloCrystalSceneProps) {
  const accent = personaColor ? `#${personaColor}` : "#22d3ee";
  return (
    <Canvas
      camera={{ position: [0, 0, 4.0], fov: 45 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: true }}
    >
      <Suspense fallback={null}>
        <Crystal
          audioLevelRef={audioLevelRef}
          status={status}
          accent={accent}
        />
      </Suspense>
    </Canvas>
  );
}
