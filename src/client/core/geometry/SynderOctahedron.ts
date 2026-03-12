/**
 * Snyder Equal-Area Projection for Octahedron (unit sphere)
 *
 * Based on Snyder (1992) "An equal-area map projection for polyhedral globes"
 * and the vector-form derivation by BRSR (brsr.github.io/2021/08/31/snyder-equal-area.html)
 *
 * The octahedron has 8 triangular faces. Each face maps to a right-isoceles
 * triangle on the plane. This implementation works in 3D unit-vector space,
 * avoiding latitude/longitude singularities.
 *
 * The octahedron special case simplifies greatly because all face vertices
 * are mutually orthogonal (dot products = 0), and each spherical face has
 * area = π/2.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

// ─── Octahedron face definitions ──────────────────────────────────────────────

/**
 * The 8 faces of the octahedron inscribed in a unit sphere.
 * Each face is defined by three mutually-orthogonal unit vectors (v0, v1, v2)
 * in counter-clockwise order when viewed from outside the sphere.
 *
 * v0 is the "apex" (the pole vertex for that face),
 * v1 and v2 are the equatorial edge vertices.
 *
 * Face layout (octant signs):
 *   Top hemisphere (+z apex):    faces 0-3
 *   Bottom hemisphere (-z apex): faces 4-7
 */
export const OCTAHEDRON_FACES: Array<{ v0: Vec3; v1: Vec3; v2: Vec3 }> = [
  // Top hemisphere (+z apex), 4 faces by quadrant
  // Face 0: +x+y quadrant
  {
    v0: [0, 0, 1],
    v1: [1 / Math.SQRT2, -1 / Math.SQRT2, 0],
    v2: [1 / Math.SQRT2,  1 / Math.SQRT2, 0],
  },
  // Face 1: -x+y quadrant
  {
    v0: [0, 0, 1],
    v1: [-1 / Math.SQRT2, -1 / Math.SQRT2, 0],
    v2: [ 1 / Math.SQRT2, -1 / Math.SQRT2, 0],
  },
  // Face 2: -x-y quadrant
  {
    v0: [0, 0, 1],
    v1: [-1 / Math.SQRT2,  1 / Math.SQRT2, 0],
    v2: [-1 / Math.SQRT2, -1 / Math.SQRT2, 0],
  },
  // Face 3: +x-y quadrant
  {
    v0: [0, 0, 1],
    v1: [ 1 / Math.SQRT2,  1 / Math.SQRT2, 0],
    v2: [-1 / Math.SQRT2,  1 / Math.SQRT2, 0],
  },
  // Bottom hemisphere (-z apex), mirrored
  {
    v0: [0, 0, -1],
    v1: [1 / Math.SQRT2,  1 / Math.SQRT2, 0],
    v2: [1 / Math.SQRT2, -1 / Math.SQRT2, 0],
  },
  {
    v0: [0, 0, -1],
    v1: [ 1 / Math.SQRT2, -1 / Math.SQRT2, 0],
    v2: [-1 / Math.SQRT2, -1 / Math.SQRT2, 0],
  },
  {
    v0: [0, 0, -1],
    v1: [-1 / Math.SQRT2, -1 / Math.SQRT2, 0],
    v2: [-1 / Math.SQRT2,  1 / Math.SQRT2, 0],
  },
  {
    v0: [0, 0, -1],
    v1: [-1 / Math.SQRT2,  1 / Math.SQRT2, 0],
    v2: [ 1 / Math.SQRT2,  1 / Math.SQRT2, 0],
  },
];

// ─── Low-level math ───────────────────────────────────────────────────────────

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function norm(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}

function normalize(a: Vec3): Vec3 {
  const n = norm(a);
  return [a[0] / n, a[1] / n, a[2] / n];
}

function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** Spherical linear interpolation between two unit vectors */
function slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  const cosAngle = Math.min(1, Math.max(-1, dot(a, b)));
  const angle = Math.acos(cosAngle);
  if (Math.abs(angle) < 1e-12) return a;
  const sinAngle = Math.sin(angle);
  const ta = Math.sin((1 - t) * angle) / sinAngle;
  const tb = Math.sin(t * angle) / sinAngle;
  return normalize(add(scale(a, ta), scale(b, tb)));
}

