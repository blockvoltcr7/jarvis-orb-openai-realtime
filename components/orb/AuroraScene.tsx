"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";
import type { VoiceStatus } from "@/lib/voice/types";

interface AuroraSceneProps {
  audioLevelRef: React.MutableRefObject<number>;
  status: VoiceStatus;
  personaColor?: string;
}

const PARTICLE_COUNT = 2200;
const SPHERE_RADIUS = 1.6;

// ────────────────────────────────────────────────────────────────────────────
// Curl noise — produces a divergence-free 3D vector field. Particles
// advected by curl noise stay nicely spread (no clumping at sinks/sources)
// and look like organic, swirling fluid flow.
// ────────────────────────────────────────────────────────────────────────────

function hash3(x: number, y: number, z: number): number {
  let h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return h - Math.floor(h);
}

function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x),
    yi = Math.floor(y),
    zi = Math.floor(z);
  const xf = x - xi,
    yf = y - yi,
    zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const n000 = hash3(xi, yi, zi);
  const n100 = hash3(xi + 1, yi, zi);
  const n010 = hash3(xi, yi + 1, zi);
  const n110 = hash3(xi + 1, yi + 1, zi);
  const n001 = hash3(xi, yi, zi + 1);
  const n101 = hash3(xi + 1, yi, zi + 1);
  const n011 = hash3(xi, yi + 1, zi + 1);
  const n111 = hash3(xi + 1, yi + 1, zi + 1);
  const x00 = n000 * (1 - u) + n100 * u;
  const x10 = n010 * (1 - u) + n110 * u;
  const x01 = n001 * (1 - u) + n101 * u;
  const x11 = n011 * (1 - u) + n111 * u;
  const y0 = x00 * (1 - v) + x10 * v;
  const y1 = x01 * (1 - v) + x11 * v;
  return y0 * (1 - w) + y1 * w;
}

// Curl of a noise-derived vector field. This is the standard "curl noise"
// trick: take the curl of (potential_x, potential_y, potential_z) where
// each potential is just a noise sample at offset coordinates.
const EPS = 0.05;
function curl3(
  out: THREE.Vector3,
  x: number,
  y: number,
  z: number,
  t: number
): void {
  // Three potentials, sampled with different offsets so they're decorrelated.
  const ax = noise3(x, y + t * 0.3, z);
  const ay = noise3(x + 13.1, y, z + t * 0.3);
  const az = noise3(x, y + 7.7, z + t * 0.3 + 23.0);

  // Partial derivatives via finite differences — slow but readable.
  const dax_dy =
    (noise3(x, y + EPS + t * 0.3, z) - noise3(x, y - EPS + t * 0.3, z)) /
    (2 * EPS);
  const dax_dz =
    (noise3(x, y + t * 0.3, z + EPS) - noise3(x, y + t * 0.3, z - EPS)) /
    (2 * EPS);
  const day_dx =
    (noise3(x + EPS + 13.1, y, z + t * 0.3) -
      noise3(x - EPS + 13.1, y, z + t * 0.3)) /
    (2 * EPS);
  const day_dz =
    (noise3(x + 13.1, y, z + EPS + t * 0.3) -
      noise3(x + 13.1, y, z - EPS + t * 0.3)) /
    (2 * EPS);
  const daz_dx =
    (noise3(x + EPS, y + 7.7, z + t * 0.3 + 23.0) -
      noise3(x - EPS, y + 7.7, z + t * 0.3 + 23.0)) /
    (2 * EPS);
  const daz_dy =
    (noise3(x, y + EPS + 7.7, z + t * 0.3 + 23.0) -
      noise3(x, y - EPS + 7.7, z + t * 0.3 + 23.0)) /
    (2 * EPS);

  out.set(daz_dy - day_dz, dax_dz - daz_dx, day_dx - dax_dy);
}

// ────────────────────────────────────────────────────────────────────────────
// Shaders
// ────────────────────────────────────────────────────────────────────────────

