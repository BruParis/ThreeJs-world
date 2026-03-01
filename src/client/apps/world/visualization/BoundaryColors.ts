import { BoundaryType } from '../tectonics/data/Plate';

/**
 * Hardcoded color constants for boundary type visualization.
 * Colors are stored as RGB arrays [r, g, b] with values in range [0, 1].
 */
export const BOUNDARY_COLORS: Record<BoundaryType, [number, number, number]> = {
  [BoundaryType.UNKNOWN]: [0, 0, 0],           // Black
  [BoundaryType.INACTIVE]: [0.6, 0.3, 0],      // Brown
  [BoundaryType.DIVERGENT]: [0, 0, 1],         // Blue
  [BoundaryType.CONVERGENT]: [1, 0, 0],        // Red
  [BoundaryType.TRANSFORM]: [0, 1, 0],         // Green
};

/**
 * Converts RGB [0,1] to hex color for dat.gui.
 */
export function boundaryColorToHex(type: BoundaryType): number {
  const [r, g, b] = BOUNDARY_COLORS[type];
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

/**
 * Legend entries for dat.gui display.
 * Maps display label to boundary type.
 */
export const BOUNDARY_LEGEND: { label: string; type: BoundaryType }[] = [
  { label: 'Convergent', type: BoundaryType.CONVERGENT },
  { label: 'Divergent', type: BoundaryType.DIVERGENT },
  { label: 'Transform', type: BoundaryType.TRANSFORM },
  { label: 'Inactive', type: BoundaryType.INACTIVE },
  { label: 'Unknown', type: BoundaryType.UNKNOWN },
];
