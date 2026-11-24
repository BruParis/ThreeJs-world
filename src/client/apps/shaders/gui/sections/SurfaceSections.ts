/**
 * Surface sections of the Biomes panel: ground colors, vegetation (grass,
 * trees) and water.
 *
 * These are biome properties in spirit, but the shaders have a single set of
 * them for now, applied to every biome.  Each section is written against a
 * folder so it can later be instantiated once per biome.
 */

import { FolderApi } from 'tweakpane';
import type { GUIContext } from '../GUIContext';

type RGB01 = [number, number, number];
const toTp   = (c: RGB01) => ({ r: c[0] * 255, g: c[1] * 255, b: c[2] * 255 });
const fromTp = (v: { r: number; g: number; b: number }): RGB01 => [v.r / 255, v.g / 255, v.b / 255];

// ── Ground ────────────────────────────────────────────────────────────────────

export function addGroundSection(folder: FolderApi, ctx: GUIContext): void {
  const { P, upd } = ctx;
  const C = P.terrainColors;
  const s = { sand: toTp(C.sandColor), cliff: toTp(C.cliffColor), dirt: toTp(C.dirtColor) };

  folder.addBinding(s, 'sand',  { label: 'Sand',  view: 'color' })
    .on('change', ({ value }) => { C.sandColor  = fromTp(value); upd.colors(); });
  folder.addBinding(s, 'cliff', { label: 'Cliff', view: 'color' })
    .on('change', ({ value }) => { C.cliffColor = fromTp(value); upd.colors(); });
  folder.addBinding(s, 'dirt',  { label: 'Dirt',  view: 'color' })
    .on('change', ({ value }) => { C.dirtColor  = fromTp(value); upd.colors(); });
}

// ── Vegetation ────────────────────────────────────────────────────────────────

