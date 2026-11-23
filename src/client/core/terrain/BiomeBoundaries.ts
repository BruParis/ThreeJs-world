/**
 * Biome boundaries — the biome layout a terrain patch is baked with.
 *
 * A biome layout is described by its boundaries only: great-circle arcs of the
 * planet, each separating two different biomes.  The same description serves
 *   - the World tab: edges between tiles of different biomes (e.g. an oceanic
 *     tile next to a continental one);
 *   - the Shaders tab: rays drawn from a point on the flat patch (the patch is a
 *     gnomonic projection, so its straight lines are great circles).
 *
 * The elevation bake pass (see biomeGLSL) finds, per texel, the nearest
 * boundary — the side of it tells the biome of the texel — and the distance to
 * every other biome, from which it derives blend weights.  Biome parameters are
 * blended with these weights, so transitions are smooth and continuous across
 * patches.
 *
 * Only the boundaries near a patch need to be given; a patch with no boundary
 * is entirely of `defaultBiome`.
 */

import * as THREE from 'three';

// ── Biome ids ──────────────────────────────────────────────────────────────────
// Must stay below BIOME_MAX (biomeGLSL packs per-biome values in vec4s).

export const BIOME_STANDARD = 0;
export const BIOME_OCEAN    = 1;

/** Maximum number of biome ids the shader handles. */
export const BIOME_MAX = 4;

export const BIOME_NAMES: Record<number, string> = {
  [BIOME_STANDARD]: 'Standard',
  [BIOME_OCEAN]:    'Ocean',
};

/** Display colors (debug view, editor overlay), RGB in [0, 1]. */
export const BIOME_COLORS: Record<number, [number, number, number]> = {
  [BIOME_STANDARD]: [0.35, 0.60, 0.20],
  [BIOME_OCEAN]:    [0.10, 0.25, 0.75],
};

// ── Boundary description ───────────────────────────────────────────────────────

/**
 * A boundary arc from `a` to `b` (unit vectors, less than half a great circle
 * apart).  `left` is the biome on the side where dot(cross(a, b), p) > 0.
 */
export interface BiomeBoundaryEdge {
  a: THREE.Vector3;
  b: THREE.Vector3;
  left:  number;
  right: number;
}

export interface BiomeBoundarySet {
  /** Biome of the whole patch when there is no boundary. */
  defaultBiome: number;
  edges: BiomeBoundaryEdge[];
}

/** Adds an edge with its biomes ordered by the side `sample` lies on. */
export function pushBoundaryEdge(
  edges: BiomeBoundaryEdge[],
  a: THREE.Vector3, b: THREE.Vector3,
  sample: THREE.Vector3, sampleBiome: number, otherBiome: number,
): void {
  const n = new THREE.Vector3().crossVectors(a, b);
  const sampleLeft = n.dot(sample) > 0;
  edges.push({
    a: a.clone().normalize(),
    b: b.clone().normalize(),
    left:  sampleLeft ? sampleBiome : otherBiome,
    right: sampleLeft ? otherBiome  : sampleBiome,
  });
}

// ── GPU packing ────────────────────────────────────────────────────────────────

/** Edges stored per texture row pair — must match BIOME_EDGES_PER_ROW in biomeGLSL. */
export const BIOME_EDGES_PER_ROW = 1024;
/** Edges beyond this count are dropped (with a warning). */
export const MAX_BIOME_EDGES = BIOME_EDGES_PER_ROW * 16;

/**
 * Packs the boundary edges into a float texture.
 *   edge i → column i % BIOME_EDGES_PER_ROW, rows 2k and 2k + 1 (k = i / BIOME_EDGES_PER_ROW)
 *   row 2k     : (a.xyz, left)
 *   row 2k + 1 : (b.xyz, right)
 * Returns null when there are no edges.
 */
export function createBiomeEdgeTexture(set: BiomeBoundarySet): THREE.DataTexture | null {
  let count = set.edges.length;
  if (count === 0) return null;
  if (count > MAX_BIOME_EDGES) {
    console.warn(`Biome boundaries: ${count} edges, only ${MAX_BIOME_EDGES} are used.`);
    count = MAX_BIOME_EDGES;
  }

  const width  = Math.min(count, BIOME_EDGES_PER_ROW);
  const height = 2 * Math.ceil(count / BIOME_EDGES_PER_ROW);
  const data   = new Float32Array(width * height * 4);

  for (let i = 0; i < count; i++) {
    const e   = set.edges[i];
    const col = i % BIOME_EDGES_PER_ROW;
    const row = 2 * Math.floor(i / BIOME_EDGES_PER_ROW);
    const ka  = (row * width + col) * 4;
    const kb  = ((row + 1) * width + col) * 4;
    data[ka] = e.a.x; data[ka + 1] = e.a.y; data[ka + 2] = e.a.z; data[ka + 3] = e.left;
    data[kb] = e.b.x; data[kb + 1] = e.b.y; data[kb + 2] = e.b.z; data[kb + 3] = e.right;
  }

  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** Number of edges actually stored by createBiomeEdgeTexture. */
export function biomeEdgeCount(set: BiomeBoundarySet): number {
  return Math.min(set.edges.length, MAX_BIOME_EDGES);
}
