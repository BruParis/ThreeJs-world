import { Vector3 } from "three";
import { HalfedgeGraph } from "../HalfedgeGraph";
import { Vertex } from "../Vertex";

export function addVertex(
    struct: HalfedgeGraph,
    position: Vector3,
    checkDuplicates = false,
    tolerance = 1e-10) {

  // Check if position matches one face vertex and returns it
  if (checkDuplicates) {
    for (const vertex of struct.vertices.values()) {
      if (vertex.matchesPosition(position, tolerance)) {
        return vertex;
      }
    }
  }
  
  const v = new Vertex();
  v.position.copy(position);
  struct.vertices.set(v.id, v);
  return v;
}