export function addVegetationSection(folder: FolderApi, ctx: GUIContext): void {
  const { P, upd } = ctx;
  const C = P.terrainColors;

  const colors = { grass1: toTp(C.grassColor1), grass2: toTp(C.grassColor2), tree: toTp(C.treeColor) };
  folder.addBinding(colors, 'grass1', { label: 'Grass Low',  view: 'color' })
    .on('change', ({ value }) => { C.grassColor1 = fromTp(value); upd.colors(); });
  folder.addBinding(colors, 'grass2', { label: 'Grass High', view: 'color' })
    .on('change', ({ value }) => { C.grassColor2 = fromTp(value); upd.colors(); });
  folder.addBinding(colors, 'tree',   { label: 'Trees',      view: 'color' })
    .on('change', ({ value }) => { C.treeColor   = fromTp(value); upd.colors(); });

  // elevTop / fadeWidth replace the old elevMax / elevMin pair.
  // elevMax = elevTop, elevMin = elevTop - fadeWidth — always consistent, can't cross.
  const t = {
    enabled:      P.treeEnabled,
    elevTop:      P.treeElevMax,
    fadeWidth:    P.treeElevMax - P.treeElevMin,
    // Exposed as "max slope" (0=flat, 0.5=moderate steepness).
    // Internally stored as normalY minimum (flat=1, cliff=0), so inverted.
    maxSlope:     1.0 - P.treeSlopeMin,
    ridgeMin:     P.treeRidgeMin,
    noiseFreq:    P.treeNoiseFreq,
    noisePow:     P.treeNoisePow,
    density:      P.treeDensity,
    bumpStrength: P.treeBumpStrength,
    bumpFreq:     P.treeBumpFreq,
  };
  const applyElev = () => {
    P.treeElevMax = t.elevTop;
    P.treeElevMin = t.elevTop - t.fadeWidth;
    upd.trees();
  };

  const trees = folder.addFolder({ title: 'Trees', expanded: false });
  trees.addBinding(t, 'enabled',   { label: 'Enabled' })
    .on('change', ({ value }) => { P.treeEnabled = value; upd.trees(); });
  // elevTop: hard upper cutoff in offset-adjusted normalised elevation [0,1].
  // Effective ceiling ~0.505 from the grass-zone bake gate.
  trees.addBinding(t, 'elevTop',   { label: 'Elev. Top',   min: 0.45,  max: 0.56, step: 0.005 }).on('change', applyElev);
  // fadeWidth: width of the smoothstep transition zone below elevTop.
  trees.addBinding(t, 'fadeWidth', { label: 'Elev. Fade',  min: 0.005, max: 0.08, step: 0.005 }).on('change', applyElev);
  // maxSlope: 0 = only flat terrain, 0.5 = up to ~60° slope.
  trees.addBinding(t, 'maxSlope',  { label: 'Max Slope',   min: 0.0,   max: 0.5,  step: 0.01 })
    .on('change', ({ value }) => { P.treeSlopeMin = 1.0 - value; upd.trees(); });
  trees.addBinding(t, 'ridgeMin',  { label: 'Ridge Min',   min: -3.0,  max: 0.0,  step: 0.05 })
    .on('change', ({ value }) => { P.treeRidgeMin = value; upd.trees(); });
  trees.addBinding(t, 'noiseFreq', { label: 'Noise Freq',  min: 10,    max: 1000, step: 10 })
    .on('change', ({ value }) => { P.treeNoiseFreq = value; upd.trees(); });
  trees.addBinding(t, 'noisePow',  { label: 'Noise Power', min: 0.5,   max: 8.0,  step: 0.1 })
    .on('change', ({ value }) => { P.treeNoisePow = value; upd.trees(); });
  trees.addBinding(t, 'density',   { label: 'Density',     min: 0.1,   max: 5.0,  step: 0.1 })
    .on('change', ({ value }) => { P.treeDensity = value; upd.trees(); });

  const canopy = folder.addFolder({ title: 'Canopy Bump', expanded: false });
  canopy.addBinding(t, 'bumpStrength', { label: 'Strength',  min: 0.0, max: 2.0,   step: 0.05 })
    .on('change', ({ value }) => { P.treeBumpStrength = value; P.notify('display'); });
  canopy.addBinding(t, 'bumpFreq',     { label: 'Frequency', min: 10,  max: 500.0, step: 5 })
    .on('change', ({ value }) => { P.treeBumpFreq = value; upd.bump(); });
}

// ── Water ─────────────────────────────────────────────────────────────────────

export function addWaterSection(folder: FolderApi, ctx: GUIContext): void {
  const { P, upd } = ctx;
  const C = P.terrainColors;

  const s = {
    deep:      toTp(C.waterDeepColor),
    shore:     toTp(C.waterShoreColor),
    freq:      C.waterNormalFreq,
    strength:  C.waterNormalStrength,
    roughness: C.waterRoughness,
  };
  folder.addBinding(s, 'deep',  { label: 'Deep',  view: 'color' })
    .on('change', ({ value }) => { C.waterDeepColor  = fromTp(value); upd.colors(); });
  folder.addBinding(s, 'shore', { label: 'Shore', view: 'color' })
    .on('change', ({ value }) => { C.waterShoreColor = fromTp(value); upd.colors(); });
  folder.addBinding(s, 'freq',      { label: 'Wave Freq',     min: 0.1, max: 200.0, step: 0.5 })
    .on('change', ({ value }) => { C.waterNormalFreq     = value; upd.bump(); });
  folder.addBinding(s, 'strength',  { label: 'Wave Strength', min: 0.0, max: 2.0,   step: 0.01 })
    .on('change', ({ value }) => { C.waterNormalStrength = value; upd.colors(); });
  folder.addBinding(s, 'roughness', { label: 'Roughness',     min: 0.0, max: 1.0,   step: 0.01 })
    .on('change', ({ value }) => { C.waterRoughness      = value; upd.colors(); });
}
