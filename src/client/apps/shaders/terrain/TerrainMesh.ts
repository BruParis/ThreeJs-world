import * as THREE from 'three';
import { PerlinNoise3D } from '@core/noise/PerlinNoise';
import { demoVertexShader }   from '../shaders/demoVert';
import { demoFragmentShader } from '../shaders/demoFrag';
import {
  DEFAULT_NOISE_PARAMS,
  DEFAULT_AMPLITUDE,
  DEFAULT_PATCH_SIZE,
  DEFAULT_SUBDIVISION,
  DEFAULT_NUM_PATCHES,
  DEFAULT_LAYER_MIX,
} from './TerrainConstants';
import {
  DEFAULT_EROSION_OCTAVES,
  DEFAULT_EROSION_TILES,
  DEFAULT_EROSION_STRENGTH,
  DEFAULT_EROSION_SLOPE_STRENGTH,
  DEFAULT_EROSION_BRANCH_STRENGTH,
  DEFAULT_EROSION_GAIN,
  DEFAULT_EROSION_LACUNARITY,
} from '@core/shaders/erosionGLSL';
import { TerrainElevationGL } from './TerrainElevationGL';
import { SuppNoiseGL }        from './SuppNoiseGL';

export class TerrainMesh {
  // Noise
  noiseParams = { ...DEFAULT_NOISE_PARAMS };
  noiseType   = 0; // 0 = simplex, 1 = perlin

  // Geometry / rendering
  amplitude    = DEFAULT_AMPLITUDE;
  patchSize    = DEFAULT_PATCH_SIZE;
  subdivisions = DEFAULT_SUBDIVISION;
  numPatches   = DEFAULT_NUM_PATCHES;
  wireframe    = false;
  layerMix     = DEFAULT_LAYER_MIX;

  // Supplemental noise
  suppNoiseEnabled  = false;
  suppNoiseStrength = 0.3;

  // Erosion
  erosionEnabled        = true;
  erosionOctaves        = DEFAULT_EROSION_OCTAVES;
  erosionTiles          = DEFAULT_EROSION_TILES;
  erosionStrength       = DEFAULT_EROSION_STRENGTH;
  erosionSlopeStrength  = DEFAULT_EROSION_SLOPE_STRENGTH;
  erosionBranchStrength = DEFAULT_EROSION_BRANCH_STRENGTH;
  erosionGain           = DEFAULT_EROSION_GAIN;
  erosionLacunarity     = DEFAULT_EROSION_LACUNARITY;

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

    const elevations = this.elevationGL.compute(
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
        erosionEnabled:        this.erosionEnabled ? 1 : 0,
        erosionOctaves:        this.erosionOctaves,
        erosionTiles:          this.erosionTiles,
        erosionStrength:       this.erosionStrength,
        erosionSlopeStrength:  this.erosionSlopeStrength,
        erosionBranchStrength: this.erosionBranchStrength,
        erosionGain:           this.erosionGain,
        erosionLacunarity:     this.erosionLacunarity,
      },
      permData,
    );

    // ── CPU-side data (app logic: pathfinding, physics, …) ─────────────────
    this.elevationData       = elevations;
    this.elevationGridWidth  = totalVerts;
    this.elevationGridHeight = totalVerts;

    // ── GPU texture (vertex shader reads this for displacement + normals) ──
    this.elevationTexture?.dispose();
    this.elevationTexture = new THREE.DataTexture(
      elevations, totalVerts, totalVerts,
      THREE.RedFormat, THREE.FloatType,
    );
    this.elevationTexture.minFilter      = THREE.LinearFilter;
    this.elevationTexture.magFilter      = THREE.LinearFilter;
    this.elevationTexture.generateMipmaps = false;
    this.elevationTexture.needsUpdate    = true;

    this.syncElevationTexture();
  }

  /** Update display-only uniforms (amplitude, wireframe) without recomputing elevation. */
  updateUniforms(): void {
    for (const mesh of this._meshes) {
      const mat = mesh.material as THREE.ShaderMaterial;
      mat.uniforms.uAmplitude.value     = this.amplitude;
      mat.uniforms.uPatchHalfSize.value = this.patchSize / 2;
      mat.wireframe = this.wireframe;
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

  /** Sync supp noise uniforms (enabled, strength, texture) to all patch materials. */
  syncSuppNoiseUniforms(): void {
    for (const mesh of this._meshes) {
      const mat = mesh.material as THREE.ShaderMaterial;
      mat.uniforms.uSuppNoiseTex.value      = this.suppNoiseGL?.texture ?? null;
      mat.uniforms.uSuppNoiseEnabled.value  = this.suppNoiseEnabled ? 1 : 0;
      mat.uniforms.uSuppNoiseStrength.value = this.suppNoiseStrength;
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
    for (const mesh of this._meshes) {
      const mat = mesh.material as THREE.ShaderMaterial;
      mat.uniforms.uElevationTex.value = this.elevationTexture;
    }
  }

  private disposeMeshes(): void {
    for (const mesh of this._meshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.ShaderMaterial).dispose();
    }
    this._meshes = [];
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

  private buildMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uElevationTex:     { value: this.elevationTexture },
        uAmplitude:        { value: this.amplitude },
        uPatchHalfSize:    { value: this.patchSize / 2 },
        uSuppNoiseTex:     { value: this.suppNoiseGL?.texture ?? null },
        uSuppNoiseEnabled: { value: this.suppNoiseEnabled ? 1 : 0 },
        uSuppNoiseStrength:{ value: this.suppNoiseStrength },
      },
      vertexShader:   demoVertexShader,
      fragmentShader: demoFragmentShader,
      side:      THREE.DoubleSide,
      wireframe: this.wireframe,
    });
  }
}
