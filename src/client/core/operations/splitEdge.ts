import { Vector3 } from "three";
import { Halfedge } from "../Halfedge";
import { HalfedgeGraph } from "../HalfedgeGraph";
import { Vertex } from "../Vertex";

export function splitEdge(
  struct: HalfedgeGraph,
  halfedge: Halfedge,
  position: Vector3,
  tolerance = 1e-10) {

  /**
 * From
 *            A -------------- he -------------> B ---> heNext
 *            A <------------ twin ------------- B <--- heTwinPrev
 * To         
 *            A ---- he ----> v ---- newhe ----> B ---> heNext
 *            A <--- twin --- v <--- newtwin --- B <--- heTwinPrev
 */

  const originalId = halfedge.id;
  const twin = halfedge.twin;
  const origingalTwinId = twin.id;
  const A = halfedge.vertex;
  const B = twin.vertex;

  const heNext = halfedge.next;
  const heTwinPrev = halfedge.twin.prev;

  // No need to split if position matches A or B
  if (A.matchesPosition(position, tolerance)) {
    return A;
  }
  if (B.matchesPosition(position, tolerance)) {
    return B;
  }

  const newVertex = new Vertex();
  newVertex.position.copy(position);

  // Create the new halfegdes
  const newHalfedge = new Halfedge(newVertex);
  const newTwin = new Halfedge(B);
  newHalfedge.twin = newTwin;
  newTwin.twin = newHalfedge;

  // Update vertices halfedge refs
  A.halfedge = halfedge;
  newVertex.halfedge = newHalfedge;
  B.halfedge = newTwin;

  // Update twin vertex ref
  // This changes the halfedge and its twin id (vertex.id-twin.vertex.id)
  // Update the map accordingly
  twin.vertex = newVertex;

  struct.halfedges.delete(originalId);
  struct.halfedges.set(halfedge.id, halfedge);
  struct.halfedges.delete(origingalTwinId);
  struct.halfedges.set(twin.id, twin);


  // Copy the face refs
  newHalfedge.face = halfedge.face;
  newTwin.face = twin.face;

  // Update next and prev refs
  newHalfedge.next = halfedge.next;
  newHalfedge.prev = halfedge;
  halfedge.next = newHalfedge;
  newTwin.next = twin;
  newTwin.prev = twin.prev;
  twin.prev = newTwin;

  // Update incoming halfedges ref
  // to new halfedge (and twin)
  heNext.prev = newHalfedge;
  heTwinPrev.next = newTwin;

  // Update structure
  struct.vertices.set(newVertex.id, newVertex);
  struct.halfedges.set(newHalfedge.id, newHalfedge);
  struct.halfedges.set(newTwin.id, newTwin);

  return newVertex;
}
