# Micro-Plate Formation: All Cases

## What Is a Micro-Plate?

A micro-plate is a small, semi-independent crustal fragment with its own Euler rotation pole, distinct from the major plates bounding it. It arises when local stress fields, geometric instabilities, or tectonic events isolate a crustal block with enough kinematic independence to be tracked separately.

Micro-plates are not defined by boundary type alone — they can form at or near **any** boundary type, and often at **intersections** of multiple boundary types.

---

## General Spawn Criteria (All Cases)

A micro-plate candidate is valid when **all** of the following hold:

- The block is bounded on **at least 3 sides** by tectonic boundaries (any type).
- The block has a **distinct rotation or velocity** from its neighbors.
- The block has a **minimum tile count** above a simulation threshold (avoid trivially small fragments).
- The block is **kinematically stable** as an independent unit (i.e., its boundaries are geometrically consistent).

---

## Case 1: Ridge–Transform Intersection (RTI) Micro-plate

**Boundary context:** Divergent + Transform

**Geological setting:**
At fast- to intermediate-spreading ridges, where a transform fault offsets two ridge segments, asymmetric spreading can cause a small block to decouple and rotate between the two ridge tips.

**Trigger conditions:**
- Transform segment flanked by two active ridge segments on opposite ends.
- Spreading rate asymmetry between the two ridge arms exceeds threshold.
- Obliquity of spreading relative to transform strike is significant.

**Characteristics:**
- Oceanic crust, thin lithosphere.
- Rotates rapidly around a local Euler pole near the block center.
- Bounded by two ridge segments and two transform/pseudofault segments.
- Geologically young; tends to be re-absorbed or grow into a larger plate.

**Geological type:** `OCEANIC_CRUST`

**Implementation rule:**
```
if tile_group adjacent_to ridge_segment on TWO sides
    and those ridges are offset by a transform
    and spreading_asymmetry > RTI_THRESHOLD:
        spawn micro-plate
        geological_type = OCEANIC_CRUST
        assign_local_euler_pole()
        boundary[ridge sides] = DIVERGENT
        boundary[lateral sides] = TRANSFORM (pseudofault)
```

**Real examples:** Easter Micro-plate, Juan Fernández Micro-plate, Galapagos Micro-plate.

---

## Case 2: Pull-Apart Basin Block (Releasing Bend / Step-Over)

**Boundary context:** Transform (releasing geometry)

**Geological setting:**
Where a transform fault has a releasing bend or left-step (for right-lateral faults), local extension creates a subsiding block between two en-échelon fault strands. With sufficient extension and time, proto-oceanic crust can form.

**Trigger conditions:**
- Transform segment with a releasing step-over geometry.
- Local extensional stress exceeds crustal tensile threshold.
- Step-over width and length above minimum basin size threshold.

**Characteristics:**
- Thin, subsided crust; sediment-filled.
- Block drops relative to surroundings.
- Can evolve: BASIN → OCEANIC_CRUST if extension matures.
- Bounded on long sides by active transform strands, on short ends by oblique normal faults.

**Geological type:** `BASIN` (→ `OCEANIC_CRUST` if mature)

**Implementation rule:**
```
if boundary_type == TRANSFORM
    and step_over_type == RELEASING
    and local_extension > PULL_APART_THRESHOLD:
        spawn micro-plate
        geological_type = BASIN
        if block_age > MATURATION_AGE and extension_rate > SPREADING_THRESHOLD:
            geological_type = OCEANIC_CRUST
            convert lateral boundaries to DIVERGENT
```

**Real examples:** Dead Sea Basin, Salton Trough, Gulf of California proto-ocean.

---

## Case 3: Restraining Bend Block (Transpressional Pop-Up)

**Boundary context:** Transform (restraining geometry)

**Geological setting:**
Where a transform fault has a restraining bend or right-step (for right-lateral faults), local compression causes crustal thickening and uplift, creating an isolated elevated block.

