/**
 * General-purpose GLSL utility functions.
 *
 * Extracted from clayjohn's "Eroded Terrain Noise" ShaderToy
 * (https://www.shadertoy.com/view/MtGcWh) and IQ's reference implementations.
 *
 * Exposes (in roughly dependency order):
 *
 *   Math macros
 *     PI, DEG_TO_RAD, saturate(x), sq(x)
 *
 *   Normal mapping
 *     vec3 RNM(vec3 n1, vec3 n2)
 *       Reoriented Normal Mapping blend — combines two tangent-space normals
 *       without the cancellation artifacts of additive or UDN blending.
 *
 *   Geometry / raymarching
 *     vec2 boxIntersection(vec3 ro, vec3 rd, vec3 boxSize, out vec3 outNormal)
 *       Ray vs axis-aligned box intersection. Returns (tNear, tFar) or (-1,-1)
 *       on miss. outNormal is the geometric normal at the near hit face.
 *
 *   Camera helpers
 *     vec3 CameraRay(float fov, vec2 size, vec2 pos)
 *       Generates a view-space ray direction from pixel position, viewport
 *       size, and vertical field-of-view (degrees).
 *     mat3 CameraRotation(vec2 angle)
 *       Euler rotation matrix from (pitch, yaw) angles (radians).
 *
 *   Lighting
 *     vec3 SkyColor(vec3 rd, vec3 sun)
 *       Minimal ambient sky — modulates AMBIENT_COLOR by the cosine of the
 *       angle between the ray and the sun direction.
 *       NOTE: AMBIENT_COLOR must be defined before including this snippet.
 *     vec3 Tonemap_ACES(vec3 x)
 *       Narkowicz 2015 ACES filmic curve.
 *
 *   BRDF  (https://www.shadertoy.com/view/XlKSDR)
 *     float D_GGX(float linearRoughness, float NoH, vec3 h)
 *       GGX / Trowbridge-Reitz normal distribution function.
 *     float V_SmithGGXCorrelated(float linearRoughness, float NoV, float NoL)
 *       Correlated Smith visibility function (Heitz 2014).
 *     vec3  F_Schlick(vec3 f0, float VoH)
 *       Fresnel reflectance (specular, conductor form).
 *     float F_Schlick(float f0, float f90, float VoH)
 *       Fresnel reflectance (dielectric form, for diffuse roughness correction).
 *     float Fd_Burley(float linearRoughness, float NoV, float NoL, float LoH)
 *       Disney diffuse BRDF (Burley 2012).
 *     float Fd_Lambert()
 *       Lambertian diffuse normalization constant.
 *     vec3  Shade(vec3 diffuse, vec3 f0, float smoothness,
 *                 vec3 n, vec3 v, vec3 l, vec3 lc)
 *       Full PBR shade call — returns combined diffuse + specular radiance
 *       for a single punctual light.
 *
 *   Atmosphere phase functions
 *     C_RAYLEIGH, C_MIE  — scattering coefficients at sea level
 *     float PhaseRayleigh(float costh)
 *       Rayleigh scattering phase function (isotropic molecules).
 *     float PhaseMie(float costh, float g)
 *       Henyey–Greenstein approximation of Mie scattering (aerosols / haze).
 *       g is the asymmetry parameter; positive = forward-scattering.
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
