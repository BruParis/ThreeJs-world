import * as THREE from 'three';
import { PerlinNoise3D } from '@core/noise/PerlinNoise';
import { terrainColorGLSL } from '@core/shaders/terrainColorGLSL';
import {
  DEFAULT_NOISE_PARAMS,
  DEFAULT_GAUSSIAN_PARAMS,
  DEFAULT_AMPLITUDE,
  DEFAULT_PATCH_SIZE,
  DEFAULT_SUBDIVISION,
  DEFAULT_NUM_PATCHES,
  DEFAULT_LAYER_MIX,
} from './TerrainConstants';
import {
  DEFAULT_EROSION_OCTAVES,
  DEFAULT_EROSION_SCALE,
  DEFAULT_EROSION_STRENGTH,
  DEFAULT_EROSION_GULLY_WEIGHT,
  DEFAULT_EROSION_DETAIL,
  DEFAULT_EROSION_GAIN,
  DEFAULT_EROSION_LACUNARITY,
  DEFAULT_EROSION_CELL_SCALE,
  DEFAULT_EROSION_NORMALIZATION,
  DEFAULT_EROSION_RIDGE_ROUNDING,
  DEFAULT_EROSION_CREASE_ROUNDING,
} from '@core/shaders/erosionGLSL';
import { TerrainElevationGL } from './TerrainElevationGL';
import { SuppNoiseGL }        from './SuppNoiseGL';

export class TerrainMesh {
  // Gaussian (input to first elevation layer)
  gaussianParams = { ...DEFAULT_GAUSSIAN_PARAMS };

  // Noise
  noiseParams = { ...DEFAULT_NOISE_PARAMS };
  noiseType   = 0; // 0 = simplex, 1 = perlin, 2 = heightmap

  // Geometry / rendering
  amplitude    = DEFAULT_AMPLITUDE;
  patchSize    = DEFAULT_PATCH_SIZE;
  subdivisions = DEFAULT_SUBDIVISION;
  numPatches   = DEFAULT_NUM_PATCHES;
  wireframe    = false;
  layerMix     = DEFAULT_LAYER_MIX;
  roughness    = 0.85;

  // Supplemental noise
  suppNoiseEnabled  = false;
  suppNoiseStrength = 0.3;

  // Erosion
  erosionEnabled        = true;
  erosionOctaves        = DEFAULT_EROSION_OCTAVES;
  erosionScale          = DEFAULT_EROSION_SCALE;
  erosionStrength       = DEFAULT_EROSION_STRENGTH;
  erosionGullyWeight    = DEFAULT_EROSION_GULLY_WEIGHT;
  erosionDetail         = DEFAULT_EROSION_DETAIL;
  erosionGain           = DEFAULT_EROSION_GAIN;
  erosionLacunarity     = DEFAULT_EROSION_LACUNARITY;
  erosionCellScale      = DEFAULT_EROSION_CELL_SCALE;
  erosionNormalization  = DEFAULT_EROSION_NORMALIZATION;
  erosionRidgeRounding  = DEFAULT_EROSION_RIDGE_ROUNDING;
  erosionCreaseRounding = DEFAULT_EROSION_CREASE_ROUNDING;

  /**
   * CPU-accessible elevation grid — use for pathfinding, physics, or any non-rendering query.
   * Index: row * elevationGridWidth + col  →  normalised elevation in [0, 1].
   */
  elevationData:       Float32Array | null = null;
  elevationGridWidth   = 0;
  elevationGridHeight  = 0;

  private _meshes:          THREE.Mesh[] = [];
  private elevationTexture: THREE.DataTexture | null = null;
  private elevationGL:      TerrainElevationGL | null = null;
  private suppNoiseGL:      SuppNoiseGL | null = null;

