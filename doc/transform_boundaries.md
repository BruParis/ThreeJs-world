# Transform Boundaries

## Overview

Transform boundaries are geologically interesting because they're primarily about **lateral motion** — crust is neither created nor destroyed. They don't directly drive the same dramatic geological types as convergent or divergent boundaries, but they're not neutral either.

## Geological Types Along Transform Boundaries

### Pull-Apart Basins

The dominant feature along transforms is **pull-apart basins** (also called rhomb grabens or transtensional basins).

**Formation**: These form wherever the fault bends or steps. When two plates move past each other and there's a *releasing bend* (the geometry opens up a gap), you get localized extension and subsidence.

**Real-world examples**:
- The Dead Sea
- The Salton Sea trough
- The Sea of Marmara

**Implementation**: Assign basin geology in localized segments along transform boundaries, specifically where geometric irregularity is introduced.

### Transpressional Ridges

A **restraining bend** (compression across the fault) creates a transpressional ridge — a small, elongated uplifted zone.

**Characteristics**:
- Not full orogeny, but a lighter version
- Could be assigned as a distinct type like fold-and-thrust belt
- Or treated as minor orogenic terrain

**Real-world example**: The Transverse Ranges in California form this way along the San Andreas Fault.

### General Characteristics

The crust flanking a long transform tends to be highly fractured and faulted — good territory for shield or platform types being cut and disrupted rather than newly formed.

## Current Implementation

The transform boundary geology is implemented in `TransformGeology.ts`.

### Algorithm

1. **Collect transform segments**: Transform edges are grouped into connected segments along each boundary
2. **Detect bends**: For consecutive edges in a segment, compute the angle between their directions
3. **Filter releasing bends**: Only releasing bends (transtensional) can produce basins
4. **Assign basins**: Tiles at releasing bends receive BASIN geology with probability scaled by bend angle

### Configuration

| Parameter | Value | Description |
|-----------|-------|-------------|
| BASIN_PROBABILITY | 0.25 (25%) | Base probability at releasing bends |
| MIN_BEND_ANGLE | π/12 (~15°) | Minimum angle to consider a bend |
| MAX_BEND_ANGLE | π/2 (90°) | Angle for maximum probability boost |
| LARGE_BEND_PROBABILITY_BOOST | 2.0 | At 90° bends, probability doubles |

### Releasing Bend Detection

A bend is classified as "releasing" (transtensional) when:
- The boundary curves in one direction (computed via cross product of edge directions)
- The relative plate motion has a tangential component
- The curve direction and slip direction align (their product is positive)

This means the fault geometry opens up a gap, creating localized extension.

### Probability Scaling

The final probability is: `BASIN_PROBABILITY × probabilityFactor`

Where probabilityFactor is:
- 0 if bend angle < 15°
- Linear interpolation from 1.0 (at 15°) to 2.0 (at 90°)

### What's NOT Implemented

- **Transpressional ridges** at restraining bends are not yet implemented
- Tiles with existing geological types are skipped (preserves prior assignments)

## Summary Table

| Geology Type | Status | Probability | Trigger |
|--------------|--------|-------------|---------|
| Basin | ✓ Implemented | 25-50% (scaled by angle) | Releasing bends ≥15° |
| Minor orogeny / Transpressional ridge | ✗ Not implemented | — | Restraining bends |
| Background geology | Default | — | Inherit from plate |

