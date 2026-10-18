# Hologram Emulsification

## 1. Introduction and Core Concept

**Emulsification** is how a hologram's membership is derived from the filesystem.
It answers one question: *given the current working directory, which holograms are
on screen, and which nodes belong to each of them?*

The rule is short:

> At the current working directory's level, every direct child folder is
> emulsified into one hologram containing **every note in that child's recursive
> subtree**, flattened into a single flat set. Descendant folders dissolve into
> that hologram. The CWD's own direct notes form a separate hologram if it has
> any. Nothing crosses between displayed holograms.

**The filesystem is the only source of truth.** There is no membership list, no
virtual-folder record, no emulsion state to store, and nothing to reconcile. The
answer is recomputed from the directory tree every time the CWD changes, and it
ceases to exist on its own the moment the tree changes.

This document is the specification. It sits alongside
[`filesystem-hologram-management.md`](filesystem-hologram-management.md), which
covers the broader concepts, operations, and UI; and alongside
[`untethered-trackball-pinhole-camera-system.md`](untethered-trackball-pinhole-camera-system.md),
which covers how a hologram is rendered once it exists. This document covers only
**which nodes are in which hologram**.

> **Status:** settled design (implemented). Section 10 lists what it
> replaces and Section 11 lists what is still open.
>
> **Reconciliation:** `filesystem-hologram-management.md` previously described a
> superseded emulsification model — a reversible visual overlay in which a parent
> anchor *contained* child anchors. That model has been withdrawn throughout, and
> where the two documents could be read as disagreeing, this one wins.

---

## 2. Definitions

| Term | Meaning |
| --- | --- |
| **Node** | A `.md` note file. Node identity is its vault-relative path. |
| **CWD** | The folder the view is currently anchored at. It is the *presentation level*, not itself necessarily a hologram. |
| **Hologram** | The flat, recursive set of note files contained in a folder and everything below it. |
| **Direct note** | A `.md` file sitting directly in a folder, with no intermediate folder between it and that folder. |
| **Descendant note** | A `.md` file reachable only by descending through one or more child folders. |
| **Displayed hologram** | A hologram that currently appears on screen, with its own anchor. |
| **Emulsified** | A hologram whose node set was flattened from a subtree rather than taken from a single folder. |
| **Level of detail** | How much hierarchy is consolidated into each displayed hologram. Set by how deep the CWD is. |

Two properties follow directly from the definitions and are worth stating
separately because they are easy to conflate:

**A node has one identity, many memberships.** The file
`Linux Kernel Internals/Syscall/Syscall.md` is a single node. It is a member of
the `Syscall` hologram and of the `Linux Kernel Internals` hologram. It is never
cloned, duplicated, or forked into a copy for the parent view. Both views see the
same node; only the set it appears in differs.

**Positions are contextual, not intrinsic.** Where a node sits is a property of
the *active* hologram view — its node set, its edges, its forces, and its
available space — not a property of the file. Changing CWD changes the active
node set and therefore *should* change positions. Nothing needs to be translated,
preserved, or carried across the switch. See Section 8.

---

## 3. The Rule

Let `CWD` be the current working directory. Define:

```text
directNotes(D)      = every .md file directly in D
recursiveNotes(D)   = every .md file anywhere in D's subtree, flattened
hasNotes(D)         = recursiveNotes(D) is non-empty
```

Then the displayed holograms are exactly:

```text
1.  The CWD's own hologram,  { directNotes(CWD) },  if non-empty.
2.  For each direct child folder K of CWD with hasNotes(K):
        one emulsified hologram  recursiveNotes(K).
```

Nothing else is displayed. In particular:

- A descendant folder of `K` at depth ≥ 2 gets **no anchor** and **no hologram of
  its own**. It has dissolved into `K`.
- A direct child folder with no descendant notes anywhere gets **no hologram**. An
  empty folder contributes nothing.
- The CWD's own direct notes do **not** absorb its children. They are their own
  hologram, and each child is a separate one.

**Move up to consolidate, move down to reveal.** Raising the CWD by one level
merges its direct children into their parent — so a consolidated view needs a
parent to consolidate into. Lowering the CWD by one level splits its emulsified
subtree into its direct children — so a consolidated view dissolves when you
descend into it. Filesystem depth *is* the level-of-detail control.

### 3.1 Worked example

```text
E/
  A/
    A1.md
    B/
      B1.md
    C/
      C1.md
      D/
        D1.md
```

