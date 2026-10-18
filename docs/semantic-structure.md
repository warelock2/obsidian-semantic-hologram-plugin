# Semantic Structure Specification: Hologram Topology & Abstraction Hierarchy

This document describes how Semantic Hologram files are structured and how the
knowledge graph is organised. It reflects the plugin's shipped defaults; every node
type, relationship type, and level is configurable under **Settings → Semantic
Hologram**.

## 1. The Abstraction Hierarchy

Structured hologram nodes carry a **level** that places them on an abstraction ladder.
Higher-level nodes are built from lower-level ones, which gives the graph its
direction. `thought` nodes sit outside the ladder (no level), and evidence nodes sit
beneath it.

| Level | Node type | Role | Examples |
| --- | --- | --- | --- |
| — | `thought` | Free-form Zettelkasten thought or brainstorming note. No level, no evidence requirement. | any working idea |
| 0 | `percept` | Atomic observed percept or raw data point. | a single measurement |
| 1 | `concept` | A single foundational concept. | `Page Table Entry`, `Syscall` |
| 2 | `idea` | A synthesis built from concepts. | `Virtual Memory`, `Scheduler` |
| 3 | `pattern` | A recurring strategy among ideas. | `Copy On Write`, `Demand Paging` |
| 4 | `topic` | A broader topical grouping. | `Linux Kernel Internals` |
| 5 | `domain` | A subject domain or field of study. | `Operating Systems` |
| 6 | `field` | A high-level academic or professional field. | `Computer Science` |

**Evidence types** carry no level but anchor the base of the ladder:

| Node type | Role |
| --- | --- |
| `source` | A source document: book, paper, video, interview, article. |
| `authority` | A subject-matter expert lending authority as evidence. |
| `data` | A measurement of objectively existing things. |

Every level, node type, colour, and its enabled state is editable in settings. The
ladder above is the shipped default, not a hard constraint.

---

## 2. Frontmatter Schema

Every semantic node note in the `hologram/` folder begins with frontmatter:

| Field | Meaning |
| --- | --- |
| `hologram-node: true` | Marks the note as part of the semantic topology graph. **Required.** |
| `node-type` | The node's type (see Section 1). `note-type` is accepted as a legacy alias. |
| `created` | Creation date (`YYYY-MM-DD`). |
| `groups` | Parent node(s) this node rolls up into (membership edges). |
| *(directory location)* | Hologram membership is determined by the note's path under `hologram/` (e.g. `hologram/<topic>/note.md`), not by frontmatter. |
| `local-confidence` | Optional user-set confidence, `0`–`1`. |
| `source-kind` | For evidence notes, the credibility class (`source/data`, `source/scientific`, …). |

The `groups` field expresses upward membership: an `idea` lists the `pattern` or
`topic` it contributes to, a `topic` rolls up into a `domain`, and so on. This is how
individual nodes are attached to the hierarchy rather than to each other directly.

---

## 3. Relationship Semantics

Relationships are explicit lines under a `## Relationships` heading (a `## Relations`
heading is also accepted):

```
- <relation-type> [[Target Note]] (<strength>)
```

- **Relation families.** Typed relationships such as `logic/supports`,
  `logic/contradicts`, `structural/depends-on`, and `structural/subsumed-by` live in
  families (`logic/…`, `structural/…`). The generic `related` type carries no family.
- **Strength.** A `0`–`1` value. Stronger relationships pull nodes closer in the
  layout and render more prominently. The fallback for any relationship created
  without an explicit strength is **Settings → Default relationship strength**
  (`0.5` by default).
- **Direction.** Every edge is directed, from the note that declares it to its
  target. Arrowheads show the direction. The `## Incoming relationships` section is
  generated from other notes' edges and is read-only.

All relationship types can be added, renamed, recoloured, enabled, disabled, or
deleted in settings, so you can model your graph with whatever vocabulary your domain
needs.

---

## 4. Holograms and Fields

- **Hologram.** An interconnected set of nodes representing a specific sub-topic or
  discipline. Any level can serve as the root of a hologram.
- **Composite hologram (multi-topic vat).** A container created by pouring multiple
  holograms together, enabling cross-domain synthesis while preserving each
  hologram's individual provenance.

---

## 5. Standard Node Template

The shipped template for a new semantic node is
[`example-node.md`](example-node.md):

```markdown
---
hologram-node: true
node-type: concept
created: {{date}}
groups:
  - "[[Parent Node]]"
---

# {{title}}

## Relationships

- related [[Another Note]] (0.5)

## Incoming relationships (read only)
```

`{{date}}` and `{{title}}` are Obsidian core **Templates** plugin variables. The
plugin's **Create hologram node** command produces a note in the same shape without
needing a template.

---

## 6. Thought Nodes vs. the DAG

The structured node types form a **Directed Acyclic Graph**: directed edges with no
directed cycles, layered by level, anchored at the bottom by evidence. `thought`
nodes are deliberately **outside** that structure — they have no level and no
mandatory evidence, so they can hold raw associations until they are ready to be
promoted into levelled nodes.
