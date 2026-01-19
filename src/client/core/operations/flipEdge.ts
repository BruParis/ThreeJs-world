import { Halfedge } from "../Halfedge";
import { HalfedgeGraph } from "../HalfedgeGraph";

export function flipEdge(halfedgeDS: HalfedgeGraph, he: Halfedge): Halfedge | undefined {
  /* From
   *            vB
   *         ↗     ↘ 
   *       ↗         ↘
   *     ↗             ↘
   *     <-------------- vC
   *  vA --------------->
   *      ↖           ↙
   *        ↖       ↙
   *          ↖   ↙
   *            vD 
   * To
   *            vB
   *         ↗   A ↘ 
   *       ↗   | |   ↘
   *     ↗     | |     ↘
   *    vA     | |      vB
   *      ↖    | |    ↙
   *        ↖  | |  ↙
   *          ↖V  ↙
   *            vD 
   */ 

  const heTwin = he.twin;

  const heFace = he.face;
  const heTwinFace = heTwin.face;

  if (!heFace || !heTwinFace) {
    console.warn("Cannot flip halfedge without two adjacent faces.");
    return;
  }

  const hePrevVertex = he.prev.vertex;
  const heTwinPrevVertex = heTwin.prev.vertex;

  // check if already connected
  if (heTwinPrevVertex.getHalfedgeToVertex(hePrevVertex)) {
    console.warn("Cannot flip halfedge, vertices are already connected.");
    return;
  }

  halfedgeDS.removeEdge(he);

  // TODO: attach a state 'with_faces' to the halfedgeDS
  // -> For complex algorithm, ther could be sequences of
  // flipHalfedge calls during which faces are not used
  // it would be better to skip all those removal/addition of faces
  halfedgeDS.removeFace(heFace);
  halfedgeDS.removeFace(heTwinFace);

  const newHe = halfedgeDS.addEdge(heTwinPrevVertex, hePrevVertex);

  halfedgeDS.addFace([
    newHe,
    newHe.next,
    newHe.prev,
  ]);

  halfedgeDS.addFace([
    newHe.twin,
    newHe.twin.next,
    newHe.twin.prev,
  ]);

  return newHe;
}
