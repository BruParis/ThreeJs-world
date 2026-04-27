import * as THREE from 'three';
import { PerlinNoise3D } from '@core/noise/PerlinNoise';
import {
  terrainColorGLSL,
  terrainFragmentMapChunk,
  terrainFragmentNormalChunk,
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
  terrainVertexNormalChunk,
  terrainVertexPositionChunk,
  terrainFragmentVaryings,
  createTerrainVertexUniforms,
  syncTerrainVertexUniforms,
} from '@core/shaders/terrainVertexGLSL';
import {
  DEFAULT_NOISE_PARAMS,
  DEFAULT_GAUSSIAN_PARAMS,
  DEFAULT_FRACTAL_NOISE_PARAMS,
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
  // Attribute texture (NearestFilter) — ridgeMap (R) + erosionDepth (G).
  // Kept separate from the elevation texture so each can use the correct filter mode:
  // elevation uses LinearFilter for smooth geometry; attributes use NearestFilter so
  // per-texel shading signals are never blended across texel boundaries.
  private attrTexture:      THREE.DataTexture | null = null;
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

    const { elevations, packed, attrPacked } = this.elevationGL.compute(
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

    // ── Elevation texture (LinearFilter) — geometry data read by the vertex shader ──
    // LinearFilter is correct here: elevation and gradients are continuous signals
    // whose smooth interpolation produces correct normals and displacement.
    this.elevationTexture?.dispose();
    this.elevationTexture = new THREE.DataTexture(
      packed, totalVerts, totalVerts,
      THREE.RGBAFormat, THREE.FloatType,
    );
    this.elevationTexture.minFilter      = THREE.LinearFilter;
    this.elevationTexture.magFilter      = THREE.LinearFilter;
    this.elevationTexture.generateMipmaps = false;
    this.elevationTexture.needsUpdate    = true;

    // ── Attribute texture (NearestFilter) — shading signals read by the fragment shader ──
    // NearestFilter is mandatory: ridgeMap and erosionDepth are discrete per-vertex
    // values.  Linear interpolation across texel boundaries would blend adjacent
    // quantisation steps and corrupt the signal (producing the noisy black/cliff
    // artefact).  The fragment shader samples this with the same world-space UV as
    // the elevation texture — no vertex varying is involved, so NearestFilter holds.
    this.attrTexture?.dispose();
    this.attrTexture = new THREE.DataTexture(
      attrPacked, totalVerts, totalVerts,
      THREE.RGBAFormat, THREE.FloatType,
    );
    // this.attrTexture.minFilter      = THREE.NearestFilter;
    // this.attrTexture.magFilter      = THREE.NearestFilter;
    this.attrTexture.minFilter      = THREE.LinearFilter;
    this.attrTexture.magFilter      = THREE.LinearFilter;
    this.attrTexture.generateMipmaps = false;
    this.attrTexture.needsUpdate    = true;

    this.syncElevationTexture();
    this.syncAttrTexture();
    this.suppNoiseGL?.setWorldParams(-halfSize, -halfSize, this.patchSize);
  }

  /** Update display-only uniforms (wireframe, roughness) without recomputing elevation. */
  updateUniforms(): void {
    for (const u of this._patchUniforms) {
      syncTerrainVertexUniforms(u, {
        elevationTexture: this.elevationTexture,
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
    return Math.max(0, (noise + this.elevationOffset - 0.35) / (1 - 0.35));
  }

  dispose(): void {
    this.disposeMeshes();
    this.elevationTexture?.dispose();
    this.elevationTexture = null;
    this.attrTexture?.dispose();
    this.attrTexture = null;
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

  private syncAttrTexture(): void {
    for (const u of this._patchUniforms) {
      u.uAttrTex.value = this.attrTexture;
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
        // Attribute texture registered here (alongside elevation texture) because
        // it is produced by the same compute pass and updated on the same cadence.
        { uAttrTex: { value: this.attrTexture } },
      );
      this._patchUniforms.push(shader.uniforms);

      // ── Vertex shader ────────────────────────────────────────────────────
      shader.vertexShader = terrainVertexPreamble + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <beginnormal_vertex>',
        terrainVertexNormalChunk,
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        terrainVertexPositionChunk,
      );

      // ── Fragment shader ──────────────────────────────────────────────────
      shader.fragmentShader =
        terrainColorGLSL +
        detailNoiseFragPreamble +
        terrainFragmentVaryings +
        shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        terrainFragmentMapChunk,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        terrainFragmentNormalChunk,
      );
    };

    return mat;
  }
}
