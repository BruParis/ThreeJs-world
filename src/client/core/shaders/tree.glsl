// Tree coverage — reusable GLSL fragment.
//
// Exposes:
//   float ComputeTreeMap(float elevation, float ridgeMap, float normalY,
//                        vec3 P, bool isWater, bool isGrass, float noiseFade)
//
// Returns an unclamped tree density value.  Positive = tree-covered, negative =
// bare ground.  Callers must clamp before use (threshold for isTree is 0.36).
//
// Parameters:
//   elevation – normalised elevation [0, 1]
//   ridgeMap  – erosion ridge signal [-1, 1]; negative values indicate gullies
//   normalY   – cosine between the surface normal and "up" (flat = 1, cliff = 0)
//   P         – 3D position in terrain units (used for high-frequency tree noise)
//   isWater   – pre-classified water flag; returns 0 immediately if true
//   isGrass   – preliminary grass-zone flag (elevation + slope, without !isTree)
//   noiseFade – 1 = full tree noise, 0 = noise replaced by its mean; lower it when
//               the noise is finer than the sampling footprint (distant terrain)
//
// Requirements before including this snippet:
//   GRASS_HEIGHT  must be defined (upper elevation limit for trees)
//   uSeaLevel     uniform must be in scope (declared in the fragment shader)
//
#include "../noise/fractalNoise3.glsl"

uniform int   uTreeEnabled;
uniform float uTreeElevMax;
uniform float uTreeElevMin;
uniform float uTreeSlopeMin;
uniform float uTreeRidgeMin;
uniform float uTreeNoiseFreq;
uniform float uTreeNoisePow;
uniform float uTreeDensity;
uniform float uTreeBumpStrength;

// Returns a signed tree-density value.
// Positive  → trees present; negative → no trees (bare ground / water / cliff).
float _treesAmount(float height, float normalY, float ridgeMap) {
    return ((
        // Elevation gate: trees only in the grass/low-land zone.
        smoothstep(uTreeElevMax, uTreeElevMin, height + 0.01)
        // Slope gate: trees on reasonably flat surfaces, absent on cliffs.
        * smoothstep(uTreeSlopeMin, 1.0, normalY)
        // Ridge gate: suppress trees along erosion ridges / gullies.
        * smoothstep(uTreeRidgeMin, 0.0, ridgeMap)
    ) - 0.5) / 0.6;
}

// Returns raw tree coverage density for the given surface.
// Takes individual fields instead of a struct — many WebGL2 drivers reject
// struct types in function parameter positions.
//
// isWater — pre-classified water flag from terrainClassificationGLSL; if true,
//           returns 0 immediately (replaces the per-sample uSeaLevel smoothstep).
// isGrass — preliminary grass-zone flag (elevation + slope, without !isTree);
//           gates trees to grass-zone areas by design.
//
// Output range: roughly [-(uTreeDensity * 1.83), +(uTreeDensity * 0.83)].
//   Positive  → tree cover (threshold for isTree is 0.36).
//   Negative  → bare ground / water / cliff.
// The output is NOT clamped to [0, 1] by design — callers must clamp before use.
float ComputeTreeMap(float elevation, float ridgeMap, float normalY, vec3 P, bool isWater, bool isGrass, float noiseFade) {
    if (uTreeEnabled == 0) return 0.0;
    if (isWater) return 0.0;
    if (!isGrass) return 0.0;

    float treesAmount = _treesAmount(elevation, normalY, ridgeMap);

    // Noise breaks up the tree boundary organically.
    // treeNoise ∈ [0, 1]; pow() sharpens the cutoff (higher uTreeNoisePow = patchier).
    float treeNoise = 0.5;
    if (noiseFade > 0.0) {
        treeNoise = mix(0.5, noised3(P * uTreeNoiseFreq).x * 0.5 + 0.5, noiseFade);
    }
    return (treesAmount - pow(treeNoise, uTreeNoisePow)) * uTreeDensity;
}

