# HexaTree

Encoding scheme for icosahedral hexagonal grid system.
Up to an Icosahedron Lambert projection, this system works on a 2D-Hexagonal lattice
like it would on a sphere.

# 2d-Hexagonal lattice.

The main implemtation focus on the 2d-Hexagonal lattice.
Basically, it should convert some encoding scheme to x,y coordinates on the lattice and vice-versa.

This this lattice is aligned with x-y axis and involves hexagonals, it basically just manipulates/combines the values: sqrt(3) / 2, 1/2, etc... eventually just hardcode them/store them as constant variables.

## Encoding:

The encoding is made up of two parts:
- root: a id for the root hexagon.
- arrays: a0,a1,a2,a3...an-1 of values within {0, 1, 2, 3} (shoul be stored as Uint8Array). Each value ai refers to an hexagonal on a 2d lattice, at resolution i.

## Conversion:

### Code to coordinates
The root id indicates the root hexagonal on which the coordinates resulting from the following computations should be centered.

For an array: a0,a1,....an-1:
compute the w_0,....,w_n-1 as array of length 3:
w(0)= (0, 0)
w(1)= (0, 1)
w(2)= (-1, -1)
w(3)= (1, 0)


compute (i,j) intermediary coordinates with:
(i,j) = sum_k=0_k⁼n-1 ((2^k) . w(a_k+1))

if 2 * j-i > 2^(n-1) then j = j - 2^(n-1)
else if (-i-j) > 2^(n-1) then i = i+ 2^(n-1) and j = j + 2^(n-1)
else if (2*i -j)> 2^(n-1) then i = i-2^(n-1)

compute (x,y) 2D-hexaongal lattices coordinates as:
(x,y) = M x (i,j) with M the 2x2 matrix:
0,0 = (1/Z)^(n)
0,1 = 0
1,0 = - (sqrt(3)/3) * (1/2)^(n) L
1,1 = sqrt(3)/3) * (1/2)^(n-1) * L

with L the length of the root triangles of the icosahedron.
