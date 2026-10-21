# Filesystem-Hologram Management: Concepts & UI Design

> **Status:** SPEC — concepts & UI. Wave 2026-10-15, revised 2026-10-18. Emulsification is specified in [`hologram-emulsification.md`](hologram-emulsification.md); where they disagree, that one wins. See [`docs/README.md`](../README.md).

## Vision Statement

The OS filesystem serves as both **data store** and **structural mirror** for the hologram DAG. The directory tree is the authoritative state — the 3D hologram view is a rendering of that tree, with operations on the tree propagating naturally from the OS level down to the plugin's visual rendering.

**Core principle:** *Filesystem is memory.* The directory structure IS the graph state. No separate database.

> **Emulsification is specified in [`hologram-emulsification.md`](hologram-emulsification.md).**
> That document is the authority on which nodes belong to which hologram, how the
> displayed set is partitioned at a given CWD, and how edges and physics are
> scoped. Where this document and that one disagree, that one wins.

---

## 1. Identity Model

### 1.1 Directory = Hologram Membership

A file's location determines its membership. A hologram's membership is the
**recursive** set of `.md` files in a folder and everything below it, flattened —
not merely the files sitting directly in that folder. See
[`hologram-emulsification.md`](hologram-emulsification.md) §2–3.

| Concept | Filesystem Equivalent |
|---------|----------------------|
| **Presentation level** | Current Working Directory (CWD) — selects which holograms are displayed; it is not necessarily a hologram itself |
| **Note/node** | `.md` file; identity is its vault-relative path |
| **Hologram** | A folder plus its recursive subtree of note files, flattened into one set |
| **Node membership** | A node belongs to every hologram whose subtree contains it — a nested note belongs to its child folder *and* to each ancestor |
| **Edge/relationship** | Wikilinks, `[[links]]`, or `## Relationships` section, rendered only between nodes in the same displayed hologram |

### 1.2 Hologram Membership (Directory-Based)

Hologram membership is determined entirely by the note's path under `hologram/`.
There is no `holograms:` (or `hologram:`) frontmatter field; the plugin strips
any such key on import and during migration. A note at `hologram/<a>/<b>/note.md`
belongs to both `a` and `b`.

```yaml
---
hologram-node: true
node-type: concept
---
```

- **Move mode**: Moving the file changes its hologram membership.
- **Copy mode**: Copying the file creates a distinct node in each destination folder.
- **Export**: Frontmatter and the `## Relationships` section are removed, returning the note to plain Zettelkasten form.

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

| Mode | Filesystem Result | Visual Result |
|------|-------------------|---------------|
| **Smove** (default) | The file moves; the old folder loses it | Disappears from the old hologram, appears in the new one |
| **Scopy** | The file is copied; both paths exist | Two nodes, one per file — see §2.4 |

**Reversal:** Move the file back in the filesystem; the graph follows.

### 2.2 Emulsification (Recursive Flattening)

**Trigger:** A folder exists below another folder. That is the entire trigger — no
action, no overlay, no state.

**Filesystem result:** None. Emulsification changes no files.

**Visual rendering:** At a given CWD, each direct child folder is emulsified into
one hologram containing every note in that child's recursive subtree, flattened.
Descendant folders dissolve into it and receive no anchor. Sibling displayed
holograms remain separate: no edge and no spring crosses between them.

**Key design:** Emulsification is a pure function of the directory tree, not a
visual choice. It cannot be toggled, and it needs no reversal — remove the
children and the emulsion dissolves on its own. The full rule, with worked
examples, is in [`hologram-emulsification.md`](hologram-emulsification.md).

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

**Filesystem result:** A second `.md` file exists in the destination directory.

**Visual rendering:** Two distinct nodes, one per file. Because membership is
positional rather than tag-based, a copy is **not** a single node shared between
two holograms — it is a duplicate. An edge between the two copies is rendered
wherever both land in the same displayed hologram, and nowhere else.

---

## 3. Directory Structure Examples

### 3.1 Basic Hologram

```
vault/
  hologram-a/
    my-note.md
    another-note.md
```

### 3.2 Nested Subtree (A inside B)

```
vault/
  hologram-b/
    hologram-a/
      my-note.md
      another-note.md
    b-note.md
```

**What you see:** at CWD `hologram-b`, one hologram of three nodes —
`{my-note, another-note, b-note}`. `hologram-a` has dissolved into it and has no
anchor of its own. The same single hologram is what you see at CWD `vault`,
because `hologram-b` is then the direct child holding the whole subtree.

### 3.3 Common Parent (A and B as siblings)

```
vault/
  shared-parent/
    hologram-a/
      my-note.md
    hologram-b/
      another-note.md
```

**What you see:** the opposite of §3.2, from the opposite direction.

- At CWD `shared-parent`: **two** separate holograms — `hologram-a = {my-note}` and
  `hologram-b = {another-note}`. Sharing a parent makes them siblings; siblings are
  not emulsified together.
- At CWD `vault`: **one** hologram — `shared-parent = {my-note, another-note}`.

The same two files, one tree, two completely different views — decided solely by
where the CWD sits.

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

