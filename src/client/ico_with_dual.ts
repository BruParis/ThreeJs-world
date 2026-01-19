import * as THREE from 'three';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import Delaunator from 'delaunator';
import { GUI } from 'dat.gui'
import { HalfedgeDS } from 'three-mesh-halfedge';

const ROTATION_SPEED = 0.0005;
const MIN_SUBDIVISIONS = 0;

const scene = new THREE.Scene();

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
  wireframe: true
});

const icoHalfedgeDS = new HalfedgeDS();
const icoDualHalfedge = new HalfedgeDS();

let dualIcosahedron: THREE.Mesh;
const dualIcosahedronMaterial = new THREE.MeshBasicMaterial({
  color: 0xffaa33,
  wireframe: true
});

const linesMaterial = new LineMaterial({
  linewidth: 1.0,
  vertexColors: true
});

const lines = new LineSegments2(new LineSegmentsGeometry(), linesMaterial);
scene.add(lines);

const params = {
  subdivisions: MIN_SUBDIVISIONS
};

function rebuildIcosahedron() {
  let rotation: THREE.Euler | null = null;
  // For smooth transitions, store the current rotation
  // before removing the old icosahedron
  if (icosahedron) {
    rotation = icosahedron.rotation.clone();
    scene.remove(icosahedron);
  }

  const geometry = new THREE.IcosahedronGeometry(1, params.subdivisions);

  // Convert to indexed geometry if not already
  const positions = geometry.attributes.position;
  const indices = Array.from({ length: positions.count }, (_, i) => i);
  geometry.setIndex(indices);

  icosahedron = new THREE.Mesh(geometry, icosahedronMaterial);

  // Add Color attribute to the geometry
  const colors = new THREE.BufferAttribute(new Float32Array(positions.count * 3), 3);
  for (let i = 0; i < positions.count; i++) {
    colors.setXYZ(i, 1, 1, 1);
  }

  icosahedron.geometry.setAttribute('color', colors);

  // Apply the stored rotation to the new icosahedron
  if (rotation) {
    icosahedron.rotation.copy(rotation);
  }

  scene.add(icosahedron);
}



function assignColorToVertex(vertexIndex: number, color: THREE.Color) {
  if (!icosahedron) return;


  if (!icosahedron.geometry.attributes.color) return;

  const colors = icosahedron.geometry.attributes.color as THREE.BufferAttribute;

  colors.setXYZ(vertexIndex, color.r, color.g, color.b);
  colors.needsUpdate = true;
}

function makeIcosahedronDual() {
  if (icoHalfedgeDS.vertices.length === 0) return;

  icoDualHalfedge.clear();

  // Create a map to store the index of each new vertex (centroid) for each original face
  const faceToVertexIndex = new Map();
  const positions = [];

  // Step 1: Compute centroids for each face and store their indices
  const loops = icoHalfedgeDS.loops();

  for (const loophe of loops) {
    const loopPositions = [];
    const loopVerticesIds = [];

    // collect all vertex positon of the looi
    for (const halfedge of loophe.nextLoop()) {
      const vertex = halfedge.vertex;

      loopPositions.push(vertex.position);
      loopVerticesIds.push(vertex.id);
    }

    // compute the centroid
    const numVertices = loopPositions.length;
    let centroid = new THREE.Vector3(0, 0, 0);
    for (const halfedge of loophe.nextLoop()) {
      const vertex = halfedge.vertex;
      centroid.add(vertex.position);
    }

    centroid.divideScalar(numVertices);
    centroid.normalize(); // project onto unit sphere

    // add the centroid to the positions array
    positions.push(centroid.x, centroid.y, centroid.z);
    faceToVertexIndex.set(loophe.face, positions.length / 3 - 1);
  }

  const dualIndices = [];
  // Step 2: For each original vertex, collect adjacent faces and triangulate
  for (const vertex of icoHalfedgeDS.vertices) {
    const adjacentFaces = [];
    let he = vertex.halfedge;
    
    if (!he) continue;

    do {
      adjacentFaces.push(he.face);
      he = he.twin.next;
    } while (he !== vertex.halfedge);

    // Triangulate the polygon formed by the centroids of adjacent faces
    const faceIndices = adjacentFaces.map(face => faceToVertexIndex.get(face));

    // Compute the centroid of the vertex for better triangulation
    const vertexCentroid = new THREE.Vector3(0, 0, 0);
    for (const faceIndex of faceIndices) {
      const cx = positions[faceIndex * 3];
      const cy = positions[faceIndex * 3 + 1];
      const cz = positions[faceIndex * 3 + 2];
      vertexCentroid.add(new THREE.Vector3(cx, cy, cz));
    }
    vertexCentroid.divideScalar(faceIndices.length);
    // vertexCentroid.normalize();

    const newCentroidIndex = positions.length / 3;
    positions.push(vertexCentroid.x, vertexCentroid.y, vertexCentroid.z);

    // Add triangles connecting the vertex centroid to each edge of the polygon
    for (const faceIndex of faceIndices) {
      dualIndices.push(newCentroidIndex, faceIndex, faceIndices[(faceIndices.indexOf(faceIndex) + 1) % faceIndices.length]);
    }

  }
  console.log("num dual vertices:", positions.length / 3);
  console.log("num dual indices: ", dualIndices.length / 3);

  // Step 3: Create the dual geometry
  const dualIcosahedronGeometry = new THREE.BufferGeometry();
  dualIcosahedronGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(positions), 3)
  );
  dualIcosahedronGeometry.setIndex(
    new THREE.BufferAttribute(new Uint32Array(dualIndices), 1)
  );

  // Step 4: Create the dual mesh and update the HalfEdge structure
  dualIcosahedron = new THREE.Mesh(dualIcosahedronGeometry, dualIcosahedronMaterial);
  scene.add(dualIcosahedron);

  // Update the HalfEdge structure for the dual mesh
  icoDualHalfedge.setFromGeometry(dualIcosahedronGeometry);
}


