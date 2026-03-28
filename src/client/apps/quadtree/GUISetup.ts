import { GUI } from 'dat.gui';
import { CubeRenderer, GUIParams } from './CubeRenderer';
import { InteractionHandler, DisplayMode } from './InteractionHandler';
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
    interactionHandler: InteractionHandler | null = null
  ) {
    this.gui = new GUI({ autoPlace: false });
    contentArea.appendChild(this.gui.domElement);
    this.gui.domElement.style.position = 'absolute';
    this.gui.domElement.style.top = '0';
    this.gui.domElement.style.right = '0';

    // View folder
    const viewFolder = this.gui.addFolder('View');
    viewFolder
      .add(params, 'sphereMode')
      .name('Sphere Mode')
      .onChange((value: boolean) => {
        cubeRenderer.updateSphereMode(value);
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

    // Hover settings folder
    if (interactionHandler) {
      const hoverFolder = this.gui.addFolder('Hover Settings');

      const hoverState = {
        displayMode: interactionHandler.getDisplayMode(),
        resolutionLevel: interactionHandler.getResolutionLevel(),
        distanceThreshold: interactionHandler.getDistanceThreshold(),
        subdivisionFactor: cubeRenderer.getSubdivisionFactor(),
        showSubdivisionWireframe: cubeRenderer.getQuadrantWireframe(),
        useWebWorkers: cubeRenderer.getUseWorkers(),
        // Frustum LOD settings
        targetScreenSpaceError: interactionHandler.getTargetScreenSpaceError(),
        autoAdjustDepth: interactionHandler.getAutoAdjustDepth(),
      };

      // Mode selector
      hoverFolder
        .add(hoverState, 'displayMode', ['hierarchy', 'distance', 'lod', 'frustumLOD'] as DisplayMode[])
        .name('Display Mode')
        .onChange((value: DisplayMode) => {
          interactionHandler.setDisplayMode(value);
          cubeRenderer.clearHoverDisplay(false);
          // Show/hide distance threshold based on mode (used by 'distance' and 'lod')
          distanceController.domElement.parentElement!.parentElement!.style.display =
            (value === 'distance' || value === 'lod') ? '' : 'none';
          // Show/hide frustum LOD settings
          screenSpaceErrorController.domElement.parentElement!.parentElement!.style.display =
            value === 'frustumLOD' ? '' : 'none';
          autoAdjustDepthController.domElement.parentElement!.parentElement!.style.display =
            value === 'frustumLOD' ? '' : 'none';
        });

      hoverFolder
        .add(hoverState, 'resolutionLevel', 0, 20, 1)
        .name('Max Depth')
        .onChange((value: number) => {
          interactionHandler.setResolutionLevel(value);
          cubeRenderer.clearHoverDisplay(false);
        });

      // Distance threshold (only visible in distance mode)
      const distanceController = hoverFolder
        .add(hoverState, 'distanceThreshold', 0.01, 0.8, 0.01)
        .name('Distance Threshold')
        .onChange((value: number) => {
          interactionHandler.setDistanceThreshold(value);
          cubeRenderer.clearHoverDisplay(false);
        });

      // Hide distance threshold initially if in hierarchy mode
      if (hoverState.displayMode !== 'distance' && hoverState.displayMode !== 'lod') {
        distanceController.domElement.parentElement!.parentElement!.style.display = 'none';
      }

      // Frustum LOD: Target screen-space error (smaller = more detail)
      const screenSpaceErrorController = hoverFolder
        .add(hoverState, 'targetScreenSpaceError', 8, 256, 8)
        .name('Screen Error (px)')
        .onChange((value: number) => {
          interactionHandler.setTargetScreenSpaceError(value);
          cubeRenderer.clearHoverDisplay(false);
        });

      // Frustum LOD: Auto-adjust depth based on camera distance
      const autoAdjustDepthController = hoverFolder
        .add(hoverState, 'autoAdjustDepth')
        .name('Auto Adjust Depth')
        .onChange((value: boolean) => {
          interactionHandler.setAutoAdjustDepth(value);
          cubeRenderer.clearHoverDisplay(false);
        });

      // Hide frustum LOD settings initially if not in frustumLOD mode
      if (hoverState.displayMode !== 'frustumLOD') {
        screenSpaceErrorController.domElement.parentElement!.parentElement!.style.display = 'none';
        autoAdjustDepthController.domElement.parentElement!.parentElement!.style.display = 'none';
      }

      hoverFolder
        .add(hoverState, 'subdivisionFactor', 0, 12, 1)
        .name('Subdivision')
        .onChange((value: number) => {
          cubeRenderer.setSubdivisionFactor(value);
          cubeRenderer.clearHoverDisplay(false);
        });

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
      // Debug camera settings (enabled by default for frustumLOD visualization)
      useDebugCamera: interactionHandler?.getUseDebugCamera() ?? true,
      debugCamX: 2.5,
      debugCamY: 0.5,
      debugCamZ: 0,
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

    // Debug camera controls (only if interactionHandler exists)
    if (interactionHandler) {
      const debugCamController = debugFolder
        .add(debugState, 'useDebugCamera')
        .name('Use Debug Camera')
        .onChange((value: boolean) => {
          interactionHandler.setUseDebugCamera(value);
          // Show/hide position controls
          debugCamXController.domElement.parentElement!.parentElement!.style.display = value ? '' : 'none';
          debugCamYController.domElement.parentElement!.parentElement!.style.display = value ? '' : 'none';
          debugCamZController.domElement.parentElement!.parentElement!.style.display = value ? '' : 'none';
        });

      const updateDebugCamPosition = () => {
        interactionHandler.setDebugCameraPosition(
          debugState.debugCamX,
          debugState.debugCamY,
          debugState.debugCamZ
        );
      };

      const debugCamXController = debugFolder
        .add(debugState, 'debugCamX', -5, 5, 0.1)
        .name('Debug Cam X')
        .onChange(updateDebugCamPosition);

      const debugCamYController = debugFolder
        .add(debugState, 'debugCamY', -5, 5, 0.1)
        .name('Debug Cam Y')
        .onChange(updateDebugCamPosition);

      const debugCamZController = debugFolder
        .add(debugState, 'debugCamZ', -5, 5, 0.1)
        .name('Debug Cam Z')
        .onChange(updateDebugCamPosition);

      // Show/hide position controls based on initial state
      const displayStyle = debugState.useDebugCamera ? '' : 'none';
      debugCamXController.domElement.parentElement!.parentElement!.style.display = displayStyle;
      debugCamYController.domElement.parentElement!.parentElement!.style.display = displayStyle;
      debugCamZController.domElement.parentElement!.parentElement!.style.display = displayStyle;
    }

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