Displayed holograms are **flat siblings**. At any CWD there is no anchor inside
another anchor, so there is no parent/child anchor distinction to render.

| Anchor | Meaning |
|--------|---------|
| **One per displayed hologram** | Sits at the centroid of that hologram's node set; an emulsified anchor covers its whole flattened subtree and drags it as a single body |
| **The CWD's own hologram** | Present only if the CWD has direct notes; rendered exactly like any other |
| **Union anchor** | Temporary; spans 2+ *selected* displayed holograms so a selection can be dragged and probed as one body |

**On the three-shape glyph.** The circle/triangle/square glyph existed to
distinguish a parent anchor by showing the node types of the child holograms inside
it. With flat anchors there are no child holograms to enumerate, so the glyph no
longer carries information. Node type is conveyed by the node, not by its
hologram's anchor.

### 4.2 Hover Interactions

Anchors have no nested structure, so hovering an anchor no longer reveals child
holograms. The hierarchy is explored by **moving the CWD**, not by hovering.

| Action | Result |
|--------|--------|
| **Hover an anchor** | Identifies the hologram and its node count |
| **Enter a hologram** | Sets the CWD to that folder; the level below is rendered as its own set of holograms |
| **Go up one level** | CWD moves to the parent; the display consolidates into one emulsified hologram per direct child |
| **Hover a multi-selection** | The union anchor offers the selection as one draggable body (peek) |

**Depth limit:** removed. There is no overlay recursion to bound, because there is
no overlay recursion — each CWD renders its level in full, and descending is a CWD
change rather than a reveal.

### 4.3 Drag Interactions

Displayed holograms are closed graphs, so there is no anchor nesting to drag
through. Dragging moves the *node*; restructuring is a filesystem act.

| Action | Filesystem Result |
|--------|-------------------|
| **Drag a node** | None. A node's position is layout, not organization. A descendant node drags exactly like a direct one. |
| **Drag a node onto another hologram's anchor** | Rejected — displayed holograms do not fuse by drop |
| **Move a folder into another, in the OS** | The result emulsifies at the next level up. This is ordinary nesting, not a dedicated "emulsify" action |
| **Esc during drag** | Cancel; no filesystem change |

### 4.4 Window/Pane Model (OS-Native)

Each anchor maps to exactly one real folder — the root of the subtree it
emulsifies. Double-clicking an anchor opens that folder in the OS filesystem
browser as a window.

- Users can open multiple windows for multiple anchors
- OS manages window state, focus, and arrangement
- Plugin watches filesystem changes and updates internal graph state
- Closing a window does not affect filesystem state

**Title bar shows the path** (e.g., `hologram-A/B/child-X`) for navigational context.

### 4.5 Reversal

**There is no "Un-emulsify" action, and none is needed.** Emulsification is not a
state that can be committed and undone; it is a derived reading of the directory
tree. To reverse it, move the folders back in the OS file browser, exactly as you
would undo any other move. There is nothing further to undo, because nothing
further happened.

**No history stack needed.** The filesystem structure IS the memory.

### 4.6 Visualization Modes

| Mode | Rendering |
|------|-----------|
| **Separated anchors** | One anchor per displayed hologram, siblings; a hologram's extent is implied by the nodes around its anchor |
| **Explicit edges between anchors** | Not applicable — displayed holograms have no structural relation to draw between them |

**Removed:** box/circle containment. It encoded the directory hierarchy by
nesting a child anchor inside its parent. Displayed holograms are flat siblings,
so there is nothing to contain, and the hierarchy is now carried by the CWD rather
than by the picture.

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

### 6.2 Three-Shape Glyph (withdrawn)

The three shapes once nested inside a parent anchor encoded the node types
available inside it — circle = `thought`, triangle = `concept`, square =
`percept`. Under the emulsification model displayed holograms are flat siblings, so
an anchor has no children to summarize and the glyph has nothing to encode.

The *node type system itself is unaffected* (§6.1); only this use of it on the
anchor is withdrawn. If node types are ever surfaced in the graph, they belong on
the nodes.

---

## 7. Design Principles Summary

1. **Filesystem is memory** — Directory structure IS the graph state
2. **Path = identity** — A note's path determines its hologram membership
3. **Operations are filesystem-first** — Split, merge, and nesting initiated via OS actions
4. **Reversal is just a move** — There is nothing to undo but the folder move that caused it
5. **Emulsification is derived, not stored** — A hologram is the recursive file closure of a folder, recomputed from the tree, so it cannot drift
6. **Depth is the level of detail** — Moving the CWD down reveals structure; moving up consolidates it
7. **Holograms are closed graphs** — No edge and no spring crosses between two displayed holograms
8. **Positions are contextual** — A node's place follows the active node set, so changing CWD legitimately changes the layout
9. **Import/export cycle** — ZK notes ↔ hologram nodes via frontmatter + relationships section
10. **No filename collisions** — Directories isolate namespaces naturally
11. **OS-native window management** — Folders open as OS windows
12. **One file, many memberships** — A node is stored in exactly one folder, yet belongs to every hologram whose subtree contains it