  // Per-patch uniform objects kept in sync with onBeforeCompile shader refs.
  private _patchUniforms: Record<string, THREE.IUniform>[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  get meshes(): readonly THREE.Mesh[] { return this._meshes; }

  init(): void {
    this.elevationGL = TerrainElevationGL.create();
    this.suppNoiseGL = new SuppNoiseGL(512);
    this.recomputeElevation();
    this.rebuildMeshes();
  }

  /** Full rebuild: recompute elevation then recreate patch geometry. */
  rebuild(): void {
    this.recomputeElevation();
    this.rebuildMeshes();
  }

  /**
   * Re-run the elevation compute pass on the GPU with current parameters.
   * Call when any noise or erosion parameter changes.
   * Updates both elevationData (CPU) and the elevation texture (GPU/render).
   */
  recomputeElevation(): void {
    if (!this.elevationGL) return;

    const patchesPerSide = Math.round(Math.sqrt(this.numPatches));
    const totalVerts     = patchesPerSide * this.subdivisions + 1;
    const halfSize       = this.patchSize / 2;
    const permData       = new PerlinNoise3D(this.noiseParams.seed).getPermutation256();

    const { elevations, packed } = this.elevationGL.compute(
      {
        gridWidth:             totalVerts,
        gridHeight:            totalVerts,
        originX:              -halfSize,
        originZ:              -halfSize,
        stepX:                 this.patchSize / (totalVerts - 1),
        stepZ:                 this.patchSize / (totalVerts - 1),
        noiseScale:            this.noiseParams.scale,
        noiseOctaves:          this.noiseParams.octaves,
        noisePersistence:      this.noiseParams.persistence,
        noiseLacunarity:       this.noiseParams.lacunarity,
        layerMix:              this.layerMix,
        patchHalfSize:         halfSize,
        noiseType:             this.noiseType,
        gaussSigma:            this.gaussianParams.sigma,
        gaussAmplitude:        this.gaussianParams.amplitude,
        erosionEnabled:         this.erosionEnabled ? 1 : 0,
        erosionOctaves:         this.erosionOctaves,
        erosionScale:           this.erosionScale,
        erosionStrength:        this.erosionStrength,
        erosionGullyWeight:     this.erosionGullyWeight,
        erosionDetail:          this.erosionDetail,
        erosionGain:            this.erosionGain,
        erosionLacunarity:      this.erosionLacunarity,
        erosionCellScale:       this.erosionCellScale,
        erosionNormalization:   this.erosionNormalization,
        erosionRidgeRounding:   this.erosionRidgeRounding,
        erosionCreaseRounding:  this.erosionCreaseRounding,
      },
      permData,
    );

    // ── CPU-side data (app logic: pathfinding, physics, …) ─────────────────
    this.elevationData       = elevations;
    this.elevationGridWidth  = totalVerts;
    this.elevationGridHeight = totalVerts;

    // ── GPU texture (R=elevation, G=dH/dX, B=dH/dZ — vertex shader reads once) ──
    this.elevationTexture?.dispose();
    this.elevationTexture = new THREE.DataTexture(
      packed, totalVerts, totalVerts,
      THREE.RGBAFormat, THREE.FloatType,
    );
    this.elevationTexture.minFilter      = THREE.LinearFilter;
    this.elevationTexture.magFilter      = THREE.LinearFilter;
    this.elevationTexture.generateMipmaps = false;
    this.elevationTexture.needsUpdate    = true;

    this.syncElevationTexture();
  }

  /** Update display-only uniforms (amplitude, wireframe, roughness) without recomputing elevation. */
  updateUniforms(): void {
    for (const uniforms of this._patchUniforms) {
      uniforms.uAmplitude.value     = this.amplitude;
      uniforms.uPatchHalfSize.value = this.patchSize / 2;
    }
    for (const mesh of this._meshes) {
      const mat   = mesh.material as THREE.MeshStandardMaterial;
      mat.wireframe = this.wireframe;
      mat.roughness = this.roughness;
    }
  }

  /**
   * Re-render the supplemental noise texture if needed and sync it to all patch materials.
   * Call once per frame before the main scene render — is a no-op when nothing has changed.
   */
  updateSuppNoise(renderer: THREE.WebGLRenderer): void {
    if (!this.suppNoiseGL || !this.suppNoiseEnabled) return;
    this.suppNoiseGL.update(renderer);
    this.syncSuppNoiseUniforms();
  }

  /** Toggle supp noise on/off and sync the enabled uniform immediately. */
  setSuppNoiseEnabled(enabled: boolean): void {
    this.suppNoiseEnabled = enabled;
    if (enabled) this.suppNoiseGL?.markDirty();
    this.syncSuppNoiseUniforms();
  }

  /** Set surface roughness (PBR) and apply to all patch materials immediately. */
  setRoughness(v: number): void {
    this.roughness = v;
    for (const mesh of this._meshes) {
      (mesh.material as THREE.MeshStandardMaterial).roughness = v;
    }
  }

  /** Sync supp noise uniforms (enabled, strength, texture) to all patch materials. */
  syncSuppNoiseUniforms(): void {
    for (const uniforms of this._patchUniforms) {
      uniforms.uSuppNoiseTex.value      = this.suppNoiseGL?.texture ?? null;
      uniforms.uSuppNoiseEnabled.value  = this.suppNoiseEnabled ? 1 : 0;
      uniforms.uSuppNoiseStrength.value = this.suppNoiseStrength;
    }
  }

  /** Sample terrain height at world XZ using the CPU elevation grid. */
  sampleTerrainHeight(wx: number, wz: number): number {
    if (!this.elevationData) return 0;
    const halfSize = this.patchSize / 2;
    const u = (wx + halfSize) / this.patchSize;
    const v = (wz + halfSize) / this.patchSize;
    const w = this.elevationGridWidth;
    const h = this.elevationGridHeight;
    const col   = Math.max(0, Math.min(w - 1, Math.floor(u * (w - 1))));
    const row   = Math.max(0, Math.min(h - 1, Math.floor(v * (h - 1))));
    const noise = this.elevationData[row * w + col];
    return Math.max(0, (noise - 0.35) / (1 - 0.35) * this.amplitude);
  }

  dispose(): void {
    this.disposeMeshes();
    this.elevationTexture?.dispose();
    this.elevationTexture = null;
    this.elevationGL?.dispose();
    this.elevationGL = null;
    this.suppNoiseGL?.dispose();
    this.suppNoiseGL = null;
  }

  // ── private ──────────────────────────────────────────────────────────────────

  private syncElevationTexture(): void {
    for (const uniforms of this._patchUniforms) {
      uniforms.uElevationTex.value = this.elevationTexture;
    }
  }

  private disposeMeshes(): void {
    for (const mesh of this._meshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.MeshStandardMaterial).dispose();
    }
    this._meshes = [];
    this._patchUniforms = [];
  }

