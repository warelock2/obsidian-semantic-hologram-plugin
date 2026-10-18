# Diffraction Methodology: Queries, Descent, and the Epistemic Loop

> Status: design direction. Phase one implementation is specified in §§1–6. Phase two elements (delay, capacitors, bistable zones, transistors, gradients) are parked. Nothing here is implemented unless [docs/thought-crystallography.md](thought-crystallography.md) says so.

---

## §0. The Corpus Precondition

This methodology is inoperable below a specific corpus density. 

The analysis engine does not generate meaning; it projects structure. If a vault contains isolated notes or bare un-justified links (`A -> B`), the diffusion field returns trivial paths and familiar grooves. The value of descent discovery is superlinear in notes carrying explicit, human-authored justifications.

**Falsifier:** If descents through a dense, justified corpus turn out to yield only connections the author already consciously held in mind, the method fails as a discovery engine and operates merely as a recall index.

---

## §1. The Method and Its Instrument

An X-ray diffraction pattern is not a picture of a molecule; it is the physical effect of a crystal lattice on a beam, interpretable only when the mapping from beam to structure is understood.

The semantic diffractometer (`src/diffraction.ts`) operates on the same principle:
- **The Crystal Lattice:** The authored Zettelkasten graph (nodes, directional edges, justifications).
- **The Beam:** Voltage injection at source nodes (`sourceVoltage: 1.0` as units), diffusing across conductance weights.
- **The Interference Pattern:** The scalar activation field, uniform grounding conductance, and directional channel trees.

### What It Captures and What It Excludes
- **Captured:** Propositional, structural, and relational meaning. What follows from what; causal dependencies; logical entailments; structural bridges between domains.
- **Excluded:** Connotation, tone, personal memory, and affective weight.

---

## §2. Data Prerequisite: Justified Edges

To read an argument rather than a graph walk, every relation line carries a human-authored justification appended via a `::` delimiter after the strength:

```markdown
- logic/supports [[Target Note]] (0.5) :: Copy-on-write and zero page interact via demand paging
```

### Parsing and Constraints
1. **Grammar:** Parsed by an extension of the relation line regex (see [semantic-structure.md](semantic-structure.md) §3). The tail `:: ...` is optional, trimmed, and evaluates to undefined when absent. Existing notes parse byte-identically.
2. **Mirroring:** The raw line text must be preserved verbatim in `RelationEdge.raw` so round-trip vault writes never drop justifications.
3. **Provenance:** Accepted AI-suggested edges must be marked with `authoredFrom: 'inferred'` rather than authored, preserving the epistemic boundary required by Rule 3 of the system architecture.

---

## §3. Grounding and Field Resolution

The phase-one physical model models a genuine linear resistance network:
- **Grounding:** Every node is connected to a common ground through a uniform grounding conductance.
- **No Rescalsing:** Per-step field renormalisation is deleted. Rescaling each iteration is nonlinear and breaks the fixed-point convergence.
- **Residual Threshold:** Iteration runs until the maximum absolute delta between steps falls below a residual threshold rather than stopping at a fixed 20 steps.
- **Source Voltage:** `sourceVoltage: 1.0` sets the absolute baseline units; structural behaviour is governed by the dimensionless ratio between edge conductance and grounding conductance.

---

## §4. Directional Edges and Diodes

All relationship types are strictly directional.
- **Orientation:** Every edge conducts from source to target only. `{R}` markers on authored lines reverse orientation at parse time, so `A→B` and `B→A` are distinct graphs.
- **Dissolved Issues:** With one-way edges, outbound `neighbours` lists have no duplicate pairs, dissolving the old `neighbours`/`conductance` sort desync and `link`'s first-wins dilemma.
- **Bridges:** The bridge lens (`findBridges`) evaluates union connectivity over inbound and outbound structures, with an inbound/outbound switchable mode.

---

## §5. Channel Trees and Claim Enumeration

A descent is not a single path, but a branching **channel tree** rooted at each source:
- **Additive Share:** Per-hop share `share = c_ij / Σ c_ik` is accumulated additively across all steps where charge transfers.
- **Quantile Pruning:** Children on a tree node are filtered by a quantile parameter, ensuring only significant channel-hops are retained.
- **Claims:** Walking tree leaves produces root-to-leaf traces representing claims. Novelty is determined in $O(1)$ time via `adjacency.has(first, last)`.

---

## §6. Ranking and Readout

Claims are ranked by:
1. **Novelty:** `endpointsLinked: false` outranks `true` (bridges unlinked ground).
2. **Depth:** Longer valid traces outrank shorter ones.
3. **Mean Share:** Higher cumulative channel fidelity breaks ties.

Readout is presented via console output containing the claim path with note labels, per-hop shares, edge types, justifications inline, and the novelty flag.

---

## §7. Phase Two (Parked)

Elements deferred to phase two:
- Delay and variable capacitance (RC persistence).
- Bistable coupled-threshold zones.
- Transistors and signal amplification.
- Field gradients.
- Chain-as-source probe (tonearm).
- Multi-source weighted emphasis queries.
- Temporal persistence.
- UI beyond console.
- Prose serialisation and model evaluation (still gated on justifications existing).
