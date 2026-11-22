import { Pane } from 'tweakpane';
import { DirectionalLight, AmbientLight } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FlyCam } from '@core/FlyCam';
import { TerrainMesh } from '../terrain/TerrainMesh';
import { SUBDIVISION_OPTIONS, PATCH_OPTIONS } from '../terrain/TerrainConstants';
import {
  NOISE_TYPE_SIMPLEX,
  NOISE_TYPE_PERLIN,
  NOISE_TYPE_GAUSSIAN,
  NOISE_TYPE_FRACTAL,
} from '../../../shared/terrain/TerrainParams';
import {
  WORLD_RADIUS_KM,
  lodLevelForSizeKm,
  kmToArcDegrees,
} from '../../../shared/world/World';
import {
  TERRAIN_DEBUG_COLOR,
  TERRAIN_DEBUG_ELEVATION,
  TERRAIN_DEBUG_RIDGEMAP,
  TERRAIN_DEBUG_TREES,
  TERRAIN_DEBUG_NORMALS,
  TERRAIN_DEBUG_STEEPNESS,
  TERRAIN_DEBUG_EXPOSURE,
  TERRAIN_DEBUG_BREAKUP,
  TERRAIN_DEBUG_CLASSIFICATION,
} from '@core/shaders/terrainSampleGLSL';

export interface ShaderDemoGUIHandle {
  show(): void;
  hide(): void;
  destroy(): void;
}