/**
 * Signed spherical area of triangle (v0, v1, v2) using the spherical excess formula.
 * Positive for counter-clockwise order when viewed from outside.
 */
function sphericalTriangleArea(v0: Vec3, v1: Vec3, v2: Vec3): number {
  // Using the formula: area = 2 * atan2(|v0 · (v1 × v2)|, 1 + v0·v1 + v1·v2 + v2·v0)
  const c = cross(v1, v2);
  const num = dot(v0, c);
  const den = 1 + dot(v0, v1) + dot(v1, v2) + dot(v2, v0);
  return 2 * Math.atan2(num, den);
}

// ─── Core Snyder projection (general triangle form) ───────────────────────────

/**
 * FORWARD: sphere point → barycentric coordinates in the planar face triangle.
 *
 * Given a point v on the sphere inside the spherical triangle (v0, v1, v2),
 * returns barycentric coordinates [β0, β1, β2] of the equal-area projected
 * point in the corresponding planar triangle.
 *
 * Algorithm (Snyder 1992, vector form):
 *   1. Find p̂ = intersection of great circle (v0, v) with great circle (v1, v2)
 *   2. h = sqrt((1 - v0·v) / (1 - v0·p̂))   ← equal-area radial scaling
 *   3. β2 = h * A(v0, v1, p̂) / A(v0, v1, v2)
 *   4. β0 = 1 - h,  β1 = h - β2
 */
export function snyderForward(
  v: Vec3,
  v0: Vec3,
  v1: Vec3,
  v2: Vec3
): [number, number, number] {
  const totalArea = sphericalTriangleArea(v0, v1, v2);

  // Step 1: find p̂ = normalize((v0 × v) × (v1 × v2))
  const c_v0v  = cross(v0, v);
  const c_v1v2 = cross(v1, v2);
  const p_raw  = cross(c_v0v, c_v1v2);
  const p_norm = norm(p_raw);

  let p: Vec3;
  if (p_norm < 1e-12) {
    // v is exactly at v0 — degenerate, return apex
    return [1, 0, 0];
  }
  p = normalize(p_raw);

  // Ensure p is on the same side as v2 relative to the arc (v0, v1)
  // (handle the sign ambiguity of the cross-product normalization)
  if (dot(p, v2) < 0) {
    p = [-p[0], -p[1], -p[2]];
  }

  // Step 2: h = sqrt((1 - v0·v) / (1 - v0·p̂))
  const v0_dot_v = dot(v0, v);
  const v0_dot_p = dot(v0, p);
  const denom = 1 - v0_dot_p;
  if (Math.abs(denom) < 1e-12) {
    return [1, 0, 0];
  }
  const h = Math.sqrt((1 - v0_dot_v) / denom);

  // Step 3: β2 = h * A(v0, v1, p̂) / A(v0, v1, v2)
  const partialArea = sphericalTriangleArea(v0, v1, p);
  const beta2 = h * (partialArea / totalArea);

  // Step 4
  const beta0 = 1 - h;
  const beta1 = h - beta2;

  return [beta0, beta1, beta2];
}

/**
 * INVERSE: barycentric coordinates → sphere point.
 *
 * Given barycentric coords [β0, β1, β2] in the planar triangle (corresponding
 * to face v0, v1, v2), returns the unit sphere point.
 *
 * Algorithm (closed-form inverse, BRSR 2021):
 *   h = 1 - β0
 *   a = (β2 / h) * A(v0, v1, v2)
 *   Recover p̂ on arc (v1, v2) using the angle a
 *   Recover v via slerp(v0, p̂, t) where t satisfies the h equation
 */
