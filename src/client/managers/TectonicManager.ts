import * as THREE from 'three';
import { TectonicSystem, BoundaryType, GeologicalType, GeologicalIntensity } from '../tectonics/data/Plate';
import { Halfedge } from '@core/Halfedge';
import {
  buildTectonicSystem,
  computeTectonicMotion,
  computeNetRotation,
  computePlateBoundaries,
  caracterizePlateBoundaries,
  computeBoundaryDominance,
  logTileTransferEligibility,
  categorizePlates,
  assignGeologicalTypes,
  createMicroplates
} from '../tectonics/simulation/Tectonics';
import { recomputeOrogenyForBoundary } from '../tectonics/simulation/Orogeny';
import { getPlateColor, PlateDisplayMode } from '../visualization/PlateColors';
import { getGeologicalColor } from '../visualization/GeologyColors';
import {
  splitPlateFromTile,
  transferTileToPlate,
  plateAbsorbedByPlate,
} from '../tectonics/data/PlateOperations';
import { makeLineSegments2ForTileMotionVec, makeLineSegments2ForAllBoundariesByType, makeLineSegments2ForAllBoundariesGradient, makeLineSegments2ForDominanceIndicators, makeLineSegments2ForTransformSlideIndicators } from '../visualization/TectonicsDrawingUtils';
import { VisualizationManager } from './VisualizationManager';
import { SceneManager } from './SceneManager';
import { idToHSLColor, assignColorToTriangle } from '../utils/ColorUtils';

/**
 * Manages the tectonic plate system, including building, coloring, and plate operations.
 */
export class TectonicManager {
  private visualizationManager: VisualizationManager;
  private sceneManager: SceneManager;
  private tectonicSystem: TectonicSystem | null = null;
  private plateDisplayMode: PlateDisplayMode = PlateDisplayMode.CATEGORY;
  private netRotation: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  private geologyDisplayEnabled: boolean = false;
  private recomputeOrogenyMode: boolean = false;

  // Callback for when noise display should be checked
  private checkNoiseDisplayEnabled: (() => boolean) | null = null;
  private applyNoiseColors: (() => void) | null = null;

  constructor(visualizationManager: VisualizationManager, sceneManager: SceneManager) {
    this.visualizationManager = visualizationManager;
    this.sceneManager = sceneManager;
  }

  /**
   * Sets callbacks for noise display integration.
   */
  public setNoiseCallbacks(
    checkNoiseDisplayEnabled: () => boolean,
    applyNoiseColors: () => void
  ): void {
    this.checkNoiseDisplayEnabled = checkNoiseDisplayEnabled;
    this.applyNoiseColors = applyNoiseColors;
  }

  /**
   * Sets the plate display mode and refreshes the visualization.
   */
  public setPlateDisplayMode(mode: PlateDisplayMode): void {
    this.plateDisplayMode = mode;
    this.refreshPlateDisplay();
  }

  /**
   * Gets the current plate display mode.
   */
  public getPlateDisplayMode(): PlateDisplayMode {
    return this.plateDisplayMode;
  }

  /**
   * Refreshes the plate visualization based on the current display mode.
   */
  public refreshPlateDisplay(): void {
    // Noise display takes highest priority when enabled
    if (this.checkNoiseDisplayEnabled && this.checkNoiseDisplayEnabled()) {
      if (this.applyNoiseColors) {
        this.applyNoiseColors();
      }
      return;
    }

    // Geology display takes priority when enabled
    if (this.geologyDisplayEnabled) {
      this.colorTectonicSystemByGeology();
      return;
    }

    if (this.plateDisplayMode === PlateDisplayMode.CATEGORY) {
      this.colorTectonicSystemByCategory();
    } else {
      this.colorTectonicSystem(false);
    }
  }

  /**
   * Sets whether geology display is enabled and refreshes visualization.
   */
  public setGeologyDisplayEnabled(enabled: boolean): void {
    this.geologyDisplayEnabled = enabled;
    this.refreshPlateDisplay();
  }

  /**
   * Gets whether geology display is enabled.
   */
  public isGeologyDisplayEnabled(): boolean {
    return this.geologyDisplayEnabled;
  }

