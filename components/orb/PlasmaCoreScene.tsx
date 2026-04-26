"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";
import type { VoiceStatus } from "@/lib/voice/types";

interface PlasmaCoreSceneProps {
  audioLevelRef: React.MutableRefObject<number>;
  status: VoiceStatus;
  personaColor?: string;
}

const ARC_COUNT = 12;
const ARC_SEGMENTS = 24; // points per arc polyline
const HALO_PARTICLES = 650;

// ────────────────────────────────────────────────────────────────────────────
// Inner core: molten plasma shader (fresnel + animated noise)
// ────────────────────────────────────────────────────────────────────────────

const CORE_VERT = /*glsl*/ `
varying vec3 vNormal;
varying vec3 vViewDir;
varying vec3 vPosition;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vViewDir = normalize(-mvPosition.xyz);
  vPosition = position;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const CORE_FRAG = /*glsl*/ `
uniform vec3 uColorHot;   // bright center
uniform vec3 uColorEdge;  // rim glow
uniform float uTime;
uniform float uIntensity; // audio-driven heat boost
varying vec3 vNormal;
varying vec3 vViewDir;
varying vec3 vPosition;

// Cheap 3D hash for animated grain — looks like flickering plasma cells.
float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise3(vec3 x) {
  vec3 p = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(p + vec3(0,0,0)), hash(p + vec3(1,0,0)), f.x),
        mix(hash(p + vec3(0,1,0)), hash(p + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(p + vec3(0,0,1)), hash(p + vec3(1,0,1)), f.x),
        mix(hash(p + vec3(0,1,1)), hash(p + vec3(1,1,1)), f.x), f.y),
    f.z
  );
}

