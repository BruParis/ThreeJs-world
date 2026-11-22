# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Three.js + TypeScript boilerplate project that implements a tectonic plate simulation using halfedge data structures. 
The project has evolved from a basic Three.js boilerplate into a specialized visualization tool for spherical tessellation and plate tectonics modeling.
As the project develops, algorithms, data structures, and similar components should be progressively encapsulated into self-contained, reusable modules.

## Build and Development Commands

### Development
```bash
npm run dev
```
Starts webpack-dev-server on http://127.0.0.1:8080 with hot module reloading. The dev server serves from `dist/client/`.

The dev will be manually setting up the server, the agent should not attempt to automate this process.

### Production Build
No Production build for now

### Production Server
No production server for now

## Architecture

### Client/Server Split

- **Client** (`src/client/`): Three.js visualization running in the browser, compiled via webpack
- **Server** (`src/server/`): Minimal Express server for production deployment, compiled via tsc

The server is only needed for production deployment. Development uses webpack-dev-server.

### Application Structure

The client code is organized by purpose and domain:

```
src/client/
├── core/                           # Halfedge data structure
│   ├── Halfedge.ts                 # Edge representation with twin pointers
│   ├── HalfedgeGraph.ts            # Main container for vertices, faces, halfedges
│   ├── Vertex.ts, Face.ts          # Basic geometric elements
│   ├── HalfedgeGraphUtils.ts       # Subdivision, dual graph, distortion
│   └── operations/                 # Topological operations (add/remove/split/flip)
│
├── tectonics/                      # Tectonic plate simulation domain
│   ├── data/
│   │   ├── Plate.ts                # Data structures: Tile, Plate, TectonicSystem, BoundaryEdge
│   │   └── PlateOperations.ts      # Operations: flood-fill, absorb, transfer, split
│   ├── simulation/
│   │   └── Tectonics.ts            # High-level orchestration: build, motion, boundaries
│   ├── dynamics/
│   │   └── dynamics.ts             # Motion computation and boundary characterization
│   └── geometry/
│       └── IcosahedronMesh.ts      # Icosahedron initialization for primal graph
│
├── visualization/                  # Three.js rendering utilities
│   └── TectonicsDrawingUtils.ts    # LineSegments2 creation for plates, tiles, boundaries
│
├── managers/                       # Business logic orchestration
│   ├── SceneManager.ts             # Three.js scene, camera, renderer setup
│   ├── VisualizationManager.ts     # Mesh/material/line management, rebuild logic
│   └── TectonicManager.ts          # Tectonic system management, coloring, operations
│
├── handlers/                       # User interaction
│   └── InteractionHandler.ts       # Mouse clicks, raycasting, selection
│
├── controllers/                    # Control flow
│   └── AnimationController.ts      # Animation loop coordination
│
├── utils/                          # Shared utilities
│   └── ColorUtils.ts               # Color conversion, vertex color assignment
│
├── Application.ts                  # Main app orchestrator
└── client.ts                       # Entry point
```

### Halfedge Data Structure

The core of this project is a custom implementation of the halfedge data structure. 
The halfedge structure is located in `src/client/core/`:

- **HalfedgeGraph**: Main container managing vertices, faces, and halfedges
  - Uses `Map<string, Halfedge>` for halfedges (keyed by vertex IDs)
  - Uses `Map<number, Vertex>` for vertices
  - Uses `Set<Face>` for faces
  - Changed from Arrays to Maps for performance optimization

- **Halfedge**: Edge representation with dual direction (twin)
  - Each edge has `next`, `prev`, `twin` pointers
  - Contains `vertex` (origin vertex) and optional `face`
  - Provides `nextLoop()` and `prevLoop()` generators for traversing face boundaries
  - ID format: `vertex.id-twin.vertex.id`

- **Vertex**: Stores position (THREE.Vector3) and reference to one outgoing halfedge

- **Face**: Represents a polygon via a reference to one of its boundary halfedges