**Trigger conditions:**
- Transform segment with a restraining step-over geometry.
- Local compressional stress exceeds crustal yield threshold.
- Block geometry is coherent (not diffuse deformation zone).

**Characteristics:**
- Thickened, uplifted crust.
- Bounded by reverse or oblique-reverse faults on compression sides.
- Active internal deformation (fold-and-thrust style).
- Does not typically evolve further unless stress regime changes.

**Geological type:** `OROGENY` or `FOLD_THRUST_BELT`

**Implementation rule:**
```
if boundary_type == TRANSFORM
    and step_over_type == RESTRAINING
    and local_compression > RESTRAINING_THRESHOLD:
        spawn micro-plate
        geological_type = FOLD_THRUST_BELT
        if uplift_magnitude > OROGENY_THRESHOLD:
            geological_type = OROGENY
        boundary[compression sides] = CONVERGENT (transpressional)
```

**Real examples:** Transverse Ranges (Big Bend of San Andreas), Lebanese restraining bends.

---

## Case 4: Forearc / Intra-Arc Sliver Plate

**Boundary context:** Convergent (subduction zone, oblique)

**Geological setting:**
At oblique subduction zones, trench-parallel strain is partitioned between the main thrust interface and a secondary arc-parallel strike-slip fault. The forearc block between these two faults moves as a semi-independent sliver.

**Trigger conditions:**
- Subduction boundary with obliquity angle above threshold.
- Strain partitioning produces a secondary fault parallel to the arc.
- Forearc block is geometrically isolated between trench and volcanic arc.

**Characteristics:**
- Continental or oceanic crust depending on arc type.
- Translates along arc direction; very little internal deformation.
- Bounded oceanward by subduction thrust, arcward by strike-slip fault.
- Can rotate slightly if the arc is curved.

**Geological type:** `CONTINENTAL_CRUST` or `OCEANIC_CRUST` (forearc type)

**Implementation rule:**
```
if boundary_type == CONVERGENT (subduction)
    and obliquity_angle > SLIVER_OBLIQUITY_THRESHOLD
    and arc_parallel_fault_exists:
        spawn sliver micro-plate between trench and arc fault
        geological_type = parent_plate.geological_type
        boundary[trench side] = CONVERGENT
        boundary[arc side] = TRANSFORM
        motion = arc_parallel_translation + minor_rotation
```

**Real examples:** Sumatra Sliver (Sundaland), Philippine Sea Plate slivers, Caribbean forearc blocks.

---

## Case 5: Back-Arc Micro-plate

**Boundary context:** Convergent (subduction) + Divergent (back-arc spreading)

**Geological setting:**
In back-arc basins, localized spreading cells can isolate small oceanic blocks between spreading segments. Active subduction drives back-arc extension, and asymmetric opening can spin off a micro-plate.

**Trigger conditions:**
- Active back-arc spreading behind a subduction zone.
- Spreading is segmented or asymmetric.
- A block becomes bounded by spreading segments on multiple sides.

**Characteristics:**
- Thin oceanic crust, high heat flow.
- Rotates around a local pole within the back-arc basin.
- Bounded by small spreading ridges and transform faults.
- Geologically young and short-lived.

**Geological type:** `OCEANIC_CRUST`

**Implementation rule:**
```
if back_arc_spreading == ACTIVE
    and spreading_segmentation > SEGMENTATION_THRESHOLD
    and block bounded_by_spreading_segments >= 2:
        spawn micro-plate
        geological_type = OCEANIC_CRUST
        assign_local_euler_pole()
        boundary[spreading sides] = DIVERGENT
        boundary[lateral sides] = TRANSFORM
```

**Real examples:** Mariana Trough micro-plates, Lau Basin micro-plates.

---

## Case 6: Collisional Indenter / Extruded Block

**Boundary context:** Convergent (continent–continent collision)

