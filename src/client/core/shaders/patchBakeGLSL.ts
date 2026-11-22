/**
 * Patch bake support — shared by every terrain bake pass.
 *
 * A bake pass is a fullscreen fragment shader that fills one texture of a
 * terrain patch.  Where the patch lies on the planet is given by a small
 * "direction texture": a grid of unit vectors, computed on the CPU, that maps
 * the patch square onto the sphere (see core/terrain/PatchDomain).  The same
 * code therefore bakes a World-tab quadtree cell and the flat Shaders-tab patch.
 *
 * Baked textures are vertex-centred: the first / last texel lie exactly on the
 * patch edges, so neighbouring patches hold identical samples on shared edges.
 *
 * Exposes (fragment):
 *   uniform sampler2D uDirTex        direction grid (xyz = unit direction)
 *   uniform vec2      uBakeSize      size in texels of the texture being baked
 *   uniform float     uPlanetRadius  world radius, terrain units
 *   uniform float     uTexelSize     spacing of the baked samples, terrain units
 *   uniform float     uBandTexel     uTexelSize when band-limiting is on, else 0
 *
 *   vec3 patchBakeDir()
 *     Unit direction of the texel being shaded.  The 3D sampling position is
 *     patchBakeDir() * uPlanetRadius.
 */

/** Vertex shader of every bake pass: a clip-space fullscreen quad. */
export const patchBakeVert = /* glsl */`
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const patchBakeGLSL = /* glsl */`

uniform sampler2D uDirTex;
uniform vec2      uBakeSize;
uniform float     uPlanetRadius;
uniform float     uTexelSize;
uniform float     uBandTexel;

vec3 patchBakeDir() {
  vec2 st      = (gl_FragCoord.xy - 0.5) / max(uBakeSize - 1.0, vec2(1.0));
  vec2 dirSize = vec2(textureSize(uDirTex, 0));
  vec2 dirUv   = (st * (dirSize - 1.0) + 0.5) / dirSize;
  return normalize(texture(uDirTex, dirUv).xyz);
}

`;
