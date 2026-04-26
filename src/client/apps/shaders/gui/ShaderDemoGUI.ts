import { Pane } from 'tweakpane';
import { DirectionalLight, AmbientLight } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FlyCam } from '@core/FlyCam';
import { TerrainMesh } from '../terrain/TerrainMesh';
import { LayerOverlay } from '../terrain/LayerOverlay';
import { SUBDIVISION_OPTIONS, PATCH_OPTIONS } from '../terrain/TerrainConstants';

export interface ShaderDemoGUIHandle {
  show(): void;
  hide(): void;
  destroy(): void;
}

export function buildShaderDemoGUI(
  contentArea: HTMLElement,
  terrain: TerrainMesh,
  overlay: LayerOverlay,
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
      { title: 'Terrain'  },
      { title: 'Elevation' },
      { title: 'Erosion'  },
      { title: 'Trees'    },
      { title: 'Lighting' },
    ],
  });
  const [viewPage, terrainPage, elevationPage, erosionPage, treesPage, lightingPage] = tab.pages;

  // ── Shared callbacks ──────────────────────────────────────────────────────

  const updDisplay = () => terrain.updateUniforms();

  const updOverlay = () => overlay.updateUniforms({
    noiseParams:            terrain.noiseParams,
    fractalNoiseParams:     terrain.fractalNoiseParams,
    noiseType:              terrain.noiseType,
    gaussSigma:             terrain.gaussianParams.sigma,
    gaussAmplitude:         terrain.gaussianParams.amplitude,
    layerMix:               terrain.layerMix,
    patchHalfSize:          terrain.patchSize / 2,
    elevationOffset:        terrain.elevationOffset,
    erosionEnabled:         terrain.erosionEnabled,
    erosionOctaves:         terrain.erosionOctaves,
    erosionScale:           terrain.erosionScale,
    erosionStrength:        terrain.erosionStrength,
    erosionGullyWeight:     terrain.erosionGullyWeight,
    erosionDetail:          terrain.erosionDetail,
    erosionGain:            terrain.erosionGain,
    erosionLacunarity:      terrain.erosionLacunarity,
    erosionCellScale:       terrain.erosionCellScale,
    erosionNormalization:   terrain.erosionNormalization,
    erosionRidgeRounding:   terrain.erosionRidgeRounding,
    erosionCreaseRounding:  terrain.erosionCreaseRounding,
  });

  function debounce(fn: () => void, ms: number): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(fn, ms);
    };
  }

  const _recomputeAndSync = () => { terrain.recomputeElevation(); updOverlay(); };
  const updElevation = debounce(_recomputeAndSync, 150);
  const updNoise     = debounce(_recomputeAndSync, 150);
  const updGeometry  = () => { terrain.rebuild(); updOverlay(); };

  // ── Tab: View ─────────────────────────────────────────────────────────────

  const camParams = { flyCam: false };
  viewPage.addBinding(camParams, 'flyCam', { label: 'Fly Camera' })
    .on('change', ({ value }) => {
      if (value) { controls.enabled = false; flyCam.enable(); }
      else       { flyCam.disable(); controls.enabled = true; }
    });

  const displayParams = { wireframe: terrain.wireframe, showLayers: overlay.showLayers };
  viewPage.addBinding(displayParams, 'wireframe', { label: 'Wireframe' })
    .on('change', ({ value }) => { terrain.wireframe = value; updDisplay(); });
  viewPage.addBinding(displayParams, 'showLayers', { label: 'Show Layer Panels' })
    .on('change', ({ value }) => overlay.setVisible(value));

  // ── Tab: Terrain ──────────────────────────────────────────────────────────

  const terrainParams = {
    size:            terrain.patchSize,
    numPatches:      terrain.numPatches,
    subdivision:     terrain.subdivisions,
    amplitude:       terrain.amplitude,
    elevationOffset: terrain.elevationOffset,
  };

  terrainPage.addBinding(terrainParams, 'size', { label: 'Size', min: 0.5, max: 8.0, step: 0.5 })
    .on('change', ({ value }) => { terrain.patchSize = value; updGeometry(); });
  terrainPage.addBinding(terrainParams, 'numPatches', { label: 'Patches', options: PATCH_OPTIONS })
    .on('change', ({ value }) => { terrain.numPatches = value; updGeometry(); });
  terrainPage.addBinding(terrainParams, 'subdivision', { label: 'Subdivision', options: SUBDIVISION_OPTIONS })
    .on('change', ({ value }) => { terrain.subdivisions = Number(value); updGeometry(); });
  terrainPage.addBinding(terrainParams, 'amplitude', { label: 'Amplitude', min: 0.0, max: 2.0, step: 0.05 })
    .on('change', ({ value }) => { terrain.amplitude = value; updDisplay(); });
  terrainPage.addBinding(terrainParams, 'elevationOffset', { label: 'Elev. Offset', min: -0.5, max: 0.5, step: 0.01 })
    .on('change', ({ value }) => { terrain.elevationOffset = value; updDisplay(); updOverlay(); });

  // ── Tab: Elevation ───────────────────────────────────────────────────────

  const isFractal  = () => terrain.noiseType === 4;
  const isGaussian = () => terrain.noiseType === 3;
  const isStdNoise = () => terrain.noiseType !== 3 && terrain.noiseType !== 4;

  const noiseTypeParams = { type: terrain.noiseType };
  elevationPage.addBinding(noiseTypeParams, 'type', {
    label: 'Type',
    options: { Simplex: 0, Perlin: 1, Heightmap: 2, Gaussian: 3, FractalNoise: 4 },
  }).on('change', ({ value }) => {
    terrain.noiseType = Number(value);
    noiseFolder.hidden        = !isStdNoise();
    gaussFolder.hidden        = !isGaussian();
    fractalNoiseFolder.hidden = !isFractal();
    updElevation();
  });

  const noiseFolder = elevationPage.addFolder({ title: 'Noise', expanded: true });
  noiseFolder.addBinding(terrain.noiseParams, 'scale',       { label: 'Scale',       min: 0.5, max: 10.0, step: 0.1  }).on('change', updNoise);
  noiseFolder.addBinding(terrain.noiseParams, 'octaves',     { label: 'Octaves',     min: 1,   max: 8,    step: 1    }).on('change', updNoise);
  noiseFolder.addBinding(terrain.noiseParams, 'persistence', { label: 'Persistence', min: 0.1, max: 1.0,  step: 0.05 }).on('change', updNoise);
  noiseFolder.addBinding(terrain.noiseParams, 'lacunarity',  { label: 'Lacunarity',  min: 1.0, max: 4.0,  step: 0.1  }).on('change', updNoise);

  const gaussFolder = elevationPage.addFolder({ title: 'Gaussian', expanded: true });
  const gaussParams  = { sigma: terrain.gaussianParams.sigma, amplitude: terrain.gaussianParams.amplitude };
  gaussFolder.addBinding(gaussParams, 'sigma',     { label: 'Sigma',     min: 0.05, max: 2.0, step: 0.01 })
    .on('change', ({ value }) => { terrain.gaussianParams.sigma = value; updElevation(); });
  gaussFolder.addBinding(gaussParams, 'amplitude', { label: 'Amplitude', min: 0.0,  max: 1.0, step: 0.01 })
    .on('change', ({ value }) => { terrain.gaussianParams.amplitude = value; updElevation(); });

  const fractalNoiseFolder = elevationPage.addFolder({ title: 'FractalNoise', expanded: true });
  fractalNoiseFolder.addBinding(terrain.fractalNoiseParams, 'freq',       { label: 'Frequency',  min: 0.1, max: 10.0, step: 0.1  }).on('change', updElevation);
  fractalNoiseFolder.addBinding(terrain.fractalNoiseParams, 'octaves',    { label: 'Octaves',    min: 1,   max: 8,    step: 1    }).on('change', updElevation);
  fractalNoiseFolder.addBinding(terrain.fractalNoiseParams, 'lacunarity', { label: 'Lacunarity', min: 1.0, max: 4.0,  step: 0.1  }).on('change', updElevation);
  fractalNoiseFolder.addBinding(terrain.fractalNoiseParams, 'gain',       { label: 'Gain',       min: 0.01, max: 1.0, step: 0.01 }).on('change', updElevation);
  fractalNoiseFolder.addBinding(terrain.fractalNoiseParams, 'amp',        { label: 'Amp',        min: 0.001, max: 0.6, step: 0.01 }).on('change', updElevation);

  // Initial visibility
  noiseFolder.hidden        = !isStdNoise();
  gaussFolder.hidden        = !isGaussian();
  fractalNoiseFolder.hidden = !isFractal();

  const layerParams = { mix: terrain.layerMix };
  elevationPage.addBinding(layerParams, 'mix', { label: 'Layer Mix', min: 0.0, max: 1.0, step: 0.01 })
    .on('change', ({ value }) => { terrain.layerMix = value; updElevation(); });

  const suppFolder = elevationPage.addFolder({ title: 'Supplemental', expanded: false });
  const suppParams = { enabled: terrain.suppNoiseEnabled, strength: terrain.suppNoiseStrength };
  suppFolder.addBinding(suppParams, 'enabled', { label: 'Enabled' })
    .on('change', ({ value }) => terrain.setSuppNoiseEnabled(value));
  suppFolder.addBinding(suppParams, 'strength', { label: 'Strength', min: 0.0, max: 2.0, step: 0.05 })
    .on('change', ({ value }) => { terrain.suppNoiseStrength = value; terrain.syncSuppNoiseUniforms(); });

  // ── Tab: Erosion ──────────────────────────────────────────────────────────

  const erosionParams = {
    enabled:         terrain.erosionEnabled,
    scale:           terrain.erosionScale,
    strength:        terrain.erosionStrength,
    gullyWeight:     terrain.erosionGullyWeight,
    detail:          terrain.erosionDetail,
    octaves:         terrain.erosionOctaves,
    lacunarity:      terrain.erosionLacunarity,
    gain:            terrain.erosionGain,
    cellScale:       terrain.erosionCellScale,
    normalization:   terrain.erosionNormalization,
    ridgeRounding:   terrain.erosionRidgeRounding,
    creaseRounding:  terrain.erosionCreaseRounding,
  };

  erosionPage.addBinding(erosionParams, 'enabled',        { label: 'Enabled' })
    .on('change', ({ value }) => { terrain.erosionEnabled = value; updElevation(); });
  erosionPage.addBinding(erosionParams, 'scale',          { label: 'Scale',          min: 0.02, max: 0.5,  step: 0.01 })
    .on('change', ({ value }) => { terrain.erosionScale = value; updElevation(); });
  erosionPage.addBinding(erosionParams, 'strength',       { label: 'Strength',       min: 0.0,  max: 0.5,  step: 0.01 })
    .on('change', ({ value }) => { terrain.erosionStrength = value; updElevation(); });
  erosionPage.addBinding(erosionParams, 'gullyWeight',    { label: 'Gully Weight',   min: 0.0,  max: 1.0,  step: 0.01 })
    .on('change', ({ value }) => { terrain.erosionGullyWeight = value; updElevation(); });
  erosionPage.addBinding(erosionParams, 'detail',         { label: 'Detail',         min: 0.3,  max: 3.0,  step: 0.05 })
    .on('change', ({ value }) => { terrain.erosionDetail = value; updElevation(); });
  erosionPage.addBinding(erosionParams, 'octaves',        { label: 'Octaves',        min: 1,    max: 8,    step: 1    })
    .on('change', ({ value }) => { terrain.erosionOctaves = value; updElevation(); });
  erosionPage.addBinding(erosionParams, 'lacunarity',     { label: 'Lacunarity',     min: 1.0,  max: 4.0,  step: 0.1  })
    .on('change', ({ value }) => { terrain.erosionLacunarity = value; updElevation(); });
  erosionPage.addBinding(erosionParams, 'gain',           { label: 'Gain',           min: 0.1,  max: 1.0,  step: 0.05 })
    .on('change', ({ value }) => { terrain.erosionGain = value; updElevation(); });

  const erosionAdvFolder = erosionPage.addFolder({ title: 'Advanced', expanded: false });
  erosionAdvFolder.addBinding(erosionParams, 'cellScale',      { label: 'Cell Scale',      min: 0.2, max: 2.0, step: 0.05 })
    .on('change', ({ value }) => { terrain.erosionCellScale = value; updElevation(); });
  erosionAdvFolder.addBinding(erosionParams, 'normalization',  { label: 'Normalization',   min: 0.0, max: 1.0, step: 0.05 })
    .on('change', ({ value }) => { terrain.erosionNormalization = value; updElevation(); });
  erosionAdvFolder.addBinding(erosionParams, 'ridgeRounding',  { label: 'Ridge Rounding',  min: 0.0, max: 1.0, step: 0.05 })
    .on('change', ({ value }) => { terrain.erosionRidgeRounding = value; updElevation(); });
  erosionAdvFolder.addBinding(erosionParams, 'creaseRounding', { label: 'Crease Rounding', min: 0.0, max: 1.0, step: 0.05 })
    .on('change', ({ value }) => { terrain.erosionCreaseRounding = value; updElevation(); });

  // ── Tab: Trees ────────────────────────────────────────────────────────────

  const treeParams = {
    enabled:   terrain.treeEnabled,
    elevMax:   terrain.treeElevMax,
    elevMin:   terrain.treeElevMin,
    slopeMin:  terrain.treeSlopeMin,
    ridgeMin:  terrain.treeRidgeMin,
    noiseFreq: terrain.treeNoiseFreq,
    noisePow:  terrain.treeNoisePow,
    density:   terrain.treeDensity,
  };

  treesPage.addBinding(treeParams, 'enabled',   { label: 'Enabled' })
    .on('change', ({ value }) => { terrain.treeEnabled = value; terrain.syncTreeUniforms(); });
  treesPage.addBinding(treeParams, 'elevMax',   { label: 'Elev. Max',    min: 0.3,  max: 0.9,    step: 0.005 })
    .on('change', ({ value }) => { terrain.treeElevMax = value; terrain.syncTreeUniforms(); });
  treesPage.addBinding(treeParams, 'elevMin',   { label: 'Elev. Min',    min: 0.3,  max: 0.9,    step: 0.005 })
    .on('change', ({ value }) => { terrain.treeElevMin = value; terrain.syncTreeUniforms(); });
  treesPage.addBinding(treeParams, 'slopeMin',  { label: 'Slope Min',    min: 0.5,  max: 1.0,    step: 0.01  })
    .on('change', ({ value }) => { terrain.treeSlopeMin = value; terrain.syncTreeUniforms(); });
  treesPage.addBinding(treeParams, 'ridgeMin',  { label: 'Ridge Min',    min: -3.0, max: 0.0,    step: 0.05  })
    .on('change', ({ value }) => { terrain.treeRidgeMin = value; terrain.syncTreeUniforms(); });
  treesPage.addBinding(treeParams, 'noiseFreq', { label: 'Noise Freq',   min: 10,   max: 1000,   step: 10    })
    .on('change', ({ value }) => { terrain.treeNoiseFreq = value; terrain.syncTreeUniforms(); });
  treesPage.addBinding(treeParams, 'noisePow',  { label: 'Noise Power',  min: 0.5,  max: 8.0,    step: 0.1   })
    .on('change', ({ value }) => { terrain.treeNoisePow = value; terrain.syncTreeUniforms(); });
  treesPage.addBinding(treeParams, 'density',   { label: 'Density',      min: 0.1,  max: 5.0,    step: 0.1   })
    .on('change', ({ value }) => { terrain.treeDensity = value; terrain.syncTreeUniforms(); });

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
    .on('change', ({ value }) => sunLight.color.setRGB(value.r / 255, value.g / 255, value.b / 255));
  lightingPage.addBinding(lightingParams, 'sunIntensity', { label: 'Sun Intensity', min: 0, max: 8, step: 0.1 })
    .on('change', ({ value }) => { sunLight.intensity = value; });
  lightingPage.addBinding(lightingParams, 'ambientColor', { label: 'Ambient Color' })
    .on('change', ({ value }) => ambientLight.color.setRGB(value.r / 255, value.g / 255, value.b / 255));
  lightingPage.addBinding(lightingParams, 'ambientIntensity', { label: 'Ambient Intensity', min: 0, max: 5, step: 0.05 })
    .on('change', ({ value }) => { ambientLight.intensity = value; });
  lightingPage.addBinding(lightingParams, 'roughness', { label: 'Roughness', min: 0, max: 1, step: 0.01 })
    .on('change', ({ value }) => terrain.setRoughness(value));

  // ── Handle ────────────────────────────────────────────────────────────────
  return {
    show:    () => { pane.element.style.display = 'block'; },
    hide:    () => { pane.element.style.display = 'none'; },
    destroy: () => { pane.dispose(); pane.element.remove(); },
  };
}
