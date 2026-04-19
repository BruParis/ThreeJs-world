/**
 * Separate Tweakpane for per-patch terrain shader controls.
 *
 * Positioned on the left side of the screen so it is visually distinct from
 * the main GUIManager pane (which sits on the right and holds global/tectonic
 * controls).
 *
 * Tab layout mirrors ShaderDemoGUI:
 *   Terrain  — elevation amplitude and offset
 *   Noise    — simplex FBM parameters (scale, octaves, persistence, lacunarity)
 *   Erosion  — erosion toggle + all tuning knobs
 */

import { Pane } from 'tweakpane';
import { TileShaderPatchOperation } from '../lod/TileShaderPatchOperation';
import { LODTileRenderer } from '../lod/LODTileRenderer';
import { apparentElevKmToReal } from '../../../shared/world/World';
import {
  DEFAULT_EROSION_OCTAVES,
  DEFAULT_EROSION_SCALE,
  DEFAULT_EROSION_STRENGTH,
  DEFAULT_EROSION_GULLY_WEIGHT,
  DEFAULT_EROSION_DETAIL,
  DEFAULT_EROSION_LACUNARITY,
  DEFAULT_EROSION_GAIN,
  DEFAULT_EROSION_CELL_SCALE,
  DEFAULT_EROSION_NORMALIZATION,
  DEFAULT_EROSION_RIDGE_ROUNDING,
  DEFAULT_EROSION_CREASE_ROUNDING,
} from '@core/shaders/erosionGLSL';

export class TerrainGUIManager {
  private pane: Pane;

