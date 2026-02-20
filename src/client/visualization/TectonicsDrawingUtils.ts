import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';

import { Tile, Plate, PlateBoundary, BoundaryType, BoundaryEdge, TectonicSystem, ConvergentDominance, TransformSlide } from '../tectonics/data/Plate';
import { BOUNDARY_COLORS } from './BoundaryColors';
import { kmToDistance } from '../world/World';


function makeLineSegments2FromTile(tile: Tile, lines: LineSegments2): void {

  const positions = new Array<number>();
  const colors = new Array<number>();

  const borderColor = [1, 0, 0];
  const innerColor = [1, 1, 1];

  for (const he of tile.loop()) {
    const vStart = he.vertex.position.clone();
    const vEnd = he.next.vertex.position.clone();

    positions.push(vStart.x, vStart.y, vStart.z);
    positions.push(vEnd.x, vEnd.y, vEnd.z);

    colors.push(innerColor[0], innerColor[1], innerColor[2]);
    colors.push(innerColor[0], innerColor[1], innerColor[2]);
  }

  lines.geometry.dispose();
  lines.geometry = new LineSegmentsGeometry();
  lines.geometry.setPositions(positions);
  lines.geometry.setColors(colors);
  lines.computeLineDistances();
}

function makeLineSegments2FromPlate(plate: Plate, lines: LineSegments2): void {
  const positions = new Array<number>();
  const colors = new Array<number>();

  const borderColor = [0.5, 0.5, 0.5];
  for (const he of plate.borderEdge2TileMap.keys()) {
    const vStart = he.vertex.position.clone();
    const vEnd = he.next.vertex.position.clone();

    positions.push(vStart.x, vStart.y, vStart.z);
    positions.push(vEnd.x, vEnd.y, vEnd.z);

    colors.push(borderColor[0], borderColor[1], borderColor[2]);
    colors.push(borderColor[0], borderColor[1], borderColor[2]);
  }

  console.log("Num border lines for plate", plate.id, ":", positions.length / 6);

  lines.geometry.dispose();
  lines.geometry = new LineSegmentsGeometry();
  lines.geometry.setPositions(positions);
  lines.geometry.setColors(colors);
  lines.computeLineDistances();
}

function makeLineSegments2FromBoundary(boundary: PlateBoundary, lines: LineSegments2, useRawType: boolean = false): void {
  const positions = new Array<number>();
  const colors = new Array<number>();
  const lineWidths = new Array<number>();
  const dashOffsets = new Array<number>();
  const dashScales = new Array<number>();

  // Higher offset than allBoundaries (0.001) to render above them
  const offsetFactor = 0.003;

  console.log("Number of boundaryEdges: ", boundary.boundaryEdges.size);

  for (const bEdge of boundary.boundaryEdges) {
    const vStart = bEdge.halfedge.vertex.position.clone();
    const vEnd = bEdge.halfedge.next.vertex.position.clone();

    vStart.multiplyScalar(1 + offsetFactor);
    vEnd.multiplyScalar(1 + offsetFactor);

    positions.push(vStart.x, vStart.y, vStart.z);
    positions.push(vEnd.x, vEnd.y, vEnd.z);

    const edgeType = useRawType ? bEdge.rawType : bEdge.refinedType;
    console.log("type: ", edgeType, useRawType ? "(raw)" : "(refined)");

    // Customize appearance based on boundary type
    const color = BOUNDARY_COLORS[edgeType];
    colors.push(color[0], color[1], color[2]);
    colors.push(color[0], color[1], color[2]);

    // Set dash parameters based on type
    if (edgeType === BoundaryType.UNKNOWN) {
      dashOffsets.push(0, 0.5);
      dashScales.push(0.5, 0.5);
    } else if (edgeType === BoundaryType.TRANSFORM) {
      dashOffsets.push(0, 0.2);
      dashScales.push(0.2, 0.2);
    } else {
      dashOffsets.push(0, 0);
      dashScales.push(0, 0);
    }
  }

  lines.geometry.dispose();
  lines.geometry = new LineSegmentsGeometry();
  lines.geometry.setPositions(positions);
  lines.geometry.setColors(colors);

  // Apply line widths and dashing
  // const material = lines.material as LineMaterial;
  // material.dashed = true;
  // material.dashOffset = 0;
  // material.dashScale = 0.5; // Adjust for dashing effect

  // lines.geometry.setAttributes({
  //   lineWidths: new Float32BufferAttribute(lineWidths, 1),
  //   dashOffset: new Float32BufferAttribute(dashOffsets, 1),
  //   dashScale: new Float32BufferAttribute(dashScales, 1),
  // });

  lines.computeLineDistances();
}

