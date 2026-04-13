import * as THREE from 'three';
import { layerOverlayVertexShader } from '../shaders/layerOverlayVert';
import { layerOverlayFragmentShader } from '../shaders/layerOverlayFrag';
import { NoiseParams } from './TerrainConstants';

const PANEL_SIZE   = 150;
const PANEL_MARGIN = 10;

/**
 * Manages the two greyscale overlay panels that visualise the individual
 * terrain layers (gradient and simplex noise) in the bottom-left corner.
 */
export class LayerOverlay {
  readonly scene:  THREE.Scene;
  readonly camera: THREE.OrthographicCamera;

  showLayers = false;

  private meshes: THREE.Mesh[] = [];
  private labelContainer: HTMLElement | null = null;

  constructor(w: number, h: number, contentArea: HTMLElement, noiseParams: NoiseParams) {
    this.scene  = new THREE.Scene();
    // Orthographic camera in pixel space: (0,w) × (0,h), Y up
    this.camera = new THREE.OrthographicCamera(0, w, h, 0, -1, 1);
    this.buildPanels(noiseParams);
    this.buildLabels(contentArea);
  }

  updateCamera(w: number, h: number): void {
    this.camera.left   = 0;
    this.camera.right  = w;
    this.camera.top    = h;
    this.camera.bottom = 0;
    this.camera.updateProjectionMatrix();
  }

  /** Sync noise params into the simplex overlay panel (index 1). */
  updateUniforms(noiseParams: NoiseParams): void {
    if (this.meshes.length < 2) return;
    const mat = this.meshes[1].material as THREE.ShaderMaterial;
    mat.uniforms.uNoiseScale.value       = noiseParams.scale;
    mat.uniforms.uNoiseOctaves.value     = noiseParams.octaves;
    mat.uniforms.uNoisePersistence.value = noiseParams.persistence;
    mat.uniforms.uNoiseLacunarity.value  = noiseParams.lacunarity;
  }

  /** Toggle both the showLayers flag and the label visibility. */
  setVisible(visible: boolean): void {
    this.showLayers = visible;
    this.applyLabelVisibility();
  }

  /** Hide labels without changing the showLayers flag (used when tab is inactive). */
  hideLabel(): void {
    if (this.labelContainer) this.labelContainer.style.display = 'none';
  }

  /** Show labels only when showLayers is true. */
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
    this.labelContainer?.remove();
    this.labelContainer = null;
  }

  private applyLabelVisibility(): void {
    if (this.labelContainer) {
      this.labelContainer.style.display = this.showLayers ? 'block' : 'none';
    }
  }

  private buildPanels(noiseParams: NoiseParams): void {
    const ps = PANEL_SIZE;
    const m  = PANEL_MARGIN;

    const makeOverlayMaterial = (layerIndex: number): THREE.ShaderMaterial =>
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: {
          uLayerIndex:       { value: layerIndex },
          uNoiseScale:       { value: noiseParams.scale },
          uNoiseOctaves:     { value: noiseParams.octaves },
          uNoisePersistence: { value: noiseParams.persistence },
          uNoiseLacunarity:  { value: noiseParams.lacunarity },
        },
        vertexShader:   layerOverlayVertexShader,
        fragmentShader: layerOverlayFragmentShader,
        side:       THREE.DoubleSide,
        depthTest:  false,
        depthWrite: false,
      });

    // Panel 1 — gradient layer (bottom-left corner)
    const mesh1 = new THREE.Mesh(new THREE.PlaneGeometry(ps, ps), makeOverlayMaterial(0));
    mesh1.position.set(m + ps / 2, m + ps / 2, 0);
    this.scene.add(mesh1);

    // Panel 2 — simplex noise layer (next to panel 1)
    const mesh2 = new THREE.Mesh(new THREE.PlaneGeometry(ps, ps), makeOverlayMaterial(1));
    mesh2.position.set(m * 2 + ps + ps / 2, m + ps / 2, 0);
    this.scene.add(mesh2);

    this.meshes = [mesh1, mesh2];
  }

  private buildLabels(contentArea: HTMLElement): void {
    const ps = PANEL_SIZE;
    const m  = PANEL_MARGIN;

    const container = document.createElement('div');
    container.style.cssText =
      'position:absolute;bottom:0;left:0;width:100%;height:100%;pointer-events:none;display:none;';

    const labelDefs = [
      { text: 'Layer 1: Gradient', x: m },
      { text: 'Layer 2: Simplex',  x: m * 2 + ps },
    ];

    for (const { text, x } of labelDefs) {
      const div = document.createElement('div');
      div.textContent = text;
      div.style.cssText = [
        'position:absolute',
        `left:${x}px`,
        `bottom:${m}px`,
        'color:#fff',
        'font-size:10px',
        'font-family:monospace',
        'background:rgba(0,0,0,0.65)',
        'padding:1px 4px',
        'border-radius:2px',
      ].join(';');
      container.appendChild(div);
    }

    contentArea.appendChild(container);
    this.labelContainer = container;
  }
}