  private rebuildMeshes(): void {
    this.disposeMeshes();

    const patchesPerSide = Math.round(Math.sqrt(this.numPatches));
    const cellSize       = this.patchSize / patchesPerSide;
    const half           = this.patchSize / 2;

    for (let row = 0; row < patchesPerSide; row++) {
      for (let col = 0; col < patchesPerSide; col++) {
        const mesh = new THREE.Mesh(
          this.buildPatchGeometry(cellSize),
          this.buildMaterial(),
        );
        mesh.position.set(-half + col * cellSize, 0, -half + row * cellSize);
        this.scene.add(mesh);
        this._meshes.push(mesh);
      }
    }
  }

  private buildPatchGeometry(cellSize: number): THREE.BufferGeometry {
    const n = this.subdivisions;
    const positions: number[] = [];
    for (let i = 0; i <= n; i++) {
      const x = cellSize * (i / n);
      for (let j = 0; j <= n; j++) {
        positions.push(x, 0, cellSize * (j / n));
      }
    }
    const indices: number[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const tl = i * (n + 1) + j;
        const tr = tl + 1;
        const bl = (i + 1) * (n + 1) + j;
        const br = bl + 1;
        indices.push(tl, tr, bl, tr, br, bl);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    return geo;
  }

  private buildMaterial(): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      roughness: this.roughness,
      metalness: 0.0,
      side:      THREE.FrontSide,
      wireframe: this.wireframe,
    });

    mat.onBeforeCompile = (shader) => {
      // Register custom uniforms — stored for later sync calls.
      shader.uniforms.uElevationTex      = { value: this.elevationTexture };
      shader.uniforms.uAmplitude         = { value: this.amplitude };
      shader.uniforms.uPatchHalfSize     = { value: this.patchSize / 2 };
      shader.uniforms.uSuppNoiseTex      = { value: this.suppNoiseGL?.texture ?? null };
      shader.uniforms.uSuppNoiseEnabled  = { value: this.suppNoiseEnabled ? 1 : 0 };
      shader.uniforms.uSuppNoiseStrength = { value: this.suppNoiseStrength };
      this._patchUniforms.push(shader.uniforms);

      // ── Vertex shader ────────────────────────────────────────────────────
      // Prepend helper functions and custom varyings.
      shader.vertexShader = /* glsl */`
uniform sampler2D uElevationTex;
uniform float uAmplitude;
uniform float uPatchHalfSize;

varying float vTerrainElev;
varying vec3  vTerrainWorldPos;
varying vec3  vTerrainWorldNormal;

const float TERRAIN_SEA = 0.35;

float terrain_displY(float noise) {
  return max(0.0, (noise - TERRAIN_SEA) / (1.0 - TERRAIN_SEA) * uAmplitude);
}
` + shader.vertexShader;

      // Replace normal setup chunk: single texture read — elevation in R,
      // baked gradient (amplitude=1) in G (dH/dX) and B (dH/dZ).
      shader.vertexShader = shader.vertexShader.replace(
        '#include <beginnormal_vertex>',
        /* glsl */`
        vec3 wPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vec2 elevUV = (wPos.xz + uPatchHalfSize) / (uPatchHalfSize * 2.0);
        vec4 elevData = texture2D(uElevationTex, elevUV);

        float terrain_noise = elevData.r;
        float terrain_dispY = terrain_displY(terrain_noise);

        vTerrainElev     = terrain_noise;
        vTerrainWorldPos = vec3(wPos.x, terrain_dispY, wPos.z);

        // Gradient stored amplitude-normalised; scale by uAmplitude to get world-space slope.
        float dhdx = elevData.g * uAmplitude;
        float dhdz = elevData.b * uAmplitude;
        vTerrainWorldNormal = normalize(vec3(-dhdx, 1.0, -dhdz));

        vec3 objectNormal = vTerrainWorldNormal;
        `,
      );

      // Replace position setup chunk: apply Y displacement.
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        /* glsl */`vec3 transformed = vec3(position.x, terrain_dispY, position.z);`,
      );

      // ── Fragment shader ──────────────────────────────────────────────────
      // Prepend terrain color function and custom varyings.
      shader.fragmentShader = /* glsl */`
${terrainColorGLSL}

uniform sampler2D uSuppNoiseTex;
uniform int       uSuppNoiseEnabled;
uniform float     uSuppNoiseStrength;
uniform float     uPatchHalfSize;

varying float vTerrainElev;
varying vec3  vTerrainWorldPos;
varying vec3  vTerrainWorldNormal;
` + shader.fragmentShader;

      // Replace the texture-map chunk with our terrain color.
      // terrainNorWorld is defined here for reuse in normal_fragment_begin below.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        /* glsl */`
        vec3 terrainNorWorld = vTerrainWorldNormal;
        if (uSuppNoiseEnabled == 1) {
          vec2 suppUV   = (vTerrainWorldPos.xz + uPatchHalfSize) / (uPatchHalfSize * 2.0);
          vec3 suppData = texture2D(uSuppNoiseTex, suppUV).xyz;
          terrainNorWorld = normalize(terrainNorWorld + vec3(suppData.y, 0.0, suppData.z) * uSuppNoiseStrength);
        }
        vec3 colorNormal = vTerrainElev < WATER_HEIGHT ? vTerrainWorldNormal : terrainNorWorld;
        diffuseColor.rgb = terrainColor(vTerrainElev, vTerrainWorldPos, colorNormal);
        `,
      );

      // Override normal setup to use our world-space terrain normal (→ view space).
      // viewMatrix is orthogonal, so mat3(viewMatrix) correctly rotates world→view.
      // colorNormal was defined in map_fragment above (chunks share the same scope).
      // It uses vTerrainWorldNormal for water and terrainNorWorld for land,
      // so suppNoise perturbation only affects land lighting.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        /* glsl */`
        vec3 normal = normalize(mat3(viewMatrix) * colorNormal);
        vec3 nonPerturbedNormal = normal;
        `,
      );
    };

    return mat;
  }
}