function makeLineSegments2ForTileMotionVec(tectonicSystem: TectonicSystem, lines: LineSegments2): void {
  const positions = new Array<number>();
  const colors = new Array<number>();

  const moveColor = [1.0, 0.1, 0.1];

  const scaleFactor = 0.1;
  const arrowHeadSize = 0.005;

  for (const plate of tectonicSystem.plates) {
    for (const tile of plate.tiles) {
      const tileCentroid = tile.centroid;
      const originPos = tileCentroid.clone();

      const moveVector = tile.motionVec.clone().multiplyScalar(scaleFactor);

      const vStart = originPos.clone();
      const vEnd = originPos.clone().add(moveVector);

      positions.push(vStart.x, vStart.y, vStart.z);
      positions.push(vEnd.x, vEnd.y, vEnd.z);

      // Make a small arrow head
      const moveDir = moveVector.clone().normalize();
      const arrowBase = vEnd.clone().sub(moveDir.clone().multiplyScalar(arrowHeadSize));
      const orthogonalVec1 = new THREE.Vector3().crossVectors(moveDir, new THREE.Vector3(0, 1, 0));
      if (orthogonalVec1.length() < 0.001) {
        orthogonalVec1.crossVectors(moveDir, new THREE.Vector3(1, 0, 0));
      }
      orthogonalVec1.normalize().multiplyScalar(arrowHeadSize * 0.5);
      const orthogonalVec2 = new THREE.Vector3().crossVectors(moveDir, orthogonalVec1).normalize().multiplyScalar(arrowHeadSize * 0.5);
      const arrowPoint1 = arrowBase.clone().add(orthogonalVec1);
      const arrowPoint2 = arrowBase.clone().sub(orthogonalVec1);
      const arrowPoint3 = arrowBase.clone().add(orthogonalVec2);
      positions.push(vEnd.x, vEnd.y, vEnd.z);
      positions.push(arrowPoint1.x, arrowPoint1.y, arrowPoint1.z);
      positions.push(vEnd.x, vEnd.y, vEnd.z);
      positions.push(arrowPoint2.x, arrowPoint2.y, arrowPoint2.z);
      positions.push(vEnd.x, vEnd.y, vEnd.z);
      positions.push(arrowPoint3.x, arrowPoint3.y, arrowPoint3.z);

      colors.push(moveColor[0], moveColor[1], moveColor[2]);
      colors.push(moveColor[0], moveColor[1], moveColor[2]);
      colors.push(moveColor[0], moveColor[1], moveColor[2]);
      colors.push(moveColor[0], moveColor[1], moveColor[2]);
      colors.push(moveColor[0], moveColor[1], moveColor[2]);
      colors.push(moveColor[0], moveColor[1], moveColor[2]);
      colors.push(moveColor[0], moveColor[1], moveColor[2]);
      colors.push(moveColor[0], moveColor[1], moveColor[2]);
    }
  }

  lines.geometry.dispose();
  lines.geometry = new LineSegmentsGeometry();
  lines.geometry.setPositions(positions);
  lines.geometry.setColors(colors);
  lines.computeLineDistances();
}

/**
 * Creates line segments for a boundary with gradient coloring along its length.
 * For open boundaries, colors from one limit to the other (cyan to magenta).
 * For closed loops, colors around the loop starting from the provided start edge.
 *
 * @param boundary The plate boundary to visualize
 * @param lines The LineSegments2 object to populate
 * @param startEdge Optional: edge to start from. For open boundaries, should be a limit edge.
 *                  For closed loops, can be any edge (e.g., closest to click point).
 * @returns true if successful
 */
