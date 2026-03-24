import { GUI } from 'dat.gui';
import { CubeRenderer, GUIParams } from './CubeRenderer';
import { InteractionHandler } from './InteractionHandler';

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
        cubeRenderer.clearHoverDisplay();
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
        resolutionLevel: interactionHandler.getResolutionLevel(),
      };

      hoverFolder
        .add(hoverState, 'resolutionLevel', 0, 8, 1)
        .name('Resolution Level')
        .onChange((value: number) => {
          interactionHandler.setResolutionLevel(value);
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
