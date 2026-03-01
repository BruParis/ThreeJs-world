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
  buildHexaTriangles,
  isPointInTriangle,
  computeBarycentricCoordinates,
  interpolateLatLon,
  findTriangleAtPoint,
  type HexaTriangle,
} from './HexaTriangle';

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
  generateHexagonVertices,
  type HexaTreeDecodeResult,
  type HexaTreeLevel,
} from './HexaTreeEncoding';
