# Semantic Hologram

An Obsidian plugin that turns your notes into a navigable **3D semantic graph** —
a *hologram* — where every note is a sphere, every relationship is a typed directed
edge, and you fly the camera through your own knowledge structure.

Semantic Hologram is a spatial extension of the **Zettelkasten** method: it keeps
the flat, link-based note network you already have, and gives it depth, hierarchy,
and direction so that structure you could never see in a list becomes visible and
traversable.

---

## Overview

**Purpose.** A Zettelkasten grows into a dense web of links. That web is powerful,
but it is also flat: it tells you *that* two notes are connected, not *what kind* of
relationship holds, nor *which way* knowledge flows, nor which ideas are load-bearing
and which are dangling. Semantic Hologram renders the web in 3D so that coupling,
clusters, bridges, orphans, and abstraction layers become immediately visible — to a
human navigating it and to a machine reading it.

**Goals.**

- **Preserve provenance.** Every abstraction can be traced downward to the evidence
  (percepts, data, sources) that supports it, so nothing floats disconnected from
  reality.
- **Add direction and hierarchy.** Relationships carry a type *and* a direction;
  notes carry an abstraction level, so the network is a **Directed Acyclic Graph**
  over your Zettelkasten, not just an undirected blob.
- **Stay a real Zettelkasten.** Notes remain plain Markdown files in your vault.
  You can write them, link them, and edit them by hand, with or without the plugin.
- **Support both rigor and play.** A strict, evidence-grounded structure for settled
  knowledge, and free-form **Thought** nodes for brainstorming that can later be
  promoted into the structure.
- **Make structure inspectable.** Force-directed layout, 2D/3D views, perspective or
  orthographic projection, confidence and "gravitas" colouring, and a diffractometer
  that traces how influence spreads through the network.