**Geological setting:**
When a rigid indenter (e.g., a craton or microcontinent) collides with a larger plate, lateral extrusion of crustal blocks occurs along conjugate strike-slip faults. These extruded blocks escape sideways and may become semi-independent micro-plates.

**Trigger conditions:**
- Continent–continent collision boundary.
- Rigid indenter geometry producing lateral stress concentration.
- Conjugate strike-slip faults develop bounding an escapee block.
- Block has kinematic independence (distinct velocity vector).

**Characteristics:**
- Continental crust, possibly thickened.
- Translates laterally away from collision zone.
- Bounded by two strike-slip faults (one sinistral, one dextral) and the collision front.
- Internal deformation may be low once fully extruded.

**Geological type:** `CONTINENTAL_CRUST`, `PLATFORM`, or `OROGENY`

**Implementation rule:**
```
if boundary_type == CONVERGENT (continent–continent)
    and indenter_geometry == RIGID
    and conjugate_strike_slip_faults_detected:
        spawn extruded micro-plate
        geological_type = CONTINENTAL_CRUST or PLATFORM
        boundary[collision front] = CONVERGENT
        boundary[lateral sides] = TRANSFORM (escape faults)
        motion = lateral_extrusion_vector
```

**Real examples:** Indochina block (extruded by India–Asia collision), Anatolian Plate (extruded by Arabia–Eurasia collision).

---

## Case 7: Oceanic Plateau / Seamount Chain Isolation

**Boundary context:** Any (passive margin, transform, or convergent)

**Geological setting:**
A large igneous province (LIP), oceanic plateau, or seamount chain can have enough buoyancy and rigidity to behave as a distinct micro-plate, especially when surrounded by active boundaries or when it resists subduction.

**Trigger conditions:**
- Thick oceanic plateau or LIP present.
- Block buoyancy prevents normal subduction at a convergent margin.
- Block becomes bounded by active boundaries on three or more sides.

**Characteristics:**
- Anomalously thick oceanic crust.
- Resists deformation; low internal strain.
- May eventually accrete to a continental margin or cause subduction polarity reversal.

**Geological type:** `OCEANIC_CRUST` (thick / plateau variant) or `IGNEOUS_PROVINCE`

**Implementation rule:**
```
if tile_group has oceanic_plateau == TRUE
    and surrounded_by_active_boundaries >= 3
    and buoyancy > SUBDUCTION_RESISTANCE_THRESHOLD:
        spawn micro-plate
        geological_type = OCEANIC_CRUST (plateau)
        retain existing boundary types for each edge
        set internal_deformation = LOW
```

**Real examples:** Ontong Java Plateau, Caribbean LIP, Hikurangi Plateau.

---

## Case 8: Triple Junction Instability Block

**Boundary context:** Any combination at a triple junction

**Geological setting:**
Three plates meeting at a point form a triple junction. If the junction is kinematically unstable (the three boundary velocities do not close into a consistent triangle), the system resolves instability by either migrating the junction or spawning a small rotating block at the intersection.

**Trigger conditions:**
- Three plates meet at a single point or small area.
- Velocity triangle of the three boundary pairs does not close (unstable junction).
- At least one boundary is a transform or ridge.

**Characteristics:**
- Small block, often short-lived.
- Rotates rapidly to accommodate the kinematic mismatch.
- Geological type inherited from surrounding dominant plate type.
- May stabilize into a recognized micro-plate or be re-absorbed.

**Geological type:** Inherited from dominant neighbor

**Implementation rule:**
```
if triple_junction_detected
    and velocity_triangle_closure_error > STABILITY_THRESHOLD:
        spawn micro-plate at junction
        geological_type = dominant_neighbor.geological_type
        assign_local_euler_pole() to minimize velocity mismatch
        re-evaluate junction stability each timestep
        if stability restored: absorb block or maintain as micro-plate
```

**Real examples:** Azores Triple Junction micro-blocks, Galapagos Triple Junction.

---

## Case 9: Rifted Continental Fragment

**Boundary context:** Divergent (continental rift)

