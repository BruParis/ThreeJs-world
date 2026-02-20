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

## Practical Implementation Rule

Along transforms, assign geology as follows:

| Geology Type | Probability | Trigger |
|--------------|-------------|---------|
| Basin | 20-30% | Favor tiles where local boundary direction shifts |
| Minor orogeny / Fractured platform | Small fraction | Restraining bends |
| Background geology | Most tiles | Inherit from plate |

## Micro-Plates and Transform Boundaries

Micro-plates naturally form in two main contexts, both involving transforms:

### 1. Ridge-Transform Intersections

Where a mid-ocean ridge is offset by a long transform, the geometry can isolate a small block of crust that rotates independently.

**Condition**: A divergent boundary that is offset (two divergent segments not perfectly aligned, connected by a transform).

**Behavior**: The micro-plate rotates because it's being pulled by spreading on both sides.

**Real-world examples**:
- Juan de Fuca plate
- Easter microplate
- Rivera plate

### 2. Triple Junctions

Where three plates meet, the junction is inherently unstable and tends to migrate or reorganize. A micro-plate can stabilize the geometry.

**Detection**: Identify tiles at the meeting point of three or more plate boundaries and flag them as candidates for micro-plate nucleation.

## Implementation Sketch

### Identifying Micro-Plate Candidates

1. Find tiles at or near the intersection of:
   - A transform with a divergent boundary, OR
   - A transform with another transform

2. "Carve out" a small cluster of those tiles into their own plate

3. Derive an independent motion vector:
   - Start with the average of the two neighboring plate motions
   - Add a rotational component

4. Re-evaluate boundaries — the micro-plate will likely end up with mixed convergent/divergent/transform boundary segments

### Visual Benefit

A long featureless transform is geologically boring, but one that spawns a small rotating micro-plate with its own basin and ridge system feels much more alive.