  /**
   * Rebuilds the tectonic plate system with the specified number of plates.
   */
  public rebuildTectonicPlates(numPlates: number = 25): void {
    const dualMesh = this.visualizationManager.getDualMesh();
    const icoHalfedgeDualGraph = this.visualizationManager.getIcoHalfedgeDualGraph();

    if (!dualMesh) {
      console.warn('No dual mesh available for tectonic plates.');
      return;
    }

    if (this.tectonicSystem) {
      console.log("Clear old tectonic plates.");
      this.tectonicSystem.clear();
      for (const faceIndex of dualMesh.geometry.userData.face2HalfedgeMap.keys()) {
        // reset color to white
        assignColorToTriangle(dualMesh.geometry, faceIndex, new THREE.Color(1, 1, 1));
      }
    }

    this.tectonicSystem = buildTectonicSystem(icoHalfedgeDualGraph, numPlates);

    // Compute motion first (needed for boundary characterization)
    computeTectonicMotion(this.tectonicSystem);

    // Compute net rotation after motion to verify zero net rotation
    const { netRotation } = computeNetRotation(this.tectonicSystem.plates);
    this.netRotation = netRotation;

    // Compute and characterize boundaries (needed for plate categorization)
    computePlateBoundaries(this.tectonicSystem);
    caracterizePlateBoundaries(this.tectonicSystem);

    // Categorize plates after boundaries are known (uses divergent edge info)
    categorizePlates(this.tectonicSystem);

    // Compute convergent dominance after plate categories are assigned
    computeBoundaryDominance(this.tectonicSystem);

    // Create microplates at transform boundary bends
    createMicroplates(this.tectonicSystem);

    // Assign geological types to tiles (orogeny at convergent boundaries)
    assignGeologicalTypes(this.tectonicSystem);

    console.log('Generated tectonic network with', this.tectonicSystem.plates.size, 'plates.');
    this.refreshPlateDisplay();

    // Update motion vector visualization
    const scene = this.sceneManager.getScene();
    const motionVecLines = this.visualizationManager.getMotionVecLines();

    let rotation: THREE.Euler | null = null;
    if (motionVecLines) {
      rotation = motionVecLines.rotation.clone();
      scene.remove(motionVecLines);
    }

    makeLineSegments2ForTileMotionVec(this.tectonicSystem, motionVecLines);

    if (rotation) {
      motionVecLines.rotation.copy(rotation);
    }

    scene.add(motionVecLines);

    // Update all boundaries visualization (colored by type)
    const allBoundariesLines = this.visualizationManager.getAllBoundariesLines();

    if (allBoundariesLines) {
      rotation = allBoundariesLines.rotation.clone();
      scene.remove(allBoundariesLines);
    }

    makeLineSegments2ForAllBoundariesByType(this.tectonicSystem, allBoundariesLines, false);

    if (rotation) {
      allBoundariesLines.rotation.copy(rotation);
    }

    scene.add(allBoundariesLines);

    // Update dominance indicators visualization
    const dominanceIndicatorsLines = this.visualizationManager.getDominanceIndicatorsLines();

    if (dominanceIndicatorsLines) {
      scene.remove(dominanceIndicatorsLines);
    }

    makeLineSegments2ForDominanceIndicators(this.tectonicSystem, dominanceIndicatorsLines);

    // Copy rotation from allBoundariesLines to keep in sync
    if (allBoundariesLines) {
      dominanceIndicatorsLines.rotation.copy(allBoundariesLines.rotation);
    }

    scene.add(dominanceIndicatorsLines);

    // Update transform slide indicators visualization
    const transformSlideLines = this.visualizationManager.getTransformSlideLines();

    if (transformSlideLines) {
      scene.remove(transformSlideLines);
    }

    makeLineSegments2ForTransformSlideIndicators(this.tectonicSystem, transformSlideLines);

    // Copy rotation from allBoundariesLines to keep in sync
    if (allBoundariesLines) {
      transformSlideLines.rotation.copy(allBoundariesLines.rotation);
    }

    scene.add(transformSlideLines);
  }

