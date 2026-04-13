import { GUI } from 'dat.gui';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FlyCam } from '@core/FlyCam';
import { TerrainMesh } from '../terrain/TerrainMesh';
import { LayerOverlay } from '../terrain/LayerOverlay';
import { SUBDIVISION_OPTIONS, PATCH_OPTIONS } from '../terrain/TerrainConstants';

export function buildShaderDemoGUI(
  contentArea: HTMLElement,
  terrain: TerrainMesh,
  overlay: LayerOverlay,
  controls: OrbitControls,
  flyCam: FlyCam,
): GUI {
  const gui = new GUI({ autoPlace: false });
  contentArea.appendChild(gui.domElement);
  gui.domElement.style.position = 'absolute';
  gui.domElement.style.top      = '0';
  gui.domElement.style.right    = '0';
  gui.domElement.style.display  = 'none';

  // Pure display — no elevation recompute needed.
  const updDisplay = () => terrain.updateUniforms();

  // Noise/erosion changed — must recompute elevation.
  const updElevation = () => terrain.recomputeElevation();

  // Noise changed — recompute elevation AND refresh the layer overlay panels.
  const updNoise = () => {
    terrain.recomputeElevation();
    overlay.updateUniforms(terrain.noiseParams);
  };

  // Geometry changed — full rebuild (elevation + mesh).
  const updGeometry = () => terrain.rebuild();

  // ── Camera ────────────────────────────────────────────────────────────────
  const camGui    = gui.addFolder('Camera');
  const camParams = { flyCam: false };
  camGui.add(camParams, 'flyCam').name('Fly Camera').onChange((enabled: boolean) => {
    if (enabled) { controls.enabled = false; flyCam.enable(); }
    else         { flyCam.disable(); controls.enabled = true; }
  });
  camGui.open();

  // ── Terrain ───────────────────────────────────────────────────────────────
  const terrainGui    = gui.addFolder('Terrain');
  const terrainParams = {
    size:        terrain.patchSize,
    numPatches:  terrain.numPatches,
    subdivision: terrain.subdivisions,
    amplitude:   terrain.amplitude,
  };

  terrainGui.add(terrainParams, 'size', 0.5, 8.0).step(0.5).name('Size')
    .onChange((v: number) => { terrain.patchSize = v; updGeometry(); });

  terrainGui.add(terrainParams, 'numPatches', PATCH_OPTIONS).name('Patches')
    .onChange((v: number) => { terrain.numPatches = v; updGeometry(); });

  terrainGui.add(terrainParams, 'subdivision', SUBDIVISION_OPTIONS).name('Subdivision')
    .onChange((v: number) => { terrain.subdivisions = Number(v); updGeometry(); });

  terrainGui.add(terrainParams, 'amplitude', 0.0, 2.0).step(0.05).name('Amplitude')
    .onChange((v: number) => { terrain.amplitude = v; updDisplay(); });

  terrainGui.open();

  // ── Noise ─────────────────────────────────────────────────────────────────
  const noiseGui        = gui.addFolder('Noise');
  const noiseTypeParams = { type: 'simplex' };

  noiseGui.add(noiseTypeParams, 'type', { Simplex: 'simplex', Perlin: 'perlin', Heightmap: 'heightmap' }).name('Type')
    .onChange((v: string) => { terrain.noiseType = v === 'perlin' ? 1 : v === 'heightmap' ? 2 : 0; updElevation(); });

  noiseGui.add(terrain.noiseParams, 'scale',       0.5, 10.0).step(0.1 ).name('Scale'      ).onChange(updNoise);
  noiseGui.add(terrain.noiseParams, 'octaves',       1,    8 ).step(1   ).name('Octaves'    ).onChange(updNoise);
  noiseGui.add(terrain.noiseParams, 'persistence', 0.1,  1.0).step(0.05).name('Persistence').onChange(updNoise);
  noiseGui.add(terrain.noiseParams, 'lacunarity',  1.0,  4.0).step(0.1 ).name('Lacunarity' ).onChange(updNoise);

  const layerParams = { mix: terrain.layerMix };
  noiseGui.add(layerParams, 'mix', 0.0, 1.0).step(0.01).name('Layer Mix (Grad → Noise)')
    .onChange((v: number) => { terrain.layerMix = v; updElevation(); });

  noiseGui.open();

  // ── Display ───────────────────────────────────────────────────────────────
  const displayGui    = gui.addFolder('Display');
  const displayParams = {
    wireframe:  terrain.wireframe,
    showLayers: overlay.showLayers,
  };

  displayGui.add(displayParams, 'wireframe').name('Wireframe')
    .onChange((v: boolean) => { terrain.wireframe = v; updDisplay(); });

  displayGui.add(displayParams, 'showLayers').name('Show Layer Panels')
    .onChange((v: boolean) => overlay.setVisible(v));

  displayGui.open();

  // ── Erosion ───────────────────────────────────────────────────────────────
  const erosionGui    = gui.addFolder('Erosion');
  const erosionParams = {
    enabled:        terrain.erosionEnabled,
    octaves:        terrain.erosionOctaves,
    tiles:          terrain.erosionTiles,
    strength:       terrain.erosionStrength,
    slopeStrength:  terrain.erosionSlopeStrength,
    branchStrength: terrain.erosionBranchStrength,
    gain:           terrain.erosionGain,
    lacunarity:     terrain.erosionLacunarity,
  };

  erosionGui.add(erosionParams, 'enabled').name('Enabled')
    .onChange((v: boolean) => { terrain.erosionEnabled = v; updElevation(); });
  erosionGui.add(erosionParams, 'strength',       0.0,  1.0).step(0.01).name('Strength')
    .onChange((v: number) => { terrain.erosionStrength = v; updElevation(); });
  erosionGui.add(erosionParams, 'octaves',          1,   10).step(1   ).name('Octaves')
    .onChange((v: number) => { terrain.erosionOctaves = v; updElevation(); });
  erosionGui.add(erosionParams, 'tiles',          0.5, 10.0).step(0.5 ).name('Tiles')
    .onChange((v: number) => { terrain.erosionTiles = v; updElevation(); });
  erosionGui.add(erosionParams, 'slopeStrength',  0.0,  3.0).step(0.05).name('Slope Strength')
    .onChange((v: number) => { terrain.erosionSlopeStrength = v; updElevation(); });
  erosionGui.add(erosionParams, 'branchStrength', 0.0,  2.0).step(0.05).name('Branch Strength')
    .onChange((v: number) => { terrain.erosionBranchStrength = v; updElevation(); });
  erosionGui.add(erosionParams, 'gain',           0.1,  1.0).step(0.05).name('Gain')
    .onChange((v: number) => { terrain.erosionGain = v; updElevation(); });
  erosionGui.add(erosionParams, 'lacunarity',     1.0,  4.0).step(0.1 ).name('Lacunarity')
    .onChange((v: number) => { terrain.erosionLacunarity = v; updElevation(); });

  return gui;
}
