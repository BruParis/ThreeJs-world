import { REFERENCE_PERMUTATION } from './PerlinReference';

/**
 * 3D Perlin Noise implementation with fractal variations.
 * Provides coherent noise suitable for terrain generation, textures, and procedural content.
 *
 * When constructed with no seed, uses the Ken Perlin reference permutation table
 * (see PerlinReference.ts).  This produces bit-for-bit identical output to the
 * GLSL perlinNoise() function in perlinGLSL.ts for the same (x, y, z) inputs.
 *
 * When constructed with a seed, the table is shuffled and output will differ
 * from the GPU shader (by design — seeded instances generate unique noise per plate).
 */
export class PerlinNoise3D {
  private permutation: number[];

  constructor(seed?: number) {
    this.permutation = [...REFERENCE_PERMUTATION];
    if (seed !== undefined) {
      this.shuffle(seed);
    }
    this.permutation = [...this.permutation, ...this.permutation];
  }

  /**
   * Returns the first 256 entries of the (doubled) permutation table.
   * Used by TileShaderPatchOperation to upload the table to the GPU as a texture.
   */
  getPermutation256(): number[] {
    return this.permutation.slice(0, 256);
  }

  private shuffle(seed: number): void {
    let rng = seed;
    for (let i = this.permutation.length - 1; i > 0; i--) {
      rng = (rng * 9301 + 49297) % 233280;
      const j = Math.floor((rng / 233280) * (i + 1));
      [this.permutation[i], this.permutation[j]] = [this.permutation[j], this.permutation[i]];
    }
  }

  private fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  // Derivative of fade function: d/dt[6t^5 - 15t^4 + 10t^3]
  private fadeDeriv(t: number): number {
    return 30 * t * t * (t * (t - 2) + 1);
  }

  private lerp(t: number, a: number, b: number): number {
    return a + t * (b - a);
  }

