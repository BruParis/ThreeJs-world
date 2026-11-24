/**
 * What every GUI section of the Shaders tab needs: the shared terrain
 * parameters, the terrain mesh, and the update callbacks.
 *
 * Terrain parameters live in the shared store P.  Controls write to it and
 * notify; the terrain (and the World tab) react to the notification.
 */

import type { TerrainParams } from '../../../shared/terrain/TerrainParams';
import type { TerrainMesh } from '../terrain/TerrainMesh';

export interface GUIUpdaters {
  /** Uniform-only change (relief, exaggeration, wireframe…). */
  display:   () => void;
  /** Elevation re-bake (debounced). */
  elevation: () => void;
  /** Mesh rebuild (patches, subdivision). */
  geometry:  () => void;
  /** Color change (uniforms only). */
  colors:    () => void;
  /** Bump re-bake (debounced). */
  bump:      () => void;
  /** Tree density re-bake. */
  trees:     () => void;
}

export interface GUIContext {
  readonly P: TerrainParams;
  readonly terrain: TerrainMesh;
  readonly upd: GUIUpdaters;
  /** Refreshes the "Patch info" readouts; installed by the scale section. */
  refreshScale: () => void;
}

function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

export function createGUIContext(terrain: TerrainMesh): GUIContext {
  const P = terrain.params;
  const ctx: GUIContext = {
    P,
    terrain,
    refreshScale: () => {},
    upd: {
      display:   () => { terrain.updateUniforms(); P.notify('display'); },
      elevation: debounce(() => { P.notify('elevation'); ctx.refreshScale(); }, 150),
      geometry:  () => { terrain.rebuild(); ctx.refreshScale(); },
      colors:    () => P.notify('display'),
      bump:      debounce(() => P.notify('bump'), 150),
      trees:     () => P.notify('trees'),
    },
  };
  return ctx;
}
