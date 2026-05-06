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
 *
 * All terrain-domain GLSL (noise, erosion, elevation math) lives in
 * @core/shaders/elevationComputeGLSL. This file contains only the WebGL2
 * pipeline: canvas setup, shader compilation, FBO, draw call, readback.
 */

import { elevationComputeGLSL } from '@core/shaders/elevationComputeGLSL';

export interface ElevationComputeParams {
  gridWidth:              number;
  gridHeight:             number;
  originX:                number;
  originZ:                number;
  stepX:                  number;
  stepZ:                  number;
  noiseScale:             number;
  noiseOctaves:           number;
  noisePersistence:       number;
  noiseLacunarity:        number;
  patchHalfSize:          number;
  noiseType:              number;
  gaussSigma:             number;
  gaussAmplitude:         number;
  fractalFreq:            number;
  fractalOctaves:         number;
  fractalLacunarity:      number;
  fractalGain:            number;
  fractalAmp:             number;
  erosionEnabled:         number;
  erosionOctaves:         number;
  erosionScale:           number;
  erosionStrength:        number;
  erosionGullyWeight:     number;
  erosionDetail:          number;
  erosionGain:            number;
  erosionLacunarity:      number;
  erosionCellScale:       number;
  erosionNormalization:   number;
  erosionRidgeRounding:   number;
  erosionCreaseRounding:  number;
  // Sea level + tree params — drive classifyTerrain in the elevation compute pass.
  seaLevel:               number;
  treeEnabled:            number;
  treeElevMax:            number;
  treeElevMin:            number;
  treeSlopeMin:           number;
  treeRidgeMin:           number;
  treeNoiseFreq:          number;
  treeNoisePow:           number;
  treeDensity:            number;
}

// ── Shaders ───────────────────────────────────────────────────────────────────

const VERT_SRC = /* glsl */`#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG_SRC = /* glsl */`#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

