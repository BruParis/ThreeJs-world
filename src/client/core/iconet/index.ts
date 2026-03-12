export {
  IcoNetGeometry,
  triangleHeight,
  type Vec2,
  type TriangleFace,
  type IcoNetConfig,
} from './IcoNetGeometry';

export {
  IcoNetCoordinates,
  RING_LATITUDE,
  LON_STEP,
  LON_HALF_STEP,
  type LatLon,
} from './IcoNetCoordinates';

export {
  buildRootTriangles,
  isPointInTriangle,
  computeBarycentricCoordinates,
  interpolateLatLon,
  findTriangleAtPoint,
  getRootTriangleNeighbors,
  ROOT_TRIANGLE_ADJACENCY,
  type RootTriangle,
  type RootTriangleNeighbors,
} from './RootTriangle';

export {
  buildHexagons,
  isPointInCell,
  findCellAtPoint,
  type HexaCell,
  type HexaVertex,
  type HexagonBuildResult,
} from './HexaCell';

export {
  decodeHexaTreePath,
  parsePathString,
} from './HexaTreeEncoding';

export {
  decodeIcoTreePath,
  parseIcoTreePathString,
  type IcoTreeLevel,
  type IcoTreeDecodeResult,
} from './IcoTreeEncoding';
