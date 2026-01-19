import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GUI } from 'dat.gui'
import { debounce } from 'lodash';
import { HalfedgeDS } from 'three-mesh-halfedge';
import { Halfedge } from '@core/Halfedge';
import { HalfedgeGraph } from '@core/HalfedgeGraph';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { populateIcosahedronHalfedgeDS, populateIcosahedronHalfedgeGraph } from './components/IcosahedronMesh';
import { populateTetrahedronHalfedgeDS, populateTetrahedronHalfedgeGraph } from './components/TetrahedronMesh';
import {
  makeBufferGeometryFromHalfedgeGraph,
  makeBufferGeometryFromLoops,
  subdivideTrianglesLoop,
  normalizeVertices,
  populateDualGraph,
  makeLineSegments2FromHalfedgeGraph,
  distortGraph,
  distortGraphLoop,
  makeFaceDistribution
} from '@core/HalfedgeGraphUtils';
import { FaceDistribution } from '@core/HalfedgeGraphUtils';
import { TectonicSystem, Plate } from './components/Plate';
import {
  splitPlateFromTile,
  transferTileToPlate,
  plateAbsorbedByPlate,
} from './components/PlateUtils';
import { 
  buildTectonicSystem, 
  computeTectonicMotion, 
  computePlateBoundaries,
  caracterizePlateBoundaries
} from './components/Tectonics';
import {
  makeLineSegments2FromTile,
  makeLineSegments2FromPlate,
  makeLineSegments2ForTileMotionSpeed,
  makeLineSegments2FromBoundary
} from './components/TectonicsDrawingUtils';

const ROTATION_SPEED = 0.0001;
const MIN_DEGREE = 0;
const MAX_DEGREE = 7;

const scene = new THREE.Scene();
// add axis x, y, z 
const axesHelper = new THREE.AxesHelper(2);
scene.add(axesHelper);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0px';
labelRenderer.domElement.style.pointerEvents = 'none'; // Let mouse events pass through
document.body.appendChild(labelRenderer.domElement);

// var text = document.createElement('div');
// text.className = 'label';
// text.style.color = 'white';
// text.textContent = 'Origin';
// text.style.backgroundColor = 'transparent';
// 
// const originLabel = new CSS2DObject(text);
// originLabel.position.set(0, 0, 0);
// scene.add(originLabel);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 2;

const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function render() {
  renderer.render(scene, camera);
}

window.addEventListener('resize', onWindowResize, false);
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  render();
}

// Icosahedron setup
let icosahedron: THREE.Mesh;
const icosahedronMaterial = new THREE.MeshBasicMaterial({
  // color: 0x33ffac,
  color: 0xffffff,
  vertexColors: true,
  wireframe: true,
  visible: false,
  side: THREE.FrontSide,
});

const icoHalfedgeGraph = new HalfedgeGraph();
const icoHalfedgeDualGraph = new HalfedgeGraph();

let icoParams = {
  degree: 2,
  numVertices: 0,
  numFaces: 0,
  numHalfedges: 0
};

let icoDualParams = {
  pentagons: 0,
  hexagons: 0,
  heptagons: 0
};

const graphLinesMaterial = new LineMaterial({
  linewidth: 2,
  depthTest: true,
  depthWrite: false,
  vertexColors: true,
  visible: false,
});
const tileLinesMaterial = new LineMaterial({
  linewidth: 4,
  depthTest: true,
  vertexColors: true,
  visible: true,
});
const plateLinesMaterial = new LineMaterial({
  linewidth: 6,
  depthTest: true,
  vertexColors: true,
  visible: true,
});
const motionSpeedLinesMaterial = new LineMaterial({
  linewidth: 1,
  depthTest: true,
  depthWrite: true,
  vertexColors: true,
  visible: true,
});
const boundaryLinesMaterial = new LineMaterial({
  linewidth: 8,
  depthTest: true,
  depthWrite: true,
  vertexColors: true,
  visible: true,
});

const halfedgeGraphLines = new LineSegments2(new LineSegmentsGeometry(), graphLinesMaterial);
const tileLines = new LineSegments2(new LineSegmentsGeometry(), tileLinesMaterial);
const plateLines = new LineSegments2(new LineSegmentsGeometry(), plateLinesMaterial);
const motionSpeedLines = new LineSegments2(new LineSegmentsGeometry(), motionSpeedLinesMaterial);
const boundaryLines = new LineSegments2(new LineSegmentsGeometry(), boundaryLinesMaterial);

