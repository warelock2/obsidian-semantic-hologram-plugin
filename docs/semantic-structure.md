# Semantic Structure Specification: Hologram Topology & Abstraction Hierarchy

## 1. Core Abstraction Hierarchy (The Multi-Level Model)

To reduce human cognitive load while preserving the precise dependency Directed Acyclic Graph (DAG), the full semantic hierarchy spans multiple abstraction tiers from atomic primitives up to macro-fields (inspired by the OSI-to-TCP/IP transition model; see [Appendix: Original Expanded Hierarchy Reference](#appendix-original-expanded-hierarchy-reference) for the pre-compression model).

| Level | Term | Role & Definition | Examples |
|---|---|---|---|
| **0** | `concept` | **Atomic primitives**: Foundational hardware or kernel-level building blocks that require no further decomposition in this domain. | `CPU Ring`, `Syscall`, `Operating System`, `Page Table Entry (PTE)` |
| **1** | `idea` | **Syntheses & mechanisms**: First-order abstractions combining multiple concepts into functional units or working schemas. Positioned at the geometric centroid of their supporting concepts in the topology. | `Process`, `Thread`, `Fork`, `Exec`, `Virtual Memory`, `Page Table`, `Page Fault`, `Scheduler`, `Preemption`, `Context Switch` |
| **2** | `pattern` | **Recurring strategies**: Cross-cutting design patterns or policies that govern interactions between ideas and mechanisms. Positioned at the centroid of their supporting ideas. | `Copy On Write`, `Demand Paging`, `Zero Page`, `Anonymous Page`, `Dirty Bit`, `MAP_PRIVATE vs MAP_SHARED`, `Memory Accounting (RSS, VSZ, PSS)`, `SIGSEGV and SIGBUS`, `Page Cache` |
| **3** | `topic` | **The Topic Container**: The root container representing a specific subject domain or individual hologram set. | `Linux Kernel Internals` |
| **4** | `domain` | **Sub-Field / Branch**: A category grouping multiple related topics and holograms together into a coherent sub-discipline. | `Operating Systems`, `Networking`, `Distributed Systems` |
| **5** | `field` | **Macro-Discipline**: High-level umbrella category encompassing multiple domains across technical or scientific spheres. | `Computer Science`, `Systems Engineering`, `Physics` |

---

## 2. Frontmatter Schema & Groupings

Every semantic node note in the `hologram/` folder uses the following frontmatter conventions:

### Frontmatter Fields
- `hologram-node: true` — Identifies the note as part of the semantic topology graph.
- `node-type: [concept | idea | pattern | topic | domain | field]` — Replaced the legacy `note-type` field to reflect the multi-level abstraction hierarchy.
- `created: YYYY-MM-DD` — Creation date.
- `hologram: [Name]` — The containing hologram or domain.
- `groups: [...]` — Membership linkages connecting nodes upward through the hierarchy:
  - **Concepts** list the `idea` nodes they participate in.
  - **Ideas** list the `pattern` nodes they support.
  - **Patterns** list the `topic` / hologram container.
  - **Topics** roll up into `domain` categories.
  - **Domains** roll up into `field` structures.

---

## 3. Multi-Dimensional Topology & Rendering Specification

### Centroid Positioning Algorithm
1. **Level 0 (Concepts)**: Rendered at the periphery as the atomic baseline nodes.
2. **Level 1 (Ideas)**: Compute the geometric centroid of supporting `concept` nodes.
3. **Level 2 (Patterns)**: Compute the geometric centroid of supporting `idea` nodes.
4. **Level 3 (Topic)**: Bounding frame for the individual hologram set.
5. **Level 4-5 (Domain / Field)**: Macro-bounding frames and multi-domain cluster centroids.

### Edge Semantics & Enhanced Relationships
Beyond Obsidian's native bidirectional `[[link]]` syntax, relationship semantics are structured via typed logic families and strengths:
- **Relation Families**: Expressed as `logic/supports`, `logic/enables`, `logic/conflicted-with`, `logic/prerequisite-of`.
- **Confidence & Strength**: Unidirectional or weighted edges indicating the strength of application or dependency.
- **Directional Arrows**: Flow from `concept` → `idea` → `pattern` → `topic` → `domain` → `field`.

---

## 4. Holograms and Fields

- **Hologram**: An independent, interconnected set of concepts at any level representing a specific sub-topic or discipline.
- **Super-Hologram / Multi-Topic Vat**: A composite container created by pouring multiple holograms together, enabling cross-domain knowledge synthesis while preserving individual topological provenance.

---

## Appendix: Original Expanded Hierarchy Reference

Before compression into the streamlined operational tiers, the semantic hierarchy extended across granular layers. For historical reference and architectural provenance, the full multi-level hierarchy is defined below:

| Level | Term | Role & Definition | Examples |
|---|---|---|---|
| **1** | `concept` | Atomic baseline items requiring no decomposition. | `CPU Ring`, `Page Table Entry (PTE)` |
| **2** | `idea` | First-order synthesis of raw concepts. | `Fork`, `Thread` |
| **3** | `model` / `mechanism` | System structures and working subsystems. | `Virtual Memory`, `Scheduler` |
| **4** | `pattern` | Cross-cutting optimization strategies. | `Copy On Write`, `Demand Paging` |
| **5** | `framework` | System integrators combining multiple patterns and mechanisms. | `Page Cache` |
| **6** | `topic` | Root container for the domain hologram. | `Linux Kernel Internals` |
| **7** | `domain` | Broader sub-field grouping multiple topics. | `Operating Systems` |
| **8** | `field` | Macro-discipline container. | `Computer Science` |
