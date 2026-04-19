/**
 * Tree coverage — reusable GLSL fragment.
 *
 * Exposes:
 *   float GetTreesAmount(float height, float normalY, float occlusion, float ridgeMap)
 *
 * Returns a density value centred on zero: positive = tree-covered, negative =
 * bare ground.  Callers typically remap or clamp before use.
 *
 * Parameters:
 *   height    – normalised elevation [0, 1]
 *   normalY   – world-space Y component of the surface normal (flat = 1, cliff = 0)
 *   occlusion – ambient occlusion / cavity in [0, 1]  (0 = fully occluded, 1 = open sky)
 *   ridgeMap  – erosion ridge signal; negative values indicate gullies / ridges
 *
 * Requirements before including this snippet:
 *   GRASS_HEIGHT  must be defined (upper elevation limit for trees)
 *   WATER_HEIGHT  must be defined when the WATER flag is set
 *   Define WATER to enable the below-water suppression term.
 */

export const TERRAIN_GRASS_HEIGHT = 0.50;

export const treeGLSL = /* glsl */`

// Returns a signed tree-density value.
// Positive  → trees present; negative → no trees (bare ground / water / cliff).
float GetTreesAmount(float height, float normalY, float occlusion, float ridgeMap) {
    return ((
        // Elevation gate: trees only in the grass/low-land zone.
        smoothstep(
            GRASS_HEIGHT + 0.05,
            GRASS_HEIGHT + 0.01,
            height + 0.01 + (occlusion - 0.8) * 0.05
        )
        // Occlusion gate: suppress trees in fully occluded hollows.
        * smoothstep(0.0, 0.4, occlusion)
        // Slope gate: trees on reasonably flat surfaces, absent on cliffs.
        * smoothstep(0.65, 0.82, normalY)
        // Ridge gate: suppress trees along erosion ridges / gullies.
        * smoothstep(-1.4, 0.0, ridgeMap)
        #if defined(WATER)
        // Water gate: suppress trees below the water line.
        * smoothstep(
            WATER_HEIGHT + 0.000,
            WATER_HEIGHT + 0.007,
            height
        )
        #endif
    ) - 0.5) / 0.6;
}

`;
