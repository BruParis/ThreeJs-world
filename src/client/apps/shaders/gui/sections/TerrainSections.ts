/**
 * Terrain panel sections: the terrain recipe shared with the World tab —
 * real-world scale and location, elevation noise, erosion.
 */

import { FolderApi } from 'tweakpane';
import {
  NOISE_TYPE_SIMPLEX,
  NOISE_TYPE_PERLIN,
  NOISE_TYPE_GAUSSIAN,
  NOISE_TYPE_FRACTAL,
} from '../../../../shared/terrain/TerrainParams';
import {
  WORLD_RADIUS_KM,
  lodLevelForSizeKm,
  kmToArcDegrees,
} from '../../../../shared/world/World';
import type { GUIContext } from '../GUIContext';

// ── Scale & location ──────────────────────────────────────────────────────────
//
// Real-world size of what is on screen.  The flat patch is the terrain the
// planet has around the anchor point, so these numbers are exactly what the
// World tab shows for the same region.

export function addScaleSection(folder: FolderApi, ctx: GUIContext): void {
  const { P, terrain, upd } = ctx;

  const scaleParams = {
    kmPerUnit:    P.kmPerUnit,
    amplitudeKm:  P.elevationAmplitudeKm,
    exaggeration: P.elevationDisplayScale,
    bandLimit:    P.bandLimit,
    size:         P.patchSize,
    lat:          P.anchorLatDeg,
    lon:          P.anchorLonDeg,
  };

  folder.addBinding(scaleParams, 'kmPerUnit', { label: 'km / unit', min: 1, max: 1000, step: 1 })
    .on('change', ({ value }) => { P.kmPerUnit = value; ctx.refreshScale(); upd.elevation(); });
  folder.addBinding(scaleParams, 'amplitudeKm', { label: 'Relief (km)', min: 0.5, max: 30, step: 0.5 })
    .on('change', ({ value }) => { P.elevationAmplitudeKm = value; ctx.refreshScale(); upd.display(); });
  folder.addBinding(scaleParams, 'exaggeration', { label: 'Exaggeration', min: 1, max: 30, step: 0.5 })
    .on('change', ({ value }) => { P.elevationDisplayScale = value; ctx.refreshScale(); upd.display(); });
  folder.addBinding(scaleParams, 'size', { label: 'Patch (units)', min: 0.5, max: 8.0, step: 0.5 })
    .on('change', ({ value }) => { P.patchSize = value; ctx.refreshScale(); upd.elevation(); upd.bump(); });
  folder.addBinding(scaleParams, 'bandLimit', { label: 'Band-limit' })
    .on('change', ({ value }) => { P.bandLimit = value; upd.elevation(); upd.bump(); P.notify('detail'); });

  const anchorFolder = folder.addFolder({ title: 'Location on the planet', expanded: true });
  anchorFolder.addBinding(scaleParams, 'lat', { label: 'Latitude',  min: -90,  max: 90,  step: 0.1 })
    .on('change', ({ value }) => { P.anchorLatDeg = value; upd.elevation(); upd.bump(); });
  anchorFolder.addBinding(scaleParams, 'lon', { label: 'Longitude', min: -180, max: 180, step: 0.1 })
    .on('change', ({ value }) => { P.anchorLonDeg = value; upd.elevation(); upd.bump(); });

  const scaleInfo = {
    patchKm:     0,
    texelM:      0,
    peakRealKm:  0,
    peakShownKm: 0,
    featureKm:   0,
    arcDeg:      0,
    lodLevel:    0,
    planetShare: '',
  };
  const infoFolder = folder.addFolder({ title: 'Patch info', expanded: false });
  const fmt = (digits: number) => ({ readonly: true as const, format: (v: number) => v.toFixed(digits) });
  infoFolder.addBinding(scaleInfo, 'patchKm',     { label: 'Patch size (km)',   ...fmt(1) });
  infoFolder.addBinding(scaleInfo, 'texelM',      { label: 'Grid cell (m)',     ...fmt(0) });
  infoFolder.addBinding(scaleInfo, 'peakRealKm',  { label: 'Max height (km)',   ...fmt(2) });
  infoFolder.addBinding(scaleInfo, 'peakShownKm', { label: 'Shown height (km)', ...fmt(1) });
  infoFolder.addBinding(scaleInfo, 'featureKm',   { label: 'Feature size (km)', ...fmt(1) });
  infoFolder.addBinding(scaleInfo, 'arcDeg',      { label: 'Arc (deg)',         ...fmt(3) });
  infoFolder.addBinding(scaleInfo, 'lodLevel',    { label: 'Quadtree level',    ...fmt(2) });
  infoFolder.addBinding(scaleInfo, 'planetShare', { label: 'Planet radius',     readonly: true });

  /** Wavelength, in terrain units, of the coarsest octave of the active base noise. */
  const baseWavelengthUnits = (): number => {
    if (P.noiseType === NOISE_TYPE_FRACTAL)  return 1 / P.fractalNoiseParams.freq;
    if (P.noiseType === NOISE_TYPE_GAUSSIAN) return P.gaussianParams.sigma * P.patchSize;
    return 1 / P.noiseParams.scale;
  };

  ctx.refreshScale = () => {
    const patchesPerSide = Math.round(Math.sqrt(terrain.numPatches));
    const cells          = patchesPerSide * terrain.subdivisions;
    scaleInfo.patchKm     = P.patchSizeKm;
    scaleInfo.texelM      = (P.patchSizeKm / cells) * 1000;
    scaleInfo.peakRealKm  = (1 - P.seaLevel) * P.elevationAmplitudeKm;
    scaleInfo.peakShownKm = (1 - P.seaLevel) * P.elevationAmplitudeApparentKm;
    scaleInfo.featureKm   = baseWavelengthUnits() * P.kmPerUnit;
    scaleInfo.arcDeg      = kmToArcDegrees(P.patchSizeKm);
    scaleInfo.lodLevel    = lodLevelForSizeKm(P.patchSizeKm);
    scaleInfo.planetShare = `1 / ${(WORLD_RADIUS_KM / P.patchSizeKm).toFixed(1)}`;
    infoFolder.refresh();
  };
  ctx.refreshScale();
}