  /**
   * Refreshes all boundaries visualization with the specified display mode.
   * @param mode The display mode: 'rawType', 'refinedType', or 'iteration'
   */
  public refreshAllBoundariesDisplay(mode: string): void {
    if (!this.tectonicSystem) {
      return;
    }

    const scene = this.sceneManager.getScene();
    const allBoundariesLines = this.visualizationManager.getAllBoundariesLines();

    let rotation: THREE.Euler | null = null;
    if (allBoundariesLines) {
      rotation = allBoundariesLines.rotation.clone();
      scene.remove(allBoundariesLines);
    }

    if (mode === 'iteration') {
      // Edge Order mode: show gradient coloring on all boundaries
      makeLineSegments2ForAllBoundariesGradient(this.tectonicSystem, allBoundariesLines);
    } else {
      const useRawType = mode === 'rawType';
      makeLineSegments2ForAllBoundariesByType(this.tectonicSystem, allBoundariesLines, useRawType);
    }

    if (rotation) {
      allBoundariesLines.rotation.copy(rotation);
    }

    scene.add(allBoundariesLines);

    // Also refresh dominance indicators
    const dominanceIndicatorsLines = this.visualizationManager.getDominanceIndicatorsLines();

    if (dominanceIndicatorsLines) {
      scene.remove(dominanceIndicatorsLines);
    }

    makeLineSegments2ForDominanceIndicators(this.tectonicSystem, dominanceIndicatorsLines);

    // Copy rotation from allBoundariesLines to keep in sync
    if (allBoundariesLines) {
      dominanceIndicatorsLines.rotation.copy(allBoundariesLines.rotation);
    }

    scene.add(dominanceIndicatorsLines);

    // Also refresh transform slide indicators
    const transformSlideLines = this.visualizationManager.getTransformSlideLines();

    if (transformSlideLines) {
      scene.remove(transformSlideLines);
    }

    makeLineSegments2ForTransformSlideIndicators(this.tectonicSystem, transformSlideLines);

    // Copy rotation from allBoundariesLines to keep in sync
    if (allBoundariesLines) {
      transformSlideLines.rotation.copy(allBoundariesLines.rotation);
    }

    scene.add(transformSlideLines);
  }

  /**
   * Colors the tectonic system by assigning colors to each plate.
   */
  public colorTectonicSystem(reset: boolean = false): void {
    const dualMesh = this.visualizationManager.getDualMesh();

    if (!dualMesh) {
      console.warn('No dual mesh available for coloring tectonic plates.');
      return;
    }

    if (!this.tectonicSystem) {
      console.warn('No tectonic plate system available.');
      return;
    }

    const resetColor = new THREE.Color(1, 1, 1);

    for (const plate of this.tectonicSystem.plates) {
      // Assign a random color to the plate given the id
      const plateColor = reset ? resetColor : idToHSLColor(plate.id);

      for (const tile of plate.tiles) {
        for (const auxHe of tile.loop()) {
          const origFaceIdx = dualMesh.geometry.userData.halfedge2FaceMap.get(auxHe.id);
          // origFaceIdx might be zero
          // so we need to check for undefined
          if (origFaceIdx !== undefined) {
            assignColorToTriangle(dualMesh.geometry, origFaceIdx, plateColor);
          } else {
            console.warn('No face found for halfedge id:', auxHe.id);
          }
        }
      }
    }
  }

  /**
   * Colors the tectonic system by plate category (continental/oceanic/microplate).
   */
  public colorTectonicSystemByCategory(): void {
    const dualMesh = this.visualizationManager.getDualMesh();

    if (!dualMesh) {
      console.warn('No dual mesh available for coloring tectonic plates.');
      return;
    }

    if (!this.tectonicSystem) {
      console.warn('No tectonic plate system available.');
      return;
    }

    for (const plate of this.tectonicSystem.plates) {
      const [r, g, b] = getPlateColor(plate);
      const plateColor = new THREE.Color(r, g, b);

      for (const tile of plate.tiles) {
        for (const auxHe of tile.loop()) {
          const origFaceIdx = dualMesh.geometry.userData.halfedge2FaceMap.get(auxHe.id);
          if (origFaceIdx !== undefined) {
            assignColorToTriangle(dualMesh.geometry, origFaceIdx, plateColor);
          } else {
            console.warn('No face found for halfedge id:', auxHe.id);
          }
        }
      }
    }
  }

