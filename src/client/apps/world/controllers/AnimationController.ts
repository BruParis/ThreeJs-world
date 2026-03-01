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
   * Uses VisualizationManager.getRotatableObjects() to ensure all objects rotate together.
   */
  private applyRotations(): void {
    const rotatableObjects = this.visualizationManager.getRotatableObjects();

    for (const obj of rotatableObjects) {
      if (obj) {
        obj.rotation.x += this.rotationSpeed;
        obj.rotation.y += this.rotationSpeed;
      }
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
