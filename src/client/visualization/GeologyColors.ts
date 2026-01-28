import { GeologicalType, GeologicalIntensity } from '../tectonics/data/Plate';

/**
 * Base color constants for geological type visualization.
 * Colors are stored as RGB arrays [r, g, b] with values in range [0, 1].
 */
export const GEOLOGICAL_TYPE_BASE_COLORS: Record<GeologicalType, [number, number, number]> = {
  [GeologicalType.UNKNOWN]: [0.5, 0.5, 0.5],           // Grey
  [GeologicalType.SHIELD]: [0.5, 0.5, 0.5],            // Grey (default)
  [GeologicalType.PLATFORM]: [0.5, 0.5, 0.5],          // Grey (default)
  [GeologicalType.OROGEN]: [0.0, 1.0, 1.0],            // Cyan
  [GeologicalType.BASIN]: [0.5, 0.5, 0.5],             // Grey (default)
  [GeologicalType.MAGMATIC]: [0.5, 0.5, 0.5],          // Grey (default)
  [GeologicalType.EXTENDED_CRUST]: [0.5, 0.5, 0.5],    // Grey (default)
  [GeologicalType.OCEANIC_CRUST]: [0.5, 0.5, 0.5],     // Grey (default)
  [GeologicalType.OCEANIC_RIDGE]: [0.5, 0.5, 0.5],     // Grey (default)
  [GeologicalType.OCEANIC_PLATEAU]: [0.5, 0.5, 0.5],   // Grey (default)
};

/**
 * Alpha (opacity) values for geological intensity levels.
 * Used for simulated transparency by blending with background.
 * Higher intensity = more opaque (higher alpha).
 */
export const GEOLOGICAL_INTENSITY_ALPHA: Record<GeologicalIntensity, number> = {
  [GeologicalIntensity.NONE]: 0.0,
  [GeologicalIntensity.ANCIENT]: 0.15,
  [GeologicalIntensity.VERY_LOW]: 0.25,
  [GeologicalIntensity.LOW]: 0.4,
  [GeologicalIntensity.MODERATE]: 0.55,
  [GeologicalIntensity.HIGH]: 0.75,
  [GeologicalIntensity.VERY_HIGH]: 1.0,
};

/** Background color for alpha blending (grey) */
const BACKGROUND_COLOR: [number, number, number] = [0.5, 0.5, 0.5];

/**
 * Blends a foreground color with background using alpha.
 * result = alpha * foreground + (1 - alpha) * background
 */
export function blendColorWithAlpha(
  foreground: [number, number, number],
  alpha: number,
  background: [number, number, number] = BACKGROUND_COLOR
): [number, number, number] {
  return [
    alpha * foreground[0] + (1 - alpha) * background[0],
    alpha * foreground[1] + (1 - alpha) * background[1],
    alpha * foreground[2] + (1 - alpha) * background[2],
  ];
}

/**
 * Gets the final blended color for a geological type with intensity.
 * Uses intensity to determine alpha, then blends with background.
 */
export function getGeologicalColor(
  type: GeologicalType,
  intensity: GeologicalIntensity
): [number, number, number] {
  const baseColor = GEOLOGICAL_TYPE_BASE_COLORS[type];
  const alpha = GEOLOGICAL_INTENSITY_ALPHA[intensity];
  return blendColorWithAlpha(baseColor, alpha);
}

/**
 * Gets the final blended color for a geological type (legacy, uses default alpha).
 * For types without intensity, uses full opacity.
 */
export function getGeologicalTypeColor(type: GeologicalType): [number, number, number] {
  // For non-OROGEN types, return the base color directly
  if (type !== GeologicalType.OROGEN) {
    return GEOLOGICAL_TYPE_BASE_COLORS[type];
  }
  // For OROGEN without intensity specified, use MODERATE as default
  return getGeologicalColor(type, GeologicalIntensity.MODERATE);
}

/**
 * Converts geological type and intensity to hex color for dat.gui.
 */
export function geologicalIntensityColorToHex(
  type: GeologicalType,
  intensity: GeologicalIntensity
): number {
  const [r, g, b] = getGeologicalColor(type, intensity);
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

/**
 * Legend entries for dat.gui display.
 * Shows intensity levels for orogen visualization.
 */
export const GEOLOGICAL_INTENSITY_LEGEND: { label: string; intensity: GeologicalIntensity }[] = [
  { label: 'Very High', intensity: GeologicalIntensity.VERY_HIGH },
  { label: 'High', intensity: GeologicalIntensity.HIGH },
  { label: 'Moderate', intensity: GeologicalIntensity.MODERATE },
  { label: 'Low', intensity: GeologicalIntensity.LOW },
  { label: 'Very Low', intensity: GeologicalIntensity.VERY_LOW },
  { label: 'Ancient', intensity: GeologicalIntensity.ANCIENT },
  { label: 'None', intensity: GeologicalIntensity.NONE },
];
