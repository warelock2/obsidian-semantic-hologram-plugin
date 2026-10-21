# OS Filesystem as DAG Mirror & World-Space Root

> **Status:** IDEA — superseded. Wave 2026-10-15. Superseded by [`hologram-emulsification.md`](../functional/hologram-emulsification.md). See [`docs/README.md`](../README.md).

## Ideation Summary (from session-bb36dd71-668c-4bb2-a205-2002c94048f4.md)

This document captures the recent ideation discussion about using the **operating system filesystem** (not the Obsidian vault filesystem) as the primary mirror of a DAG (Directed Acyclic Graph) structure, and how note paths relative to a current working directory (CWD) identify the root of world space being rendered in the hologram plugin.

## Core Concept: Filesystem = DAG, CWD = World-Space Root

- The **OS filesystem** mirrors the DAG structure of the knowledge graph.
- **Current Working Directory (CWD)** identifies the root of world space being rendered.
- Note **paths relative to CWD** determine their position/origin in the 3D hologram view.
- The OS filesystem provides natural operations for **emulsification, merging, splitting, and copying** — these are interpreted by the plugin for rendering.

## OS Filesystem Operations & Rendering Interpretations

### 1. Emulsification (Overlay/Merge Visual State)
- **Action**: User moves one directory into another via OS file browser (e.g., dragging `hologram-A/` into `hologram-B/`).
- **Filesystem result**: The source directory becomes a subdirectory of the destination (`.../B/A/...`).
- **Visual rendering**: The plugin renders overlapping nodes from both directories as a single "emulsified" hologram — nodes appear merged/overlapping in the view, but remain separate in the filesystem.
- **Single-action reversal**: The plugin supports a reversal operation that regardless of whether the user performed "move A into B" or "move A and B under a common parent," a single GUI action can reverse the emulsified state, returning nodes to their original separate rendering.
- **Key design**: Both filesystem actions produce the same visual outcome (emulsified overlapping nodes with separate anchors/identities), and the reversal is structure-agnostic.

### 2. Merging (Permanent Fusion)
- **Action**: User copies/moves nodes from one hologram directory into another, with a "wizard" for content merging.
- **Filesystem result**: Node note files are combined (often using a `---` separator to partition content histories) and reside in the destination directory. The destination hologram tag is set as the sole tag for merged nodes.
- **Visual rendering**: Merged nodes render as a single hologram with combined edges and content. The original source hologram may be deleted or left as empty shell.
- **Content merging**: Uses `---` separator to preserve both content histories within one file, enabling later splitting back.

### 3. Splitting (Move/Emulsify Reverse)
- **Action**: User selects a subset of nodes from an emulsified hologram and "pulls them apart" via drag.
- **Filesystem result**: Node note files are moved from the shared/emulsified directory back into their own dedicated hologram directory. New hologram directory created with selected nodes.
- **Visual rendering**: Nodes separate into their own individual holograms. The original emulsified hologram is reduced to only the remaining nodes.
- **Split modes**: 
  - `Smove` — nodes are physically moved (directory relocation), reversible.
  - `Scopy` — nodes are copied, creating a permanent fusion unless manually reversed.

### 4. Copying (Duplicate Introduction)
- **Action**: User copies a node note file to a new location under a different hologram directory.
- **Filesystem result**: A duplicate `.md` file exists in both the source and destination hologram directories. The note exists in multiple hologram folders.
- **Visual rendering**: The node appears in both holograms. Edges/relationships must be explicitly assigned to one hologram or the other when created (user-mediated decision).

## Path-to-World-Space Mapping

| Concept | OS Filesystem Equivalent | Hologram Rendering |
|---------|-------------------------|-------------------|
| **World root** | CWD (Current Working Directory) as identified by the plugin | The origin `(0,0,0)` in world space; all positions are relative to this root |
| **Note/node** | `.md` file path relative to CWD (e.g., `hologram/operating-systems.md`) | A sphere/node in 3D space; position derived from path hash/vector |
| **Hologram topic/folder** | Subdirectory under CWD (e.g., `hologram/linux/` ) | A grouping/anchor; all nodes in the directory belong to that hologram |
| **Relationship edge** | Text lines in `## Relationships` section referencing `[[Target Note]]` | Directed spring/edge between spheres; strength influences length/tension |
| **Emulsified state** | Source directory moved into destination directory (`.../B/A/...`) | Overlapping nodes with shared edges, rendered with `---` separator visual overlay |
| **Merge/fusion** | Content merged with `---` separator; destination retains single hologram tag | Nodes appear as one, edges combined, content histories partitioned |
| **Split/separation** | Files moved back to own directory; new hologram directory created | Nodes render separately; edges reassigned to new hologram |

## Design Principles Derived

1. **Filesystem is memory** — The directory structure *is* the graph state. No separate database. The plugin reads the OS tree and maps it to the 3D world.

2. **Path = identity** — A note's path relative to CWD determines its world-space position and hologram affiliation. Moving a file moves its visual node.

3. **Operations are filesystem-first** — Emulsify, merge, split, copy are initiated via OS file browser actions (drag, drop, move, copy). The plugin watches these and updates the in-memory graph accordingly.

4. **Single-action reversal** — The plugin is designed so that regardless of which of two possible filesystem operations produced the current emulsified state, one GUI action can reverse it. This requires the plugin to track the "intent" or structural outcome, not just the raw filesystem state.

5. **Emulsification is a rendering overlay** — The `---` separator, overlapping nodes, and shared edges are **rendering choices** made when the plugin draws children of a directory perceived as emulsified. No files are moved, renamed, or merged on disk unless the user explicitly performs a merge operation.

6. **One-level depth for UI** — The hover/overlay never recurses deeper than the parent's immediate children, keeping the UI simple and uncluttered. If a child has its own children, a "→ See children" link may be offered, but the default view stays at the parent's immediate children.

## Summary

The OS filesystem serves as both **data store** and **structural mirror** for the hologram DAG. The CWD identifies the current world-space root. Natural OS file browser tools (move, copy, emulsify) are interpreted by the plugin for rendering, with careful design ensuring that:

- The visual state always has a clear mapping back to the filesystem
- Reversal operations are single-action and structure-agnostic
- Content merging uses the `---` separator for reversibility
- Emulsification is primarily a visual overlay, not a filesystem commit, unless the user explicitly merges

This design builds on the "filesystem-as-memory" metaphor, where the directory tree is the authoritative state, and the 3D hologram view is a rendering of that tree — with operations on the tree propagating naturally from the OS level down to the plugin's visual rendering.

--

*This document was generated as part of the documentation for the Semantic Hologram Obsidian plugin. It focuses on the ideation discussion from session-bb36dd71-668c-4bb2-a205-2002c94048f4.md regarding the OS filesystem as a DAG mirror and world-space root.*