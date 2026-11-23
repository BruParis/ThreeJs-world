/**
 * TerrainPatchBaker
 *
 * Bakes the textures of a terrain patch on the GPU, using the THREE renderer
 * of the tab that will display them (textures cannot be shared between WebGL
 * contexts, so each tab owns one baker).
 *
 * Every pass is a fullscreen fragment shader rendered into a float render
 * target; the result stays on the GPU and is used directly as a texture by the
 * terrain material.  A CPU copy of the elevation is available on demand
 * (readElevation) for camera collision, physics, etc.
 *
 * Passes
 *   elevation — elevation + surface gradient, and erosion attributes (2 targets)
 *   trees     — tree density; depends on the elevation pass and the elevation offset
 *   bump      — water wave gradient and tree canopy tilt (2 targets)
 *   detail    — detail noise value + gradient (only when detail noise is enabled)
 *
 * Biomes: each patch carries the biome boundaries around it (setBiomes); the
 * elevation pass blends the per-biome parameters across them.
 *
 * The patch is located on the planet by a PatchDomain, so the same baker
 * serves the flat Shaders-tab patch and the World-tab sphere LOD patches.
 */

import * as THREE from 'three';
import { PerlinNoise3D } from '@core/noise/PerlinNoise';
import { patchBakeVert } from '@core/shaders/patchBakeGLSL';
import { elevationComputeGLSL } from '@core/shaders/elevationComputeGLSL';
import { treeDensityComputeGLSL } from '@core/shaders/treeDensityComputeGLSL';
import { bumpComputeGLSL } from '@core/shaders/bumpComputeGLSL';
import { detailNoiseComputeGLSL } from '@core/shaders/detailNoiseGLSL';
import { PatchDomain, patchNominalSize, tangentFrameFromLatLon } from './PatchDomain';
import {
  BIOME_STANDARD,
  createBiomeEdgeTexture,
  biomeEdgeCount,
  type BiomeBoundarySet,
} from './BiomeBoundaries';
import type { TerrainParams } from '../../shared/terrain/TerrainParams';
import { WORLD_RADIUS_KM } from '../../shared/world/World';

export interface PatchBakeResolution {
  /** Texels per side of the elevation / attribute / tree density textures. */
  elevation: number;
  /** Texels per side of the bump textures. */
  bump: number;
  /** Texels per side of the detail noise texture. */
  detail: number;
}

/**
 * GPU resources of one baked patch.  Create with TerrainPatchBaker.createPatch,
 * release with TerrainPatchBaker.disposePatch.
 */
export interface BakedPatch {
  readonly domain:     PatchDomain;
  readonly resolution: PatchBakeResolution;
  readonly dirTexture: THREE.DataTexture;
  /** textures[0] = elevation + gradient, textures[1] = erosion attributes. */
  readonly elevationTarget: THREE.WebGLRenderTarget;
  readonly treeTarget:      THREE.WebGLRenderTarget;
  /** textures[0] = water wave gradient, textures[1] = tree canopy tilt. */
  readonly bumpTarget:      THREE.WebGLRenderTarget;
  /** Allocated on the first detail bake. */
  detailTarget: THREE.WebGLRenderTarget | null;
  /** Biome layout of the patch — set with TerrainPatchBaker.setBiomes. */
  biomes: PatchBiomes;
}

export interface PatchBiomes {
  defaultBiome: number;
  edgeCount:    number;
  /** Packed boundary edges (see BiomeBoundaries); null when there are none. */
  edgeTexture:  THREE.DataTexture | null;
}

export class TerrainPatchBaker {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene  = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;

  private readonly elevationMaterial: THREE.ShaderMaterial;
  private readonly treeMaterial:      THREE.ShaderMaterial;
  private readonly bumpMaterial:      THREE.ShaderMaterial;
  private readonly detailMaterial:    THREE.ShaderMaterial;

  /** Bound in place of the biome edge texture when a patch has no boundary. */
  private readonly emptyBiomeTexture: THREE.DataTexture;

