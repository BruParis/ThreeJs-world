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

#ifndef PI
#define PI 3.14159265358979323846
#endif

// Converts degrees to radians.
#define DEG_TO_RAD (PI / 180.0)

// Clamps x to [0, 1].  Named after HLSL's saturate().
#define saturate(x) clamp(x, 0.0, 1.0)

// Squares its argument.
#define sq(x) ((x)*(x))


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


// ── Geometry / raymarching ────────────────────────────────────────────────────

// Ray vs axis-aligned box intersection.
// ro        — ray origin
// rd        — ray direction (need not be normalised)
// boxSize   — half-extents of the box (box spans [-boxSize, +boxSize])
// outNormal — geometric normal at the near-hit face (only valid on a hit)
// Returns vec2(tNear, tFar).  Returns (-1, -1) if the ray misses or the box
// is entirely behind the origin.
// Reference: https://iquilezles.org/articles/intersectors
vec2 boxIntersection( in vec3 ro, in vec3 rd, vec3 boxSize, out vec3 outNormal )
{
    // Precompute per-axis reciprocal and slab half-widths in ray space.
    vec3 m = 1.0 / rd;
    vec3 n = m * ro;
    vec3 k = abs(m) * boxSize;

    // Near and far intersection distances for each slab pair.
    vec3 t1 = -n - k;
    vec3 t2 = -n + k;

    // The ray enters the box when it has passed all three near slabs,
    // and exits at the first far slab it leaves.
    float tN = max( max( t1.x, t1.y ), t1.z );
    float tF = min( min( t2.x, t2.y ), t2.z );

    // Miss: near > far (ray passes beside box) or box is behind origin.
    if ( tN > tF || tF < 0.0 ) return vec2(-1.0);

    // The outward face normal is the axis with the largest near-slab value,
    // oriented opposite to the ray direction on that axis.
    outNormal = -sign(rd) * step(t1.yzx, t1.xyz) * step(t1.zxy, t1.xyz);
    return vec2( tN, tF );
}


// ── Camera helpers ────────────────────────────────────────────────────────────

// Generates a view-space ray direction for a pixel at 'pos' in a viewport of
// 'size' pixels, using a vertical field-of-view of 'fov' degrees.
// The returned ray points in the -Z direction (right-handed view space).
// Reference: https://www.shadertoy.com/view/XsB3Rm
vec3 CameraRay(float fov, vec2 size, vec2 pos)
{
    // Shift pixel centre to viewport centre.
    vec2 xy = pos - size * 0.5;
    // Focal length derived from the desired vertical FOV.
    float cot_half_fov = tan( ( 90.0 - fov * 0.5 ) * DEG_TO_RAD );
    float z = size.y * 0.5 * cot_half_fov;
    return normalize( vec3( xy, -z ) );
}

// Builds a 3×3 rotation matrix from pitch (angle.x) and yaw (angle.y) in radians.
// Suitable for transforming a view-space ray into world space.
mat3 CameraRotation(vec2 angle)
{
    vec2 c = cos(angle);
    vec2 s = sin(angle);
    // Column-major: CameraRotation * viewRay = worldRay
    return mat3(
        c.y      ,  0.0, -s.y,       // column 0
        s.y * s.x,  c.x,  c.y * s.x, // column 1
        s.y * c.x, -s.x,  c.y * c.x  // column 2
    );
}


// ── Lighting ──────────────────────────────────────────────────────────────────

// Minimal ambient sky colour for a ray in direction 'rd' towards a sun at 'sun'.
// The intensity is weakest when the ray is aligned with the sun (direct path)
// and strongest when perpendicular.
// NOTE: requires AMBIENT_COLOR to be defined by the including shader.
vec3 SkyColor(vec3 rd, vec3 sun)
{
    float costh = dot(rd, sun);
    // Scale ambient by PI (energy conservation) and dim near the sun direction.
    return AMBIENT_COLOR * PI * (1.0 - abs(costh) * 0.8);
}

// ACES filmic tone-mapping curve.
// Maps HDR linear radiance to display-referred [0,1] range.
// Reference: Narkowicz 2015, "ACES Filmic Tone Mapping Curve"
vec3 Tonemap_ACES(vec3 x)
{
    const float a = 2.51;
    const float b = 0.03;
    const float c = 2.43;
    const float d = 0.59;
    const float e = 0.14;
    return (x * (a * x + b)) / (x * (c * x + d) + e);
}


// ── BRDF ──────────────────────────────────────────────────────────────────────
// Reference: https://www.shadertoy.com/view/XlKSDR

// Helper: x^5 computed via two squarings — avoids pow() overhead.
float pow5(float x)
{
    float x2 = x * x;
    return x2 * x2 * x;
}

// GGX / Trowbridge-Reitz normal distribution function (NDF).
// Gives the relative area of microfacets aligned with half-vector h.
// Higher linearRoughness → broader specular lobe.
// Reference: Walter et al. 2007, "Microfacet Models for Refraction through Rough Surfaces"
float D_GGX(float linearRoughness, float NoH, const vec3 h)
{
    float oneMinusNoHSquared = 1.0 - NoH * NoH;
    float a = NoH * linearRoughness;
    float k = linearRoughness / (oneMinusNoHSquared + a * a);
    float d = k * k * (1.0 / PI);
    return d;
}

