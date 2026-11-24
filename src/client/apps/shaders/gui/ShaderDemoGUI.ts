/**
 * GUI of the Shaders tab, split in three panels:
 *   - View    (right, top): camera, debug view, mesh, lighting — how the patch
 *                           is looked at;
 *   - Terrain (right):      the terrain recipe shared with the World tab —
 *                           scale, elevation, erosion;
 *   - Biomes  (left):       biome layout editor, biome types, transitions and
 *                           surface (ground, vegetation, water).
 * Folders inside a panel behave as an accordion.  Each section is built by a
 * function of gui/sections taking the folder to fill.
 */

import { DirectionalLight, AmbientLight } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FlyCam } from '@core/FlyCam';
import { TerrainMesh } from '../terrain/TerrainMesh';
import { createGUIContext } from './GUIContext';
import { PanelColumn, accordion } from './Panels';
import { addViewSection } from './sections/ViewSection';
import { addScaleSection, addElevationSection, addErosionSection } from './sections/TerrainSections';
import { addBiomesSection, type BiomeGUIContext } from './sections/BiomesSection';

export type { BiomeGUIContext } from './sections/BiomesSection';

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
  biomes: BiomeGUIContext,
): ShaderDemoGUIHandle {
  const ctx = createGUIContext(terrain);

  const right = new PanelColumn(contentArea, 'right');
  const left  = new PanelColumn(contentArea, 'left');

  // ── View ──────────────────────────────────────────────────────────────────
  const viewPane = right.addPanel('View');
  addViewSection(viewPane, ctx, controls, flyCam, sunLight, ambientLight);

  // ── Terrain ───────────────────────────────────────────────────────────────
  const terrainPane = right.addPanel('Terrain', { grow: true });
  const scaleFolder     = terrainPane.addFolder({ title: 'Scale & location', expanded: false });
  const elevationFolder = terrainPane.addFolder({ title: 'Elevation',        expanded: true  });
  const erosionFolder   = terrainPane.addFolder({ title: 'Erosion',          expanded: false });
  addScaleSection(scaleFolder, ctx);
  addElevationSection(elevationFolder, ctx);
  addErosionSection(erosionFolder, ctx);
  accordion([scaleFolder, elevationFolder, erosionFolder]);

  // ── Biomes ────────────────────────────────────────────────────────────────
  const biomesPane = left.addPanel('Biomes', { grow: true });
  const stopEditing = addBiomesSection(biomesPane, ctx, biomes);
  // Collapsing the panel puts the mouse back to camera-only.
  biomesPane.on('fold', ({ expanded }) => { if (!expanded) stopEditing(); });

  const panes = [viewPane, terrainPane, biomesPane];
  return {
    show:    () => { right.setVisible(true);  left.setVisible(true);  },
    hide:    () => { right.setVisible(false); left.setVisible(false); },
    destroy: () => {
      for (const p of panes) p.dispose();
      right.dispose();
      left.dispose();
    },
  };
}
