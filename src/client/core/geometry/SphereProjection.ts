/**
 * Unified Sphere Projection Module
 *
 * Provides multiple cube-to-sphere projection methods with a common API.
 * Supports Everett-Praun (low distortion) and Arvo (equal area) projections.
 */

import * as THREE from 'three';

/**
 * Available projection types.
 */
export enum ProjectionType {
  EVERETT_PRAUN = 'everett_praun',
  ARVO = 'arvo',
}

/**
 * Cube face identifiers.
 */
export enum CubeFace {
  PLUS_X = 0,
  MINUS_X = 1,
  PLUS_Y = 2,
  MINUS_Y = 3,
  PLUS_Z = 4,
  MINUS_Z = 5,
}

/**
 * Result of sphere-to-cube mapping.
 */
export interface CubeFaceUV {
  face: CubeFace;
  u: number;
  v: number;
}

// ============================================================================
// Everett-Praun Projection Constants and Implementation
// ============================================================================

const PI_OVER_4 = Math.PI / 4;
const FOUR_OVER_PI = 4 / Math.PI;

/**
 * Everett-Praun forward mapping: Cube face coordinates to sphere point.
 */
function everettPraunCubeToSphere(face: CubeFace, u: number, v: number): THREE.Vector3 {
  const xw = Math.tan(u * PI_OVER_4);
  const yw = Math.tan(v * PI_OVER_4);

  let point: THREE.Vector3;

  switch (face) {
    case CubeFace.PLUS_X:
      point = new THREE.Vector3(1, yw, -xw);
      break;
    case CubeFace.MINUS_X:
      point = new THREE.Vector3(-1, yw, xw);
      break;
    case CubeFace.PLUS_Y:
      point = new THREE.Vector3(xw, 1, yw);
      break;
    case CubeFace.MINUS_Y:
      point = new THREE.Vector3(xw, -1, -yw);
      break;
    case CubeFace.PLUS_Z:
      point = new THREE.Vector3(xw, yw, 1);
      break;
    case CubeFace.MINUS_Z:
      point = new THREE.Vector3(-xw, yw, -1);
      break;
    default:
      point = new THREE.Vector3(0, 0, 1);
  }

  return point.normalize();
}

/**
 * Everett-Praun inverse mapping: Sphere point to cube face coordinates.
 */
function everettPraunSphereToCube(point: THREE.Vector3): CubeFaceUV {
  const p = point.clone().normalize();
  const ax = Math.abs(p.x);
  const ay = Math.abs(p.y);
  const az = Math.abs(p.z);

  let face: CubeFace;
  let x: number;
  let y: number;

  if (ax >= ay && ax >= az) {
    if (p.x > 0) {
      face = CubeFace.PLUS_X;
      x = -p.z / p.x;
      y = p.y / ax;
    } else {
      face = CubeFace.MINUS_X;
      x = p.z / (-p.x);
      y = p.y / ax;
    }
  } else if (ay >= ax && ay >= az) {
    if (p.y > 0) {
      face = CubeFace.PLUS_Y;
      x = p.x / ay;
      y = p.z / ay;
    } else {
      face = CubeFace.MINUS_Y;
      x = p.x / ay;
      y = -p.z / ay;
    }
  } else {
    if (p.z > 0) {
      face = CubeFace.PLUS_Z;
      x = p.x / az;
      y = p.y / az;
    } else {
      face = CubeFace.MINUS_Z;
      x = -p.x / az;
      y = p.y / az;
    }
  }

  const u = FOUR_OVER_PI * Math.atan(x);
  const v = FOUR_OVER_PI * Math.atan(y);

  return { face, u, v };
}

// ============================================================================
// Arvo Equal-Area Projection Constants and Implementation
// ============================================================================

const PI_OVER_6 = Math.PI / 6;
const PI_OVER_3 = Math.PI / 3;
const SIX_OVER_PI = 6 / Math.PI;
const SQRT2 = Math.sqrt(2);