  /**
   * Colors the tectonic system by geological type and intensity.
   * Uses intensity-based alpha blending for visual distinction.
   */
  public colorTectonicSystemByGeology(): void {
    const dualMesh = this.visualizationManager.getDualMesh();

    if (!dualMesh) {
      console.warn('No dual mesh available for coloring geological types.');
      return;
    }

    if (!this.tectonicSystem) {
      console.warn('No tectonic plate system available.');
      return;
    }

    for (const plate of this.tectonicSystem.plates) {
      for (const tile of plate.tiles) {
        const [r, g, b] = getGeologicalColor(tile.geologicalType, tile.geologicalIntensity);
        const geoColor = new THREE.Color(r, g, b);

        for (const auxHe of tile.loop()) {
          const origFaceIdx = dualMesh.geometry.userData.halfedge2FaceMap.get(auxHe.id);
          if (origFaceIdx !== undefined) {
            assignColorToTriangle(dualMesh.geometry, origFaceIdx, geoColor);
          } else {
            console.warn('No face found for halfedge id:', auxHe.id);
          }
        }
      }
    }
  }

  /**
   * Shows border tiles by coloring them, all other tiles are white.
   */
  public showBorderTiles(): void {
    const dualMesh = this.visualizationManager.getDualMesh();

    if (!dualMesh) {
      console.warn('No dual mesh available.');
      return;
    }

    if (!this.tectonicSystem) {
      console.warn('No tectonic plate system available.');
      return;
    }

    const whiteColor = new THREE.Color(1, 1, 1);
    const borderColor = new THREE.Color(1, 0, 0);

    // First reset all tiles to white
    for (const plate of this.tectonicSystem.plates) {
      for (const tile of plate.tiles) {
        for (const auxHe of tile.loop()) {
          const origFaceIdx = dualMesh.geometry.userData.halfedge2FaceMap.get(auxHe.id);
          if (origFaceIdx !== undefined) {
            assignColorToTriangle(dualMesh.geometry, origFaceIdx, whiteColor);
          }
        }
      }
    }

    // Then color border tiles
    let totalBorderTiles = 0;
    for (const plate of this.tectonicSystem.plates) {
      let plateBorderTileCount = 0;
      for (const borderTile of plate.iterBorderTiles()) {
        plateBorderTileCount++;
        for (const auxHe of borderTile.loop()) {
          const origFaceIdx = dualMesh.geometry.userData.halfedge2FaceMap.get(auxHe.id);
          if (origFaceIdx !== undefined) {
            assignColorToTriangle(dualMesh.geometry, origFaceIdx, borderColor);
          }
        }
      }
      console.log("Plate", plate.id, "has", plateBorderTileCount, "border tiles out of", plate.tiles.size, "tiles");
      totalBorderTiles += plateBorderTileCount;
    }
    console.log("Total border tiles:", totalBorderTiles);
  }

  /**
   * Finds the tile corresponding to a halfedge.
   */
  public findTileFromEdge(he: Halfedge) {
    if (!this.tectonicSystem) {
      return null;
    }
    return this.tectonicSystem.findTileFromEdge(he);
  }

  /**
   * Splits a plate at the given halfedge.
   */
  public splitPlateAtEdge(he: Halfedge): void {
    if (!this.tectonicSystem) {
      console.warn('No tectonic plates available.');
      return;
    }

    const tile = this.tectonicSystem.findTileFromEdge(he);

    if (!tile) {
      console.warn('No tile found for the clicked halfedge.');
      return;
    }

    splitPlateFromTile(this.tectonicSystem, tile);
  }

  /**
   * Transfers a tile to an adjacent plate at the given halfedge.
   */
  public transferTileAtEdge(he: Halfedge): void {
    if (!this.tectonicSystem) {
      console.warn('No tectonic plates available.');
      return;
    }

    const tile = this.tectonicSystem.findTileFromEdge(he);
    if (!tile) {
      console.warn('No tile found for the clicked halfedge.');
      return;
    }

    const currentPlate = tile.plate;

    const heTwin = he.twin;
    const twinTile = this.tectonicSystem.edge2TileMap.get(heTwin);
    const targetPlate = twinTile ? twinTile.plate : null;
    if (targetPlate === currentPlate || targetPlate === null) {
      console.warn('The adjacent tile belongs to the same plate. Cannot transfer tile.');
      return;
    }

    transferTileToPlate(tile, targetPlate);
  }

