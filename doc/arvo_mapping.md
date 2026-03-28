# Arvo Equal-Area Cube-to-Sphere Mapping

Arvo [2001] provides a recipe for analytically constructing an area-preserving parameterization between smooth 2D surfaces. We apply Arvo's method to construct an equal-area mapping from cube face to sphere.

## Forward Mapping (Cube → Sphere)

Given cube face coordinates `(a, b)` in range `[-1, 1]`, compute sphere UV coordinates `(u, v)`:

```
u = fu(a, b) = sqrt(2) * tan(π*a / 6) / sqrt(1 - tan²(π*a / 6))

v = fv(a, b) = b / sqrt(1 + (1 - b²) * cos(π*a / 3))
```

## Inverse Mapping (Sphere → Cube)

Given sphere coordinates `(u, v)`, compute cube face coordinates `(a, b)`:

```
a = (6 / π) * arctan(u / sqrt(u² + 2))

b = v * sqrt(u² + 2) / sqrt(u² + v² + 1)
```

## Reference

Arvo, J. 2001. *Stratified sampling of 2-manifolds*. SIGGRAPH 2001 Course Notes.

URL: https://pdfs.semanticscholar.org/4b29/674656bbf4067f23f0c24fe1b2e7ae198d7f.pdf
