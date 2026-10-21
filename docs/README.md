# Documentation Index

**Status:** INDEX — authoritative for document status, scope, and precedence.
Created 2026-10-20.

This file is the map of `docs/`. It records what each document *is*, whether it is
still true, and which document wins when two of them disagree. It exists because
the documentation grew in six waves over a month and no single document said so.

Every doc below carries a one-line `> **Status:**` header saying the same thing
this table says, more briefly. If the two disagree, this file is right.

---

## 1. How to resolve a conflict

**1. Newer wins.** Documents carry the date of the wave they belong to. A claim
in a 09-15 document that a 10-20 document contradicts is *superseded*, not
*contradictory* — and the older one should be corrected, not the newer one.

**2. The code wins over prose.** Where a document and `src/` disagree, `src/` is
what actually runs. Check the source before trusting any claim about behaviour.

**3. Settings win over catalogues.** A relationship type or node type is legal
only if it is enabled in the plugin's settings. `docs/relationships.txt` is the
**candidate catalogue** — a menu of types you *could* add — not the authority on
which types exist.

**4. Scope beats status.** A document that defines *what something is* outranks
a document that reports *what is currently true*.

**5. Ideation is not specification.** The 2026-10-15 wave (`brain-internet-*`,
`dag-networking-*`, `internet-of-thoughts-*`, `os-filesystem-dag-mirror`) is
metaphor and vision. It is marked as such and should not be cited as a spec.

---

## 2. The index

### 2.1 Normative — these define the system

| Document | Wave | Status | Scope |
|---|---|---|---|
| [`dag-layer-rules.md`](core/dag-layer-rules.md) | 2026-10-20 | **SPEC — normative** | The level ladder, direction rules, layer-crossing restrictions, abstraction/compression. **Authoritative on levels and direction.** |
| [`semantic-structure.md`](core/semantic-structure.md) | 2026-09-15, rev. 10-18 | **SPEC — format** | Frontmatter schema, relationship semantics, node-type table. Authoritative on **file format**. Superseded on levels by `dag-layer-rules.md`. |
| [`knowledge-substrate.md`](core/knowledge-substrate.md) | 2026-10-20 | **FOUNDATION — rationale** | The epistemic architecture: membrane & metabolism, the float zone, the snapshot, the AI interface, open work. **Authoritative on why.** |

### 2.2 Design — settled, or in progress

| Document | Wave | Status | Scope |
|---|---|---|---|
| [`hologram-emulsification.md`](functional/hologram-emulsification.md) | 2026-10-18 | **SPEC — settled, NOT implemented** | Which nodes belong to which hologram, how the displayed set is partitioned at a given CWD, edge and physics scoping. §10 lists what it replaces; the code still implements the older model. |
| [`filesystem-hologram-management.md`](functional/filesystem-hologram-management.md) | 2026-10-15, rev. 10-18 | **SPEC — concepts & UI** | Hologram concepts, operations, UI design. Emulsification is specified in `hologram-emulsification.md`; where they disagree, that one wins. |
| [`os-filesystem-hologram-management.md`](functional/os-filesystem-hologram-management.md) | 2026-10-15 | **SPEC — ops & data safety** | The vault filesystem as the management layer: structure, git, portability, scope checks. Current on positional membership. |

### 2.3 Implementation status — these say what is built

| Document | Wave | Status | Scope |
|---|---|---|---|
| [`untethered-trackball-pinhole-camera-system.md`](functional/untethered-trackball-pinhole-camera-system.md) | 2026-10-03, rev. 10-16 | **IMPLEMENTED** | The 3D camera in full. Supersedes the deleted `…-camera-system-with-orthographic-projection.md` and `virtual-camera-system.md`. |
| [`2d-virtual-screen-frames.md`](functional/2d-virtual-screen-frames.md) | 2026-10-16 | **IMPLEMENTED** | The 2D view's three frames, orientation, gizmos, visibility. |
| [`virtual-screen.md`](functional/virtual-screen.md) | 2026-09-27, rev. 10-16 | **REFERENCE — definition** | "Virtual Screen" as a plane in 3D world space. The 2D sense is a different thing — see `2d-virtual-screen-frames.md`. |
| [`thought-crystallography.md`](functional/thought-crystallography.md) | 2026-10-04/05 | **SPEC + implementation status** | The diffractometer's identity, the three invariants, what is actually built. **Authoritative on diffraction implementation status.** |
| [`diffraction-methodology.md`](functional/diffraction-methodology.md) | 2026-10-18 | **SPEC — phase one** | The physical model, justified edges, directional edges, channel trees. Its implemented scope is gated on `thought-crystallography.md`. |