**Geological setting:**
During continental rifting, if the rift is segmented or propagates unevenly, a continental block can become isolated between rift arms (aulacogen geometry) or between a propagating rift and a transform. The block may eventually become a continental micro-plate drifting with oceanic crust forming around it.

**Trigger conditions:**
- Active continental rift system.
- Rift propagates asymmetrically or branches (rift–rift–transform triple junction).
- A continental block is isolated between two rift arms or between a rift and a transform.

**Characteristics:**
- Thinned continental crust (transitional).
- Bounded by proto-ridge segments and transforms.
- Evolves over time: RIFT BASIN → TRANSITIONAL CRUST → surrounded by OCEANIC_CRUST.
- Long-lived; becomes a microcontinent.

**Geological type:** `BASIN` → `CONTINENTAL_CRUST` (thinned) → isolated microcontinent

**Implementation rule:**
```
if rift_system == ACTIVE
    and rift_geometry == BRANCHING or ASYMMETRIC
    and continental_block isolated_between_rift_arms:
        spawn micro-plate
        geological_type = BASIN (thinned continental)
        if rift_arms mature into ocean:
            update surrounding boundaries to DIVERGENT
            geological_type = CONTINENTAL_CRUST (microcontinent)
```

**Real examples:** Rockall Plateau, Jan Mayen Microcontinent, Kerguelen Plateau (partial).

---

## Case 10: Captured / Orphaned Fragment (Plate Reorganization)

**Boundary context:** Any (post-reorganization)

**Geological setting:**
Major plate reorganizations — ridge jumps, subduction reversals, or large-scale plate boundary restructuring — can strand a crustal block surrounded by new boundaries, with no active spreading or subduction directly bounding it. The block drifts passively as an orphaned micro-plate.

**Trigger conditions:**
- Plate reorganization event (ridge jump, spreading cessation, subduction polarity reversal).
- Block finds itself surrounded by new boundaries on three or more sides.
- No active internal deformation source.

**Characteristics:**
- Geologically old, cold, and rigid.
- Passive motion; very slow or no rotation.
- Geological type reflects original formation environment (old oceanic, shield, platform).
- May eventually be subducted, accreted, or remain as a stable micro-plate.

**Geological type:** `SHIELD`, `PLATFORM`, or old `OCEANIC_CRUST`

**Implementation rule:**
```
if plate_reorganization_event == TRUE
    and block_now_surrounded_by_new_boundaries >= 3
    and no_active_spreading_or_subduction_within_block:
        spawn (or retain) micro-plate
        geological_type = inherited
        motion = passive_drift (no independent Euler pole update)
        flag for eventual accretion or subduction check
```

**Real examples:** Zealandia (partially), various Pacific seamount micro-plates.

---

## Summary Table

| # | Case | Boundary Context | Trigger | Geological Type | Motion Style |
|---|------|-----------------|---------|-----------------|--------------|
| 1 | RTI Micro-plate | Divergent + Transform | Asymmetric spreading at ridge offset | Oceanic crust | Fast independent rotation |
| 2 | Pull-Apart Basin | Transform (releasing) | Releasing step-over / bend | Basin → Oceanic | Extension, subsidence |
| 3 | Restraining Bend Block | Transform (restraining) | Restraining step-over / bend | Orogeny / Fold-thrust | Uplift, lateral squeeze |
| 4 | Forearc Sliver | Convergent (oblique subduction) | Oblique subduction + strain partitioning | Continental / Oceanic | Arc-parallel translation |
| 5 | Back-Arc Micro-plate | Convergent + Divergent | Segmented back-arc spreading | Oceanic crust | Local rotation in back-arc |
| 6 | Collisional Extruded Block | Convergent (continent–continent) | Rigid indenter + conjugate escape faults | Continental / Platform | Lateral extrusion |
| 7 | Oceanic Plateau Block | Any | Buoyant plateau resists subduction | Oceanic (thick) / LIP | Passive or slow rotation |
| 8 | Triple Junction Block | Any (triple junction) | Kinematically unstable triple junction | Inherited | Rapid corrective rotation |
| 9 | Rifted Continental Fragment | Divergent (continental rift) | Branching / asymmetric rift isolation | Basin → Microcontinent | Drift as rift matures |
| 10 | Orphaned Fragment | Any (post-reorganization) | Plate reorganization strands block | Shield / Platform / Old oceanic | Passive drift |