/**
 * Arvo forward mapping: Cube face coordinates (a,b) to intermediate (u,v).
 *
 * From doc/arvo_mapping.md:
 * u = sqrt(2) * tan(π*a / 6) / sqrt(1 - tan²(π*a / 6))
 * v = b / sqrt(1 + (1 - b²) * cos(π*a / 3))
 */
function arvoForward(a: number, b: number): { u: number; v: number } {
  const tanA = Math.tan(a * PI_OVER_6);
  const tanA2 = tanA * tanA;

  // Avoid division by zero when a = ±1 (tan = ±1, denom = 0)
  const denom = 1 - tanA2;
  let u: number;
  if (Math.abs(denom) < 1e-10) {
    // At edges, use limit behavior
    u = a > 0 ? 1e6 : -1e6;
  } else {
    u = SQRT2 * tanA / Math.sqrt(Math.abs(denom));
    if (denom < 0) u = -u; // Handle sign correctly
  }

  const cosA3 = Math.cos(a * PI_OVER_3);
  const vDenom = Math.sqrt(1 + (1 - b * b) * cosA3);
  const v = b / vDenom;

  return { u, v };
}

/**
 * Arvo inverse mapping: Intermediate (u,v) to cube face coordinates (a,b).
 *
 * From doc/arvo_mapping.md:
 * a = (6/π) * arctan(u / sqrt(u² + 2))
 * b = v * sqrt(u² + 2) / sqrt(u² + v² + 1)
 */
function arvoInverse(u: number, v: number): { a: number; b: number } {
  const u2 = u * u;
  const v2 = v * v;
  const sqrtU2Plus2 = Math.sqrt(u2 + 2);

  const a = SIX_OVER_PI * Math.atan(u / sqrtU2Plus2);
  const b = v * sqrtU2Plus2 / Math.sqrt(u2 + v2 + 1);

  return { a, b };
}

/**
 * Arvo forward mapping: Cube face coordinates to sphere point.
 * Uses Arvo equal-area transformation.
 */
function arvoCubeToSphere(face: CubeFace, a: number, b: number): THREE.Vector3 {
  // Apply Arvo transformation to get intermediate coordinates
  const { u, v } = arvoForward(a, b);

  // Now (u, v, 1) is on an intermediate surface; normalize to sphere
  let point: THREE.Vector3;

  switch (face) {
    case CubeFace.PLUS_X:
      point = new THREE.Vector3(1, v, -u);
      break;
    case CubeFace.MINUS_X:
      point = new THREE.Vector3(-1, v, u);
      break;
    case CubeFace.PLUS_Y:
      point = new THREE.Vector3(u, 1, v);
      break;
    case CubeFace.MINUS_Y:
      point = new THREE.Vector3(u, -1, -v);
      break;
    case CubeFace.PLUS_Z:
      point = new THREE.Vector3(u, v, 1);
      break;
    case CubeFace.MINUS_Z:
      point = new THREE.Vector3(-u, v, -1);
      break;
    default:
      point = new THREE.Vector3(0, 0, 1);
  }

  return point.normalize();
}

/**
 * Arvo inverse mapping: Sphere point to cube face coordinates.
 */
function arvoSphereToCube(point: THREE.Vector3): CubeFaceUV {
  const p = point.clone().normalize();
  const ax = Math.abs(p.x);
  const ay = Math.abs(p.y);
  const az = Math.abs(p.z);

  let face: CubeFace;
  let u: number;
  let v: number;

  // First get gnomonic projection coordinates
  if (ax >= ay && ax >= az) {
    if (p.x > 0) {
      face = CubeFace.PLUS_X;
      u = -p.z / p.x;
      v = p.y / p.x;
    } else {
      face = CubeFace.MINUS_X;
      u = p.z / (-p.x);
      v = p.y / (-p.x);
    }
  } else if (ay >= ax && ay >= az) {
    if (p.y > 0) {
      face = CubeFace.PLUS_Y;
      u = p.x / p.y;
      v = p.z / p.y;
    } else {
      face = CubeFace.MINUS_Y;
      u = p.x / (-p.y);
      v = -p.z / (-p.y);
    }
  } else {
    if (p.z > 0) {
      face = CubeFace.PLUS_Z;
      u = p.x / p.z;
      v = p.y / p.z;
    } else {
      face = CubeFace.MINUS_Z;
      u = -p.x / (-p.z);
      v = p.y / (-p.z);
    }
  }

  // Apply Arvo inverse to get cube coordinates
  const { a, b } = arvoInverse(u, v);

  return { face, u: a, v: b };
}

