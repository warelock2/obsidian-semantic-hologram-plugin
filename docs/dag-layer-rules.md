# DAG Layer Rules

## Layer hierarchy

Nodes are organized into a layered DAG by abstraction level. Lower levels are less abstract (raw data, observations); higher levels are more abstract (groupings, domains).

| Level | Node type | Abstraction |
|---|---|---|
| 0 | Percept, Source | Raw observations, data points |
| 1 | Concept | Foundational concepts |
| 2 | Idea | Emerging ideas, thoughts |
| 3 | Pattern | Recognized recurring patterns |
| 4 | Topic | Broader topical groupings |
| 5 | Domain | Subject domains, fields of study |
| 6 | Field | High-level academic/professional fields |

## Structure: array of sets

The DAG is an **array of sets**, not sets within sets.

- Each level (0-6) is a set (bucket) of nodes at that abstraction level.
- Each set at level n can only have members from levels below it (n-m, m > 0). No set contains members from its own level or above.
- Membership flows upward only. A node at level n can be a member of multiple sets at levels n+1, n+2, ..., n+m.
- This is many-to-many membership, not nested single-parent containment (which would be a tree).

## Relationship rules

### Direction

- **No relationship goes downward.** A relationship never points from a higher-order (more abstract) node to a lower-order (less abstract) node.
- **Two relationships have restricted layer-crossing:**
  - `subsumed-by` — set membership, between layers only (never within same layer). Upward only.
  - `epistemic/evidence` — special support, sources only, source (level 0) → concept (level 1). Upward only. Percepts are grounded in observable reality and lend credence to first-order concepts.
- **All other relationships** — same layer (n → n) **or** upward by any positive offset (n → n+m, m > 0). Never downward.

### Subsumed-by

- "Sub" = subordinate. The subsumed node is a lower-level node contained within or acting as a member of the higher-level node's group.
- This relationship only makes sense **between** DAG layers. It never applies **within** the same layer.
- The subsumed node is more specific; the subsuming node is more general.
- Strength reflects how tightly the subsumed concept is bound to its parent group.

### Epistemic/evidence

- A lower-level source (level 0: Source, Percept) can provide evidence for a higher-level concept. This is a special case of support, which only sources can provide.
- The evidence source is more specific/raw; the target concept is more abstract.
- Evidence flows upward from reality (percepts) to first-order concepts. Percepts are grounded in observable reality and can be perceived.

### All other relationships

- Can be **within the same layer** (n → n) or **upward by any positive offset** (n → n+m, m > 0).
- Never downward.
- Examples: `functional/supports`, `structural/component-system`, `causal/contribution`, etc.

## Abstraction and compression

Abstraction is a form of knowledge compression, grounded in the concrete:

- **Level 0 (percept/source):** Full resolution. Every property, every observation.
- **Level 1 (concept):** First compression. Selects relevant properties, discards the rest.
- **Level 2+ (idea, pattern, topic...):** Further compression. Each level cherry-picks from lower levels ("this and not that").

Higher levels are **property sets combined from lower levels** in successive layers of abstraction. Each higher-order node cherry-picks properties from lower-order nodes to form a more abstract concept. This continues until reaching universal nodes (level 6: Field).

The loss is intentional and selective: at each layer, you keep the properties relevant to the next level up. The DAG preserves the downward path (via subsumed-by and epistemic/evidence edges) so you can decompress by following the chain back to percepts.

## Mixed membership

An n-1 node can be subsumed by multiple n-level nodes. This does not violate DAG properties — it reflects how cognition works. A single percept can be a relevant property for multiple concepts. The support relationship (n-1 → n) is preserved; it is just not exclusive.

## Examples

- CPU Ring (level 0, Percept) -> `structural/subsumed-by` -> Operating System (level 1, Concept): CPU Ring is a mechanism contained within the OS concept.
- Page Table Entry (level 0, Percept) -> `structural/subsumed-by` -> Page Table (level 1, Concept): a PTE is a component of a page table.
- Operating System (level 1, Concept) -> `structural/subsumed-by` -> Linux Kernel Internals (level 5, Domain): the OS is contained within the broader Linux kernel domain.
- Source A (level 0, Source) -> `epistemic/evidence` -> Operating System (level 1, Concept): Source A provides evidence for the OS concept.
- Syscall (level 1, Concept) -> `functional/supports` -> Operating System (level 1, Concept): same-layer relationship.
- Preemption (level 1, Concept) -> `functional/supports` -> Context Switch (level 2, Idea): upward by positive offset.