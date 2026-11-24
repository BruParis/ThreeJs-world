/**
 * View panel: how the patch is looked at — camera, wireframe, debug view, mesh
 * resolution and lighting.  Nothing here changes the terrain itself.
 */

import { FolderApi } from 'tweakpane';
import { DirectionalLight, AmbientLight } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FlyCam } from '@core/FlyCam';
import {
  TERRAIN_DEBUG_COLOR,
  TERRAIN_DEBUG_ELEVATION,
  TERRAIN_DEBUG_RIDGEMAP,
  TERRAIN_DEBUG_TREES,
  TERRAIN_DEBUG_NORMALS,
  TERRAIN_DEBUG_STEEPNESS,
  TERRAIN_DEBUG_EXPOSURE,
  TERRAIN_DEBUG_BREAKUP,
  TERRAIN_DEBUG_CLASSIFICATION,
  TERRAIN_DEBUG_BIOME,
} from '@core/shaders/terrainSampleGLSL';
import { SUBDIVISION_OPTIONS, PATCH_OPTIONS } from '../../terrain/TerrainConstants';
import { accordion } from '../Panels';
import type { GUIContext } from '../GUIContext';

export function addViewSection(
  panel: FolderApi,
  ctx: GUIContext,
  controls: OrbitControls,
  flyCam: FlyCam,
  sunLight: DirectionalLight,
  ambientLight: AmbientLight,
): void {
  const { P, terrain, upd } = ctx;

  const camParams = { flyCam: false };
  panel.addBinding(camParams, 'flyCam', { label: 'Fly Camera' })
    .on('change', ({ value }) => {
      if (value) { controls.enabled = false; flyCam.enable(); }
      else       { flyCam.disable(); controls.enabled = true; }
    });

  const displayParams = {
    wireframe: terrain.wireframe,
    debugMode: P.terrainColors.debugMode,
  };
  panel.addBinding(displayParams, 'wireframe', { label: 'Wireframe' })
    .on('change', ({ value }) => { terrain.wireframe = value; upd.display(); });
  panel.addBinding(displayParams, 'debugMode', {
    label: 'Debug View',
    options: {
      'Color':          TERRAIN_DEBUG_COLOR,
      'Elevation':      TERRAIN_DEBUG_ELEVATION,
      'Ridge Map':      TERRAIN_DEBUG_RIDGEMAP,
      'Trees':          TERRAIN_DEBUG_TREES,
      'Normals':        TERRAIN_DEBUG_NORMALS,
      'Steepness':      TERRAIN_DEBUG_STEEPNESS,
      'Exposure':       TERRAIN_DEBUG_EXPOSURE,
      'Breakup':        TERRAIN_DEBUG_BREAKUP,
      'Classification': TERRAIN_DEBUG_CLASSIFICATION,
      'Biome':          TERRAIN_DEBUG_BIOME,
    },
  }).on('change', ({ value }) => {
    P.terrainColors.debugMode = Number(value);
    upd.colors();
  });

  // ── Mesh ──────────────────────────────────────────────────────────────────

  const meshFolder = panel.addFolder({ title: 'Mesh', expanded: false });
  const meshParams = {
    numPatches:  terrain.numPatches,
    subdivision: terrain.subdivisions,
  };
  meshFolder.addBinding(meshParams, 'numPatches', { label: 'Patches', options: PATCH_OPTIONS })
    .on('change', ({ value }) => { terrain.numPatches = value; upd.geometry(); });
  meshFolder.addBinding(meshParams, 'subdivision', { label: 'Subdivision', options: SUBDIVISION_OPTIONS })
    .on('change', ({ value }) => { terrain.subdivisions = Number(value); upd.geometry(); });

  // ── Lighting ──────────────────────────────────────────────────────────────

  const lightFolder = panel.addFolder({ title: 'Lighting', expanded: false });
  const lightingParams = {
    sunAzimuth:       45,
    sunElevation:     45,
    sunIntensity:     sunLight.intensity,
    sunColor:         { r: sunLight.color.r * 255, g: sunLight.color.g * 255, b: sunLight.color.b * 255 },
    ambientIntensity: ambientLight.intensity,
    ambientColor:     { r: ambientLight.color.r * 255, g: ambientLight.color.g * 255, b: ambientLight.color.b * 255 },
    roughness:        terrain.roughness,
  };

  const updateSunDir = () => {
    const az = lightingParams.sunAzimuth  * Math.PI / 180;
    const el = lightingParams.sunElevation * Math.PI / 180;
    sunLight.position.set(
      Math.cos(el) * Math.sin(az),
      Math.sin(el),
      Math.cos(el) * Math.cos(az),
    );
  };

  lightFolder.addBinding(lightingParams, 'sunAzimuth',   { label: 'Sun Azimuth',   min: 0, max: 360, step: 1 }).on('change', updateSunDir);
  lightFolder.addBinding(lightingParams, 'sunElevation', { label: 'Sun Elevation', min: 0, max: 90,  step: 1 }).on('change', updateSunDir);
  lightFolder.addBinding(lightingParams, 'sunColor',     { label: 'Sun Color' })
    .on('change', ({ value }) => sunLight.color.setRGB(value.r / 255, value.g / 255, value.b / 255));
  lightFolder.addBinding(lightingParams, 'sunIntensity', { label: 'Sun Intensity', min: 0, max: 8, step: 0.1 })
    .on('change', ({ value }) => { sunLight.intensity = value; });
  lightFolder.addBinding(lightingParams, 'ambientColor', { label: 'Ambient Color' })
    .on('change', ({ value }) => ambientLight.color.setRGB(value.r / 255, value.g / 255, value.b / 255));
  lightFolder.addBinding(lightingParams, 'ambientIntensity', { label: 'Ambient Int.', min: 0, max: 5, step: 0.05 })
    .on('change', ({ value }) => { ambientLight.intensity = value; });
  lightFolder.addBinding(lightingParams, 'roughness', { label: 'Roughness', min: 0, max: 1, step: 0.01 })
    .on('change', ({ value }) => terrain.setRoughness(value));

  accordion([meshFolder, lightFolder]);
}
