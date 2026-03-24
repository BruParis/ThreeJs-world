# Everett–Praun Cube-to-Sphere Mapping

A low-distortion bijection between the surface of a cube and the unit sphere, suitable for general-purpose quadrilateralized sphere implementations.

---

## Overview

The Everett–Praun mapping (also called the **tan-warp** or **tangent mapping**) corrects the severe area distortion of the naive gnomonic (central) projection by pre-warping face-local coordinates through an arctangent before normalizing to the sphere. The result is near-uniform cell area and low angular distortion across the entire face.

| Property | Value |
|---|---|
| Max area ratio | ~1.2× (vs ~5.8× for gnomonic) |
| Angular distortion | Very low |
| Equal-area | No (use COBE QSC if exact equal-area is required) |
| Conformal | No |
| Invertible | Yes, closed-form |

---

## Convention

Each cube face has **face-local coordinates** `(u, v) ∈ [−1, 1]²` centered at the face center.  
The **dominant axis** `z` points outward from the face. `x` and `y` are the two tangent axes.

---

## Forward Mapping: Cube → Sphere

Given a face-local coordinate `(u, v)`, compute the sphere point:

```
x' = tan(u · π/4)
y' = tan(v · π/4)
z' = 1

sphere_point = normalize(x', y', z')
             = (x', y', z') / ‖(x', y', z')‖
```

### Derivation note

The factor `π/4` maps `u = ±1` to `tan(±π/4) = ±1`, so the warp is anchored at the face center and edges. The tangent function stretches coordinates toward the corners, counteracting the gnomonic compression that would otherwise occur there.

---

## Inverse Mapping: Sphere → Cube

Given a point `p = (px, py, pz)` on the unit sphere:

**1. Select the dominant face** by finding the axis with the largest absolute component:

```
face = argmax( |px|, |py|, |pz| )
sign = sign of that component
```

**2. Project to face-local coordinates** (gnomonic projection, then adjust for winding):

```
-- For face +Z (pz > 0):
   x = px / az,   y = py / az

-- For face −Z (pz < 0):
   x = −px / az,  y = py / az

-- For face +X (px > 0):
   x = −pz / px,  y = py / ax

-- For face −X (px < 0):
   x = pz / (−px),  y = py / ax

-- For face +Y (py > 0):
   x = px / ay,   y = pz / ay

-- For face −Y (py < 0):
   x = px / ay,   y = −pz / ay
```

Where `ax = |px|`, `ay = |py|`, `az = |pz|`.

**3. Apply the inverse warp:**

```
u = (4/π) · arctan(x)
v = (4/π) · arctan(y)
```

Result: `(u, v) ∈ [−1, 1]²`

### Derivation note

The inverse warp constant is `4/π`, not `2/π`. This is because the forward mapping uses `tan(u · π/4)`, so the inverse is:
```
u = arctan(x) / (π/4) = (4/π) · arctan(x)
```

---

## TypeScript Reference Implementation

```typescript
/** π/4 constant for forward mapping: x' = tan(u * π/4) */
const PI_OVER_4 = Math.PI / 4;

/** 4/π constant for inverse mapping: u = (4/π) * arctan(x') */
const FOUR_OVER_PI = 4 / Math.PI;

/** Normalize a 3-vector (returns a new array). */
function normalize(v: [number, number, number]): [number, number, number] {
  const len = Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2);
  return [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * Cube face → sphere point.
 * @param u  Face-local coordinate in [−1, 1]
 * @param v  Face-local coordinate in [−1, 1]
 * @returns  Unit sphere point [x, y, z] for the +Z face.
 *           Rotate into world space per face after calling.
 */
export function cubeToSphere(u: number, v: number): [number, number, number] {
  const xw = Math.tan(u * PI_OVER_4);
  const yw = Math.tan(v * PI_OVER_4);
  return normalize([xw, yw, 1]);
}

/** Enum for the six cube faces. */
export const enum CubeFace {
  PosX = 0, NegX = 1,
  PosY = 2, NegY = 3,
  PosZ = 4, NegZ = 5,
}

/**
 * Sphere point → cube face + face-local coordinates.
 * @param px  x component of unit sphere point
 * @param py  y component
 * @param pz  z component
 */
export function sphereToCube(
  px: number, py: number, pz: number
): { face: CubeFace; u: number; v: number } {
  const ax = Math.abs(px), ay = Math.abs(py), az = Math.abs(pz);

  let face: CubeFace;
  let x: number, y: number;

  if (ax >= ay && ax >= az) {
    // X-dominant
    face = px > 0 ? CubeFace.PosX : CubeFace.NegX;
    x = px > 0 ? -pz / px : pz / (-px);
    y = py / ax;
  } else if (ay >= ax && ay >= az) {
    // Y-dominant
    face = py > 0 ? CubeFace.PosY : CubeFace.NegY;
    x = px / ay;
    y = py > 0 ? pz / ay : -pz / ay;
  } else {
    // Z-dominant
    face = pz > 0 ? CubeFace.PosZ : CubeFace.NegZ;
    x = pz > 0 ? px / az : -px / az;
    y = py / az;
  }

  const u = FOUR_OVER_PI * Math.atan(x);
  const v = FOUR_OVER_PI * Math.atan(y);

  return { face, u, v };
}
```

---

## Distortion Characteristics

```
u (face coord)    gnomonic stretch    tan-warp stretch
──────────────    ────────────────    ────────────────
0.0  (center)         1.00×               1.00×
0.5                   1.41×               1.07×
0.8                   2.24×               1.15×
1.0  (corner)         5.83×               1.20×
```

The maximum area ratio of **~1.20×** at face corners makes this mapping suitable for any application where cell uniformity matters but strict equal-area is not required.

---

## References

- Praun, E. & Hoppe, H. (2003). *Spherical Parametrization and Remeshing.* SIGGRAPH.
- O'Neill, E. M. (1976). *Report on the COBE Quadrilateralized Spherical Cube Projection.* Goddard Space Flight Center.
- Everett, M. (1997). Derivation notes on tangent-based cube-sphere bijections.
- Chan, C. & O'Neill, E. M. (1975). *Feasibility Study of a Quadrilateralized Spherical Cube Earth Data Base.*