export function buildShaderDemoGUI(
  contentArea: HTMLElement,
  terrain: TerrainMesh,
  controls: OrbitControls,
  flyCam: FlyCam,
  sunLight: DirectionalLight,
  ambientLight: AmbientLight,
): ShaderDemoGUIHandle {

  // ── Pane setup ────────────────────────────────────────────────────────────
  const pane = new Pane({ title: 'Controls' });
  pane.element.style.position = 'absolute';
  pane.element.style.top      = '0';
  pane.element.style.right    = '0';
  pane.element.style.width    = '280px';
  pane.element.style.display  = 'none';
  contentArea.appendChild(pane.element);

  const tab = pane.addTab({
    pages: [
      { title: 'View'     },
      { title: 'Scale'    },
      { title: 'Terrain'  },
      { title: 'Elevation' },
      { title: 'Erosion'  },
      { title: 'Trees'    },
      { title: 'Colors'   },
      { title: 'Lighting' },
    ],
  });
  const [viewPage, scalePage, terrainPage, elevationPage, erosionPage, treesPage, colorsPage, lightingPage] = tab.pages;

  // ── Shared callbacks ──────────────────────────────────────────────────────
  //
  // Terrain parameters live in the shared store P.  Controls write to it and
  // notify; the terrain (and the World tab) react to the notification.

  const P = terrain.params;

  function debounce(fn: () => void, ms: number): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(fn, ms);
    };
  }

  const updDisplay   = () => { terrain.updateUniforms(); P.notify('display'); };
  const updElevation = debounce(() => { P.notify('elevation'); refreshScale(); }, 150);
  const updNoise     = updElevation;
  const updGeometry  = () => { terrain.rebuild(); refreshScale(); };
  const updColors    = () => P.notify('display');
  const updBump      = debounce(() => P.notify('bump'), 150);

  // ── Tab: View ─────────────────────────────────────────────────────────────

  const camParams = { flyCam: false };
  viewPage.addBinding(camParams, 'flyCam', { label: 'Fly Camera' })
    .on('change', ({ value }) => {
      if (value) { controls.enabled = false; flyCam.enable(); }
      else       { flyCam.disable(); controls.enabled = true; }
    });

  const displayParams = {
    wireframe: terrain.wireframe,
    debugMode: P.terrainColors.debugMode,
  };
  viewPage.addBinding(displayParams, 'wireframe', { label: 'Wireframe' })
    .on('change', ({ value }) => { terrain.wireframe = value; updDisplay(); });
  viewPage.addBinding(displayParams, 'debugMode', {
    label: 'Debug View',
    options: {
      'Color':          TERRAIN_DEBUG_COLOR,
      'Elevation':      TERRAIN_DEBUG_ELEVATION,
      'Ridge Map':      TERRAIN_DEBUG_RIDGEMAP,
      'Trees':          TERRAIN_DEBUG_TREES,
      'Normals':        TERRAIN_DEBUG_NORMALS,
      'Steepness':      TERRAIN_DEBUG_STEEPNESS,
      'Exposure':      TERRAIN_DEBUG_EXPOSURE,
      'Breakup':        TERRAIN_DEBUG_BREAKUP,
      'Classification': TERRAIN_DEBUG_CLASSIFICATION,
    },
  }).on('change', ({ value }) => {
    P.terrainColors.debugMode = Number(value);
    updColors();
  });

  // ── Tab: Scale ────────────────────────────────────────────────────────────
  //
  // Real-world size of what is on screen.  The flat patch is the terrain the
  // planet has around the anchor point, so these numbers are exactly what the
  // World tab shows for the same region.

  const scaleInfo = {
    patchKm:      0,
    texelM:       0,
    peakRealKm:   0,
    peakShownKm:  0,
    featureKm:    0,
    arcDeg:       0,
    lodLevel:     0,
    planetShare:  '',
  };

  const scaleParams = {
    kmPerUnit:    P.kmPerUnit,
    amplitudeKm:  P.elevationAmplitudeKm,
    exaggeration: P.elevationDisplayScale,
    bandLimit:    P.bandLimit,
    lat:          P.anchorLatDeg,
    lon:          P.anchorLonDeg,
  };

  const worldFolder = scalePage.addFolder({ title: 'Real-world scale', expanded: true });
  worldFolder.addBinding(scaleParams, 'kmPerUnit', { label: 'km / unit', min: 1, max: 1000, step: 1 })
    .on('change', ({ value }) => { P.kmPerUnit = value; refreshScale(); updElevation(); });
  worldFolder.addBinding(scaleParams, 'amplitudeKm', { label: 'Relief (km)', min: 0.5, max: 30, step: 0.5 })
    .on('change', ({ value }) => { P.elevationAmplitudeKm = value; refreshScale(); updDisplay(); });
  worldFolder.addBinding(scaleParams, 'exaggeration', { label: 'Exaggeration', min: 1, max: 30, step: 0.5 })
    .on('change', ({ value }) => { P.elevationDisplayScale = value; refreshScale(); updDisplay(); });
  worldFolder.addBinding(scaleParams, 'bandLimit', { label: 'Band-limit' })
    .on('change', ({ value }) => { P.bandLimit = value; updElevation(); updBump(); P.notify('detail'); });

  const anchorFolder = scalePage.addFolder({ title: 'Location on the planet', expanded: true });
  anchorFolder.addBinding(scaleParams, 'lat', { label: 'Latitude',  min: -90,  max: 90,  step: 0.1 })
    .on('change', ({ value }) => { P.anchorLatDeg = value; updElevation(); updBump(); });
  anchorFolder.addBinding(scaleParams, 'lon', { label: 'Longitude', min: -180, max: 180, step: 0.1 })
    .on('change', ({ value }) => { P.anchorLonDeg = value; updElevation(); updBump(); });

  const infoFolder = scalePage.addFolder({ title: 'This patch on the planet', expanded: true });
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
  function baseWavelengthUnits(): number {
    if (P.noiseType === NOISE_TYPE_FRACTAL)  return 1 / P.fractalNoiseParams.freq;
    if (P.noiseType === NOISE_TYPE_GAUSSIAN) return P.gaussianParams.sigma * P.patchSize;
    return 1 / P.noiseParams.scale;
  }

  function refreshScale(): void {
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
  }

  // ── Tab: Terrain ──────────────────────────────────────────────────────────

  const terrainParams = {
    size:            P.patchSize,
    numPatches:      terrain.numPatches,
    subdivision:     terrain.subdivisions,
    elevationOffset: P.elevationOffset,
  };

  terrainPage.addBinding(terrainParams, 'size', { label: 'Size', min: 0.5, max: 8.0, step: 0.5 })
    .on('change', ({ value }) => { P.patchSize = value; refreshScale(); updElevation(); updBump(); });
  terrainPage.addBinding(terrainParams, 'numPatches', { label: 'Patches', options: PATCH_OPTIONS })
    .on('change', ({ value }) => { terrain.numPatches = value; updGeometry(); });
  terrainPage.addBinding(terrainParams, 'subdivision', { label: 'Subdivision', options: SUBDIVISION_OPTIONS })
    .on('change', ({ value }) => { terrain.subdivisions = Number(value); updGeometry(); });
  terrainPage.addBinding(terrainParams, 'elevationOffset', { label: 'Elev. Offset', min: -0.4, max: 0.5, step: 0.01 })
    .on('change', ({ value }) => { P.elevationOffset = value; P.notify('trees'); });

  // ── Tab: Elevation ───────────────────────────────────────────────────────

  const isFractal  = () => P.noiseType === NOISE_TYPE_FRACTAL;
  const isGaussian = () => P.noiseType === NOISE_TYPE_GAUSSIAN;
  const isStdNoise = () => !isFractal() && !isGaussian();

  const noiseTypeParams = { type: P.noiseType };
  elevationPage.addBinding(noiseTypeParams, 'type', {
    label: 'Type',
    options: { Simplex: NOISE_TYPE_SIMPLEX, Perlin: NOISE_TYPE_PERLIN, Gaussian: NOISE_TYPE_GAUSSIAN, FractalNoise: NOISE_TYPE_FRACTAL },
  }).on('change', ({ value }) => {
    P.noiseType = Number(value);
    noiseFolder.hidden        = !isStdNoise();
    gaussFolder.hidden        = !isGaussian();
    fractalNoiseFolder.hidden = !isFractal();
    updElevation();
  });

  const noiseFolder = elevationPage.addFolder({ title: 'Noise', expanded: true });
  noiseFolder.addBinding(P.noiseParams, 'scale',       { label: 'Scale',       min: 0.5, max: 10.0, step: 0.1  }).on('change', updNoise);
  noiseFolder.addBinding(P.noiseParams, 'octaves',     { label: 'Octaves',     min: 1,   max: 8,    step: 1    }).on('change', updNoise);
  noiseFolder.addBinding(P.noiseParams, 'persistence', { label: 'Persistence', min: 0.1, max: 1.0,  step: 0.05 }).on('change', updNoise);
  noiseFolder.addBinding(P.noiseParams, 'lacunarity',  { label: 'Lacunarity',  min: 1.0, max: 4.0,  step: 0.1  }).on('change', updNoise);

  const gaussFolder = elevationPage.addFolder({ title: 'Gaussian', expanded: true });
  const gaussParams  = { sigma: P.gaussianParams.sigma, amplitude: P.gaussianParams.amplitude };
  gaussFolder.addBinding(gaussParams, 'sigma',     { label: 'Sigma',     min: 0.05, max: 2.0, step: 0.01 })
    .on('change', ({ value }) => { P.gaussianParams.sigma = value; updElevation(); });
  gaussFolder.addBinding(gaussParams, 'amplitude', { label: 'Amplitude', min: 0.0,  max: 1.0, step: 0.01 })
    .on('change', ({ value }) => { P.gaussianParams.amplitude = value; updElevation(); });

  const fractalNoiseFolder = elevationPage.addFolder({ title: 'FractalNoise', expanded: true });
  fractalNoiseFolder.addBinding(P.fractalNoiseParams, 'freq',       { label: 'Frequency',  min: 0.1, max: 10.0, step: 0.1  }).on('change', updElevation);
  fractalNoiseFolder.addBinding(P.fractalNoiseParams, 'octaves',    { label: 'Octaves',    min: 1,   max: 8,    step: 1    }).on('change', updElevation);
  fractalNoiseFolder.addBinding(P.fractalNoiseParams, 'lacunarity', { label: 'Lacunarity', min: 1.0, max: 4.0,  step: 0.1  }).on('change', updElevation);
  fractalNoiseFolder.addBinding(P.fractalNoiseParams, 'gain',       { label: 'Gain',       min: 0.01, max: 1.0, step: 0.01 }).on('change', updElevation);
  fractalNoiseFolder.addBinding(P.fractalNoiseParams, 'amp',        { label: 'Amp',        min: 0.001, max: 0.6, step: 0.01 }).on('change', updElevation);

  // Initial visibility
  noiseFolder.hidden        = !isStdNoise();
  gaussFolder.hidden        = !isGaussian();
  fractalNoiseFolder.hidden = !isFractal();

  const suppFolder = elevationPage.addFolder({ title: 'Detail Noise', expanded: false });
  const suppParams = { enabled: P.detailNoiseEnabled, strength: P.detailNoiseStrength };
  suppFolder.addBinding(suppParams, 'enabled', { label: 'Enabled' })
    .on('change', ({ value }) => { P.detailNoiseEnabled = value; P.notify('detail'); });
  suppFolder.addBinding(suppParams, 'strength', { label: 'Strength', min: 0.0, max: 2.0, step: 0.05 })
    .on('change', ({ value }) => { P.detailNoiseStrength = value; P.notify('display'); });

  // ── Tab: Erosion ──────────────────────────────────────────────────────────

  const erosionParams = {
    enabled:         P.erosionEnabled,
    scale:           P.erosionScale,
    strength:        P.erosionStrength,
    gullyWeight:     P.erosionGullyWeight,
    detail:          P.erosionDetail,
    octaves:         P.erosionOctaves,
    lacunarity:      P.erosionLacunarity,
    gain:            P.erosionGain,
    cellScale:       P.erosionCellScale,
    normalization:   P.erosionNormalization,
    ridgeRounding:   P.erosionRidgeRounding,
    creaseRounding:  P.erosionCreaseRounding,
  };

  erosionPage.addBinding(erosionParams, 'enabled',        { label: 'Enabled' })
    .on('change', ({ value }) => { P.erosionEnabled = value; updElevation(); });
  erosionPage.addBinding(erosionParams, 'scale',          { label: 'Scale',          min: 0.02, max: 0.5,  step: 0.01 })
    .on('change', ({ value }) => { P.erosionScale = value; updElevation(); });
  erosionPage.addBinding(erosionParams, 'strength',       { label: 'Strength',       min: 0.0,  max: 0.5,  step: 0.01 })
    .on('change', ({ value }) => { P.erosionStrength = value; updElevation(); });
  erosionPage.addBinding(erosionParams, 'gullyWeight',    { label: 'Gully Weight',   min: 0.0,  max: 1.0,  step: 0.01 })
    .on('change', ({ value }) => { P.erosionGullyWeight = value; updElevation(); });
  erosionPage.addBinding(erosionParams, 'detail',         { label: 'Detail',         min: 0.3,  max: 3.0,  step: 0.05 })
    .on('change', ({ value }) => { P.erosionDetail = value; updElevation(); });
  erosionPage.addBinding(erosionParams, 'octaves',        { label: 'Octaves',        min: 1,    max: 8,    step: 1    })
    .on('change', ({ value }) => { P.erosionOctaves = value; updElevation(); });
  erosionPage.addBinding(erosionParams, 'lacunarity',     { label: 'Lacunarity',     min: 1.0,  max: 4.0,  step: 0.1  })
    .on('change', ({ value }) => { P.erosionLacunarity = value; updElevation(); });
  erosionPage.addBinding(erosionParams, 'gain',           { label: 'Gain',           min: 0.1,  max: 1.0,  step: 0.05 })
    .on('change', ({ value }) => { P.erosionGain = value; updElevation(); });

  const erosionAdvFolder = erosionPage.addFolder({ title: 'Advanced', expanded: false });
  erosionAdvFolder.addBinding(erosionParams, 'cellScale',      { label: 'Cell Scale',      min: 0.2, max: 2.0, step: 0.05 })
    .on('change', ({ value }) => { P.erosionCellScale = value; updElevation(); });
  erosionAdvFolder.addBinding(erosionParams, 'normalization',  { label: 'Normalization',   min: 0.0, max: 1.0, step: 0.05 })
    .on('change', ({ value }) => { P.erosionNormalization = value; updElevation(); });
  erosionAdvFolder.addBinding(erosionParams, 'ridgeRounding',  { label: 'Ridge Rounding',  min: 0.0, max: 1.0, step: 0.05 })
    .on('change', ({ value }) => { P.erosionRidgeRounding = value; updElevation(); });
  erosionAdvFolder.addBinding(erosionParams, 'creaseRounding', { label: 'Crease Rounding', min: 0.0, max: 1.0, step: 0.05 })
    .on('change', ({ value }) => { P.erosionCreaseRounding = value; updElevation(); });

  // ── Tab: Trees ────────────────────────────────────────────────────────────

  // elevTop / fadeWidth replace the old elevMax / elevMin pair.
  // elevMax = elevTop, elevMin = elevTop - fadeWidth — always consistent, can't cross.
  const treeParams = {
    enabled:    P.treeEnabled,
    elevTop:    P.treeElevMax,
    fadeWidth:  P.treeElevMax - P.treeElevMin,
    // Exposed as "max slope" (0=flat, 0.5=moderate steepness).
    // Internally stored as normalY minimum (flat=1, cliff=0), so inverted.
    maxSlope:   1.0 - P.treeSlopeMin,
    ridgeMin:   P.treeRidgeMin,
    noiseFreq:  P.treeNoiseFreq,
    noisePow:   P.treeNoisePow,
    density:    P.treeDensity,
    bumpStrength: P.treeBumpStrength,
    bumpFreq:     P.treeBumpFreq,
  };

  const updTrees = () => P.notify('trees');

  const applyElevParams = () => {
    P.treeElevMax = treeParams.elevTop;
    P.treeElevMin = treeParams.elevTop - treeParams.fadeWidth;
    updTrees();
  };

  treesPage.addBinding(treeParams, 'enabled',   { label: 'Enabled' })
    .on('change', ({ value }) => { P.treeEnabled = value; updTrees(); });
  // elevTop: hard upper cutoff in offset-adjusted normalised elevation [0,1].
  // Effective ceiling ~0.505 from the grass-zone bake gate, so values above that
  // have no additional effect.
  treesPage.addBinding(treeParams, 'elevTop',   { label: 'Elev. Top',    min: 0.45, max: 0.56, step: 0.005 })
    .on('change', applyElevParams);
  // fadeWidth: width of the smoothstep transition zone below elevTop.
  // Always > 0, so elevMin = elevTop - fadeWidth never crosses elevMax.
  treesPage.addBinding(treeParams, 'fadeWidth', { label: 'Elev. Fade',   min: 0.005, max: 0.08, step: 0.005 })
    .on('change', applyElevParams);
  // maxSlope: 0 = only flat terrain, 0.5 = up to ~60° slope.
  // Internally converted to normalY minimum (normalY = dot(normal, up); flat → 1, cliff → 0).
  treesPage.addBinding(treeParams, 'maxSlope', { label: 'Max Slope',     min: 0.0,  max: 0.5,  step: 0.01  })
    .on('change', ({ value }) => { P.treeSlopeMin = 1.0 - value; updTrees(); });
  treesPage.addBinding(treeParams, 'ridgeMin',  { label: 'Ridge Min',    min: -3.0, max: 0.0,    step: 0.05  })
    .on('change', ({ value }) => { P.treeRidgeMin = value; updTrees(); });
  treesPage.addBinding(treeParams, 'noiseFreq', { label: 'Noise Freq',   min: 10,   max: 1000,   step: 10    })
    .on('change', ({ value }) => { P.treeNoiseFreq = value; updTrees(); });
  treesPage.addBinding(treeParams, 'noisePow',  { label: 'Noise Power',  min: 0.5,  max: 8.0,    step: 0.1   })
    .on('change', ({ value }) => { P.treeNoisePow = value; updTrees(); });
  treesPage.addBinding(treeParams, 'density',   { label: 'Density',      min: 0.1,  max: 5.0,    step: 0.1   })
    .on('change', ({ value }) => { P.treeDensity = value; updTrees(); });

  const treeBumpFolder = treesPage.addFolder({ title: 'Canopy Bump', expanded: true });
  treeBumpFolder.addBinding(treeParams, 'bumpStrength', { label: 'Strength',  min: 0.0, max: 2.0,   step: 0.05 })
    .on('change', ({ value }) => { P.treeBumpStrength = value; P.notify('display'); });
  treeBumpFolder.addBinding(treeParams, 'bumpFreq',     { label: 'Frequency', min: 10,  max: 500.0, step: 5    })
    .on('change', ({ value }) => { P.treeBumpFreq = value; updBump(); });

  // ── Tab: Colors ───────────────────────────────────────────────────────────

  function rgb01ToTp(c: [number, number, number]) {
    return { r: c[0] * 255, g: c[1] * 255, b: c[2] * 255 };
  }
  function tpToRgb01(v: { r: number; g: number; b: number }): [number, number, number] {
    return [v.r / 255, v.g / 255, v.b / 255];
  }

  const colorState = {
    sandColor:   rgb01ToTp(P.terrainColors.sandColor),
    cliffColor:  rgb01ToTp(P.terrainColors.cliffColor),
    dirtColor:   rgb01ToTp(P.terrainColors.dirtColor),
    grassColor1: rgb01ToTp(P.terrainColors.grassColor1),
    grassColor2: rgb01ToTp(P.terrainColors.grassColor2),
    treeColor:   rgb01ToTp(P.terrainColors.treeColor),
    waterDeepColor:  rgb01ToTp(P.terrainColors.waterDeepColor),
    waterShoreColor: rgb01ToTp(P.terrainColors.waterShoreColor),
  };

  const landColFolder = colorsPage.addFolder({ title: 'Land', expanded: true });
  landColFolder.addBinding(colorState, 'sandColor', { label: 'Sand', view: 'color' })
    .on('change', ({ value }) => { P.terrainColors.sandColor = tpToRgb01(value); updColors(); });
  landColFolder.addBinding(colorState, 'cliffColor', { label: 'Cliff', view: 'color' })
    .on('change', ({ value }) => { P.terrainColors.cliffColor = tpToRgb01(value); updColors(); });
  landColFolder.addBinding(colorState, 'dirtColor',  { label: 'Dirt',  view: 'color' })
    .on('change', ({ value }) => { P.terrainColors.dirtColor  = tpToRgb01(value); updColors(); });

  const vegColFolder = colorsPage.addFolder({ title: 'Vegetation', expanded: true });
  vegColFolder.addBinding(colorState, 'grassColor1', { label: 'Grass Low',  view: 'color' })
    .on('change', ({ value }) => { P.terrainColors.grassColor1 = tpToRgb01(value); updColors(); });
  vegColFolder.addBinding(colorState, 'grassColor2', { label: 'Grass High', view: 'color' })
    .on('change', ({ value }) => { P.terrainColors.grassColor2 = tpToRgb01(value); updColors(); });
  vegColFolder.addBinding(colorState, 'treeColor',   { label: 'Trees',      view: 'color' })
    .on('change', ({ value }) => { P.terrainColors.treeColor   = tpToRgb01(value); updColors(); });

  const waterColFolder = colorsPage.addFolder({ title: 'Water', expanded: true });
  waterColFolder.addBinding(colorState, 'waterDeepColor',  { label: 'Deep',  view: 'color' })
    .on('change', ({ value }) => { P.terrainColors.waterDeepColor  = tpToRgb01(value); updColors(); });
  waterColFolder.addBinding(colorState, 'waterShoreColor', { label: 'Shore', view: 'color' })
    .on('change', ({ value }) => { P.terrainColors.waterShoreColor = tpToRgb01(value); updColors(); });
  const waterNormalParams = {
    freq:      P.terrainColors.waterNormalFreq,
    strength:  P.terrainColors.waterNormalStrength,
    roughness: P.terrainColors.waterRoughness,
  };
  waterColFolder.addBinding(waterNormalParams, 'freq',      { label: 'Wave Freq',     min: 0.1, max: 200.0, step: 0.5  })
    .on('change', ({ value }) => { P.terrainColors.waterNormalFreq     = value; updBump(); });
  waterColFolder.addBinding(waterNormalParams, 'strength',  { label: 'Wave Strength', min: 0.0, max: 2.0,   step: 0.01 })
    .on('change', ({ value }) => { P.terrainColors.waterNormalStrength = value; updColors(); });
  waterColFolder.addBinding(waterNormalParams, 'roughness', { label: 'Roughness',     min: 0.0, max: 1.0,   step: 0.01 })
    .on('change', ({ value }) => { P.terrainColors.waterRoughness      = value; updColors(); });

  // ── Tab: Lighting ─────────────────────────────────────────────────────────

  const lightingParams = {
    sunAzimuth:       45,
    sunElevation:     45,
    sunIntensity:     sunLight.intensity,
    sunColor:         { r: sunLight.color.r * 255, g: sunLight.color.g * 255, b: sunLight.color.b * 255 },
    ambientIntensity: ambientLight.intensity,
    ambientColor:     { r: ambientLight.color.r * 255, g: ambientLight.color.g * 255, b: ambientLight.color.b * 255 },
    roughness:        terrain.roughness,
  };

  const updateSunDir = () => {
    const az = lightingParams.sunAzimuth  * Math.PI / 180;
    const el = lightingParams.sunElevation * Math.PI / 180;
    sunLight.position.set(
      Math.cos(el) * Math.sin(az),
      Math.sin(el),
      Math.cos(el) * Math.cos(az),
    );
  };

  lightingPage.addBinding(lightingParams, 'sunAzimuth',   { label: 'Sun Azimuth',   min: 0, max: 360, step: 1 }).on('change', updateSunDir);
  lightingPage.addBinding(lightingParams, 'sunElevation', { label: 'Sun Elevation', min: 0, max: 90,  step: 1 }).on('change', updateSunDir);
  lightingPage.addBinding(lightingParams, 'sunColor',     { label: 'Sun Color'    })
    .on('change', ({ value }) => {
      sunLight.color.setRGB(value.r / 255, value.g / 255, value.b / 255);
    });
  lightingPage.addBinding(lightingParams, 'sunIntensity', { label: 'Sun Intensity', min: 0, max: 8, step: 0.1 })
    .on('change', ({ value }) => { sunLight.intensity = value; });
  lightingPage.addBinding(lightingParams, 'ambientColor', { label: 'Ambient Color' })
    .on('change', ({ value }) => ambientLight.color.setRGB(value.r / 255, value.g / 255, value.b / 255));
  lightingPage.addBinding(lightingParams, 'ambientIntensity', { label: 'Ambient Intensity', min: 0, max: 5, step: 0.05 })
    .on('change', ({ value }) => { ambientLight.intensity = value; });
  lightingPage.addBinding(lightingParams, 'roughness', { label: 'Roughness', min: 0, max: 1, step: 0.01 })
    .on('change', ({ value }) => terrain.setRoughness(value));

  refreshScale();

  // ── Handle ────────────────────────────────────────────────────────────────
  return {
    show:    () => { pane.element.style.display = 'block'; },
    hide:    () => { pane.element.style.display = 'none'; },
    destroy: () => { pane.dispose(); pane.element.remove(); },
  };
}
