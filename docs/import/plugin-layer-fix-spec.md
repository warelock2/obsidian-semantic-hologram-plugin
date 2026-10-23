# Plugin Layer Fix — Specification for Plugin Project AI

## Context

You are working in `~/projects/obsidian-semantic-hologram-plugin/` (the Obsidian semantic-hologram plugin repo). The linuxresearch project (at `~/projects/linuxresearch/`) has completed its Zettelkasten workflow work. This spec describes the remaining open work: the **layer separation fix** in nD mode.

## What was done (already in place)

1. **`src/incoming.ts`** — `formatIncomingLine(e)` now imports `e.justification?.trim()` into incoming relationship lines. Built, tested (21/21), and live-verified against `Page Table.md`. **Done.**

2. **`src/view.ts` (line ~5810)** — Display filter changed from `node.nodeType === 'source'` to `this.nodeLevel(node) < 1`. This makes cognitive mode hide all level-0 nodes (source/percept), not just `source` type.

3. **`src/view.ts` (line ~2928)** — `layerYBound` edit reverted to original. Inert for layer separation; the separation math (line ~2978) is unchanged.

4. **`data.json`** (vault plugin settings at `~/Nextcloud/Notes/zettelkasten-notes/.obsidian/plugins/semantic-hologram/data.json`) — `nodeTypes.thought` assigned `level: 1` (was missing, causing 12 mechanism notes to default to level 0 and overlap plane 0 with source/percept nodes).

5. **`scripts/build.sh`** — exists in plugin repo.

## Problem

In nD mode with perception mode active, layer 0 (source/percept) and layer 1 (concept) render concurrently on the same visible plane. The slider gap (Shift+scroll) does not visibly separate them because the plane-offset / centroid logic in `view.ts` does not recenter the expansion when source nodes become visible.

## Desired behavior

Layer separation is **uniform** (`ndSep` 500) across all adjacent plane pairs. The overlap was caused by:
- `displayMode` filter hiding only `source` (not full level 0) — **fixed** (filter changed to `nodeLevel(node) < 1`).
- `thought` missing `level` mapping (defaulted to 0, causing 12 mechanism notes to overlap plane 0) — **fixed** (`thought: level: 1` applied).

The fix is the filter change + level mapping. The centroid math (`layerYBound`) was reverted to original and is **not** part of the fix.

### Expected plane counts

**Perceptive mode** (expect 5 planes):
- L0: source/percept — 4 nodes
- L1: thought/concept — 13 nodes
- L2: idea — 4 nodes
- L3: pattern — 9 nodes
- L4: topic — 1 node
- Uniform gap: 500 units (`ndLayerSeparation`) between adjacent planes
- Centroid: mean level ~1.29 (includes level-0 nodes)

**Cognitive mode** (expect 4 planes):
- L1–L4 only (no L0; all level-0 nodes hidden)
- Centroid: mean level ~2.67 (level-0 excluded)
- Same uniform 500-unit gap between adjacent planes

Confirm centroid shift (~688 world units) between modes. Confirm plane separation is uniform (500 units) across all adjacent pairs in both modes.

## Constraints (never bypassed)

- Never edit `local-confidence` / `inherited-confidence` / `total-confidence` on mechanism nodes — plugin owns them via `gravitasSync` / `applyConfidenceSection`.
- Never touch `*.bak`.
- No `rm -rf` on any shared path.
- No git commands without explicit user authorization.
- Vault write scope: `~/Nextcloud/Notes/zettelkasten-notes/hologram/**` only. Plugin scope: `~/projects/obsidian-semantic-hologram-plugin/src/`.
- Do not declare success without measuring live state.

## Reference files

- `src/incoming.ts` — breadcrumb fix (done, verified).
- `src/view.ts` — filter at ~line 5810; `layerYBound` at ~line 2928; separation math at ~line 2978.
- `data.json` (vault) — `nodeTypes` including `thought: level: 1`; `hologramMode: nd`; `displayMode: perceptive`/`cognitive`; `ndLayerSeparation: 500`.
- `~/.opencode/plan/zk-workflow-plan.md` — full plan including "ADDITIONAL: Layer separation / centroid fix" section.
- `~/projects/linuxresearch/docs/zettelkasten-workflow.md` — method doc (two modes, breadcrumbs, `groups:` format).
- `~/projects/linuxresearch/docs/zettelkasten-roadmap.md` — conclusions + build order.

## User's design clarification (for context)

The user confirmed: layer separation is uniform (`ndSep` 500) across all adjacent plane pairs. The overlap was caused by `displayMode` filter hiding only `source` (not full level 0) plus `thought` missing `level` mapping (now fixed with `level: 1`). The fix is the filter change + level mapping, not centroid math (which was reverted to original). The user switched to `perceptive` mode.

## Verification requirement