function makeLineSegments2FromBoundaryGradient(
  boundary: PlateBoundary,
  lines: LineSegments2,
  startEdge?: BoundaryEdge
): boolean {
  const positions = new Array<number>();
  const colors = new Array<number>();

  // Higher offset than other boundary visualizations to render above them
  // Regular boundary lines use 0.003, all boundaries use 0.001
  const offsetFactor = 0.006;

  // Collect edges in order
  const orderedEdges: BoundaryEdge[] = [];
  for (const edge of boundary.iterateEdges(startEdge)) {
    orderedEdges.push(edge);
  }

  const totalEdges = orderedEdges.length;
  if (totalEdges === 0) {
    return false;
  }

  // Gradient colors: start (cyan) to end (magenta)
  const startColor = [0, 1, 1]; // Cyan
  const endColor = [1, 0, 1];   // Magenta

  for (let i = 0; i < orderedEdges.length; i++) {
    const bEdge = orderedEdges[i];
    const t = totalEdges > 1 ? i / (totalEdges - 1) : 0;

    const vStart = bEdge.halfedge.vertex.position.clone();
    const vEnd = bEdge.halfedge.next.vertex.position.clone();

    vStart.multiplyScalar(1 + offsetFactor);
    vEnd.multiplyScalar(1 + offsetFactor);

    positions.push(vStart.x, vStart.y, vStart.z);
    positions.push(vEnd.x, vEnd.y, vEnd.z);

    // Interpolate color
    const r = startColor[0] + t * (endColor[0] - startColor[0]);
    const g = startColor[1] + t * (endColor[1] - startColor[1]);
    const b = startColor[2] + t * (endColor[2] - startColor[2]);

    colors.push(r, g, b);
    colors.push(r, g, b);
  }

  lines.geometry.dispose();
  lines.geometry = new LineSegmentsGeometry();
  lines.geometry.setPositions(positions);
  lines.geometry.setColors(colors);
  lines.computeLineDistances();

  return true;
}

/**
 * Creates line segments for all boundaries in the tectonic system with a uniform color.
 * @param tectonicSystem The tectonic system containing all boundaries
 * @param lines The LineSegments2 object to populate
 * @param color RGB color array [r, g, b] with values in range [0, 1], defaults to light gray
 */
function makeLineSegments2ForAllBoundaries(
  tectonicSystem: TectonicSystem,
  lines: LineSegments2,
  color: [number, number, number] = [0.7, 0.7, 0.7]
): void {
  const positions = new Array<number>();
  const colors = new Array<number>();

  const offsetFactor = 0.001;

  for (const boundary of tectonicSystem.boundaries) {
    for (const bEdge of boundary.boundaryEdges) {
      const vStart = bEdge.halfedge.vertex.position.clone();
      const vEnd = bEdge.halfedge.next.vertex.position.clone();

      vStart.multiplyScalar(1 + offsetFactor);
      vEnd.multiplyScalar(1 + offsetFactor);

      positions.push(vStart.x, vStart.y, vStart.z);
      positions.push(vEnd.x, vEnd.y, vEnd.z);

      colors.push(color[0], color[1], color[2]);
      colors.push(color[0], color[1], color[2]);
    }
  }

  lines.geometry.dispose();
  lines.geometry = new LineSegmentsGeometry();
  lines.geometry.setPositions(positions);
  lines.geometry.setColors(colors);
  lines.computeLineDistances();
}

/**
 * Creates line segments for all boundaries in the tectonic system colored by their type.
 * @param tectonicSystem The tectonic system containing all boundaries
 * @param lines The LineSegments2 object to populate
 * @param useRawType If true, use rawType; otherwise use refinedType
 */
function makeLineSegments2ForAllBoundariesByType(
  tectonicSystem: TectonicSystem,
  lines: LineSegments2,
  useRawType: boolean = false
): void {
  const positions = new Array<number>();
  const colors = new Array<number>();

  const offsetFactor = 0.001;

  for (const boundary of tectonicSystem.boundaries) {
    for (const bEdge of boundary.boundaryEdges) {
      const vStart = bEdge.halfedge.vertex.position.clone();
      const vEnd = bEdge.halfedge.next.vertex.position.clone();

      vStart.multiplyScalar(1 + offsetFactor);
      vEnd.multiplyScalar(1 + offsetFactor);

      positions.push(vStart.x, vStart.y, vStart.z);
      positions.push(vEnd.x, vEnd.y, vEnd.z);

      const edgeType = useRawType ? bEdge.rawType : bEdge.refinedType;
      const color = BOUNDARY_COLORS[edgeType];
      colors.push(color[0], color[1], color[2]);
      colors.push(color[0], color[1], color[2]);
    }
  }

  lines.geometry.dispose();
  lines.geometry = new LineSegmentsGeometry();
  lines.geometry.setPositions(positions);
  lines.geometry.setColors(colors);
  lines.computeLineDistances();
}

