/**
 * Flat water surface — MeshPhysicalMaterial driven by scene lighting.
 *
 * Positioned at Y = TERRAIN_SEA_LEVEL (0.35), fixed regardless of elevation
 * offset. Proof: terrain at the sea-level boundary always lands at world Y =
 * (seaLevel - elevOffset) + elevOffset = seaLevel = 0.35.
 *
 * Three.js's standard PBR pipeline handles sun specular automatically via the
 * scene's DirectionalLight — no manual uniform sync is needed.
 * setSunDirection / setSunColor are kept as no-ops so the GUI call-sites
 * don't need to change when swapping materials.
 *
 * update() is called every frame but is currently a no-op; keep it in place
 * for wave animation later (e.g. a custom vertex displacement or normal-map scroll).
 */

import * as THREE from 'three';
import { TERRAIN_SEA_LEVEL } from '@core/shaders/terrainVertexGLSL';

export class WaterMesh {
  private readonly _mesh: THREE.Mesh;

  constructor(scene: THREE.Scene, size: number, _sunLight: THREE.DirectionalLight) {
    const geo = new THREE.PlaneGeometry(size * 2, size * 2);
    const mat = new THREE.MeshPhysicalMaterial({
      color:       new THREE.Color(0x003d6b),
      transparent: true,
      opacity:     0.82,
      roughness:   0.04,
      metalness:   0.08,
      side:        THREE.FrontSide,
    });

    this._mesh          = new THREE.Mesh(geo, mat);
    this._mesh.rotation.x = -Math.PI / 2;
    this._mesh.position.y = TERRAIN_SEA_LEVEL;
    scene.add(this._mesh);
  }

  get mesh(): THREE.Mesh { return this._mesh; }

  // No-op — PBR lighting is automatic via the scene's DirectionalLight.
  setSunDirection(_position: THREE.Vector3): void {}
  setSunColor(_color: THREE.Color): void {}

  // Reserved for wave animation (normal-map scroll, vertex displacement, etc.).
  update(_dt: number, _eye: THREE.Vector3): void {}

  dispose(): void {
    this._mesh.geometry.dispose();
    (this._mesh.material as THREE.Material).dispose();
    this._mesh.removeFromParent();
  }
}