Success must be measured against live plugin state, not asserted. Rebuild, reload, open graph, read live node, compare against hand-derived expectation, run `npm test` + `npm run lint`, assert loaded function source. Do not declare success without completing all steps.

---

## Enhancement Requests (new plugin features)

These are feature requests for the plugin, beyond the layer fix. They are not implementation steps — they are specifications for what the plugin should eventually support.

### 1. Luhmann Workflow Wizard

A wizard (or set of guided tools) that helps users unfamiliar with the Zettelkasten workflow get started and perform it correctly. All ZK workflows from `docs/zettelkasten-workflow.md` should be present in this tool:

- **Mode 1 (Dreamwalk & Exploration):** Seed selection from root index or search, follow edges with `::` justifications, note gaps with `// TODO`, stop when chain dead-ends or feels complete.
- **Mode 2 (Gardening & Card Creation):** Write card with `seed:`, link with full `::` justifications, declare per-genus route justifications, declare `characteristics:` (atomic, distinguishing, sourced from seed prose), close card (every edge has `::`, every incoming edge's source consulted).
- **Shared discipline:** Every link carries a reason; atomic notes; title addresses never change without updating references; no edge without a reason.
- **Dreamwalk rendering/highlighting layer:** Visual start, end, and direction must be made CLEAR. Highlight the seed node (start), the current traversal path (direction), and the resolution point (end). Path crossings (shared nodes between two dreamwalks) should be visually distinguishable (e.g., colored edges or node markers). The Canvas view is the table spread; the wizard should make traversal state visible at a glance.

The wizard should guide the user through both modes without forcing Mode 2 pressure onto Mode 1 exploration (intuition and productivity must not be mixed).

### 2. Binswangerization Support

Enhancement to support the Binswanger layer — grounding floating abstractions in objective reality and reason. This requires:

- **Characteristics as atomic differentia:** The plugin should support declaring `characteristics:` on nodes (species declares only differentia; genus carries full base set; inheritance by position, not repetition).
- **Genera detection/selection:** A derivation tool (like `all-genera.py`) that computes candidate genera from `characteristics:` and validates against hand-written `groups:`. The plugin should surface mismatches.
- **Objective source linking:** Support `lends-gravitas-to` edges from source nodes (literature, data, academic, scientific, primary, technical) to mechanism nodes. Source kinds already defined in `data.json` (`source/data` 90%, `source/literature` 70%, etc.).
- **Evidence audit integration:** The plugin should track whether each `lends-gravitas-to` claim has been verified against the source (live command, man page, kernel doc, study note). Unverified claims should be flaggable.
- **Confidence tracking:** `local-confidence` / `inherited-confidence` / `total-confidence` are user-controlled (plugin writes via `gravitasSync` / `applyConfidenceSection`). The plugin should make these visible and editable by the user, but never auto-assign without user judgment.

**How this fits within the DAG plugin system:** The plugin already has a node-type/edge-type system (`data.json` nodeTypes, relTypes). Binswangerization adds:
- New node type: `source` (already exists, level 0) — for source/evidence notes.
- New relationship type: `lends-gravitas-to` (already exists) — for evidence trail.
- New frontmatter fields: `characteristics:`, `source-kind:` (already in use).
- New derivation: `all-genera.py` logic could be integrated into the plugin as a validation pass.

The Binswanger book text ("How We Know: Epistemology on an Objectivist Foundation" by Harry Binswanger) is available at `docs/ebooks/How We Know_ Epistemology on an Objectivis - Harry Binswanger.txt` in the linuxresearch repo. The other project's AI should read that file for the Binswanger content — do not recreate or summarize it in this spec.

### 3. Dreamwalk rendering/highlighting layer

A visual layer for dreamwalk traversal state:
- **Start:** Highlight the seed node (entry point).
- **Direction:** Show the traversal path as colored/highlighted edges (direction of travel).
- **End:** Mark the resolution point (cheese node) distinctly.
- **Crossed paths:** When two dreamwalks share a node, visually distinguish the intersection (e.g., colored node markers, edge overlays).
- **Path crossing as discovery:** Highlighted edges between crossed paths represent candidate novel routes (cross product) for human review.

This layer is a rendering concern, not a data concern — the path data lives in child hologram folders (directory membership + sequence IDs). The rendering layer just makes it visible.

### 4. Child hologram / session constellation support

The plugin should support:
- **Subfolder-based child holograms:** A dreamwalk creates a child folder containing the traversed nodes (moved from parent). The folder name is the session name.
- **Emulsified view:** Canvas renders two or more child holograms together (union view) without merging files. Shared nodes (intersections) are visually distinguishable.
- **Merge-back:** Move nodes back to parent folder, strip sequence IDs, dissolve the child hologram. Only surviving insights (`::` justifications, new cards) persist in the master.
- **Crash resilience:** State is preserved per-node (frontmatter sequence ID + directory membership). A crashed session can be resumed or abandoned at any time.
