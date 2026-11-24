/**
 * Webpack loader for .glsl files.
 *
 * Resolves `#include "relative/path.glsl"` at build time, recursively, and
 * exports the flattened source as a string:
 *
 *   import source from './terrainMaterial.frag.glsl';
 *
 * - Paths are relative to the including file.
 * - Each file is included at most once per exported shader, so library files
 *   need no include guards.  Include cycles are an error.
 * - Three's own chunk includes, `#include <common>` (angle brackets), are left
 *   untouched: Three resolves them when it compiles the program.
 * - Included files are watched: editing one rebuilds every shader using it.
 */

const fs   = require('fs');
const path = require('path');

const INCLUDE = /^[ \t]*#include[ \t]+"([^"]+)"[ \t]*$/gm;

module.exports = function glslIncludeLoader(source) {
  const loader = this;
  const included = new Set([this.resourcePath]);

  function expand(text, file, chain) {
    return text.replace(INCLUDE, (_line, rel) => {
      const target = path.resolve(path.dirname(file), rel);
      if (chain.includes(target)) {
        throw new Error(`GLSL include cycle: ${[...chain, target].map((f) => path.basename(f)).join(' -> ')}`);
      }
      if (included.has(target)) return `// #include "${rel}" (already included)`;
      included.add(target);
      loader.addDependency(target);

      let body;
      try {
        body = fs.readFileSync(target, 'utf8');
      } catch (e) {
        throw new Error(`GLSL include not found: "${rel}" (from ${path.basename(file)})`);
      }
      return `// ── begin ${rel} ──\n${expand(body, target, [...chain, target])}\n// ── end ${rel} ──`;
    });
  }

  const out = expand(source, this.resourcePath, [this.resourcePath]);
  return `export default ${JSON.stringify(out)};`;
};
