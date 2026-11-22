/**
 * Patch domain — where a terrain patch lies on the planet.
 *
 * A terrain patch is a square in parameter space, (s, t) in [0, 1]².  Its
 * domain says which point of the planet each (s, t) corresponds to, as a grid
 * of unit direction vectors.  The terrain itself is a function of the 3D
 * position on the planet, so this grid is the whole flat ↔ sphere mapping:
 * the bake passes sample it to know where to evaluate the terrain, and never
 * need to know the shape of the patch (its cells are in general neither
 * square nor evenly spaced).
 *
 * Two kinds of patch produce the same data:
 *   spherePatchDomain  — a quadtree cell of the cube-sphere (World tab)
 *   tangentPatchDomain — a flat square on the plane tangent to the planet at
 *                        an anchor point (Shaders tab)
 *
 * Directions are computed here in double precision; the GPU only interpolates.
 */

import * as THREE from 'three';
import { CubeFace, ProjectionManager } from '@core/geometry/SphereProjection';

export interface PatchDomain {
  /** Number of direction samples per side. */
  res: number;
  /**
   * Direction grid, RGBA float, row-major: texel (i, j) — i along s, j along t —
   * is stored at index (j * res + i) * 4.  xyz = unit direction, w = 0.
   */
  dirs: Float32Array;
  /** Unit direction of the patch centre. */
  center: THREE.Vector3;
  /** Arc length of the patch along s and along t (through its centre), radians. */
  arcS: number;
  arcT: number;
  /**
   * Nominal edge length of the patch, radians.  Unlike arcS / arcT it does not
   * depend on where the patch lies: every quadtree cell of a given level has
   * the same nominal arc.  Bake passes derive their sample spacing from it, so
   * that neighbouring patches of the same level filter the terrain identically
   * and agree exactly along their shared edge.
   */
  nominalArc: number;
}

/** Mean edge length of the patch, as measured on a sphere of the given radius. */
export function patchSize(domain: PatchDomain, radius: number): number {
  return 0.5 * (domain.arcS + domain.arcT) * radius;
}

/** Nominal edge length of the patch on a sphere of the given radius. */
export function patchNominalSize(domain: PatchDomain, radius: number): number {
  return domain.nominalArc * radius;
}

// ── Sphere patch ───────────────────────────────────────────────────────────────

export interface CubeFaceRect {
  face: number;
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

/**
 * Unit direction of the point (s, t) of a cube-face rectangle, using the
 * current cube → sphere projection.  s runs along u, t along v.
 */
export function cubeRectDir(rect: CubeFaceRect, s: number, t: number, out: THREE.Vector3): THREE.Vector3 {
  const u = rect.u0 + (rect.u1 - rect.u0) * s;
  const v = rect.v0 + (rect.v1 - rect.v0) * t;
  return out.copy(ProjectionManager.cubeToSphere(rect.face as CubeFace, u, v)).normalize();
}

/**
 * Domain of a quadtree cell (or any rectangle of a cube face).
 */
export function spherePatchDomain(rect: CubeFaceRect, res: number): PatchDomain {
  const tmp = new THREE.Vector3();
  // A cube face spans 2 units of u (or v) and a quarter of a great circle.
  const nominalArc = 0.5 * ((rect.u1 - rect.u0) + (rect.v1 - rect.v0)) * (Math.PI / 4);
  return buildDomain(res, nominalArc, (s, t) => cubeRectDir(rect, s, t, tmp));
}

// ── Tangent-plane patch ────────────────────────────────────────────────────────

/**
 * Orthonormal frame of the plane tangent to the planet at `center`.
 * (east, center, south) is right-handed, so mapping east → +X, up → +Y and
 * south → +Z shows the surface as seen from above, unmirrored.
 */
export interface TangentFrame {
  center: THREE.Vector3;
  east:   THREE.Vector3;
  south:  THREE.Vector3;
}

/**
 * Tangent frame at a latitude / longitude (degrees).  +Y is the north pole.
 */
export function tangentFrameFromLatLon(latDeg: number, lonDeg: number): TangentFrame {
  const lat = THREE.MathUtils.degToRad(latDeg);
  const lon = THREE.MathUtils.degToRad(lonDeg);
  const center = new THREE.Vector3(
    Math.cos(lat) * Math.cos(lon),
    Math.sin(lat),
    -Math.cos(lat) * Math.sin(lon),
  );

  const north = new THREE.Vector3(0, 1, 0);
  const east  = new THREE.Vector3().crossVectors(north, center);
  if (east.lengthSq() < 1e-12) east.set(0, 0, -1); // at a pole: any tangent direction
  east.normalize();
  const south = new THREE.Vector3().crossVectors(east, center).normalize();

  return { center, east, south };
}

/**
 * Unit direction of the point of the tangent plane at (x, z), where x is the
 * distance east and z the distance south of the anchor, both in units of the
 * planet radius.  This is the gnomonic projection: straight lines of the plane
 * are great circles of the planet.
 */
export function tangentPlaneDir(frame: TangentFrame, x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(frame.center)
    .addScaledVector(frame.east, x)
    .addScaledVector(frame.south, z)
    .normalize();
}

/**
 * Rotation taking a vector of the planet frame to the local frame of the
 * tangent plane (x = east, y = up, z = south).
 */
export function tangentFrameRotation(frame: TangentFrame, out: THREE.Matrix3): THREE.Matrix3 {
  return out.set(
    frame.east.x,   frame.east.y,   frame.east.z,
    frame.center.x, frame.center.y, frame.center.z,
    frame.south.x,  frame.south.y,  frame.south.z,
  );
}

/**
 * Domain of a flat square patch on the tangent plane, centred on the anchor.
 * `size` is the edge length of the square in units of the planet radius.
 * s runs east (+X), t runs south (+Z).
 */
export function tangentPatchDomain(frame: TangentFrame, size: number, res: number): PatchDomain {
  const tmp = new THREE.Vector3();
  return buildDomain(res, size, (s, t) => tangentPlaneDir(frame, (s - 0.5) * size, (t - 0.5) * size, tmp));
}

// ── Shared ─────────────────────────────────────────────────────────────────────

function buildDomain(
  res: number, nominalArc: number, dirAt: (s: number, t: number) => THREE.Vector3,
): PatchDomain {
  const dirs = new Float32Array(res * res * 4);
  for (let j = 0; j < res; j++) {
    const t = j / (res - 1);
    for (let i = 0; i < res; i++) {
      const d = dirAt(i / (res - 1), t);
      const k = (j * res + i) * 4;
      dirs[k]     = d.x;
      dirs[k + 1] = d.y;
      dirs[k + 2] = d.z;
    }
  }

  const center = dirAt(0.5, 0.5).clone();

  // Arc lengths through the centre, summed over a few segments.
  const SEGMENTS = 8;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  let arcS = 0;
  let arcT = 0;
  for (let k = 0; k < SEGMENTS; k++) {
    a.copy(dirAt(k / SEGMENTS, 0.5));
    b.copy(dirAt((k + 1) / SEGMENTS, 0.5));
    arcS += a.angleTo(b);
    a.copy(dirAt(0.5, k / SEGMENTS));
    b.copy(dirAt(0.5, (k + 1) / SEGMENTS));
    arcT += a.angleTo(b);
  }

  return { res, dirs, center, arcS, arcT, nominalArc };
}
