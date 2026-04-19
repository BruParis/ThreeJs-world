import { Pane } from 'tweakpane';
import { CubeRenderer, GUIParams } from './CubeRenderer';
import { InteractionHandler, DisplayMode } from './InteractionHandler';
import { FlyCam } from '@core/FlyCam';
import { ProjectionManager, ProjectionType } from '@core/geometry/SphereProjection';

/**
 * Sets up the Tweakpane interface for the QuadTree application.
 */
export class GUISetup {
  private pane: Pane;

  constructor(
    contentArea: HTMLElement,
    cubeRenderer: CubeRenderer,
    params: GUIParams,
    interactionHandler: InteractionHandler | null = null,
    flyCam: FlyCam | null = null,
    onFlyCamToggle: ((enabled: boolean) => void) | null = null
  ) {
    this.pane = new Pane({ title: 'Controls' });
    this.pane.element.style.position = 'absolute';
    this.pane.element.style.top      = '0';
    this.pane.element.style.right    = '0';
    this.pane.element.style.width    = '280px';
    this.pane.element.style.display  = 'none';
    contentArea.appendChild(this.pane.element);

    // ── View ─────────────────────────────────────────────────────────────────

    const viewFolder = this.pane.addFolder({ title: 'View', expanded: true });

    const baseShapeState = { baseShape: params.baseShape };
    viewFolder.addBinding(baseShapeState, 'baseShape', {
      label: 'Base Shape',
      options: { Sphere: 'sphere', Cube: 'cube', None: 'none' },
    }).on('change', ({ value }) => {
      cubeRenderer.updateBaseShape(value as 'sphere' | 'cube' | 'none');
      cubeRenderer.clearHoverDisplay(false);
    });

    const projectionState = { projection: ProjectionManager.getProjection() };
    viewFolder.addBinding(projectionState, 'projection', {
      label: 'Projection',
      options: {
        'Everett-Praun': ProjectionType.EVERETT_PRAUN,
        'Arvo Equal-Area': ProjectionType.ARVO,
      },
    }).on('change', ({ value }) => {
      ProjectionManager.setProjection(value as ProjectionType);
    });

    viewFolder.addBinding(params, 'showFaces',     { label: 'Show Faces'     })
      .on('change', ({ value }) => cubeRenderer.setVisibility('faces',     value));
    viewFolder.addBinding(params, 'showWireframe', { label: 'Show Wireframe' })
      .on('change', ({ value }) => cubeRenderer.setVisibility('wireframe', value));
    viewFolder.addBinding(params, 'showVertices',  { label: 'Show Vertices'  })
      .on('change', ({ value }) => cubeRenderer.setVisibility('vertices',  value));

    // ── Fly Camera ────────────────────────────────────────────────────────────

    if (flyCam && onFlyCamToggle) {
      const flyCamFolder = this.pane.addFolder({ title: 'Fly Camera', expanded: true });
      const flyCamState = { flyMode: flyCam.isEnabled() };
      flyCamFolder.addBinding(flyCamState, 'flyMode', { label: 'Fly Mode' })
        .on('change', ({ value }) => onFlyCamToggle(value));
    }

    // ── Hover Settings ────────────────────────────────────────────────────────

    if (interactionHandler) {
      const FRUSTUM_LOD_FIXED_SUBDIVISION = 12;

      const hoverFolder = this.pane.addFolder({ title: 'Hover Settings', expanded: true });

      const hoverState = {
        displayMode:              interactionHandler.getDisplayMode(),
        resolutionLevel:          interactionHandler.getResolutionLevel(),
        subdivisionFactor:        cubeRenderer.getSubdivisionFactor(),
        showSubdivisionWireframe: cubeRenderer.getQuadrantWireframe(),
        useWebWorkers:            cubeRenderer.getUseWorkers(),
        targetScreenSpaceError:   interactionHandler.getTargetScreenSpaceError(),
      };

      hoverFolder.addBinding(hoverState, 'displayMode', {
        label: 'Display Mode',
        options: { hierarchy: 'hierarchy', frustumLOD: 'frustumLOD' },
      }).on('change', ({ value }) => {
        interactionHandler.setDisplayMode(value as DisplayMode);
        cubeRenderer.clearHoverDisplay(false);
        screenSpaceErrorBinding.hidden = value !== 'frustumLOD';
        maxDepthBinding.hidden         = value === 'frustumLOD';
        subdivisionBinding.hidden      = value === 'frustumLOD';
        if (value === 'frustumLOD') {
          cubeRenderer.setSubdivisionFactor(FRUSTUM_LOD_FIXED_SUBDIVISION);
        } else {
          cubeRenderer.setSubdivisionFactor(hoverState.subdivisionFactor);
        }
      });

      const maxDepthBinding = hoverFolder.addBinding(hoverState, 'resolutionLevel', {
        label: 'Max Depth', min: 0, max: 20, step: 1,
      }).on('change', ({ value }) => {
        interactionHandler.setResolutionLevel(value);
        cubeRenderer.clearHoverDisplay(false);
      });

      const screenSpaceErrorBinding = hoverFolder.addBinding(hoverState, 'targetScreenSpaceError', {
        label: 'Screen Error (px)', min: 8, max: 256, step: 8,
      }).on('change', ({ value }) => {
        interactionHandler.setTargetScreenSpaceError(value);
        cubeRenderer.clearHoverDisplay(false);
      });

      const subdivisionBinding = hoverFolder.addBinding(hoverState, 'subdivisionFactor', {
        label: 'Subdivision', min: 0, max: 12, step: 1,
      }).on('change', ({ value }) => {
        cubeRenderer.setSubdivisionFactor(value);
        cubeRenderer.clearHoverDisplay(false);
      });

      hoverFolder.addBinding(hoverState, 'showSubdivisionWireframe', { label: 'Subdivision Wireframe' })
        .on('change', ({ value }) => cubeRenderer.setQuadrantWireframe(value));
      hoverFolder.addBinding(hoverState, 'useWebWorkers', { label: 'Use Web Workers' })
        .on('change', ({ value }) => {
          cubeRenderer.setUseWorkers(value);
          cubeRenderer.clearHoverDisplay(false);
        });

      // Initial visibility based on starting mode
      if (hoverState.displayMode === 'frustumLOD') {
        maxDepthBinding.hidden    = true;
        subdivisionBinding.hidden = true;
        cubeRenderer.setSubdivisionFactor(FRUSTUM_LOD_FIXED_SUBDIVISION);
      } else {
        screenSpaceErrorBinding.hidden = true;
      }
    }

    // ── Debug ─────────────────────────────────────────────────────────────────

    const debugFolder = this.pane.addFolder({ title: 'Debug', expanded: false });
    const debugState = { showProjectionDebug: false, projectionSubdivisions: 10 };

    debugFolder.addBinding(debugState, 'showProjectionDebug', { label: 'Projection Debug' })
      .on('change', ({ value }) => {
        if (value) cubeRenderer.displayProjectionDebug(debugState.projectionSubdivisions);
        else       cubeRenderer.clearProjectionDebug();
      });

    debugFolder.addBinding(debugState, 'projectionSubdivisions', {
      label: 'Subdivisions', min: 2, max: 30, step: 1,
    }).on('change', ({ value }) => {
      if (debugState.showProjectionDebug) cubeRenderer.displayProjectionDebug(value);
    });
  }

  show(): void {
    this.pane.element.style.display = 'block';
  }

  hide(): void {
    this.pane.element.style.display = 'none';
  }

  dispose(): void {
    this.pane.dispose();
    this.pane.element.remove();
  }
}
