// 3D gradient noise with analytic derivatives, and a derivative-tracking FBM.
//
// This is the 3D counterpart of the 2D `noised` / `FractalNoise` pair: it is
// sampled at a 3D position (a point on the planet, in terrain units), so the
// result is seamless over the whole sphere.
//
// The lattice hash is integer based (PCG).  Float hashes of the
// `fract(x * y * (x + y))` family lose all their bits a few hundred cells away
// from the origin, and planet-sized coordinates are far beyond that.
//
// Exposes:
//   vec3 hash33(vec3 cell)
//     Pseudo-random vector in [-1, 1]^3 for an integer lattice cell.
//
//   vec4 noised3(vec3 p)
//     Gradient noise.  Returns vec4(value, dvalue/dx, dvalue/dy, dvalue/dz).
//     The value is approximately in [-1, 1].
//
//   float terrainBandWeight(float wavelength, float texelSize)
//     Weight in [0, 1] for a noise octave of the given wavelength when it is
//     sampled on a grid of the given spacing: 1 from four texels per wavelength,
//     fading to 0 at two (the Nyquist limit).  texelSize <= 0 disables the fade.
//
//   vec4 FractalNoise3(vec3 p, float freq, int octaves, float lacunarity,
//                      float gain, float texelSize)
//     Band-limited FBM.  Returns vec4(value, gradient).
//
// Safe to include more than once in the same shader.
//
#ifndef FRACTAL_NOISE3_GLSL
#define FRACTAL_NOISE3_GLSL

uvec3 _pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  return v;
}

// cell must hold integer values (the result of floor()).
vec3 hash33(vec3 cell) {
  uvec3 h = _pcg3d(uvec3(ivec3(cell)));
  return vec3(h >> 8u) * (2.0 / 16777215.0) - 1.0;
}

vec4 noised3(in vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);

  vec3 u  = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec3 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);

  vec3 ga = hash33(i + vec3(0.0, 0.0, 0.0));
  vec3 gb = hash33(i + vec3(1.0, 0.0, 0.0));
  vec3 gc = hash33(i + vec3(0.0, 1.0, 0.0));
  vec3 gd = hash33(i + vec3(1.0, 1.0, 0.0));
  vec3 ge = hash33(i + vec3(0.0, 0.0, 1.0));
  vec3 gf = hash33(i + vec3(1.0, 0.0, 1.0));
  vec3 gg = hash33(i + vec3(0.0, 1.0, 1.0));
  vec3 gh = hash33(i + vec3(1.0, 1.0, 1.0));

  float va = dot(ga, f - vec3(0.0, 0.0, 0.0));
  float vb = dot(gb, f - vec3(1.0, 0.0, 0.0));
  float vc = dot(gc, f - vec3(0.0, 1.0, 0.0));
  float vd = dot(gd, f - vec3(1.0, 1.0, 0.0));
  float ve = dot(ge, f - vec3(0.0, 0.0, 1.0));
  float vf = dot(gf, f - vec3(1.0, 0.0, 1.0));
  float vg = dot(gg, f - vec3(0.0, 1.0, 1.0));
  float vh = dot(gh, f - vec3(1.0, 1.0, 1.0));

  float kxy  = va - vb - vc + vd;
  float kyz  = va - vc - ve + vg;
  float kzx  = va - vb - ve + vf;
  float kxyz = -va + vb + vc - vd + ve - vf - vg + vh;

  float value = va
              + u.x * (vb - va) + u.y * (vc - va) + u.z * (ve - va)
              + u.x * u.y * kxy + u.y * u.z * kyz + u.z * u.x * kzx
              + u.x * u.y * u.z * kxyz;

  vec3 grad = ga
            + u.x * (gb - ga) + u.y * (gc - ga) + u.z * (ge - ga)
            + u.x * u.y * (ga - gb - gc + gd)
            + u.y * u.z * (ga - gc - ge + gg)
            + u.z * u.x * (ga - gb - ge + gf)
            + u.x * u.y * u.z * (-ga + gb + gc - gd + ge - gf - gg + gh)
            + du * (vec3(vb, vc, ve) - va
                    + u.yzx * vec3(kxy, kyz, kzx)
                    + u.zxy * vec3(kzx, kxy, kyz)
                    + u.yzx * u.zxy * kxyz);

  return vec4(value, grad);
}

float terrainBandWeight(float wavelength, float texelSize) {
  if (texelSize <= 0.0) return 1.0;
  // Fully kept from 4 texels per wavelength, gone at 2 (the Nyquist limit).
  return clamp(wavelength / (2.0 * texelSize) - 1.0, 0.0, 1.0);
}

vec4 FractalNoise3(vec3 p, float freq, int octaves, float lacunarity, float gain, float texelSize) {
  vec4  n  = vec4(0.0);
  float nf = freq;
  float na = 1.0;
  for (int i = 0; i < octaves; i++) {
    float w = terrainBandWeight(1.0 / nf, texelSize);
    if (w > 0.0) {
      n += noised3(p * nf) * (na * w) * vec4(1.0, nf, nf, nf);
    }
    na *= gain;
    nf *= lacunarity;
  }
  return n;
}

#endif