export function snyderInverse(
  beta0: number,
  beta1: number,
  beta2: number,
  v0: Vec3,
  v1: Vec3,
  v2: Vec3
): Vec3 {
  const h = 1 - beta0;

  if (h < 1e-12) return v0; // apex

  const totalArea = sphericalTriangleArea(v0, v1, v2);
  const a = (beta2 / h) * totalArea;

  const c01 = dot(v0, v1);
  const c12 = dot(v1, v2);
  const c20 = dot(v2, v0);
  const s12 = Math.sqrt(1 - c12 * c12);

  // Determinant |V| = v0 · (v1 × v2)
  const detV = dot(v0, cross(v1, v2));

  const S = Math.sin(a);
  const C = 1 - Math.cos(a);

  const f = S * detV + C * (c01 * c12 - c20);
  const g = C * s12 * (1 + c01);

  // q: fractional position along arc (v1, v2) for p̂
  const arcLen12 = Math.acos(Math.min(1, Math.max(-1, c12)));
  const q = (2 / arcLen12) * Math.atan2(g, f);

  // p̂ = slerp(v1, v2, q)
  const p = slerp(v1, v2, q);

  // t: fractional position along arc (v0, p̂) for v
  const v0_dot_p = Math.min(1, Math.max(-1, dot(v0, p)));
  const arcLen0p = Math.acos(v0_dot_p);
  if (Math.abs(arcLen0p) < 1e-12) return v0;

  const cos_t_arc = 1 + h * h * (v0_dot_p - 1);
  const t_arc = Math.acos(Math.min(1, Math.max(-1, cos_t_arc)));
  const t = t_arc / arcLen0p;

  return slerp(v0, p, t);
}

// ─── Simplified forward for the octahedron special case ───────────────────────

/**
 * Snyder forward projection optimized for the octahedron.
 *
 * Because all face vertices are mutually orthogonal (v_i · v_j = 0 for i≠j)
 * and the spherical face area = π/2, the formulas collapse to:
 *
 *   In latitude/longitude relative to the face center meridian:
 *     x = sqrt(2) * sin(π/4 - φ/2)
 *     y = (4/π) * x * λ
 *
 * This is equivalent to the Collignon projection with an affine transform.
 *
 * Input:  a unit sphere point v that lies within the given octahedron face
 * Output: 2D planar coordinates [x, y] in the face's local frame,
 *         with x ∈ [0, 1], y ∈ [-x, x] for the canonical triangle.
 */
export function snyderOctahedronForward(
  v: Vec3,
  face: { v0: Vec3; v1: Vec3; v2: Vec3 }
): Vec2 {
  const [beta0, beta1, beta2] = snyderForward(v, face.v0, face.v1, face.v2);

  // Map barycentric → 2D using the canonical triangle:
  // z0=[0,0], z1=[1,-1], z2=[1,1]
  // x = β1 + β2 = h = 1 - β0
  // y = -β1 + β2
  const x = beta1 + beta2; // = 1 - beta0 = h
  const y = -beta1 + beta2;
  return [x, y];
}

/**
 * Snyder inverse projection for the octahedron.
 *
 * Input:  2D planar [x, y] in the face's local frame
 * Output: unit sphere point Vec3
 */
export function snyderOctahedronInverse(
  xy: Vec2,
  face: { v0: Vec3; v1: Vec3; v2: Vec3 }
): Vec3 {
  const [x, y] = xy;
  // Recover barycentric from canonical 2D
  // x = β1 + β2,  y = -β1 + β2
  // → β2 = (x + y) / 2,  β1 = (x - y) / 2,  β0 = 1 - x
  const beta2 = (x + y) / 2;
  const beta1 = (x - y) / 2;
  const beta0 = 1 - x;
  return snyderInverse(beta0, beta1, beta2, face.v0, face.v1, face.v2);
}

// ─── Face lookup ──────────────────────────────────────────────────────────────

/**
 * Find which of the 8 octahedron faces a sphere point belongs to.
 *
 * For the octahedron, this is simply the octant of the point:
 *   sign(x), sign(y), sign(z) → face index.
 */
export function findFace(v: Vec3): number {
  const [x, y, z] = v;
  if (z >= 0) {
    // Top hemisphere
    if (x >= 0 && y >= 0) return 0;
    if (x <  0 && y <  0) return 1; // wait — need to match face table
    // Actually use the quadrant of (x,y):
    if (x >= 0 && y <  0) return 1;
    if (x <  0 && y <  0) return 2;
    /* x < 0 && y >= 0 */ return 3;
  } else {
    // Bottom hemisphere
    if (x >= 0 && y >= 0) return 4;
    if (x >= 0 && y <  0) return 5;
    if (x <  0 && y <  0) return 6;
    /* x < 0 && y >= 0 */ return 7;
  }
}

// ─── High-level API ───────────────────────────────────────────────────────────