---

## Microplate Motion Determination

After a microplate is spawned, its motion (Euler pole) must be determined. The rule depends on the kinematic context of its boundaries:

### Driven Microplate
**Condition:** The microplate is bounded by **at least one active kinematic boundary**:
- Spreading ridge (DIVERGENT boundary)
- Active subduction zone (CONVERGENT boundary)

**Action:** Compute a **new independent Euler pole** (random rotation axis and speed).

**Rationale:** Active boundaries drive plate motion. A microplate bounded by a spreading ridge or subduction zone will have its own kinematic behavior dictated by these forces.

### Passive Microplate
**Condition:** The microplate is bounded **only by**:
- Transform faults (TRANSFORM boundary)
- Passive margins / inactive boundaries (INACTIVE boundary)

**Action:** **Inherit the parent plate's Euler pole** and apply a **decay factor** to the rotation speed.

**Rationale:** Without active driving forces, the microplate drifts passively, gradually slowing relative to its parent due to internal friction and edge drag.

### Zero Net Rotation Constraint

After assigning motion to microplates (whether driven or passive), the system must maintain **zero net rotation** globally. However, to preserve the established motion of major plates:

- **Only microplate motions are adjusted** to satisfy the zero net rotation constraint.
- Major plate motions remain unchanged.

This ensures that adding microplates does not destabilize the existing plate motion framework.

### Motion Decay for Passive Microplates

The decay factor reduces the inherited rotation speed:
```
microplate.rotationSpeed = parentPlate.rotationSpeed * PASSIVE_DECAY_FACTOR
```

Where `PASSIVE_DECAY_FACTOR` is typically 0.5–0.8, representing gradual slowdown due to edge drag along transform boundaries.

---

## General Implementation Strategy

### 1. Detection Phase (each timestep or major event)
- Scan all tile groups for **geometric isolation** (bounded on 3+ sides by boundaries).
- Evaluate **velocity divergence** from parent plate above threshold.
- Check **triple junction stability** at all junction points.
- Flag **reorganization events** (ridge jumps, spreading cessation).

### 2. Classification Phase
- For each candidate, evaluate trigger conditions in order of specificity:
  - Is it adjacent to a ridge on two sides? → Case 1
  - Is it on a releasing transform step-over? → Case 2
  - Is it on a restraining transform step-over? → Case 3
  - Is it a forearc block with oblique subduction? → Case 4
  - Is it in a back-arc basin? → Case 5
  - Is it a collisional extruded block? → Case 6
  - Is it a buoyant plateau? → Case 7
  - Is it at an unstable triple junction? → Case 8
  - Is it a rifted continental fragment? → Case 9
  - Is it an orphaned post-reorganization block? → Case 10

### 3. Spawn Phase
- Assign independent **Euler pole** (or passive drift flag for cases 7, 10).
- Assign **geological type** per case rules.
- Update **surrounding boundary types** to reflect new micro-plate edges.
- Set **evolution flags** (e.g., pull-apart → oceanic maturation timer).

### 4. Evolution Phase (each timestep)
- Update rotation and translation of each micro-plate.
- Check maturation conditions (e.g., pull-apart basins, rifted fragments).
- Check **re-absorption conditions**: if velocity converges with a neighbor below threshold, merge back.
- Check **destruction conditions**: subduction, accretion, collision.

---

*Thresholds (spreading asymmetry, obliquity angle, extension rate, stability error, etc.) are simulation parameters to be calibrated for the desired balance of geological realism and performance.*
