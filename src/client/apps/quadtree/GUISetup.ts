import { GUI } from 'dat.gui';
import { CubeRenderer, GUIParams } from './CubeRenderer';
import { InteractionHandler, DisplayMode } from './InteractionHandler';
import { FlyCam } from '@core/FlyCam';
import { ProjectionManager, ProjectionType } from '@core/geometry/SphereProjection';

/**
 * Sets up the dat.GUI interface for the QuadTree application.
 */
export class GUISetup {
  private gui: GUI;

  constructor(
    contentArea: HTMLElement,
    cubeRenderer: CubeRenderer,
    params: GUIParams,
    interactionHandler: InteractionHandler | null = null,
    flyCam: FlyCam | null = null,
    onFlyCamToggle: ((enabled: boolean) => void) | null = null
  ) {
    this.gui = new GUI({ autoPlace: false });
    contentArea.appendChild(this.gui.domElement);
    this.gui.domElement.style.position = 'absolute';
    this.gui.domElement.style.top = '0';
    this.gui.domElement.style.right = '0';

    // View folder
    const viewFolder = this.gui.addFolder('View');
    viewFolder
      .add(params, 'baseShape', { Sphere: 'sphere', Cube: 'cube', None: 'none' })
      .name('Base Shape')
      .onChange((value: 'sphere' | 'cube' | 'none') => {
        cubeRenderer.updateBaseShape(value);
        cubeRenderer.clearHoverDisplay(false);
      });

    // Projection dropdown
    const projectionState = {
      projection: ProjectionManager.getProjection(),
    };
    viewFolder
      .add(projectionState, 'projection', {
        'Everett-Praun': ProjectionType.EVERETT_PRAUN,
        'Arvo Equal-Area': ProjectionType.ARVO,
      })
      .name('Projection')
      .onChange((value: ProjectionType) => {
        ProjectionManager.setProjection(value);
      });

    viewFolder
      .add(params, 'showFaces')
      .name('Show Faces')
      .onChange((value: boolean) => {
        cubeRenderer.setVisibility('faces', value);
      });
    viewFolder
      .add(params, 'showWireframe')
      .name('Show Wireframe')
      .onChange((value: boolean) => {
        cubeRenderer.setVisibility('wireframe', value);
      });
    viewFolder
      .add(params, 'showVertices')
      .name('Show Vertices')
      .onChange((value: boolean) => {
        cubeRenderer.setVisibility('vertices', value);
      });

    viewFolder.open();

    // Fly camera folder
    if (flyCam && onFlyCamToggle) {
      const flyCamFolder = this.gui.addFolder('Fly Camera');
      const flyCamState = { flyMode: flyCam.isEnabled() };
      flyCamFolder
        .add(flyCamState, 'flyMode')
        .name('Fly Mode')
        .onChange((value: boolean) => { onFlyCamToggle(value); });
      flyCamFolder.open();
    }

    // Hover settings folder
    if (interactionHandler) {
      const hoverFolder = this.gui.addFolder('Hover Settings');

      // In frustumLOD mode the mesh subdivision per patch is fixed — the quadtree depth
      // (driven by Screen Error) is the sole LOD control.
      const FRUSTUM_LOD_FIXED_SUBDIVISION = 12;
      // Holds the subdivision controller once created, so the displayMode onChange closure
      // can reference it without a forward-declaration TypeScript error.
      const subdivisionRef: { controller?: { domElement: HTMLElement } } = {};

      const hoverState = {
        displayMode: interactionHandler.getDisplayMode(),
        resolutionLevel: interactionHandler.getResolutionLevel(),
        subdivisionFactor: cubeRenderer.getSubdivisionFactor(),
        showSubdivisionWireframe: cubeRenderer.getQuadrantWireframe(),
        useWebWorkers: cubeRenderer.getUseWorkers(),
        targetScreenSpaceError: interactionHandler.getTargetScreenSpaceError(),
      };

      // Mode selector
      hoverFolder
        .add(hoverState, 'displayMode', ['hierarchy', 'frustumLOD'] as DisplayMode[])
        .name('Display Mode')
        .onChange((value: DisplayMode) => {
          interactionHandler.setDisplayMode(value);
          cubeRenderer.clearHoverDisplay(false);
          // Show Screen Error only in frustumLOD mode
          screenSpaceErrorController.domElement.parentElement!.parentElement!.style.display =
            value === 'frustumLOD' ? '' : 'none';
          // Show Max Depth only in hierarchy mode
          maxDepthController.domElement.parentElement!.parentElement!.style.display =
            value === 'hierarchy' ? '' : 'none';
          // In frustumLOD mode, subdivision per patch is fixed — hide the slider.
          if (subdivisionRef.controller) {
            subdivisionRef.controller.domElement.parentElement!.parentElement!.style.display =
              value === 'frustumLOD' ? 'none' : '';
          }
          if (value === 'frustumLOD') {
            cubeRenderer.setSubdivisionFactor(FRUSTUM_LOD_FIXED_SUBDIVISION);
          } else {
            cubeRenderer.setSubdivisionFactor(hoverState.subdivisionFactor);
          }
        });

      const maxDepthController = hoverFolder
        .add(hoverState, 'resolutionLevel', 0, 20, 1)
        .name('Max Depth')
        .onChange((value: number) => {
          interactionHandler.setResolutionLevel(value);
          cubeRenderer.clearHoverDisplay(false);
        });

      // Frustum LOD: Target screen-space error (smaller = more detail)
      const screenSpaceErrorController = hoverFolder
        .add(hoverState, 'targetScreenSpaceError', 8, 256, 8)
        .name('Screen Error (px)')
        .onChange((value: number) => {
          interactionHandler.setTargetScreenSpaceError(value);
          cubeRenderer.clearHoverDisplay(false);
        });

      // Show/hide controls based on initial mode
      if (hoverState.displayMode === 'frustumLOD') {
        maxDepthController.domElement.parentElement!.parentElement!.style.display = 'none';
        cubeRenderer.setSubdivisionFactor(FRUSTUM_LOD_FIXED_SUBDIVISION);
      } else {
        screenSpaceErrorController.domElement.parentElement!.parentElement!.style.display = 'none';
      }

      subdivisionRef.controller = hoverFolder
        .add(hoverState, 'subdivisionFactor', 0, 12, 1)
        .name('Subdivision')
        .onChange((value: number) => {
          cubeRenderer.setSubdivisionFactor(value);
          cubeRenderer.clearHoverDisplay(false);
        });

      // Hide subdivision slider when starting in frustumLOD mode
      if (hoverState.displayMode === 'frustumLOD') {
        subdivisionRef.controller.domElement.parentElement!.parentElement!.style.display = 'none';
      }

      hoverFolder
        .add(hoverState, 'showSubdivisionWireframe')
        .name('Subdivision Wireframe')
        .onChange((value: boolean) => {
          cubeRenderer.setQuadrantWireframe(value);
        });

      hoverFolder
        .add(hoverState, 'useWebWorkers')
        .name('Use Web Workers')
        .onChange((value: boolean) => {
          cubeRenderer.setUseWorkers(value);
          cubeRenderer.clearHoverDisplay(false);
        });

      hoverFolder.open();
    }

    // Debug folder
    const debugFolder = this.gui.addFolder('Debug');

    const debugState = {
      showProjectionDebug: false,
      projectionSubdivisions: 10,
    };

    debugFolder
      .add(debugState, 'showProjectionDebug')
      .name('Projection Debug')
      .onChange((value: boolean) => {
        if (value) {
          cubeRenderer.displayProjectionDebug(debugState.projectionSubdivisions);
        } else {
          cubeRenderer.clearProjectionDebug();
        }
      });

    debugFolder
      .add(debugState, 'projectionSubdivisions', 2, 30, 1)
      .name('Subdivisions')
      .onChange((value: number) => {
        if (debugState.showProjectionDebug) {
          cubeRenderer.displayProjectionDebug(value);
        }
      });

    // Hide initially
    this.gui.domElement.style.display = 'none';
  }

  /**
   * Shows the GUI.
   */
  show(): void {
    this.gui.domElement.style.display = '';
  }

  /**
   * Hides the GUI.
   */
  hide(): void {
    this.gui.domElement.style.display = 'none';
  }

  /**
   * Disposes of the GUI.
   */
  dispose(): void {
    this.gui.destroy();
  }
}