  private permTexture: THREE.DataTexture | null = null;
  private permSeed = NaN;

  /** Released render targets, reused by later patches of the same size. */
  private readonly targetPool = new Map<string, THREE.WebGLRenderTarget[]>();

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;

    const common = (): Record<string, THREE.IUniform> => ({
      uDirTex:       { value: null },
      uBakeSize:     { value: new THREE.Vector2(1, 1) },
      uPlanetRadius: { value: 1 },
      uTexelSize:    { value: 1 },
      uBandTexel:    { value: 0 },
    });

    const make = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>) =>
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: { ...common(), ...uniforms },
        vertexShader:   patchBakeVert,
        fragmentShader,
        depthTest:  false,
        depthWrite: false,
      });

    this.elevationMaterial = make(elevationComputeGLSL, {
      uPermTex:               { value: null },
      uNoiseType:             { value: 0 },
      uNoiseScale:            { value: 1 },
      uNoiseOctaves:          { value: 1 },
      uNoisePersistence:      { value: 0.5 },
      uNoiseLacunarity:       { value: 2 },
      uGaussCenter:           { value: new THREE.Vector3() },
      uGaussSigma:            { value: 1 },
      uGaussAmplitude:        { value: 1 },
      uFractalFreq:           { value: 1 },
      uFractalOctaves:        { value: 1 },
      uFractalLacunarity:     { value: 2 },
      uFractalGain:           { value: 0.5 },
      uFractalAmp:            { value: 1 },
      uErosionEnabled:        { value: 0 },
      uErosionOctaves:        { value: 1 },
      uErosionScale:          { value: 1 },
      uErosionStrength:       { value: 0 },
      uErosionGullyWeight:    { value: 0 },
      uErosionDetail:         { value: 1 },
      uErosionGain:           { value: 0.5 },
      uErosionLacunarity:     { value: 2 },
      uErosionCellScale:      { value: 1 },
      uErosionNormalization:  { value: 0 },
      uErosionRidgeRounding:  { value: 0 },
      uErosionCreaseRounding: { value: 0 },
      uBiomeEdgeTex:          { value: null },
      uBiomeEdgeCount:        { value: 0 },
      uBiomeDefault:          { value: BIOME_STANDARD },
      uBiomeHalfWidth:        { value: 0 },
      uBiomeWarpAmp:          { value: 0 },
      uBiomeWarpFreq:         { value: 1 },
      uBiomeElevBase:         { value: new THREE.Vector4() },
      uBiomeElevScale:        { value: new THREE.Vector4(1, 1, 1, 1) },
    });

    this.emptyBiomeTexture = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
    this.emptyBiomeTexture.needsUpdate = true;

    this.treeMaterial = make(treeDensityComputeGLSL, {
      uElevTex:       { value: null },
      uAttrTex:       { value: null },
      uElevOffset:    { value: 0 },
      uSeaLevel:      { value: 0 },
      uTreeEnabled:   { value: 0 },
      uTreeElevMax:   { value: 0 },
      uTreeElevMin:   { value: 0 },
      uTreeSlopeMin:  { value: 0 },
      uTreeRidgeMin:  { value: 0 },
      uTreeNoiseFreq: { value: 1 },
      uTreeNoisePow:  { value: 1 },
      uTreeDensity:   { value: 1 },
    });

    this.bumpMaterial = make(bumpComputeGLSL, {
      uWaterNormalFreq: { value: 1 },
      uTreeBumpFreq:    { value: 1 },
    });

    this.detailMaterial = make(detailNoiseComputeGLSL, {});

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.elevationMaterial);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  // ── Patch lifecycle ─────────────────────────────────────────────────────────

  /**
   * Allocates the GPU resources of a patch.  Nothing is baked yet — call
   * bakeAll (or the individual passes) afterwards.
   */
  createPatch(domain: PatchDomain, resolution: PatchBakeResolution): BakedPatch {
    const dirTexture = new THREE.DataTexture(
      domain.dirs as Float32Array<ArrayBuffer>, domain.res, domain.res,
      THREE.RGBAFormat, THREE.FloatType,
    );
    dirTexture.minFilter = THREE.LinearFilter;
    dirTexture.magFilter = THREE.LinearFilter;
    dirTexture.generateMipmaps = false;
    dirTexture.needsUpdate = true;

    return {
      domain,
      resolution: { ...resolution },
      dirTexture,
      elevationTarget: this.acquireTarget(resolution.elevation, 2, THREE.FloatType),
      treeTarget:      this.acquireTarget(resolution.elevation, 1, THREE.HalfFloatType),
      bumpTarget:      this.acquireTarget(resolution.bump, 2, THREE.HalfFloatType),
      detailTarget:    null,
      biomes:          { defaultBiome: BIOME_STANDARD, edgeCount: 0, edgeTexture: null },
    };
  }

  /**
   * Sets the biome layout of a patch (null = all standard).  Takes effect at
   * the next elevation bake.
   */
  setBiomes(patch: BakedPatch, set: BiomeBoundarySet | null): void {
    patch.biomes.edgeTexture?.dispose();
    patch.biomes = {
      defaultBiome: set?.defaultBiome ?? BIOME_STANDARD,
      edgeCount:    set ? biomeEdgeCount(set) : 0,
      edgeTexture:  set ? createBiomeEdgeTexture(set) : null,
    };
  }

  /** Releases the GPU resources of a patch.  Render targets go back to the pool. */
  disposePatch(patch: BakedPatch): void {
    patch.dirTexture.dispose();
    patch.biomes.edgeTexture?.dispose();
    patch.biomes = { defaultBiome: BIOME_STANDARD, edgeCount: 0, edgeTexture: null };
    this.releaseTarget(patch.elevationTarget);
    this.releaseTarget(patch.treeTarget);
    this.releaseTarget(patch.bumpTarget);
    if (patch.detailTarget) {
      this.releaseTarget(patch.detailTarget);
      patch.detailTarget = null;
    }
  }

  dispose(): void {
    for (const targets of this.targetPool.values()) {
      for (const target of targets) target.dispose();
    }
    this.targetPool.clear();
    this.permTexture?.dispose();
    this.permTexture = null;
    this.emptyBiomeTexture.dispose();
    this.elevationMaterial.dispose();
    this.treeMaterial.dispose();
    this.bumpMaterial.dispose();
    this.detailMaterial.dispose();
    this.quad.geometry.dispose();
  }

  // ── Bake passes ─────────────────────────────────────────────────────────────

  /** Runs every pass the current parameters require. */
  bakeAll(patch: BakedPatch, params: TerrainParams): void {
    this.bakeElevation(patch, params);
    this.bakeBump(patch, params);
    if (params.detailNoiseEnabled) this.bakeDetail(patch, params);
  }

  /** Elevation pass, followed by the tree density pass that depends on it. */
  bakeElevation(patch: BakedPatch, params: TerrainParams): void {
    const u = this.elevationMaterial.uniforms;
    this.setCommonUniforms(u, patch, patch.resolution.elevation, params);

    u.uPermTex.value          = this.getPermTexture(params.noiseParams.seed);
    u.uNoiseType.value        = params.noiseType;
    u.uNoiseScale.value       = params.noiseParams.scale;
    u.uNoiseOctaves.value     = params.noiseParams.octaves;
    u.uNoisePersistence.value = params.noiseParams.persistence;
    u.uNoiseLacunarity.value  = params.noiseParams.lacunarity;

    // The Gaussian bump is centred on the reference patch anchor; its sigma is
    // expressed relative to half the reference patch size.
    const anchor = tangentFrameFromLatLon(params.anchorLatDeg, params.anchorLonDeg).center;
    (u.uGaussCenter.value as THREE.Vector3).copy(anchor).multiplyScalar(params.planetRadiusUnits);
    u.uGaussSigma.value     = params.gaussianParams.sigma * params.patchSize * 0.5;
    u.uGaussAmplitude.value = params.gaussianParams.amplitude;

    u.uFractalFreq.value       = params.fractalNoiseParams.freq;
    u.uFractalOctaves.value    = params.fractalNoiseParams.octaves;
    u.uFractalLacunarity.value = params.fractalNoiseParams.lacunarity;
    u.uFractalGain.value       = params.fractalNoiseParams.gain;
    u.uFractalAmp.value        = params.fractalNoiseParams.amp;

    u.uErosionEnabled.value        = params.erosionEnabled ? 1 : 0;
    u.uErosionOctaves.value        = params.erosionOctaves;
    u.uErosionScale.value          = params.erosionScale;
    u.uErosionStrength.value       = params.erosionStrength;
    u.uErosionGullyWeight.value    = params.erosionGullyWeight;
    u.uErosionDetail.value         = params.erosionDetail;
    u.uErosionGain.value           = params.erosionGain;
    u.uErosionLacunarity.value     = params.erosionLacunarity;
    u.uErosionCellScale.value      = params.erosionCellScale;
    u.uErosionNormalization.value  = params.erosionNormalization;
    u.uErosionRidgeRounding.value  = params.erosionRidgeRounding;
    u.uErosionCreaseRounding.value = params.erosionCreaseRounding;

    const biomes = patch.biomes;
    u.uBiomeEdgeTex.value   = biomes.edgeTexture ?? this.emptyBiomeTexture;
    u.uBiomeEdgeCount.value = biomes.edgeTexture ? biomes.edgeCount : 0;
    u.uBiomeDefault.value   = biomes.defaultBiome;
    u.uBiomeHalfWidth.value = 0.5 * params.biomeTransitionKm / WORLD_RADIUS_KM;
    u.uBiomeWarpAmp.value   = params.biomeBoundaryNoiseKm / WORLD_RADIUS_KM;
    u.uBiomeWarpFreq.value  = params.kmPerUnit / Math.max(params.biomeBoundaryNoiseWavelengthKm, 1e-3);
    const elev = params.biomeElevationParams();
    (u.uBiomeElevBase.value  as THREE.Vector4).fromArray(elev.base);
    (u.uBiomeElevScale.value as THREE.Vector4).fromArray(elev.scale);

    this.render(this.elevationMaterial, patch.elevationTarget);
    this.bakeTreeDensity(patch, params);
  }

  /** Tree density pass.  Cheap: reads the elevation textures, no terrain noise. */
  bakeTreeDensity(patch: BakedPatch, params: TerrainParams): void {
    const u = this.treeMaterial.uniforms;
    this.setCommonUniforms(u, patch, patch.resolution.elevation, params);

    u.uElevTex.value       = patch.elevationTarget.textures[0];
    u.uAttrTex.value       = patch.elevationTarget.textures[1];
    u.uElevOffset.value    = params.elevationOffset;
    u.uSeaLevel.value      = params.seaLevel;
    u.uTreeEnabled.value   = params.treeEnabled ? 1 : 0;
    u.uTreeElevMax.value   = params.treeElevMax;
    u.uTreeElevMin.value   = params.treeElevMin;
    u.uTreeSlopeMin.value  = params.treeSlopeMin;
    u.uTreeRidgeMin.value  = params.treeRidgeMin;
    u.uTreeNoiseFreq.value = params.treeNoiseFreq;
    u.uTreeNoisePow.value  = params.treeNoisePow;
    u.uTreeDensity.value   = params.treeDensity;

    this.render(this.treeMaterial, patch.treeTarget);
  }

  /** Water wave gradient + tree canopy tilt. */
  bakeBump(patch: BakedPatch, params: TerrainParams): void {
    const u = this.bumpMaterial.uniforms;
    this.setCommonUniforms(u, patch, patch.resolution.bump, params);
    u.uWaterNormalFreq.value = params.terrainColors.waterNormalFreq;
    u.uTreeBumpFreq.value    = params.treeBumpFreq;
    this.render(this.bumpMaterial, patch.bumpTarget);
  }

  /** Detail noise.  Allocates the target on first use. */
  bakeDetail(patch: BakedPatch, params: TerrainParams): void {
    if (!patch.detailTarget) {
      patch.detailTarget = this.acquireTarget(patch.resolution.detail, 1, THREE.HalfFloatType);
    }
    const u = this.detailMaterial.uniforms;
    this.setCommonUniforms(u, patch, patch.resolution.detail, params);
    this.render(this.detailMaterial, patch.detailTarget);
  }

  // ── CPU access ──────────────────────────────────────────────────────────────

  /**
   * Reads the elevation texture back to the CPU.
   * Returns RGBA floats, row-major, `resolution.elevation` texels per side:
   *   R = raw elevation [0, 1] (before the elevation offset), GBA = surface gradient.
   * This stalls the GPU pipeline — call it sparingly, not every frame.
   */
  readElevation(patch: BakedPatch): Float32Array {
    const n = patch.resolution.elevation;
    const buffer = new Float32Array(n * n * 4);
    this.renderer.readRenderTargetPixels(patch.elevationTarget, 0, 0, n, n, buffer);
    return buffer;
  }

  /**
   * Nominal spacing of the baked samples of a texture of the given size, terrain units.
   * Derived from the nominal patch size, so it is the same for every patch of a
   * quadtree level (see PatchDomain.nominalArc).
   */
  static texelSize(patch: BakedPatch, texels: number, params: TerrainParams): number {
    return patchNominalSize(patch.domain, params.planetRadiusUnits) / Math.max(texels - 1, 1);
  }

  // ── private ─────────────────────────────────────────────────────────────────

  private setCommonUniforms(
    u: Record<string, THREE.IUniform>, patch: BakedPatch, texels: number, params: TerrainParams,
  ): void {
    const texel = TerrainPatchBaker.texelSize(patch, texels, params);
    u.uDirTex.value = patch.dirTexture;
    (u.uBakeSize.value as THREE.Vector2).set(texels, texels);
    u.uPlanetRadius.value = params.planetRadiusUnits;
    u.uTexelSize.value    = texel;
    u.uBandTexel.value    = params.bandLimit ? texel : 0;
  }

  private render(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget): void {
    const renderer = this.renderer;
    const prevTarget    = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;

    this.quad.material = material;
    renderer.autoClear = true;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
  }

  /**
   * Elevation needs full float precision; the shading signals (tree density,
   * bump, detail) are stored as half floats to halve their memory.
   */
  private acquireTarget(size: number, count: number, type: THREE.TextureDataType): THREE.WebGLRenderTarget {
    const pooled = this.targetPool.get(`${size}:${count}:${type}`)?.pop();
    if (pooled) return pooled;

    return new THREE.WebGLRenderTarget(size, size, {
      count,
      type,
      format:          THREE.RGBAFormat,
      minFilter:       THREE.LinearFilter,
      magFilter:       THREE.LinearFilter,
      wrapS:           THREE.ClampToEdgeWrapping,
      wrapT:           THREE.ClampToEdgeWrapping,
      generateMipmaps: false,
      depthBuffer:     false,
      stencilBuffer:   false,
    });
  }

  private releaseTarget(target: THREE.WebGLRenderTarget): void {
    const key = `${target.width}:${target.textures.length}:${target.texture.type}`;
    let list = this.targetPool.get(key);
    if (!list) {
      list = [];
      this.targetPool.set(key, list);
    }
    // Keep the pool bounded; anything beyond is freed.
    if (list.length < TerrainPatchBaker.MAX_POOLED_TARGETS) list.push(target);
    else target.dispose();
  }

  private static readonly MAX_POOLED_TARGETS = 64;

  private getPermTexture(seed: number): THREE.DataTexture {
    if (this.permTexture && this.permSeed === seed) return this.permTexture;

    this.permTexture?.dispose();
    const data = new Float32Array(new PerlinNoise3D(seed).getPermutation256());
    const tex = new THREE.DataTexture(data, 256, 1, THREE.RedFormat, THREE.FloatType);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;

    this.permTexture = tex;
    this.permSeed    = seed;
    return tex;
  }
}
