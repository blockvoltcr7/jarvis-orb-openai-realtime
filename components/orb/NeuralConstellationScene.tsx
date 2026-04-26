"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";
import type { VoiceStatus } from "@/lib/voice/types";

interface NeuralConstellationSceneProps {
  audioLevelRef: React.MutableRefObject<number>;
  status: VoiceStatus;
  personaColor?: string;
}

const NODE_COUNT = 120;
// Maximum euclidean distance between two nodes for them to be connected.
// In a unit sphere with 120 fib-spaced nodes, ~0.55 yields ~6-10 connections
// per node, total ~500-700 lines — readable, not a hairball.
const CONNECTION_THRESHOLD = 0.55;

// ────────────────────────────────────────────────────────────────────────────
// Geometry generation
// ────────────────────────────────────────────────────────────────────────────

// Fibonacci sphere: places N points on a unit sphere with near-uniform
// spacing using the golden-angle spiral. Best-known algorithm for "evenly
// distributed points on a sphere" without clustering at poles.
function fibonacciSphere(n: number, radius = 1): Float32Array {
  const out = new Float32Array(n * 3);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2; // -1..1
    const r = Math.sqrt(1 - y * y);
    const theta = goldenAngle * i;
    out[i * 3 + 0] = Math.cos(theta) * r * radius;
    out[i * 3 + 1] = y * radius;
    out[i * 3 + 2] = Math.sin(theta) * r * radius;
  }
  return out;
}

// Returns flat array of [aIdx, bIdx, ...] node-pair indices for every pair
// within CONNECTION_THRESHOLD distance. Computed ONCE at init — the
// connection topology stays stable, only endpoint positions move per frame.
function computeConnections(
  basePositions: Float32Array,
  threshold: number
): Uint16Array {
  const pairs: number[] = [];
  const n = basePositions.length / 3;
  const t2 = threshold * threshold;
  for (let i = 0; i < n; i++) {
    const ax = basePositions[i * 3];
    const ay = basePositions[i * 3 + 1];
    const az = basePositions[i * 3 + 2];
    for (let j = i + 1; j < n; j++) {
      const dx = basePositions[j * 3] - ax;
      const dy = basePositions[j * 3 + 1] - ay;
      const dz = basePositions[j * 3 + 2] - az;
      if (dx * dx + dy * dy + dz * dz < t2) {
        pairs.push(i, j);
      }
    }
  }
  return new Uint16Array(pairs);
}

// ────────────────────────────────────────────────────────────────────────────
// Shaders
// ────────────────────────────────────────────────────────────────────────────

const NODE_VERT = /*glsl*/ `
uniform float uSize;
uniform float uPixelRatio;
attribute float aPhase;
varying float vPhase;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  // Per-node size variation via aPhase for visual richness.
  float s = uSize * (0.7 + 0.6 * fract(aPhase));
  gl_PointSize = s * uPixelRatio * (300.0 / -mvPosition.z);
  vPhase = aPhase;
}
`;

const NODE_FRAG = /*glsl*/ `
uniform vec3 uColor;
uniform vec3 uColorBright;
uniform float uTime;
varying float vPhase;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  // Soft glow: bright core, falls off to transparent edge.
  float core = smoothstep(0.5, 0.0, d);
  float halo = smoothstep(0.5, 0.15, d) * 0.3;
  float alpha = core + halo;
  if (alpha < 0.01) discard;
  // Per-node twinkle.
  float twinkle = 0.7 + 0.3 * sin(uTime * 2.0 + vPhase * 6.28);
  vec3 color = mix(uColor, uColorBright, core) * twinkle;
  gl_FragColor = vec4(color, alpha);
}
`;

const LINE_VERT = /*glsl*/ `
attribute float aLineT;        // 0..1 along each segment
attribute float aLineSeed;     // per-line random for offset/intensity
varying float vLineT;
varying float vLineSeed;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vLineT = aLineT;
  vLineSeed = aLineSeed;
}
`;

const LINE_FRAG = /*glsl*/ `
uniform vec3 uColor;
uniform float uTime;
uniform float uPulseSpeed;
varying float vLineT;
varying float vLineSeed;
void main() {
  // Base "wire" intensity — faint baseline so lines are visible always.
  float base = 0.18;

  // Traveling pulse along each line. Each line gets a random phase
  // (vLineSeed) so pulses don't all fire in unison — looks organic.
  float wave = vLineT - mod(uTime * uPulseSpeed + vLineSeed, 1.5) + 0.25;
  float pulse = exp(-30.0 * wave * wave); // sharp gaussian peak

  // Secondary slower wave so lines never feel completely dead.
  float ambient = 0.15 * (0.5 + 0.5 * sin(uTime * 0.6 + vLineSeed * 6.28));

  float alpha = base + pulse * 0.95 + ambient;
  vec3 color = uColor * (0.5 + pulse * 1.5);
  gl_FragColor = vec4(color, alpha);
}
`;

