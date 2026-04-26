import * as THREE from 'three';
import { PerlinNoise3D } from '@core/noise/PerlinNoise';
import {
  terrainColorGLSL,
  createTerrainColorUniforms,
  syncTerrainColorUniforms as _syncTerrainColorUniforms,
  DEFAULT_TERRAIN_COLORS,
  type TerrainColorState,
} from '@core/shaders/terrainColorGLSL';
import {
  DEFAULT_TREE_ELEV_MAX,
  DEFAULT_TREE_ELEV_MIN,
  DEFAULT_TREE_SLOPE_MIN,
  DEFAULT_TREE_RIDGE_MIN,
  DEFAULT_TREE_NOISE_FREQ,
  DEFAULT_TREE_NOISE_POW,
  DEFAULT_TREE_DENSITY,
  createTreeUniforms,
  syncTreeUniforms,
  type TreeUniformState,
} from '@core/shaders/treeGLSL';
import {
  detailNoiseFragPreamble,
  createDetailNoiseUniforms,
  syncDetailNoiseUniforms,
} from '@core/shaders/detailNoiseGLSL';
import {
  terrainVertexPreamble,
  createTerrainVertexUniforms,
  syncTerrainVertexUniforms,
} from '@core/shaders/terrainVertexGLSL';
import {
  DEFAULT_NOISE_PARAMS,
  DEFAULT_GAUSSIAN_PARAMS,
  DEFAULT_FRACTAL_NOISE_PARAMS,
  DEFAULT_AMPLITUDE,
  DEFAULT_PATCH_SIZE,
  DEFAULT_SUBDIVISION,
  DEFAULT_NUM_PATCHES,
  DEFAULT_ELEV_OFFSET,
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
  noiseParams        = { ...DEFAULT_NOISE_PARAMS };
  fractalNoiseParams = { ...DEFAULT_FRACTAL_NOISE_PARAMS };
  noiseType          = 4; // 0 = simplex, 1 = perlin, 2 = heightmap, 3 = gaussian, 4 = fractalNoise

  // Geometry / rendering
  elevationOffset = DEFAULT_ELEV_OFFSET;
  amplitude       = DEFAULT_AMPLITUDE;
  patchSize    = DEFAULT_PATCH_SIZE;
  subdivisions = DEFAULT_SUBDIVISION;
  numPatches   = DEFAULT_NUM_PATCHES;
  wireframe    = false;
  roughness    = 0.85;

  // Detail noise
  detailNoiseEnabled  = false;
  detailNoiseStrength = 0.3;

  // Erosion
  erosionEnabled        = false;
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

  // Terrain colors
  terrainColors: TerrainColorState = { ...DEFAULT_TERRAIN_COLORS };

  // Trees
  treeEnabled   = true;
  treeElevMax   = DEFAULT_TREE_ELEV_MAX;
  treeElevMin   = DEFAULT_TREE_ELEV_MIN;
  treeSlopeMin  = DEFAULT_TREE_SLOPE_MIN;
  treeRidgeMin  = DEFAULT_TREE_RIDGE_MIN;
  treeNoiseFreq = DEFAULT_TREE_NOISE_FREQ;
  treeNoisePow  = DEFAULT_TREE_NOISE_POW;
  treeDensity   = DEFAULT_TREE_DENSITY;

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
        patchHalfSize:         halfSize,
        noiseType:             this.noiseType,
        gaussSigma:            this.gaussianParams.sigma,
        gaussAmplitude:        this.gaussianParams.amplitude,
        fractalFreq:           this.fractalNoiseParams.freq,
        fractalOctaves:        this.fractalNoiseParams.octaves,
        fractalLacunarity:     this.fractalNoiseParams.lacunarity,
        fractalGain:           this.fractalNoiseParams.gain,
        fractalAmp:            this.fractalNoiseParams.amp,
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
    for (const u of this._patchUniforms) {
      syncTerrainVertexUniforms(u, {
        elevationTexture: this.elevationTexture,
        amplitude:        this.amplitude,
        patchHalfSize:    this.patchSize / 2,
        elevationOffset:  this.elevationOffset,
      });
    }
    for (const mesh of this._meshes) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.wireframe = this.wireframe;
      mat.roughness = this.roughness;
    }
  }

  /**
   * Re-render the supplemental noise texture if needed and sync it to all patch materials.
   * Call once per frame before the main scene render — is a no-op when nothing has changed.
   */
  updateDetailNoise(renderer: THREE.WebGLRenderer): void {
    if (!this.suppNoiseGL || !this.detailNoiseEnabled) return;
    this.suppNoiseGL.update(renderer);
    this.syncDetailNoiseUniforms();
  }

  /** Toggle detail noise on/off and sync the enabled uniform immediately. */
  setDetailNoiseEnabled(enabled: boolean): void {
    this.detailNoiseEnabled = enabled;
    if (enabled) this.suppNoiseGL?.markDirty();
    this.syncDetailNoiseUniforms();
  }

  /** Set surface roughness (PBR) and apply to all patch materials immediately. */
  setRoughness(v: number): void {
    this.roughness = v;
    for (const mesh of this._meshes) {
      (mesh.material as THREE.MeshStandardMaterial).roughness = v;
    }
  }

  /** Sync detail noise uniforms (enabled, strength, texture) to all patch materials. */
  syncDetailNoiseUniforms(): void {
    for (const u of this._patchUniforms) {
      syncDetailNoiseUniforms(u, {
        detailNoiseTexture:  this.suppNoiseGL?.texture ?? null,
        detailNoiseEnabled:  this.detailNoiseEnabled,
        detailNoiseStrength: this.detailNoiseStrength,
      });
    }
  }

  /** Sync tree uniforms to all patch materials. */
  syncTreeUniforms(): void {
    for (const u of this._patchUniforms) {
      syncTreeUniforms(u, this as TreeUniformState);
    }
  }

  /** Sync terrain color uniforms to all patch materials. */
  syncTerrainColorUniforms(): void {
    for (const u of this._patchUniforms) {
      _syncTerrainColorUniforms(u, this.terrainColors);
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
    return Math.max(0, (noise + this.elevationOffset - 0.35) / (1 - 0.35) * this.amplitude);
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
    for (const u of this._patchUniforms) {
      u.uElevationTex.value = this.elevationTexture;
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
      Object.assign(shader.uniforms,
        createTerrainVertexUniforms({
          elevationTexture: this.elevationTexture,
          amplitude:        this.amplitude,
          patchHalfSize:    this.patchSize / 2,
          elevationOffset:  this.elevationOffset,
        }),
        createDetailNoiseUniforms({
          detailNoiseTexture:  this.suppNoiseGL?.texture ?? null,
          detailNoiseEnabled:  this.detailNoiseEnabled,
          detailNoiseStrength: this.detailNoiseStrength,
        }),
        createTreeUniforms(this as TreeUniformState),
        createTerrainColorUniforms(this.terrainColors),
      );
      this._patchUniforms.push(shader.uniforms);

      // ── Vertex shader ────────────────────────────────────────────────────
      shader.vertexShader = terrainVertexPreamble + shader.vertexShader;

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
        vTerrainRidge    = elevData.a;
        vTerrainWorldPos = vec3(wPos.x, terrain_dispY, wPos.z);

        // Gradient stored amplitude-normalised; scale by uAmplitude to get world-space slope.
        float dhdx = elevData.g * uAmplitude;
        float dhdz = elevData.b * uAmplitude;
        // Below water the mesh is flat (dispY == 0); use an upward normal so the
        // baked gradient (which ignores uElevOffset) does not leak through as lighting artefacts.
        bool underwater = (terrain_noise + uElevOffset) < TERRAIN_SEA;
        vTerrainWorldNormal = underwater ? vec3(0.0, 1.0, 0.0) : normalize(vec3(-dhdx, 1.0, -dhdz));

        vec3 objectNormal = vTerrainWorldNormal;
        `,
      );

      // Replace position setup chunk: apply Y displacement.
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        /* glsl */`vec3 transformed = vec3(position.x, terrain_dispY, position.z);`,
      );

      // ── Fragment shader ──────────────────────────────────────────────────
      shader.fragmentShader = /* glsl */`
${terrainColorGLSL}
${detailNoiseFragPreamble}
varying float vTerrainElev;
varying float vTerrainRidge;
varying vec3  vTerrainWorldPos;
varying vec3  vTerrainWorldNormal;
` + shader.fragmentShader;

      // Replace the texture-map chunk with our terrain color.
      // terrainNorWorld is defined here for reuse in normal_fragment_begin below.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        /* glsl */`
        vec3 detailNoise = vec3(0.0);
        if (uDetailNoiseEnabled == 1) {
          vec2 detailUV = (vTerrainWorldPos.xz + uPatchHalfSize) / (uPatchHalfSize * 2.0);
          detailNoise = texture2D(uDetailNoiseTex, detailUV).xyz;
        }
        vec3 terrainNorWorld = normalize(vTerrainWorldNormal + vec3(detailNoise.y, 0.0, detailNoise.z) * uDetailNoiseStrength);
        float shiftedElev = vTerrainElev + uElevOffset;
        vec3 colorNormal = shiftedElev < WATER_HEIGHT ? vTerrainWorldNormal : terrainNorWorld;
        diffuseColor.rgb = terrainColor(shiftedElev, vTerrainWorldPos, colorNormal, vTerrainRidge, detailNoise);
        `,
      );

      // Override normal setup to use our world-space terrain normal (→ view space).
      // viewMatrix is orthogonal, so mat3(viewMatrix) correctly rotates world→view.
      // colorNormal was defined in map_fragment above (chunks share the same scope).
      // It uses vTerrainWorldNormal for water and terrainNorWorld for land,
      // so detailNoise perturbation only affects land lighting.
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
