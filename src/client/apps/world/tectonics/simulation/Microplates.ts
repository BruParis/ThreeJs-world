import * as THREE from 'three';
import {
  Tile,
  Plate,
  PlateCategory,
  TectonicSystem,
  PlateBoundary,
  BoundaryEdge,
  BoundaryType,
  GeologicalType,
  makePlateBoundary
} from '../data/Plate';
import { km2ToArea, areaToKm2 } from '../../../../shared/world/World';
import { refineBoundaryType } from '../data/PlateOperations';
import {
  caracterizeBoundaryEdge,
  computeConvergentDominance,
  computeTransformSlide,
  enforceZeroNetRotationOnPlates,
  recomputeAllTileMotionVectors
} from '../dynamics/dynamics';

// ============================================================================
// Configuration
// ============================================================================

const MICROPLATE_CONFIG = {
  // Area constraints in km^2
  MIN_AREA_KM2: 100_000,      // 100,000 km^2
  MAX_AREA_KM2: 1_400_000,    // 1,400,000 km^2

  // Minimum angle change (in radians) to consider a "significant bend"
  // About 20 degrees - more noticeable direction shift than TransformGeology
  MIN_BEND_ANGLE: Math.PI / 9,

  // Maximum angle for full probability
  MAX_BEND_ANGLE: Math.PI / 2,  // 90 degrees

  // Maximum tiles to consider expanding from bend point
  MAX_EXPANSION_TILES: 50,

  // Probability of creating microplate when candidate is found
  CREATION_PROBABILITY: 0.6,

  // Decay factor for passive microplate motion (0.5-0.8 typical)
  // Reduces inherited rotation speed due to edge drag along transforms
  PASSIVE_DECAY_FACTOR: 0.7,
};

// Precompute area thresholds in unit sphere area
const MIN_AREA = km2ToArea(MICROPLATE_CONFIG.MIN_AREA_KM2);
const MAX_AREA = km2ToArea(MICROPLATE_CONFIG.MAX_AREA_KM2);

// ============================================================================
// Bend Detection (reused from TransformGeology patterns)
// ============================================================================

/**
 * Computes the direction vector of a boundary edge (tangent to boundary).
 * Returns a normalized vector in the tangent plane at the edge midpoint.
 */
function computeEdgeDirection(bEdge: BoundaryEdge): THREE.Vector3 {
  const he = bEdge.halfedge;
  const edgeVec = new THREE.Vector3().subVectors(
    he.twin.vertex.position,
    he.vertex.position
  );

  // Get edge midpoint on sphere
  const midpoint = new THREE.Vector3()
    .addVectors(he.vertex.position, he.twin.vertex.position)
    .multiplyScalar(0.5)
    .normalize();

  // Project onto tangent plane and normalize
  return edgeVec.clone()
    .sub(midpoint.clone().multiplyScalar(edgeVec.dot(midpoint)))
    .normalize();
}

/**
 * Computes the angle between two edge directions.
 * Returns angle in radians [0, PI].
 */
function angleBetweenEdges(dir1: THREE.Vector3, dir2: THREE.Vector3): number {
  // Clamp dot product to handle numerical precision issues
  const dot = Math.max(-1, Math.min(1, dir1.dot(dir2)));
  return Math.acos(Math.abs(dot));  // Use abs to handle opposite directions
}

/**
 * Determines if a bend is "releasing" (transtensional) vs "restraining" (transpressional).
 *
 * At a bend in a transform fault:
 * - Releasing bend: The fault geometry opens up, creating extension (pull-apart)
 * - Restraining bend: The fault geometry compresses, creating compression (push-up)
 */