  constructor(
    patchOperation: TileShaderPatchOperation,
    lodRenderer: LODTileRenderer,
    contentArea: HTMLElement,
  ) {
    this.pane = new Pane({ title: 'Terrain Shader' });
    this.pane.element.style.position = 'absolute';
    this.pane.element.style.top      = '0';
    this.pane.element.style.left     = '0';
    this.pane.element.style.width    = '280px';
    contentArea.appendChild(this.pane.element);

    const invalidate = () => lodRenderer.invalidate();

    const tab = this.pane.addTab({
      pages: [
        { title: 'Terrain'  },
        { title: 'Noise'    },
        { title: 'Erosion'  },
      ],
    });
    const [terrainPage, noisePage, erosionPage] = tab.pages;

    // ── Tab: Terrain ──────────────────────────────────────────────────────────

    const elevParams = {
      apparentKm: patchOperation.getElevationAmplitudeApparentKm(),
      realKm:     apparentElevKmToReal(patchOperation.getElevationAmplitudeApparentKm()),
    };

    const elevRealBinding = terrainPage.addBinding(elevParams, 'realKm', {
      label: 'Amplitude real (km)', readonly: true,
    });
    terrainPage.addBinding(elevParams, 'apparentKm', {
      label: 'Amplitude (km)', min: 10, max: 500, step: 5,
    }).on('change', ({ value }) => {
      elevParams.realKm = apparentElevKmToReal(value);
      elevRealBinding.refresh();
      patchOperation.setElevationAmplitudeApparentKm(value);
      invalidate();
    });

    const elevOffsetParams = { offset: patchOperation.getElevOffset() };
    terrainPage.addBinding(elevOffsetParams, 'offset', {
      label: 'Elev. Offset', min: -0.5, max: 0.5, step: 0.01,
    }).on('change', ({ value }) => {
      patchOperation.setElevOffset(value);
      invalidate();
    });

    // ── Tab: Noise ────────────────────────────────────────────────────────────

    const noiseParams = { scale: 10.0, octaves: 4, persistence: 0.5, lacunarity: 2.0 };

    // Sync initial value so the shader starts at scale=10
    patchOperation.setTerrainNoiseParams(
      noiseParams.scale, noiseParams.octaves,
      noiseParams.persistence, noiseParams.lacunarity,
    );

    const syncNoise = () => {
      patchOperation.setTerrainNoiseParams(
        noiseParams.scale, noiseParams.octaves,
        noiseParams.persistence, noiseParams.lacunarity,
      );
      invalidate();
    };

    noisePage.addBinding(noiseParams, 'scale',       { label: 'Scale',       min: 10,  max: 100, step: 1    }).on('change', syncNoise);
    noisePage.addBinding(noiseParams, 'octaves',     { label: 'Octaves',     min: 1,   max: 8,   step: 1    }).on('change', syncNoise);
    noisePage.addBinding(noiseParams, 'persistence', { label: 'Persistence', min: 0.1, max: 1.0, step: 0.05 }).on('change', syncNoise);
    noisePage.addBinding(noiseParams, 'lacunarity',  { label: 'Lacunarity',  min: 1.0, max: 4.0, step: 0.1  }).on('change', syncNoise);

    // ── Tab: Erosion ──────────────────────────────────────────────────────────

    const erosionParams = {
      enabled:        patchOperation.getErosionEnabled(),
      scale:          DEFAULT_EROSION_SCALE,
      strength:       DEFAULT_EROSION_STRENGTH,
      gullyWeight:    DEFAULT_EROSION_GULLY_WEIGHT,
      detail:         DEFAULT_EROSION_DETAIL,
      octaves:        DEFAULT_EROSION_OCTAVES,
      lacunarity:     DEFAULT_EROSION_LACUNARITY,
      gain:           DEFAULT_EROSION_GAIN,
      cellScale:      DEFAULT_EROSION_CELL_SCALE,
      normalization:  DEFAULT_EROSION_NORMALIZATION,
      ridgeRounding:  DEFAULT_EROSION_RIDGE_ROUNDING,
      creaseRounding: DEFAULT_EROSION_CREASE_ROUNDING,
    };

    const syncErosion = () => {
      patchOperation.setErosionParams(
        erosionParams.enabled,
        erosionParams.octaves,
        erosionParams.scale,
        erosionParams.strength,
        erosionParams.gullyWeight,
        erosionParams.detail,
        erosionParams.lacunarity,
        erosionParams.gain,
        erosionParams.cellScale,
        erosionParams.normalization,
        erosionParams.ridgeRounding,
        erosionParams.creaseRounding,
      );
      invalidate();
    };

    erosionPage.addBinding(erosionParams, 'enabled',     { label: 'Enabled'       }).on('change', syncErosion);
    erosionPage.addBinding(erosionParams, 'scale',       { label: 'Scale',        min: 0.02, max: 0.5,  step: 0.01 }).on('change', syncErosion);
    erosionPage.addBinding(erosionParams, 'strength',    { label: 'Strength',     min: 0.0,  max: 0.5,  step: 0.01 }).on('change', syncErosion);
    erosionPage.addBinding(erosionParams, 'gullyWeight', { label: 'Gully Weight', min: 0.0,  max: 1.0,  step: 0.01 }).on('change', syncErosion);
    erosionPage.addBinding(erosionParams, 'detail',      { label: 'Detail',       min: 0.3,  max: 3.0,  step: 0.05 }).on('change', syncErosion);
    erosionPage.addBinding(erosionParams, 'octaves',     { label: 'Octaves',      min: 1,    max: 8,    step: 1    }).on('change', syncErosion);
    erosionPage.addBinding(erosionParams, 'lacunarity',  { label: 'Lacunarity',   min: 1.0,  max: 4.0,  step: 0.1  }).on('change', syncErosion);
    erosionPage.addBinding(erosionParams, 'gain',        { label: 'Gain',         min: 0.1,  max: 1.0,  step: 0.05 }).on('change', syncErosion);

    const advFolder = erosionPage.addFolder({ title: 'Advanced', expanded: false });
    advFolder.addBinding(erosionParams, 'cellScale',      { label: 'Cell Scale',      min: 0.2, max: 2.0, step: 0.05 }).on('change', syncErosion);
    advFolder.addBinding(erosionParams, 'normalization',  { label: 'Normalization',   min: 0.0, max: 1.0, step: 0.05 }).on('change', syncErosion);
    advFolder.addBinding(erosionParams, 'ridgeRounding',  { label: 'Ridge Rounding',  min: 0.0, max: 1.0, step: 0.05 }).on('change', syncErosion);
    advFolder.addBinding(erosionParams, 'creaseRounding', { label: 'Crease Rounding', min: 0.0, max: 1.0, step: 0.05 }).on('change', syncErosion);
  }

  public show(): void {
    this.pane.element.style.display = 'block';
  }

  public hide(): void {
    this.pane.element.style.display = 'none';
  }

  public dispose(): void {
    this.pane.dispose();
    this.pane.element.remove();
  }
}