**Zettelkasten.** The Zettelkasten ("slip box") method is a personal knowledge system
built on atomic notes richly cross-linked to one another. Learn more at the
canonical community resource, [zettelkasten.de — Introduction to the
Zettelkasten](https://zettelkasten.de/introduction/), or read the overview on
[Wikipedia](https://en.wikipedia.org/wiki/Zettelkasten).

---

## What You Can Do With Semantic Holograms

- **See a Zettelkasten you already own.** Point the importer at existing notes and
  watch your link network become a force-directed hologram.
- **Map a body of knowledge as a dependency DAG.** Model a technical domain (for
  example, Linux kernel internals) as concepts, ideas, and patterns linked by
  `depends-on` / `supports` edges; find the clusters and the bridges. See
  [`docs/novel-discoveries.md`](docs/novel-discoveries.md).
- **Ground your abstractions.** Link high-level ideas down to percepts, data, and
  sources, so every claim has a path to evidence and no abstraction "floats".
- **Brainstorm without polluting rigor.** Capture raw associations as `Thought`
  nodes, then promote the good ones into levelled DAG nodes when they are ready.
- **Trace influence across the graph.** The diffractometer diffuses "energy" from a
  node to reveal resonance clusters and a bottom-up study path.
- **Explore epistemics.** The system is built around a concrete → abstract →
  concrete reasoning cycle for science, engineering, and invention. See
  [`docs/science-discovery-and-reason.md`](docs/science-discovery-and-reason.md).
- **Let tools and AI read the structure.** An optional MCP server exposes the graph
  to external agents.

---

## Installation

Semantic Hologram is an **Obsidian plugin**.

1. Open Obsidian and go to **Settings → Community plugins**.
2. Select **Browse** to open the community plugin list.
3. Search for **Semantic Holograms**.
4. Select the plugin and choose **Install**, then **Enable**.

That is all that is required. Open the hologram from the ribbon icon
(**waypoints**), or run the command **“Open Semantic Hologram graph”** from the
command palette.

> Requires a desktop or mobile Obsidian that supports community plugins. The plugin
> is not desktop-only.

---

## Quick Start

This guide takes you from an existing Zettelkasten to a rendered hologram.

### 1. Your notes are an Obsidian vault

Hologram notes are ordinary Markdown files that live **inside your Obsidian vault**,
in a top-level folder named **`hologram/`**. That folder is created automatically on
first import or on the first **Create hologram node** command. Because they are vault
notes, they appear in Obsidian's file explorer and in Obsidian's own graph view like
anything else.

### 2. Import your existing Zettelkasten notes

There are three ways in:

- **Import a single note** — command **“Import note into Holograms”**. Pick a note
  from the vault and give it a hologram tag.
- **Bulk import a folder** — command **“Bulk import zk notes and review
  connections”**. Pick a folder; every note in it is imported and then reviewed.
- **Import an Incoming folder** — drop notes into the folder configured at
  **Settings → Semantic Hologram → Incoming folder** (default `Incoming/`), then run
  **“Import incoming Zettelkasten notes”**.

When a note is imported, the plugin **copies it into `hologram/<name>.md`**, marks it
as a hologram node, and rewrites its links to point at the hologram copies. Your
original note is left untouched.

### 3. Existing wikilinks become `related` relationships

Your existing Obsidian `[[wikilinks]]` are preserved and, where they point at another
note in the graph, are converted into explicit relationship lines:

```markdown
- related [[Another Note]] (0.5)
```

The type is the generic **`related`** relationship, and the strength defaults to the
configured **Default relationship strength** — `0.5` out of the box. You can rename,
retype, re-strengthen, add, or delete any of these lines afterwards.

### 4. Notes follow a strict, readable format

Every hologram note is frontmatter plus a **Relationships** section. See
[The Hologram Note Format](#the-hologram-note-format) below for the full schema.

### 5. New notes have an Obsidian template

Three options for creating notes:

- Command **“Create hologram node”** creates a correctly formatted note in
  `hologram/` and opens it.
- Start from the template at [`docs/example-node.md`](docs/example-node.md). It uses
  the Obsidian core **Templates** plugin variables `{{date}}` and `{{title}}`, so you
  can register it as your template for new notes.
- Write the Markdown by hand — the format is small and human-friendly.

### 6. Edit by hand — the hologram follows

Notes are the single source of truth. Edit a note's frontmatter or its relationship
lines in the editor, and the graph re-reads the vault and reflects the change. No
database, no lock-in.

### 7. Define relationships however you want

Everything schematic is configurable in **Settings → Semantic Hologram**:

- **Relationship types** — add, rename, recolour, reorder, enable/disable, or delete
  relationship families (`logic/…`, `structural/…`) and the generic `related`.
- **Node types** — define your own node types, their colours, options, and DAG levels.
- **Levels and source kinds** — the abstraction ladder and the credibility weighting
  applied to evidence sources.
- **Default relationship strength** and **default confidence** — the fallbacks used
  whenever a value is absent.

### 8. Two flavours of node: free-form and structured

The plugin ships with both:

- **`thought`** — a free-form note with **no level and no evidence requirement**.
  A whiteboard for raw brainstorming.
- The **structured DAG** node types — `percept`, `concept`, `idea`, `pattern`,
  `topic`, `domain`, `field` — each carrying an abstraction level.
- Plus evidence-oriented types: `source`, `authority`, `data`.

You can start entirely in `thought` nodes and promote them later. The next two
sections explain the structure.

---

## The Hologram Note Format

A hologram note is Markdown with a small YAML frontmatter block and a relationship
section:

```markdown
---
hologram-node: true
node-type: concept
created: 2026-10-03
hologram: [Operating Systems]
groups:
  - "[[Linux Kernel Internals]]"
---

# Process

A process is an executing instance of a program.

## Relationships

- logic/supports [[Virtual Memory]] (0.8)
- structural/depends-on [[Scheduler]] (0.7)
- related [[Thread]] (0.5)

## Incoming relationships (read only)
```

**Frontmatter fields**

| Field | Meaning |
| --- | --- |
| `hologram-node: true` | Marks the note as part of the graph. **Required.** |
| `node-type` | The node's type (see below). `note-type` is accepted as a legacy alias. |
| `created` | Creation date (`YYYY-MM-DD`). |
| `hologram` / `holograms` | The hologram(s) the note belongs to. |
| `groups` | Parent nodes this node rolls up into (membership edges). |
| `local-confidence` | Optional user-set confidence, `0`–`1`. |
| `source-kind` | For evidence notes, the credibility class (`source/data`, `source/scientific`, …). |

**Relationship lines** live under a `## Relationships` heading (a `## Relations`
heading is also accepted) and have the form:

```
- <relation-type> [[Target Note]] (<strength>)
```

- `<relation-type>` is a configured relationship id — a family/type such as
  `logic/supports`, `structural/depends-on`, `structural/subsumed-by`,
  `logic/contradicts`, or the generic `related`.
- `<strength>` is a number from `0` to `1`; it influences layout (stronger edges pull
  nodes closer) and rendering.
- Lines are plain text and safe to write by hand.

Every note also has a **`## Incoming relationships (read only)`** section. It is
generated from other notes' outgoing edges by the **“Refresh incoming
relationships”** command; you do not have to maintain it manually.

A ready-to-use template is at [`docs/example-node.md`](docs/example-node.md), and a
longer specification (abstraction hierarchy, frontmatter schema, and relationship
semantics) is at [`docs/semantic-structure.md`](docs/semantic-structure.md).

---

## Node Types: Free-Form Thought vs the Structured DAG

Node types are defined in settings and each may carry a **level**. The default set is:

| Node type | Level | Role |
| --- | --- | --- |
| `thought` | — | Free-form Zettelkasten thought or brainstorming note. No level, no evidence requirement. |
| `percept` | 0 | A base-level observed percept or raw data point. |
| `concept` | 1 | A single foundational concept. |
| `idea` | 2 | A synthesis or mechanism built from concepts. |
| `pattern` | 3 | A recurring strategy or relationship among ideas. |
| `topic` | 4 | A broader topical grouping. |
| `domain` | 5 | A subject domain or field of study. |
| `field` | 6 | A high-level academic or professional field. |
| `source` | — | A source document: book, paper, video, interview, article. |
| `authority` | — | A subject-matter expert lending authority as evidence. |
| `data` | — | A measurement of objectively existing things. |

- **Thought nodes are outside the DAG.** They have no level and no evidence
  requirement, which makes them a safe staging ground for ideas that are not yet
  integrated.
- **Structured nodes form the DAG.** Their levels give the graph an abstraction
  ladder, and `source` / `authority` / `data` nodes anchor the bottom of it in
  evidence.

---

## What Is a DAG — and How We Apply It

A **Directed Acyclic Graph (DAG)** is a set of nodes connected by **directed** edges
(arrows) with **no directed cycles**: if you follow the arrows, you can never loop
back to where you started. This matters for knowledge because it guarantees a
**topological order** — a consistent "this is more fundamental than that" layering —
and it makes chains of justification finite and non-circular.

Semantic Hologram applies the DAG in four ways:

1. **Levels are the layering.** Each structured `node-type` carries a `level`
   (`percept 0` → `concept 1` → `idea 2` → `pattern 3` → `topic 4` → `domain 5` →
   `field 6`). Higher-level nodes are built from lower-level ones; the level defines
   the direction of abstraction.
2. **Edges are directed and typed.** Relationship families such as
   `logic/supports`, `structural/depends-on`, and `structural/subsumed-by` say *which
   way* knowledge flows and *how*. `logic/contradicts` records tension without
   implying support.
3. **`groups` roll nodes upward.** A node's `groups` field lists the parent nodes it
   contributes to, so membership links climb the hierarchy toward hologram roots.
4. **Evidence anchors the base, and nothing floats.** `source`, `authority`, and
   `data` nodes sit beneath the abstraction ladder. A claim whose support ultimately
   rests on nothing is a floating abstraction — structurally visible, and structurally
   discouraged.

`thought` nodes sit **outside** the DAG by design: they may link to anything, at any
level or none, and only become part of the rigorous structure when you promote them.

The reasoning model behind this layering — science and discovery as the soil,
engineering and invention as the trees it feeds, and thought nodes as the sandbox —
is described in [`docs/science-discovery-and-reason.md`](docs/science-discovery-and-reason.md).

---

## Navigation & Hotkeys

Open the hologram with the ribbon icon or the command palette, then hold **`h`** at
any time for the in-app help overlay. The full control set:

### Keyboard

| Key | Action |
| --- | --- |
| `h` (hold) | Show help |
| `Ctrl+F` | Focus node search |
| `Ctrl+A` | Select all nodes |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` / `Ctrl+Y` | Redo |
| `c` | Center hovered / selected node(s) on the rotation origin |
| `Delete` | Delete selected nodes — moves their notes to the vault trash after two confirmations |
| `1` | Flip the view 180° |
| `f` | Toggle faces (3D) |
| `Shift+F` | Fit graph to view |
| `r` | Cycle auto-rotation: off → clockwise → counter-clockwise |
| `Shift+R` | Reset view to initial state |
| `Ctrl+=` | Fit graph to view |
| `Ctrl+Shift+=` | Magnify (dolly in 3D) |
| `Ctrl+-` | Demagnify (dolly in 3D) |
| `s` (hold) | Box / lasso select; (tap) select hovered node |
| `a` (hold) | Reveal hologram anchors; drag one to place its hologram |
| `Shift+S` | Toggle split mode: move / copy |
| `Shift+M` | Toggle merge mode: absorb / emulsify |
| `p` | Toggle projection: perspective / orthographic (3D) |
| Arrow keys | Pan |
| `Shift` + arrows | Rotate about the focal point (3D) |
| `Space` | Stop auto-rotation |
| `PrtSc` | Copy a screenshot to the clipboard |

### Mouse

| Input | Action |
| --- | --- |
| Drag | Pan the background / move a node / move the selection |
| `Shift` + drag | 3D rotate about the focal point (3D mode) |
| Middle-drag | 3D rotate about the focal point |
| `s` + drag | Box select (2D) / lasso select (3D) |
| `Ctrl` + click | Toggle node selection |
| `Ctrl` + hover | Preview a node / relationship card |
| Scroll | Magnify / demagnify (changes standoff, centred on the focal point) |
| `Shift` + scroll | Dolly the camera along the line of sight (3D) |
| Click background | Clear selection |

### Modes

- **2D** — a flat, canvas view.
- **3D** — a projected spatial view. Toggle with the upper-left **2D/3D** banner.
- **Projection** (3D only) — **perspective** (pinhole, the default) or
  **orthographic**. Toggle with `p` or the second upper-left banner icon.

---

## The Camera

The 3D view uses the **Untethered Trackball Pinhole Camera System**: a rigid
eye + focal-point assembly that moves through a fixed world. It is not an orbit
camera. Rotation is anchored on the focal point and driven in the assembly's own
frame; magnification derives from the standoff distance; the wheel/buttons dolly
along the line of sight; and the default projection is a true pinhole with an
optional orthographic mode.

The full specification — reference frames, panning, dollying, prime-frame rotation,
projection maths, home position, and invariants — is in
[`docs/untethered-trackball-pinhole-camera-system.md`](docs/untethered-trackball-pinhole-camera-system.md).

---

## Settings

Configuration lives under **Settings → Semantic Hologram**:

- **Node types** — add/edit/remove, with colour, description, options, and DAG level.
- **Relationship types** — add/edit/remove typed relationships and families.
- **Levels** and **source kinds** — the abstraction ladder and evidence weighting.
- **Default relationship strength** / **default confidence**.
- **Appearance** — faces, gravitas colouring, confidence halos, edge lengths, hover
  depth.
- **Incoming folder** — where “Import incoming Zettelkasten notes” reads from.
- **MCP** — optionally enable a Model Context Protocol server so external agents can
  read the graph (and, if you allow it, write to it).

---

## Documentation

| Document | Contents |
| --- | --- |
| [`docs/untethered-trackball-pinhole-camera-system.md`](docs/untethered-trackball-pinhole-camera-system.md) | The camera model, in full. |
| [`docs/semantic-structure.md`](docs/semantic-structure.md) | Abstraction hierarchy, frontmatter schema, topology. |
| [`docs/example-node.md`](docs/example-node.md) | The new-note template. |
| [`docs/science-discovery-and-reason.md`](docs/science-discovery-and-reason.md) | The epistemology: science, discovery, and invention. |
| [`docs/novel-discoveries.md`](docs/novel-discoveries.md) | Worked example: topology of a Linux-kernel-internals hologram. |
| [`docs/virtual-screen.md`](docs/virtual-screen.md) | Definition of the virtual screen. |

---

## Development

Requires Node.js 18+.

```bash
npm i          # install dependencies
npm run dev    # esbuild in watch mode → main.js
npm run build  # type-check (tsc --noEmit) + production bundle
npm run lint   # eslint
```

For development, place (or symlink) this repository at
`<your-vault>/.obsidian/plugins/semantic-hologram` and enable the plugin. `npm run
build` writes `main.js` directly into the installed plugin, so a reload
(`Ctrl+R`, or the Hot Reload plugin) picks it up.

---

## Contributing

Contributions are welcome. Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) for the
fork → branch → pull-request workflow, coding standards, and how to verify changes.

In short: **fork** this repository, **clone** your fork, create a **development
branch**, push it back to your fork, and open a **pull request** against this
project.

---

## License

Semantic Hologram is free software, licensed under the **GNU General Public License,
version 3 (GPL-3.0)**. You may use, study, share, and modify it under the terms of
that license. The full text is in [`LICENSE.md`](LICENSE.md).

Copyright (C) 2025-2026 Warelock.

This program is distributed in the hope that it will be useful, but **WITHOUT ANY
WARRANTY**; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See the GNU General Public License for more details.

By contributing to this project you agree that your contributions are licensed under
the same GPL-3.0 terms.
