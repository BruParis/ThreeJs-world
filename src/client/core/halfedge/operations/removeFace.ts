import { Face } from "../Face";
import { HalfedgeGraph } from "../HalfedgeGraph";

export function removeFace(
  struct: HalfedgeGraph,
  face: Face) {

  if (!struct.faces.delete(face)) {
    return;
  }

  // Remove face ref from halfedges loop
  for (const halfedge of face.halfedge.nextLoop()) {
    halfedge.face = null;
  }
}
