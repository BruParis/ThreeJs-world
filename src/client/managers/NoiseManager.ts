import * as THREE from 'three';
import { Tile } from '../tectonics/data/Plate';
import { PerlinNoise3D } from '@core/noise/PerlinNoise';
import { projectToTangentPlane } from '../utils/MathUtils';
import { makeLineSegments2ForGradients } from '../visualization/NoiseDrawingUtils';
import { assignColorToTriangle } from '../utils/ColorUtils';
import { VisualizationManager } from './VisualizationManager';
import { SceneManager } from './SceneManager';

/**
 * Manages Perlin noise generation and visualization for tiles.
 * Handles noise values, gradients, and their display.
 */
export class NoiseManager {
  private visualizationManager: VisualizationManager;
  private sceneManager: SceneManager;

  private noiseDisplayEnabled: boolean = false;
  private gradientDisplayEnabled: boolean = false;
  private noiseValues: Map<Tile, number> = new Map();
  private noiseGradients: Map<Tile, THREE.Vector3> = new Map();
  private perlinNoise: PerlinNoise3D | null = null;
  private noiseParams = {
    seed: 42,
    scale: 2.0,
    octaves: 4,
    persistence: 0.5,
    lacunarity: 2.0
  };

  // Callback to refresh plate display after noise changes
  private onNoiseDisplayChange: (() => void) | null = null;
  // Function to get all tiles for noise generation
  private getTiles: (() => Iterable<Tile>) | null = null;

  constructor(visualizationManager: VisualizationManager, sceneManager: SceneManager) {
    this.visualizationManager = visualizationManager;
    this.sceneManager = sceneManager;
  }

  /**
   * Sets the callback to refresh plate display when noise display changes.
   */
  public setOnNoiseDisplayChange(callback: () => void): void {
    this.onNoiseDisplayChange = callback;
  }

  /**
   * Sets the function to get all tiles for noise generation.
   */
  public setGetTiles(getTiles: () => Iterable<Tile>): void {
    this.getTiles = getTiles;
  }

  /**
   * Generates Perlin noise values for all tiles based on their centroid positions.
   * Uses FBM (Fractal Brownian Motion) for more natural-looking noise.
   * Also computes and stores gradients projected onto the sphere's tangent plane.
   */
  public generatePerlinNoise(
    seed: number = 42,
    scale: number = 2.0,
    octaves: number = 4,
    persistence: number = 0.5,
    lacunarity: number = 2.0
  ): void {
    if (!this.getTiles) {
      console.warn('[NoiseManager] No getTiles function set.');
      return;
    }

    // Store parameters for later use
    this.noiseParams = { seed, scale, octaves, persistence, lacunarity };

    this.perlinNoise = new PerlinNoise3D(seed);
    this.noiseValues.clear();
    this.noiseGradients.clear();

    for (const tile of this.getTiles()) {
      const pos = tile.centroid;
      // Use FBM for more natural terrain-like noise
      const noiseValue = this.perlinNoise.fbm(
        pos.x * scale,
        pos.y * scale,
        pos.z * scale,
        octaves,
        persistence,
        lacunarity
      );
      // Map from [-1, 1] to [0, 1]
      const normalizedValue = (noiseValue + 1) / 2;
      this.noiseValues.set(tile, normalizedValue);

      // Compute gradient and project to tangent plane
      const [gx, gy, gz] = this.perlinNoise.fbmGradient(
        pos.x * scale,
        pos.y * scale,
        pos.z * scale,
        octaves,
        persistence,
        lacunarity,
        1.0  // scale is already applied to coordinates
      );
      const gradient3D = new THREE.Vector3(gx, gy, gz);
      const tangentGradient = projectToTangentPlane(gradient3D, pos);
      this.noiseGradients.set(tile, tangentGradient);
    }

    console.log(`[NoiseManager] Generated Perlin noise for ${this.noiseValues.size} tiles.`);

    // If noise display is enabled, refresh the visualization
    if (this.noiseDisplayEnabled) {
      this.colorByNoise();
    }

    // If gradient display is enabled, update the gradient visualization
    if (this.gradientDisplayEnabled) {
      this.updateGradientVisualization();
    }
  }

