/**
 * Separate Tweakpane for the terrain controls of the World tab.
 *
 * Positioned on the left side of the screen so it is visually distinct from
 * the main GUIManager pane (which sits on the right and holds global/tectonic
 * controls).
 *
 * The terrain itself (noise, erosion, vegetation, colors) is edited in the
 * Shaders tab: both tabs render from the same shared parameters, so anything
 * tuned there on the flat patch is what the planet shows here.  This pane only
 * exposes the few controls worth having at hand while looking at the planet.
 */

import { Pane } from 'tweakpane';
import { type TerrainParams } from '../../../shared/terrain/TerrainParams';

export class TerrainGUIManager {
  private pane: Pane;
  private readonly unsubscribe: () => void;

  constructor(params: TerrainParams, contentArea: HTMLElement) {
    this.pane = new Pane({ title: 'Terrain' });
    this.pane.element.style.position = 'absolute';
    this.pane.element.style.top      = '0';
    this.pane.element.style.left     = '0';
    this.pane.element.style.width    = '280px';
    contentArea.appendChild(this.pane.element);

    const state = {
      amplitudeKm:  params.elevationAmplitudeKm,
      exaggeration: params.elevationDisplayScale,
      shownKm:      0,
      offset:       params.elevationOffset,
      kmPerUnit:    params.kmPerUnit,
      more:         'Shaders tab',
    };

    // True while the pane is being refreshed from the store, so that the
    // refresh does not write the same values back and notify again.
    let syncing = false;
    const refreshDerived = () => {
      state.shownKm = (1 - params.seaLevel) * params.elevationAmplitudeApparentKm;
    };
    refreshDerived();

    this.pane.addBinding(state, 'amplitudeKm', {
      label: 'Relief (km)', min: 0.5, max: 30, step: 0.5,
    }).on('change', ({ value }) => {
      if (syncing) return;
      params.elevationAmplitudeKm = value;
      params.notify('display');
    });

    this.pane.addBinding(state, 'exaggeration', {
      label: 'Exaggeration', min: 1, max: 30, step: 0.5,
    }).on('change', ({ value }) => {
      if (syncing) return;
      params.elevationDisplayScale = value;
      params.notify('display');
    });

    this.pane.addBinding(state, 'shownKm', {
      label: 'Shown height (km)', readonly: true, format: (v: number) => v.toFixed(1),
    });

    this.pane.addBinding(state, 'offset', {
      label: 'Elev. Offset', min: -0.4, max: 0.5, step: 0.01,
    }).on('change', ({ value }) => {
      if (syncing) return;
      params.elevationOffset = value;
      params.notify('trees');
    });

    this.pane.addBinding(state, 'kmPerUnit', {
      label: 'km / unit', readonly: true, format: (v: number) => v.toFixed(0),
    });

    this.pane.addBinding(state, 'more', { label: 'Other settings', readonly: true });

    // Keep the pane in step with edits made in the Shaders tab.
    this.unsubscribe = params.onChange(() => {
      state.amplitudeKm  = params.elevationAmplitudeKm;
      state.exaggeration = params.elevationDisplayScale;
      state.offset       = params.elevationOffset;
      state.kmPerUnit    = params.kmPerUnit;
      refreshDerived();
      syncing = true;
      this.pane.refresh();
      syncing = false;
    });
  }

  public show(): void {
    this.pane.element.style.display = 'block';
  }

  public hide(): void {
    this.pane.element.style.display = 'none';
  }

  public dispose(): void {
    this.unsubscribe();
    this.pane.dispose();
    this.pane.element.remove();
  }
}
