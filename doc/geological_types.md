# Geological Types Design Notes

## Tile Geological Type

Use a **simple enum** for the geological type on each tile. This includes types like:
- Orogeny
- Fold-and-thrust
- Basin
- (other geological types)

## Companion Data Structure

Consider adding a small **companion struct** on tiles to hold optional extra data:

| Field       | Type    | Description                              |
|-------------|---------|------------------------------------------|
| `intensity` | `float` | Strength or magnitude of the feature     |
| `age`       | `int`   | Counter tracking how long the feature has existed |

### Usage by Type

- **Most types**: Leave these fields at default values
- **Orogeny, Fold-and-thrust, Basin**: Actively use intensity and age

## Direction

**Do not store direction** on tiles. It is always recoverable from:
- Boundary geometry
- Plate motion vectors

## Benefits

This approach:
- Keeps the enum clean and simple
- Maintains minimal core data footprint
- Allows types that need nuance to carry extra information
- Avoids inflating the entire system with unused fields
