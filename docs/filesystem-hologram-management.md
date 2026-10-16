# Filesystem-Hologram Management: Concepts & UI Design

## Vision Statement

The OS filesystem serves as both **data store** and **structural mirror** for the hologram DAG. The directory tree is the authoritative state — the 3D hologram view is a rendering of that tree, with operations on the tree propagating naturally from the OS level down to the plugin's visual rendering.

**Core principle:** *Filesystem is memory.* The directory structure IS the graph state. No separate database.

---

## 1. Identity Model

### 1.1 Directory = Hologram Membership

A file's location in a directory of a given name constitutes membership in the hologram with the same name as the directory.

| Concept | Filesystem Equivalent |
|---------|----------------------|
| **World root** | Current Working Directory (CWD) as identified by the plugin |
| **Note/node** | `.md` file in a directory |
| **Hologram** | Directory containing node files |
| **Node identity** | File path relative to CWD |
| **Edge/relationship** | Wikilinks, `[[links]]`, or `## Relationships` section |

### 1.2 The `holograms:` Frontmatter Tag (Optional)

While directory location is the primary identity mechanism, an optional `holograms:` frontmatter tag can provide additional metadata:

```yaml
---
holograms: [hologram-a, hologram-b]
nodeType: concept
---
```

- **Move mode**: Tag is updated to reflect new directory membership
- **Copy mode**: Tag accumulates multiple hologram memberships
- **Export**: Tag and relationships section are removed, returning the note to plain Zettelkasten form

### 1.3 Import/Export Cycle

| Phase | State | Transformation |
|-------|-------|----------------|
| **Before import** | Plain ZK note with wikilinks | — |
| **Import** (move into hologram directory) | Hologram node | Add frontmatter + relationships section; convert wikilinks to typed edges |
| **Export** (move out + strip metadata) | Plain ZK note | Remove frontmatter + relationships section; convert edges back to wikilinks at bottom of note |

**Default node type on import:** `thought` (cannot be deleted from the node type list; serves as the universal "catch-all" for imported ZK notes)

---

## 2. Operations

### 2.1 Split (Drag Separation)

**Trigger:** User selects nodes, drags them as a group beyond the `separationDistance` threshold.

**Filesystem result:** Node files move to a new directory named for the new hologram.

**Two modes:**

| Mode | Tag Behavior | Visual Result |
|------|-------------|---------------|
| **Smove** (default) | Node gets only the new tag | Disappears from original, appears in new hologram |
| **Scopy** | Node gets both old + new tag | Appears in both holograms |

**Reversal:** Move files back to original directory, restore tags.

### 2.2 Emulsification (Overlay/Merge Visual State)

**Trigger:** User moves one directory into another via OS file browser, OR drags one anchor onto another.

**Filesystem result:** Source directory becomes subdirectory of destination (or both placed under common parent).

**Visual rendering:** Overlapping nodes with shared edges, rendered as a single "emulsified" hologram. Files remain separate — no content merging.

**Key design:** Both filesystem actions produce the same visual outcome. Reversal is structure-agnostic.

### 2.3 Merge (Permanent Fusion)

**Trigger:** User explicitly merges two holograms via wizard.

**Filesystem result:** Node files combined into destination directory. Same-named files have content merged with `---` separator preserving both histories.

**Visual rendering:** Nodes appear as one, edges combined, content histories partitioned.

**The Wizard addresses:**
- Which content to keep when same-named files collide
- How to combine edge lists
- Final node content (keep A, keep B, or merge with `---` separator)

### 2.4 Copy (Duplicate Introduction)

**Trigger:** User copies a node note file to a new location under a different hologram directory.

**Filesystem result:** Duplicate `.md` file exists in both source and destination directories. The note carries multiple `holograms:` tags.

**Visual rendering:** The node appears in both holograms. Edges/relationships must be explicitly assigned to one hologram or the other when created.

---

## 3. Directory Structure Examples

### 3.1 Basic Hologram

```
vault/
  hologram-a/
    my-note.md
    another-note.md
```

### 3.2 Emulsified State (A emulsified into B)

```
vault/
  hologram-b/
    hologram-a/
      my-note.md
      another-note.md
    b-note.md
```

### 3.3 Common Parent (A and B under shared parent)

```
vault/
  shared-parent/
    hologram-a/
      my-note.md
    hologram-b/
      another-note.md
```

### 3.4 Nested Holograms

```
vault/
  parent-hologram/
    child-a/
      note-x.md
    child-b/
      sub-child-c/
        note-y.md
      note-z.md
```

---

## 4. UI Design

### 4.1 Anchor Rendering

