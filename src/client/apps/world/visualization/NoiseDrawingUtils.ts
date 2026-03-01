import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';

/**
 * Creates line segments for gradient vectors at specified positions.
 * @param gradients Map of position to gradient vector (should be in tangent plane for spheres)
 * @param lines The LineSegments2 object to populate
 * @param maxLength Maximum length for the gradient vectors
 * @param color RGB color array [r, g, b] with values in range [0, 1]
 */
export function makeLineSegments2ForGradients(
  gradients: Map<THREE.Vector3, THREE.Vector3>,
  lines: LineSegments2,
  maxLength: number = 0.05,
  color: [number, number, number] = [0.2, 0.5, 1.0]
): void {
  console.log("[Gradient Draw] Generating line segments for gradients...");
  const positions = new Array<number>();
  const colors = new Array<number>();

  const arrowHeadSize = maxLength * 0.15;
  // Height offset to lift arrows above the surface
  const heightOffset = maxLength * 0.1;

  for (const [position, gradient] of gradients) {
    const normal = position.clone().normalize();

    // Lift the origin above the sphere surface
    const originPos = position.clone().add(normal.clone().multiplyScalar(heightOffset));

    // Scale gradient to fit within maxLength
    const gradMagnitude = gradient.length();
    if (gradMagnitude < 0.0001) continue; // Skip near-zero gradients

    const scaledGradient = gradient.clone();
    if (gradMagnitude > 1) {
      scaledGradient.normalize();
    }
    scaledGradient.multiplyScalar(maxLength);

    const vStart = originPos.clone();
    const vEnd = originPos.clone().add(scaledGradient);

    positions.push(vStart.x, vStart.y, vStart.z);
    positions.push(vEnd.x, vEnd.y, vEnd.z);

    // Make a small arrow head
    const gradDir = scaledGradient.clone().normalize();
    const arrowBase = vEnd.clone().sub(gradDir.clone().multiplyScalar(arrowHeadSize));
    // Use the normal for orthogonal vectors to keep arrow head in tangent plane
    const orthogonalVec1 = new THREE.Vector3().crossVectors(gradDir, normal);
    if (orthogonalVec1.length() < 0.001) {
      orthogonalVec1.crossVectors(gradDir, new THREE.Vector3(1, 0, 0));
    }
    orthogonalVec1.normalize().multiplyScalar(arrowHeadSize * 0.5);
    const orthogonalVec2 = new THREE.Vector3().crossVectors(gradDir, orthogonalVec1).normalize().multiplyScalar(arrowHeadSize * 0.5);
    const arrowPoint1 = arrowBase.clone().add(orthogonalVec1);
    const arrowPoint2 = arrowBase.clone().sub(orthogonalVec1);
    const arrowPoint3 = arrowBase.clone().add(orthogonalVec2);

    positions.push(vEnd.x, vEnd.y, vEnd.z);
    positions.push(arrowPoint1.x, arrowPoint1.y, arrowPoint1.z);
    positions.push(vEnd.x, vEnd.y, vEnd.z);
    positions.push(arrowPoint2.x, arrowPoint2.y, arrowPoint2.z);
    positions.push(vEnd.x, vEnd.y, vEnd.z);
    positions.push(arrowPoint3.x, arrowPoint3.y, arrowPoint3.z);

    // Colors for all line segments (main line + 3 arrow head lines = 4 segments = 8 vertices)
    for (let i = 0; i < 8; i++) {
      colors.push(color[0], color[1], color[2]);
    }
  }

  console.log(`[Gradient Draw] Created ${positions.length / 6} line segments (${positions.length / 24} arrows)`);

  lines.geometry.dispose();
  lines.geometry = new LineSegmentsGeometry();
  lines.geometry.setPositions(positions);
  lines.geometry.setColors(colors);
  lines.computeLineDistances();
}