  /**
   * Absorbs a plate from an adjacent plate at the given halfedge.
   */
  public absorbPlateFromEdge(he: Halfedge): void {
    if (!this.tectonicSystem) {
      console.warn('No tectonic plates available.');
      return;
    }

    const tile = this.tectonicSystem.findTileFromEdge(he);
    if (!tile) {
      console.warn('No tile found for the clicked halfedge.');
      return;
    }

    const currentPlate = tile.plate;

    // Loop on all the tile border edges to find an adjacent plate
    let targetPlate = null;
    for (const he of tile.loop()) {
      const twinHe = he.twin;

      const twinTile = this.tectonicSystem.edge2TileMap.get(twinHe);
      const candidatePlate = twinTile ? twinTile.plate : null;
      if (candidatePlate === currentPlate || candidatePlate === null) {
        continue;
      }

      targetPlate = candidatePlate;
      break;
    }

    if (!targetPlate) {
      console.warn('No adjacent plate found to absorb the current plate.');
      return;
    }

    console.log("Absorbing plate", currentPlate.id, "into plate", targetPlate.id);

    plateAbsorbedByPlate(currentPlate, targetPlate);
  }

  /**
   * Clears the tectonic system.
   */
  public clear(): void {
    if (this.tectonicSystem) {
      this.tectonicSystem.clear();
      this.tectonicSystem = null;
    }
  }

  /**
   * Gets the current tectonic system.
   */
  public getTectonicSystem(): TectonicSystem | null {
    return this.tectonicSystem;
  }

  /**
   * Gets the net rotation vector (should be near zero after correction).
   */
  public getNetRotation(): THREE.Vector3 {
    return this.netRotation;
  }

  /**
   * Checks and logs if a tile at the given halfedge is eligible for transfer to dominant plate.
   */
  public checkTileTransferEligibility(he: Halfedge): void {
    if (!this.tectonicSystem) {
      console.warn('No tectonic plates available.');
      return;
    }

    const tile = this.tectonicSystem.findTileFromEdge(he);
    if (!tile) {
      console.warn('No tile found for the clicked halfedge.');
      return;
    }

    logTileTransferEligibility(tile, this.tectonicSystem);
  }

  /**
   * Sets the recompute orogeny mode.
   */
  public setRecomputeOrogenyMode(enabled: boolean): void {
    this.recomputeOrogenyMode = enabled;
  }

  /**
   * Gets the recompute orogeny mode.
   */
  public isRecomputeOrogenyMode(): boolean {
    return this.recomputeOrogenyMode;
  }

  /**
   * Recomputes orogeny for a specific boundary when clicked.
   * Resets geology for both plates and recomputes orogeny propagation.
   * Returns true if orogeny was recomputed, false otherwise.
   */
  public recomputeOrogenyAtBoundary(he: Halfedge): boolean {
    if (!this.recomputeOrogenyMode) {
      return false;
    }

    if (!this.tectonicSystem) {
      console.warn('[Recompute Orogeny] No tectonic plates available.');
      return false;
    }

    // Find the boundary for this halfedge
    const boundary = this.tectonicSystem.edge2BoundaryMap.get(he);
    if (!boundary) {
      console.log('[Recompute Orogeny] Clicked tile is not on a boundary.');
      return false;
    }

    // Check if boundary has convergent edges
    let hasConvergent = false;
    for (const bEdge of boundary.boundaryEdges) {
      if (bEdge.refinedType === BoundaryType.CONVERGENT) {
        hasConvergent = true;
        break;
      }
    }

    if (!hasConvergent) {
      console.log('[Recompute Orogeny] Boundary is not convergent.');
      return false;
    }

    const plateA = boundary.plateA;
    const plateB = boundary.plateB;

    console.log(`[Recompute Orogeny] Recomputing orogeny for boundary between plate ${plateA.id} (${plateA.category}) and plate ${plateB.id} (${plateB.category})`);

    // Reset geology for all tiles in both plates
    for (const tile of plateA.tiles) {
      tile.geologicalType = GeologicalType.UNKNOWN;
      tile.geologicalIntensity = GeologicalIntensity.NONE;
    }
    for (const tile of plateB.tiles) {
      tile.geologicalType = GeologicalType.UNKNOWN;
      tile.geologicalIntensity = GeologicalIntensity.NONE;
    }

    // Recompute orogeny for this boundary using Perlin noise-based approach
    const assignedCount = recomputeOrogenyForBoundary(boundary, this.tectonicSystem);
    console.log(`[Recompute Orogeny] Assigned orogeny to ${assignedCount} tiles`);

    // Refresh display
    this.refreshPlateDisplay();

    return true;
  }
}
