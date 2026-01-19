
import * as THREE from 'three';
import { HalfedgeDS } from 'three-mesh-halfedge';
import { HalfedgeGraph } from '@core/HalfedgeGraph';

function populateTetrahedronHalfedgeDS(halfedgeDS: HalfedgeDS) {

  halfedgeDS.clear();

  const points =
    [
      new THREE.Vector3(1, 1, 1).normalize(),
      new THREE.Vector3(-1, -1, 1).normalize(),
      new THREE.Vector3(-1, 1, -1).normalize(),
      new THREE.Vector3(1, -1, -1).normalize(),
    ];

  for (var i = 0; i < points.length; ++i) {
    halfedgeDS.addVertex(points[i]);
  }

  const edgesVertexIdPairs =
    [
      [0, 1,],
      [0, 2,],
      [0, 3,],
      [1, 2,],
      [1, 3,],
      [2, 3,],
    ];

  for (const [vertexAId, vertexBId] of edgesVertexIdPairs) {
    halfedgeDS.addEdge(
      halfedgeDS.vertices[vertexAId],
      halfedgeDS.vertices[vertexBId],
    );
  }

  const faces =
    [
      { e: [0, 3, 1], },
      { e: [1, 5, 2], },
      { e: [4, 5, 3], },
      { e: [2, 4, 0], },
    ];

  for (const [e0, e1, e2] of faces.map(f => f.e)) {

    // each halfedgge previously added created its twin halfedge
    // -> take the index multiplied by 2

    let halfedge0 = halfedgeDS.halfedges[2 * e0];
    let halfedge1 = halfedgeDS.halfedges[2 * e1];
    let halfedge2 = halfedgeDS.halfedges[2 * e2];

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
    halfedgeDS.addFace([
      halfedge0.twin,
      halfedge2.twin,
      halfedge1.twin,
    ]);

  }
}

function populateTetrahedronHalfedgeGraph(halfedgeGraph: HalfedgeGraph) {

  halfedgeGraph.clear();

  const points =
    [
      new THREE.Vector3(1, 1, 1).normalize(),
      new THREE.Vector3(-1, -1, 1).normalize(),
      new THREE.Vector3(-1, 1, -1).normalize(),
      new THREE.Vector3(1, -1, -1).normalize(),
    ];

  const newVertexIds = new Array<number>();
  for (var i = 0; i < points.length; ++i) {
    const newVertex = halfedgeGraph.addVertex(points[i]);
    newVertexIds.push(newVertex.id);
  }

  const edgesVertexIdPairs =
    [
      [0, 1,],
      [0, 2,],
      [0, 3,],
      [1, 2,],
      [1, 3,],
      [2, 3,],
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
  console.log("num halfedges after edges added: ", halfedgeGraph.halfedges.size);

  const faces =
    [
      { e: [0, 3, 1], },
      { e: [1, 5, 2], },
      { e: [4, 5, 3], },
      { e: [2, 4, 0], },
    ];

  for (const [e0Idx, e1Idx, e2Idx] of faces.map(f => f.e)) {

    const e0Id = newEdgesIds[e0Idx];
    const e1Id = newEdgesIds[e1Idx];
    const e2Id = newEdgesIds[e2Idx];

    let halfedge0 = halfedgeGraph.halfedges.get(e0Id)!
    let halfedge1 = halfedgeGraph.halfedges.get(e1Id)!
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

export { populateTetrahedronHalfedgeDS, populateTetrahedronHalfedgeGraph };