| CWD | Displayed holograms | Node sets |
| --- | --- | --- |
| `E` | `A` | `{A1, B1, C1, D1}` |
| `A` | `A`, `B`, `C` | `{A1}`, `{B1}`, `{C1, D1}` |
| `C` | `C`, `D` | `{C1}`, `{D1}` |

Read the top row as the maximum consolidation available without inventing a
parent: `E` has exactly one child with notes, so the entire structure collapses
into a single hologram named `A`. `E` contributes no hologram of its own because
it has no direct notes. Move down one level and the same four notes reappear
distributed across three holograms; `D` now has an anchor of its own because it
is a *direct child* of the CWD, which is the only thing that ever grants one.

### 3.2 The live vault

```text
hologram/
  Linux Kernel Internals/
    Address Space.md
    ... (20 more)
    Scheduler.md
    Syscall/
      CPU Ring.md
      Operating System.md
      Syscall.md
    SIGSEGV and SIGBUS.md
    Thread.md
    ...
```

25 notes, 3 directories.

| CWD | Displayed holograms | Node sets |
| --- | --- | --- |
| `hologram` | `Linux Kernel Internals` | all 25 |
| `hologram/Linux Kernel Internals` | `Linux Kernel Internals`, `Syscall` | `{22 direct notes}`, `{Syscall/CPU Ring, Syscall/Operating System, Syscall/Syscall}` |

At the CWD `hologram`, `Linux Kernel Internals` is a direct child with notes, so
it emulsifies its whole subtree — its 22 direct notes plus `Syscall`'s 3 — into
one hologram of 25 nodes.

At the CWD `Linux Kernel Internals`, the 22 direct notes form the CWD-local
hologram, while `Syscall` is the direct child and stands alone as a 3-note
hologram. The same 25 nodes are partitioned completely differently, with the
emulsification boundary moved one level down.

---

## 4. Edges

**Each displayed hologram is a closed graph.** Edges are built per displayed
hologram, over that hologram's node set alone.

Allowed inside an emulsified hologram — an edge between `C`'s direct note and `D`'s
descendant note is a normal edge, because both are members of the displayed
`C = {C1, D1}`:

```text
C1 ── D1
```

Not rendered at this CWD — edges between distinct displayed holograms:

```text
B1 ── C1        ✗   B and C are separate displayed holograms
B1 ── D1        ✗   D is inside C, not a displayed hologram of its own
A1 ── B1        ✗   A and B are separate displayed holograms
A1 ── C1        ✗   A and C are separate displayed holograms
```

**The nearest displayed ancestor determines edge eligibility.** Two nodes share an
edge if and only if they belong to the same displayed hologram. Nothing else.

This is relative to the CWD, not a property of the files. Move up to `E` and all
four notes become members of one displayed `A` hologram, where every one of those
same wikilinks renders as a normal edge.

---

## 5. Physics

Forces are scoped to a displayed hologram's node set. A node outside the set must
not push, pull, or spring anything inside it, and the settle metric must describe
the visible subset — the same scoping rule the renderer already applies to
visibility filtering, with the emulsified boundary replacing the filter.

An emulsified hologram's physics is indistinguishable from a flat one. A node
that arrived from `D` participates in repulsion, springs, and settling exactly as
a node that came from `C` directly. **There is no per-subfolder force, no
per-folder cluster, and no weighting by depth.** Once a node is in the set, the
directory it came from is not a parameter of the simulation.

---

## 6. Anchors

One displayed hologram gets one anchor, positioned at the centroid of its own node
set. An emulsified hologram's anchor therefore covers the whole flattened set and
drags all of it as a single body — the `unionAnchor()` behaviour generalized from
multi-selection to subtree absorption.

Consequences:

- A descendant folder at depth ≥ 2 has no anchor, so it cannot be dragged as a
  body, dropped onto, or hovered as its own thing. It is not a target; its
  parent's anchor is.
- The union anchor for a multi-selection still exists and is a separate concept;
  it spans *several displayed holograms*, which is exactly what an anchor never
  does otherwise.
- An anchor's identity is the folder it emulsifies, so it always maps back to a
  real directory for filesystem operations — there is no virtual target.

---

## 7. Interaction

A node's behaviour depends only on its own path and on which displayed hologram
it belongs to. There is no "is this node nested?" branch anywhere in the
interaction path.

