/**
 * Classic 3D Perlin noise — GLSL 3 implementation.
 *
 * The permutation table is NOT baked into the shader source.  Instead it is
 * provided at runtime via a 256×1 R32F DataTexture uniform (uPermTex).
 * This allows the seed to change without recompiling any shader.
 *
 * The texture is built CPU-side from PerlinNoise3D's permutation array and
 * uploaded once per seed change by TileShaderPatchOperation.
 *
 * Exposes two GLSL functions:
 *
 *   float perlinNoise(float x, float y, float z)
 *     Raw noise, output in [-1, 1].
 *     Matches PerlinNoise3D.noise(x, y, z) for the same permutation.
 *
 *   float perlinFbm(vec3 p, int octaves, float persistence, float lacunarity)
 *     Fractal Brownian Motion.  Output in [-1, 1].
 *     Matches PerlinNoise3D.fbm(x, y, z, octaves, persistence, lacunarity).
 */
export const perlinNoiseGLSL = /* glsl */`

// ── Classic 3D Perlin noise ───────────────────────────────────────────────
// Permutation table: 256×1 R32F texture, value = perm[i] as float.
// Wrap with (i & 255) — equivalent to the doubled-table trick.

uniform highp sampler2D uPermTex;

int _perm(int i) {
  // R32F stores exact float integers 0..255; cast is lossless.
  return int(texelFetch(uPermTex, ivec2(i & 255, 0), 0).r);
}

float _pfade(float t) {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

float _pgrad(int hash, float x, float y, float z) {
  int h = hash & 15;
  float u = (h < 8) ? x : y;
  float v = (h < 4) ? y : ((h == 12 || h == 14) ? x : z);
  return (((h & 1) == 0) ? u : -u) + (((h & 2) == 0) ? v : -v);
}

// Raw 3D Perlin noise.  Output in [-1, 1].
float perlinNoise(float x, float y, float z) {
  int X = int(floor(x)) & 255;
  int Y = int(floor(y)) & 255;
  int Z = int(floor(z)) & 255;
  x -= floor(x);
  y -= floor(y);
  z -= floor(z);
  float u = _pfade(x);
  float v = _pfade(y);
  float w = _pfade(z);
  int A  = _perm(X    ) + Y;
  int AA = _perm(A    ) + Z;  int AB = _perm(A + 1) + Z;
  int B  = _perm(X + 1) + Y;
  int BA = _perm(B    ) + Z;  int BB = _perm(B + 1) + Z;
  return mix(
    mix(
      mix(_pgrad(_perm(AA    ), x,      y,      z     ),
          _pgrad(_perm(BA    ), x-1.0,  y,      z     ), u),
      mix(_pgrad(_perm(AB    ), x,      y-1.0,  z     ),
          _pgrad(_perm(BB    ), x-1.0,  y-1.0,  z     ), u),
    v),
    mix(
      mix(_pgrad(_perm(AA + 1), x,      y,      z-1.0 ),
          _pgrad(_perm(BA + 1), x-1.0,  y,      z-1.0 ), u),
      mix(_pgrad(_perm(AB + 1), x,      y-1.0,  z-1.0 ),
          _pgrad(_perm(BB + 1), x-1.0,  y-1.0,  z-1.0 ), u),
    v),
  w);
}

// Fractal Brownian Motion.  Output in [-1, 1].
// Matches PerlinNoise3D.fbm(x, y, z, octaves, persistence, lacunarity).
float perlinFbm(vec3 p, int octaves, float persistence, float lacunarity) {
  float total  = 0.0;
  float amp    = 1.0;
  float freq   = 1.0;
  float maxVal = 0.0;
  for (int i = 0; i < octaves; i++) {
    total  += perlinNoise(p.x * freq, p.y * freq, p.z * freq) * amp;
    maxVal += amp;
    amp    *= persistence;
    freq   *= lacunarity;
  }
  return total / maxVal;
}

// ─────────────────────────────────────────────────────────────────────────────
`;