// Correlated Smith height-correlated visibility (masking-shadowing) function.
// Accounts for the statistical correlation between masking and shadowing on a
// rough surface — more accurate than the uncorrelated form.
// Reference: Heitz 2014, "Understanding the Masking-Shadowing Function in
// Microfacet-Based BRDFs"
float V_SmithGGXCorrelated(float linearRoughness, float NoV, float NoL)
{
    float a2   = linearRoughness * linearRoughness;
    float GGXV = NoL * sqrt((NoV - a2 * NoV) * NoV + a2);
    float GGXL = NoV * sqrt((NoL - a2 * NoL) * NoL + a2);
    return 0.5 / (GGXV + GGXL);
}

// Schlick Fresnel for specular reflectance (conductor / dielectric).
// f0  — reflectance at normal incidence (specular colour).
// VoH — dot(view, half-vector).
// At grazing angles (VoH → 0) the surface reflects like a perfect mirror.
// Reference: Schlick 1994, "An Inexpensive BRDF Model for Physically-Based Rendering"
vec3 F_Schlick(const vec3 f0, float VoH)
{
    return f0 + (vec3(1.0) - f0) * pow5(1.0 - VoH);
}

// Scalar Schlick Fresnel used inside the Disney diffuse term for the
// retro-reflective edge darkening/brightening.
float F_Schlick(float f0, float f90, float VoH)
{
    return f0 + (f90 - f0) * pow5(1.0 - VoH);
}

// Disney diffuse BRDF (Burley 2012).
// Adds a subtle retro-reflective peak at grazing angles relative to pure Lambert.
// The f90 term causes slightly darker edges on rough surfaces and brighter
// edges on smooth surfaces, matching measured cloth/plastic data.
// Reference: Burley 2012, "Physically-Based Shading at Disney"
float Fd_Burley(float linearRoughness, float NoV, float NoL, float LoH)
{
    float f90         = 0.5 + 2.0 * linearRoughness * LoH * LoH;
    float lightScatter = F_Schlick(1.0, f90, NoL);
    float viewScatter  = F_Schlick(1.0, f90, NoV);
    return lightScatter * viewScatter * (1.0 / PI);
}

// Lambertian diffuse normalisation constant: 1/π.
float Fd_Lambert()
{
    return 1.0 / PI;
}

// Full PBR shade evaluation for a single punctual light.
// diffuse    — albedo colour (linear)
// f0         — specular reflectance at normal incidence
// smoothness — perceptual smoothness [0=rough, 1=mirror]; converted to linearRoughness internally
// n          — surface normal (unit vector, world space)
// v          — view direction (from surface toward camera, unit)
// l          — light direction (from surface toward light, unit)
// lc         — light colour × intensity (linear)
// Returns incident radiance from this light at the surface point.
vec3 Shade(vec3 diffuse, vec3 f0, float smoothness, vec3 n, vec3 v, vec3 l, vec3 lc)
{
    vec3 h = normalize(v + l);  // half-vector

    // Clamp or guard dot products to valid ranges.
    float NoV = abs(dot(n, v)) + 1e-5;  // 1e-5 avoids division by zero
    float NoL = saturate(dot(n, l));
    float NoH = saturate(dot(n, h));
    float LoH = saturate(dot(l, h));

    // Convert perceptual smoothness to linear roughness (squared remapping).
    float roughness       = 1.0 - smoothness;
    float linearRoughness = roughness * roughness;

    // Specular BRDF: D (distribution) × V (visibility) × F (Fresnel).
    float D  = D_GGX(linearRoughness, NoH, h);
    float Vs = V_SmithGGXCorrelated(linearRoughness, NoV, NoL);
    vec3  F  = F_Schlick(f0, LoH);
    vec3  Fr = (D * Vs) * F;   // specular lobe

    // Diffuse BRDF.
    vec3 Fd = diffuse * Fd_Burley(linearRoughness, NoV, NoL, LoH);

    // Combine: Lambert cosine (NoL) × light colour.
    return (Fd + Fr) * lc * NoL;
}


// ── Atmosphere ────────────────────────────────────────────────────────────────

// Rayleigh and Mie scattering coefficients at sea level (m^-1).
// Rayleigh scatters blue strongly (wavelength^-4), giving the blue sky.
// Mie scattering is wavelength-independent, causing haze and the white glow near the sun.
#define C_RAYLEIGH (vec3(5.802, 13.558, 33.100) * 1e-6)
#define C_MIE      (vec3(3.996,  3.996,  3.996) * 1e-6)

// Rayleigh phase function.
// costh — cosine of the scattering angle (dot(viewDir, lightDir)).
// Symmetric: scatters equally forward and backward, with nulls at 90°.
float PhaseRayleigh(float costh)
{
    return 3.0 * (1.0 + costh * costh) / (16.0 * PI);
}

// Henyey–Greenstein approximation of the Mie scattering phase function.
// costh — cosine of the scattering angle.
// g     — asymmetry parameter in (-1, 1).
//           g > 0: forward-scattering (aerosols, fog → glow around the sun)
//           g = 0: isotropic (equivalent to Rayleigh shape-wise)
//           g < 0: back-scattering (rare in atmosphere)
float PhaseMie(float costh, float g)
{
    // Clamp g to avoid singularities as kcosth approaches 1.
    g = min(g, 0.9381);
    // Cornette-Shanks rational approximation (improves on basic HG at high g).
    float k      = 1.55 * g - 0.55 * g * g * g;
    float kcosth = k * costh;
    return (1.0 - k * k) / ((4.0 * PI) * (1.0 - kcosth) * (1.0 - kcosth));
}

`;