  private grad(hash: number, x: number, y: number, z: number): number {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  // Get gradient vector from hash (returns the actual gradient direction)
  private gradVec(hash: number): [number, number, number] {
    const h = hash & 15;
    // These are the 16 gradient directions used by Perlin noise
    const gradients: [number, number, number][] = [
      [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
      [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
      [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
      [1, 1, 0], [-1, 1, 0], [0, -1, 1], [0, -1, -1]
    ];
    return gradients[h];
  }


  /**
   * Compute raw Perlin noise at a 3D point.
   * @returns Value in range [-1, 1]
   */
  noise(x: number, y: number, z: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;

    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);

    const u = this.fade(x);
    const v = this.fade(y);
    const w = this.fade(z);

    const A = this.permutation[X] + Y;
    const AA = this.permutation[A] + Z;
    const AB = this.permutation[A + 1] + Z;
    const B = this.permutation[X + 1] + Y;
    const BA = this.permutation[B] + Z;
    const BB = this.permutation[B + 1] + Z;

    return this.lerp(w,
      this.lerp(v,
        this.lerp(u,
          this.grad(this.permutation[AA], x, y, z),
          this.grad(this.permutation[BA], x - 1, y, z)
        ),
        this.lerp(u,
          this.grad(this.permutation[AB], x, y - 1, z),
          this.grad(this.permutation[BB], x - 1, y - 1, z)
        )
      ),
      this.lerp(v,
        this.lerp(u,
          this.grad(this.permutation[AA + 1], x, y, z - 1),
          this.grad(this.permutation[BA + 1], x - 1, y, z - 1)
        ),
        this.lerp(u,
          this.grad(this.permutation[AB + 1], x, y - 1, z - 1),
          this.grad(this.permutation[BB + 1], x - 1, y - 1, z - 1)
        )
      )
    );
  }

  /**
   * Compute the gradient of the noise function at a point using finite differences.
   * @param epsilon Step size for numerical differentiation (smaller = more accurate but less stable)
   * @returns [dx, dy, dz] gradient vector
   */
  gradient(
    x: number,
    y: number,
    z: number,
    epsilon: number = 0.0001
  ): [number, number, number] {
    const dx = (this.noise(x + epsilon, y, z) - this.noise(x - epsilon, y, z)) / (2 * epsilon);
    const dy = (this.noise(x, y + epsilon, z) - this.noise(x, y - epsilon, z)) / (2 * epsilon);
    const dz = (this.noise(x, y, z + epsilon) - this.noise(x, y, z - epsilon)) / (2 * epsilon);

    return [dx, dy, dz];
  }

  /**
   * Analytical gradient computation
   * Returns the exact derivative at the point
   */
  gradientAnalytical(x: number, y: number, z: number): [number, number, number] {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;

    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const zf = z - Math.floor(z);

    const u = this.fade(xf);
    const v = this.fade(yf);
    const w = this.fade(zf);

    const du = this.fadeDeriv(xf);
    const dv = this.fadeDeriv(yf);
    const dw = this.fadeDeriv(zf);

    const A = this.permutation[X] + Y;
    const AA = this.permutation[A] + Z;
    const AB = this.permutation[A + 1] + Z;
    const B = this.permutation[X + 1] + Y;
    const BA = this.permutation[B] + Z;
    const BB = this.permutation[B + 1] + Z;

    // Get the 8 corner gradients
    const g000 = this.gradVec(this.permutation[AA]);
    const g100 = this.gradVec(this.permutation[BA]);
    const g010 = this.gradVec(this.permutation[AB]);
    const g110 = this.gradVec(this.permutation[BB]);
    const g001 = this.gradVec(this.permutation[AA + 1]);
    const g101 = this.gradVec(this.permutation[BA + 1]);
    const g011 = this.gradVec(this.permutation[AB + 1]);
    const g111 = this.gradVec(this.permutation[BB + 1]);

    // Dot products with position vectors
    const d000 = g000[0] * xf + g000[1] * yf + g000[2] * zf;
    const d100 = g100[0] * (xf - 1) + g100[1] * yf + g100[2] * zf;
    const d010 = g010[0] * xf + g010[1] * (yf - 1) + g010[2] * zf;
    const d110 = g110[0] * (xf - 1) + g110[1] * (yf - 1) + g110[2] * zf;
    const d001 = g001[0] * xf + g001[1] * yf + g001[2] * (zf - 1);
    const d101 = g101[0] * (xf - 1) + g101[1] * yf + g101[2] * (zf - 1);
    const d011 = g011[0] * xf + g011[1] * (yf - 1) + g011[2] * (zf - 1);
    const d111 = g111[0] * (xf - 1) + g111[1] * (yf - 1) + g111[2] * (zf - 1);

    // Trilinear interpolation for the value (we need intermediate values)
    const l00 = this.lerp(u, d000, d100);
    const l10 = this.lerp(u, d010, d110);
    const l01 = this.lerp(u, d001, d101);
    const l11 = this.lerp(u, d011, d111);

    const l0 = this.lerp(v, l00, l10);
    const l1 = this.lerp(v, l01, l11);

    // Derivatives with respect to x, y, z
    // d/dx uses chain rule: d/du * du/dx, where du/dx = fadeDeriv(xf)
    const dx = du * (1 - v) * (1 - w) * (d100 - d000) +
      du * v * (1 - w) * (d110 - d010) +
      du * (1 - v) * w * (d101 - d001) +
      du * v * w * (d111 - d011) +
      // Plus the derivative of the dot products themselves
      (1 - u) * (1 - v) * (1 - w) * g000[0] +
      u * (1 - v) * (1 - w) * g100[0] +
      (1 - u) * v * (1 - w) * g010[0] +
      u * v * (1 - w) * g110[0] +
      (1 - u) * (1 - v) * w * g001[0] +
      u * (1 - v) * w * g101[0] +
      (1 - u) * v * w * g011[0] +
      u * v * w * g111[0];

    const dy = dv * (1 - u) * (1 - w) * (d010 - d000) +
      dv * u * (1 - w) * (d110 - d100) +
      dv * (1 - u) * w * (d011 - d001) +
      dv * u * w * (d111 - d101) +
      (1 - u) * (1 - v) * (1 - w) * g000[1] +
      u * (1 - v) * (1 - w) * g100[1] +
      (1 - u) * v * (1 - w) * g010[1] +
      u * v * (1 - w) * g110[1] +
      (1 - u) * (1 - v) * w * g001[1] +
      u * (1 - v) * w * g101[1] +
      (1 - u) * v * w * g011[1] +
      u * v * w * g111[1];

    const dz = dw * (1 - u) * (1 - v) * (d001 - d000) +
      dw * u * (1 - v) * (d101 - d100) +
      dw * (1 - u) * v * (d011 - d010) +
      dw * u * v * (d111 - d110) +
      (1 - u) * (1 - v) * (1 - w) * g000[2] +
      u * (1 - v) * (1 - w) * g100[2] +
      (1 - u) * v * (1 - w) * g010[2] +
      u * v * (1 - w) * g110[2] +
      (1 - u) * (1 - v) * w * g001[2] +
      u * (1 - v) * w * g101[2] +
      (1 - u) * v * w * g011[2] +
      u * v * w * g111[2];

    return [dx, dy, dz];
  }

  /**
   * Fractal Brownian Motion - layered noise with decreasing amplitude and increasing frequency.
   * @param octaves Number of noise layers
   * @param persistence Amplitude multiplier per octave (typically 0.5)
   * @param lacunarity Frequency multiplier per octave (typically 2.0)
   * @param scale Initial frequency scale
   * @returns Normalized value in range [-1, 1]
   */
  fbm(
    x: number,
    y: number,
    z: number,
    octaves: number = 4,
    persistence: number = 0.5,
    lacunarity: number = 2.0,
    scale: number = 1.0
  ): number {
    let total = 0;
    let amplitude = 1;
    let frequency = scale;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      total += this.noise(x * frequency, y * frequency, z * frequency) * amplitude;

      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    return total / maxValue;
  }

  /**
   * Compute gradient of fractal Brownian motion.
   * This is the sum of gradients from each octave, weighted by amplitude.
   */
  fbmGradient(
    x: number,
    y: number,
    z: number,
    octaves: number = 4,
    persistence: number = 0.5,
    lacunarity: number = 2.0,
    scale: number = 1.0,
    epsilon: number = 0.0001
  ): [number, number, number] {
    let totalGradX = 0;
    let totalGradY = 0;
    let totalGradZ = 0;
    let amplitude = 1;
    let frequency = scale;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      const [dx, dy, dz] = this.gradient(
        x * frequency,
        y * frequency,
        z * frequency,
        epsilon
      );

      // Scale gradient by frequency (chain rule) and amplitude
      totalGradX += dx * frequency * amplitude;
      totalGradY += dy * frequency * amplitude;
      totalGradZ += dz * frequency * amplitude;

      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    // Normalize by the same factor as fbm
    return [
      totalGradX / maxValue,
      totalGradY / maxValue,
      totalGradZ / maxValue
    ];
  }

  /**
   * Turbulence - uses absolute value of noise for a more chaotic appearance.
   */
  turbulence(
    x: number,
    y: number,
    z: number,
    octaves: number = 4,
    persistence: number = 0.5,
    lacunarity: number = 2.0,
    scale: number = 1.0
  ): number {
    let total = 0;
    let amplitude = 1;
    let frequency = scale;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      total += Math.abs(this.noise(x * frequency, y * frequency, z * frequency)) * amplitude;

      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    return total / maxValue;
  }

  /**
   * Ridged multifractal - inverts the absolute value for sharp ridges.
   * Useful for mountain ranges and other sharp features.
   */
  ridgedMultifractal(
    x: number,
    y: number,
    z: number,
    octaves: number = 4,
    persistence: number = 0.5,
    lacunarity: number = 2.0,
    scale: number = 1.0
  ): number {
    let total = 0;
    let amplitude = 1;
    let frequency = scale;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      const signal = 1 - Math.abs(this.noise(x * frequency, y * frequency, z * frequency));
      total += signal * amplitude;

      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    return total / maxValue;
  }
}