### 2.4 Authoring — how to use it

| Document | Wave | Status | Scope |
|---|---|---|---|
| [`semantic-hologram-user-guide.md`](functional/semantic-hologram-user-guide.md) | 2026-10-20 | **GUIDE** | How to author and audit hologram nodes. Derived from the normative specs and the plugin's settings — not from observation of any one vault. |
| [`example-node.md`](functional/example-node.md) | 2026-09-15, regenerated | **GENERATED — do not hand-edit** | The node template. Generated from `src/skeleton.ts`; `npm run check:example` fails on drift. Its status lives in the generator. |
| [`gravitas-provenance.md`](functional/gravitas-provenance.md) | 2026-10-19 | **REFERENCE — example** | The `## Gravitas Provenance` section format and a worked example. |
| [`relationships.txt`](core/relationships.txt) | 2026-10-19 | **CATALOGUE — not the authority** | 188 candidate relationship types across 15 families, plus Formal and Epistemic Basis, each family with a central question. |

### 2.5 Ideation, history, and artifacts — do not cite as spec

| Document | Wave | Status | Scope |
|---|---|---|---|
| [`brain-internet-multiverse.md`](ideas/brain-internet-multiverse.md) | 2026-10-15 | **IDEA — metaphor** | Brain-as-internet, DAG-as-multiverse, nodes-as-routers. Metaphor. Its gravitas/confidence formulas were corrected on 2026-10-20; see §4. |
| [`dag-networking-internet-of-thought.md`](ideas/dag-networking-internet-of-thought.md) | 2026-10-15 | **IDEA — metaphor** | Filesystem-as-IPv6, the Internet of Thought, the Metaverse of Thought. Metaphor. |
| [`internet-of-thoughts-metaverse.md`](ideas/internet-of-thoughts-metaverse.md) | 2026-10-15 | **IDEA — vision** | What it means to navigate knowledge as space. Explicitly "a vision document, not a technical specification." |
| [`os-filesystem-dag-mirror.md`](ideas/os-filesystem-dag-mirror.md) | 2026-10-15 | **IDEA — superseded** | The first filesystem-as-DAG sketch. Superseded by `hologram-emulsification.md`. |
| [`science-discovery-and-reason.md`](ideas/science-discovery-and-reason.md) | 2026-09-27 | **IDEA — metaphor** | Bedrock, soil, trees, fruit, sandbox. Its diagram uses its own numbering, not the DAG ladder. |
| [`novel-discoveries.md`](history/novel-discoveries.md) | 2026-09-27 | **HISTORICAL — results snapshot** | Diffraction findings from 2026-09-27. Its counts describe that vault state, not the current one. |
| [`audit-gravitas-provenance.md`](history/audit-gravitas-provenance.md) | 2026-10-19 | **ARTIFACT — session handover** | A prompt written for a *different repo* (`linuxresearch`). Not a spec. Its "plugin settings verified" line is a snapshot of 2026-10-19 and is now stale. |

### 2.6 Removed

| Document | Removed | Replaced by |
|---|---|---|
| `virtual-camera-system.md` | 2026-09-29 (`68b7516`) | `untethered-trackball-pinhole-camera-system.md` |
| `untethered-trackball-camera-system-with-orthographic-projection.md` | 2026-10-03 | `untethered-trackball-pinhole-camera-system.md` |

---

## 3. The chronology

