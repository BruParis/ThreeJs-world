import { Tile, Plate, TectonicSystem, GeologicalType } from '../data/Plate';

// ============================================================================
// Statistics Helper Functions
// ============================================================================

/**
 * Gets the decile index (0-9) for a motion amplitude based on motion statistics.
 * Returns 0 for lowest motion, 9 for highest.
 */
export function getMotionDecile(amplitude: number, tectonicSystem: TectonicSystem): number {
  const stats = tectonicSystem.motionStatistics;
  if (!stats || stats.deciles.length === 0) {
    return 5; // Default to middle if no stats
  }

  for (let i = 0; i < stats.deciles.length; i++) {
    if (amplitude <= stats.deciles[i]) {
      return i;
    }
  }
  return 9; // Above 90th percentile
}

/**
 * Gets the decile index (0-9) for a plate area based on area statistics.
 * Returns 0 for smallest plates, 9 for largest.
 */
export function getAreaDecile(plateArea: number, tectonicSystem: TectonicSystem): number {
  const stats = tectonicSystem.plateAreaStatistics;
  if (!stats || stats.deciles.length === 0) {
    return 5; // Default to middle if no stats
  }

  for (let i = 0; i < stats.deciles.length; i++) {
    if (plateArea <= stats.deciles[i]) {
      return i;
    }
  }
  return 9; // Above 90th percentile
}

// ============================================================================
// Tile Helper Functions
// ============================================================================

/**
 * Finds neighbor tiles within the same plate.
 */
export function getNeighborTilesInPlate(tile: Tile, tectonicSystem: TectonicSystem): Tile[] {
  const neighbors: Tile[] = [];
  const plate = tile.plate;

  for (const he of tile.loop()) {
    const twinTile = tectonicSystem.edge2TileMap.get(he.twin);
    if (twinTile && twinTile.plate === plate && twinTile !== tile) {
      neighbors.push(twinTile);
    }
  }

  return neighbors;
}

/**
 * Gets unassigned tiles from a plate (tiles with UNKNOWN geological type).
 */
export function getUnassignedTiles(plate: Plate): Tile[] {
  const unassigned: Tile[] = [];
  for (const tile of plate.tiles) {
    if (tile.geologicalType === GeologicalType.UNKNOWN) {
      unassigned.push(tile);
    }
  }
  return unassigned;
}
