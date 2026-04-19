/**
 * Derivative-tracking FBM over 2D value noise.
 *
 * Requires: noised(vec2) from heightmapGLSL to be in scope.
 *
 * Exposes:
 *   vec3 FractalNoise(vec2 p, float freq, int octaves, float lacunarity, float gain)
 *     Accumulates octaves of noised() with derivative scaling.
 *     Returns vec3(value, dvalue/dx, dvalue/dy).
 *     The value component is in approximately [-1, 1].
 */
export const fractalNoiseGLSL = /* glsl */`

// Derivative-tracking FBM. noised(vec2) must be in scope.
vec3 FractalNoise(vec2 p, float freq, int octaves, float lacunarity, float gain) {
    vec3 n = vec3(0.0);
    float nf = freq;
    float na = 1.0;
    for (int i = 0; i < octaves; i++) {
        n += noised(p * nf) * na * vec3(1.0, nf, nf);
        na *= gain;
        nf *= lacunarity;
    }
    return n;
}

`;
