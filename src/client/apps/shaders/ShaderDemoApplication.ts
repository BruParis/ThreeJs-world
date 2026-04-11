/**
 * Shader Demo tab — flat heightfield terrain.
 *
 * Renders a single flat NxN grid on the XZ plane whose vertices are
 * displaced upward by Perlin FBM noise, letting you experiment with
 * every shader parameter in isolation before applying them to the sphere.
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

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_NOISE = { seed: 42, scale: 2.0, octaves: 4, persistence: 0.5, lacunarity: 2.0 };
const DEFAULT_AMPLITUDE    = 0.4;   // world units — max Y displacement
const DEFAULT_PATCH_SIZE   = 2.0;   // world units — XZ extent of the whole grid
const DEFAULT_SUBDIVISION  = 64;    // grid cells per side (power of 2)
const DEFAULT_NUM_PATCHES  = 4;     // total patches (must be a perfect square: 1, 4, 9, 16 …)

const SUBDIVISION_OPTIONS: Record<string, number> = {
  '1': 1, '2': 2, '4': 4, '8': 8, '16': 16,
  '32': 32, '64': 64, '128': 128, '256': 256, '512': 512,
};

const PATCH_OPTIONS: Record<string, number> = {
  '1 (1×1)': 1, '4 (2×2)': 4, '9 (3×3)': 9, '16 (4×4)': 16,
};

// ── ShaderDemoApplication ─────────────────────────────────────────────────────

export class ShaderDemoApplication implements TabApplication {
  // Three.js
  private renderer: THREE.WebGLRenderer | null = null;
  private orbitCamera: THREE.PerspectiveCamera | null = null;
  private scene: THREE.Scene | null = null;
  private controls: OrbitControls | null = null;
  private meshes: THREE.Mesh[] = [];

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
  private noiseType      = 0; // 0 = Perlin, 1 = Simplex

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

    window.addEventListener('resize', this.boundOnResize);
    this.clock.start();
    this.active = true;
  }

  public deactivate(): void {
    // Exit fly mode so pointer lock / key listeners don't linger
    if (this.flyCam?.isEnabled()) this.flyCam.disable();

    if (this.renderer) this.renderer.domElement.style.display = 'none';
    if (this.gui)      this.gui.domElement.style.display = 'none';

    window.removeEventListener('resize', this.boundOnResize);
    this.clock.stop();
    this.active = false;
  }

  public update(): void {
    if (!this.active || !this.renderer || !this.scene) return;

    const dt = this.clock.getDelta();

    if (this.flyCam?.isEnabled()) {
      this.flyCam.update(dt);
      // Clamp camera above the actual terrain surface
      const cam = this.flyCam.camera;
      const floor = this.sampleTerrainHeight(cam.position.x, cam.position.z) + 0.05;
      if (cam.position.y < floor) cam.position.y = floor;
      this.renderer.render(this.scene, this.flyCam.camera);
    } else {
      this.controls?.update();
      this.renderer.render(this.scene, this.orbitCamera!);
    }
  }

  public dispose(): void {
    window.removeEventListener('resize', this.boundOnResize);
    this.flyCam?.dispose();
    this.flyCam = null;
    this.disposeMeshes();
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

    // Fly camera — starts above-and-behind the patch
    const aspect = w / h;
    this.flyCam = new FlyCam(this.scene, this.renderer.domElement, aspect, {
      showDebugHelpers: false,
      sphereRadius:     0,   // flat world — no sphere floor
      minY:             0,   // terrain-aware floor is applied in update()
      near:             0.02,
      far:              200,
      baseSpeed:        1.5,
    });
    // Override default starting position to show the patch from a nice angle
    this.flyCam.camera.position.set(0, 1.5, 2.5);
    this.flyCam.camera.lookAt(0, 0, 0);
    this.flyCam.camera.updateMatrixWorld();

    // Permutation texture for seeded Perlin noise
    this.permTexture = this.buildPermTexture(this.noiseParams.seed);

    // Initial mesh
    this.rebuildMesh();

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
   * The mesh is translated to world position by the caller.
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

    // CCW winding when viewed from above (+Y)
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
        uNoiseType:        { value: this.noiseType },
        uNoiseScale:       { value: this.noiseParams.scale },
        uNoiseOctaves:     { value: this.noiseParams.octaves },
        uNoisePersistence: { value: this.noiseParams.persistence },
        uNoiseLacunarity:  { value: this.noiseParams.lacunarity },
        uAmplitude:        { value: this.amplitude },
        uColorMode:        { value: this.colorMode },
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
      mat.uniforms.uNoiseType.value        = this.noiseType;
      mat.uniforms.uNoiseScale.value        = this.noiseParams.scale;
      mat.uniforms.uNoiseOctaves.value      = this.noiseParams.octaves;
      mat.uniforms.uNoisePersistence.value  = this.noiseParams.persistence;
      mat.uniforms.uNoiseLacunarity.value   = this.noiseParams.lacunarity;
      mat.uniforms.uAmplitude.value         = this.amplitude;
      mat.uniforms.uColorMode.value         = this.colorMode;
      mat.wireframe = this.wireframe;
    }
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

    // ── Noise Type ────────────────────────────────────────────────────────────
    const noiseTypeGui    = this.gui.addFolder('Noise Type');
    const noiseTypeParams = { type: 'perlin' };

    noiseTypeGui
      .add(noiseTypeParams, 'type', { 'Perlin': 'perlin', 'Simplex': 'simplex' })
      .name('Algorithm')
      .onChange((v: string) => {
        this.noiseType = v === 'simplex' ? 1 : 0;
        seedController.domElement.closest('li')!.style.display =
          this.noiseType === 1 ? 'none' : '';
        this.updateUniforms();
      });

    noiseTypeGui.open();

    // ── Perlin / Simplex Noise ────────────────────────────────────────────────
    const noiseGui = this.gui.addFolder('Noise');

    // dat.gui mutates this.noiseParams in-place; onChange callbacks just read it.
    const seedController = noiseGui
      .add(this.noiseParams, 'seed', 0, 1000)
      .step(1)
      .name('Seed (Perlin)')
      .onChange((v: number) => {
        const old = this.permTexture;
        this.permTexture = this.buildPermTexture(v);
        old?.dispose();
        this.updateUniforms();
      });

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
  }
}
