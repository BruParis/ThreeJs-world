import * as THREE from 'three';
import { HalfedgeGraph } from './HalfedgeGraph';
import { Halfedge } from './Halfedge';
import { Vertex } from './Vertex';
import BiMap from 'bidirectional-map';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';

function makeBufferGeometryFromHalfedgeGraph(halfedgeGraph: HalfedgeGraph, indexed: boolean = false): THREE.BufferGeometry {
  // const verticesIndices = new Array<number>();
  const vertices = new Array<number>();
  const face2HalfedgesMap = new BiMap();

  // Do not use loops, the haldegdes indices
  // in the array halfedgeGraph.halfedges are 
  // needed for face2HalfedgesIdMap
  // const loops = halfedgeGraph.loops();

  const handled = new Set<string>();
  for (const halfedge of halfedgeGraph.halfedges.values()) {

    if (handled.has(halfedge.id)) {
      continue;
    }

    for (const he of halfedge.nextLoop()) {
      handled.add(he.id);

      const v = he.vertex.position;
      // verticesIndices.push(vertices.length / 3);
      vertices.push(v.x, v.y, v.z);
    }

    let faceIndex = face2HalfedgesMap.size;
    face2HalfedgesMap.set(faceIndex.toString(), halfedge);

    faceIndex++;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));

  if (indexed) {
    const verticesIndices = Array.from({ length: vertices.length / 3 }, (_, i) => i);
    geometry.setIndex(verticesIndices);
  }

  geometry.userData.face2HalfedgesMap = face2HalfedgesMap;

  return geometry;
}

function makeBufferGeometryFromLoops(halfedgeGraph: HalfedgeGraph, indexed: boolean = false): THREE.BufferGeometry {

  const vertices = new Array<number>();
  const face2HalfedgeMap = new Map<number, string>();
  const halfedge2FaceMap = new Map<string, number>();

  const processedHeSet = new Set<string>();

  for (const he of halfedgeGraph.halfedges.values()) {
    if (processedHeSet.has(he.id)) {
      continue;
    }

    // Collect all the halfedges from the face
    const faceHalfedges = new Array<Halfedge>();
    for (const auxHe of he.nextLoop()) {
      faceHalfedges.push(auxHe);
      processedHeSet.add(auxHe.id);
    }

    // Compute Face Centroid
    const facePositions = new Array<THREE.Vector3>();
    for (const faceHe of faceHalfedges) {
      facePositions.push(faceHe.vertex.position);
    }

    const numVertices = facePositions.length;
    const faceCentroid = facePositions.reduce(
      (acc, pos) => acc.add(pos), new THREE.Vector3(0, 0, 0)
    ).multiplyScalar(1 / numVertices);

    for (let i = 0; i < faceHalfedges.length; i++) {
      const auxHe = faceHalfedges[i];

      const vA = auxHe.vertex.position;
      const vB = auxHe.next.vertex.position;

      // Triangle vA, vB, faceCentroid
      // -> to make a clockwise face: vA, faceCentroid, vB
      vertices.push(
        vA.x, vA.y, vA.z,
        faceCentroid.x, faceCentroid.y, faceCentroid.z,
        vB.x, vB.y, vB.z,
      );

      let faceIndex = face2HalfedgeMap.size;
      face2HalfedgeMap.set(faceIndex, auxHe.id);
      halfedge2FaceMap.set(auxHe.id, faceIndex);
    }

  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));

  if (indexed) {
    const verticesIndices = Array.from({ length: vertices.length / 3 }, (_, i) => i);
    geometry.setIndex(verticesIndices);
  }

  geometry.userData.face2HalfedgeMap = face2HalfedgeMap;
  geometry.userData.halfedge2FaceMap = halfedge2FaceMap;

  return geometry;
}