/**
 * Creates line segments for neighbor tiles on the same plate.
 * Each neighbor tile's edges are displayed in a distinct color.
 * @param tile The source tile
 * @param tectonicSystem The tectonic system to find neighbors
 * @param lines The LineSegments2 object to populate
 */
function makeLineSegments2ForNeighborTilesInPlate(
  tile: Tile,
  tectonicSystem: TectonicSystem,
  lines: LineSegments2
): void {
  const positions = new Array<number>();
  const colors = new Array<number>();

  const plate = tile.plate;

  // Distinct colors for each neighbor
  const neighborColors = [
    [0, 1, 0],    // Green
    [0, 0, 1],    // Blue
    [1, 1, 0],    // Yellow
    [1, 0, 1],    // Magenta
    [0, 1, 1],    // Cyan
    [1, 0.5, 0],  // Orange
    [0.5, 0, 1],  // Purple
    [0, 0.5, 1],  // Light blue
  ];

  // Offset factor to render slightly above the mesh
  const offsetFactor = 0.002;

  let neighborIndex = 0;
  const visitedNeighbors = new Set<Tile>();

  console.log(`[DEBUG] Finding neighbors for tile ${tile.id} in plate ${plate.id}`);

  for (const he of tile.loop()) {
    const twinTile = tectonicSystem.edge2TileMap.get(he.twin);

    if (!twinTile) {
      console.log(`[DEBUG] Edge ${he.id}: no twin tile found`);
      continue;
    }

    if (twinTile === tile) {
      console.log(`[DEBUG] Edge ${he.id}: twin tile is same as source tile`);
      continue;
    }

    if (visitedNeighbors.has(twinTile)) {
      continue;
    }

    const isSamePlate = twinTile.plate === plate;
    console.log(`[DEBUG] Edge ${he.id}: twin tile ${twinTile.id} in plate ${twinTile.plate.id}, same plate: ${isSamePlate}`);

    if (!isSamePlate) {
      continue;
    }

    visitedNeighbors.add(twinTile);

    const color = neighborColors[neighborIndex % neighborColors.length];
    neighborIndex++;

    console.log(`[DEBUG] Neighbor tile ${twinTile.id} (color index ${neighborIndex - 1})`);

    // Draw all edges of this neighbor tile
    for (const neighborHe of twinTile.loop()) {
      const vStart = neighborHe.vertex.position.clone();
      const vEnd = neighborHe.next.vertex.position.clone();

      // Offset slightly outward
      vStart.multiplyScalar(1 + offsetFactor);
      vEnd.multiplyScalar(1 + offsetFactor);

      positions.push(vStart.x, vStart.y, vStart.z);
      positions.push(vEnd.x, vEnd.y, vEnd.z);

      colors.push(color[0], color[1], color[2]);
      colors.push(color[0], color[1], color[2]);
    }
  }

  console.log(`[DEBUG] Total neighbors found on same plate: ${visitedNeighbors.size}`);

  lines.geometry.dispose();
  lines.geometry = new LineSegmentsGeometry();
  lines.geometry.setPositions(positions);
  lines.geometry.setColors(colors);
  lines.computeLineDistances();
}

/**
 * Creates small triangles indicating the dominant plate at convergent boundaries.
 * Each triangle has its base aligned with the boundary edge and points toward the dominant plate.
 * Triangle size is proportional to the edge length (base is ~1/3 of edge length).
 * Triangles are colored to match the boundary type color.
 *
 * @param tectonicSystem The tectonic system containing all boundaries
 * @param lines The LineSegments2 object to populate
 * @param baseFraction Fraction of edge length for triangle base (default 0.33)
 */
