/**
 * SuppNoiseGL
 *
 * GPU compute for the supplemental noise texture.
 * Renders a static FBM value-noise texture into a THREE.WebGLRenderTarget
 * using the main Three.js renderer.
 *
 * The output texture encodes:
 *   R = accumulated noise value  (FBM, 8 octaves)
 *   G = accumulated dNoise/du    (analytical derivative)
 *   B = accumulated dNoise/dv    (analytical derivative)
 *
 * Used in the terrain fragment shader to perturb the surface normal, adding
 * high-frequency diffuse and shading detail without modifying the base elevation.
 *
 * Call update(renderer) when the texture needs to be (re-)computed — it is a
 * no-op unless markDirty() has been called.  The .texture property is the
 * resulting THREE.Texture suitable for use as a sampler2D uniform.
 */

import * as THREE from 'three';

// ── GLSL ─────────────────────────────────────────────────────────────────────

const SUPP_VERT = /* glsl */`
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const SUPP_FRAG = /* glsl */`
precision highp float;

uniform vec2 uBufferSize;

out vec4 fragColor;

// Value noise with analytical derivatives (IQ-style).
// Returns vec3(value [-1,1], dvalue/du, dvalue/dv).
float hm_hash(vec2 p) {
  float h = dot(p, vec2(127.1, 311.7));
  return -1.0 + 2.0 * fract(sin(h) * 43758.5453123);
}

vec3 noised(vec2 x) {
  vec2 i  = floor(x);
  vec2 f  = fract(x);
  vec2 u  = f*f*f*(f*(f*6.0 - 15.0) + 10.0);
  vec2 du = 30.0*f*f*(f*(f - 2.0) + 1.0);
  float a = hm_hash(i + vec2(0.0, 0.0));
  float b = hm_hash(i + vec2(1.0, 0.0));
  float c = hm_hash(i + vec2(0.0, 1.0));
  float d = hm_hash(i + vec2(1.0, 1.0));
  float k0 = a;
  float k1 = b - a;
  float k2 = c - a;
  float k4 = a - b - c + d;
  return vec3(k0 + k1*u.x + k2*u.y + k4*u.x*u.y,
              du.x * (k1 + k4*u.y),
              du.y * (k2 + k4*u.x));
}

void main() {
  vec2 uv = gl_FragCoord.xy / uBufferSize;

  vec3 color = vec3(0.0);
  float a = 0.5;
  float f = 2.0;
  for (int i = 0; i < 8; i++) {
    color += noised(uv * f) * a;
    a *= 0.95;
    f *= 2.0;
  }

  fragColor = vec4(color, 1.0);
}
`;

// ── SuppNoiseGL ───────────────────────────────────────────────────────────────

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
        uBufferSize: { value: new THREE.Vector2(size, size) },
      },
      vertexShader:   SUPP_VERT,
      fragmentShader: SUPP_FRAG,
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