let dualMesh: THREE.Mesh;
const dualMaterial = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  vertexColors: true,
  wireframe: false,
  visible: true,
  side: THREE.FrontSide,
});

let tectonicSystem: TectonicSystem;

function idToHSLColor(id: number): THREE.Color {
  const hash = id * 0x1010101;
  const hue = (hash % 360) / 360; // Hue in [0, 1]
  const saturation = 0.7; // Fixed saturation for vivid colors
  const lightness = 0.5; // Fixed lightness
  return new THREE.Color().setHSL(hue, saturation, lightness);
}


function assignColorToVertex(geometry: THREE.BufferGeometry, vertexIndex: number, color: THREE.Color) {

  if (!geometry.attributes.color) return;

  const colors = geometry.attributes.color as THREE.BufferAttribute;

  colors.setXYZ(vertexIndex, color.r, color.g, color.b);
  colors.needsUpdate = true;
}



function assignColorToTriangle(geometry: THREE.BufferGeometry, faceIndex: number, color: THREE.Color) {

  const indexAttr = geometry.index;
  if (!indexAttr) return;

  const vertexIndexA = indexAttr.getX(faceIndex * 3);
  const vertexIndexB = indexAttr.getX(faceIndex * 3 + 1);
  const vertexIndexC = indexAttr.getX(faceIndex * 3 + 2);

  assignColorToVertex(geometry, vertexIndexA, color);
  assignColorToVertex(geometry, vertexIndexB, color);
  assignColorToVertex(geometry, vertexIndexC, color);
}

function displayTectonicTileEdges(he: Halfedge) {

  if (!tectonicSystem) {
    console.warn('No tectonic plates available.');
    return;
  }

  if (tileLines) {
    scene.remove(tileLines);
  }

  // Loop on the halfedges of the tile
  let tile = undefined;
  for (const auxHe of he.nextLoop()) {
    if (!tectonicSystem.edge2TileMap.has(auxHe)) {
      continue;
    }

    tile = tectonicSystem.edge2TileMap.get(auxHe);
    break;
  }
  console.log('Tile found for the clicked halfedge:', tile);

  if (!tile) {
    console.warn('No tile found for the clicked halfedge.');
    return;
  }

  makeLineSegments2FromTile(tile, tileLines);

  scene.add(tileLines);

}

function displayTectonicPlateEdges(he: Halfedge) {

  if (!tectonicSystem) {
    console.warn('No tectonic plates available.');
    return;
  }

  if (plateLines) {
    scene.remove(plateLines);
  }

  const tile = tectonicSystem.findTileFromEdge(he);

  if (!tile) {
    console.warn('No tile found for the clicked halfedge.');
    return;
  }

  const plate = tile.plate;
  console.log("plate border edges:", plate.borderEdge2TileMap.size);
  makeLineSegments2FromPlate(plate, plateLines);

  scene.add(plateLines);
}

function displayTectonicBoundary(he: Halfedge) {
  if (!tectonicSystem) {
    console.warn('No tectonic plates available.');
    return;
  }

  const tile = tectonicSystem.findTileFromEdge(he);

  if (!tile) {
    console.warn('No tile found for the clicked halfedge.');
    return;
  }

  const plate = tile.plate;

  // Find the boundary corresponding to the clicked halfedge
  const boundary = tectonicSystem.edge2BoundaryMap.get(he);

  if (!boundary) {
    console.warn('No boundary found for the clicked halfedge.');
    return;
  }

  console.log("Tectonic Boundary found:", boundary);

  // also display full plate boundaries
  makeLineSegments2FromBoundary(boundary, boundaryLines);

  scene.add(boundaryLines);
}

function splitPlateAtEdge(he: Halfedge) {

  if (!tectonicSystem) {
    console.warn('No tectonic plates available.');
    return;
  }

  const tile = tectonicSystem.findTileFromEdge(he);

  if (!tile) {
    console.warn('No tile found for the clicked halfedge.');
    return;
  }

  splitPlateFromTile(tectonicSystem, tile);
}

