import { GeologicalType, GeologicalIntensity, TectonicSystem } from '../data/Plate';
import {
  assignOrogenyType,
  assignAncientOrogenyZones,
  PROPAGATION_CONFIG
} from './Orogeny';
import { assignShieldZones } from './Shield';
import { assignOceanicCrustType } from './OceanicCrust';
import { assignForelandBasins, assignRiftBasins, assignIntracratonicBasins } from './Basin';
import { assignIgneousProvinces } from './IgneousProvince';

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Assigns geological types to all tiles in the tectonic system.
 * Order matters - earlier types block later propagation.
 * Handles:
 * 1. Active orogeny at convergent boundaries
 * 2. Igneous provinces (LIPs) - blocks oceanic crust propagation
 * 3. Oceanic crust at oceanic/continental divergent boundaries
 * 4. Foreland basins behind orogeny at convergent boundaries
 * 5. Rift basins at continental/continental divergent boundaries
 * 6. Ancient orogeny zones (remnants of former mountain belts)
 * 7. Shield zones (ancient cratonic cores)
 * 8. Intracratonic basins within shield/platform regions
 */
function assignGeologicalTypes(tectonicSystem: TectonicSystem): void {
  // Reset all tiles
  for (const plate of tectonicSystem.plates) {
    for (const tile of plate.tiles) {
      tile.geologicalType = GeologicalType.UNKNOWN;
      tile.geologicalIntensity = GeologicalIntensity.NONE;
    }
  }

  // Assign active orogeny at convergent boundaries
  assignOrogenyType(tectonicSystem);

  // Assign igneous provinces (LIPs) - must be before oceanic crust so propagation stops at LIPs
  assignIgneousProvinces(tectonicSystem);

  // Assign oceanic crust at oceanic/continental divergent boundaries
  // Propagation stops when meeting igneous provinces or other assigned types
  assignOceanicCrustType(tectonicSystem);

  // Assign foreland basins behind orogeny at convergent boundaries (Case 1)
  assignForelandBasins(tectonicSystem);

  // Assign rift basins at continental/continental divergent boundaries (Case 2)
  assignRiftBasins(tectonicSystem);

  // Assign ancient orogeny zones
  assignAncientOrogenyZones(tectonicSystem);

  // Assign shield zones (ancient cratonic cores)
  assignShieldZones(tectonicSystem);

  // Assign intracratonic basins within shield/platform regions (Case 3)
  assignIntracratonicBasins(tectonicSystem);
}

// Re-export for backward compatibility
export {
  assignGeologicalTypes,
  assignOrogenyType,
  PROPAGATION_CONFIG
};