${elevationComputeGLSL}
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
  private readonly outTex:  WebGLTexture;  // COLOR_ATTACHMENT0 — elevation (LinearFilter in Three.js)
  private readonly attrTex: WebGLTexture;  // COLOR_ATTACHMENT1 — ridge + erosionDepth (NearestFilter)
  private permTex:          WebGLTexture | null = null;
  private texSize           = { w: 0, h: 0 };

  private constructor(
    gl: WebGL2RenderingContext, canvas: HTMLCanvasElement,
    program: WebGLProgram, vao: WebGLVertexArrayObject,
    fbo: WebGLFramebuffer, outTex: WebGLTexture, attrTex: WebGLTexture,
  ) {
    this.gl = gl; this.canvas = canvas; this.program = program;
    this.vao = vao; this.fbo = fbo; this.outTex = outTex; this.attrTex = attrTex;
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

    const fbo     = gl.createFramebuffer()!;
    const outTex  = gl.createTexture()!;
    const attrTex = gl.createTexture()!;

    // Attach both textures to the FBO and configure draw buffers for MRT.
    // COLOR_ATTACHMENT0 → outTex  (elevation, gradients)
    // COLOR_ATTACHMENT1 → attrTex (ridgeMap, erosionDepth)
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);

    const attachTex = (tex: WebGLTexture, attachment: number) => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, attachment, gl.TEXTURE_2D, tex, 0);
    };
    attachTex(outTex,  gl.COLOR_ATTACHMENT0);
    attachTex(attrTex, gl.COLOR_ATTACHMENT1);

    // Tell the driver that both attachments receive fragment output.
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);

    return new TerrainElevationGL(gl, canvas, program, vao, fbo, outTex, attrTex);
  }

  /**
   * Run the elevation compute pass on the GPU.
   *
   * @param params    Grid dimensions, noise, and erosion parameters.
   * @param permData  256-entry Perlin permutation table from PerlinNoise3D.getPermutation256().
   * @returns
   *   elevations  Float32Array (length w×h) — R channel only, for CPU use (pathfinding, physics).
   *   packed      Float32Array (length w×h×4) — RGBA readback from COLOR_ATTACHMENT0:
   *                 R = elevation [0,1],  G = dH/dX (norm),  B = dH/dZ (norm),  A = unused.
   *               Upload as THREE.RGBAFormat DataTexture with LinearFilter for the vertex shader.
   *   attrPacked  Float32Array (length w×h×4) — RGBA readback from COLOR_ATTACHMENT1:
   *                 R = ridgeMap [-1,1],  G = erosionDepth [0,1] (packed ×0.5+0.5),
   *                 B = trees (float, direct),  A = hardness [0,1] (direct).
   *               All channels are continuous floats — upload with LinearFilter.
   */
  compute(params: ElevationComputeParams, permData: number[]): { elevations: Float32Array<ArrayBuffer>; packed: Float32Array<ArrayBuffer>; attrPacked: Float32Array<ArrayBuffer> } {
    const { gl, program, fbo, outTex, attrTex, vao } = this;
    const { gridWidth: w, gridHeight: h } = params;

    // ── Resize both output textures when grid dimensions change ────────────
    if (this.texSize.w !== w || this.texSize.h !== h) {
      for (const tex of [outTex, attrTex]) {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
      }
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
    // Read each MRT attachment separately using gl.readBuffer to select the source.
    const packed     = new Float32Array(w * h * 4);
    const attrPacked = new Float32Array(w * h * 4);

    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, packed);

    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, attrPacked);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Extract R channel (elevation) for CPU use.
    const elevations = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) elevations[i] = packed[i * 4];

    return { elevations, packed, attrPacked };
  }

  dispose(): void {
    const { gl } = this;
    gl.deleteTexture(this.outTex);
    gl.deleteTexture(this.attrTex);
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
    gl.uniform1i(u('uNoiseType'),           p.noiseType);
    gl.uniform1f(u('uGaussSigma'),          p.gaussSigma);
    gl.uniform1f(u('uGaussAmplitude'),      p.gaussAmplitude);
    gl.uniform1f(u('uFractalFreq'),         p.fractalFreq);
    gl.uniform1i(u('uFractalOctaves'),      p.fractalOctaves);
    gl.uniform1f(u('uFractalLacunarity'),   p.fractalLacunarity);
    gl.uniform1f(u('uFractalGain'),         p.fractalGain);
    gl.uniform1f(u('uFractalAmp'),          p.fractalAmp);
    gl.uniform1i(u('uErosionEnabled'),        p.erosionEnabled);
    gl.uniform1i(u('uErosionOctaves'),        p.erosionOctaves);
    gl.uniform1f(u('uErosionScale'),          p.erosionScale);
    gl.uniform1f(u('uErosionStrength'),       p.erosionStrength);
    gl.uniform1f(u('uErosionGullyWeight'),    p.erosionGullyWeight);
    gl.uniform1f(u('uErosionDetail'),         p.erosionDetail);
    gl.uniform1f(u('uErosionGain'),           p.erosionGain);
    gl.uniform1f(u('uErosionLacunarity'),     p.erosionLacunarity);
    gl.uniform1f(u('uErosionCellScale'),      p.erosionCellScale);
    gl.uniform1f(u('uErosionNormalization'),  p.erosionNormalization);
    gl.uniform1f(u('uErosionRidgeRounding'),  p.erosionRidgeRounding);
    gl.uniform1f(u('uErosionCreaseRounding'), p.erosionCreaseRounding);
    gl.uniform1f(u('uSeaLevel'),              p.seaLevel);
    gl.uniform1i(u('uTreeEnabled'),           p.treeEnabled);
    gl.uniform1f(u('uTreeElevMax'),           p.treeElevMax);
    gl.uniform1f(u('uTreeElevMin'),           p.treeElevMin);
    gl.uniform1f(u('uTreeSlopeMin'),          p.treeSlopeMin);
    gl.uniform1f(u('uTreeRidgeMin'),          p.treeRidgeMin);
    gl.uniform1f(u('uTreeNoiseFreq'),         p.treeNoiseFreq);
    gl.uniform1f(u('uTreeNoisePow'),          p.treeNoisePow);
    gl.uniform1f(u('uTreeDensity'),           p.treeDensity);
  }
}
