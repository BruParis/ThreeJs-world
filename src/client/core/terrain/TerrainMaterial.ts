/**
 * TerrainMaterial
 *
 * The material that renders a baked terrain patch: a MeshStandardMaterial whose
 * shaders are patched with the terrain pipeline (vertex displacement from the
 * elevation texture; per-fragment classification, coloring and normals).
 *
 * It is the same material for the flat Shaders-tab patch and the World-tab
 * sphere LOD patches; only the frame differs (see TerrainMaterialFrame).
 * Every instance compiles to the same program, so creating one per patch is
 * cheap.
 *
 * Geometry contract — see terrainVertexGLSL:
 *   position = undisplaced position, normal = planet direction ("up"), uv = patch (s, t).
 */

import * as THREE from 'three';
import { terrainFinalStateGLSL } from '@core/shaders/terrainFinalStateGLSL';
import {
  terrainFragmentMapChunk,
  terrainFragmentNormalChunk,
  terrainFragmentRoughnessChunk,
  terrainFragmentMetalnessChunk,
  createTerrainColorUniforms,
  syncTerrainColorUniforms,
} from '@core/shaders/terrainColorGLSL';
import { createTreeUniforms, syncTreeUniforms } from '@core/shaders/treeGLSL';
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

export class TerrainMaterial {
  readonly material: THREE.MeshStandardMaterial;
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

    this.material = new THREE.MeshStandardMaterial({
      roughness: options.roughness ?? 0.85,
      metalness: 0.0,
      side:      THREE.FrontSide,
      wireframe: options.wireframe ?? false,
    });

    const uniforms = this.uniforms;
    this.material.onBeforeCompile = (shader) => {
      // The uniform objects are shared with this.uniforms, so later updates
      // reach the compiled program directly.
      Object.assign(shader.uniforms, uniforms);

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
        terrainFinalStateGLSL +
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
      // Roughness / metalness overrides — water pixels get low roughness so
      // MeshStandardMaterial produces specular highlights.  Set scene.environment
      // (via PMREMGenerator) for full PBR reflections on water.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        terrainFragmentRoughnessChunk,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <metalnessmap_fragment>',
        terrainFragmentMetalnessChunk,
      );
    };
    // All terrain materials patch the shader identically → one shared program.
    this.material.customProgramCacheKey = () => 'terrain-patch';
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