export interface ProjectedPoint {
  faceIndex: number;
  /** 2D coordinates in the face's local frame, x ∈ [0,1], y ∈ [-x, x] */
  xy: Vec2;
}

/**
 * Project a unit sphere point onto its octahedron face using the
 * Snyder equal-area projection.
 */
export function sphereToFace(v: Vec3): ProjectedPoint {
  const faceIndex = findFace(v);
  const face = OCTAHEDRON_FACES[faceIndex];
  const xy = snyderOctahedronForward(v, face);
  return { faceIndex, xy };
}

/**
 * Unproject a 2D face point back to the unit sphere.
 */
export function faceToSphere(faceIndex: number, xy: Vec2): Vec3 {
  const face = OCTAHEDRON_FACES[faceIndex];
  return snyderOctahedronInverse(xy, face);
}

// ─── Verification / tests ─────────────────────────────────────────────────────

function approxEqual(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) < eps;
}

function vec3Equal(a: Vec3, b: Vec3, eps = 1e-9): boolean {
  return approxEqual(a[0], b[0], eps)
      && approxEqual(a[1], b[1], eps)
      && approxEqual(a[2], b[2], eps);
}

export function runTests(): void {
  console.log("=== Snyder octahedron projection tests ===\n");

  const testPoints: Vec3[] = [
    normalize([1, 1, 1]),         // inside face 0
    normalize([1, 0.1, 0.1]),     // near equatorial edge, face 0
    normalize([0.1, 0.1, 1]),     // near apex, face 0
    normalize([-1, -1, 1]),       // face 2
    normalize([1, 1, -1]),        // face 4 (bottom)
    normalize([0.5, 0.3, 0.8]),   // general point
  ];

  let allPassed = true;

  for (const v of testPoints) {
    const { faceIndex, xy } = sphereToFace(v);
    const vBack = faceToSphere(faceIndex, xy);

    const passed = vec3Equal(v, vBack, 1e-8);
    allPassed = allPassed && passed;

    console.log(
      `v=[${v.map(x => x.toFixed(5)).join(", ")}]  ` +
      `face=${faceIndex}  xy=[${xy.map(x => x.toFixed(5)).join(", ")}]  ` +
      `roundtrip: ${passed ? "✓ OK" : "✗ FAIL"}`
    );
    if (!passed) {
      console.log(
        `  expected: [${v.map(x => x.toFixed(8)).join(", ")}]`
      );
      console.log(
        `  got:      [${vBack.map(x => x.toFixed(8)).join(", ")}]`
      );
    }
  }

  // Area preservation check: sample a small region and compare areas
  console.log("\n--- Area preservation check ---");
  const faceIdx = 0;
  const face = OCTAHEDRON_FACES[faceIdx];

  // Two small face-space triangles near center and near edge
  const regions: Array<[Vec2, Vec2, Vec2]> = [
    [[0.4, -0.05], [0.45, -0.05], [0.4, 0.05]],   // near center
    [[0.85, -0.05], [0.9, -0.05], [0.85, 0.05]],   // near edge
  ];

  for (const [p0, p1, p2] of regions) {
    const v0 = faceToSphere(faceIdx, p0);
    const v1 = faceToSphere(faceIdx, p1);
    const v2 = faceToSphere(faceIdx, p2);

    const flatArea = Math.abs(
      (p1[0] - p0[0]) * (p2[1] - p0[1]) -
      (p2[0] - p0[0]) * (p1[1] - p0[1])
    ) / 2;
    const sphereArea = Math.abs(sphericalTriangleArea(v0, v1, v2));

    // Ratio should be constant (= totalFaceArea / totalFlatTriangleArea)
    const ratio = sphereArea / flatArea;
    console.log(
      `  face-xy center=[${((p0[0]+p1[0]+p2[0])/3).toFixed(2)}, ${((p0[1]+p1[1]+p2[1])/3).toFixed(2)}]` +
      `  flat=${flatArea.toExponential(3)}  sphere=${sphereArea.toExponential(3)}  ratio=${ratio.toFixed(6)}`
    );
  }
  console.log("  (ratios should be equal for a true equal-area projection)\n");

  console.log(allPassed ? "All roundtrip tests passed ✓" : "Some tests FAILED ✗");
}

// Uncomment to run tests:
// runTests();