function rebuildHalfedgeIco() {
  let rotation: THREE.Euler | null = null;
  if (!icosahedron) return;

  if (dualIcosahedron) {
    rotation = dualIcosahedron.rotation.clone();
    scene.remove(dualIcosahedron);
  }

  icoHalfedgeDS.clear();
  icoHalfedgeDS.setFromGeometry(icosahedron.geometry);

  makeIcosahedronDual();

  if (rotation) {
    dualIcosahedron.rotation.copy(rotation);
  }
}



function assignColorToTriangle(faceIndex: number, color: THREE.Color) {
  if (!icosahedron) return;

  const indexAttr = icosahedron.geometry.index;
  if (!indexAttr) return;

  const vertexIndexA = indexAttr.getX(faceIndex * 3);
  const vertexIndexB = indexAttr.getX(faceIndex * 3 + 1);
  const vertexIndexC = indexAttr.getX(faceIndex * 3 + 2);

  assignColorToVertex(vertexIndexA, color);
  assignColorToVertex(vertexIndexB, color);
  assignColorToVertex(vertexIndexC, color);
}

function colorRandomTriangle() {
  if (!icosahedron) return;

  const index = icosahedron.geometry.index;

  if (!icosahedron.geometry.attributes.color) return;

  if (!index) return;

  const randomFaceIndex = Math.floor(Math.random() * (index.count / 3));
  const color = new THREE.Color(0x33ffac);

  assignColorToTriangle(randomFaceIndex, color);

}

let selectionMode = false;
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
  const intersects = raycaster.intersectObject(icosahedron);
  console.log(intersects);

  if (intersects.length > 0) {
    // Get the first intersection
    const intersect = intersects[0];
    const faceIndex = intersect.faceIndex!;
    console.log('Clicked face index:', faceIndex);

    // Color the clicked triangle, with a random
    // but distinct color (make sure it's not close to white)
    const color = new THREE.Color(Math.random(), Math.random(), Math.random());
    if (color.r + color.g + color.b > 2.5) {
      color.r = Math.random() * 0.5;
      color.g = Math.random() * 0.5;
      color.b = Math.random() * 0.5;
    }

    assignColorToTriangle(faceIndex, color);
  }
}


function onMouseMove(event: MouseEvent) {
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
    // Get the first intersection
    const intersect = intersects[0];
    const faceIndex = intersect.faceIndex!;

    console.log("Hovering face index:", faceIndex);
  }
}

window.addEventListener('click', onMouseClick, false);
window.addEventListener('mousemove', onMouseMove, false);


function reset() {
  rebuildIcosahedron();

  // rebuildHalfedgeIco();
}

reset();

const gui = new GUI()
gui.add(params, 'subdivisions', MIN_SUBDIVISIONS, 128).step(1).name('Subdivisions').onChange(reset)
gui.add({ selectionMode: selectionMode }, 'selectionMode').name('Selection Mode').onChange((value: boolean) => {
  selectionMode = value;
})
const icoGui = gui.addFolder('Icosahedron');
icoGui.add(icosahedronMaterial, 'visible').name('Visible')
icoGui.add(icosahedronMaterial, 'wireframe').name('Wireframe')
icoGui.add(icosahedronMaterial, 'vertexColors').name('Vertex Colors').onChange(() => {
  icosahedronMaterial.needsUpdate = true;
})
const dualIcoGui = gui.addFolder('Dual Icosahedron');
dualIcoGui.add(dualIcosahedronMaterial, 'visible').name('Visible')
dualIcoGui.add(dualIcosahedronMaterial, 'wireframe').name('Wireframe')
dualIcoGui.add(dualIcosahedronMaterial, 'vertexColors').name('Vertex Colors').onChange(() => {
  dualIcosahedronMaterial.needsUpdate = true;
})

function animate() {
  requestAnimationFrame(animate);
  if (icosahedron) {
    icosahedron.rotation.x += ROTATION_SPEED;
    icosahedron.rotation.y += ROTATION_SPEED;
  }

  if (dualIcosahedron) {
    dualIcosahedron.rotation.x += ROTATION_SPEED;
    dualIcosahedron.rotation.y += ROTATION_SPEED;
  }

  if (lines) {
    lines.rotation.x += ROTATION_SPEED;
    lines.rotation.y += ROTATION_SPEED;
  }

  renderer.render(scene, camera);
}

animate();