function makeLineSegments2ForDominanceIndicators(
  tectonicSystem: TectonicSystem,
  lines: LineSegments2,
  baseFraction: number = 0.5
): void {
  const positions = new Array<number>();
  const colors = new Array<number>();

  // Offset to render above boundary lines
  const offsetFactor = 0.001;

  for (const boundary of tectonicSystem.boundaries) {
    for (const bEdge of boundary.boundaryEdges) {
      const dominance = bEdge.dominance;

      // Validate: dominance should only be set for convergent boundaries
      if (dominance !== ConvergentDominance.NOT_APPLICABLE &&
          dominance !== ConvergentDominance.UNDETERMINED &&
          bEdge.refinedType !== BoundaryType.CONVERGENT) {
        console.error(
          `BoundaryEdge has dominance=${dominance} but refinedType=${bEdge.refinedType}. ` +
          `Dominance is only relevant for CONVERGENT boundaries.`
        );
        continue;
      }

      // Only draw for convergent boundaries with determined dominance
      if (bEdge.refinedType !== BoundaryType.CONVERGENT) {
        continue;
      }

      if (dominance !== ConvergentDominance.THIS_SIDE && dominance !== ConvergentDominance.TWIN_SIDE) {
        continue;
      }

      // Use the boundary color for this edge type
      const color = BOUNDARY_COLORS[bEdge.refinedType];

      const he = bEdge.halfedge;
      const vStart = he.vertex.position;
      const vEnd = he.twin.vertex.position;

      // Compute edge length and derive triangle size
      const edgeLength = vStart.distanceTo(vEnd);
      const halfBase = (edgeLength * baseFraction) * 0.5;
      const height = halfBase * 1.732; // sqrt(3) for equilateral triangle

      // Edge midpoint (on sphere surface)
      const midpoint = new THREE.Vector3()
        .addVectors(vStart, vEnd)
        .multiplyScalar(0.5)
        .normalize();

      // Edge direction (tangent to sphere at midpoint)
      const edgeDir = new THREE.Vector3()
        .subVectors(vEnd, vStart)
        .sub(midpoint.clone().multiplyScalar(new THREE.Vector3().subVectors(vEnd, vStart).dot(midpoint)))
        .normalize();

      // Normal direction: perpendicular to edge, in tangent plane
      // Points from the halfedge's tile side toward the twin's tile side
      const normalDir = new THREE.Vector3().crossVectors(midpoint, edgeDir).normalize();

      // Determine which direction the triangle should point
      // If THIS_SIDE is dominant, triangle points toward this side (opposite of normalDir)
      // If TWIN_SIDE is dominant, triangle points toward twin side (same as normalDir)
      const pointDirection = dominance === ConvergentDominance.TWIN_SIDE
        ? normalDir.clone()
        : normalDir.clone().negate();

      // Compute triangle vertices on sphere surface
      // Base vertices: midpoint ± halfBase along edge direction
      const baseLeft = midpoint.clone()
        .add(edgeDir.clone().multiplyScalar(-halfBase))
        .normalize()
        .multiplyScalar(1 + offsetFactor);

      const baseRight = midpoint.clone()
        .add(edgeDir.clone().multiplyScalar(halfBase))
        .normalize()
        .multiplyScalar(1 + offsetFactor);

      // Apex: midpoint + height in point direction
      const apex = midpoint.clone()
        .add(pointDirection.clone().multiplyScalar(height))
        .normalize()
        .multiplyScalar(1 + offsetFactor);

      // Draw triangle as three line segments
      // Base: left to right
      positions.push(baseLeft.x, baseLeft.y, baseLeft.z);
      positions.push(baseRight.x, baseRight.y, baseRight.z);
      colors.push(color[0], color[1], color[2]);
      colors.push(color[0], color[1], color[2]);

      // Left side: left to apex
      positions.push(baseLeft.x, baseLeft.y, baseLeft.z);
      positions.push(apex.x, apex.y, apex.z);
      colors.push(color[0], color[1], color[2]);
      colors.push(color[0], color[1], color[2]);

      // Right side: right to apex
      positions.push(baseRight.x, baseRight.y, baseRight.z);
      positions.push(apex.x, apex.y, apex.z);
      colors.push(color[0], color[1], color[2]);
      colors.push(color[0], color[1], color[2]);
    }
  }

  lines.geometry.dispose();
  lines.geometry = new LineSegmentsGeometry();
  lines.geometry.setPositions(positions);
  lines.geometry.setColors(colors);
  lines.computeLineDistances();
}

/**
 * Creates line segments for all boundaries with gradient coloring along each boundary.
 * Each boundary is colored with a cyan-to-magenta gradient from one end to the other.
 * @param tectonicSystem The tectonic system containing all boundaries
 * @param lines The LineSegments2 object to populate
 */
