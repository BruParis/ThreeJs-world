import { SceneManager } from '../managers/SceneManager';
import { VisualizationManager } from '../managers/VisualizationManager';

/**
 * Controls the animation loop and applies rotations to all objects.
 */
export class AnimationController {
  private sceneManager: SceneManager;
  private visualizationManager: VisualizationManager;
  private rotationSpeed: number = 0.0001;
  private isAnimating: boolean = false;
  private animationFrameId: number | null = null;

  constructor(sceneManager: SceneManager, visualizationManager: VisualizationManager) {
    this.sceneManager = sceneManager;
    this.visualizationManager = visualizationManager;
  }

  /**
   * Starts the animation loop.
   */
  public start(): void {
    if (this.isAnimating) return;
    this.isAnimating = true;
    this.animate();
  }

  /**
   * Stops the animation loop.
   */
  public stop(): void {
    this.isAnimating = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * The main animation loop callback.
   */
  private animate(): void {
    if (!this.isAnimating) return;

    this.animationFrameId = requestAnimationFrame(() => this.animate());

    // Apply rotations to all objects
    this.applyRotations();

    // Render the scene
    this.sceneManager.render();
  }

  /**
   * Applies rotation to all visualization objects.
   */
  private applyRotations(): void {
    const icosahedron = this.visualizationManager.getIcosahedron();
    const dualMesh = this.visualizationManager.getDualMesh();
    const halfedgeGraphLines = this.visualizationManager.getHalfedgeGraphLines();
    const tileLines = this.visualizationManager.getTileLines();
    const plateLines = this.visualizationManager.getPlateLines();
    const motionVecLines = this.visualizationManager.getMotionVecLines();
    const boundaryLines = this.visualizationManager.getBoundaryLines();
    const allBoundariesLines = this.visualizationManager.getAllBoundariesLines();

    if (icosahedron) {
      icosahedron.rotation.x += this.rotationSpeed;
      icosahedron.rotation.y += this.rotationSpeed;
    }

    if (halfedgeGraphLines) {
      halfedgeGraphLines.rotation.x += this.rotationSpeed;
      halfedgeGraphLines.rotation.y += this.rotationSpeed;
    }

    if (tileLines) {
      tileLines.rotation.x += this.rotationSpeed;
      tileLines.rotation.y += this.rotationSpeed;
    }

    if (plateLines) {
      plateLines.rotation.x += this.rotationSpeed;
      plateLines.rotation.y += this.rotationSpeed;
    }

    if (motionVecLines) {
      motionVecLines.rotation.x += this.rotationSpeed;
      motionVecLines.rotation.y += this.rotationSpeed;
    }

    if (boundaryLines) {
      boundaryLines.rotation.x += this.rotationSpeed;
      boundaryLines.rotation.y += this.rotationSpeed;
    }

    if (allBoundariesLines) {
      allBoundariesLines.rotation.x += this.rotationSpeed;
      allBoundariesLines.rotation.y += this.rotationSpeed;
    }

    if (dualMesh) {
      dualMesh.rotation.x += this.rotationSpeed;
      dualMesh.rotation.y += this.rotationSpeed;
    }
  }

  /**
   * Gets the rotation speed.
   */
  public getRotationSpeed(): number {
    return this.rotationSpeed;
  }

  /**
   * Sets the rotation speed.
   */
  public setRotationSpeed(speed: number): void {
    this.rotationSpeed = speed;
  }
}