function transferTileAtEdge(he: Halfedge) {

  if (!tectonicSystem) {
    console.warn('No tectonic plates available.');
    return;
  }

  const tile = tectonicSystem.findTileFromEdge(he);
  if (!tile) {
    console.warn('No tile found for the clicked halfedge.');
    return;
  }

  const currentPlate = tile.plate;

  const heTwin = he.twin;
  const twinTile = tectonicSystem.edge2TileMap.get(heTwin);
  const targetPlate = twinTile ? twinTile.plate : null;
  if (targetPlate === currentPlate || targetPlate === null) {
    console.warn('The adjacent tile belongs to the same plate. Cannot transfer tile.');
    return;
  }

  transferTileToPlate(tile, targetPlate);

}

function absorbPlateFromEdge(he: Halfedge) {

  if (!tectonicSystem) {
    console.warn('No tectonic plates available.');
    return;
  }

  const tile = tectonicSystem.findTileFromEdge(he);
  if (!tile) {
    console.warn('No tile found for the clicked halfedge.');
    return;
  }

  const currentPlate = tile.plate;

  // Loop on all the tile border edges to find an adjacent plate
  let targetPlate = null;
  for (const he of tile.loop()) {
    const twinHe = he.twin;

    const twinTile = tectonicSystem.edge2TileMap.get(twinHe);
    const candidatePlate = twinTile ? twinTile.plate : null;
    if (candidatePlate === currentPlate || candidatePlate === null) {
      continue;
    }

    targetPlate = candidatePlate;
    break;
  }

  if (!targetPlate) {
    console.warn('No adjacent plate found to absorb the current plate.');
    return;
  }

  console.log("Absorbing plate", currentPlate.id, "into plate", targetPlate.id);

  plateAbsorbedByPlate(currentPlate, targetPlate);

}


let selectionMode = true;
function onMouseClick(event: MouseEvent) {

  if (!selectionMode) return;

  // Calculate mouse position in normalized device coordinates
  // (-1 to +1) for both components
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  // Update the raycaster with the camera and mouse position
  raycaster.setFromCamera(mouse, camera);

  // check if the geometry is indexed
  if (!icosahedron.geometry.index) {
    console.warn('Geometry is not indexed.');
    return;
  }

  // Calculate objects intersecting the picking ray
  const intersects = raycaster.intersectObject(dualMesh);

  if (intersects.length > 0) {
    // Get the first intersection
    const intersect = intersects[0];
    const faceIndex = intersect.faceIndex!;

    console.log('Clicked face index on dual mesh:', faceIndex);
    const clickedHeId = dualMesh.geometry.userData.face2HalfedgeMap.get(faceIndex);
    console.log('Corresponding halfedge id in dual graph:', clickedHeId);
    const clickedHe = icoHalfedgeDualGraph.halfedges.get(clickedHeId);
    if (!clickedHe) {
      console.warn('No halfedge found for clicked halfedge id:', clickedHeId);
      return;
    }

    // colorTectonicSystem(true);

    // splitPlateAtEdge(clickedHe);
    // transferTileAtEdge(clickedHe);
    // absorbPlateFromEdge(clickedHe);

    displayTectonicTileEdges(clickedHe);
    displayTectonicPlateEdges(clickedHe);
    displayTectonicBoundary(clickedHe);

    colorTectonicSystem(false);
  }

}


function onMouseMove(event: MouseEvent) {

  if (!icosahedron) return;

  if (!selectionMode) return;

  // Calculate mouse position in normalized device coordinates
  // (-1 to +1) for both components
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  // Update the raycaster with the camera and mouse position
  raycaster.setFromCamera(mouse, camera);

  // check if the geometry is indexed
  if (!icosahedron.geometry.index) {
    console.warn('Geometry is not indexed.');
    return;
  }

  // Calculate objects intersecting the picking ray
  const intersects = raycaster.intersectObject(icosahedron);

  if (intersects.length > 0) {
  }
}