function isReleasingBend(
  prevEdge: BoundaryEdge,
  currentEdge: BoundaryEdge,
  tectonicSystem: TectonicSystem
): boolean {
  const he = currentEdge.halfedge;

  // Get tiles on both sides of the current edge
  const tile = tectonicSystem.edge2TileMap.get(he);
  const twinTile = tectonicSystem.edge2TileMap.get(he.twin);

  if (!tile || !twinTile) {
    return false;
  }

  // Get edge midpoint on sphere
  const midpoint = new THREE.Vector3()
    .addVectors(he.vertex.position, he.twin.vertex.position)
    .multiplyScalar(0.5)
    .normalize();

  // Compute tangent direction along boundary
  const tangentDir = computeEdgeDirection(currentEdge);

  // Compute direction change from previous edge to current
  const prevDir = computeEdgeDirection(prevEdge);
  const currentDir = computeEdgeDirection(currentEdge);

  // Cross product tells us which way the boundary is curving
  const curveCross = new THREE.Vector3().crossVectors(prevDir, currentDir);
  const curveSign = curveCross.dot(midpoint);

  // Compute relative velocity between plates
  const relativeVelocity = new THREE.Vector3().subVectors(twinTile.motionVec, tile.motionVec);

  // Get tangential component of relative motion
  const tangentialComponent = relativeVelocity.dot(tangentDir);

  // If slip direction and curve direction align: releasing (pull-apart)
  // If they oppose: restraining (push-up)
  const interaction = curveSign * tangentialComponent;

  return interaction > 0.001;
}

// ============================================================================
// Transform Edge Collection
// ============================================================================

interface TransformSegment {
  edges: BoundaryEdge[];
  boundary: PlateBoundary;
}

/**
 * Collects all transform boundary edge segments from the tectonic system.
 * Returns segments grouped by connected transform edges.
 */
function collectAllTransformSegments(tectonicSystem: TectonicSystem): TransformSegment[] {
  const segments: TransformSegment[] = [];

  for (const boundary of tectonicSystem.boundaries) {
    let currentSegment: BoundaryEdge[] = [];

    for (const bEdge of boundary.iterateEdges()) {
      if (bEdge.refinedType === BoundaryType.TRANSFORM) {
        currentSegment.push(bEdge);
      } else {
        if (currentSegment.length > 0) {
          segments.push({ edges: currentSegment, boundary });
          currentSegment = [];
        }
      }
    }

    if (currentSegment.length > 0) {
      segments.push({ edges: currentSegment, boundary });
    }
  }

  return segments;
}

// ============================================================================
// Microplate Candidate Detection
// ============================================================================

interface BendInfo {
  prevEdge: BoundaryEdge;
  currentEdge: BoundaryEdge;
  bendAngle: number;
  isReleasing: boolean;
  boundary: PlateBoundary;
}

/**
 * Finds significant bends along transform segments.
 */
function findTransformBends(
  segment: TransformSegment,
  tectonicSystem: TectonicSystem
): BendInfo[] {
  const bends: BendInfo[] = [];

  if (segment.edges.length < 2) {
    return bends;
  }

  for (let i = 1; i < segment.edges.length; i++) {
    const prevEdge = segment.edges[i - 1];
    const currentEdge = segment.edges[i];

    // Compute angle between edges
    const prevDir = computeEdgeDirection(prevEdge);
    const currentDir = computeEdgeDirection(currentEdge);
    const bendAngle = angleBetweenEdges(prevDir, currentDir);

    // Check if bend is significant enough
    if (bendAngle < MICROPLATE_CONFIG.MIN_BEND_ANGLE) {
      continue;
    }

    const releasing = isReleasingBend(prevEdge, currentEdge, tectonicSystem);

    bends.push({
      prevEdge,
      currentEdge,
      bendAngle,
      isReleasing: releasing,
      boundary: segment.boundary
    });
  }

  return bends;
}

interface MicroplateCandidate {
  tiles: Set<Tile>;
  totalArea: number;
  isReleasing: boolean;
  bendInfo: BendInfo;
}

/**
 * Expands from a bend point to find a candidate microplate region.
 * Looks for tiles bounded by multiple different plate boundaries.
 */