// ── Elevation ─────────────────────────────────────────────────────────────────

export function addElevationSection(folder: FolderApi, ctx: GUIContext): void {
  const { P, upd } = ctx;

  const isFractal  = () => P.noiseType === NOISE_TYPE_FRACTAL;
  const isGaussian = () => P.noiseType === NOISE_TYPE_GAUSSIAN;
  const isStdNoise = () => !isFractal() && !isGaussian();

  const elevParams = { type: P.noiseType, elevationOffset: P.elevationOffset };
  folder.addBinding(elevParams, 'type', {
    label: 'Noise type',
    options: { Simplex: NOISE_TYPE_SIMPLEX, Perlin: NOISE_TYPE_PERLIN, Gaussian: NOISE_TYPE_GAUSSIAN, FractalNoise: NOISE_TYPE_FRACTAL },
  }).on('change', ({ value }) => {
    P.noiseType = Number(value);
    updateVisibility();
    upd.elevation();
  });
  folder.addBinding(elevParams, 'elevationOffset', { label: 'Elev. Offset', min: -0.4, max: 0.5, step: 0.01 })
    // The ocean floor is baked to stay below sea level whatever the offset, so
    // the offset also needs an elevation re-bake (debounced).
    .on('change', ({ value }) => { P.elevationOffset = value; P.notify('trees'); upd.elevation(); });

  const noiseFolder = folder.addFolder({ title: 'Noise', expanded: true });
  noiseFolder.addBinding(P.noiseParams, 'scale',       { label: 'Scale',       min: 0.5, max: 10.0, step: 0.1  }).on('change', upd.elevation);
  noiseFolder.addBinding(P.noiseParams, 'octaves',     { label: 'Octaves',     min: 1,   max: 8,    step: 1    }).on('change', upd.elevation);
  noiseFolder.addBinding(P.noiseParams, 'persistence', { label: 'Persistence', min: 0.1, max: 1.0,  step: 0.05 }).on('change', upd.elevation);
  noiseFolder.addBinding(P.noiseParams, 'lacunarity',  { label: 'Lacunarity',  min: 1.0, max: 4.0,  step: 0.1  }).on('change', upd.elevation);

  const gaussFolder = folder.addFolder({ title: 'Gaussian', expanded: true });
  const gaussParams = { sigma: P.gaussianParams.sigma, amplitude: P.gaussianParams.amplitude };
  gaussFolder.addBinding(gaussParams, 'sigma',     { label: 'Sigma',     min: 0.05, max: 2.0, step: 0.01 })
    .on('change', ({ value }) => { P.gaussianParams.sigma = value; upd.elevation(); });
  gaussFolder.addBinding(gaussParams, 'amplitude', { label: 'Amplitude', min: 0.0,  max: 1.0, step: 0.01 })
    .on('change', ({ value }) => { P.gaussianParams.amplitude = value; upd.elevation(); });

  const fractalFolder = folder.addFolder({ title: 'FractalNoise', expanded: true });
  fractalFolder.addBinding(P.fractalNoiseParams, 'freq',       { label: 'Frequency',  min: 0.1,   max: 10.0, step: 0.1  }).on('change', upd.elevation);
  fractalFolder.addBinding(P.fractalNoiseParams, 'octaves',    { label: 'Octaves',    min: 1,     max: 8,    step: 1    }).on('change', upd.elevation);
  fractalFolder.addBinding(P.fractalNoiseParams, 'lacunarity', { label: 'Lacunarity', min: 1.0,   max: 4.0,  step: 0.1  }).on('change', upd.elevation);
  fractalFolder.addBinding(P.fractalNoiseParams, 'gain',       { label: 'Gain',       min: 0.01,  max: 1.0,  step: 0.01 }).on('change', upd.elevation);
  fractalFolder.addBinding(P.fractalNoiseParams, 'amp',        { label: 'Amp',        min: 0.001, max: 0.6,  step: 0.01 }).on('change', upd.elevation);

  const updateVisibility = () => {
    noiseFolder.hidden   = !isStdNoise();
    gaussFolder.hidden   = !isGaussian();
    fractalFolder.hidden = !isFractal();
  };
  updateVisibility();

  const detailFolder = folder.addFolder({ title: 'Detail Noise', expanded: false });
  const detailParams = { enabled: P.detailNoiseEnabled, strength: P.detailNoiseStrength };
  detailFolder.addBinding(detailParams, 'enabled', { label: 'Enabled' })
    .on('change', ({ value }) => { P.detailNoiseEnabled = value; P.notify('detail'); });
  detailFolder.addBinding(detailParams, 'strength', { label: 'Strength', min: 0.0, max: 2.0, step: 0.05 })
    .on('change', ({ value }) => { P.detailNoiseStrength = value; P.notify('display'); });
}