function makeLineSegments2ForAllBoundariesGradient(
  tectonicSystem: TectonicSystem,
  lines: LineSegments2
): void {
  const positions = new Array<number>();
  const colors = new Array<number>();

  const offsetFactor = 0.001;

  // Gradient colors: start (cyan) to end (magenta)
  const startColor = [0, 1, 1]; // Cyan
  const endColor = [1, 0, 1];   // Magenta

  for (const boundary of tectonicSystem.boundaries) {
    // Collect edges in order for this boundary
    const orderedEdges: BoundaryEdge[] = [];
    for (const edge of boundary.iterateEdges()) {
      orderedEdges.push(edge);
    }

    const totalEdges = orderedEdges.length;
    if (totalEdges === 0) continue;

    for (let i = 0; i < orderedEdges.length; i++) {
      const bEdge = orderedEdges[i];
      const t = totalEdges > 1 ? i / (totalEdges - 1) : 0;

      const vStart = bEdge.halfedge.vertex.position.clone();
      const vEnd = bEdge.halfedge.next.vertex.position.clone();

      vStart.multiplyScalar(1 + offsetFactor);
      vEnd.multiplyScalar(1 + offsetFactor);

      positions.push(vStart.x, vStart.y, vStart.z);
      positions.push(vEnd.x, vEnd.y, vEnd.z);

      // Interpolate color
      const r = startColor[0] + t * (endColor[0] - startColor[0]);
      const g = startColor[1] + t * (endColor[1] - startColor[1]);
      const b = startColor[2] + t * (endColor[2] - startColor[2]);

      colors.push(r, g, b);
      colors.push(r, g, b);
    }
  }

  lines.geometry.dispose();
  lines.geometry = new LineSegmentsGeometry();
  lines.geometry.setPositions(positions);
  lines.geometry.setColors(colors);
  lines.computeLineDistances();
}

/**
 * Configuration for transform slide indicators.
 * All distances are in kilometers.
 */
const TRANSFORM_SLIDE_CONFIG = {
  // Distance interval between arrows (in km)
  ARROW_INTERVAL_KM: 700,
  // Arrow length (in km)
  ARROW_LENGTH_KM: 100,
  // Lateral offset from boundary center (in km)
  LATERAL_OFFSET_KM: 30,
  // Vertical offset to render above boundary lines (in km)
  VERTICAL_OFFSET_KM: 6,
  // Arrow head size as fraction of arrow length
  ARROW_HEAD_FRACTION: 0.3,
};

/**
 * Represents a group of consecutive transform edges for arrow placement.
 */
interface TransformEdgeGroup {
  edges: BoundaryEdge[];
  centerPosition: THREE.Vector3;
  edgeDirection: THREE.Vector3;
  normalDirection: THREE.Vector3;
  thisSideSlide: TransformSlide;
  twinSideSlide: TransformSlide;
}

/**
 * Collects transform edges from a boundary into groups based on distance intervals.
 * Each group spans approximately ARROW_INTERVAL_KM and is used to place one pair of arrows.
 */
function collectTransformEdgeGroups(boundary: PlateBoundary): TransformEdgeGroup[] {
  const groups: TransformEdgeGroup[] = [];
  const intervalDistance = kmToDistance(TRANSFORM_SLIDE_CONFIG.ARROW_INTERVAL_KM);

  let currentGroup: BoundaryEdge[] = [];
  let accumulatedDistance = 0;
  let groupStartPos: THREE.Vector3 | null = null;

  for (const bEdge of boundary.iterateEdges()) {
    // Check if this is a transform edge with valid slide data
    if (bEdge.refinedType !== BoundaryType.TRANSFORM ||
        bEdge.thisSideSlide === TransformSlide.NOT_APPLICABLE ||
        bEdge.thisSideSlide === TransformSlide.UNDETERMINED) {
      // Non-transform edge: finalize current group if any
      if (currentGroup.length > 0) {
        const group = finalizeEdgeGroup(currentGroup);
        if (group) groups.push(group);
        currentGroup = [];
        accumulatedDistance = 0;
        groupStartPos = null;
      }
      continue;
    }

    // Add edge to current group
    currentGroup.push(bEdge);

    // Track starting position for the group
    if (!groupStartPos) {
      groupStartPos = bEdge.halfedge.vertex.position.clone();
    }

    // Accumulate edge length
    const he = bEdge.halfedge;
    const edgeLength = he.vertex.position.distanceTo(he.twin.vertex.position);
    accumulatedDistance += edgeLength;

    // Check if we've reached the interval threshold
    if (accumulatedDistance >= intervalDistance) {
      const group = finalizeEdgeGroup(currentGroup);
      if (group) groups.push(group);
      currentGroup = [];
      accumulatedDistance = 0;
      groupStartPos = null;
    }
  }

  // Finalize any remaining edges
  if (currentGroup.length > 0) {
    const group = finalizeEdgeGroup(currentGroup);
    if (group) groups.push(group);
  }

  return groups;
}

