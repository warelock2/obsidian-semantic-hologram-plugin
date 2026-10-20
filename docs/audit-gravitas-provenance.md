# Prompt — Audit + Gravitas Provenance + Perceptual/Cognitive Toggle

Useful if loaded verbatim into a new session. Context and constraints below.

## Session identity / rules
- Project dir: /home/warelock/projects/linuxresearch (git repo, master 9b2aae9 pushed to ssh://docker:222/warelock/linuxresearch.git).
- Vault: ~/Nextcloud/Notes/zettelkasten-notes/hologram/Linux Kernel Internals/ (25 mechanism nodes, audited; RESTART.md frozen at project root).
- Plugin (separate repo): ~/projects/obsidian-semantic-hologram-plugin (source of truth for relationship mechanics).
- AGENTS.md rules (pinned, do not weaken): stewardship, service with transparency, instrumental preservation, strict adherence, gold rules (no sudo, no rm -rf on workspace, never modify .bak, never declare everything working without measuring, anti-repetition, stop escalation, plan mode, vault mutation only with explicit permission, secrets hygiene, verification by live test/man/doc, freeze durable knowledge, never declare everything working without measuring). Confirm each at session start.
- User constraint (standing): DO NOT EDIT confidence / local-confidence / inherited-confidence / total-confidence. The user controls those directly. Provenance / gravitas computation is derived only; it must not change hand-set confidence.
- Vault mutation policy (AGENTS.md rule 20): no vault edits without explicit permission; read-only / list permitted.

## What has been verified (do not re-prove unless verifying)
- Audit completed: 25 mechanism nodes audited, framework (service/src declares, served gets incoming, justifications `::`, groups 1 level up @0.50, root `[]`) applied; cycles broken (Thread↔CS, Thread↔Scheduler, VM↔Page Fault, COW↔Demand Paging, Process→Exec→Fork→Page Table); leftover `related` removed; Address Space heading `## Relations` → `## Relationships`; Operating System missing justification added (`:: Group parent`);
- Method frozen: docs/audit-methodology.md.
- `docs/notes/primer-units-1-5.md` is the only study note; docs/notes/ is sparse — most mechanism nodes have no frozen verification artifact yet.
- Plugin settings verified: `~/Nextcloud/Notes/zettelkasten-notes/.obsidian/plugins/semantic-hologram/data.json`; enabled relTypes include `functional/supports`, `functional/prerequisite`, `logic/contradicts`, `logic/mutual-exclusivity`, `taxonomic/disjointness`, `structural/subsumed-by`, `structural/component-system`; `nodeTypes`: `source` (level=None), `percept` (level=0), `concept` (1), `idea` (2), `pattern` (3), `topic` (4), `domain` (5), `field` (6); `sourceKinds` with percents (primary-documentation 90%, data 90%, scientific 80%, literature 70%, education 60%, authority 50%, documentary 40%, news 30%, practitioner 20%, social 10%, unverified 0%).
- Plugin mechanics verified (live source): `gravitasSync.ts` line 93 mirror format (`- ([[Source]]) epistemic/evidence (amount)`); `gravitas.ts` `computeNodeStats`: `direct = amount × kindPercent`; `gravitasReal = direct + Σ_children gravitasReal(child) × strength`; `confidenceTotalReal = local + Σ_children confidenceTotalReal(child)` (unweighted inheritance); `confidenceInherited = sum(child totals)`; display caps at 1 (`Math.min(1, real)`). `subsumed-by` edges carry strength (`:0.50` in this vault).
- Source relations do NOT render as graph edges (no drawn edge); they only compute gravitas/confidence and mirror into target `## Gravitas`.
- Kernel source available locally only as headers (`/usr/src/linux-headers-6.8.0-*`); full tree not installed. Man pages available (`man 2` etc.). Live system commands (`/proc/[pid]/maps`, `vmstat`, `smaps`) are available evidence (data).

## Phase 1 — Provenance inventory (READ ONLY, no edits, no confidence changes)
For each mechanism node (list below), determine actual evidence from this project + live system:
- Process, Thread, Fork, Exec, Context Switch, Scheduler, Preemption, Syscall, Operating System, CPU Ring, Page Table, PTE, Page Fault, Virtual Memory, Demand Paging, Copy On Write, Dirty Bit, Page Cache, Anonymous Page, MAP_PRIVATE vs MAP_SHARED, Memory Accounting, Address Space, SIGSEGV and SIGBUS, Zero Page.
Method per mechanism: check docs/notes/, docs/gates.md, session command history (if any was saved), available man page references, available kernel header references, and actually run any missing verification command (live). Produce per-node: evidence kind (`data` / `primary-documentation` / `literature` / `education` / none), reference (command, section, file path, doc URL), proposed amount (modest, e.g., 0.8 for direct evidence, 0.5 for summary, 0.0 if none), proposed source-note grouping.
Output form: table at `docs/provenance-inventory.md` (new), never modify mechanism nodes.
Constraint: if a node has no specific verification artifact from this session, do NOT invent a source. Mark `none` and leave gravitas at 0 for that node.

## Phase 2 — Mapping approval (project docs only, still no vault/confidence edits)
Write `docs/provenance-mapping.md` with:
- Grouped source notes planned (e.g., `Live System Observations` `source/data`, `Kernel Docs & Man Pages` `source/literature` or `primary-documentation`, `Teaching Notes` `source/education`).
- Which mechanism nodes link to each source note (with amount, kind, evidence reference).
- Note: a single source node can lend to many targets at same kind / amount. Source notes live in vault `hologram/Linux Kernel Internals/` per plugin scope (scanned via `scanGravitas`).
- User approval required before Phase 3.

## Phase 3 — Source notes (vault; user-approved mapping; still no confidence edits)
Create source note files (e.g., `Evidence / Live System.md`, `Evidence / Kernel Documentation.md`) in vault `~/Nextcloud/Notes/zettelkasten-notes/hologram/Linux Kernel Internals/`. Each:
- Frontmatter: `hologram-node: true`, `node-type: source`, `source-kind: ...`, `groups: []` or group parent.
- `## Relationships`: none needed (sources are not graph nodes; they don't declare typed relations to targets).
- `## Gravitas`: authored `- epistemic/evidence [[Target]] (amount)` lines per approved mapping.
- Visible proof table in body: `| Node | Evidence | Source kind | Amount |` (makes source visible since graph doesn't render gravitas edges, and `## Gravitas` mirror only lists backers by file path, not evidence description).
- No edits to mechanism nodes except that mechanism `## Gravitas` sections will be auto-rewritten by plugin `gravitasSync.ts` when scanned (mirror incoming sources). Do NOT hand-edit mechanism `## Gravitas` or confidence sections.

## Phase 4 — Plugin feature: derived "Credibility provenance" section (plugin repo, after Phase 3 sources exist)
In `~/projects/obsidian-semantic-hologram-plugin/src/gravitasSync.ts` / `relations.ts` / `view.ts`:
- When computing mirror (`applyGravitasMirror`), also compute inherited backers by walking up `subsumed-by` tree from target to parents, collecting direct lenders at each step, weighting by edge strength (same as `gravitasReal` formula).
- In mechanism nodes' `## Gravitas`: add inherited lines with `(inherited)` tag, showing contribution at that level (strength-weighted share), not raw amount. Example: `- ([[Copy On Write]]) epistemic/evidence (0.40, inherited) — mechanism inheritance via structural/subsumed-by 0.50`.
- At top-level nodes (topic / field / root): add a derived subsection listing all transitively connected source nodes, aggregated by unique source path, with the total contribution at root (sum of weighted paths).
- Must not edit authored source `## Gravitas`; only modify mirror logic. Must guard cycles (depth > 500 guard from `computeNodeStats`). Must not alter `confidenceLocal` / `confidenceInherited` / `confidenceTotal` sections (those are separate; leave them to `applyConfidenceSection` as-is).
- Before this, create SVG previews for icons (Phase 5) — see below.
- Requires authorization to modify plugin repo (not audit repo); confirm before editing.

## Phase 5 — Toggle UI / SVG previews (plugin repo, feature; also independent of audit)
- Icon pair: open eye (`lucide-eye`) = Perceptual (Source) view; brain (`lucide-brain`) = Cognitive (Node/mechanism) view.
- SVG preview files: `~/projects/linuxresearch/assets/icon-perceptual.svg`, `~/projects/linuxresearch/assets/icon-cognitive.svg` (or project root `/home/warelock/projects/linuxresearch/` — confirm directory; if missing, create `assets/` under project). User asked to create and `xdg-open` both — do this after plan approval, with user's explicit go-ahead.
- Toast notification on switch (brief: "Perceptual view — source nodes visible" / "Cognitive view — mechanism nodes visible").
- Toggle placement: below other upper-left overlay controls (same palette / theme; reference `src/view.ts` overlay/styles; do not break 3D orbit/drag controls).
- Default state: Cognitive (current). Set on plugin start/restart by persisting mode to plugin settings / local state.
- Sources view mode: hide mechanism nodes (or fade), show only `node-type: source`; centroid at source cloud; mechanism nodes invisible. Cognitive view: current behavior.

## Critical reminders / do-not-break items
- Never change mechanism `local-confidence`, `inherited-confidence`, or `total-confidence`. Confidence is user-owned.
- Never delete, change, or create vault notes or folders without explicit permission (AGENTS.md rule 20). Source notes permitted only after Phase 2 approval.
- Source notes must not declare `functional/supports` / `logic/*` typed edges to mechanism nodes; they only use `epistemic/evidence`. The mechanism nodes' `## Incoming relationships` comes from other mechanism declarations; gravitas comes via mirror, not typed edge.
- If plugin repo edits (Phase 4/5) are needed, confirm explicitly — plugin repo is separate from linuxresearch audit repo.
- Verification: every mechanism-node source claim must be backed by a specific command, man section, kernel doc path, or study note file. No blanket attributions.
- JSON: `doctor-doc` or `logic/contradicts` etc. already configured; `source` node-type already exists.

## Open decisions / ask before proceeding
1. Confirm file locations for SVG previews (`assets/` or root?).
2. Confirm Phase 3 source-note grouping (2 notes? 3? which nodes to which?).
3. Confirm whether to write `docs/provenance-inventory.md` first, or skip to source-note creation once mapping is approved.
4. Authorize Phase 4 plugin edits (separate repo) — yes/no.
5. Authorize Phase 5 icon build + placement — yes/no.

---
Prepared: 2026-10-19 (current session). Frozen audit in `RESTART.md` (project root, git 9b2aae9). Load this file, read `AGENTS.md`, `docs/audit-methodology.md`, verify plugin settings (`data.json`), confirm theme, then proceed through phases in order.
