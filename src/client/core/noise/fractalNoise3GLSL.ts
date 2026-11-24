/**
 * 3D gradient noise with analytic derivatives, and a derivative-tracking FBM.
 *
 * This is the 3D counterpart of the 2D `noised` / `FractalNoise` pair: it is
 * sampled at a 3D position (a point on the planet, in terrain units), so the
 * result is seamless over the whole sphere.
 *
 * The lattice hash is integer based (PCG).  Float hashes of the
 * `fract(x * y * (x + y))` family lose all their bits a few hundred cells away
 * from the origin, and planet-sized coordinates are far beyond that.
 *
 * Exposes:
 *   vec3 hash33(vec3 cell)
 *     Pseudo-random vector in [-1, 1]^3 for an integer lattice cell.
 *
 *   vec4 noised3(vec3 p)
 *     Gradient noise.  Returns vec4(value, dvalue/dx, dvalue/dy, dvalue/dz).
 *     The value is approximately in [-1, 1].
 *
 *   float terrainBandWeight(float wavelength, float texelSize)
 *     Weight in [0, 1] for a noise octave of the given wavelength when it is
 *     sampled on a grid of the given spacing: 1 from four texels per wavelength,
 *     fading to 0 at two (the Nyquist limit).  texelSize <= 0 disables the fade.
 *
 *   vec4 FractalNoise3(vec3 p, float freq, int octaves, float lacunarity,
 *                      float gain, float texelSize)
 *     Band-limited FBM.  Returns vec4(value, gradient).
 *
 * Safe to include more than once in the same shader.
 */

import fractalNoise3GLSLSource from './fractalNoise3.glsl';
/** GLSL source: fractalNoise3.glsl (flattened). */
export const fractalNoise3GLSL = fractalNoise3GLSLSource;