/**
 * Creates a TransformEdgeGroup from a list of consecutive transform edges.
 * Computes the center position, average direction, and dominant slide directions.
 */
function finalizeEdgeGroup(edges: BoundaryEdge[]): TransformEdgeGroup | null {
  if (edges.length === 0) return null;

  // Compute center position (average of all edge midpoints)
  const centerPosition = new THREE.Vector3();
  const avgEdgeDirection = new THREE.Vector3();

  // Count slide directions to determine dominant
  let thisSideForwardCount = 0;
  let twinSideForwardCount = 0;

  for (const bEdge of edges) {
    const he = bEdge.halfedge;
    const vStart = he.vertex.position;
    const vEnd = he.twin.vertex.position;

    // Add midpoint to center
    const midpoint = new THREE.Vector3().addVectors(vStart, vEnd).multiplyScalar(0.5);
    centerPosition.add(midpoint);

    // Add edge direction (normalized at the end)
    const edgeVec = new THREE.Vector3().subVectors(vEnd, vStart);
    avgEdgeDirection.add(edgeVec);

    // Count slide directions
    if (bEdge.thisSideSlide === TransformSlide.FORWARD) {
      thisSideForwardCount++;
    }
    if (bEdge.twinSideSlide === TransformSlide.FORWARD) {
      twinSideForwardCount++;
    }
  }

  // Average and normalize center position (project to sphere surface)
  centerPosition.divideScalar(edges.length).normalize();

  // Project average edge direction onto tangent plane at center and normalize
  const edgeDirection = avgEdgeDirection.clone()
    .sub(centerPosition.clone().multiplyScalar(avgEdgeDirection.dot(centerPosition)))
    .normalize();

  // Compute normal direction (perpendicular to edge, in tangent plane)
  const normalDirection = new THREE.Vector3().crossVectors(centerPosition, edgeDirection).normalize();

  // Determine dominant slide direction (majority vote)
  const halfCount = edges.length / 2;
  const thisSideSlide = thisSideForwardCount > halfCount ? TransformSlide.FORWARD : TransformSlide.BACKWARD;
  const twinSideSlide = twinSideForwardCount > halfCount ? TransformSlide.FORWARD : TransformSlide.BACKWARD;

  return {
    edges,
    centerPosition,
    edgeDirection,
    normalDirection,
    thisSideSlide,
    twinSideSlide,
  };
}

/**
 * Creates line segments for transform boundary slide indicators.
 * Groups consecutive transform edges by distance intervals and draws one pair of
 * arrows per group, reducing visual clutter at high resolutions.
 *
 * Each group of edges (spanning ~500km by default) gets:
 * - One arrow on each side of the boundary, offset perpendicular to it
 * - Each arrow points in the dominant slide direction for that side
 *
 * @param tectonicSystem The tectonic system containing boundary info
 * @param lines The LineSegments2 object to populate
 */
