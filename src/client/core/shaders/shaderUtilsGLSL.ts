/**
 * General-purpose GLSL utility functions.
 *
 * Exposes:
 *
 *   Math macros
 *     DEG_TO_RAD        — degrees-to-radians conversion factor (assumes PI in scope)
 *     saturate(x)       — clamp(x, 0.0, 1.0), named after HLSL saturate
 *     sq(x)             — squares its argument
 *     clamp01(x)        — clamp(x, 0.0, 1.0)
 *
 *   Normal mapping
 *     vec3 RNM(vec3 n1, vec3 n2)
 *       Reoriented Normal Mapping blend — combines two tangent-space normals
 *       without the cancellation artifacts of additive or UDN blending.
 */

import shaderUtilsGLSLSource from './shaderUtils.glsl';

/** GLSL source: shaderUtils.glsl (flattened). */
export const shaderUtilsGLSL = shaderUtilsGLSLSource;
