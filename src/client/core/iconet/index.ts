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
  buildHexaCells,
  computeTriangleCentroids,
  isPointInCell,
  findCellAtPoint,
  computeCellCentroid,
  type HexaCell,
} from './HexaCell';
