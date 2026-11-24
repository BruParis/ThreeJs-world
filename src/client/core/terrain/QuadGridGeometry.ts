/**
 * Grid geometry whose quads can each choose their diagonal on the GPU.
 *
 * A regular grid split along a fixed diagonal shows a sawtooth on ridges and
 * valleys crossing that diagonal: the shared edge joins the two low corners and
 * cuts a notch across the crest.  The vertex shader (terrainVertexGLSL) picks,
 * per quad, the diagonal that best follows the relief.
 *
 * A shared vertex cannot follow two quads that choose differently, so every
 * quad has its own 4 vertices, at the corners c0..c3 in ring order:
 *     c0 = (i, j)   c1 = (i, j+1)   c2 = (i+1, j+1)   c3 = (i+1, j)
 * The index buffer is fixed: triangles (0,1,2) and (0,2,3), split along c0–c2.
 * To split along c1–c3 instead, each vertex moves to the next corner of the
 * ring (a quarter turn of the quad, which keeps the winding).  So every vertex
 * carries the attributes of its own corner and of the next one:
 *   position / normal / uv           — own corner (the terrain geometry contract)
 *   aAltPosition / aAltNormal / aAltUv — next corner in the ring
 *   aQuadUv                          — vec4(uv of c0, uv of c2), used to sample
 *                                      the relief around the quad
 *
 * Input grids are (n + 1)² points, index i * (n + 1) + j, with uv.x depending
 * on i only and uv.y on j only.
 */

import * as THREE from 'three';

export function buildQuadGridGeometry(
  n: number,
  positions: Float32Array,
  normals: Float32Array,
  uvs: Float32Array,
  /** Use (0,2,1)/(0,3,2): the grid's ring order is clockwise as seen from outside. */
  reverseWinding: boolean,
): THREE.BufferGeometry {
  const quads = n * n;
  const vCount = quads * 4;

  const pos    = new Float32Array(vCount * 3);
  const nrm    = new Float32Array(vCount * 3);
  const uv     = new Float32Array(vCount * 2);
  const altPos = new Float32Array(vCount * 3);
  const altNrm = new Float32Array(vCount * 3);
  const altUv  = new Float32Array(vCount * 2);
  const quadUv = new Float32Array(vCount * 4);
  const index  = new Uint32Array(quads * 6);

  const ring = [0, 0, 0, 0];
  const copy3 = (dst: Float32Array, d: number, src: Float32Array, s: number) => {
    dst[d * 3] = src[s * 3]; dst[d * 3 + 1] = src[s * 3 + 1]; dst[d * 3 + 2] = src[s * 3 + 2];
  };
  const copy2 = (dst: Float32Array, d: number, src: Float32Array, s: number) => {
    dst[d * 2] = src[s * 2]; dst[d * 2 + 1] = src[s * 2 + 1];
  };

  let q = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++, q++) {
      ring[0] = i * (n + 1) + j;
      ring[1] = ring[0] + 1;
      ring[3] = (i + 1) * (n + 1) + j;
      ring[2] = ring[3] + 1;

      const base = q * 4;
      for (let s = 0; s < 4; s++) {
        const v   = base + s;
        const own = ring[s];
        const alt = ring[(s + 1) & 3];
        copy3(pos,    v, positions, own);
        copy3(nrm,    v, normals,   own);
        copy2(uv,     v, uvs,       own);
        copy3(altPos, v, positions, alt);
        copy3(altNrm, v, normals,   alt);
        copy2(altUv,  v, uvs,       alt);
        quadUv[v * 4]     = uvs[ring[0] * 2];
        quadUv[v * 4 + 1] = uvs[ring[0] * 2 + 1];
        quadUv[v * 4 + 2] = uvs[ring[2] * 2];
        quadUv[v * 4 + 3] = uvs[ring[2] * 2 + 1];
      }

      const k = q * 6;
      if (reverseWinding) {
        index[k] = base; index[k + 1] = base + 2; index[k + 2] = base + 1;
        index[k + 3] = base; index[k + 4] = base + 3; index[k + 5] = base + 2;
      } else {
        index[k] = base; index[k + 1] = base + 1; index[k + 2] = base + 2;
        index[k + 3] = base; index[k + 4] = base + 2; index[k + 5] = base + 3;
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position',     new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal',       new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('uv',           new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('aAltPosition', new THREE.BufferAttribute(altPos, 3));
  geo.setAttribute('aAltNormal',   new THREE.BufferAttribute(altNrm, 3));
  geo.setAttribute('aAltUv',       new THREE.BufferAttribute(altUv, 2));
  geo.setAttribute('aQuadUv',      new THREE.BufferAttribute(quadUv, 4));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  return geo;
}