- **Operations** (`src/client/core/operations/`): Topological operations on the graph
  - `addVertex`, `addEdge`, `addFace`
  - `removeVertex`, `removeEdge`, `removeFace`
  - `splitEdge`: Splits an edge by inserting a new vertex
  - `flipEdge`: Flips edge shared by two triangular faces

### Tectonic Plate System

The project implements a spherical tectonic plate simulation:

- **Dual Graph Pattern**: The icosahedron (primal graph) is subdivided and its dual graph is computed
  - Primal: triangular mesh created by subdividing an icosahedron
  - Dual: polygonal mesh where each vertex corresponds to a primal face
  - The dual graph vertices are normalized to lie on a sphere

- **Tile and Plate Hierarchy** (`tectonics/data/Plate.ts`):
  - **Tile**: Individual polygon in the dual graph, represents a region
    - Has a centroid and motion speed vector
    - Belongs to exactly one Plate
    - Provides `loop()` generator to iterate over boundary halfedges

  - **Plate**: Collection of adjacent tiles forming a tectonic plate
    - Maintains `borderEdge2TileMap` for boundary tracking
    - Has category (CONTINENTAL, OCEANIC, MICROPLATE, DEFORMATION)
    - Computes centroid and rotation (angular velocity)

  - **TectonicSystem**: Global manager for all plates
    - Maps edges to tiles (`edge2TileMap`)
    - Maps edges to boundaries (`edge2BoundaryMap`)
    - Manages plate boundaries and their characterization (convergent, divergent, transform)

- **Key Algorithms**:
  - **tectonics/simulation/Tectonics.ts**: High-level orchestration
    - `buildTectonicSystem`: Initializes random plate distribution via region growing
    - `computeTectonicMotion`: Wrapper that calls dynamics computation
    - `computePlateBoundaries`: Identifies edges between different plates
    - `caracterizePlateBoundaries`: Classifies boundaries by relative motion

  - **tectonics/data/PlateOperations.ts**: Structural operations
    - `floodFill`: Region growing algorithm for plate distribution
    - `splitPlateFromTile`: Splits a plate into two separate plates
    - `transferTileToPlate`: Moves a tile from one plate to another
    - `plateAbsorbedByPlate`: Merges one plate into another

  - **tectonics/dynamics/dynamics.ts**: Motion computation
    - `computeTectonicDynamics`: Assigns random rotation axes to plates, computes tile motion vectors
    - `caracterizeBoundaryEdge`: Classifies boundary edges by relative motion (convergent, divergent, transform)

### Terrain Shader Pipeline (Shaders tab + World tab)

The Shaders tab (flat patch) and the World tab (sphere LOD, Terrain / Elevation color modes) render the same terrain from the same parameters:

- `shared/terrain/TerrainParams.ts`: the single parameter store (noise, erosion, trees, colors, real-world scale). Controls write to it and call `notify(kind)`; both tabs listen.
- Scale: noise positions are in terrain units, `P = position_km / kmPerUnit`; relief is `(elevation - seaLevel) * elevationAmplitudeKm`, exaggerated by `elevationDisplayScale`. Helpers are in `shared/world/World.ts`.
- The terrain is a function of the 3D position on the planet (`core/noise/fractalNoise3GLSL.ts`, `core/shaders/erosion3GLSL.ts`), so it is seamless across patches, LOD levels and cube faces.
- `core/terrain/PatchDomain.ts`: maps a patch square onto the planet as a grid of directions (`spherePatchDomain` for quadtree cells, `tangentPatchDomain` for the flat patch).
- `core/terrain/TerrainPatchBaker.ts`: bakes a patch's textures (elevation + 3D gradient, erosion attributes, tree density, bump, detail) on the tab's own renderer.
- `core/terrain/TerrainMaterial.ts`: the patched `MeshStandardMaterial` used by both tabs. Geometry contract: `position` = undisplaced position, `normal` = direction on the planet, `uv` = patch coordinate.
- World: `apps/world/lod/TerrainPatchOperation.ts` (terrain) and `TileShaderPatchOperation.ts` (flat plate / geology / LOD overlays), switched by `LODTileRenderer.setPatchOperation`.

