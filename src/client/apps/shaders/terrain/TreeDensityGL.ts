/**
 * TreeDensityGL
 *
 * Dynamic GPU compute pass that produces a per-texel tree density texture.
 * Runs when elevation offset or tree parameters change — much faster than the
 * full elevation pass because it only samples the already-baked elevation data
 * and calls ComputeTreeMap (one gradient noise evaluation per texel).
 *
 * Input:  packed     — RGBA Float32Array from TerrainElevationGL (R=rawElev, G=gradX, B=gradZ)
 *         attrPacked — RGBA Float32Array from TerrainElevationGL (R=ridgeMap)
 * Output: tree density Float32Array (one float per texel, [0,1])
 *         → uploaded by TerrainMesh as a DataTexture for the vertex shader.
 */

import { treeDensityComputeGLSL } from '@core/shaders/treeDensityComputeGLSL';

export interface TreeDensityParams {
  gridWidth:     number;
  gridHeight:    number;
  originX:       number;
  originZ:       number;
  stepX:         number;
  stepZ:         number;
  elevOffset:    number;
  seaLevel:      number;
  treeEnabled:   number;
  treeElevMax:   number;
  treeElevMin:   number;
  treeSlopeMin:  number;
  treeRidgeMin:  number;
  treeNoiseFreq: number;
  treeNoisePow:  number;
  treeDensity:   number;
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

${treeDensityComputeGLSL}
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
    throw new Error(`TreeDensityGL shader compile error:\n${gl.getShaderInfoLog(shader)}`);
  return shader;
}

function linkProgram(gl: WebGL2RenderingContext, vert: WebGLShader, frag: WebGLShader): WebGLProgram {
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vert);
  gl.attachShader(prog, frag);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
    throw new Error(`TreeDensityGL program link error:\n${gl.getProgramInfoLog(prog)}`);
  return prog;
}

// ── TreeDensityGL ─────────────────────────────────────────────────────────────

export class TreeDensityGL {
  private readonly gl:      WebGL2RenderingContext;
  private readonly canvas:  HTMLCanvasElement;
  private readonly program: WebGLProgram;
  private readonly vao:     WebGLVertexArrayObject;
  private readonly fbo:     WebGLFramebuffer;
  private readonly outTex:  WebGLTexture;
  private elevTex:          WebGLTexture | null = null;
  private attrTex:          WebGLTexture | null = null;
  private texSize           = { w: 0, h: 0 };

  private constructor(
    gl: WebGL2RenderingContext, canvas: HTMLCanvasElement,
    program: WebGLProgram, vao: WebGLVertexArrayObject,
    fbo: WebGLFramebuffer, outTex: WebGLTexture,
  ) {
    this.gl = gl; this.canvas = canvas; this.program = program;
    this.vao = vao; this.fbo = fbo; this.outTex = outTex;
  }

  static create(): TreeDensityGL {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL2 not supported.');
    if (!gl.getExtension('EXT_color_buffer_float'))
      throw new Error('EXT_color_buffer_float not supported.');

    const vert    = compileShader(gl, gl.VERTEX_SHADER,   VERT_SRC);
    const frag    = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    const program = linkProgram(gl, vert, frag);
    gl.deleteShader(vert);
    gl.deleteShader(frag);

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
    gl.bindTexture(gl.TEXTURE_2D, outTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);

    return new TreeDensityGL(gl, canvas, program, vao, fbo, outTex);
  }

  /**
   * Run the tree density compute pass.
   *
   * @param packed     RGBA Float32Array from the elevation pass (R=rawElev, G=gradX, B=gradZ)
   * @param attrPacked RGBA Float32Array from the elevation pass (R=ridgeMap)
   * @param params     Grid layout + elevation offset + tree parameters
   * @returns          RGBA Float32Array — R channel contains tree density [0,1] per texel.
   *                   Upload as THREE.RGBAFormat DataTexture; vertex shader reads .r.
   */
  compute(packed: Float32Array, attrPacked: Float32Array, params: TreeDensityParams): Float32Array {
    const { gl, program, fbo, outTex, vao } = this;
    const { gridWidth: w, gridHeight: h } = params;

    // Resize output texture when grid dimensions change.
    if (this.texSize.w !== w || this.texSize.h !== h) {
      gl.bindTexture(gl.TEXTURE_2D, outTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
      gl.bindTexture(gl.TEXTURE_2D, null);
      this.canvas.width  = w;
      this.canvas.height = h;
      this.texSize = { w, h };
    }

    // Upload input textures (CPU → this GL context).
    this.uploadTex('elevTex', packed,     w, h);
    this.uploadTex('attrTex', attrPacked, w, h);

    // Render.
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(program);
    this.setUniforms(params);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.elevTex);
    gl.uniform1i(gl.getUniformLocation(program, 'uElevTex'), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.attrTex);
    gl.uniform1i(gl.getUniformLocation(program, 'uAttrTex'), 1);

    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);

    // Read back (this GL context → CPU).
    const result = new Float32Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, result);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return result; // R channel = tree density; upload as RGBA DataTexture
  }

  dispose(): void {
    const { gl } = this;
    gl.deleteTexture(this.outTex);
    if (this.elevTex) gl.deleteTexture(this.elevTex);
    if (this.attrTex) gl.deleteTexture(this.attrTex);
    gl.deleteFramebuffer(this.fbo);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
  }

  // ── private ──────────────────────────────────────────────────────────────────

  private uploadTex(field: 'elevTex' | 'attrTex', data: Float32Array, w: number, h: number): void {
    const { gl } = this;
    if (!this[field]) {
      this[field] = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, this[field]);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this[field]);
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  private setUniforms(p: TreeDensityParams): void {
    const { gl, program } = this;
    const u = (name: string) => gl.getUniformLocation(program, name);
    gl.uniform1f(u('uOriginX'),       p.originX);
    gl.uniform1f(u('uOriginZ'),       p.originZ);
    gl.uniform1f(u('uStepX'),         p.stepX);
    gl.uniform1f(u('uStepZ'),         p.stepZ);
    gl.uniform1f(u('uElevOffset'),    p.elevOffset);
    gl.uniform1f(u('uSeaLevel'),      p.seaLevel);
    gl.uniform1i(u('uTreeEnabled'),   p.treeEnabled);
    gl.uniform1f(u('uTreeElevMax'),   p.treeElevMax);
    gl.uniform1f(u('uTreeElevMin'),   p.treeElevMin);
    gl.uniform1f(u('uTreeSlopeMin'),  p.treeSlopeMin);
    gl.uniform1f(u('uTreeRidgeMin'),  p.treeRidgeMin);
    gl.uniform1f(u('uTreeNoiseFreq'), p.treeNoiseFreq);
    gl.uniform1f(u('uTreeNoisePow'),  p.treeNoisePow);
    gl.uniform1f(u('uTreeDensity'),   p.treeDensity);
  }
}