function makeLineSegments2ForTransformSlideIndicators(
  tectonicSystem: TectonicSystem,
  lines: LineSegments2
): void {
  const positions = new Array<number>();
  const colors = new Array<number>();

  const arrowLength = kmToDistance(TRANSFORM_SLIDE_CONFIG.ARROW_LENGTH_KM);
  const headLength = arrowLength * TRANSFORM_SLIDE_CONFIG.ARROW_HEAD_FRACTION;
  const lateralOffset = kmToDistance(TRANSFORM_SLIDE_CONFIG.LATERAL_OFFSET_KM);
  const verticalOffset = kmToDistance(TRANSFORM_SLIDE_CONFIG.VERTICAL_OFFSET_KM);

  const color = BOUNDARY_COLORS[BoundaryType.TRANSFORM];

  // Helper function to draw an arrow at a position
  const drawArrow = (
    center: THREE.Vector3,
    direction: THREE.Vector3,
    slideDirection: TransformSlide,
    offsetDirection: THREE.Vector3
  ) => {
    // Offset the arrow center perpendicular to boundary
    const arrowCenter = center.clone()
      .add(offsetDirection.clone().multiplyScalar(lateralOffset))
      .normalize()
      .multiplyScalar(1 + verticalOffset);

    // Arrow direction based on slide
    const arrowDir = slideDirection === TransformSlide.FORWARD
      ? direction.clone()
      : direction.clone().negate();

    // Arrow start and end points
    const arrowStart = arrowCenter.clone()
      .add(arrowDir.clone().multiplyScalar(-arrowLength / 2))
      .normalize()
      .multiplyScalar(1 + verticalOffset);

    const arrowEnd = arrowCenter.clone()
      .add(arrowDir.clone().multiplyScalar(arrowLength / 2))
      .normalize()
      .multiplyScalar(1 + verticalOffset);

    // Draw arrow shaft
    positions.push(arrowStart.x, arrowStart.y, arrowStart.z);
    positions.push(arrowEnd.x, arrowEnd.y, arrowEnd.z);
    colors.push(color[0], color[1], color[2]);
    colors.push(color[0], color[1], color[2]);

    // Draw arrow head (two lines forming a V)
    const headBase = arrowEnd.clone()
      .add(arrowDir.clone().multiplyScalar(-headLength))
      .normalize()
      .multiplyScalar(1 + verticalOffset);

    // Perpendicular direction for arrow head wings
    const wingDir = new THREE.Vector3().crossVectors(arrowCenter.clone().normalize(), arrowDir).normalize();
    const wingSize = headLength * 0.5;

    const wing1 = headBase.clone()
      .add(wingDir.clone().multiplyScalar(wingSize))
      .normalize()
      .multiplyScalar(1 + verticalOffset);

    const wing2 = headBase.clone()
      .add(wingDir.clone().multiplyScalar(-wingSize))
      .normalize()
      .multiplyScalar(1 + verticalOffset);

    // Head line 1: wing1 to tip
    positions.push(wing1.x, wing1.y, wing1.z);
    positions.push(arrowEnd.x, arrowEnd.y, arrowEnd.z);
    colors.push(color[0], color[1], color[2]);
    colors.push(color[0], color[1], color[2]);

    // Head line 2: wing2 to tip
    positions.push(wing2.x, wing2.y, wing2.z);
    positions.push(arrowEnd.x, arrowEnd.y, arrowEnd.z);
    colors.push(color[0], color[1], color[2]);
    colors.push(color[0], color[1], color[2]);
  };

  // Process each boundary
  for (const boundary of tectonicSystem.boundaries) {
    // Collect transform edge groups for this boundary
    const groups = collectTransformEdgeGroups(boundary);

    // Draw arrows for each group
    for (const group of groups) {
      // Draw arrow for this side (offset opposite of normalDir)
      drawArrow(
        group.centerPosition,
        group.edgeDirection,
        group.thisSideSlide,
        group.normalDirection.clone().negate()
      );

      // Draw arrow for twin side (offset along normalDir)
      drawArrow(
        group.centerPosition,
        group.edgeDirection,
        group.twinSideSlide,
        group.normalDirection
      );
    }
  }

  lines.geometry.dispose();
  lines.geometry = new LineSegmentsGeometry();
  lines.geometry.setPositions(positions);
  lines.geometry.setColors(colors);
  lines.computeLineDistances();
}

export {
  makeLineSegments2FromTile,
  makeLineSegments2FromPlate,
  makeLineSegments2FromBoundary,
  makeLineSegments2ForTileMotionVec,
  makeLineSegments2FromBoundaryGradient,
  makeLineSegments2ForAllBoundaries,
  makeLineSegments2ForAllBoundariesByType,
  makeLineSegments2ForAllBoundariesGradient,
  makeLineSegments2ForNeighborTilesInPlate,
  makeLineSegments2ForDominanceIndicators,
  makeLineSegments2ForTransformSlideIndicators
};