function makeLineSegments2FromHalfedgeGraph(halfedgeGraph: HalfedgeGraph, lines: LineSegments2) {

  const processedHalfedgesSet = new Set<string>();

  const positions = new Array<number>();
  const colors = new Array<number>();

  for (const he of halfedgeGraph.halfedges.values()) {

    if (processedHalfedgesSet.has(he.id) || processedHalfedgesSet.has(he.twin.id)) {
      continue;
    }

    const posA = he.vertex.position;
    const posB = he.twin.vertex.position;

    positions.push(
      posA.x, posA.y, posA.z,
      posB.x, posB.y, posB.z,
    );

    const colorA = new THREE.Color(0xffa500);
    const colorB = new THREE.Color(0xffa500);

    colors.push(
      colorA.r, colorA.g, colorA.b,
      colorB.r, colorB.g, colorB.b,
    );

    processedHalfedgesSet.add(he.id);
  }

  lines.geometry.dispose();
  lines.geometry = new LineSegmentsGeometry();
  lines.geometry.setPositions(positions);
  lines.geometry.setColors(colors);
  lines.computeLineDistances();
}

function validForDistortion(he: Halfedge, initialIcoVerticesIds: Map<number, number>): boolean {
  /* 
   *            vB
   *         ↗     ↘ 
   *       ↗         ↘
   *     ↗             ↘
   *     <-------------- vC
   *  vA --------------->
   *      ↖           ↙
   *        ↖       ↙
   *          ↖   ↙
   *            vD 
   */

  const vertexA = he.vertex;
  const vertexC = he.twin.vertex;

  const vertexB = he.prev.vertex;
  const vertexD = he.twin.prev.vertex;


  // 1) The resulting dual graph should have only
  // pentagons, hexagons, and heptagons.


  // The initial graph is an icosahedron-based triangulation,
  // all the initial vertices have 5 egdes, (all other vertices have 6 edges).
  // In distort graph, if an edge is flipped, all the vertices edge count
  // will be updated and stored in initialIcoVerticesIds map.
  // Therefor, the default value for a vertex not in the map is 6 edges.
  // (not an initial icosahedron vertex, and has not been affected by any flip yet
  // -> still has 6 edges).
  const numEdgesA = initialIcoVerticesIds.get(vertexA.id) || 6;
  const numEdgesB = initialIcoVerticesIds.get(vertexB.id) || 6;
  const numEdgesC = initialIcoVerticesIds.get(vertexC.id) || 6;
  const numEdgesD = initialIcoVerticesIds.get(vertexD.id) || 6;

  // countEdges makes a whole loop around the vertex
  // it is more efficient to just keep track of the number of edges
  // The dual faces centered on vertexA and vertexC
  // will loose one edge each
  // -> check there are least(excl.) 6 edges for each vertex
  // Keep these calls to countEdges for reference
  // const numEdgesA = vertexA.countEdges();
  // const numEdgesC = vertexC.countEdges();

  // The dual faces centered on vertexB and vertexD
  // will gain one edge each
  // -> check there are at most(excl.) 6 edges for each vertex
  // const numEdgesB = vertexB.countEdges();
  // const numEdgesD = vertexD.countEdges();

  if (numEdgesA < 6 || numEdgesC < 6) {
    return false;
  }

  if (numEdgesB > 6 || numEdgesD > 6) {
    return false;
  }

  // 2) Check that the angles formed
  // by DAB and BCD are < 180 degrees
  const vecAD = new THREE.Vector3().subVectors(
    vertexD.position,
    vertexA.position,
  ).normalize();
  const vecAB = new THREE.Vector3().subVectors(
    vertexB.position,
    vertexA.position,
  ).normalize();
  const angleDABDeg = vecAD.angleTo(vecAB) * (180 / Math.PI);

  const vecCB = new THREE.Vector3().subVectors(
    vertexB.position,
    vertexC.position,
  ).normalize();
  const vecCD = new THREE.Vector3().subVectors(
    vertexD.position,
    vertexC.position,
  ).normalize();
  const angleBCDDeg = vecCB.angleTo(vecCD) * (180 / Math.PI);

  // Real constraint would be < 180 degrees, but take some margin
  // -> 120 degrees
  if (angleDABDeg >= 120 || angleBCDDeg >= 120) {
    return false;
  }

  return true;
}

