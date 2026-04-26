/**
 * SuppNoiseGL
 *
 * GPU compute for the supplemental noise texture.
 * Renders a static FBM value-noise texture into a THREE.WebGLRenderTarget
 * using the main Three.js renderer.
 *
 * The GLSL shaders and the description of what the texture encodes live in
 * detailNoiseGLSL.ts, which is the shared contract between this producer
 * and the terrain fragment shader that consumes the texture.
 *
 * Call update(renderer) when the texture needs to be (re-)computed — it is a
 * no-op unless markDirty() has been called.  The .texture property is the
 * resulting THREE.Texture suitable for use as a sampler2D uniform.
 */

import * as THREE from 'three';
import { suppNoiseVert, suppNoiseFrag } from '@core/shaders/detailNoiseGLSL';

export class SuppNoiseGL {
  private readonly renderTarget: THREE.WebGLRenderTarget;
  private readonly material:     THREE.ShaderMaterial;
  private readonly scene:        THREE.Scene;
  private readonly camera:       THREE.OrthographicCamera;
  private dirty = true;

  constructor(size: number = 512) {
    this.renderTarget = new THREE.WebGLRenderTarget(size, size, {
      type:            THREE.FloatType,
      format:          THREE.RGBAFormat,
      minFilter:       THREE.LinearFilter,
      magFilter:       THREE.LinearFilter,
      generateMipmaps: false,
    });

    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uBufferSize:  { value: new THREE.Vector2(size, size) },
        uWorldOrigin: { value: new THREE.Vector2(-1.0, -1.0) },
        uWorldSize:   { value: 2.0 },
      },
      vertexShader:   suppNoiseVert,
      fragmentShader: suppNoiseFrag,
      depthTest:  false,
      depthWrite: false,
    });

    this.scene  = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
  }

  get texture(): THREE.Texture { return this.renderTarget.texture; }

  /** Mark the texture as needing a re-render on the next update() call. */
  markDirty(): void { this.dirty = true; }

  /**
   * Update the world-space coordinate range used when baking the noise.
   * Pass the same origin/size as the terrain patch so the texture is computed
   * in the same XZ coordinate space as the elevation noise.
   * Automatically marks the texture dirty.
   */
  setWorldParams(originX: number, originZ: number, worldSize: number): void {
    (this.material.uniforms.uWorldOrigin.value as THREE.Vector2).set(originX, originZ);
    this.material.uniforms.uWorldSize.value = worldSize;
    this.markDirty();
  }

  /**
   * Re-render the supplemental noise texture if dirty; no-op otherwise.
   * Call before the main scene render.
   */
  update(renderer: THREE.WebGLRenderer): void {
    if (!this.dirty) return;
    this.dirty = false;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.renderTarget);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prev);
  }

  dispose(): void {
    this.renderTarget.dispose();
    this.material.dispose();
    (this.scene.children[0] as THREE.Mesh).geometry.dispose();
  }
}
