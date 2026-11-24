/**
 * Biomes panel: the layout editor (a centre point with rays cutting the patch
 * into sectors, each with a biome), the biome types, the transitions between
 * them, and the surface settings (ground, vegetation, water).
 *
 * Transition, biome and surface parameters are shared with the World tab; the
 * layout is specific to this patch.
 */

import { Pane } from 'tweakpane';
import { BIOME_COLORS, BIOME_NAMES, BIOME_OCEAN } from '@core/terrain/BiomeBoundaries';
import type { BiomeLayout } from '../../biomes/BiomeLayout';
import type { BiomeEditor } from '../../biomes/BiomeEditor';
import type { BiomeLayoutOverlay } from '../../biomes/BiomeLayoutOverlay';
import { BiomeGestureHelp, buildMapKey } from '../../biomes/BiomeLegend';
import { accordion, addTitleSwatch, appendToFolder } from '../Panels';
import { addGroundSection, addVegetationSection, addWaterSection } from './SurfaceSections';
import type { GUIContext } from '../GUIContext';

export interface BiomeGUIContext {
  layout:  BiomeLayout;
  editor:  BiomeEditor;
  overlay: BiomeLayoutOverlay;
}

const css = (c: [number, number, number]) =>
  `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;

/** Fills the Biomes panel.  Returns a function that turns editing off. */
export function addBiomesSection(pane: Pane, ctx: GUIContext, biomes: BiomeGUIContext): () => void {
  const { P, upd } = ctx;
  const { layout, editor, overlay } = biomes;

  // ── Edit toggle + gesture help (visible while editing only) ───────────────

  const editButton = pane.addButton({ title: '' });
  const helpFolder = pane.addFolder({ title: 'Mouse gestures', expanded: true });
  const help = new BiomeGestureHelp(layout.center !== null);
  appendToFolder(helpFolder, help.element);

  // ── Layout ────────────────────────────────────────────────────────────────

  const layoutState = { overlay: overlay.visible, rays: layout.rays.length };
  const layoutFolder = pane.addFolder({ title: 'Layout (this patch)', expanded: true });
  layoutFolder.addBinding(layoutState, 'overlay', { label: 'Show layout' })
    .on('change', ({ value }) => { overlay.visible = value; });
  layoutFolder.addBinding(layoutState, 'rays', { label: 'Rays', readonly: true, format: (v: number) => v.toFixed(0) });
  layoutFolder.addButton({ title: 'Clear layout' }).on('click', () => layout.clear());
  const keyFolder = layoutFolder.addFolder({ title: 'Map key', expanded: false });
  appendToFolder(keyFolder, buildMapKey());

  layout.onChange(() => {
    layoutState.rays = layout.rays.length;
    help.setHasCenter(layout.center !== null);
    layoutFolder.refresh();
  });

  const setEditing = (on: boolean) => {
    editor.setEnabled(on);
    editButton.title = on ? '● Editing biomes (click to stop)' : 'Edit biomes (click to start)';
    helpFolder.hidden = !on;
    if (on && !overlay.visible) {
      layoutState.overlay = true;
      overlay.visible = true;
      layoutFolder.refresh();
    }
  };
  editButton.on('click', () => setEditing(!editor.enabled));

  // ── Biome types ───────────────────────────────────────────────────────────
  //
  // One folder per biome, holding the parameters specific to it.

  const typesFolder = pane.addFolder({ title: 'Biome types', expanded: false });
  const biomeState = { oceanDepth: P.oceanFloorDepth };
  for (const [idStr, name] of Object.entries(BIOME_NAMES)) {
    const id = Number(idStr);
    const f = typesFolder.addFolder({ title: name, expanded: id === BIOME_OCEAN });
    addTitleSwatch(f, css(BIOME_COLORS[id]));
    if (id === BIOME_OCEAN) {
      f.addBinding(biomeState, 'oceanDepth', { label: 'Floor depth', min: 0.0, max: 0.35, step: 0.005 })
        .on('change', ({ value }) => { P.oceanFloorDepth = value; upd.elevation(); });
    } else {
      f.addBinding({ note: 'Terrain panel noise' }, 'note', { label: 'Elevation', readonly: true });
    }
  }

  // ── Transitions ───────────────────────────────────────────────────────────

  const transState = {
    transitionKm: P.biomeTransitionKm,
    noiseKm:      P.biomeBoundaryNoiseKm,
    wavelengthKm: P.biomeBoundaryNoiseWavelengthKm,
  };
  const transFolder = pane.addFolder({ title: 'Transitions', expanded: false });
  transFolder.addBinding(transState, 'transitionKm', { label: 'Width (km)', min: 1, max: 300, step: 1 })
    .on('change', ({ value }) => { P.biomeTransitionKm = value; upd.elevation(); });
  transFolder.addBinding(transState, 'noiseKm', { label: 'Edge noise (km)', min: 0, max: 100, step: 0.5 })
    .on('change', ({ value }) => { P.biomeBoundaryNoiseKm = value; upd.elevation(); });
  transFolder.addBinding(transState, 'wavelengthKm', { label: 'Noise λ (km)', min: 5, max: 500, step: 1 })
    .on('change', ({ value }) => { P.biomeBoundaryNoiseWavelengthKm = value; upd.elevation(); });

  // ── Surface (single set, applied to every biome for now) ──────────────────

  const surfaceFolder = pane.addFolder({ title: 'Surface (all biomes)', expanded: false });
  const ground     = surfaceFolder.addFolder({ title: 'Ground',     expanded: false });
  const vegetation = surfaceFolder.addFolder({ title: 'Vegetation', expanded: false });
  const water      = surfaceFolder.addFolder({ title: 'Water',      expanded: false });
  addGroundSection(ground, ctx);
  addVegetationSection(vegetation, ctx);
  addWaterSection(water, ctx);
  accordion([ground, vegetation, water]);

  accordion([layoutFolder, typesFolder, transFolder, surfaceFolder]);

  setEditing(false);
  return () => { if (editor.enabled) setEditing(false); };
}
