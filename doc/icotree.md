# Icosahedron tree subdivision of a sphere

## Structure

Each node in the tree is an hexagon, except 12 pentagonal nodes at each level.
Each hexagonal node will be subdivided into 7 hexagonal (6 peripheral and a center node) (respectively for the pentagonal nodes: 5 hexagonal peripheral, and 1 center pentagonal node). Among the children nodes, the peripheral one will be shared with the parent node neighbor.

This is therefore an slight variation on the concept of a quadtree: the parent node is not strictly divided into its own children.

The document icotree.jepg describe the way an hexagonal node is subdivided into a central hexagonal and
6 peripheral hexagonal, shared with the 6 neighbors of the parent node. The new vertices created for those children
nodes are the midpoints from the center of the parent hexagon to its 6 vertices.