### Path Aliasing

Both webpack and TypeScript use `@core/*` alias:
- Points to `src/client/core/*`
- Defined in `tsconfig.json` (paths) and `webpack.dev.js` (resolve.alias)
- Use `import { Halfedge } from '@core/Halfedge'` instead of relative paths

### Visualization Stack

- **Three.js**: 3D rendering (r0.168.0)
- **dat.GUI**: Runtime controls for subdivision degree, visibility toggles, plate rebuild
- **OrbitControls**: Camera manipulation
- **CSS2DRenderer**: Label overlays
- **LineSegments2/LineMaterial**: Wide lines for plate boundaries and motion vectors
- **Raycasting**: Face selection via mouse clicks

The main scene contains:
- Icosahedron mesh (primal graph) - usually hidden
- Dual mesh (polygonal tiles) - color-coded by plate
- Various LineSegments2 for visualizing graph edges, plate boundaries, tile boundaries, and motion vectors

## Development Workflow

### Making Changes to Halfedge Operations

When modifying the halfedge structure or operations, note:
- The structure maintains topological invariants (every halfedge has a twin, prev/next form loops)
- Operations in `core/operations/` are the only safe way to modify the structure
- Always update both directions when adding/removing halfedges
- The `id` property on Halfedge is computed, not stored

### Modifying the Tectonic Simulation

The tectonic simulation is managed by `TectonicManager` (`managers/TectonicManager.ts`):
- The GUI includes a "Rebuild Plates" button which calls `TectonicManager.rebuildTectonicPlates()`
- The subdivision degree can be changed (0-7) which triggers a full rebuild via `VisualizationManager.rebuildIcosahedron()`
- Plate coloring is handled by `TectonicManager.colorTectonicSystem()`

Key interaction modes (handled by `InteractionHandler`):
- Click on dual mesh to select a tile/plate
- Selection displays: tile edges (thick lines), plate edges (thicker lines), boundaries (thickest)
- Available operations: `splitPlateAtEdge`, `transferTileAtEdge`, `absorbPlateFromEdge` (implemented in TectonicManager)

### TypeScript Configuration

- **Client** (`src/client/tsconfig.json`):
  - Target: ES6
  - moduleResolution: bundler (for webpack)
  - Strict mode enabled

- **Server** (`src/server/tsconfig.json`):
  - Target: ES2019
  - Module: commonjs
  - Output: `dist/server/`
  - esModuleInterop enabled for Express compatibility

## Common Patterns

### Iterating Over Face Boundaries
```typescript
for (const he of face.halfedge.nextLoop()) {
  // he is a halfedge on the face boundary
  const vertex = he.vertex;
  const nextVertex = he.next.vertex;
}
```

### Finding Opposite Face
```typescript
const oppositeFace = halfedge.twin.face;
```

### Adding Geometry to Scene
Always preserve rotation when rebuilding meshes:
```typescript
let rotation: THREE.Euler | null = null;
if (existingMesh) {
  rotation = existingMesh.rotation.clone();
  scene.remove(existingMesh);
}
// ... create new mesh ...
if (rotation) {
  newMesh.rotation.copy(rotation);
}
scene.add(newMesh);
```

### Color Assignment
Use `assignColorToTriangle()` to set vertex colors for an entire triangle. The dual mesh uses vertex colors extensively for plate visualization.

### Doc
The doc/ folder is not real software documentation. Just some draft, notes on ideas. Do not read them unless beign specifically prompted to do so.

## Branch Structure

This repository has multiple feature branches (stats, statsgui, socketio, cannonjs, etc.) demonstrating different Three.js capabilities. The master branch is the minimal baseline without these features.
