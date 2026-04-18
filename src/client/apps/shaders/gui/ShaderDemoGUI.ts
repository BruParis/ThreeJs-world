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
      { title: 'Noise'    },
      { title: 'Erosion'  },
      { title: 'Lighting' },
    ],
  });
  const [viewPage, terrainPage, noisePage, erosionPage, lightingPage] = tab.pages;

  // ── Shared callbacks ──────────────────────────────────────────────────────

  const updDisplay = () => terrain.updateUniforms();

  const updOverlay = () => overlay.updateUniforms({
    noiseParams:           terrain.noiseParams,
    noiseType:             terrain.noiseType,
    layerMix:              terrain.layerMix,
    patchHalfSize:         terrain.patchSize / 2,
    erosionEnabled:        terrain.erosionEnabled,
    erosionOctaves:        terrain.erosionOctaves,
    erosionTiles:          terrain.erosionTiles,
    erosionStrength:       terrain.erosionStrength,
    erosionSlopeStrength:  terrain.erosionSlopeStrength,
    erosionBranchStrength: terrain.erosionBranchStrength,
    erosionGain:           terrain.erosionGain,
    erosionLacunarity:     terrain.erosionLacunarity,
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
    size:        terrain.patchSize,
    numPatches:  terrain.numPatches,
    subdivision: terrain.subdivisions,
    amplitude:   terrain.amplitude,
  };

  terrainPage.addBinding(terrainParams, 'size', { label: 'Size', min: 0.5, max: 8.0, step: 0.5 })
    .on('change', ({ value }) => { terrain.patchSize = value; updGeometry(); });
  terrainPage.addBinding(terrainParams, 'numPatches', { label: 'Patches', options: PATCH_OPTIONS })
    .on('change', ({ value }) => { terrain.numPatches = value; updGeometry(); });
  terrainPage.addBinding(terrainParams, 'subdivision', { label: 'Subdivision', options: SUBDIVISION_OPTIONS })
    .on('change', ({ value }) => { terrain.subdivisions = Number(value); updGeometry(); });
  terrainPage.addBinding(terrainParams, 'amplitude', { label: 'Amplitude', min: 0.0, max: 2.0, step: 0.05 })
    .on('change', ({ value }) => { terrain.amplitude = value; updDisplay(); });

  // ── Tab: Noise ────────────────────────────────────────────────────────────

  const noiseTypeParams = { type: 2 }; // default: heightmap
  noisePage.addBinding(noiseTypeParams, 'type', {
    label: 'Type',
    options: { Simplex: 0, Perlin: 1, Heightmap: 2 },
  }).on('change', ({ value }) => { terrain.noiseType = Number(value); updElevation(); });

  noisePage.addBinding(terrain.noiseParams, 'scale',       { label: 'Scale',       min: 0.5, max: 10.0, step: 0.1  }).on('change', updNoise);
  noisePage.addBinding(terrain.noiseParams, 'octaves',     { label: 'Octaves',     min: 1,   max: 8,    step: 1    }).on('change', updNoise);
  noisePage.addBinding(terrain.noiseParams, 'persistence', { label: 'Persistence', min: 0.1, max: 1.0,  step: 0.05 }).on('change', updNoise);
  noisePage.addBinding(terrain.noiseParams, 'lacunarity',  { label: 'Lacunarity',  min: 1.0, max: 4.0,  step: 0.1  }).on('change', updNoise);

  const layerParams = { mix: terrain.layerMix };
  noisePage.addBinding(layerParams, 'mix', { label: 'Layer Mix', min: 0.0, max: 1.0, step: 0.01 })
    .on('change', ({ value }) => { terrain.layerMix = value; updElevation(); });

  const suppFolder = noisePage.addFolder({ title: 'Supplemental', expanded: false });
  const suppParams = { enabled: terrain.suppNoiseEnabled, strength: terrain.suppNoiseStrength };
  suppFolder.addBinding(suppParams, 'enabled', { label: 'Enabled' })
    .on('change', ({ value }) => terrain.setSuppNoiseEnabled(value));
  suppFolder.addBinding(suppParams, 'strength', { label: 'Strength', min: 0.0, max: 2.0, step: 0.05 })
    .on('change', ({ value }) => { terrain.suppNoiseStrength = value; terrain.syncSuppNoiseUniforms(); });

  // ── Tab: Erosion ──────────────────────────────────────────────────────────

  const erosionParams = {
    enabled:        terrain.erosionEnabled,
    strength:       terrain.erosionStrength,
    octaves:        terrain.erosionOctaves,
    tiles:          terrain.erosionTiles,
    slopeStrength:  terrain.erosionSlopeStrength,
    branchStrength: terrain.erosionBranchStrength,
    gain:           terrain.erosionGain,
    lacunarity:     terrain.erosionLacunarity,
  };

  erosionPage.addBinding(erosionParams, 'enabled',       { label: 'Enabled' })
    .on('change', ({ value }) => { terrain.erosionEnabled = value; updElevation(); });
  erosionPage.addBinding(erosionParams, 'strength',      { label: 'Strength',      min: 0.0, max: 1.0, step: 0.01 })
    .on('change', ({ value }) => { terrain.erosionStrength = value; updElevation(); });
  erosionPage.addBinding(erosionParams, 'octaves',       { label: 'Octaves',       min: 1,   max: 10,  step: 1    })
    .on('change', ({ value }) => { terrain.erosionOctaves = value; updElevation(); });
  erosionPage.addBinding(erosionParams, 'tiles',         { label: 'Tiles',         min: 0.5, max: 10.0, step: 0.5 })
    .on('change', ({ value }) => { terrain.erosionTiles = value; updElevation(); });
  erosionPage.addBinding(erosionParams, 'slopeStrength', { label: 'Slope',         min: 0.0, max: 3.0, step: 0.05 })
    .on('change', ({ value }) => { terrain.erosionSlopeStrength = value; updElevation(); });
  erosionPage.addBinding(erosionParams, 'branchStrength',{ label: 'Branch',        min: 0.0, max: 2.0, step: 0.05 })
    .on('change', ({ value }) => { terrain.erosionBranchStrength = value; updElevation(); });
  erosionPage.addBinding(erosionParams, 'gain',          { label: 'Gain',          min: 0.1, max: 1.0, step: 0.05 })
    .on('change', ({ value }) => { terrain.erosionGain = value; updElevation(); });
  erosionPage.addBinding(erosionParams, 'lacunarity',    { label: 'Lacunarity',    min: 1.0, max: 4.0, step: 0.1  })
    .on('change', ({ value }) => { terrain.erosionLacunarity = value; updElevation(); });

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
  lightingPage.addBinding(lightingParams, 'ambientIntensity', { label: 'Ambient Intensity', min: 0, max: 2, step: 0.05 })
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