// ── Erosion ───────────────────────────────────────────────────────────────────

export function addErosionSection(folder: FolderApi, ctx: GUIContext): void {
  const { P, upd } = ctx;

  const e = {
    enabled:        P.erosionEnabled,
    scale:          P.erosionScale,
    strength:       P.erosionStrength,
    gullyWeight:    P.erosionGullyWeight,
    detail:         P.erosionDetail,
    octaves:        P.erosionOctaves,
    lacunarity:     P.erosionLacunarity,
    gain:           P.erosionGain,
    cellScale:      P.erosionCellScale,
    normalization:  P.erosionNormalization,
    ridgeRounding:  P.erosionRidgeRounding,
    creaseRounding: P.erosionCreaseRounding,
  };

  folder.addBinding(e, 'enabled',     { label: 'Enabled' })
    .on('change', ({ value }) => { P.erosionEnabled = value; upd.elevation(); });
  folder.addBinding(e, 'scale',       { label: 'Scale',        min: 0.02, max: 0.5, step: 0.01 })
    .on('change', ({ value }) => { P.erosionScale = value; upd.elevation(); });
  folder.addBinding(e, 'strength',    { label: 'Strength',     min: 0.0,  max: 0.5, step: 0.01 })
    .on('change', ({ value }) => { P.erosionStrength = value; upd.elevation(); });
  folder.addBinding(e, 'gullyWeight', { label: 'Gully Weight', min: 0.0,  max: 1.0, step: 0.01 })
    .on('change', ({ value }) => { P.erosionGullyWeight = value; upd.elevation(); });
  folder.addBinding(e, 'detail',      { label: 'Detail',       min: 0.3,  max: 3.0, step: 0.05 })
    .on('change', ({ value }) => { P.erosionDetail = value; upd.elevation(); });
  folder.addBinding(e, 'octaves',     { label: 'Octaves',      min: 1,    max: 8,   step: 1    })
    .on('change', ({ value }) => { P.erosionOctaves = value; upd.elevation(); });
  folder.addBinding(e, 'lacunarity',  { label: 'Lacunarity',   min: 1.0,  max: 4.0, step: 0.1  })
    .on('change', ({ value }) => { P.erosionLacunarity = value; upd.elevation(); });
  folder.addBinding(e, 'gain',        { label: 'Gain',         min: 0.1,  max: 1.0, step: 0.05 })
    .on('change', ({ value }) => { P.erosionGain = value; upd.elevation(); });

  const adv = folder.addFolder({ title: 'Advanced', expanded: false });
  adv.addBinding(e, 'cellScale',      { label: 'Cell Scale',      min: 0.2, max: 2.0, step: 0.05 })
    .on('change', ({ value }) => { P.erosionCellScale = value; upd.elevation(); });
  adv.addBinding(e, 'normalization',  { label: 'Normalization',   min: 0.0, max: 1.0, step: 0.05 })
    .on('change', ({ value }) => { P.erosionNormalization = value; upd.elevation(); });
  adv.addBinding(e, 'ridgeRounding',  { label: 'Ridge Rounding',  min: 0.0, max: 1.0, step: 0.05 })
    .on('change', ({ value }) => { P.erosionRidgeRounding = value; upd.elevation(); });
  adv.addBinding(e, 'creaseRounding', { label: 'Crease Rounding', min: 0.0, max: 1.0, step: 0.05 })
    .on('change', ({ value }) => { P.erosionCreaseRounding = value; upd.elevation(); });
}