function relaxEdge(he: Halfedge) {
  const vertexA = he.vertex;
  const vertexC = he.twin.vertex;

  const vertexB = he.prev.vertex;
  const vertexD = he.twin.prev.vertex;

  const distBD = new THREE.Vector3().subVectors(
    vertexB.position,
    vertexD.position,
  ).length();

  const midpointAC = new THREE.Vector3().addVectors(
    vertexA.position,
    vertexC.position,
  ).multiplyScalar(0.5);

  const unitAC = new THREE.Vector3().subVectors(
    vertexC.position,
    vertexA.position,
  ).normalize();

  const newPosA = new THREE.Vector3().addVectors(
    midpointAC,
    unitAC.clone().multiplyScalar(-0.5 * distBD),
  );

  const newPosC = new THREE.Vector3().addVectors(
    midpointAC,
    unitAC.clone().multiplyScalar(0.5 * distBD),
  );

  //use lerp as they .position is readonly
  vertexA.position.lerp(newPosA, 1.0);
  vertexC.position.lerp(newPosC, 1.0);
}

function relaxGraph(halfedgeGraph: HalfedgeGraph, shiftDampening: number = 0.7) {
  // console.log("Relaxing graph...");
  const totalSurfaceArea = 4 * Math.PI; // unit sphere
  const idealFaceArea = totalSurfaceArea / halfedgeGraph.faces.size;
  const idealEdgeLength = Math.sqrt(idealFaceArea * (4 / Math.sqrt(3)));
  const idealDistToCentroid = idealEdgeLength / Math.sqrt(3);
  // console.log("idealDistToCentroid: ", idealDistToCentroid);

  const verticesPosShift = new Map<number, THREE.Vector3>();
  const verticesCount = new Map<number, number>();

  const distDiffArray = new Array<number>();

  for (const vertex of halfedgeGraph.vertices.values()) {
    verticesPosShift.set(vertex.id, new THREE.Vector3(0, 0, 0));
  }

  const processedEdgesSet = new Set<string>();

  for (const he of halfedgeGraph.halfedges.values()) {
    if (processedEdgesSet.has(he.id)) {
      continue;
    }

    let auxHe = he;

    // store all the halfedges ids as processed
    for (const auxHe of he.nextLoop()) {
      processedEdgesSet.add(auxHe.id);
    }

    auxHe = he;

    // Loop around the face, collect the positons to compute centroid
    const facePositions = new Array<THREE.Vector3>();
    for (const auxHe of he.nextLoop()) {
      facePositions.push(auxHe.vertex.position);
    }

    const faceCentroid = facePositions.reduce(
      (acc, pos) => acc.add(pos), new THREE.Vector3(0, 0, 0)
    ).multiplyScalar(1 / facePositions.length);
    faceCentroid.normalize(); // project to unit sphere

    auxHe = he;

    // Loop again to compute position shifts
    for (const auxHe of he.nextLoop()) {
      const vertex = auxHe.vertex;

      const dirToCentroid = new THREE.Vector3().subVectors(
        faceCentroid,
        vertex.position,
      ).normalize();

      const currentDistToCentroid = vertex.position.distanceTo(faceCentroid);
      // const distDiff = idealDistToCentroid - currentDistToCentroid;
      const distDiff = currentDistToCentroid - idealDistToCentroid;
      distDiffArray.push(distDiff);

      const posShift = verticesPosShift.get(vertex.id);
      if (!posShift) {
        console.error("No posShift found for vertex id ", vertex.id);
        continue;
      }

      const currentCount = verticesCount.get(vertex.id) || 0;
      verticesCount.set(vertex.id, currentCount + 1);

      const newShift = dirToCentroid.multiplyScalar(distDiff);

      posShift.add(newShift);
    }

  }


  // apply position shifts
  for (const vertex of halfedgeGraph.vertices.values()) {
    let posShift = verticesPosShift.get(vertex.id);

    if (!posShift) {
      console.error("No posShift found for vertex id ", vertex.id);
      continue;
    }

    const vCount = verticesCount.get(vertex.id) || 0;

    posShift = posShift.multiplyScalar(shiftDampening / vCount);
    vertex.position.add(posShift);

  }

  // Compute  mean and stddev of distDiffArray
  // const mean = distDiffArray.reduce((acc, val) => acc + val, 0) / distDiffArray.length;
  // const variance = distDiffArray.reduce((acc, val) => acc + (val - mean) ** 2, 0) / distDiffArray.length;
  // console.log("Relaxation mean distDiff: ", mean);
  // console.log("Relaxation stddev distDiff: ", Math.sqrt(variance));
}