| Interaction | Rule |
| --- | --- |
| Drag a node | Moves that node. A descendant node drags exactly as a direct one. |
| Hover, select, reveal | Identical for every node in the set. |
| Cross-hologram drop | Rejected between anchors; the two sets never fuse by dropping. |
| Intra-hologram rearrange | No filesystem effect. Layout is not organization. |

Because the node set is derived rather than stored, moving a note into or out of
a folder changes which holograms it appears in, and nothing else needs to
happen — there is no index to update and no emulsion flag to clear.

---

## 8. Positions Change With the CWD

A node's position is not a property of the file. It is a property of the active
view.

```text
CWD = hologram/Linux Kernel Internals/Syscall
    → 3 nodes, settle relative to one another

CWD = hologram/Linux Kernel Internals
    → those 3 nodes join 22 others, so the layout may and should change

CWD = hologram
    → 25 nodes as one hologram, a different physics problem again
```

Switching CWD changes the active node set, which changes the physics problem, so
new positions are the correct outcome — not a regression to be papered over with a
transform. **No position is carried across a CWD change and none needs to be.**

This also settles a question that came up during design: there is no requirement
that a nested layout match the equivalent flat layout. Such an invariant would
contradict this one. Layouts are per-view.

Whether to *cache* a layout per CWD so returning to a level restores what you were
looking at is a UX question, not a correctness one, and is left open
(Section 11).

---

## 9. Derived, Not Persisted

Emulsification is a **pure function** of the directory tree:

```text
holograms(CWD) = f(CWD, tree)
```

Nothing about it is written down. It follows that:

- **Move a note deeper** and it joins an emulsified set at a lower level; the
  higher-level holograms that already contained it are unchanged.
- **Add a child folder with notes** and a new hologram appears at the parent CWD,
  absorbing that subtree.
- **Delete the last note in a subtree** and the folder stops having notes, so it
  contributes no hologram and no anchor. It dissolves without any cleanup, because
  there was never any state to clean.
- **Rename a folder** and the holograms follow it, since membership is positional.

Nothing can drift out of sync with the filesystem, because there is no second
copy of the truth to drift from.

---

## 10. Relationship to the Current Implementation

This document supersedes the current model in three places. Reading this section
is only necessary if you are changing existing code.

| Current behaviour | Replaced by |
| --- | --- |
| `getHologramDir` returns `parts[1]`, so every note resolves to the *top-level* folder regardless of CWD | Membership is resolved against the CWD level, with recursive flattening below it |
| Emulsification is expressed through cumulative directory tags (`readTagsFromPath` gives a nested node all of its ancestors' tags), with membership decided by "does any tag match the filter" | Membership is the recursive file closure of a displayed hologram's folder |
| `isEmulsifiedHologram(tag)` marks a folder as emulsified when it has child folders with notes, and the controls panel lists **every** folder name as its own selectable entry | Emulsification is relative to the CWD, not an intrinsic property of a folder; the list of displayed holograms is computed from the CWD's direct children |

The consequence worth stating plainly: **`Syscall` is not "emulsified."** Nothing
is, intrinsically. At CWD `hologram`, `Syscall` is dissolved into
`Linux Kernel Internals`; at CWD `Linux Kernel Internals`, it is a standalone
hologram. The mark of a folder is its own direct note count, and every folder's
membership depends on where you are standing.

---

## 11. Open Items

These are deliberately unsettled. None of them undermine the rule in Section 3.

1. **Root CWD.** Is `hologram/` itself a selectable CWD? Under the rule it is
   valid and displays its direct children with notes, each emulsified — but the
   natural "go up one level" from `hologram/Linux Kernel Internals` lands there,
   and the `…` root needs a defined behaviour.
2. **Cross-hologram relations.** The graph may record that `B1` links to `C1`.
   Section 4 says do not render it. Whether the relation should be *surfaced*
   somehow (a count badge on an anchor, a peek on hover) is undecided; silently
   dropping it is the specified behaviour and the surface is the open question.
3. **Empty-folder navigation.** A folder with no notes anywhere has no hologram,
   so it is not enterable as a CWD. Whether it should be enterable-but-empty so
   the user can keep descending is undecided.
4. **Layout continuity.** Section 8 establishes that positions must change across
   a CWD switch. Whether returning to a previous CWD restores the layout it had
   last time is a separate, UX-level choice.
5. **Frontmatter membership.** Hologram membership is purely positional; there is
   no `hologram:` / `holograms:` frontmatter field, and any such key is stripped
   on import and during migration. This document assumes purely positional
   membership throughout.