| Wave | Character | Documents |
|---|---|---|
| 2026-09-15 | The format | `semantic-structure`, `example-node` |
| 2026-09-27 | The vision and the first results | `science-discovery-and-reason`, `novel-discoveries`; the diffractometer engine |
| 2026-09-29 → 10-05 | The camera, and the diffractometer's identity | camera docs (two deleted, one renamed), `thought-crystallography` |
| 2026-10-15 | One ideation session | the four IDEA documents, plus the first `filesystem-hologram-management` |
| 2026-10-16 | The 2D frame model | `2d-virtual-screen-frames`, `virtual-screen` |
| 2026-10-17 | Emulsification implemented | `hologram-emulsification` v1 |
| 2026-10-18 | Directory-based membership; diffraction phase one | `hologram-emulsification` rewritten into a spec, `semantic-structure` revised, `diffraction-methodology` |
| 2026-10-19 | Provenance and the relationship catalogue | `gravitas-provenance`, `relationships.txt`, `audit-gravitas-provenance` |
| **2026-10-20** | **The epistemic foundation** | **`dag-layer-rules`, `knowledge-substrate`** — the current normative pair |

---

## 4. The vocabulary: 188 + 5

Measured 2026-10-20 against the live plugin settings.

| Set | Count | What it is |
|---|---|---|
| `docs/relationships.txt` | 188 | The candidate catalogue. 15 families, each with a central question, plus Formal and Epistemic Basis. |
| `src/relTypesDerived.ts` | 188 | The slugified catalogue. Id-for-id identical to it, **plus one addition: `functional/supports`**, which has no catalogue entry. |
| Plugin settings (`data.json`) | 193 | The catalogue **plus 5 legacy plugin types**: `related`, `logic/supports`, `logic/contradicts`, `structural/subsumed-by`, `structural/depends-on`. |

**Two origins, never reconciled.** `logic/` is the plugin's original family
(`logic/supports`, `logic/contradicts`); `logical/` is the catalogue's (12 types).
`structural/` is the plugin's original DAG-scaffolding family and **has no
counterpart in the catalogue at all** — `compositional/` (11 catalogue types)
covers the same ground.

**Two consequences, both open:**

1. `src/settings.ts` sets `relTypes: derivedRelTypes` as the default, so a
   **fresh vault would not have `related` or `structural/subsumed-by`**. Both
   are load-bearing: `settings.ts` defaults new relations to `related`, and
   `gravitasSync.ts` and `confidence.ts` hardcode `structural/subsumed-by` as
   the inheritance channel. This has not been measured in a fresh vault.
2. `structural/component-system` — used once, in the LKI vault's
   `Page Table.md` — **exists in no registry**: not the catalogue, not
   `relTypesDerived.ts`, not the settings. It is a typo for
   `compositional/component-system`, and that edge is silently dropped today.

**Reconciliation is deferred** to the vocabulary owner. Until then: a type is
legal iff it is enabled in the settings.

---

## 5. Known gaps between docs and code

| Gap | Where | State |
|---|---|---|
| Emulsification is specified but not implemented | `hologram-emulsification.md` §10 vs `src/hologramService.ts`, `src/controlsView.ts`, `src/main.ts` | The code still derives membership from cumulative directory tags, treats emulsification as a property of the folder rather than of the CWD, and still ships the `un-emulsify-holograms` command the spec says is unnecessary. |
| Fresh-vault relationship defaults | `src/settings.ts` vs the 5 legacy types | Unmeasured. See §4. |
| `RelationEdge.authoredFrom` not implemented | `thought-crystallography.md` rule 3 | AI-written relations cannot yet be marked as inferred. |
| Returns pipe | `knowledge-substrate.md` §12 | The structure is one-way; the world's grades do not flow back into confidence or gravitas. |

---

## 6. Maintenance

When you add or change a document:

1. Give it a one-line `> **Status:**` header under the title, using the roles
   in §2.
2. Add it to the table in §2, with its wave.
3. If it supersedes another document, say so **in the new document's header**,
   and correct or mark the old one. Do not leave both claiming to be current.
4. If it changes a rule, correct the documents that state the old rule —
   including `README.md` at the repository root.
