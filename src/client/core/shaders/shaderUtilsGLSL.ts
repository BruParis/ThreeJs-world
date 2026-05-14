/**
 * General-purpose GLSL utility functions.
 *
 * Exposes:
 *
 *   Math macros
 *     DEG_TO_RAD        — degrees-to-radians conversion factor (assumes PI in scope)
 *     saturate(x)       — clamp(x, 0.0, 1.0), named after HLSL saturate
 *     sq(x)             — squares its argument
 *     clamp01(x)        — clamp(x, 0.0, 1.0)
 *
 *   Normal mapping
 *     vec3 RNM(vec3 n1, vec3 n2)
 *       Reoriented Normal Mapping blend — combines two tangent-space normals
 *       without the cancellation artifacts of additive or UDN blending.
 */

export const shaderUtilsGLSL = /* glsl */`

// ── Math macros ───────────────────────────────────────────────────────────────

// Converts degrees to radians.
#define DEG_TO_RAD (PI / 180.0)

// Clamps x to [0, 1].  Named after HLSL's saturate().
#define saturate(x) clamp(x, 0.0, 1.0)

// Squares its argument.
#define sq(x) ((x)*(x))

#define clamp01(x) clamp(x, 0.0, 1.0)

// ── Normal mapping ────────────────────────────────────────────────────────────

// Reoriented Normal Mapping (RNM) blend.
// Combines two tangent-space normal maps n1 (base) and n2 (detail) without
// the z-component cancellation that occurs with simple additive blending.
// Both inputs should be in [-1,1] tangent space; output is the blended normal
// (not normalised — caller should normalise if needed).
vec3 RNM(vec3 n1, vec3 n2)
{
    // Shift n1 into the "whiteout" hemisphere, flip n2's xy to match convention.
    n1 += vec3( 0.0,  0.0, 1.0);
    n2 *= vec3(-1.0, -1.0, 1.0);
    // Project n2 onto the plane whose normal is n1, then subtract n2.
    return n1 * dot(n1, n2) / n1.z - n2;
}

`;