function updateVertexEdgeCountMapForFlip(he: Halfedge, initialIcoVerticesIds: Map<number, number>) {
  /* 
   *            vB
   *         ↗  |^ ↘ 
   *       ↗    ||   ↘
   *     ↗      ||     ↘
   *     <-X-X-X||-X-X-X vC
   *  vA -X-heX-||X-X-X->
   *      ↖     ||    ↙
   *        ↖   ||  ↙
   *          ↖ V|↙
   *            vD 
   */

  // After the flip of edge he:
  // Va, Vc loses one edge
  // Vb, Vd gains one edge

  const vertexA = he.vertex;
  const vertexC = he.twin.vertex;
  const vertexD = he.prev.vertex;
  const vertexB = he.twin.prev.vertex;

  const oldNumEdgesA = initialIcoVerticesIds.get(vertexA.id) || 6;
  const oldNumEdgesB = initialIcoVerticesIds.get(vertexB.id) || 6;
  const oldNumEdgesC = initialIcoVerticesIds.get(vertexC.id) || 6;
  const oldNumEdgesD = initialIcoVerticesIds.get(vertexD.id) || 6;

  initialIcoVerticesIds.set(vertexA.id, oldNumEdgesA - 1);
  initialIcoVerticesIds.set(vertexC.id, oldNumEdgesC - 1);
  initialIcoVerticesIds.set(vertexB.id, oldNumEdgesB + 1);
  initialIcoVerticesIds.set(vertexD.id, oldNumEdgesD + 1);
}


function distortGraph(halfedgeGraph: HalfedgeGraph, initialIcoVerticesIds: Map<number, number>, probability: number = 1.0) {

  const initKeys = Array.from(halfedgeGraph.halfedges.keys());
  for (const key of initKeys) {

    let he = halfedgeGraph.halfedges.get(key);
    if (!he) {
      continue;
    }

    if (Math.random() > probability) {
      continue;
    }

    if (!validForDistortion(he, initialIcoVerticesIds)) {
      continue;
    }

    // update the vertices edge count map
    updateVertexEdgeCountMapForFlip(he, initialIcoVerticesIds);

    const newHe = halfedgeGraph.flipEdge(he);

    if (!newHe) {
      console.warn("Could not flip halfedge during distortion.");
      continue;
    }

    relaxEdge(newHe);
  }

  relaxGraph(halfedgeGraph);
  normalizeVertices(halfedgeGraph);

  // for (const _ of Array(5)) {
  //   relaxGraph(halfedgeGraph);
  //   normalizeVertices(halfedgeGraph);
  // }

}

export class FaceDistribution {
  pentagons: number;
  hexagons: number;
  heptagons: number;

  constructor(pentagons: number, hexagons: number, heptagons: number) {
    this.pentagons = pentagons;
    this.hexagons = hexagons;
    this.heptagons = heptagons;
  }
}

