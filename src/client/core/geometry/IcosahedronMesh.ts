import * as THREE from 'three';
import { HalfedgeGraph } from '@core/HalfedgeGraph';

function populateIcosahedronHalfedgeGraph(halfedgeGraph: HalfedgeGraph) {
  var phi = (1.0 + Math.sqrt(5.0)) / 2.0;
  var du = 1.0 / Math.sqrt(phi * phi + 1.0);
  var dv = phi * du;

  halfedgeGraph.clear();

  const points =
    [
      new THREE.Vector3(0, +dv, +du),
      new THREE.Vector3(0, +dv, -du),
      new THREE.Vector3(0, -dv, +du),
      new THREE.Vector3(0, -dv, -du),
      new THREE.Vector3(+du, 0, +dv),
      new THREE.Vector3(-du, 0, +dv),
      new THREE.Vector3(+du, 0, -dv),
      new THREE.Vector3(-du, 0, -dv),
      new THREE.Vector3(+dv, +du, 0),
      new THREE.Vector3(+dv, -du, 0),
      new THREE.Vector3(-dv, +du, 0),
      new THREE.Vector3(-dv, -du, 0),
    ];

  const newVertexIds = new Array<number>();
  for (var i = 0; i < points.length; ++i) {
    const newVertex = halfedgeGraph.addVertex(points[i]);
    newVertexIds.push(newVertex.id);
  }

  const edgesVertexIdPairs =
    [
      [0, 1,],
      [0, 4,],
      [0, 5,],
      [0, 8,],
      [0, 10,],
      [1, 6,],
      [1, 7,],
      [1, 8,],
      [1, 10,],
      [2, 3,],
      [2, 4,],
      [2, 5,],
      [2, 9,],
      [2, 11,],
      [3, 6,],
      [3, 7,],
      [3, 9,],
      [3, 11,],
      [4, 5,],
      [4, 8,],
      [4, 9,],
      [5, 10,],
      [5, 11,],
      [6, 7,],
      [6, 8,],
      [6, 9,],
      [7, 10,],
      [7, 11,],
      [8, 9,],
      [10, 11,]
    ];


  const newEdgesIds = new Array<string>();
  for (const [vAIdx, vBIdx] of edgesVertexIdPairs) {
    const vertexAId = newVertexIds[vAIdx];
    const vertexBId = newVertexIds[vBIdx];

    const newHalfedge = halfedgeGraph.addEdge(
      halfedgeGraph.vertices.get(vertexAId)!,
      halfedgeGraph.vertices.get(vertexBId)!,
    );

    newEdgesIds.push(newHalfedge.id);
  }

  const faces =
    [
      { e: [0, 7, 3], },
      { e: [1, 18, 2], },
      { e: [2, 21, 4], },
      { e: [3, 19, 1], },
      { e: [4, 8, 0], },
      { e: [5, 24, 7], },
      { e: [6, 23, 5], },
      { e: [8, 26, 6], },
      { e: [9, 17, 13], },
      { e: [10, 20, 12], },
      { e: [11, 18, 10], },
      { e: [12, 16, 9], },
      { e: [13, 22, 11], },
      { e: [14, 23, 15], },
      { e: [15, 27, 17], },
      { e: [16, 25, 14], },
      { e: [19, 28, 20], },
      { e: [22, 29, 21], },
      { e: [25, 28, 24], },
      { e: [26, 29, 27], },
    ];

  for (const [e0Idx, e1Idx, e2Idx] of faces.map(f => f.e)) {

    const e0Id = newEdgesIds[e0Idx];
    const e1Id = newEdgesIds[e1Idx];
    const e2Id = newEdgesIds[e2Idx];

    let halfedge0 = halfedgeGraph.halfedges.get(e0Id)!;
    let halfedge1 = halfedgeGraph.halfedges.get(e1Id)!;
    let halfedge2 = halfedgeGraph.halfedges.get(e2Id)!;

    // the halfedges must form a chain
    // find if the snd, the last, or both 
    // must be 'twin'ed to form the chain

    if (halfedge0.twin.vertex !== halfedge1.vertex) {
      halfedge1 = halfedge1.twin;
    }

    if (halfedge1.twin.vertex !== halfedge2.vertex) {
      halfedge2 = halfedge2.twin;
    }

    // watch out ! the indexing produces counter-clockwise faces
    // If built as such, the normals will point inward
    // -> reverse the orientation (take all twins and make a flip)
    // a -> b -> c -> a ...must become a <- c <- b <- a ...
    halfedgeGraph.addFace([
      halfedge0.twin,
      halfedge2.twin,
      halfedge1.twin,
    ]);

  }
}

export { populateIcosahedronHalfedgeGraph };