// ============================================================================
// Projection Manager (Singleton)
// ============================================================================

type ProjectionChangeCallback = (type: ProjectionType) => void;

/**
 * Singleton manager for projection selection and change notifications.
 */
class ProjectionManagerClass {
  private currentProjection: ProjectionType = ProjectionType.ARVO;
  private listeners: Set<ProjectionChangeCallback> = new Set();

  /**
   * Gets the current projection type.
   */
  getProjection(): ProjectionType {
    return this.currentProjection;
  }

  /**
   * Sets the current projection type and notifies listeners.
   */
  setProjection(type: ProjectionType): void {
    if (this.currentProjection === type) return;

    this.currentProjection = type;
    console.log(`[ProjectionManager] Switched to ${type} projection`);

    for (const callback of this.listeners) {
      callback(type);
    }
  }

  /**
   * Registers a callback to be called when the projection changes.
   * @returns Unsubscribe function
   */
  onProjectionChange(callback: ProjectionChangeCallback): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Forward mapping: Cube face coordinates to sphere point.
   */
  cubeToSphere(face: CubeFace, u: number, v: number): THREE.Vector3 {
    switch (this.currentProjection) {
      case ProjectionType.ARVO:
        return arvoCubeToSphere(face, u, v);
      case ProjectionType.EVERETT_PRAUN:
      default:
        return everettPraunCubeToSphere(face, u, v);
    }
  }

  /**
   * Inverse mapping: Sphere point to cube face coordinates.
   */
  sphereToCube(point: THREE.Vector3): CubeFaceUV {
    switch (this.currentProjection) {
      case ProjectionType.ARVO:
        return arvoSphereToCube(point);
      case ProjectionType.EVERETT_PRAUN:
      default:
        return everettPraunSphereToCube(point);
    }
  }

  /**
   * Projects a point on the cube surface to the sphere.
   */
  projectCubePointToSphere(cubePoint: THREE.Vector3, offset: number = 0): THREE.Vector3 {
    const ax = Math.abs(cubePoint.x);
    const ay = Math.abs(cubePoint.y);
    const az = Math.abs(cubePoint.z);

    let face: CubeFace;
    let u: number;
    let v: number;

    if (ax >= ay && ax >= az) {
      if (cubePoint.x > 0) {
        face = CubeFace.PLUS_X;
        u = -cubePoint.z / cubePoint.x;
        v = cubePoint.y / cubePoint.x;
      } else {
        face = CubeFace.MINUS_X;
        u = cubePoint.z / (-cubePoint.x);
        v = cubePoint.y / (-cubePoint.x);
      }
    } else if (ay >= ax && ay >= az) {
      if (cubePoint.y > 0) {
        face = CubeFace.PLUS_Y;
        u = cubePoint.x / cubePoint.y;
        v = cubePoint.z / cubePoint.y;
      } else {
        face = CubeFace.MINUS_Y;
        u = cubePoint.x / (-cubePoint.y);
        v = -cubePoint.z / (-cubePoint.y);
      }
    } else {
      if (cubePoint.z > 0) {
        face = CubeFace.PLUS_Z;
        u = cubePoint.x / cubePoint.z;
        v = cubePoint.y / cubePoint.z;
      } else {
        face = CubeFace.MINUS_Z;
        u = -cubePoint.x / (-cubePoint.z);
        v = cubePoint.y / (-cubePoint.z);
      }
    }

    const spherePoint = this.cubeToSphere(face, u, v);

    if (offset !== 0) {
      spherePoint.multiplyScalar(1 + offset);
    }

    return spherePoint;
  }