function makeFaceDistribution(halfedgeGraph: HalfedgeGraph): FaceDistribution {

  const faceDistMap = new Map<number, number>();
  const processedHeSet = new Set<string>();

  for (const he of halfedgeGraph.halfedges.values()) {
    if (processedHeSet.has(he.id) || processedHeSet.has(he.twin.id)) {
      continue;
    }

    let count = 0;
    for (const auxHe of he.nextLoop()) {
      count++;
      processedHeSet.add(auxHe.id);
    }

    const currentCount = faceDistMap.get(count) || 0;
    faceDistMap.set(count, currentCount + 1);

    processedHeSet.add(he.id);
  }

  // format to pentagons: hexagons: heptagons
  let facesDistrib = {
    5: 0,
    6: 0,
    7: 0,
  };

  for (const [k, v] of faceDistMap.entries()) {
    console.log(`Faces with ${k} edges: ${v}`);

    if (k === 5 || k === 6 || k === 7) {
      facesDistrib[k as 5 | 6 | 7] = v;
    }
    else {
      console.warn(`Face with ${k} edges found, not counted in distribution.`);
    }
  }

  console.log("facesDistrib: ", facesDistrib);

  const result = new FaceDistribution(
    facesDistrib[5],
    facesDistrib[6],
    facesDistrib[7],
  );

  return result;
}

function distortGraphLoop(halfedgeGraph: HalfedgeGraph, verticesEdgeCountIdMap: Map<number, number>, iterations: number = 1, probability: number = 0.1) {

  for (let i = 0; i < iterations; i++) {
    console.log("Distortion iteration ", i + 1);
    distortGraph(halfedgeGraph, verticesEdgeCountIdMap, probability);
  }
}


function removeAllFaces(halfedgeDS: HalfedgeGraph) {
  const faces = [...halfedgeDS.faces];
  console.log("BEFORE ", halfedgeDS);
  for (const face of faces) {
    halfedgeDS.removeFace(face);
  }

  console.log("AFTER ", halfedgeDS);
}

function subdivideTrianglesHalfedgeGraph(halfedgeGraph: HalfedgeGraph) {
  const start_time = performance.now();
  // From Charles Looper's "Smooth Subdivision Surfaces Based on Triangles"
  // found on https://github.com/cmu462/Scotty3D/wiki/Loop-Subdivision

  const oldLoops = halfedgeGraph.loops();
  const oldLoopsFirstHe = new Array<Halfedge>();
  for (const he of oldLoops) {
    oldLoopsFirstHe.push(he);
  }

  // 1a) Split each edge with new vertices mid-points (in arbitrary order)
  // while storing the old edges ids
  const processedHeSet = new Set<string>();
  const newVerticesIdSet = new Set<number>();

  const initKeys = Array.from(halfedgeGraph.halfedges.keys());
  for (const key of initKeys) {
    let he = halfedgeGraph.halfedges.get(key);
    if (!he) {
      continue;
    }

    const alreadyProcessed = processedHeSet.has(he.id);
    const twinAlreadyProcessed = processedHeSet.has(he.twin.id);
    if (alreadyProcessed || twinAlreadyProcessed) {
      continue;
    }

    const vertexA = he.vertex;
    const vertexB = he.twin.vertex;

    const midPoint = new THREE.Vector3().addVectors(
      vertexA.position,
      vertexB.position,
    ).multiplyScalar(0.5);

    const newVertex = halfedgeGraph.splitEdge(he, midPoint);

    newVerticesIdSet.add(newVertex.id);

    processedHeSet.add(he.id);
  }

  const newHeOldAndNewVertexSet = new Set<Halfedge>();

  // 1b) For every face, loop
  for (const oldHe of oldLoopsFirstHe) {

    let he = oldHe;

    // Depending on how the oldHe (or its twin!) was split,
    // the oldHe can be now starting from an original vertex 
    // or from a new midpoint vertex.
    // -> set he to start from an original vertex
    while (newVerticesIdSet.has(he.vertex.id)) {
      he = he.next;
      if (he === oldHe) {
        console.error("Error: face has all new vertices after edge splits!");
        return;
      }
    }

    // Collect all the halfedges from the old face: 
    // 3 original edges ->2 for each split -> 6 halfedges,
    // alternatively starting from an original/new vertex.
    // With the above loop, this array starts from an original vertex
    const faceHalfegdes = new Array<Halfedge>();
    for (const auxHe of he.nextLoop()) {
      faceHalfegdes.push(auxHe);
    }

    if (faceHalfegdes.length !== 6) {
      console.error("Error: after edge splits, face does not have 6 halfedges!");
      continue;
    }

    const heA1 = faceHalfegdes[0];
    const heA2 = faceHalfegdes[1];
    const heB1 = faceHalfegdes[2];
    const heB2 = faceHalfegdes[3];
    const heC1 = faceHalfegdes[4];
    const heC2 = faceHalfegdes[5];

    const vO = heC1.vertex; // an original vertex (not a new midpoint)
    const vA = heA2.vertex; // new vertex on edge OA
    const vB = heB2.vertex; // new vertex on edge OB
    const vC = heC2.vertex; // new vertex on edge OC

    // Remove the old face
    halfedgeGraph.removeFace(oldHe.face!);

    // Add the 3 new edges: vA-vB, vA-vC, vA-originV
    const heAB = halfedgeGraph.addEdge(vA, vB);
    const heAO = halfedgeGraph.addEdge(vA, vO); // connects and old and a new vertex
    const heAC = halfedgeGraph.addEdge(vA, vC);

    newHeOldAndNewVertexSet.add(heAO);

    // Create the 4 new faces made from these 3 new edges inscribed
    // in the old face
    halfedgeGraph.addFace([
      heA2,
      heB1,
      heAB.twin,
    ]);

    halfedgeGraph.addFace([
      heB2,
      heAO.twin,
      heAB,
    ]);

    halfedgeGraph.addFace([
      heC1,
      heAC.twin,
      heAO,
    ]);

    halfedgeGraph.addFace([
      heC2,
      heA1,
      heAC,
    ]);
  }

  const split_time = performance.now();

  // 2) Flip every new edge which touches an old and a new vertex
  console.log("Num new halfedges to flip: ", newHeOldAndNewVertexSet.size);
  for (const he of newHeOldAndNewVertexSet) {
    halfedgeGraph.flipEdge(he);
  }

  const flip_time = performance.now();

  console.log(`Subdivision: split time ${(split_time - start_time).toFixed(2)} ms, flip time ${(flip_time - split_time).toFixed(2)} ms`);
}


