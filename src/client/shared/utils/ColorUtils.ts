import * as THREE from 'three';

/**
 * Generates a deterministic HSL color based on an ID.
 * Uses a simple hash to produce consistent colors for the same ID.
 */
export function idToHSLColor(id: number): THREE.Color {
  const hash = id * 0x1010101;
  const hue = (hash % 360) / 360; // Hue in [0, 1]
  const saturation = 0.7; // Fixed saturation for vivid colors
  const lightness = 0.5; // Fixed lightness
  return new THREE.Color().setHSL(hue, saturation, lightness);
}

/**
 * Assigns a color to a specific vertex in a BufferGeometry.
 */
export function assignColorToVertex(geometry: THREE.BufferGeometry, vertexIndex: number, color: THREE.Color) {
  if (!geometry.attributes.color) return;

  const colors = geometry.attributes.color as THREE.BufferAttribute;

  colors.setXYZ(vertexIndex, color.r, color.g, color.b);
  colors.needsUpdate = true;
}

/**
 * Assigns a color to all three vertices of a triangle face in a BufferGeometry.
 */
export function assignColorToTriangle(geometry: THREE.BufferGeometry, faceIndex: number, color: THREE.Color) {
  const indexAttr = geometry.index;
  if (!indexAttr) return;

  const vertexIndexA = indexAttr.getX(faceIndex * 3);
  const vertexIndexB = indexAttr.getX(faceIndex * 3 + 1);
  const vertexIndexC = indexAttr.getX(faceIndex * 3 + 2);

  assignColorToVertex(geometry, vertexIndexA, color);
  assignColorToVertex(geometry, vertexIndexB, color);
  assignColorToVertex(geometry, vertexIndexC, color);
}