function expandMicroplateCandidateFromBend(
  bendInfo: BendInfo,
  tectonicSystem: TectonicSystem
): MicroplateCandidate | null {
  const he = bendInfo.currentEdge.halfedge;

  // Get tiles on both sides of the bend edge
  const thisTile = tectonicSystem.edge2TileMap.get(he);
  const twinTile = tectonicSystem.edge2TileMap.get(he.twin);

  if (!thisTile || !twinTile) {
    return null;
  }

  // Try expanding from both sides and pick the better candidate
  const candidates: MicroplateCandidate[] = [];

  for (const startTile of [thisTile, twinTile]) {
    const candidate = expandFromTile(startTile, tectonicSystem, bendInfo);
    if (candidate) {
      candidates.push(candidate);
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  // Pick the candidate with area closest to middle of allowed range
  const targetArea = (MIN_AREA + MAX_AREA) / 2;
  candidates.sort((a, b) => {
    return Math.abs(a.totalArea - targetArea) - Math.abs(b.totalArea - targetArea);
  });

  return candidates[0];
}

/**
 * Expands from a starting tile to find connected tiles that could form a microplate.
 * Stops when encountering different plate boundaries or area limits.
 * Only continental plates can spawn microplates.
 */
function expandFromTile(
  startTile: Tile,
  tectonicSystem: TectonicSystem,
  bendInfo: BendInfo
): MicroplateCandidate | null {
  const plate = startTile.plate;

  // Only continental plates can spawn microplates
  if (plate.category !== PlateCategory.CONTINENTAL) {
    return null;
  }

  const collectedTiles = new Set<Tile>();
  const frontier: Tile[] = [startTile];
  const visited = new Set<Tile>();
  let totalArea = 0;

  // Count how many distinct plate boundaries we touch
  const touchedBoundaries = new Set<PlateBoundary>();

  while (frontier.length > 0 && collectedTiles.size < MICROPLATE_CONFIG.MAX_EXPANSION_TILES) {
    const tile = frontier.shift()!;
    if (visited.has(tile)) continue;
    visited.add(tile);

    // Check if this tile belongs to the same plate
    if (tile.plate !== plate) continue;

    // Check if adding this tile would exceed max area
    if (totalArea + tile.area > MAX_AREA * 1.5) {
      continue;
    }

    collectedTiles.add(tile);
    totalArea += tile.area;

    // Check tile boundaries
    for (const he of tile.loop()) {
      // Is this edge on a plate boundary?
      const boundary = tectonicSystem.edge2BoundaryMap.get(he);
      if (boundary) {
        touchedBoundaries.add(boundary);
      } else {
        // Internal edge - add neighbor to frontier
        const twinTile = tectonicSystem.edge2TileMap.get(he.twin);
        if (twinTile && !visited.has(twinTile)) {
          frontier.push(twinTile);
        }
      }
    }
  }

  // Microplate should touch at least 2 different boundaries (or same boundary in 2 places)
  // This is a simplified heuristic - ideally we'd check for being "wedged" between boundaries
  if (touchedBoundaries.size < 1) {
    return null;
  }

  // Check area constraints
  if (totalArea < MIN_AREA || totalArea > MAX_AREA) {
    return null;
  }

  return {
    tiles: collectedTiles,
    totalArea,
    isReleasing: bendInfo.isReleasing,
    bendInfo
  };
}

// ============================================================================
// Microplate Spawning
// ============================================================================

/**
 * Rebuilds the border edge map for a plate after tiles have been removed.
 */
function rebuildPlateBorderMap(plate: Plate, tectonicSystem: TectonicSystem): void {
  plate.borderEdge2TileMap.clear();

  for (const tile of plate.tiles) {
    for (const he of tile.loop()) {
      const twinTile = tectonicSystem.edge2TileMap.get(he.twin);

      // Edge is a border if twin tile doesn't exist or belongs to different plate
      if (!twinTile || twinTile.plate !== plate) {
        plate.borderEdge2TileMap.set(he, tile);
      }
    }
  }
}

interface SpawnResult {
  microplate: Plate;
  originalPlate: Plate;
  transferredTiles: Set<Tile>;
}

/**
 * Creates a new microplate from a set of tiles.
 * Returns the microplate and metadata needed for boundary updates.
 */
function spawnMicroplate(
  candidate: MicroplateCandidate,
  tectonicSystem: TectonicSystem
): SpawnResult | null {
  const tiles = Array.from(candidate.tiles);
  if (tiles.length === 0) {
    return null;
  }

  const seedTile = tiles[0];
  const originalPlate = seedTile.plate;

  // Check that transferring these tiles won't leave the original plate empty
  // or in an invalid state
  const remainingTiles = originalPlate.tiles.size - tiles.length;
  if (remainingTiles < 1) {
    console.log(`[Microplate] Cannot create: would leave original plate ${originalPlate.id} empty`);
    return null;
  }

  // Create the new microplate (inherits CONTINENTAL category from original plate)
  const microplate = new Plate(tectonicSystem, seedTile, PlateCategory.CONTINENTAL);
  microplate.isMicroplate = true;

  // Motion will be assigned later after all microplates are created

  // Track transferred tiles
  const transferredTiles = new Set<Tile>(tiles);

  // Remove seed tile from original plate's data structures
  originalPlate.tiles.delete(seedTile);
  for (const he of seedTile.loop()) {
    originalPlate.borderEdge2TileMap.delete(he);
  }

  // Add remaining tiles to microplate
  for (let i = 1; i < tiles.length; i++) {
    const tile = tiles[i];

    // Remove from original plate
    originalPlate.tiles.delete(tile);
    for (const he of tile.loop()) {
      originalPlate.borderEdge2TileMap.delete(he);
    }

    // Add to microplate
    microplate.addTile(tile);
  }

  // Rebuild original plate's border map
  rebuildPlateBorderMap(originalPlate, tectonicSystem);

  // Add microplate to system
  tectonicSystem.plates.add(microplate);

  // Compute microplate area
  microplate.computeArea();

  // Update system maps
  tectonicSystem.update();

  // Assign geological type based on bend type
  const geoType = candidate.isReleasing
    ? GeologicalType.BASIN
    : GeologicalType.FOLD_AND_THRUST;

  for (const tile of microplate.tiles) {
    tile.geologicalType = geoType;
  }

  return { microplate, originalPlate, transferredTiles };
}

// ============================================================================
// Boundary Edge Type Preservation
// ============================================================================

import { Halfedge } from '@core/halfedge/Halfedge';
import { ConvergentDominance, TransformSlide } from '../data/Plate';

/**
 * Stored boundary edge information for preservation during microplate creation.
 */
interface SavedBoundaryEdgeInfo {
  rawType: BoundaryType;
  refinedType: BoundaryType;
  dominance: ConvergentDominance;
  thisSideSlide: TransformSlide;
  twinSideSlide: TransformSlide;
}

/**
 * Saves boundary edge type information for all edges.
 * Uses halfedge ID as key since the halfedge objects remain the same.
 */
function saveBoundaryEdgeTypes(tectonicSystem: TectonicSystem): Map<string, SavedBoundaryEdgeInfo> {
  const savedTypes = new Map<string, SavedBoundaryEdgeInfo>();

  for (const boundary of tectonicSystem.boundaries) {
    for (const bEdge of boundary.boundaryEdges) {
      const heId = bEdge.halfedge.id;
      savedTypes.set(heId, {
        rawType: bEdge.rawType,
        refinedType: bEdge.refinedType,
        dominance: bEdge.dominance,
        thisSideSlide: bEdge.thisSideSlide,
        twinSideSlide: bEdge.twinSideSlide,
      });
    }
  }

  return savedTypes;
}

/**
 * Restores boundary edge types from saved data.
 * Only restores if the edge existed in the saved data.
 */
function restoreBoundaryEdgeType(
  bEdge: BoundaryEdge,
  savedTypes: Map<string, SavedBoundaryEdgeInfo>
): boolean {
  const heId = bEdge.halfedge.id;
  const saved = savedTypes.get(heId);

  if (saved) {
    // Restore saved types directly without triggering setters' side effects
    bEdge.rawType = saved.rawType;
    // refinedType is set by rawType setter, but we want the saved refinedType
    bEdge.refinedType = saved.refinedType;
    bEdge.dominance = saved.dominance;
    bEdge.thisSideSlide = saved.thisSideSlide;
    bEdge.twinSideSlide = saved.twinSideSlide;
    return true;
  }

  return false;
}

// ============================================================================
// Boundary Updates for Microplate
// ============================================================================

/**
 * Updates boundaries after creating a microplate.
 *
 * This function:
 * 1. Removes boundaries that are no longer valid (between plates that no longer share edges)
 * 2. Creates new boundaries for the microplate
 * 3. Preserves boundary edge types where possible
 * 4. Only characterizes truly new edges
 */
function updateBoundariesForMicroplate(
  microplate: Plate,
  originalPlate: Plate,
  transferredTiles: Set<Tile>,
  savedTypes: Map<string, SavedBoundaryEdgeInfo>,
  tectonicSystem: TectonicSystem
): void {
  // Collect all halfedges from transferred tiles
  const transferredHalfedges = new Set<Halfedge>();
  for (const tile of transferredTiles) {
    for (const he of tile.loop()) {
      transferredHalfedges.add(he);
      transferredHalfedges.add(he.twin);
    }
  }

  // Find boundaries that need to be updated (involve transferred edges)
  const boundariesToUpdate: PlateBoundary[] = [];
  for (const boundary of tectonicSystem.boundaries) {
    let needsUpdate = false;
    for (const bEdge of boundary.boundaryEdges) {
      if (transferredHalfedges.has(bEdge.halfedge) || transferredHalfedges.has(bEdge.halfedge.twin)) {
        needsUpdate = true;
        break;
      }
    }
    if (needsUpdate) {
      boundariesToUpdate.push(boundary);
    }
  }

  // Remove affected boundaries
  for (const boundary of boundariesToUpdate) {
    tectonicSystem.boundaries.delete(boundary);
    for (const bEdge of boundary.boundaryEdges) {
      tectonicSystem.edge2BoundaryMap.delete(bEdge.halfedge);
      tectonicSystem.edge2BoundaryMap.delete(bEdge.halfedge.twin);
    }
  }

  // Rebuild boundaries for the microplate
  rebuildBoundariesForPlateWithPreservation(microplate, savedTypes, tectonicSystem);

  // Rebuild boundaries for the original plate (only the affected parts)
  rebuildBoundariesForPlateWithPreservation(originalPlate, savedTypes, tectonicSystem);
}

/**
 * Rebuilds boundaries for a plate, preserving existing boundary edge types.
 */
function rebuildBoundariesForPlateWithPreservation(
  plate: Plate,
  savedTypes: Map<string, SavedBoundaryEdgeInfo>,
  tectonicSystem: TectonicSystem
): void {
  const borderHeVisitedSet = new Set<Halfedge>();

  for (const borderHe of plate.borderEdge2TileMap.keys()) {
    // Skip if already in a boundary
    if (tectonicSystem.edge2BoundaryMap.has(borderHe)) continue;
    if (borderHeVisitedSet.has(borderHe)) continue;

    borderHeVisitedSet.add(borderHe);

    const twinTile = tectonicSystem.edge2TileMap.get(borderHe.twin);
    const otherPlate = twinTile?.plate;

    if (!otherPlate || otherPlate === plate) continue;

    // Collect connected border edges between these two plates
    const newBoundaryEdges = new Set<Halfedge>();

    // Build maps for traversal
    const startVertexMap = new Map<number, Halfedge>();
    const endVertexMap = new Map<number, Halfedge>();

    for (const he of plate.borderEdge2TileMap.keys()) {
      startVertexMap.set(he.vertex.id, he);
      endVertexMap.set(he.twin.vertex.id, he);
    }

    // Traverse in one direction
    let auxHe: Halfedge | undefined = borderHe;
    while (auxHe) {
      if (auxHe !== borderHe && borderHeVisitedSet.has(auxHe)) break;

      const auxTwinTile = tectonicSystem.edge2TileMap.get(auxHe.twin);
      if (auxTwinTile?.plate !== otherPlate) break;

      borderHeVisitedSet.add(auxHe);
      newBoundaryEdges.add(auxHe);

      // Move to next edge along the boundary
      const nextVertex = auxHe.twin.vertex;
      auxHe = startVertexMap.get(nextVertex.id);
    }

    // Traverse in the other direction
    auxHe = endVertexMap.get(borderHe.vertex.id);
    while (auxHe && !borderHeVisitedSet.has(auxHe)) {
      const auxTwinTile = tectonicSystem.edge2TileMap.get(auxHe.twin);
      if (auxTwinTile?.plate !== otherPlate) break;

      borderHeVisitedSet.add(auxHe);
      newBoundaryEdges.add(auxHe);

      auxHe = endVertexMap.get(auxHe.vertex.id);
    }

    if (newBoundaryEdges.size > 0) {
      // Create boundary
      const boundary = makePlateBoundary(tectonicSystem, newBoundaryEdges);

      // Restore saved types for existing edges, characterize new edges
      const newEdgesToCharacterize: BoundaryEdge[] = [];
      for (const bEdge of boundary.boundaryEdges) {
        const restored = restoreBoundaryEdgeType(bEdge, savedTypes);
        if (!restored) {
          // This is a truly new edge - needs characterization
          newEdgesToCharacterize.push(bEdge);
        }
      }

      // Characterize only the new edges
      for (const bEdge of newEdgesToCharacterize) {
        caracterizeBoundaryEdge(tectonicSystem, bEdge);
        computeConvergentDominance(tectonicSystem, bEdge);
        computeTransformSlide(tectonicSystem, bEdge);
      }

      // Only refine if we have new edges (refinement looks at neighbors)
      if (newEdgesToCharacterize.length > 0) {
        refineBoundaryType(boundary);
      }

      tectonicSystem.addBoundary(boundary);
    }
  }
}

// ============================================================================
// Microplate Motion Assignment
// ============================================================================

/**
 * Determines if a microplate is "driven" (has active kinematic boundaries).
 * A driven microplate is bounded by at least one DIVERGENT or CONVERGENT boundary.
 */
function isDrivenMicroplate(microplate: Plate, tectonicSystem: TectonicSystem): boolean {
  for (const boundary of tectonicSystem.boundaries) {
    if (boundary.plateA !== microplate && boundary.plateB !== microplate) {
      continue;
    }

    // Check if any edge in this boundary is DIVERGENT or CONVERGENT
    for (const bEdge of boundary.boundaryEdges) {
      const boundaryType = bEdge.refinedType;
      if (boundaryType === BoundaryType.DIVERGENT || boundaryType === BoundaryType.CONVERGENT) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Assigns motion to microplates based on their boundary context.
 *
 * - Driven microplates (bounded by DIVERGENT or CONVERGENT): get new random Euler pole
 * - Passive microplates (bounded only by TRANSFORM/INACTIVE): inherit parent pole with decay
 */
function assignMicroplateMotion(
  microplates: Plate[],
  originalPlates: Map<Plate, Plate>,
  tectonicSystem: TectonicSystem
): void {
  for (const microplate of microplates) {
    microplate.updateCentroid();
    microplate.computeArea();

    const originalPlate = originalPlates.get(microplate);
    const isDriven = isDrivenMicroplate(microplate, tectonicSystem);

    if (isDriven) {
      // Driven microplate: assign new random Euler pole
      const rotationSpeed = Math.random() * 2;
      const rotationAxis = new THREE.Vector3(
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 2 - 1
      ).normalize();

      microplate.rotationAxis = rotationAxis;
      microplate.rotationSpeed = rotationSpeed;

      console.log(`[Microplates] Microplate ${microplate.id}: DRIVEN - assigned new pole`);
    } else {
      // Passive microplate: inherit parent pole with decay
      if (originalPlate) {
        microplate.rotationAxis.copy(originalPlate.rotationAxis);
        microplate.rotationSpeed = originalPlate.rotationSpeed * MICROPLATE_CONFIG.PASSIVE_DECAY_FACTOR;
      } else {
        // Fallback: minimal motion
        microplate.rotationAxis.set(0, 1, 0);
        microplate.rotationSpeed = 0.1;
      }

      console.log(`[Microplates] Microplate ${microplate.id}: PASSIVE - inherited parent pole with decay`);
    }
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Creates microplates at transform boundary bends.
 *
 * Case 2: Pull-Apart Basin Block at releasing bends (transtensional) -> BASIN geology
 * Case 3: Restraining Bend Block at restraining bends (transpressional) -> FOLD_AND_THRUST geology
 *
 * @param tectonicSystem The tectonic system to modify
 */
export function createMicroplates(tectonicSystem: TectonicSystem): void {
  console.log('[Microplates] Starting microplate detection...');

  // Save boundary edge types BEFORE any modifications
  const savedTypes = saveBoundaryEdgeTypes(tectonicSystem);

  // Collect all transform segments
  const segments = collectAllTransformSegments(tectonicSystem);
  console.log(`[Microplates] Found ${segments.length} transform segments`);

  // Find bends in each segment
  const allBends: BendInfo[] = [];
  for (const segment of segments) {
    const bends = findTransformBends(segment, tectonicSystem);
    allBends.push(...bends);
  }

  console.log(`[Microplates] Found ${allBends.length} significant bends`);

  // Collect candidates
  const candidates: MicroplateCandidate[] = [];
  const usedTiles = new Set<Tile>();

  for (const bend of allBends) {
    // Apply creation probability
    if (Math.random() > MICROPLATE_CONFIG.CREATION_PROBABILITY) {
      continue;
    }

    const candidate = expandMicroplateCandidateFromBend(bend, tectonicSystem);
    if (!candidate) continue;

    // Check that candidate tiles don't overlap with already selected candidates
    let hasOverlap = false;
    for (const tile of candidate.tiles) {
      if (usedTiles.has(tile)) {
        hasOverlap = true;
        break;
      }
    }
    if (hasOverlap) continue;

    // Mark tiles as used
    for (const tile of candidate.tiles) {
      usedTiles.add(tile);
    }

    candidates.push(candidate);
  }

  console.log(`[Microplates] ${candidates.length} valid candidates after filtering`);

  // Create microplates and collect spawn results
  const spawnResults: SpawnResult[] = [];
  for (const candidate of candidates) {
    const result = spawnMicroplate(candidate, tectonicSystem);
    if (result) {
      spawnResults.push(result);
      const areaKm2 = areaToKm2(result.microplate.area);
      const bendType = candidate.isReleasing ? 'releasing' : 'restraining';
      console.log(`[Microplates] Created microplate ${result.microplate.id}: area=${Math.round(areaKm2)} km^2, tiles=${result.microplate.tiles.size}, type=${bendType}`);
    }
  }

  if (spawnResults.length === 0) {
    console.log('[Microplates] No microplates created');
    return;
  }

  // Step 1: Update boundaries structure for each microplate
  // At this point, we preserve existing edge types for non-microplate boundaries
  for (const result of spawnResults) {
    updateBoundariesForMicroplate(
      result.microplate,
      result.originalPlate,
      result.transferredTiles,
      savedTypes,
      tectonicSystem
    );
  }

  // Step 2: Assign motion to microplates based on their boundary context
  const microplates = spawnResults.map(r => r.microplate);
  const originalPlates = new Map(spawnResults.map(r => [r.microplate, r.originalPlate]));
  console.log(`[Microplates] Assigning motion to ${microplates.length} microplates...`);
  assignMicroplateMotion(microplates, originalPlates, tectonicSystem);

  // Step 3: Enforce zero net rotation by only adjusting microplate motions
  enforceZeroNetRotationOnPlates(microplates, tectonicSystem);

  // Step 4: Recompute tile motion vectors for all plates
  recomputeAllTileMotionVectors(tectonicSystem);

  // Step 5: Re-characterize ALL boundary edges for microplate boundaries
  // Since microplates have their own motion, we need fresh boundary characterization
  characterizeMicroplateBoundaries(microplates, tectonicSystem);

  console.log(`[Microplates] Created ${spawnResults.length} microplates at transform bends`);
}

/**
 * Characterizes all boundary edges for microplate boundaries.
 * This is called after microplates have been assigned their own motion.
 */
function characterizeMicroplateBoundaries(
  microplates: Plate[],
  tectonicSystem: TectonicSystem
): void {
  // Collect all boundaries involving microplates
  const microplateBoundaries = new Set<PlateBoundary>();
  for (const boundary of tectonicSystem.boundaries) {
    for (const microplate of microplates) {
      if (boundary.plateA === microplate || boundary.plateB === microplate) {
        microplateBoundaries.add(boundary);
        break;
      }
    }
  }

  console.log(`[Microplates] Characterizing ${microplateBoundaries.size} microplate boundaries...`);

  // Characterize each boundary edge (raw type based on relative motion)
  for (const boundary of microplateBoundaries) {
    for (const bEdge of boundary.boundaryEdges) {
      caracterizeBoundaryEdge(tectonicSystem, bEdge);
    }
  }

  // Refine boundary types (smoothing)
  for (const boundary of microplateBoundaries) {
    refineBoundaryType(boundary);
  }

  // Compute dominance and slide for each edge
  for (const boundary of microplateBoundaries) {
    for (const bEdge of boundary.boundaryEdges) {
      computeConvergentDominance(tectonicSystem, bEdge);
      computeTransformSlide(tectonicSystem, bEdge);
    }
  }
}
