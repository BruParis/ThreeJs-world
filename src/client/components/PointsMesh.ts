import * as THREE from 'three';

export function createPointsGeometry(points: THREE.Vector3[]) {
    const geometry = new THREE.BufferGeometry();
    const vertices = new Float32Array(points.flatMap(point => [point.x, point.y, point.z]));
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    return geometry;
}
