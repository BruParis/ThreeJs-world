/**
 * TerrainMaterial
 *
 * The material that renders a baked terrain patch: a ShaderMaterial running
 * terrainMaterial.vert.glsl / terrainMaterial.frag.glsl — Three's standard
 * (PBR) shader with the terrain stages written in (vertex displacement from the
 * elevation texture; per-fragment classification, coloring and normals).
 * Lighting, shadows, tone mapping and color space come from Three's chunks.
 *
 * It is the same material for the flat Shaders-tab patch and the World-tab
 * sphere LOD patches; only the frame differs (see TerrainMaterialFrame).
 * Every instance compiles to the same program, so creating one per patch is
 * cheap.
 *
 * Geometry contract — see terrainMaterial.vert.glsl:
 *   position = undisplaced position, normal = planet direction ("up"), uv = patch (s, t).
 */

import * as THREE from 'three';
import terrainVertexShader   from '@core/shaders/terrainMaterial.vert.glsl';
import terrainFragmentShader from '@core/shaders/terrainMaterial.frag.glsl';
import { createTerrainColorUniforms, syncTerrainColorUniforms, DRAINAGE_WIDTH } from '@core/shaders/terrainColorGLSL';
import { createTreeUniforms, syncTreeUniforms, TERRAIN_GRASS_HEIGHT } from '@core/shaders/treeGLSL';
import { createDetailNoiseUniforms, syncDetailNoiseUniforms } from '@core/shaders/detailNoiseGLSL';
import { createTerrainVertexUniforms, syncTerrainVertexUniforms } from '@core/shaders/terrainVertexGLSL';
import { BIOME_COLORS, BIOME_STANDARD, BIOME_OCEAN } from '@core/terrain/BiomeBoundaries';
import type { TerrainParams } from '../../shared/terrain/TerrainParams';
import type { BakedPatch } from './TerrainPatchBaker';

/**
 * How the patch mesh sits in the scene.
 */
export interface TerrainMaterialFrame {
  /** Mesh-local length of one terrain unit. */
  unitToLocal: number;
  /**
   * Flat patches: the mesh-local direction vertices are displaced along.
   * Sphere patches: null — vertices move along their own planet direction.
   */
  flatUp: THREE.Vector3 | null;
  /** Rotation from the planet frame to the world frame of the scene (for lighting). */
  domainToWorld: THREE.Matrix3;
}

export interface TerrainMaterialOptions {
  wireframe?: boolean;
  roughness?: number;
  /** When set, replaces the debug view of the shared parameters (TERRAIN_DEBUG_*). */
  debugMode?: number | null;
}

const glslFloat = (v: number) => v.toFixed(4);
const glslVec3  = (c: [number, number, number]) => `vec3(${c.map(glslFloat).join(', ')})`;

/** Compile-time constants of the terrain shaders (see the .glsl headers). */
const TERRAIN_DEFINES: Record<string, string> = {
  // Rounded to 2 decimals (0.465 → 0.47) like the tree density bake
  // (treeDensityComputeGLSL), so both passes classify the grass zone alike.
  GRASS_HEIGHT:         TERRAIN_GRASS_HEIGHT.toFixed(2),
  DRAINAGE_WIDTH:       DRAINAGE_WIDTH.toFixed(2),
  BIOME_COLOR_STANDARD: glslVec3(BIOME_COLORS[BIOME_STANDARD]),
  BIOME_COLOR_OCEAN:    glslVec3(BIOME_COLORS[BIOME_OCEAN]),
};

export class TerrainMaterial {
  readonly material: THREE.ShaderMaterial;
  readonly uniforms: Record<string, THREE.IUniform>;

  private readonly frame: TerrainMaterialFrame;
  private patch: BakedPatch;
  private debugMode: number | null;

  constructor(
    params: TerrainParams,
    patch: BakedPatch,
    frame: TerrainMaterialFrame,
    options: TerrainMaterialOptions = {},
  ) {
    this.frame     = frame;
    this.patch     = patch;
    this.debugMode = options.debugMode ?? null;

    this.uniforms = {
      ...createTerrainVertexUniforms(this.vertexState(params)),
      ...createDetailNoiseUniforms(this.detailState(params)),
      ...createTreeUniforms(params),
      ...createTerrainColorUniforms(params.terrainColors),
      // Attribute texture — produced by the elevation pass.
      uAttrTex:      { value: null },
      // Bump textures — produced by the bump pass.
      uBumpWaterTex: { value: null },
      uBumpTreeTex:  { value: null },
    };
    this.sync(params);

    this.material = new THREE.ShaderMaterial({
      vertexShader:   terrainVertexShader,
      fragmentShader: terrainFragmentShader,
      defines:        { ...TERRAIN_DEFINES },
      // Three's standard-material uniforms (diffuse, roughness, …) plus ours.
      // Ours are the same objects as this.uniforms, so sync() reaches the program.
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms),
        ...this.uniforms,
      },
      lights:    true,
      side:      THREE.FrontSide,
      wireframe: options.wireframe ?? false,
    });
    this.material.uniforms.roughness.value = options.roughness ?? 0.85;
    this.material.uniforms.metalness.value = 0.0;
  }

  /** Points the material at another baked patch (or at re-allocated textures). */
  setPatch(patch: BakedPatch, params: TerrainParams): void {
    this.patch = patch;
    this.sync(params);
  }

  /** Overrides the debug view (TERRAIN_DEBUG_*); null follows the shared parameters. */
  setDebugMode(mode: number | null, params: TerrainParams): void {
    this.debugMode = mode;
    this.sync(params);
  }

  /** Surface roughness of land (PBR); water uses its own. */
  setRoughness(v: number): void {
    this.material.uniforms.roughness.value = v;
  }

  setWireframe(v: boolean): void {
    this.material.wireframe = v;
  }

  /**
   * Copies every parameter and texture reference into the uniforms.
   * Call after any parameter change or re-bake; it is cheap.
   */
  sync(params: TerrainParams): void {
    const u = this.uniforms;
    syncTerrainVertexUniforms(u, this.vertexState(params));
    syncDetailNoiseUniforms(u, this.detailState(params));
    syncTreeUniforms(u, params);
    syncTerrainColorUniforms(u, params.terrainColors);
    if (this.debugMode !== null) u.uDebugMode.value = this.debugMode;

    u.uAttrTex.value      = this.patch.elevationTarget.textures[1];
    u.uBumpWaterTex.value = this.patch.bumpTarget.textures[0];
    u.uBumpTreeTex.value  = this.patch.bumpTarget.textures[1];
  }

  dispose(): void {
    this.material.dispose();
  }

  // ── private ─────────────────────────────────────────────────────────────────

  private vertexState(params: TerrainParams) {
    return {
      elevationTexture:   this.patch.elevationTarget.textures[0],
      treeDensityTexture: this.patch.treeTarget.texture,
      elevationOffset:    params.elevationOffset,
      seaLevel:           params.seaLevel,
      verticalScale:      params.verticalScale,
      unitToLocal:        this.frame.unitToLocal,
      planetRadius:       params.planetRadiusUnits,
      flatUp:             this.frame.flatUp,
      displacementSmoothing: params.displacementSmoothing,
      domainToWorld:      this.frame.domainToWorld,
    };
  }

  private detailState(params: TerrainParams) {
    const ready = params.detailNoiseEnabled && this.patch.detailTarget !== null;
    return {
      detailNoiseTexture:  this.patch.detailTarget?.texture ?? null,
      detailNoiseEnabled:  ready,
      detailNoiseStrength: params.detailNoiseStrength,
    };
  }
}