function rebuildIcosahedronHalfedgeDS() {
  console.log("Rebuilding Icosahedron Halfedge DS");

  let rotation: THREE.Euler | null = null;
  // For smooth transitions, store the current rotation
  // before removing the old icosahedron
  if (icosahedron) {
    rotation = icosahedron.rotation.clone();
    scene.remove(icosahedron);
  }

  // populateIcosahedronHalfedgeDS(icoHalfedgeDS);
  // populateTetrahedronHalfedgeDS(icoHalfedgeDS);
  populateIcosahedronHalfedgeGraph(icoHalfedgeGraph);
  // populateTetrahedronHalfedgeGraph(icoHalfedgeGraph);

  subdivideTrianglesLoop(icoHalfedgeGraph, icoParams.degree);

  distortGraphLoop(icoHalfedgeGraph, 3, 0.5);
  normalizeVertices(icoHalfedgeGraph);

  // Generate dual graph
  const icoHalfedge2DualBiMap = populateDualGraph(icoHalfedgeGraph, icoHalfedgeDualGraph);
  normalizeVertices(icoHalfedgeDualGraph);
  // console.log("Generated dual graph of icosahedron.");
  // console.log("icoHalfedge2DualBiMap: ", icoHalfedge2DualBiMap);

  const geometry = makeBufferGeometryFromHalfedgeGraph(icoHalfedgeGraph, true);
  // const geometry = makeBufferGeometryFromHalfedgeDS(icoHalfedgeDS, true);
  const positions = geometry.attributes.position;

  // Add Color attribute to the geometry
  const colors = new THREE.BufferAttribute(new Float32Array(positions.count * 3), 3);
  for (let i = 0; i < positions.count; i++) {
    colors.setXYZ(i, 1, 1, 1);
  }

  geometry.setAttribute('color', colors);

  icosahedron = new THREE.Mesh(geometry, icosahedronMaterial);

  icoParams.numVertices = icoHalfedgeGraph.vertices.size;
  icoParams.numFaces = icoHalfedgeGraph.faces.size;
  icoParams.numHalfedges = icoHalfedgeGraph.halfedges.size;

  // Apply the stored rotation to the new icosahedron
  if (rotation) {
    icosahedron.rotation.copy(rotation);
  }

  scene.add(icosahedron);

  let faceDistrib = makeFaceDistribution(icoHalfedgeDualGraph);
  icoDualParams.pentagons = faceDistrib.pentagons;
  icoDualParams.hexagons = faceDistrib.hexagons;
  icoDualParams.heptagons = faceDistrib.heptagons;

  if (halfedgeGraphLines) {
    rotation = halfedgeGraphLines.rotation.clone();
    scene.remove(halfedgeGraphLines);
  }

  makeLineSegments2FromHalfedgeGraph(icoHalfedgeDualGraph, halfedgeGraphLines);

  if (rotation) {
    halfedgeGraphLines.rotation.copy(rotation);
  }

  scene.add(halfedgeGraphLines);

  if (dualMesh) {
    rotation = dualMesh.rotation.clone();
    scene.remove(dualMesh);
  }

  const dualGeometry = makeBufferGeometryFromLoops(icoHalfedgeDualGraph, true);
  const dualPositions = dualGeometry.attributes.position;

  // Add color attribute to the geometry
  const dualColors = new THREE.BufferAttribute(new Float32Array(dualPositions.count * 3), 3);
  for (let i = 0; i < dualPositions.count; i++) {
    dualColors.setXYZ(i, 1, 1, 1);
  }

  dualGeometry.setAttribute('color', dualColors);

  dualMesh = new THREE.Mesh(dualGeometry, dualMaterial);
  if (rotation) {
    dualMesh.rotation.copy(rotation);
  }

  scene.add(dualMesh);

  console.log("Mesh Rebuilt");
}

function rebuildTectonicPlates() {
  const numPlates = 25;

  if (tectonicSystem) {
    console.log("Clear old tectonic plates.");
    tectonicSystem.clear();
    for (const faceIndex of dualMesh.geometry.userData.face2HalfedgeMap.keys()) {
      // reset color to white
      assignColorToTriangle(dualMesh.geometry, faceIndex, new THREE.Color(1, 1, 1));
    }
  }

  tectonicSystem = buildTectonicSystem(icoHalfedgeDualGraph, numPlates);

  computeTectonicMotion(tectonicSystem);

  computePlateBoundaries(tectonicSystem);
  caracterizePlateBoundaries(tectonicSystem);

  console.log('Generated tectonic network with', tectonicSystem.plates.size, 'plates.');
  colorTectonicSystem();

  let rotation: THREE.Euler | null = null;
  if (motionSpeedLines) {
    rotation = motionSpeedLines.rotation.clone();
    scene.remove(motionSpeedLines);
  }

  makeLineSegments2ForTileMotionSpeed(tectonicSystem, motionSpeedLines);
  console.log("Num lines in motionSpeedLines:", motionSpeedLines.geometry.attributes.position.count / 2);

  if (rotation) {
    motionSpeedLines.rotation.copy(rotation);
  }

  scene.add(motionSpeedLines);
}