  /**
   * Colors tiles by noise values (grayscale 0-1).
   */
  public colorByNoise(): void {
    const dualMesh = this.visualizationManager.getDualMesh();

    if (!dualMesh) {
      console.warn('[NoiseManager] No dual mesh available for coloring by noise.');
      return;
    }

    if (this.noiseValues.size === 0) {
      console.warn('[NoiseManager] No noise values generated. Call generatePerlinNoise() first.');
      return;
    }

    for (const [tile, noiseValue] of this.noiseValues) {
      const noiseColor = new THREE.Color(noiseValue, noiseValue, noiseValue);

      for (const auxHe of tile.loop()) {
        const origFaceIdx = dualMesh.geometry.userData.halfedge2FaceMap.get(auxHe.id);
        if (origFaceIdx !== undefined) {
          assignColorToTriangle(dualMesh.geometry, origFaceIdx, noiseColor);
        }
      }
    }
  }

  /**
   * Sets whether noise display is enabled.
   */
  public setNoiseDisplayEnabled(enabled: boolean): void {
    this.noiseDisplayEnabled = enabled;
    if (this.onNoiseDisplayChange) {
      this.onNoiseDisplayChange();
    }
  }

  /**
   * Gets whether noise display is enabled.
   */
  public isNoiseDisplayEnabled(): boolean {
    return this.noiseDisplayEnabled;
  }

  /**
   * Gets the noise value for a specific tile.
   */
  public getNoiseValue(tile: Tile): number | undefined {
    return this.noiseValues.get(tile);
  }

  /**
   * Sets whether gradient display is enabled and updates visualization.
   */
  public setGradientDisplayEnabled(enabled: boolean): void {
    this.gradientDisplayEnabled = enabled;
    const gradientLines = this.visualizationManager.getNoiseGradientLines();
    if (gradientLines) {
      gradientLines.visible = enabled;
      if (enabled) {
        // Generate noise if not already done
        if (this.noiseGradients.size === 0 && this.getTiles) {
          console.log('[NoiseManager] No gradients yet, generating with current params');
          this.generatePerlinNoise(
            this.noiseParams.seed,
            this.noiseParams.scale,
            this.noiseParams.octaves,
            this.noiseParams.persistence,
            this.noiseParams.lacunarity
          );
        } else {
          this.updateGradientVisualization();
        }
      }
    }
  }

  /**
   * Gets whether gradient display is enabled.
   */
  public isGradientDisplayEnabled(): boolean {
    return this.gradientDisplayEnabled;
  }

  /**
   * Updates the gradient visualization lines.
   */
  public updateGradientVisualization(): void {
    if (this.noiseGradients.size === 0) {
      console.log('[NoiseManager] No gradients to display');
      return;
    }

    const gradientLines = this.visualizationManager.getNoiseGradientLines();
    if (!gradientLines) {
      console.log('[NoiseManager] No gradient lines object');
      return;
    }

    // Compute average edge length for scaling
    const avgEdgeLength = this.computeAverageEdgeLength();
    const maxLength = avgEdgeLength * 0.8;


    // Convert tile-based gradients to position-based gradients
    const positionGradients = new Map<THREE.Vector3, THREE.Vector3>();
    for (const [tile, gradient] of this.noiseGradients) {
      positionGradients.set(tile.centroid, gradient);
    }

    const scene = this.sceneManager.getScene();
    let rotation: THREE.Euler | null = null;
    if (gradientLines.parent) {
      rotation = gradientLines.rotation.clone();
      scene.remove(gradientLines);
    }

    makeLineSegments2ForGradients(positionGradients, gradientLines, maxLength);

    if (rotation) {
      gradientLines.rotation.copy(rotation);
    }

    scene.add(gradientLines);
    console.log('[NoiseManager] Added gradient lines to scene, visible:', gradientLines.visible);
  }

  /**
   * Computes the average edge length across all tiles.
   */
  private computeAverageEdgeLength(): number {
    if (!this.getTiles) return 0.05;

    let totalLength = 0;
    let edgeCount = 0;

    for (const tile of this.getTiles()) {
      for (const he of tile.loop()) {
        const v1 = he.vertex.position;
        const v2 = he.next.vertex.position;
        totalLength += v1.distanceTo(v2);
        edgeCount++;
      }
    }

    return edgeCount > 0 ? totalLength / edgeCount : 0.05;
  }

  /**
   * Clears all noise data.
   */
  public clear(): void {
    this.noiseValues.clear();
    this.noiseGradients.clear();
    this.perlinNoise = null;
  }
}
