/**
 * Shader Demo tab — flat heightfield terrain.
 *
 * Elevation is produced by blending two layers:
 *   Layer 1 – diagonal gradient across the patch
 *   Layer 2 – simplex FBM noise
 *
 * When "Show Layers" is enabled two greyscale overlay panels appear in the
 * bottom-left corner of the viewport, one per layer, so you can inspect each
 * contribution independently.
 *
 * Camera: OrbitControls by default; switch to free FlyCam via the GUI.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GUI } from 'dat.gui';
import { TabApplication } from '../../tabs/TabManager';
import { PerlinNoise3D } from '@core/noise/PerlinNoise';
import { FlyCam } from '@core/FlyCam';
import { demoVertexShader } from './shaders/demoVert';
import { demoFragmentShader } from './shaders/demoFrag';
import { layerOverlayVertexShader } from './shaders/layerOverlayVert';
import { layerOverlayFragmentShader } from './shaders/layerOverlayFrag';

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_NOISE = { seed: 42, scale: 2.0, octaves: 4, persistence: 0.5, lacunarity: 2.0 };
const DEFAULT_AMPLITUDE    = 0.4;   // world units — max Y displacement
const DEFAULT_PATCH_SIZE   = 2.0;   // world units — XZ extent of the whole grid
const DEFAULT_SUBDIVISION  = 64;    // grid cells per side (power of 2)
const DEFAULT_NUM_PATCHES  = 4;     // total patches (must be a perfect square: 1, 4, 9, 16 …)
const DEFAULT_LAYER_MIX    = 0.5;   // 0 = gradient only, 1 = simplex only

// Overlay panel dimensions (in pixels, independent of canvas size)
const PANEL_SIZE   = 150;
const PANEL_MARGIN = 10;

const SUBDIVISION_OPTIONS: Record<string, number> = {
  '1': 1, '2': 2, '4': 4, '8': 8, '16': 16,
  '32': 32, '64': 64, '128': 128, '256': 256, '512': 512,
};

const PATCH_OPTIONS: Record<string, number> = {
  '1 (1×1)': 1, '4 (2×2)': 4, '9 (3×3)': 9, '16 (4×4)': 16,
};

// ── ShaderDemoApplication ─────────────────────────────────────────────────────

export class ShaderDemoApplication implements TabApplication {
  // Three.js — main scene
  private renderer: THREE.WebGLRenderer | null = null;
  private orbitCamera: THREE.PerspectiveCamera | null = null;
  private scene: THREE.Scene | null = null;
  private controls: OrbitControls | null = null;
  private meshes: THREE.Mesh[] = [];

  // Three.js — layer overlay
  private overlayScene: THREE.Scene | null = null;
  private overlayCamera: THREE.OrthographicCamera | null = null;
  private overlayMeshes: THREE.Mesh[] = [];
  private layerLabelContainer: HTMLElement | null = null;

  // Fly camera
  private flyCam: FlyCam | null = null;
  private readonly clock = new THREE.Clock();

  // GUI
  private gui: GUI | null = null;

  // Shader / geometry state
  private noiseParams    = { ...DEFAULT_NOISE };
  private permTexture: THREE.DataTexture | null = null;
  private perlinInstance: PerlinNoise3D | null = null;
  private amplitude      = DEFAULT_AMPLITUDE;
  private patchSize      = DEFAULT_PATCH_SIZE;
  private subdivisions   = DEFAULT_SUBDIVISION;
  private numPatches     = DEFAULT_NUM_PATCHES;
  private wireframe      = false;
  private colorMode      = 0; // 0 = terrain, 1 = greyscale
  private layerMix       = DEFAULT_LAYER_MIX;
  private showLayers     = false;

  private initialized = false;
  private active = false;
  private readonly boundOnResize: () => void;

  constructor() {
    this.boundOnResize = this.onResize.bind(this);
  }

  // ── TabApplication ─────────────────────────────────────────────────────────

  public activate(): void {
    if (!this.initialized) {
      this.initialize();
    }

    if (this.renderer) this.renderer.domElement.style.display = 'block';
    if (this.gui)      this.gui.domElement.style.display = 'block';
    if (this.layerLabelContainer && this.showLayers) {
      this.layerLabelContainer.style.display = 'block';
    }

    window.addEventListener('resize', this.boundOnResize);
    this.clock.start();
    this.active = true;
  }

  public deactivate(): void {
    // Exit fly mode so pointer lock / key listeners don't linger
    if (this.flyCam?.isEnabled()) this.flyCam.disable();

    if (this.renderer) this.renderer.domElement.style.display = 'none';
    if (this.gui)      this.gui.domElement.style.display = 'none';
    if (this.layerLabelContainer) this.layerLabelContainer.style.display = 'none';

    window.removeEventListener('resize', this.boundOnResize);
    this.clock.stop();
    this.active = false;
  }

  public update(): void {
    if (!this.active || !this.renderer || !this.scene) return;

    const dt = this.clock.getDelta();

    let renderCam: THREE.PerspectiveCamera;
    if (this.flyCam?.isEnabled()) {
      this.flyCam.update(dt);
      const cam = this.flyCam.camera;
      const floor = this.sampleTerrainHeight(cam.position.x, cam.position.z) + 0.05;
      if (cam.position.y < floor) cam.position.y = floor;
      renderCam = this.flyCam.camera;
    } else {
      this.controls?.update();
      renderCam = this.orbitCamera!;
    }

    this.renderer.render(this.scene, renderCam);

    // Render layer overlay panels on top without clearing the frame
    if (this.showLayers && this.overlayScene && this.overlayCamera) {
      this.renderer.autoClear = false;
      this.renderer.render(this.overlayScene, this.overlayCamera);
      this.renderer.autoClear = true;
    }
  }

  public dispose(): void {
    window.removeEventListener('resize', this.boundOnResize);
    this.flyCam?.dispose();
    this.flyCam = null;
    this.disposeMeshes();
    this.disposeOverlay();
    this.permTexture?.dispose();
    this.permTexture = null;
    this.controls?.dispose();
    if (this.renderer) {
      this.renderer.domElement.remove();
      this.renderer.dispose();
      this.renderer = null;
    }
    this.gui?.destroy();
    this.gui = null;
    this.initialized = false;
  }

  // ── Initialisation ─────────────────────────────────────────────────────────

  private initialize(): void {
    const contentArea = this.getContentArea();
    const w = contentArea.clientWidth;
    const h = contentArea.clientHeight;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);
    this.scene.add(new THREE.GridHelper(4, 16, 0x333355, 0x222244));
    this.scene.add(new THREE.AxesHelper(1.2));

    // Orbit camera — default view: above and slightly behind the patch
    this.orbitCamera = new THREE.PerspectiveCamera(60, w / h, 0.01, 200);
    this.orbitCamera.position.set(0, 2.0, 2.5);
    this.orbitCamera.lookAt(0, 0, 0);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(w, h);
    this.renderer.domElement.style.position = 'absolute';
    this.renderer.domElement.style.top  = '0';
    this.renderer.domElement.style.left = '0';
    this.renderer.domElement.style.display = 'none';
    contentArea.appendChild(this.renderer.domElement);

    // Orbit controls
    this.controls = new OrbitControls(this.orbitCamera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 0, 0);

    // Fly camera
    const aspect = w / h;
    this.flyCam = new FlyCam(this.scene, this.renderer.domElement, aspect, {
      showDebugHelpers: false,
      sphereRadius:     0,
      minY:             0,
      near:             0.02,
      far:              200,
      baseSpeed:        1.5,
    });
    this.flyCam.camera.position.set(0, 1.5, 2.5);
    this.flyCam.camera.lookAt(0, 0, 0);
    this.flyCam.camera.updateMatrixWorld();

    // Permutation texture (kept for potential Perlin use)
    this.permTexture = this.buildPermTexture(this.noiseParams.seed);

    // Initial mesh
    this.rebuildMesh();

    // Layer overlay
    this.setupOverlay(w, h, contentArea);

    // GUI
    this.setupGUI(contentArea);

    this.initialized = true;
  }

  // ── Geometry & material ────────────────────────────────────────────────────

  private buildPermTexture(seed: number): THREE.DataTexture {
    this.perlinInstance = new PerlinNoise3D(seed);
    const perm = this.perlinInstance.getPermutation256();
    const data = new Float32Array(256);
    for (let i = 0; i < 256; i++) data[i] = perm[i];
    const tex = new THREE.DataTexture(data, 256, 1, THREE.RedFormat, THREE.FloatType);
    tex.minFilter      = THREE.NearestFilter;
    tex.magFilter      = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate    = true;
    return tex;
  }

  /** Sample terrain height at world XZ — mirrors the vertex shader formula. */
  private sampleTerrainHeight(wx: number, wz: number): number {
    if (!this.perlinInstance) return 0;
    const { scale, octaves, persistence, lacunarity } = this.noiseParams;
    const noise = this.perlinInstance.fbm(
      wx * scale, 0, wz * scale,
      octaves, persistence, lacunarity,
      1.0,
    );
    return (noise * 0.5 + 0.5) * this.amplitude;
  }

  /**
   * Flat NxN grid for a single patch on the XZ plane, local coords [0, cellSize].
   * The vertex shader samples noise in world space, so patches are seamless.
   */
  private buildPatchGeometry(cellSize: number): THREE.BufferGeometry {
    const n = this.subdivisions;

    const positions: number[] = [];
    for (let i = 0; i <= n; i++) {
      const x = cellSize * (i / n);
      for (let j = 0; j <= n; j++) {
        const z = cellSize * (j / n);
        positions.push(x, 0, z);
      }
    }

    const indices: number[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const tl = i * (n + 1) + j;
        const tr = tl + 1;
        const bl = (i + 1) * (n + 1) + j;
        const br = bl + 1;
        indices.push(tl, tr, bl, tr, br, bl);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    return geo;
  }

  private buildMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uPermTex:          { value: this.permTexture },
        uNoiseScale:       { value: this.noiseParams.scale },
        uNoiseOctaves:     { value: this.noiseParams.octaves },
        uNoisePersistence: { value: this.noiseParams.persistence },
        uNoiseLacunarity:  { value: this.noiseParams.lacunarity },
        uAmplitude:        { value: this.amplitude },
        uColorMode:        { value: this.colorMode },
        uLayerMix:          { value: this.layerMix },
        uPatchHalfSize:    { value: this.patchSize / 2 },
      },
      vertexShader:   demoVertexShader,
      fragmentShader: demoFragmentShader,
      side:      THREE.DoubleSide,
      wireframe: this.wireframe,
    });
  }

  private disposeMeshes(): void {
    if (!this.scene) return;
    for (const mesh of this.meshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.ShaderMaterial).dispose();
    }
    this.meshes = [];
  }

  /** Full geometry + material rebuild (needed on subdivision, patch count, or patch-size change). */
  private rebuildMesh(): void {
    this.disposeMeshes();
    if (!this.scene) return;

    const patchesPerSide = Math.round(Math.sqrt(this.numPatches));
    const cellSize       = this.patchSize / patchesPerSide;
    const half           = this.patchSize / 2;

    for (let row = 0; row < patchesPerSide; row++) {
      for (let col = 0; col < patchesPerSide; col++) {
        const mesh = new THREE.Mesh(this.buildPatchGeometry(cellSize), this.buildMaterial());
        mesh.position.set(-half + col * cellSize, 0, -half + row * cellSize);
        this.scene.add(mesh);
        this.meshes.push(mesh);
      }
    }
  }

  /** Push current state into existing ShaderMaterial uniforms (no geometry rebuild). */
  private updateUniforms(): void {
    for (const mesh of this.meshes) {
      const mat = mesh.material as THREE.ShaderMaterial;
      mat.uniforms.uPermTex.value          = this.permTexture;
      mat.uniforms.uNoiseScale.value        = this.noiseParams.scale;
      mat.uniforms.uNoiseOctaves.value      = this.noiseParams.octaves;
      mat.uniforms.uNoisePersistence.value  = this.noiseParams.persistence;
      mat.uniforms.uNoiseLacunarity.value   = this.noiseParams.lacunarity;
      mat.uniforms.uAmplitude.value         = this.amplitude;
      mat.uniforms.uColorMode.value         = this.colorMode;
      mat.uniforms.uLayerMix.value           = this.layerMix;
      mat.uniforms.uPatchHalfSize.value     = this.patchSize / 2;
      mat.wireframe = this.wireframe;
    }
    this.updateOverlayUniforms();
  }

  // ── Layer overlay ──────────────────────────────────────────────────────────

  private setupOverlay(w: number, h: number, contentArea: HTMLElement): void {
    this.overlayScene = new THREE.Scene();

    // Orthographic camera in pixel space: (0,w) × (0,h), Y up
    this.overlayCamera = new THREE.OrthographicCamera(0, w, h, 0, -1, 1);

    const ps = PANEL_SIZE;
    const m  = PANEL_MARGIN;

    const makeOverlayMaterial = (layerIndex: number): THREE.ShaderMaterial =>
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: {
          uLayerIndex:       { value: layerIndex },
          uNoiseScale:       { value: this.noiseParams.scale },
          uNoiseOctaves:     { value: this.noiseParams.octaves },
          uNoisePersistence: { value: this.noiseParams.persistence },
          uNoiseLacunarity:  { value: this.noiseParams.lacunarity },
        },
        vertexShader:   layerOverlayVertexShader,
        fragmentShader: layerOverlayFragmentShader,
        side:       THREE.DoubleSide,
        depthTest:  false,
        depthWrite: false,
      });

    // Panel 1 — gradient layer (bottom-left corner)
    const geo1  = new THREE.PlaneGeometry(ps, ps);
    const mesh1 = new THREE.Mesh(geo1, makeOverlayMaterial(0));
    mesh1.position.set(m + ps / 2, m + ps / 2, 0);
    this.overlayScene.add(mesh1);

    // Panel 2 — simplex noise layer (next to panel 1)
    const geo2  = new THREE.PlaneGeometry(ps, ps);
    const mesh2 = new THREE.Mesh(geo2, makeOverlayMaterial(1));
    mesh2.position.set(m * 2 + ps + ps / 2, m + ps / 2, 0);
    this.overlayScene.add(mesh2);

    this.overlayMeshes = [mesh1, mesh2];

    // HTML labels positioned over the panels
    this.setupLayerLabels(contentArea);
  }

  private setupLayerLabels(contentArea: HTMLElement): void {
    const container = document.createElement('div');
    container.style.cssText =
      'position:absolute;bottom:0;left:0;width:100%;height:100%;pointer-events:none;display:none;';

    const ps = PANEL_SIZE;
    const m  = PANEL_MARGIN;

    const labelDefs = [
      { text: 'Layer 1: Gradient', x: m },
      { text: 'Layer 2: Simplex',  x: m * 2 + ps },
    ];

    for (const { text, x } of labelDefs) {
      const div = document.createElement('div');
      div.textContent = text;
      div.style.cssText = [
        `position:absolute`,
        `left:${x}px`,
        `bottom:${m}px`,
        `color:#fff`,
        `font-size:10px`,
        `font-family:monospace`,
        `background:rgba(0,0,0,0.65)`,
        `padding:1px 4px`,
        `border-radius:2px`,
      ].join(';');
      container.appendChild(div);
    }

    contentArea.appendChild(container);
    this.layerLabelContainer = container;
  }

  private updateOverlayCamera(w: number, h: number): void {
    if (!this.overlayCamera) return;
    this.overlayCamera.left   = 0;
    this.overlayCamera.right  = w;
    this.overlayCamera.top    = h;
    this.overlayCamera.bottom = 0;
    this.overlayCamera.updateProjectionMatrix();
  }

  /** Sync noise params into the simplex overlay panel (panel index 1). */
  private updateOverlayUniforms(): void {
    if (this.overlayMeshes.length < 2) return;
    const mat = this.overlayMeshes[1].material as THREE.ShaderMaterial;
    mat.uniforms.uNoiseScale.value       = this.noiseParams.scale;
    mat.uniforms.uNoiseOctaves.value     = this.noiseParams.octaves;
    mat.uniforms.uNoisePersistence.value = this.noiseParams.persistence;
    mat.uniforms.uNoiseLacunarity.value  = this.noiseParams.lacunarity;
  }

  private disposeOverlay(): void {
    if (this.overlayScene) {
      for (const mesh of this.overlayMeshes) {
        this.overlayScene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.ShaderMaterial).dispose();
      }
    }
    this.overlayMeshes   = [];
    this.overlayScene    = null;
    this.overlayCamera   = null;
    this.layerLabelContainer?.remove();
    this.layerLabelContainer = null;
  }

  // ── GUI ────────────────────────────────────────────────────────────────────

  private setupGUI(contentArea: HTMLElement): void {
    this.gui = new GUI({ autoPlace: false });
    contentArea.appendChild(this.gui.domElement);
    this.gui.domElement.style.position = 'absolute';
    this.gui.domElement.style.top      = '0';
    this.gui.domElement.style.right    = '0';
    this.gui.domElement.style.display  = 'none';

    // ── Camera ───────────────────────────────────────────────────────────────
    const camGui    = this.gui.addFolder('Camera');
    const camParams = { flyCam: false };
    camGui
      .add(camParams, 'flyCam')
      .name('Fly Camera')
      .onChange((enabled: boolean) => {
        if (!this.flyCam || !this.controls) return;
        if (enabled) {
          this.controls.enabled = false;
          this.flyCam.enable();
        } else {
          this.flyCam.disable();
          this.controls.enabled = true;
        }
      });
    camGui.open();

    // ── Patch ─────────────────────────────────────────────────────────────────
    const patchGui    = this.gui.addFolder('Patch');
    const patchParams = {
      size:        this.patchSize,
      numPatches:  this.numPatches,
      subdivision: this.subdivisions,
      wireframe:   this.wireframe,
    };

    patchGui
      .add(patchParams, 'size', 0.5, 8.0)
      .step(0.5)
      .name('Size')
      .onChange((v: number) => {
        this.patchSize = v;
        this.rebuildMesh();
      });

    patchGui
      .add(patchParams, 'numPatches', PATCH_OPTIONS)
      .name('Patches')
      .onChange((v: number) => {
        this.numPatches = v;
        this.rebuildMesh();
      });

    patchGui
      .add(patchParams, 'subdivision', SUBDIVISION_OPTIONS)
      .name('Subdivision')
      .onChange((v: number) => {
        this.subdivisions = Number(v);
        this.rebuildMesh();
      });

    patchGui
      .add(patchParams, 'wireframe')
      .name('Wireframe')
      .onChange((v: boolean) => {
        this.wireframe = v;
        this.updateUniforms();
      });

    patchGui.open();

    // ── Layers ────────────────────────────────────────────────────────────────
    const layersGui    = this.gui.addFolder('Layers');
    const layersParams = { showLayers: this.showLayers, mix: this.layerMix };

    layersGui
      .add(layersParams, 'showLayers')
      .name('Show Layers')
      .onChange((v: boolean) => {
        this.showLayers = v;
        if (this.layerLabelContainer) {
          this.layerLabelContainer.style.display = v ? 'block' : 'none';
        }
      });

    layersGui
      .add(layersParams, 'mix', 0.0, 1.0)
      .step(0.01)
      .name('Mix (Grad→Simplex)')
      .onChange((v: number) => {
        this.layerMix = v;
        this.updateUniforms();
      });

    layersGui.open();

    // ── Noise ─────────────────────────────────────────────────────────────────
    const noiseGui = this.gui.addFolder('Noise (Layer 2)');

    noiseGui
      .add(this.noiseParams, 'scale', 0.5, 10.0)
      .step(0.1)
      .name('Scale')
      .onChange(() => this.updateUniforms());

    noiseGui
      .add(this.noiseParams, 'octaves', 1, 8)
      .step(1)
      .name('Octaves')
      .onChange(() => this.updateUniforms());

    noiseGui
      .add(this.noiseParams, 'persistence', 0.1, 1.0)
      .step(0.05)
      .name('Persist.')
      .onChange(() => this.updateUniforms());

    noiseGui
      .add(this.noiseParams, 'lacunarity', 1.0, 4.0)
      .step(0.1)
      .name('Lacunar.')
      .onChange(() => this.updateUniforms());

    noiseGui.open();

    // ── Elevation ─────────────────────────────────────────────────────────────
    const elevGui    = this.gui.addFolder('Elevation');
    const elevParams = { amplitude: this.amplitude };

    elevGui
      .add(elevParams, 'amplitude', 0.0, 2.0)
      .step(0.05)
      .name('Amplitude')
      .onChange((v: number) => {
        this.amplitude = v;
        this.updateUniforms();
      });

    elevGui.open();

    // ── Color ─────────────────────────────────────────────────────────────────
    const colorGui    = this.gui.addFolder('Color');
    const colorParams = { mode: 'terrain' };

    colorGui
      .add(colorParams, 'mode', { 'Terrain': 'terrain', 'Greyscale': 'greyscale' })
      .name('Mode')
      .onChange((v: string) => {
        this.colorMode = v === 'greyscale' ? 1 : 0;
        this.updateUniforms();
      });

    colorGui.open();
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private getContentArea(): HTMLElement {
    return document.getElementById('content-area') || document.body;
  }

  private onResize(): void {
    if (!this.renderer || !this.orbitCamera) return;
    const contentArea = this.getContentArea();
    const w = contentArea.clientWidth;
    const h = contentArea.clientHeight;
    this.renderer.setSize(w, h);
    this.orbitCamera.aspect = w / h;
    this.orbitCamera.updateProjectionMatrix();
    this.flyCam?.updateAspect(w / h);
    this.updateOverlayCamera(w, h);
  }
}