// ────────────────────────────────────────────────────────────────────────────
// Status → color mapping
// ────────────────────────────────────────────────────────────────────────────

function statusPalette(
  accent: string,
  status: VoiceStatus
): { node: string; nodeBright: string; line: string; pulseSpeed: number } {
  // Pulse speed in "cycles per second" — speaking/thinking = faster signal flow.
  const speed = {
    idle: 0.35,
    listening: 0.45,
    connecting: 0.5,
    thinking: 0.85,
    speaking: 1.1,
    error: 0.6,
  }[status];

  if (status === "thinking") {
    return {
      node: "#c084fc",
      nodeBright: "#ffffff",
      line: "#a855f7",
      pulseSpeed: speed,
    };
  }
  if (status === "error") {
    return {
      node: "#fb923c",
      nodeBright: "#fed7aa",
      line: "#dc2626",
      pulseSpeed: speed,
    };
  }
  return {
    node: accent,
    nodeBright: "#ffffff",
    line: accent,
    pulseSpeed: speed,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// The main scene
// ────────────────────────────────────────────────────────────────────────────

function Constellation({
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
  const linesRef = useRef<THREE.LineSegments>(null);
  const { gl } = useThree();
  const pixelRatio = Math.min(gl.getPixelRatio(), 2);

  // ── Init: positions, connections, geometries, materials ─────────────
  const built = useMemo(() => {
    const basePositions = fibonacciSphere(NODE_COUNT, 1.4);
    const pairs = computeConnections(basePositions, CONNECTION_THRESHOLD);
    const linkCount = pairs.length / 2;

    // Per-node random phase so animation doesn't sync.
    const phases = new Float32Array(NODE_COUNT);
    for (let i = 0; i < NODE_COUNT; i++) phases[i] = Math.random();

    // Live positions buffer — mutated each frame, fed to GPU.
    const livePositions = new Float32Array(basePositions);

    // Node geometry
    const nodeGeom = new THREE.BufferGeometry();
    nodeGeom.setAttribute(
      "position",
      new THREE.BufferAttribute(livePositions, 3).setUsage(
        THREE.DynamicDrawUsage
      )
    );
    nodeGeom.setAttribute(
      "aPhase",
      new THREE.BufferAttribute(phases, 1)
    );

    // Line geometry — 2 vertices per link, positions written each frame
    // by sampling the corresponding node positions.
    const lineVertCount = linkCount * 2;
    const linePositions = new Float32Array(lineVertCount * 3);
    const lineT = new Float32Array(lineVertCount);
    const lineSeed = new Float32Array(lineVertCount);
    for (let i = 0; i < linkCount; i++) {
      lineT[i * 2 + 0] = 0;
      lineT[i * 2 + 1] = 1;
      const seed = Math.random();
      lineSeed[i * 2 + 0] = seed;
      lineSeed[i * 2 + 1] = seed;
    }
    const lineGeom = new THREE.BufferGeometry();
    lineGeom.setAttribute(
      "position",
      new THREE.BufferAttribute(linePositions, 3).setUsage(
        THREE.DynamicDrawUsage
      )
    );
    lineGeom.setAttribute("aLineT", new THREE.BufferAttribute(lineT, 1));
    lineGeom.setAttribute("aLineSeed", new THREE.BufferAttribute(lineSeed, 1));

    return {
      basePositions,
      livePositions,
      pairs,
      phases,
      nodeGeom,
      lineGeom,
      linePositions,
    };
  }, []);

  // ── Materials ───────────────────────────────────────────────────────
  const palette = statusPalette(accent, status);
  const nodeMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: NODE_VERT,
        fragmentShader: NODE_FRAG,
        uniforms: {
          uColor: { value: new THREE.Color(palette.node) },
          uColorBright: { value: new THREE.Color(palette.nodeBright) },
          uSize: { value: 0.07 },
          uPixelRatio: { value: pixelRatio },
          uTime: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    []
  );

  const lineMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: LINE_VERT,
        fragmentShader: LINE_FRAG,
        uniforms: {
          uColor: { value: new THREE.Color(palette.line) },
          uTime: { value: 0 },
          uPulseSpeed: { value: palette.pulseSpeed },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    []
  );

  // Update colors + pulse speed when status changes (no full rebuild).
  useMemo(() => {
    nodeMat.uniforms.uColor.value.set(palette.node);
    nodeMat.uniforms.uColorBright.value.set(palette.nodeBright);
    lineMat.uniforms.uColor.value.set(palette.line);
    lineMat.uniforms.uPulseSpeed.value = palette.pulseSpeed;
  }, [palette.node, palette.line, palette.pulseSpeed]);

  // ── Per-frame: animate node positions, rebuild line endpoints ───────
  const cursorRef = useRef(new THREE.Vector3());

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const level = audioLevelRef.current;

    // Cursor in world-space at z=0 plane (approximation, good enough for
    // a "flock toward cursor" feel without a real raycast).
    cursorRef.current.set(state.pointer.x * 2.0, state.pointer.y * 2.0, 0);

    const { basePositions, livePositions, pairs, phases, linePositions } =
      built;

    // ── Update node positions ───────────────────────────────────────
    for (let i = 0; i < NODE_COUNT; i++) {
      const ix = i * 3;
      const bx = basePositions[ix];
      const by = basePositions[ix + 1];
      const bz = basePositions[ix + 2];
      const ph = phases[i];

      // Gentle floating drift — each node moves on its own little orbit.
      const driftX = Math.sin(t * 0.6 + ph * 6.28) * 0.05;
      const driftY = Math.cos(t * 0.5 + ph * 6.28 * 1.3) * 0.05;
      const driftZ = Math.sin(t * 0.4 + ph * 6.28 * 0.7) * 0.05;

      // Cursor flocking — nodes within radius are pulled toward cursor.
      const dx = cursorRef.current.x - bx;
      const dy = cursorRef.current.y - by;
      const dz = cursorRef.current.z - bz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const flockRadius = 1.2;
      const pull =
        dist < flockRadius ? (1 - dist / flockRadius) * 0.25 : 0;

      // Audio-reactive expansion: nodes push outward from origin with audio.
      const expand = 1 + level * 0.18;

      livePositions[ix + 0] = (bx + driftX) * expand + dx * pull;
      livePositions[ix + 1] = (by + driftY) * expand + dy * pull;
      livePositions[ix + 2] = (bz + driftZ) * expand + dz * pull;
    }
    (built.nodeGeom.attributes.position as THREE.BufferAttribute).needsUpdate =
      true;

    // ── Update line endpoint positions ──────────────────────────────
    for (let p = 0; p < pairs.length / 2; p++) {
      const a = pairs[p * 2];
      const b = pairs[p * 2 + 1];
      const li = p * 6;
      linePositions[li + 0] = livePositions[a * 3 + 0];
      linePositions[li + 1] = livePositions[a * 3 + 1];
      linePositions[li + 2] = livePositions[a * 3 + 2];
      linePositions[li + 3] = livePositions[b * 3 + 0];
      linePositions[li + 4] = livePositions[b * 3 + 1];
      linePositions[li + 5] = livePositions[b * 3 + 2];
    }
    (built.lineGeom.attributes.position as THREE.BufferAttribute).needsUpdate =
      true;

    // ── Update shader uniforms ──────────────────────────────────────
    nodeMat.uniforms.uTime.value = t;
    lineMat.uniforms.uTime.value = t;

    // Whole-orb breathing rotation — slow + cursor-parallax tilt.
    const g = groupRef.current;
    if (g) {
      g.rotation.y += 0.0015;
      g.rotation.x = THREE.MathUtils.lerp(
        g.rotation.x,
        state.pointer.y * -0.15,
        0.05
      );
    }
  });

  return (
    <group ref={groupRef}>
      <lineSegments ref={linesRef} geometry={built.lineGeom} material={lineMat} />
      <points ref={pointsRef} geometry={built.nodeGeom} material={nodeMat} />
    </group>
  );
}

export function NeuralConstellationScene({
  audioLevelRef,
  status,
  personaColor,
}: NeuralConstellationSceneProps) {
  const accent = personaColor ? `#${personaColor}` : "#22d3ee";

  return (
    <Canvas
      camera={{ position: [0, 0, 4.5], fov: 45 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: true }}
    >
      <Suspense fallback={null}>
        <Constellation
          audioLevelRef={audioLevelRef}
          status={status}
          accent={accent}
        />
      </Suspense>
    </Canvas>
  );
}