function populateDualGraph(halfedgeGraph: HalfedgeGraph, halfedgeDualGraph: HalfedgeGraph): BiMap<string> {
  const halfedge2DualBiMap = new BiMap<string>();
  const halfedgeFacePositionsMap = new Map<string, THREE.Vector3>();
  const halfedge2DualVertexMap = new Map<string, Vertex>();

  halfedgeDualGraph.clear();

  // For all faces halfedges, store the dual vertex at centroid
  const visitedHalfedgesSet = new Set<string>();
  for (const he of halfedgeGraph.halfedges.values()) {
    if (visitedHalfedgesSet.has(he.id)) {
      continue;
    }

    // Collect all the halfedges from the face
    const facePositions = new Array<THREE.Vector3>();
    for (const auxHe of he.nextLoop()) {
      facePositions.push(auxHe.vertex.position);
      visitedHalfedgesSet.add(auxHe.id);
    }

    const numVertices = facePositions.length;
    const centroidPos = facePositions.reduce(
      (acc, pos) => acc.add(pos), new THREE.Vector3(0, 0, 0)
    ).multiplyScalar(1 / numVertices);

    // Create dual vertex at centroid
    const dualVertex = halfedgeDualGraph.addVertex(centroidPos);

    // Store in map the centroid position for all halfedges of this face
    for (const auxHe of he.nextLoop()) {
      halfedgeFacePositionsMap.set(auxHe.id, centroidPos);
      halfedge2DualVertexMap.set(auxHe.id, dualVertex);
    }
  }

  // For all vertices in original graph, loop on all outgoing halfedges
  // Build a new dual halfegde for each original halfedge, using the 
  // previously stored dual vertices at centroids
  const dualLoopsHalfedges = new Array<Array<Halfedge>>();
  const verticesPair2EdgeMap = new Map<string, Halfedge>();
  for (const vertex of halfedgeGraph.vertices.values()) {
    const dualHalfedges = new Array<Halfedge>();

    // Watchout, the clockwise is important here, 
    // so that the dual hafledges are created in a THREE.js 
    // conventional order for faces
    for (const he of vertex.loopCW()) {
      const dualVertexA = halfedge2DualVertexMap.get(he.id);
      const dualVertexB = halfedge2DualVertexMap.get(he.twin.id);

      if (!dualVertexA || !dualVertexB) {
        console.error("No dual vertex found for halfedge id ", he.id, " or its twin.");
        continue;
      }

      const pairKey0 = `${dualVertexA.id}-${dualVertexB.id}`;
      const pairKey1 = `${dualVertexB.id}-${dualVertexA.id}`;

      const edge0 = verticesPair2EdgeMap.get(pairKey0);
      if (edge0) {
        // should not happen
        console.warn("Edge already exists in dual graph for vertex pair ", pairKey0);
        continue;
      }

      const edge1 = verticesPair2EdgeMap.get(pairKey1);
      if (edge1) {
        // This edge was created when its twin cas added
        // -> it needs to be added to the halfedge2DualBiMap
        // and dualHalfedges array
        halfedge2DualBiMap.set(he.id, edge1.twin.id);
        halfedge2DualBiMap.set(he.twin.id, edge1.id);
        
        dualHalfedges.push(edge1.twin);
        continue;
      }

      // Do not check if already connected, as the verticesPair2EdgeMap
      // already tracks this (this inner check in addEdge involves a loop
      // around the vertex, which is inefficient here)
      const dualHalfedge = halfedgeDualGraph.addEdgeUnsafe(dualVertexA, dualVertexB);

      halfedge2DualBiMap.set(he.id, dualHalfedge.id);
      halfedge2DualBiMap.set(he.twin.id, dualHalfedge.twin.id);

      dualHalfedges.push(dualHalfedge);

      verticesPair2EdgeMap.set(pairKey0, dualHalfedge);
    }
    dualLoopsHalfedges.push(dualHalfedges);

  }

  // Re-Connect all dual halfedge loops properly
  // (addEdge does not necessary make the adequate connections 
  // when creating loop-closing halfedges)
  for (const dualHalfedges of dualLoopsHalfedges) {
    const numHalfedges = dualHalfedges.length;
    for (let i = 0; i < numHalfedges; i++) {
      const he = dualHalfedges[i];
      const heNext = dualHalfedges[(i + 1) % numHalfedges];
      const hePrev = dualHalfedges[(i - 1 + numHalfedges) % numHalfedges];

      he.next = heNext;
      hePrev.next = he;

      heNext.prev = he;
      he.prev = hePrev;
    }
  }

  return halfedge2DualBiMap;
}

function collectOriginalVertices(halfedgeGraph: HalfedgeGraph): Set<number> {
  const originalVerticesSet: Set<number> = new Set<number>();

  for (const vertex of halfedgeGraph.vertices.values()) {
    originalVerticesSet.add(vertex.id);
  }

  return originalVerticesSet;
}

function subdivideTrianglesLoop(halfedgeGraph: HalfedgeGraph, degree: number = 1) {
  for (let i = 0; i < degree; i++) {
    subdivideTrianglesHalfedgeGraph(halfedgeGraph);
  }
}

function normalizeVertices(halfedgeGraph: HalfedgeGraph) {
  for (const vertex of halfedgeGraph.vertices.values()) {
    vertex.position.normalize();
  }
}

export {
  makeBufferGeometryFromHalfedgeGraph,
  makeBufferGeometryFromLoops,
  collectOriginalVertices,
  subdivideTrianglesLoop,
  removeAllFaces,
  normalizeVertices,
  populateDualGraph,
  makeLineSegments2FromHalfedgeGraph,
  distortGraph,
  distortGraphLoop,
  makeFaceDistribution
};
