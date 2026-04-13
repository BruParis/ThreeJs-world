/**
 * TerrainElevationGL
 *
 * Computes terrain elevation for an NxM vertex grid on the GPU using a WebGL2
 * offscreen canvas with a GLSL fragment shader (render-to-texture).
 *
 * This is GPU compute via the WebGL2 pipeline — the fragment shader runs in
 * parallel on the GPU exactly like a compute shader would.  Results are read
 * back with readPixels() and returned as a Float32Array accessible on the CPU
 * (for pathfinding, physics, etc.) and uploadable as a Three.js DataTexture
 * for the rendering vertex shader.
 *
 * Color mapping is NOT done here — that belongs in the rendering fragment shader.
 */

import { simplexNoiseGLSL } from '@core/noise/simplexGLSL';
import { perlinNoiseGLSL }  from '@core/noise/perlinGLSL';
import { erosionGLSL }      from '@core/shaders/erosionGLSL';
import { heightmapGLSL }    from '@core/noise/heightmapGLSL';

export interface ElevationComputeParams {
  gridWidth:            number;
  gridHeight:           number;
  originX:              number;
  originZ:              number;
  stepX:                number;
  stepZ:                number;
  noiseScale:           number;
  noiseOctaves:         number;
  noisePersistence:     number;
  noiseLacunarity:      number;
  layerMix:             number;
  patchHalfSize:        number;
  noiseType:            number;
  erosionEnabled:       number;
  erosionOctaves:       number;
  erosionTiles:         number;
  erosionStrength:      number;
  erosionSlopeStrength: number;
  erosionBranchStrength:number;
  erosionGain:          number;
  erosionLacunarity:    number;
}

// ── Shaders ───────────────────────────────────────────────────────────────────

const VERT_SRC = /* glsl */`#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

// Each fragment corresponds to one grid vertex.
// gl_FragCoord.xy gives the (col, row) via (x-0.5, y-0.5).
const FRAG_SRC = /* glsl */`#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

${simplexNoiseGLSL}
${perlinNoiseGLSL}
${erosionGLSL}

uniform float uOriginX;
uniform float uOriginZ;
uniform float uStepX;
uniform float uStepZ;
uniform float uPatchHalfSize;
uniform float uNoiseScale;
uniform int   uNoiseOctaves;
uniform float uNoisePersistence;
uniform float uNoiseLacunarity;
uniform float uLayerMix;
uniform int   uNoiseType;
uniform int   uErosionEnabled;
uniform int   uErosionOctaves;
uniform float uErosionTiles;
uniform float uErosionStrength;
uniform float uErosionSlopeStrength;
uniform float uErosionBranchStrength;
uniform float uErosionGain;
uniform float uErosionLacunarity;

out vec4 fragColor;

const float SEA_LEVEL = 0.35;

${heightmapGLSL}

float noiseFbm(vec3 p) {
  if (uNoiseType == 1) return perlinFbm(p, uNoiseOctaves, uNoisePersistence, uNoiseLacunarity);
  return simplexFbm(p, uNoiseOctaves, uNoisePersistence, uNoiseLacunarity);
}

float baseNoise(vec3 wPos) {
  float l1 = clamp((wPos.x + wPos.z) / (2.0 * uPatchHalfSize) + 0.5, 0.0, 1.0);
  float l2 = noiseFbm(wPos * uNoiseScale) * 0.5 + 0.5;
  return mix(l1, l2, uLayerMix);
}

