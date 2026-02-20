import { GeologicalType, GeologicalIntensity, TectonicSystem } from '../data/Plate';
import {
  assignOrogenyType,
  assignAncientOrogenyZones,
  assignFoldAndThrustBelts,
  PROPAGATION_CONFIG
} from './Orogeny';
import { assignShieldZones } from './Shield';
import { assignOceanicCrustType } from './OceanicCrust';
import { assignForelandBasins, assignRiftBasins, assignIntracratonicBasins } from './Basin';
import { assignIgneousProvinces } from './IgneousProvince';
import { assignTransformGeology } from './TransformGeology';

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Assigns geological types to all tiles in the tectonic system.
 * Order matters - earlier types block later propagation.
 * Handles:
 * 1. Active orogeny at convergent boundaries
 * 2. Fold-and-thrust belts at the periphery of orogeny zones
 * 3. Igneous provinces (LIPs) - blocks oceanic crust propagation
 * 4. Oceanic crust at:
 *    - All oceanic plate tiles
 *    - Oceanic/continental divergent boundaries (propagates into continental)
 *    - Intra-continental divergent boundaries connecting to oceanic plates
 * 5. Transform boundary geology (pull-apart basins at releasing bends)
 * 6. Foreland basins behind orogeny at convergent boundaries
 * 7. Rift basins at continental/continental divergent boundaries
 * 8. Ancient orogeny zones (remnants of former mountain belts)
 * 9. Shield zones (ancient cratonic cores)
 * 10. Intracratonic basins within shield/platform regions
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

  // Assign fold-and-thrust belts at the periphery of orogeny zones
  // Must be called right after orogeny so peripheral tiles are still UNKNOWN
  assignFoldAndThrustBelts(tectonicSystem);

  // Assign oceanic crust at oceanic/continental divergent boundaries
  // Propagation stops when meeting igneous provinces or other assigned types
  assignOceanicCrustType(tectonicSystem);

  // Assign igneous provinces (LIPs) - must be before oceanic crust so propagation stops at LIPs
  assignIgneousProvinces(tectonicSystem);

  // Assign transform boundary geology (pull-apart basins at releasing bends)
  assignTransformGeology(tectonicSystem);

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