void main() {
  // Fresnel — bright at the rim, dark in the center where we look "into" the orb.
  float fres = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 2.5);

  // Animated 3D noise gives the surface that "boiling plasma" texture.
  float n1 = noise3(vPosition * 3.0 + vec3(uTime * 0.4));
  float n2 = noise3(vPosition * 6.5 - vec3(uTime * 0.7));
  float boil = mix(n1, n2, 0.5);

  // Core glow shape: bright in middle, fading toward rim, modulated by boil.
  float core = clamp((1.0 - fres) * (0.5 + 0.42 * boil) * uIntensity, 0.0, 1.0);
  vec3 col = mix(uColorEdge * (0.24 + fres * (0.78 + boil * 0.35)), uColorHot, core * 0.72);

  // Inner highlight pop
  col += uColorHot * pow(core, 3.0) * 0.22;

  // Slight transparency on rim for layering with halo behind.
  float alpha = 0.62 + fres * 0.24;
  gl_FragColor = vec4(col, alpha);
}
`;

// ────────────────────────────────────────────────────────────────────────────
// Lightning arcs
// ────────────────────────────────────────────────────────────────────────────

interface ArcState {
  // Surface anchor points on the core sphere.
  a: THREE.Vector3;
  b: THREE.Vector3;
  // Per-segment perpendicular offset basis (recomputed when arc respawns).
  perpU: THREE.Vector3;
  perpV: THREE.Vector3;
  // Lifecycle: time when this arc was born and how long it lives.
  born: number;
  life: number; // total lifetime in seconds
  // Random seed for jitter per-arc (different shapes per arc).
  seed: number;
}

function randomSurfacePoint(out: THREE.Vector3, radius: number): void {
  // Uniform spherical random via z-axis trick.
  const u = Math.random() * 2 - 1;
  const theta = Math.random() * Math.PI * 2;
  const r = Math.sqrt(1 - u * u);
  out.set(Math.cos(theta) * r, u, Math.sin(theta) * r).multiplyScalar(radius);
}

function spawnArc(arc: ArcState, now: number, coreRadius: number): void {
  randomSurfacePoint(arc.a, coreRadius);
  randomSurfacePoint(arc.b, coreRadius);
  // Ensure endpoints aren't too close (boring arcs) — retry once.
  if (arc.a.distanceTo(arc.b) < coreRadius * 0.7) {
    randomSurfacePoint(arc.b, coreRadius);
  }

  // Build an orthonormal basis perpendicular to the A→B axis. The arc
  // jitters in this plane so it always reads as a planar zigzag.
  const dir = new THREE.Vector3().subVectors(arc.b, arc.a).normalize();
  const tmp =
    Math.abs(dir.y) < 0.9
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0);
  arc.perpU.crossVectors(dir, tmp).normalize();
  arc.perpV.crossVectors(dir, arc.perpU).normalize();

  arc.born = now;
  arc.life = 0.4 + Math.random() * 0.6; // 0.4-1.0s lifetime
  arc.seed = Math.random() * 1000;
}

const ARC_VERT = /*glsl*/ `
attribute float aArcT;     // 0..1 along this arc segment
attribute float aArcAlpha; // per-vertex envelope (set by JS each frame)
varying float vArcT;
varying float vArcAlpha;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vArcT = aArcT;
  vArcAlpha = aArcAlpha;
}
`;

const ARC_FRAG = /*glsl*/ `
uniform vec3 uColorBolt;
uniform vec3 uColorGlow;
varying float vArcT;
varying float vArcAlpha;
void main() {
  // Bright white-hot core fading toward saturated colored glow.
  vec3 col = mix(uColorGlow, uColorBolt, smoothstep(0.0, 1.0, vArcAlpha));
  float alpha = vArcAlpha;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col, alpha);
}
`;

// ────────────────────────────────────────────────────────────────────────────
// Halo particles around the core (slow-rotating corona)
// ────────────────────────────────────────────────────────────────────────────

const HALO_VERT = /*glsl*/ `
uniform float uPixelRatio;
uniform float uTime;
uniform float uAudioLevel;
attribute float aSize;
attribute float aPhase;
varying float vPhase;
void main() {
  // Gentle radial pulse with audio.
  float pulse = 1.0 + uAudioLevel * 0.3 + sin(uTime * 0.7 + aPhase) * 0.04;
  vec3 p = position * pulse;
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = aSize * uPixelRatio * (220.0 / -mvPosition.z);
  vPhase = aPhase;
}
`;

const HALO_FRAG = /*glsl*/ `
uniform vec3 uColor;
uniform float uTime;
varying float vPhase;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  float core = smoothstep(0.5, 0.0, d);
  if (core < 0.01) discard;
  float twinkle = 0.6 + 0.4 * sin(uTime * 2.5 + vPhase * 6.28);
  gl_FragColor = vec4(uColor * twinkle, core * 0.65);
}
`;

// ────────────────────────────────────────────────────────────────────────────
// Status palette
// ────────────────────────────────────────────────────────────────────────────

function statusPalette(accent: string, status: VoiceStatus) {
  // Bolt = the bright white-hot lightning core.
  // Glow = the colored "energy" surrounding the bolt.
  // CoreHot = inner plasma sphere bright center.
  // CoreEdge = inner plasma sphere fresnel rim.
  if (status === "thinking") {
    return {
      bolt: "#f5d0fe",
      glow: "#a855f7",
      coreHot: "#fef3c7",
      coreEdge: "#7c3aed",
      arcRate: 1.4, // arcs spawn faster
      coreIntensity: 1.0,
    };
  }
  if (status === "speaking") {
    return {
      bolt: "#ffffff",
      glow: accent,
      coreHot: "#fffbeb",
      coreEdge: accent,
      arcRate: 1.8,
      coreIntensity: 0.95,
    };
  }
  if (status === "error") {
    return {
      bolt: "#fed7aa",
      glow: "#dc2626",
      coreHot: "#fff7ed",
      coreEdge: "#7f1d1d",
      arcRate: 2.2,
      coreIntensity: 0.9,
    };
  }
  return {
    bolt: "#ffffff",
    glow: accent,
    coreHot: "#fef3c7",
    coreEdge: accent,
    arcRate: 1.0,
    coreIntensity: 0.68,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Inner components
// ────────────────────────────────────────────────────────────────────────────

function PlasmaCore({
  audioLevelRef,
  palette,
}: {
  audioLevelRef: React.MutableRefObject<number>;
  palette: ReturnType<typeof statusPalette>;
}) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const colorHotRef = useMemo(() => new THREE.Color(palette.coreHot), []);
  const colorEdgeRef = useMemo(() => new THREE.Color(palette.coreEdge), []);

  useFrame((state) => {
    if (!matRef.current) return;
    const t = state.clock.elapsedTime;
    matRef.current.uniforms.uTime.value = t;
    matRef.current.uniforms.uIntensity.value =
      palette.coreIntensity + audioLevelRef.current * 0.35;
    colorHotRef.set(palette.coreHot);
    colorEdgeRef.set(palette.coreEdge);
    matRef.current.uniforms.uColorHot.value = colorHotRef;
    matRef.current.uniforms.uColorEdge.value = colorEdgeRef;

    if (meshRef.current) {
      meshRef.current.rotation.y += 0.003;
      meshRef.current.rotation.x += 0.001;
    }
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[0.7, 48, 48]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={CORE_VERT}
        fragmentShader={CORE_FRAG}
        uniforms={{
          uColorHot: { value: colorHotRef },
          uColorEdge: { value: colorEdgeRef },
          uTime: { value: 0 },
          uIntensity: { value: palette.coreIntensity },
        }}
        transparent
        depthWrite={false}
        blending={THREE.NormalBlending}
      />
    </mesh>
  );
}

function LightningArcs({
  audioLevelRef,
  palette,
  coreRadius,
}: {
  audioLevelRef: React.MutableRefObject<number>;
  palette: ReturnType<typeof statusPalette>;
  coreRadius: number;
}) {
  const linesRef = useRef<THREE.LineSegments>(null);
  const matRef = useRef<THREE.ShaderMaterial>(null);

  // Pre-allocate arc state and buffer geometry.
  const built = useMemo(() => {
    const arcs: ArcState[] = [];
    for (let i = 0; i < ARC_COUNT; i++) {
      arcs.push({
        a: new THREE.Vector3(),
        b: new THREE.Vector3(),
        perpU: new THREE.Vector3(),
        perpV: new THREE.Vector3(),
        born: -10,
        life: 0,
        seed: 0,
      });
      // Stagger initial spawns so all arcs aren't synchronized.
      arcs[i].born = -Math.random() * 1.5;
      arcs[i].life = 0.5 + Math.random() * 0.5;
      randomSurfacePoint(arcs[i].a, coreRadius);
      randomSurfacePoint(arcs[i].b, coreRadius);
      const dir = new THREE.Vector3()
        .subVectors(arcs[i].b, arcs[i].a)
        .normalize();
      const tmp =
        Math.abs(dir.y) < 0.9
          ? new THREE.Vector3(0, 1, 0)
          : new THREE.Vector3(1, 0, 0);
      arcs[i].perpU.crossVectors(dir, tmp).normalize();
      arcs[i].perpV.crossVectors(dir, arcs[i].perpU).normalize();
      arcs[i].seed = Math.random() * 1000;
    }

    // Each arc has ARC_SEGMENTS - 1 line segments → 2 verts per segment.
    const segPerArc = ARC_SEGMENTS - 1;
    const totalVerts = ARC_COUNT * segPerArc * 2;
    const positions = new Float32Array(totalVerts * 3);
    const arcT = new Float32Array(totalVerts);
    const arcAlpha = new Float32Array(totalVerts);

    // aArcT: same value for both endpoints of each segment is OK because
    // the shader uses it for color blending, not for spatial interpolation.
    for (let i = 0; i < ARC_COUNT; i++) {
      for (let s = 0; s < segPerArc; s++) {
        const t0 = s / (ARC_SEGMENTS - 1);
        const t1 = (s + 1) / (ARC_SEGMENTS - 1);
        const baseV = (i * segPerArc + s) * 2;
        arcT[baseV + 0] = t0;
        arcT[baseV + 1] = t1;
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage)
    );
    geom.setAttribute("aArcT", new THREE.BufferAttribute(arcT, 1));
    geom.setAttribute(
      "aArcAlpha",
      new THREE.BufferAttribute(arcAlpha, 1).setUsage(THREE.DynamicDrawUsage)
    );

    return { arcs, geom, positions, arcAlpha, segPerArc };
  }, [coreRadius]);

  // Workspace vectors to avoid per-frame allocations in the hot loop.
  const work = useMemo(
    () => ({
      pA: new THREE.Vector3(),
      pB: new THREE.Vector3(),
      pPrev: new THREE.Vector3(),
      pCur: new THREE.Vector3(),
    }),
    []
  );

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const arcs = built.arcs;
    const positions = built.positions;
    const alphas = built.arcAlpha;
    const segPerArc = built.segPerArc;
    const audioBoost = 1 + audioLevelRef.current * 0.7;

    for (let i = 0; i < ARC_COUNT; i++) {
      const arc = arcs[i];
      const age = t - arc.born;
      const lifeFrac = age / arc.life;

      // Respawn when the arc has died, with a brief cooldown gap modulated
      // by status arcRate (faster respawn during speaking/thinking).
      if (lifeFrac > 1 + 0.15 / palette.arcRate) {
        spawnArc(arc, t, coreRadius);
        continue;
      }

      // Envelope: fast attack, exponential decay (looks like a real spark).
      let env = 0;
      if (lifeFrac < 0.05) {
        env = lifeFrac / 0.05; // 0→1 attack
      } else if (lifeFrac < 1) {
        env = Math.exp(-3.5 * (lifeFrac - 0.05));
      }
      env *= audioBoost;
      // Random per-frame flicker — real lightning doesn't hold steady.
      env *= 0.7 + Math.random() * 0.4;

      // Build the polyline: ARC_SEGMENTS points from A to B with
      // perpendicular zigzag noise that re-jitters each frame.
      const segOffset = i * segPerArc * 2 * 3;
      const alphaOffset = i * segPerArc * 2;

      // First point = A (no offset).
      work.pPrev.copy(arc.a);

      for (let s = 1; s <= segPerArc; s++) {
        const tt = s / (ARC_SEGMENTS - 1);
        // Linear interp A→B.
        work.pCur.lerpVectors(arc.a, arc.b, tt);

        // Perpendicular jitter — strongest in middle, fades at endpoints.
        const taper = Math.sin(tt * Math.PI); // 0 at ends, 1 in middle
        const jitterAmp = coreRadius * 0.55 * taper;
        // Hash noise — different per (arc, seg, time-frame).
        const ph = arc.seed + s * 17.13 + t * 90;
        const ox = (Math.sin(ph * 1.7) + Math.sin(ph * 4.1)) * 0.5;
        const oy = (Math.cos(ph * 2.3) + Math.cos(ph * 5.9)) * 0.5;
        work.pCur.addScaledVector(arc.perpU, ox * jitterAmp);
        work.pCur.addScaledVector(arc.perpV, oy * jitterAmp);

        // Write segment from pPrev → pCur.
        const v = segOffset + (s - 1) * 6;
        positions[v + 0] = work.pPrev.x;
        positions[v + 1] = work.pPrev.y;
        positions[v + 2] = work.pPrev.z;
        positions[v + 3] = work.pCur.x;
        positions[v + 4] = work.pCur.y;
        positions[v + 5] = work.pCur.z;

        const ai = alphaOffset + (s - 1) * 2;
        alphas[ai + 0] = env;
        alphas[ai + 1] = env;

        work.pPrev.copy(work.pCur);
      }
    }

    (built.geom.attributes.position as THREE.BufferAttribute).needsUpdate =
      true;
    (built.geom.attributes.aArcAlpha as THREE.BufferAttribute).needsUpdate =
      true;
  });

  // Update colors when palette changes (cheap, ref-mutate uniforms).
  useFrame(() => {
    if (!matRef.current) return;
    matRef.current.uniforms.uColorBolt.value.set(palette.bolt);
    matRef.current.uniforms.uColorGlow.value.set(palette.glow);
  });

  return (
    <lineSegments ref={linesRef} geometry={built.geom}>
      <shaderMaterial
        ref={matRef}
        vertexShader={ARC_VERT}
        fragmentShader={ARC_FRAG}
        uniforms={{
          uColorBolt: { value: new THREE.Color(palette.bolt) },
          uColorGlow: { value: new THREE.Color(palette.glow) },
        }}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </lineSegments>
  );
}

function ParticleHalo({
  audioLevelRef,
  palette,
}: {
  audioLevelRef: React.MutableRefObject<number>;
  palette: ReturnType<typeof statusPalette>;
}) {
  const pointsRef = useRef<THREE.Points>(null);
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const { gl } = useThree();
  const pixelRatio = Math.min(gl.getPixelRatio(), 2);

  const built = useMemo(() => {
    const positions = new Float32Array(HALO_PARTICLES * 3);
    const sizes = new Float32Array(HALO_PARTICLES);
    const phases = new Float32Array(HALO_PARTICLES);
    for (let i = 0; i < HALO_PARTICLES; i++) {
      // Spherical shell with random thickness 0.95-1.6.
      const r = 0.95 + Math.pow(Math.random(), 2) * 0.65;
      const u = Math.random() * 2 - 1;
      const theta = Math.random() * Math.PI * 2;
      const sr = Math.sqrt(1 - u * u);
      positions[i * 3 + 0] = Math.cos(theta) * sr * r;
      positions[i * 3 + 1] = u * r;
      positions[i * 3 + 2] = Math.sin(theta) * sr * r;
      sizes[i] = 0.08 + Math.random() * 0.24;
      phases[i] = Math.random() * Math.PI * 2;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geom.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geom.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    return { geom };
  }, []);

  useFrame((state) => {
    if (!matRef.current) return;
    matRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    matRef.current.uniforms.uAudioLevel.value = audioLevelRef.current;
    matRef.current.uniforms.uColor.value.set(palette.glow);
    if (pointsRef.current) {
      pointsRef.current.rotation.y += 0.0015;
      pointsRef.current.rotation.x += 0.0006;
    }
  });

  return (
    <points ref={pointsRef} geometry={built.geom}>
      <shaderMaterial
        ref={matRef}
        vertexShader={HALO_VERT}
        fragmentShader={HALO_FRAG}
        uniforms={{
          uColor: { value: new THREE.Color(palette.glow) },
          uTime: { value: 0 },
          uAudioLevel: { value: 0 },
          uPixelRatio: { value: pixelRatio },
        }}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

function CoreContainer({
  audioLevelRef,
  status,
  accent,
}: {
  audioLevelRef: React.MutableRefObject<number>;
  status: VoiceStatus;
  accent: string;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const palette = statusPalette(accent, status);
  const targetScale = useRef(new THREE.Vector3(1, 1, 1));

  useFrame((state) => {
    const g = groupRef.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    const level = audioLevelRef.current;
    // Audio-reactive breathing scale on the whole orb.
    const breathe = 1 + Math.sin(t * 1.0) * 0.02;
    const target = breathe + level * 0.12;
    targetScale.current.setScalar(target);
    g.scale.lerp(targetScale.current, 0.1);

    // Subtle parallax tilt — orb leans toward the cursor.
    g.rotation.x = THREE.MathUtils.lerp(
      g.rotation.x,
      state.pointer.y * -0.18,
      0.05
    );
    g.rotation.y = THREE.MathUtils.lerp(
      g.rotation.y,
      state.pointer.x * 0.18,
      0.05
    );
  });

  return (
    <group ref={groupRef}>
      <PlasmaCore audioLevelRef={audioLevelRef} palette={palette} />
      <LightningArcs
        audioLevelRef={audioLevelRef}
        palette={palette}
        coreRadius={0.7}
      />
      <ContainmentRings audioLevelRef={audioLevelRef} palette={palette} />
      <ParticleHalo audioLevelRef={audioLevelRef} palette={palette} />
    </group>
  );
}

function ContainmentRings({
  audioLevelRef,
  palette,
}: {
  audioLevelRef: React.MutableRefObject<number>;
  palette: ReturnType<typeof statusPalette>;
}) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    const g = groupRef.current;
    if (!g) return;
    const level = audioLevelRef.current;
    g.rotation.z += 0.002;
    g.rotation.y += 0.001;
    g.scale.setScalar(1 + level * 0.04);
    g.children.forEach((child, index) => {
      const mesh = child as THREE.Mesh;
      const material = mesh.material as THREE.MeshBasicMaterial;
      material.color.set(index === 1 ? palette.bolt : palette.glow);
      material.opacity = (index === 1 ? 0.22 : 0.12) + level * 0.06;
    });
  });

  return (
    <group ref={groupRef}>
      <mesh rotation={[Math.PI * 0.5, 0.15, 0]}>
        <torusGeometry args={[0.98, 0.009, 8, 160]} />
        <meshBasicMaterial
          color={palette.glow}
          transparent
          opacity={0.12}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh rotation={[0.9, 0.55, 0.4]}>
        <torusGeometry args={[1.12, 0.007, 8, 160]} />
        <meshBasicMaterial
          color={palette.bolt}
          transparent
          opacity={0.22}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh rotation={[0.3, Math.PI * 0.5, -0.25]}>
        <torusGeometry args={[1.26, 0.006, 8, 160]} />
        <meshBasicMaterial
          color={palette.glow}
          transparent
          opacity={0.1}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

export function PlasmaCoreScene({
  audioLevelRef,
  status,
  personaColor,
}: PlasmaCoreSceneProps) {
  const accent = personaColor ? `#${personaColor}` : "#22d3ee";

  return (
    <Canvas
      camera={{ position: [0, 0, 4.2], fov: 45 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: true }}
    >
      <Suspense fallback={null}>
        <CoreContainer
          audioLevelRef={audioLevelRef}
          status={status}
          accent={accent}
        />
      </Suspense>
    </Canvas>
  );
}
