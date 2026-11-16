import * as THREE from 'three';
import type { TrackDefinition, TrackNode } from '../types/sim';

export interface TrackSample {
  index: number;
  t: number;
  point: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  bankRad: number;
  distFromStart: number;
}

export interface SampledTrack {
  definition: TrackDefinition;
  curve: THREE.CatmullRomCurve3;
  samples: TrackSample[];
  totalLength: number;
  halfWidth: number;
  curbWidth: number;
  barrierHalfWidth: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export const PRESET_TRACKS: TrackDefinition[] = [
  {
    id: 'silverline-gp',
    name: 'Silverline Proving GP',
    width: 15,
    theme: 'gp-asphalt',
    totalLaps: 3,
    nodes: [
      { x: 0, y: 0, z: 0, bank: 0 },
      { x: 0, y: 0, z: -135, bank: 0 },
      { x: 42, y: 2.5, z: -215, bank: 5 },
      { x: 138, y: 4.5, z: -225, bank: 4 },
      { x: 195, y: 2, z: -155, bank: 2 },
      { x: 150, y: 0, z: -72, bank: 0 },
      { x: 210, y: 3, z: 18, bank: 4 },
      { x: 182, y: 5, z: 132, bank: 6 },
      { x: 78, y: 2.5, z: 170, bank: 3 },
      { x: -8, y: 0.5, z: 118, bank: 0 },
    ],
  },
  {
    id: 'valen-alpine',
    name: 'Valen Alpine Pass',
    width: 13.5,
    theme: 'alpine-dusk',
    totalLaps: 3,
    nodes: [
      { x: 0, y: 0, z: 0, bank: 0 },
      { x: 0, y: 1.5, z: -115, bank: 0 },
      { x: -68, y: 6.5, z: -188, bank: -7 },
      { x: -165, y: 10.5, z: -150, bank: -6 },
      { x: -130, y: 8.0, z: -55, bank: 4 },
      { x: -205, y: 5.0, z: 32, bank: -5 },
      { x: -162, y: 1.5, z: 145, bank: -6 },
      { x: -45, y: 0.5, z: 162, bank: -3 },
      { x: 12, y: 0, z: 98, bank: 0 },
    ],
  },
  {
    id: 'redrock-ring',
    name: 'Redrock Canyon Ring',
    width: 17,
    theme: 'desert-canyon',
    totalLaps: 3,
    nodes: [
      { x: 0, y: 0, z: 0, bank: 0 },
      { x: 0, y: 0, z: -165, bank: 0 },
      { x: 65, y: 1.5, z: -265, bank: 9 },
      { x: 185, y: 3.0, z: -245, bank: 10 },
      { x: 245, y: 1.5, z: -120, bank: 7 },
      { x: 178, y: 0, z: -18, bank: 0 },
      { x: 222, y: 2.5, z: 98, bank: 6 },
      { x: 142, y: 3.0, z: 205, bank: 8 },
      { x: 24, y: 0.5, z: 155, bank: 3 },
    ],
  },
];

const CUSTOM_TRACKS_STORAGE_KEY = 'apex_clutch_custom_tracks_v1';

export function loadCustomTracks(): TrackDefinition[] {
  try {
    const raw = localStorage.getItem(CUSTOM_TRACKS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TrackDefinition[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t) => Array.isArray(t.nodes) && t.nodes.length >= 6);
  } catch {
    return [];
  }
}

export function saveCustomTrack(track: TrackDefinition): TrackDefinition[] {
  const existing = loadCustomTracks();
  const normalized: TrackDefinition = { ...track, isCustom: true };
  const idx = existing.findIndex((t) => t.id === normalized.id);
  const next =
    idx >= 0
      ? existing.map((t, i) => (i === idx ? normalized : t))
      : [normalized, ...existing];
  try {
    localStorage.setItem(CUSTOM_TRACKS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota errors
  }
  return next;
}

export function deleteCustomTrack(id: string): TrackDefinition[] {
  const next = loadCustomTracks().filter((t) => t.id !== id);
  try {
    localStorage.setItem(CUSTOM_TRACKS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore
  }
  return next;
}

function interpolateBank(nodes: TrackNode[], t: number): number {
  const n = nodes.length;
  const scaled = (((t % 1) + 1) % 1) * n;
  const i0 = Math.floor(scaled) % n;
  const i1 = (i0 + 1) % n;
  const frac = scaled - Math.floor(scaled);
  // Smoothstep blend
  const s = frac * frac * (3 - 2 * frac);
  const b0 = nodes[i0].bank ?? 0;
  const b1 = nodes[i1].bank ?? 0;
  return THREE.MathUtils.degToRad(b0 + (b1 - b0) * s);
}

export function buildSampledTrack(
  definition: TrackDefinition,
  sampleCount = 340,
): SampledTrack {
  const controlPoints = definition.nodes.map(
    (n) => new THREE.Vector3(n.x, n.y, n.z),
  );
  const curve = new THREE.CatmullRomCurve3(controlPoints, true, 'centripetal', 0.5);
  const totalLength = curve.getLength();
  const worldUp = new THREE.Vector3(0, 1, 0);

  const samples: TrackSample[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < sampleCount; i++) {
    const t = i / sampleCount;
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();
    const flatRight = new THREE.Vector3().crossVectors(tangent, worldUp).normalize();
    const bankRad = interpolateBank(definition.nodes, t);

    // Apply banking rotation around the forward tangent axis
    const right = flatRight.clone().applyAxisAngle(tangent, bankRad).normalize();
    const up = new THREE.Vector3().crossVectors(right, tangent).normalize();

    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);

    samples.push({
      index: i,
      t,
      point,
      tangent,
      right,
      up,
      bankRad,
      distFromStart: t * totalLength,
    });
  }

  const halfWidth = definition.width * 0.5;
  const curbWidth = 1.15;
  const barrierHalfWidth = halfWidth + curbWidth + 4.8;

  return {
    definition,
    curve,
    samples,
    totalLength,
    halfWidth,
    curbWidth,
    barrierHalfWidth,
    minX,
    maxX,
    minZ,
    maxZ,
  };
}

export interface TrackQueryResult {
  sampleIndex: number;
  sample: TrackSample;
  lateralOffset: number; // + is right of centerline, - is left
  groundY: number;
  surface: 'asphalt' | 'curb' | 'offtrack';
  progress: number;
  barrierHit: boolean;
  pushNormalX: number;
  pushNormalZ: number;
  penetration: number;
}

export function queryTrackAt(
  track: SampledTrack,
  x: number,
  z: number,
  hintIndex = -1,
): TrackQueryResult {
  const { samples } = track;
  const n = samples.length;
  let bestIdx = 0;
  let bestDistSq = Infinity;

  if (hintIndex >= 0 && hintIndex < n) {
    // Search a local window around hintIndex first
    const window = 26;
    for (let offset = -window; offset <= window; offset++) {
      const idx = (hintIndex + offset + n) % n;
      const p = samples[idx].point;
      const dx = x - p.x;
      const dz = z - p.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestIdx = idx;
      }
    }
    // Fallback full scan if player teleported or jumped far away
    if (bestDistSq > 1600) {
      for (let i = 0; i < n; i++) {
        const p = samples[i].point;
        const dx = x - p.x;
        const dz = z - p.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestIdx = i;
        }
      }
    }
  } else {
    for (let i = 0; i < n; i++) {
      const p = samples[i].point;
      const dx = x - p.x;
      const dz = z - p.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestIdx = i;
      }
    }
  }

  const s = samples[bestIdx];
  const dx = x - s.point.x;
  const dz = z - s.point.z;
  const lateralOffset = dx * s.right.x + dz * s.right.z;
  const absLat = Math.abs(lateralOffset);

  let surface: 'asphalt' | 'curb' | 'offtrack' = 'asphalt';
  if (absLat > track.halfWidth + track.curbWidth) {
    surface = 'offtrack';
  } else if (absLat > track.halfWidth - 0.15) {
    surface = 'curb';
  }

  // Ground height includes track banking tilt across road & shoulders, flattening outside barriers
  const clampedLat = THREE.MathUtils.clamp(
    lateralOffset,
    -track.barrierHalfWidth,
    track.barrierHalfWidth,
  );
  const groundY = s.point.y + clampedLat * Math.sin(s.bankRad);

  let barrierHit = false;
  let pushNormalX = 0;
  let pushNormalZ = 0;
  let penetration = 0;

  const limit = track.barrierHalfWidth - 1.1; // Car half-width clearance
  if (absLat > limit) {
    barrierHit = true;
    penetration = absLat - limit;
    const sign = lateralOffset > 0 ? -1 : 1;
    pushNormalX = s.right.x * sign;
    pushNormalZ = s.right.z * sign;
  }

  return {
    sampleIndex: bestIdx,
    sample: s,
    lateralOffset,
    groundY,
    surface,
    progress: s.t,
    barrierHit,
    pushNormalX,
    pushNormalZ,
    penetration,
  };
}

export function computeSpawnTransform(
  track: SampledTrack,
  gridSlot = 0,
): { x: number; y: number; z: number; yaw: number; sampleIndex: number } {
  const n = track.samples.length;
  // Stagger grid slots slightly behind the start/finish line (sample 0)
  const backSteps = 3 + Math.floor(gridSlot / 2) * 3;
  const idx = (n - backSteps) % n;
  const s = track.samples[idx];
  const side = gridSlot % 2 === 0 ? -2.8 : 2.8;
  const x = s.point.x + s.right.x * side;
  const z = s.point.z + s.right.z * side;
  const y = s.point.y + side * Math.sin(s.bankRad);
  // Car local forward is -Z; align local -Z with sample.tangent
  // In Three.js, local -Z rotated by yaw around Y gives (-sin(yaw), 0, -cos(yaw))
  const yaw = Math.atan2(-s.tangent.x, -s.tangent.z);
  return { x, y, z, yaw, sampleIndex: idx };
}