function colorTectonicSystem(reset: boolean = false) {

  if (!dualMesh) {
    console.warn('No dual mesh available for coloring tectonic plates.');
    return;
  }

  if (!tectonicSystem) {
    console.warn('No tectonic plate system available.');
    return;
  }

  const resetColor = new THREE.Color(1, 1, 1);

  for (const plate of tectonicSystem.plates) {
    // Assign a random color to the plate given the id
    const plateColor = reset ? resetColor : idToHSLColor(plate.id);

    for (const tile of plate.tiles) {
      for (const auxHe of tile.loop()) {
        const origFaceIdx = dualMesh.geometry.userData.halfedge2FaceMap.get(auxHe.id);
        // origFaceIdx might be zero
        // so we need to check for undefined
        if (origFaceIdx !== undefined) {
          assignColorToTriangle(dualMesh.geometry, origFaceIdx, plateColor);
        } else {
          console.warn('No face found for halfedge id:', auxHe.id);
        }
      }
    }
  }
}

window.addEventListener('click', onMouseClick, false);
window.addEventListener('mousemove', onMouseMove, false);


function reset() {
  rebuildIcosahedronHalfedgeDS();
}

reset();

const gui = new GUI()
gui.add(icoParams, 'degree', MIN_DEGREE, MAX_DEGREE).step(1).name('Subdivision degree').onChange(debounce(reset, 300));
gui.add({ selectionMode: selectionMode }, 'selectionMode').name('Selection Mode').onChange((value: boolean) => {
  selectionMode = value;
})

let icoGui = gui.addFolder('Icosahedron');
icoGui.add(icosahedronMaterial, 'visible').name('Visible')
icoGui.add(icosahedronMaterial, 'wireframe').name('Wireframe')
icoGui.add(icosahedronMaterial, 'vertexColors').name('Vertex Colors').onChange(() => {
  icosahedronMaterial.needsUpdate = true;
})
icoGui.add(icoParams, 'numVertices').name('Num Vertices').listen();
icoGui.add(icoParams, 'numFaces').name('Num Faces').listen();
icoGui.add(icoParams, 'numHalfedges').name('Num Halfedges').listen();
// icoGui.open();
let dualGui = gui.addFolder('Dual Graph');
dualGui.add(graphLinesMaterial, 'visible').name('Visible')
dualGui.add(icoDualParams, 'pentagons').name('Num Pentagons').listen();
dualGui.add(icoDualParams, 'hexagons').name('Num Hexagons').listen();
dualGui.add(icoDualParams, 'heptagons').name('Num Heptagons').listen();
let dualMeshGui = gui.addFolder('Dual Mesh');
dualMeshGui.add(dualMaterial, 'visible').name('Visible')
dualMeshGui.add(dualMaterial, 'wireframe').name('Wireframe')
dualMeshGui.open();
let tectonicGui = gui.addFolder("Tectonic Plates");
tectonicGui.add({ rebuild: rebuildTectonicPlates }, 'rebuild').name('Rebuild Plates');
// switch button to toggle the motionSpeedLines visibility
tectonicGui.add(motionSpeedLinesMaterial, 'visible').name('Show Motion');
tectonicGui.open();

function animate() {
  requestAnimationFrame(animate);
  if (icosahedron) {
    icosahedron.rotation.x += ROTATION_SPEED;
    icosahedron.rotation.y += ROTATION_SPEED;
  }

  if (halfedgeGraphLines) {
    halfedgeGraphLines.rotation.x += ROTATION_SPEED;
    halfedgeGraphLines.rotation.y += ROTATION_SPEED;
  }

  if (tileLines) {
    tileLines.rotation.x += ROTATION_SPEED;
    tileLines.rotation.y += ROTATION_SPEED;
  }

  if (plateLines) {
    plateLines.rotation.x += ROTATION_SPEED;
    plateLines.rotation.y += ROTATION_SPEED;
  }

  if (motionSpeedLines) {
    motionSpeedLines.rotation.x += ROTATION_SPEED;
    motionSpeedLines.rotation.y += ROTATION_SPEED;
  }

  if (boundaryLines) {
    boundaryLines.rotation.x += ROTATION_SPEED;
    boundaryLines.rotation.y += ROTATION_SPEED;
  }

  if (dualMesh) {
    dualMesh.rotation.x += ROTATION_SPEED;
    dualMesh.rotation.y += ROTATION_SPEED;
  }

  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

animate();

