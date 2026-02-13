import { HalfedgeGraph } from '@core/HalfedgeGraph';
import {
  collectOriginalVertices,
  subdivideTrianglesLoop,
  normalizeVertices,
  populateDualGraph,
  distortGraphLoop,
  makeFaceDistribution
} from '@core/HalfedgeGraphUtils';
import { populateIcosahedronHalfedgeGraph } from '@core/geometry/IcosahedronMesh';

/**
 * Result of building icosahedron graphs.
 */
export interface GeometryBuildResult {
  primalGraph: HalfedgeGraph;
  dualGraph: HalfedgeGraph;
  stats: {
    numVertices: number;
    numFaces: number;
    numHalfedges: number;
    numDualFaces: number;
    pentagons: number;
    hexagons: number;
    heptagons: number;
  };
}

/**
 * Handles all graph construction logic: icosahedron population, subdivision,
 * distortion, and dual graph generation.
 */
export class GeometryBuilder {
  /**
   * Builds the primal and dual graphs from an icosahedron with the given subdivision degree.
   * @param degree The subdivision degree (0-7)
   * @returns The built graphs and statistics
   */
  public buildIcosahedronGraphs(degree: number): GeometryBuildResult {
    const start_time = performance.now();

    const primalGraph = new HalfedgeGraph();
    const dualGraph = new HalfedgeGraph();

    // Populate base icosahedron
    populateIcosahedronHalfedgeGraph(primalGraph);

    // Collect original vertices (all have 5 edges)
    const initialIcoVerticesIds = collectOriginalVertices(primalGraph);
    const verticesEdgeCountIdMap = new Map(
      Array.from(initialIcoVerticesIds, id => [id, 5])
    );

    // Subdivide triangles
    subdivideTrianglesLoop(primalGraph, degree);

    const ico_build_time = performance.now();

    // Apply distortion and normalize
    // distortGraphLoop(primalGraph, verticesEdgeCountIdMap, 3, 0.5);
    distortGraphLoop(primalGraph, verticesEdgeCountIdMap, 1, 0.5);
    normalizeVertices(primalGraph);

    const distort_time = performance.now();

    // Generate dual graph
    populateDualGraph(primalGraph, dualGraph);
    normalizeVertices(dualGraph);

    const dual_build_time = performance.now();

    // Compute statistics
    const faceDistrib = makeFaceDistribution(dualGraph);

    const end_time = performance.now();
    console.log("Ico build time:", (ico_build_time - start_time).toFixed(2), "ms");
    console.log("Distort time:", (distort_time - ico_build_time).toFixed(2), "ms");
    console.log("Dual build time:", (dual_build_time - distort_time).toFixed(2), "ms");
    console.log("Total build time:", (end_time - start_time).toFixed(2), "ms");

    return {
      primalGraph,
      dualGraph,
      stats: {
        numVertices: primalGraph.vertices.size,
        numFaces: primalGraph.faces.size,
        numHalfedges: primalGraph.halfedges.size,
        numDualFaces: faceDistrib.dualFaces,
        pentagons: faceDistrib.pentagons,
        hexagons: faceDistrib.hexagons,
        heptagons: faceDistrib.heptagons
      }
    };
  }
}