| Anchor Type | Visual | Meaning |
|-------------|--------|---------|
| **Normal anchor** (no children) | Standard circle | A leaf hologram with no sub-holograms |
| **Parent anchor** (has children) | Circle with three shapes inside (circle, triangle, square) | Contains child holograms; hover to reveal |

**Three-shape glyph mapping:**
- **Circle** → `thought` node type
- **Triangle** → `concept` node type
- **Square** → `percept` node type

### 4.2 Hover Interactions

| Action | Result |
|--------|--------|
| **Hover over parent anchor** | Child anchors appear as temporary, selectable glyphs connected by thin edges |
| **Hover over child anchor (no children)** | Stays as normal anchor rendering |
| **Hover over child anchor (has children)** | Blows up into a box with its own children inside |
| **Move hover away** | All overlays disappear |

**Depth limit:** One level deep only. Deeper navigation via OS file browser or Obsidian file explorer.

### 4.3 Drag Interactions

| Action | Filesystem Result |
|--------|-------------------|
| **Drag child anchor to vault root** | Child directory moves to root; becomes top-level hologram |
| **Drag child anchor onto another parent** | Child directory re-parented to new parent |
| **Drag anchor A onto anchor B** | A's directory moves into B's directory (same as OS move) |
| **Shift-drag anchor** | Copy mode — directory copied, not moved |
| **Esc during drag** | Cancel; no filesystem change |

### 4.4 Window/Pane Model (OS-Native)

Each anchor IS a directory. Double-clicking an anchor opens the directory in the OS standard filesystem browser as a window.

- Users can open multiple windows for multiple anchors
- OS manages window state, focus, and arrangement
- Plugin watches filesystem changes and updates internal graph state
- Closing a window does not affect filesystem state

**Title bar shows the path** (e.g., `hologram-A/B/child-X`) for navigational context.

### 4.5 Single-Action Reversal

One GUI action — **"Un-emulsify"** — reverses any emulsification regardless of which filesystem action caused it.

**How it works:**
1. Plugin reads the current directory hierarchy
2. Detects whether one directory is nested inside another (move-into case)
3. Detects whether two directories share a common parent (common-parent case)
4. Moves directories back to their original locations (vault root)

**No history stack needed.** The filesystem structure IS the memory.

### 4.6 Visualization Modes

| Mode | Rendering |
|------|-----------|
| **Edges** | Parent and child anchors rendered with explicit edge lines between them |
| **Box/Circle containment** | Parent rendered as box/circle with child anchors inside; containment implies the relationship |

**Recommended:** Box/circle containment — maps 1:1 to directory hierarchy, cleaner visual, no edge clutter.

---

## 5. The `---` Separator Pattern

When two nodes of the same name are merged into a single file:

```markdown
# Node Title
Node type: concept

## Relationships
- supports: [[other-node]] (0.7)
- contradicts: [[another-node]] (0.4)

---
Content from first hologram's version of this node.

---
Content from second hologram's version of this node.
```

**Properties:**
- Self-documenting: the file declares its own split/merge state
- Naturally reversible: split at `---` markers to restore separate files
- No external metadata needed
- Content preserved through both merge and split operations

---

## 6. Node Type System

### 6.1 Default Node Types (Top of List)

| Type | Description | Level |
|------|-------------|-------|
| `thought` | Semantic unit not yet rationally integrated | — |
| `percept` | Objective reality sense data | 0 |
| `concept` | A single foundational concept | 1 |
| `idea` | An emerging idea or thought | 2 |
| `pattern` | A recognized recurring pattern | 3 |
| `topic` | A broader topical grouping | 4 |
| `domain` | A subject domain or field of study | 5 |
| `field` | A high-level academic or professional field | 6 |

**`thought` is undeletable** — serves as the universal default for imported ZK notes.

### 6.2 Three-Shape Glyph

The three shapes inside a parent anchor represent the three most common node types that can be created or promoted inside that parent:
- Circle = `thought`
- Triangle = `concept`
- Square = `percept`

---

## 7. Design Principles Summary

1. **Filesystem is memory** — Directory structure IS the graph state
2. **Path = identity** — A note's path determines its hologram membership
3. **Operations are filesystem-first** — Split, merge, emulsify initiated via OS actions
4. **Single-action reversal** — One GUI action reverses any emulsification
5. **Emulsification is a rendering overlay** — Visual choice, not filesystem commit
6. **One-level depth for UI** — Hover/overlay never recurses deeper than immediate children
7. **Import/export cycle** — ZK notes ↔ hologram nodes via frontmatter + relationships section
8. **No filename collisions** — Directories isolate namespaces naturally
9. **OS-native window management** — Anchors open as OS folder windows
10. **Physical isolation** — Each hologram's nodes in its own directory
