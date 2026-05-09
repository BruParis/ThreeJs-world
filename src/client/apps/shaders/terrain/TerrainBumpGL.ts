/**
 * TerrainBumpGL
 *
 * GPU compute for the bump texture — a single-pass bake of two static noise
 * signals into one RGBA32F render target:
 *
 *   R, G : water-normal gradient (dx, dz) at uWaterNormalFreq, strength = 1.
 *          The rendering shader multiplies by uWaterNormalStrength at runtime
 *          so strength can be tuned without rebaking.
 *   B, A : tree-bump XZ simplex samples at uTreeBumpFreq.
 *          The rendering shader multiplies by uTreeBumpStrength at runtime.
 *
 * UV mapping is identical to the elevation and attribute textures:
 *   uv = (worldXZ + halfSize) / patchSize
 * so the rendering shader can sample with the same attrUV it already has.
 *
 * Call update(renderer) once per frame — it is a no-op unless markDirty() was
 * called.  Dirty is set automatically when setWorldParams() or setFrequencies()
 * detect a change.
 */

import * as THREE from 'three';
import { simplexNoiseGLSL } from '@core/noise/simplexGLSL';

const bumpNoiseVert = /* glsl */`
void main() {
  gl_Position = vec4(position, 1.0);
}
`;

const bumpNoiseFrag = /* glsl */`
precision highp float;

${simplexNoiseGLSL}

uniform vec2  uBufferSize;
uniform vec2  uWorldOrigin;   // bottom-left corner in world XZ (-halfSize, -halfSize)
uniform float uWorldSize;     // patchSize (world units covered by the texture)
uniform float uWaterNormalFreq;
uniform float uTreeBumpFreq;

out vec4 fragColor;

void main() {
  vec2 uv      = gl_FragCoord.xy / uBufferSize;
  vec2 worldXZ = uWorldOrigin + uv * uWorldSize;

  // ── Water normal gradient (finite differences, strength factor = 1) ──────
  // The rendering shader multiplies by uWaterNormalStrength, so bake raw gradient.
  vec2  pw  = worldXZ * uWaterNormalFreq;
  float eps = 0.3;
  #define _WFBM(p) (snoise(vec3(p,           0.0)) * 0.65 \
                  + snoise(vec3((p) * 2.13,   0.0)) * 0.35)
  float h0 = _WFBM(pw);
  float dx = (_WFBM(pw + vec2(eps, 0.0)) - h0) / eps;
  float dz = (_WFBM(pw + vec2(0.0, eps)) - h0) / eps;
  #undef _WFBM

  // ── Tree bump XZ ─────────────────────────────────────────────────────────
  vec2 pt = worldXZ * uTreeBumpFreq;
  float bx = snoise(vec3(pt, 0.0));
  float bz = snoise(vec3(pt, 1.7));

  fragColor = vec4(dx, dz, bx, bz);
}
`;

export class TerrainBumpGL {
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
      glslVersion:    THREE.GLSL3,
      uniforms: {
        uBufferSize:      { value: new THREE.Vector2(size, size) },
        uWorldOrigin:     { value: new THREE.Vector2(0.0, 0.0) },
        uWorldSize:       { value: 1.0 },
        uWaterNormalFreq: { value: 52.0 },
        uTreeBumpFreq:    { value: 80.0 },
      },
      vertexShader:   bumpNoiseVert,
      fragmentShader: bumpNoiseFrag,
      depthTest:  false,
      depthWrite: false,
    });

    this.scene  = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
  }

  get texture(): THREE.Texture { return this.renderTarget.texture; }

  markDirty(): void { this.dirty = true; }

  /** Call when the terrain patch origin or size changes (e.g. on terrain rebuild). */
  setWorldParams(originX: number, originZ: number, worldSize: number): void {
    (this.material.uniforms.uWorldOrigin.value as THREE.Vector2).set(originX, originZ);
    this.material.uniforms.uWorldSize.value = worldSize;
    this.markDirty();
  }

  /** Call when either noise frequency changes. No-op if values are unchanged. */
  setFrequencies(waterNormalFreq: number, treeBumpFreq: number): void {
    const u = this.material.uniforms;
    if (u.uWaterNormalFreq.value === waterNormalFreq &&
        u.uTreeBumpFreq.value    === treeBumpFreq) return;
    u.uWaterNormalFreq.value = waterNormalFreq;
    u.uTreeBumpFreq.value    = treeBumpFreq;
    this.markDirty();
  }

  /** Re-render if dirty; no-op otherwise. Call once per frame before main render. */
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
