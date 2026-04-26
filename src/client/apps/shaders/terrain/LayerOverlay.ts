import * as THREE from 'three';
import { layerOverlayVertexShader }   from '../shaders/layerOverlayVert';
import { layerOverlayFragmentShader } from '../shaders/layerOverlayFrag';
import { PerlinNoise3D } from '@core/noise/PerlinNoise';
import { LAYER_DESCRIPTORS, OverlayParams } from './LayerDescriptors';

const PANEL_SIZE   = 110;
const PANEL_MARGIN = 8;

const ARROW_LEN  = 40;
const ARROW_PAD  = 20;
const HEAD_LEN   = 9;
const HEAD_W     = 5;

/**
 * Greyscale panels in the bottom-left corner, one per entry in LAYER_DESCRIPTORS.
 * Each panel renders the overlay shader with a different uLayerIndex, exposing
 * an intermediate step of the terrain elevation pipeline.
 *
 * On top of every panel, two fixed arrows show the panel's coordinate axes:
 * world X axis (red, pointing right) and world Z axis (blue, pointing down).
 */
export class LayerOverlay {
  readonly scene:  THREE.Scene;
  readonly camera: THREE.OrthographicCamera;

  showLayers = true;

  private meshes:         THREE.Mesh[]         = [];
  private xLines:         THREE.LineSegments[] = [];
  private zLines:         THREE.LineSegments[] = [];
  private labelContainer: HTMLElement | null   = null;
  private noiseLabelEl:   HTMLElement | null   = null;
  private permTex:        THREE.DataTexture | null = null;


  constructor(w: number, h: number, contentArea: HTMLElement, params: OverlayParams) {
    this.scene  = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(0, w, h, 0, -1, 1);
    this.buildPanels(params);
    this.buildAxesArrows();
    this.buildLabels(contentArea);
  }

  updateCamera(w: number, h: number): void {
    this.camera.left   = 0;
    this.camera.right  = w;
    this.camera.top    = h;
    this.camera.bottom = 0;
    this.camera.updateProjectionMatrix();
  }

  /** Sync all overlay uniforms to match the current terrain state. */
  updateUniforms(params: OverlayParams): void {
    if (this.meshes.length === 0) return;

    this.permTex?.dispose();
    this.permTex = this.makePermTex(params.noiseParams.seed);

    for (const mesh of this.meshes) {
      const mat = mesh.material as THREE.ShaderMaterial;
      mat.uniforms.uNoiseScale.value        = params.noiseParams.scale;
      mat.uniforms.uNoiseOctaves.value      = params.noiseParams.octaves;
      mat.uniforms.uNoisePersistence.value  = params.noiseParams.persistence;
      mat.uniforms.uNoiseLacunarity.value   = params.noiseParams.lacunarity;
      mat.uniforms.uNoiseType.value         = params.noiseType;
      mat.uniforms.uPermTex.value           = this.permTex;
      mat.uniforms.uGaussSigma.value        = params.gaussSigma;
      mat.uniforms.uGaussAmplitude.value    = params.gaussAmplitude;
      mat.uniforms.uFractalFreq.value       = params.fractalNoiseParams.freq;
      mat.uniforms.uFractalOctaves.value    = params.fractalNoiseParams.octaves;
      mat.uniforms.uFractalLacunarity.value = params.fractalNoiseParams.lacunarity;
      mat.uniforms.uFractalGain.value       = params.fractalNoiseParams.gain;
      mat.uniforms.uFractalAmp.value        = params.fractalNoiseParams.amp;
      mat.uniforms.uPatchHalfSize.value     = params.patchHalfSize;
      mat.uniforms.uErosionEnabled.value         = params.erosionEnabled ? 1 : 0;
      mat.uniforms.uErosionOctaves.value         = params.erosionOctaves;
      mat.uniforms.uErosionScale.value           = params.erosionScale;
      mat.uniforms.uErosionStrength.value        = params.erosionStrength;
      mat.uniforms.uErosionGullyWeight.value     = params.erosionGullyWeight;
      mat.uniforms.uErosionDetail.value          = params.erosionDetail;
      mat.uniforms.uErosionGain.value            = params.erosionGain;
      mat.uniforms.uErosionLacunarity.value      = params.erosionLacunarity;
      mat.uniforms.uErosionCellScale.value       = params.erosionCellScale;
      mat.uniforms.uErosionNormalization.value   = params.erosionNormalization;
      mat.uniforms.uErosionRidgeRounding.value   = params.erosionRidgeRounding;
      mat.uniforms.uErosionCreaseRounding.value  = params.erosionCreaseRounding;
      mat.uniforms.uElevOffset.value             = params.elevationOffset;
    }

    if (this.noiseLabelEl) {
      const name = params.noiseType === 1 ? 'Perlin'
                 : params.noiseType === 2 ? 'Heightmap'
                 : params.noiseType === 3 ? 'Gaussian'
                 : params.noiseType === 4 ? 'FractalNoise'
                 : 'Simplex';
      this.noiseLabelEl.textContent = `Noise: ${name}`;
    }
  }