void main() {
  // Exact vertex world position from fragment coordinates.
  float worldX = uOriginX + (gl_FragCoord.x - 0.5) * uStepX;
  float worldZ = uOriginZ + (gl_FragCoord.y - 0.5) * uStepZ;
  vec3 wPos = vec3(worldX, 0.0, worldZ);

  float noise;

  if (uNoiseType == 2) {
    // Heightmap: value-noise FBM with slope-derived erosion built in.
    float l1 = clamp((wPos.x + wPos.z) / (2.0 * uPatchHalfSize) + 0.5, 0.0, 1.0);
    float hm = clamp(heightmapElevation(wPos.xz).x, 0.0, 1.0);
    noise = mix(l1, hm, uLayerMix);
  } else {
    noise = baseNoise(wPos);

    if (uErosionEnabled == 1) {
      float GE = 0.5 / max(uNoiseScale, 0.5);
      float fL = baseNoise(wPos - vec3(GE, 0.0, 0.0));
      float fR = baseNoise(wPos + vec3(GE, 0.0, 0.0));
      float fD = baseNoise(wPos - vec3(0.0, 0.0, GE));
      float fU = baseNoise(wPos + vec3(0.0, 0.0, GE));
      vec2 slope = vec2(fL - fR, fD - fU) / (2.0 * GE);

      noise += applyErosion(
        wPos.xz * uNoiseScale, noise,
        uErosionOctaves, uErosionTiles, uErosionStrength,
        uErosionSlopeStrength, uErosionBranchStrength,
        uErosionGain, uErosionLacunarity,
        SEA_LEVEL, slope
      );
      noise = clamp(noise, 0.0, 1.0);
    }
  }

  // Store elevation in R; GBA unused.
  fragColor = vec4(noise, 0.0, 0.0, 1.0);
}
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`GL shader compile error:\n${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}

function linkProgram(gl: WebGL2RenderingContext, vert: WebGLShader, frag: WebGLShader): WebGLProgram {
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vert);
  gl.attachShader(prog, frag);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`GL program link error:\n${gl.getProgramInfoLog(prog)}`);
  }
  return prog;
}

// ── TerrainElevationGL ────────────────────────────────────────────────────────

export class TerrainElevationGL {
  private readonly gl:      WebGL2RenderingContext;
  private readonly canvas:  HTMLCanvasElement;
  private readonly program: WebGLProgram;
  private readonly vao:     WebGLVertexArrayObject;
  private readonly fbo:     WebGLFramebuffer;
  private readonly outTex:  WebGLTexture;
  private permTex:          WebGLTexture | null = null;
  private texSize           = { w: 0, h: 0 };

  private constructor(
    gl: WebGL2RenderingContext, canvas: HTMLCanvasElement,
    program: WebGLProgram, vao: WebGLVertexArrayObject,
    fbo: WebGLFramebuffer, outTex: WebGLTexture,
  ) {
    this.gl = gl; this.canvas = canvas; this.program = program;
    this.vao = vao; this.fbo = fbo; this.outTex = outTex;
  }

  static create(): TerrainElevationGL {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL2 not supported.');

    if (!gl.getExtension('EXT_color_buffer_float')) {
      throw new Error('EXT_color_buffer_float not supported — cannot use float render targets.');
    }

    const vert    = compileShader(gl, gl.VERTEX_SHADER,   VERT_SRC);
    const frag    = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    const program = linkProgram(gl, vert, frag);
    gl.deleteShader(vert);
    gl.deleteShader(frag);

    // Fullscreen quad (two triangles as a strip).
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    const fbo    = gl.createFramebuffer()!;
    const outTex = gl.createTexture()!;

    // Pre-attach the output texture to the FBO.
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.bindTexture(gl.TEXTURE_2D, outTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);

    return new TerrainElevationGL(gl, canvas, program, vao, fbo, outTex);
  }

  /**
   * Run the elevation compute pass on the GPU.
   *
   * @param params    Grid dimensions, noise, and erosion parameters.
   * @param permData  256-entry Perlin permutation table from PerlinNoise3D.getPermutation256().
   * @returns         Float32Array of length gridWidth × gridHeight, elevation in [0, 1].
   *                  Index: row * gridWidth + col  (row 0 = bottom of the grid in GL coords,
   *                  but this is consistent with the UV mapping used in the vertex shader).
   */
  compute(params: ElevationComputeParams, permData: number[]): Float32Array {
    const { gl, program, fbo, outTex, vao } = this;
    const { gridWidth: w, gridHeight: h } = params;

    // ── Resize output texture when grid dimensions change ──────────────────
    if (this.texSize.w !== w || this.texSize.h !== h) {
      gl.bindTexture(gl.TEXTURE_2D, outTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
      gl.bindTexture(gl.TEXTURE_2D, null);
      this.canvas.width  = w;
      this.canvas.height = h;
      this.texSize = { w, h };
    }

    // ── Update permutation texture (for Perlin) ────────────────────────────
    this.updatePermTex(permData);

    // ── Render ────────────────────────────────────────────────────────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(program);

    this.setUniforms(params);

    // Bind permutation texture to unit 0 (uPermTex is declared in perlinGLSL).
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.permTex);
    gl.uniform1i(gl.getUniformLocation(program, 'uPermTex'), 0);

    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);

    // ── Readback ───────────────────────────────────────────────────────────
    const raw = new Float32Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, raw);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Extract R channel (elevation stored in R, GBA unused).
    const elevations = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) elevations[i] = raw[i * 4];

    return elevations;
  }

  dispose(): void {
    const { gl } = this;
    gl.deleteTexture(this.outTex);
    gl.deleteTexture(this.permTex);
    gl.deleteFramebuffer(this.fbo);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
  }

  // ── private ──────────────────────────────────────────────────────────────

  private updatePermTex(permData: number[]): void {
    const { gl } = this;
    if (!this.permTex) this.permTex = gl.createTexture()!;
    const data = new Float32Array(permData);
    gl.bindTexture(gl.TEXTURE_2D, this.permTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 256, 1, 0, gl.RED, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  private setUniforms(p: ElevationComputeParams): void {
    const { gl, program } = this;
    const u = (name: string) => gl.getUniformLocation(program, name);
    gl.uniform1f(u('uOriginX'),             p.originX);
    gl.uniform1f(u('uOriginZ'),             p.originZ);
    gl.uniform1f(u('uStepX'),               p.stepX);
    gl.uniform1f(u('uStepZ'),               p.stepZ);
    gl.uniform1f(u('uPatchHalfSize'),       p.patchHalfSize);
    gl.uniform1f(u('uNoiseScale'),          p.noiseScale);
    gl.uniform1i(u('uNoiseOctaves'),        p.noiseOctaves);
    gl.uniform1f(u('uNoisePersistence'),    p.noisePersistence);
    gl.uniform1f(u('uNoiseLacunarity'),     p.noiseLacunarity);
    gl.uniform1f(u('uLayerMix'),            p.layerMix);
    gl.uniform1i(u('uNoiseType'),           p.noiseType);
    gl.uniform1i(u('uErosionEnabled'),      p.erosionEnabled);
    gl.uniform1i(u('uErosionOctaves'),      p.erosionOctaves);
    gl.uniform1f(u('uErosionTiles'),        p.erosionTiles);
    gl.uniform1f(u('uErosionStrength'),     p.erosionStrength);
    gl.uniform1f(u('uErosionSlopeStrength'),  p.erosionSlopeStrength);
    gl.uniform1f(u('uErosionBranchStrength'), p.erosionBranchStrength);
    gl.uniform1f(u('uErosionGain'),         p.erosionGain);
    gl.uniform1f(u('uErosionLacunarity'),   p.erosionLacunarity);
  }
}