const VERT = /*glsl*/ `
uniform float uPixelRatio;
uniform float uSize;
attribute float aLife;        // 0..1, fades at edges
attribute float aHue;         // 0..1 for color band selection
varying float vLife;
varying float vHue;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = uSize * uPixelRatio * (180.0 / -mvPosition.z) * (0.4 + aLife * 0.7);
  vLife = aLife;
  vHue = aHue;
}
`;

const FRAG = /*glsl*/ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
varying float vLife;
varying float vHue;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  float core = smoothstep(0.5, 0.0, d);
  if (core < 0.01) discard;
  // 3-stop gradient across particles by aHue (random per particle).
  vec3 color;
  if (vHue < 0.5) {
    color = mix(uColorA, uColorB, vHue * 2.0);
  } else {
    color = mix(uColorB, uColorC, (vHue - 0.5) * 2.0);
  }
  float alpha = core * vLife * 0.85;
  gl_FragColor = vec4(color * (0.6 + core * 0.7), alpha);
}
`;

function statusPalette(accent: string, status: VoiceStatus) {
  if (status === "thinking") {
    return {
      a: "#a855f7",
      b: "#ec4899",
      c: "#22d3ee",
      flowSpeed: 1.0,
    };
  }
  if (status === "speaking") {
    return {
      a: accent,
      b: "#ffffff",
      c: "#a855f7",
      flowSpeed: 1.4,
    };
  }
  if (status === "error") {
    return {
      a: "#fb923c",
      b: "#ef4444",
      c: "#f59e0b",
      flowSpeed: 1.1,
    };
  }
  return {
    a: accent,
    b: "#67e8f9",
    c: "#a855f7",
    flowSpeed: 0.55,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Aurora flow
// ────────────────────────────────────────────────────────────────────────────

function Aurora({
  audioLevelRef,
  status,
  accent,
}: {
  audioLevelRef: React.MutableRefObject<number>;
  status: VoiceStatus;
  accent: string;
}) {
  const pointsRef = useRef<THREE.Points>(null);
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const { gl } = useThree();
  const pixelRatio = Math.min(gl.getPixelRatio(), 2);
  const palette = statusPalette(accent, status);

  const built = useMemo(() => {
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const velocities = new Float32Array(PARTICLE_COUNT * 3);
    const lives = new Float32Array(PARTICLE_COUNT);
    const hues = new Float32Array(PARTICLE_COUNT);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      // Random point inside sphere.
      const u = Math.random() * 2 - 1;
      const theta = Math.random() * Math.PI * 2;
      const r = Math.cbrt(Math.random()) * SPHERE_RADIUS;
      const sr = Math.sqrt(1 - u * u);
      positions[i * 3] = Math.cos(theta) * sr * r;
      positions[i * 3 + 1] = u * r;
      positions[i * 3 + 2] = Math.sin(theta) * sr * r;
      lives[i] = Math.random();
      hues[i] = Math.random();
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage)
    );
    geom.setAttribute(
      "aLife",
      new THREE.BufferAttribute(lives, 1).setUsage(THREE.DynamicDrawUsage)
    );
    geom.setAttribute("aHue", new THREE.BufferAttribute(hues, 1));
    return { geom, positions, velocities, lives };
  }, []);

  const tmpCurl = useMemo(() => new THREE.Vector3(), []);
  const cursorRef = useRef(new THREE.Vector3());

  useFrame((state) => {
    if (!matRef.current) return;
    const t = state.clock.elapsedTime;
    const audio = audioLevelRef.current;
    const flowSpeed = palette.flowSpeed * (1 + audio * 0.5);
    cursorRef.current.set(
      state.pointer.x * 1.8,
      state.pointer.y * 1.8,
      0
    );

    const { positions, velocities, lives } = built;
    const dt = 0.016; // fixed step for stable feel

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const ix = i * 3;
      const px = positions[ix];
      const py = positions[ix + 1];
      const pz = positions[ix + 2];

      // Sample curl-noise field at particle position. Scale input so the
      // field has a "swirl size" comparable to the sphere radius.
      curl3(tmpCurl, px * 0.7, py * 0.7, pz * 0.7, t * flowSpeed);

      // Cursor swirl: particles within radius get a tangential push around
      // the cursor — adds an extra vortex when the mouse is near.
      const dx = cursorRef.current.x - px;
      const dy = cursorRef.current.y - py;
      const dz = cursorRef.current.z - pz;
      const cdist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const swirlRadius = 1.0;
      if (cdist < swirlRadius && cdist > 0.001) {
        const k = (1 - cdist / swirlRadius) * 0.8;
        // Tangent in the XY plane.
        tmpCurl.x += -dy * k;
        tmpCurl.y += dx * k;
      }

      const speed = 0.35 * flowSpeed;
      velocities[ix] = THREE.MathUtils.lerp(velocities[ix], tmpCurl.x * speed, 0.25);
      velocities[ix + 1] = THREE.MathUtils.lerp(velocities[ix + 1], tmpCurl.y * speed, 0.25);
      velocities[ix + 2] = THREE.MathUtils.lerp(velocities[ix + 2], tmpCurl.z * speed, 0.25);

      let nx = px + velocities[ix] * dt;
      let ny = py + velocities[ix + 1] * dt;
      let nz = pz + velocities[ix + 2] * dt;

      // Soft sphere boundary — particles that drift out get respawned at a
      // random fresh point inside, with life reset (creates the "endless
      // fountain" feel).
      const r2 = nx * nx + ny * ny + nz * nz;
      if (r2 > SPHERE_RADIUS * SPHERE_RADIUS) {
        const u = Math.random() * 2 - 1;
        const theta = Math.random() * Math.PI * 2;
        const rr = Math.cbrt(Math.random()) * SPHERE_RADIUS * 0.6;
        const sr = Math.sqrt(1 - u * u);
        nx = Math.cos(theta) * sr * rr;
        ny = u * rr;
        nz = Math.sin(theta) * sr * rr;
        velocities[ix] = velocities[ix + 1] = velocities[ix + 2] = 0;
        lives[i] = 0;
      }

      positions[ix] = nx;
      positions[ix + 1] = ny;
      positions[ix + 2] = nz;

      // Life ramps from 0→1 quickly so freshly-respawned particles fade in
      // instead of popping into existence.
      lives[i] = Math.min(1, lives[i] + dt * 1.5);
    }

    (built.geom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (built.geom.attributes.aLife as THREE.BufferAttribute).needsUpdate = true;

    matRef.current.uniforms.uColorA.value.set(palette.a);
    matRef.current.uniforms.uColorB.value.set(palette.b);
    matRef.current.uniforms.uColorC.value.set(palette.c);

    if (pointsRef.current) {
      pointsRef.current.rotation.y += 0.0005;
    }
  });

  return (
    <points ref={pointsRef} geometry={built.geom}>
      <shaderMaterial
        ref={matRef}
        vertexShader={VERT}
        fragmentShader={FRAG}
        uniforms={{
          uColorA: { value: new THREE.Color(palette.a) },
          uColorB: { value: new THREE.Color(palette.b) },
          uColorC: { value: new THREE.Color(palette.c) },
          uPixelRatio: { value: pixelRatio },
          uSize: { value: 1.0 },
        }}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

export function AuroraScene({
  audioLevelRef,
  status,
  personaColor,
}: AuroraSceneProps) {
  const accent = personaColor ? `#${personaColor}` : "#22d3ee";
  return (
    <Canvas
      camera={{ position: [0, 0, 4.0], fov: 45 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: true }}
    >
      <Suspense fallback={null}>
        <Aurora
          audioLevelRef={audioLevelRef}
          status={status}
          accent={accent}
        />
      </Suspense>
    </Canvas>
  );
}
