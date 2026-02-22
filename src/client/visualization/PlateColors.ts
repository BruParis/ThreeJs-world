import { Plate, PlateCategory } from '../tectonics/data/Plate';

/**
 * Hardcoded color constants for plate category visualization.
 * Colors are stored as RGB arrays [r, g, b] with values in range [0, 1].
 */
export const PLATE_CATEGORY_COLORS: Record<PlateCategory, [number, number, number]> = {
  [PlateCategory.CONTINENTAL]: [1.0, 0.8, 0.4],    // Light orange
  [PlateCategory.OCEANIC]: [0.05, 0.10, 0.70],     // Marine blue
  [PlateCategory.UNKNOWN]: [1.0, 1.0, 1.0],        // White
};

/**
 * Color for microplates (slightly different from continental).
 * A warmer, slightly darker orange to distinguish from regular continental.
 */
export const MICROPLATE_COLOR: [number, number, number] = [0.95, 0.65, 0.30];

/**
 * Gets the display color for a plate, considering both category and microplate status.
 */
export function getPlateColor(plate: Plate): [number, number, number] {
  if (plate.isMicroplate) {
    return MICROPLATE_COLOR;
  }
  return PLATE_CATEGORY_COLORS[plate.category];
}

/**
 * Converts RGB [0,1] to hex color for dat.gui.
 */
export function plateCategoryColorToHex(category: PlateCategory): number {
  const [r, g, b] = PLATE_CATEGORY_COLORS[category];
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

/**
 * Converts RGB [0,1] array to hex color for dat.gui.
 */
export function rgbToHex(rgb: [number, number, number]): number {
  const [r, g, b] = rgb;
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

/**
 * Legend entry type for plate visualization.
 * Includes both category-based and microplate entries.
 */
export interface PlateVisualizationLegendEntry {
  label: string;
  color: [number, number, number];
}

/**
 * Legend entries for dat.gui display.
 * Includes plate categories and microplate distinction.
 */
export const PLATE_VISUALIZATION_LEGEND: PlateVisualizationLegendEntry[] = [
  { label: 'Continental', color: PLATE_CATEGORY_COLORS[PlateCategory.CONTINENTAL] },
  { label: 'Oceanic', color: PLATE_CATEGORY_COLORS[PlateCategory.OCEANIC] },
  { label: 'Microplate', color: MICROPLATE_COLOR },
];

/**
 * @deprecated Use PLATE_VISUALIZATION_LEGEND instead
 * Legacy legend entries for dat.gui display.
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