  /**
   * Projects a point on the sphere to the cube surface.
   */
  projectSpherePointToCube(spherePoint: THREE.Vector3, offset: number = 0): THREE.Vector3 {
    const { face, u, v } = this.sphereToCube(spherePoint);

    let point: THREE.Vector3;

    switch (face) {
      case CubeFace.PLUS_X:
        point = new THREE.Vector3(1, v, -u);
        break;
      case CubeFace.MINUS_X:
        point = new THREE.Vector3(-1, v, u);
        break;
      case CubeFace.PLUS_Y:
        point = new THREE.Vector3(u, 1, v);
        break;
      case CubeFace.MINUS_Y:
        point = new THREE.Vector3(u, -1, -v);
        break;
      case CubeFace.PLUS_Z:
        point = new THREE.Vector3(u, v, 1);
        break;
      case CubeFace.MINUS_Z:
        point = new THREE.Vector3(-u, v, -1);
        break;
      default:
        point = new THREE.Vector3(0, 0, 1);
    }

    if (offset !== 0) {
      const normal = getCubeFaceNormal(face);
      point.addScaledVector(normal, offset);
    }

    return point;
  }

  /**
   * Interpolates along a great arc on the sphere between two cube points.
   */
  interpolateGreatArc(
    start: THREE.Vector3,
    end: THREE.Vector3,
    segments: number,
    offset: number = 0
  ): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];

    const sphereStart = this.projectCubePointToSphere(start);
    const sphereEnd = this.projectCubePointToSphere(end);

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;

      const dot = sphereStart.dot(sphereEnd);
      const clampedDot = Math.max(-1, Math.min(1, dot));
      const theta = Math.acos(clampedDot);

      let point: THREE.Vector3;
      if (Math.abs(theta) < 0.0001) {
        point = sphereStart.clone().lerp(sphereEnd, t).normalize();
      } else {
        const sinTheta = Math.sin(theta);
        const a = Math.sin((1 - t) * theta) / sinTheta;
        const b = Math.sin(t * theta) / sinTheta;
        point = new THREE.Vector3(
          a * sphereStart.x + b * sphereEnd.x,
          a * sphereStart.y + b * sphereEnd.y,
          a * sphereStart.z + b * sphereEnd.z
        );
      }

      if (offset !== 0) {
        point.multiplyScalar(1 + offset);
      }

      points.push(point);
    }

    return points;
  }
}

/**
 * Gets the outward normal vector for a cube face.
 */
export function getCubeFaceNormal(face: CubeFace): THREE.Vector3 {
  switch (face) {
    case CubeFace.PLUS_X:
      return new THREE.Vector3(1, 0, 0);
    case CubeFace.MINUS_X:
      return new THREE.Vector3(-1, 0, 0);
    case CubeFace.PLUS_Y:
      return new THREE.Vector3(0, 1, 0);
    case CubeFace.MINUS_Y:
      return new THREE.Vector3(0, -1, 0);
    case CubeFace.PLUS_Z:
      return new THREE.Vector3(0, 0, 1);
    case CubeFace.MINUS_Z:
      return new THREE.Vector3(0, 0, -1);
    default:
      return new THREE.Vector3(0, 0, 1);
  }
}

// Export singleton instance
export const ProjectionManager = new ProjectionManagerClass();

// Re-export standalone functions that use the ProjectionManager for convenience
export function cubeToSphere(face: CubeFace, u: number, v: number): THREE.Vector3 {
  return ProjectionManager.cubeToSphere(face, u, v);
}

export function sphereToCube(point: THREE.Vector3): CubeFaceUV {
  return ProjectionManager.sphereToCube(point);
}

export function projectCubePointToSphere(cubePoint: THREE.Vector3, offset: number = 0): THREE.Vector3 {
  return ProjectionManager.projectCubePointToSphere(cubePoint, offset);
}

export function projectSpherePointToCube(spherePoint: THREE.Vector3, offset: number = 0): THREE.Vector3 {
  return ProjectionManager.projectSpherePointToCube(spherePoint, offset);
}

export function interpolateGreatArc(
  start: THREE.Vector3,
  end: THREE.Vector3,
  segments: number,
  offset: number = 0
): THREE.Vector3[] {
  return ProjectionManager.interpolateGreatArc(start, end, segments, offset);
}
