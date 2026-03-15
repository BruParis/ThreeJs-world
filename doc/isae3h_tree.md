# ISAE3H HexaTree encoding

The tree has n level of resolution.
At each level, each cell (or its barycenter) is encoded with:
- its resolution level n
- a triplet of integers (a, b, c)

The following rules applies at a given level of resolution n:

## Rule 1:

The barycenters of all the cells map to coordinates x, y, z
according to:

- if n is even:
(1 / 3^(n/2)) * (a, b, c)), |a| + |b| + |z| = 3^(n/2)
- if n is odd:
(1 / 3^((n+1)/2)) * (a, b, c)), |a| + |b| + |z| = 3^((n+1)/2), with |a|, |b|, |c| all congruent modulo 3

## Rule 2 - vertices of tessellation:

Two vertices of the tessellation of coordinates (a1, b1, c1) and (a2, b2, c2) are connected by an edge if:

- if n is even:
 |ai - bi| <= 1, i = 1, 2, 3
- if n is odd:
 |ai - bi| <= 2, i = 1, 2, 3

An hexagonal cell has 6 cells as neighbours  (its barycenter connected by and egde to the
barycenter of its neighbour cell). Respectively, a square cell has 4 cells as neighbours.

## Rule 3 - cell neighbours:

A cell whose barycenter has coordinates (a1, a2, a3)  have neighbours with coordinates (b1, b2, b3) such that:

- if n is even:
 |ai - bi| <= 1, i = 1, 2, 3
- if n is odd:
 |ai - bi| <= 2, i = 1, 2, 3

For an hexagonal cell of coordinates (a, b, c), the 6 neighbours have coordinates:

- if n is even:
(a + 1, b - 1, c), (a + 1, b, c - 1), (a, b + 1, c - 1), 
(a - 1, b + 1, c), (a - 1, b, c + 1), (a, b - 1, c + 1)
- if n is odd:
(a + 2, b - 1, c - 1), (a - 1, b + 2, c - 1), (a - 1, b - 1, c + 2), 
(a - 2, b + 1, c + 1), (a + 1, b - 2, c + 1), (a + 1, b + 1, c - 2)

According to the following convention:
The sign change if the number before is negative (exple: a + 1 -> a - 1 if a is negative).
If something is substracted from 0, then the other signs in the ordered triple changes
(exple: in (a + 2, b - 1, c - 1) with c = 0 -> (a - 2, b + 1, c - 1))

## Rule 4 - from parent cell to child cell:

1. The central child at level (n+1) of a cell in coordinates (a, b, c) has coordinates:
- if n is even:
3 * (a, b, c)
- if n is odd:
(a, b, c)

2. Cell (a, b, c) is a central child if and only if:
- if n is even:
a, b, c are congruent modulo 3
- if n is odd:
a, b, c, are congruent to 0 modulo 3

3. The neighboring children (a, b, c) are, in either the even or odd case, the neighbours of a central
child as given in rule 3.

## Rule 5 - from child cell to parent cell:

The parent of a central cell of coordinates
(a, b, c), has coordinates:
- if n is even:
(a, b, c)
- if n is odd:
(1/3) * (a, b, c)