  setVisible(visible: boolean): void {
    this.showLayers = visible;
    this.applyLabelVisibility();
  }

  hideLabel(): void {
    if (this.labelContainer) this.labelContainer.style.display = 'none';
  }

  showLabel(): void {
    if (this.showLayers) this.applyLabelVisibility();
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.ShaderMaterial).dispose();
    }
    this.meshes = [];

    for (const line of [...this.xLines, ...this.zLines]) {
      this.scene.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    this.xLines = [];
    this.zLines = [];

    this.permTex?.dispose();
    this.permTex = null;
    this.labelContainer?.remove();
    this.labelContainer = null;
    this.noiseLabelEl = null;
  }

  // ── private ──────────────────────────────────────────────────────────────────

  private makePermTex(seed: number): THREE.DataTexture {
    const data = new Float32Array(new PerlinNoise3D(seed).getPermutation256());
    const tex  = new THREE.DataTexture(data, 256, 1, THREE.RedFormat, THREE.FloatType);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    return tex;
  }

  private applyLabelVisibility(): void {
    if (this.labelContainer) {
      this.labelContainer.style.display = this.showLayers ? 'block' : 'none';
    }
  }

  /** Left edge in overlay pixel space for panel i. */
  private panelLeft(i: number): number {
    return PANEL_MARGIN + i * (PANEL_MARGIN + PANEL_SIZE);
  }

  private buildPanels(params: OverlayParams): void {
    const ps = PANEL_SIZE;

    this.permTex = this.makePermTex(params.noiseParams.seed);

    const makeOverlayMaterial = (layerIndex: number): THREE.ShaderMaterial =>
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: {
          uLayerIndex:              { value: layerIndex },
          uNoiseType:               { value: params.noiseType },
          uPermTex:                 { value: this.permTex },
          uNoiseScale:              { value: params.noiseParams.scale },
          uNoiseOctaves:            { value: params.noiseParams.octaves },
          uNoisePersistence:        { value: params.noiseParams.persistence },
          uNoiseLacunarity:         { value: params.noiseParams.lacunarity },
          uGaussSigma:              { value: params.gaussSigma },
          uGaussAmplitude:          { value: params.gaussAmplitude },
          uFractalFreq:             { value: params.fractalNoiseParams.freq },
          uFractalOctaves:          { value: params.fractalNoiseParams.octaves },
          uFractalLacunarity:       { value: params.fractalNoiseParams.lacunarity },
          uFractalGain:             { value: params.fractalNoiseParams.gain },
          uFractalAmp:              { value: params.fractalNoiseParams.amp },
          uPatchHalfSize:           { value: params.patchHalfSize },
          uErosionEnabled:          { value: params.erosionEnabled ? 1 : 0 },
          uErosionOctaves:          { value: params.erosionOctaves },
          uErosionScale:            { value: params.erosionScale },
          uErosionStrength:         { value: params.erosionStrength },
          uErosionGullyWeight:      { value: params.erosionGullyWeight },
          uErosionDetail:           { value: params.erosionDetail },
          uErosionGain:             { value: params.erosionGain },
          uErosionLacunarity:       { value: params.erosionLacunarity },
          uErosionCellScale:        { value: params.erosionCellScale },
          uErosionNormalization:    { value: params.erosionNormalization },
          uErosionRidgeRounding:    { value: params.erosionRidgeRounding },
          uErosionCreaseRounding:   { value: params.erosionCreaseRounding },
          uElevOffset:              { value: params.elevationOffset },
        },
        vertexShader:   layerOverlayVertexShader,
        fragmentShader: layerOverlayFragmentShader,
        side:       THREE.DoubleSide,
        depthTest:  false,
        depthWrite: false,
      });

    for (const desc of LAYER_DESCRIPTORS) {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(ps, ps),
        makeOverlayMaterial(desc.index),
      );
      mesh.position.set(this.panelLeft(desc.index) + ps / 2, PANEL_MARGIN + ps / 2, 0);
      this.scene.add(mesh);
      this.meshes.push(mesh);
    }
  }

  private buildAxesArrows(): void {
    // Arrows are fixed: panel UV.x → world +X (right), UV.y up → world -Z (so +Z is down).
    for (let i = 0; i < LAYER_DESCRIPTORS.length; i++) {
      const ox = this.panelLeft(i) + ARROW_PAD;
      const oy = PANEL_MARGIN + PANEL_SIZE - ARROW_PAD;
      const xLine = this.makeArrowLine(0xff3333);
      const zLine = this.makeArrowLine(0x3377ff);
      this.writeArrow(xLine, ox, oy,  1,  0);
      this.writeArrow(zLine, ox, oy,  0, -1);
      this.xLines.push(xLine);
      this.zLines.push(zLine);
    }
  }

  private makeArrowLine(color: number): THREE.LineSegments {
    const positions = new Float32Array(6 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat  = new THREE.LineBasicMaterial({ color, depthTest: false, depthWrite: false });
    const line = new THREE.LineSegments(geo, mat);
    line.renderOrder   = 1;
    line.frustumCulled = false;
    this.scene.add(line);
    return line;
  }

  private writeArrow(
    line: THREE.LineSegments,
    ox: number, oy: number,
    dx: number, dy: number,
  ): void {
    const len2d = Math.sqrt(dx * dx + dy * dy);
    const scale = len2d > 0.05 ? ARROW_LEN / len2d : ARROW_LEN * 0.15;
    const tx = dx * scale;
    const ty = dy * scale;
    const nx = tx / ARROW_LEN;
    const ny = ty / ARROW_LEN;
    const px = -ny * HEAD_W;
    const py =  nx * HEAD_W;
    const bx = nx * (ARROW_LEN - HEAD_LEN);
    const by = ny * (ARROW_LEN - HEAD_LEN);

    const z  = 0.5;
    const x1 = ox + tx;
    const y1 = oy + ty;

    const attr = line.geometry.attributes.position as THREE.BufferAttribute;
    attr.setXYZ(0, ox,           oy,           z);
    attr.setXYZ(1, x1,           y1,           z);
    attr.setXYZ(2, x1,           y1,           z);
    attr.setXYZ(3, ox + bx + px, oy + by + py, z);
    attr.setXYZ(4, x1,           y1,           z);
    attr.setXYZ(5, ox + bx - px, oy + by - py, z);
    attr.needsUpdate = true;
  }

  private buildLabels(contentArea: HTMLElement): void {
    const container = document.createElement('div');
    container.style.cssText =
      'position:absolute;bottom:0;left:0;width:100%;height:100%;pointer-events:none;display:none;';

    for (const desc of LAYER_DESCRIPTORS) {
      const div = document.createElement('div');
      div.textContent = desc.label;
      div.style.cssText = [
        'position:absolute',
        `left:${this.panelLeft(desc.index)}px`,
        `bottom:${PANEL_MARGIN}px`,
        'color:#fff',
        'font-size:10px',
        'font-family:monospace',
        'background:rgba(0,0,0,0.65)',
        'padding:1px 4px',
        'border-radius:2px',
      ].join(';');
      container.appendChild(div);
      if (desc.index === 1) this.noiseLabelEl = div;
    }

    contentArea.appendChild(container);
    this.labelContainer = container;
  }
}
