import * as THREE from 'three';
import { TectonicSystem } from '../tectonics/data/Plate';
import { Halfedge } from '@core/Halfedge';
import {
  buildTectonicSystem,
  computeTectonicMotion,
  computePlateBoundaries,
  caracterizePlateBoundaries,
  logTileTransferEligibility
} from '../tectonics/simulation/Tectonics';
import {
  splitPlateFromTile,
  transferTileToPlate,
  plateAbsorbedByPlate,
} from '../tectonics/data/PlateOperations';
import { makeLineSegments2ForTileMotionVec } from '../visualization/TectonicsDrawingUtils';
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

  constructor(visualizationManager: VisualizationManager, sceneManager: SceneManager) {
    this.visualizationManager = visualizationManager;
    this.sceneManager = sceneManager;
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

    computeTectonicMotion(this.tectonicSystem);

    computePlateBoundaries(this.tectonicSystem);
    caracterizePlateBoundaries(this.tectonicSystem);

    console.log('Generated tectonic network with', this.tectonicSystem.plates.size, 'plates.');
    this.colorTectonicSystem();

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
}
