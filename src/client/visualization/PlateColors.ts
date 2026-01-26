import { PlateCategory } from '../tectonics/data/Plate';

/**
 * Hardcoded color constants for plate category visualization.
 * Colors are stored as RGB arrays [r, g, b] with values in range [0, 1].
 */
export const PLATE_CATEGORY_COLORS: Record<PlateCategory, [number, number, number]> = {
  [PlateCategory.CONTINENTAL]: [1.0, 0.8, 0.4],    // Light orange
  [PlateCategory.OCEANIC]: [0.05, 0.10, 0.70],      // Marine blue
  [PlateCategory.MICROPLATE]: [0.6, 0.6, 0.6],     // Gray
  [PlateCategory.DEFORMATION]: [0.8, 0.2, 0.8],    // Purple
  [PlateCategory.UNKNOWN]: [1.0, 1.0, 1.0],        // White
};

/**
 * Converts RGB [0,1] to hex color for dat.gui.
 */
export function plateCategoryColorToHex(category: PlateCategory): number {
  const [r, g, b] = PLATE_CATEGORY_COLORS[category];
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

/**
 * Legend entries for dat.gui display.
 * Maps display label to plate category.
 */
export const PLATE_CATEGORY_LEGEND: { label: string; category: PlateCategory }[] = [
  { label: 'Continental', category: PlateCategory.CONTINENTAL },
  { label: 'Oceanic', category: PlateCategory.OCEANIC },
];

/**
 * Plate display modes for the GUI.
 */
export enum PlateDisplayMode {
  NONE = 'none',
  CATEGORY = 'category',
}
