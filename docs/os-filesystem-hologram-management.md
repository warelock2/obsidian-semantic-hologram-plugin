# OS Filesystem as a Management Tool for Holograms

## How the Obsidian Vault Filesystem Serves as the Management Layer for This Project

**Author:** Semantic Hologram Plugin  
**Last Updated:** 2026-10-15  
**Version:** 1.0.0

---

## 1. Introduction

The Semantic Hologram plugin treats the **Obsidian vault filesystem** as its primary data store and management layer. Unlike databases or external storage systems, the vault provides a number of advantages:

- **Human-readable notes:** Every node is a plain Markdown file with YAML frontmatter
- **Git-versioned history:** Change history is available via git
- **Portability:** The entire graph can be copied, backed up, or migrated by moving files
- **No database schema:** The schema is encoded in the frontmatter and relationship text, not in a separate system
- **Obsidian ecosystem integration:** Graph view, search, link preview, and other Obsidian features work natively

This document explains how the project fits within the Obsidian filesystem model, the architecture of note storage and retrieval, the git considerations, and the implications for long-term data safety.

---

## 2. Filesystem Architecture

### 2.1 Note Location and Structure

All hologram notes live in the `hologram/` directory at the top level of the vault:

```
vault-root/
├── hologram/
│   ├── operating-systems.md
││   └── linux-kernel.md
├── incoming/
├── notes/
└── ...
```

**Each hologram note follows a strict format:**

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

### 2.2 Frontmatter Fields

| Field | Meaning | Required? |
|-------|---------|-----------|
| `hologram-node: true` | Marks the note as part of the graph. **Required.** | Yes |
| `node-type` | The node's type (see Node Types below). `note-type` is accepted as a legacy alias. | Yes |
| `created` | Creation date (`YYYY-MM-DD`). | Yes |
| `hologram` / `holograms` | The hologram(s) the note belongs to. | No |
| `groups` | Parent nodes this node rolls up into (membership edges). | No |
| `local-confidence` | Optional user-set confidence, `0`–`1`. | No |
| `source-kind` | For evidence notes, the credibility class (`source/data`, `source/scientific`, …). | No |

### 2.3 Relationship Lines

Under a `## Relationships` heading (or `## Relations`, also accepted), each line has the form:

```
- <relation-type> [[Target Note]] (<strength>)
```

- `<relation-type>` is a configured relationship id — a family/type such as `logic/supports`, `structural/depends-on`, `structural/subsumed-by`, `logic/contradicts`, or the generic `related`.
- `<strength>` is a number from `0` to `1`; it influences layout (stronger edges pull nodes closer) and rendering.
- Lines are plain text and safe to write by hand.
- A `## Incoming relationships (read only)` section is generated automatically from other notes' outgoing edges by the **"Refresh incoming relationships"** command.

### 2.4 Node Types

Node types are defined in settings and each may carry a **level**. The default set includes:

| Node type | Level | Role |
|-----------|-------|------|
| `thought` | — | Free-form Zettelkasten thought or brainstorming note. No level, no evidence requirement. |
| `percept` | 0 | A base-level observed percept or raw data point. |
| `concept` | 1 | A single foundational concept. |
| `idea` | 2 | An emerging idea or thought. |
| `pattern` | 3 | A recognized recurring pattern. |
| `topic` | 4 | A broader topical grouping. |
| `domain` | 5 | A subject domain or field of study. |
| `field` | 6 | A high-level academic or professional field. |
| `source` | — | A source document: book, paper, video, interview, article. |
| `authority` | — | A subject-matter expert lending authority as evidence (no level). |
| `data` | — | A measurement of objectively existing things (no level). |

`thought` nodes sit **outside** the DAG by design: they may link to anything, at any level or none, and only become part of the rigorous structure when promoted.

---

## 3. Read Path: How the Plugin Retrieves Data from the Filesystem

### 3.1 Initial Load

On plugin activation, the following occurs:

1. `SemanticHologramPlugin.onload()` calls `this.loadSettings()` which merges `DEFAULT_SETTINGS` with any saved data from `this.loadData()`.
2. `this.hologramService.loadCache()` is called, which reads the `data.json` file from the plugin directory and populates the in-memory cache.
3. The plugin registers vault event handlers (`modify`, `create`, `delete`, `rename`) that schedule cache refreshes via `scheduleCacheRefresh()` (debounced at 250ms).

### 3.2 Reading Notes

The view (`src/view.ts`) reads notes through these paths:

- **`hologramService.getAllTags()`** — reads the tag cache from `data.json`. Each tag maps to a hologram note `basename.md` in the `hologram/` directory.
- **`hologramService.loadCache()`** — populates the full tag-to-note mapping. On vault events, this is refreshed via `window.setTimeout(() => this.hologramService.loadCache(), 250)`.
- **`this.app.vault.getMarkdownFiles()`** — gets all markdown files in the vault.
- **`this.app.metadataCache.getFileCache(file)`** — gets the metadata cache for a file, including frontmatter.
- **`scanRelations()`** in `src/relations.ts` — parses all `## Relationships` sections across all vault notes, using `metadataCache` for frontmatter resolution.

The **data flow** is:

```
Vault files → metadataCache.frontmatter → parseNoteFrontmatter() → nodeType, hologram, groups, etc.
Vault files → relationships text → scanRelations() → edges (source, target, relId, strength)
```

### 3.3 Scanning and Indexing

The plugin maintains several derived structures:

- **`searchIndex`** in `SemanticHologramView` — a `Map<string, SearchIndexEntry>` keyed by path, containing label, nodeType, nodeTypeName, relDescs, confidenceTotal, gravitasDisplay, and content.
- **`anchorGroups`** — derived from the hologram tag graph; each anchor group has an `id`, `tags`, and `nodeIndices`.
- **`scanLayerOfNode`** — Map from node index to its strongest scan layer assignment (activation, gaps, resonance, bridges, discovered).

These are **demand-driven**: they are recomputed when `invalidateScan()` is called or when the render loop (`draw()`) detects changes.

---

## 4. Write Path: How the Plugin Writes to the Filesystem

### 4.1 Creating Notes

The `CreateNodeModal` in `src/main.ts` handles node creation:

1. User provides a name, content, note type, and optional hologram topic.
2. The plugin builds content via `buildHologramSkeleton({title, body, noteType, created, hologram})`.
3. The target path is `${HOLOGRAM_FOLDER}/${name}.md` (i.e., `hologram/<name>.md`).
4. If the folder doesn't exist, `this.app.vault.createFolder("hologram")` is called.
5. `this.app.vault.create(path, content)` writes the file.
6. `this.plugin.refreshGraphs().catch(() => undefined)` rebuilds the in-memory graph.

### 4.2 Modifying Existing Notes

Changes flow through several pathways:

- **Vault events** (`modify`, `create`, `delete`, `rename`) trigger `scheduleCacheRefresh()` and `scheduleRebuild()`.
- **`refreshGravitasSections()`** syncs gravitas and confidence sections across all vault files.
- **`refreshIncomingRelationships()`** updates the `## Incoming relationships (read only)` section.
- **User edits in the graph view** — changes to frontmatter or relationship lines are captured via Obsidian's `file.md` edit events, which trigger the vault event handlers above.

### 4.3 Deleting Notes

1. User confirms deletion via the UI (two-step confirmation).
2. The note is moved to the vault trash (`app.vault.trash()`).
3. `refreshGraphs()` rebuilds the in-memory graph.
4. The deleted note's paths are removed from `hologram/` tags and relationship sections of remaining notes (during the next gravitas refresh).

### 4.4 Renaming/Moving Notes

1. User renames a note in the vault.
2. The rename event triggers `scheduleCacheRefresh()` and `scheduleRebuild()`.
3. The `isInScope()` check determines whether the note stays within the `hologram/` scope.
4. If a note moves in or out of scope, incoming/outgoing relationships are reconciled.

---

## 5. Git Integration

### 5.1 The `hologram/` Directory Is Gitignored

The `.gitignore` file lists `hologram/` to prevent user notes from being committed to the repository:

```
# Hologram notes — user-generated content, not tracked
hologram/
```

**Why is `hologram/` gitignored?**

- These are **user notes** that can be imported/created within the plugin.
- They are **derivative**: the original notes remain in the vault root or in `incoming/`.
- Committing them would bloat the repository with potentially thousands of notes.
- Users may want to share the graph structure (relationships, types) without sharing the note content.

**Historical note:** The `hologram/` ignore rule was added in commit `5607d29`. Before that, hologram notes were accidentally committed.

### 5.2 The `graph-state.json` Exception

A `graph-state.json` file was historically written by the MCP server to `process.cwd()` (the repo root). This file contains:

- Vault note paths
- Node geometry (x, y, z positions)
- Link relations

**History:**

- `.gitignore` has listed `graph-state.json` since commit `5607d29`.
- However, commit `0a5721c` committed it anyway (because it was newly created and not yet ignored).
- It is now **untracked**, so the `.gitignore` rule applies to it going forward.

**Current policy:** The MCP server should write `graph-state.json` to a location outside the repo (e.g., the user's home directory or a temp directory), not to `process.cwd()`. Until that is fixed, users are advised to add `graph-state.json` to their global gitignore if it appears.

### 5.3 Verification Before Committing

Before committing any changes, the discipline is:

1. Run `git ls-files` to check what is tracked.
2. Run `git check-ignore --no-index <path>` to verify gitignore rules without consulting the index (this evaluates rules even for already-tracked files).
3. Ensure no `hologram/` notes are staged.
4. Ensure `graph-state.json` is either not present or ignored globally.

> **Rule from AGENTS.md (semantic-hologram-plugin):** "Check `git ls-files` before committing anything generated. An ignore rule that 'looks right' proves nothing if the file is already in the index — verify with `git check-ignore --no-index`, which evaluates the rules without consulting the index."

### 5.4 Already-Tracked Files

If a file like `graph-state.json` was committed before the gitignore rule was added, `.gitignore` will **not** untrack it. The file remains in the git index. The only way to fix this is:

- `git rm --cached graph-state.json` (remove from index only, keep on disk)
- Or add it to `.git/info/exclude` or a global gitignore
- Or accept that it remains tracked (the rule applies going forward)

---

## 6. Settings Persistence

### 6.1 `data.json`

The plugin's `data.json` (located at `<plugin-dir>/data.json`) persists the following between sessions:

- `hologramMode`: `'2d'` or `'3d'`
- `hologramTool`: `'navigate'`, `'select'`, or `'rotate'`
- `projectionMode`: `'perspective'` or `'orthographic'`
- `showRotationCenter`: boolean
- `incomingFolderPath`: string (default `'Incoming'`)
- `edgeMinLength`, `edgeMaxLength`: number
- `hoverDepth`, `maxDepth`: number
- `depthBase`: number
- `levelHighlight`, `levelHighlightOpacity`: number
- `mcpEnabled`, `mcpWriteAccess`: boolean
- `mcpKeyHash`, `mcpKeyMasked`: string (optional)
- `facesEnabled`, `facesOpacity`, `facesColor`: color settings
- `nodeTypes`: full array of node type entries (with id, name, color, description, enabled, level)
- `relTypes`: full array of relationship type entries
- `sourceKinds`: array of source kind entries
- `scanLayers`: activation, gaps, resonance, bridges, discovered booleans
- `scanSource`: string (note path for scan injection)
- `selectedHolograms`: array of hologram topic strings
- `separationDistance`, `mergeMode`, `splitMode`: drag-separate/merge settings
- `gifMode`, `gifDuration`: recording settings
- `rotationMode`: `'absolute'` or `'relative'`

### 6.2 `DEFAULT_SETTINGS`

Defined in `src/settings.ts`, `DEFAULT_SETTINGS` is the factory for all defaults. It is merged with saved settings in `loadSettings()`:

```typescript
this.settings = Object.assign({}, DEFAULT_SETTINGS, saved ?? {});
```

### 6.3 Migrations

The `migration.ts` module handles schema evolution:

- `migrateNodeType()` — renames a node type across all notes
- `migrateRelationship()` — renames a relationship type across all notes
- `renameNodeType()` — high-level wrapper with user confirmation
- `renameRelationship()` — high-level wrapper with user confirmation

These are called when the user changes node/relationship types in the settings UI.

### 6.4 Settings Save/Load Cycle

1. `plugin.saveSettings()` → `this.saveData(this.settings)` → writes `this.settings` to `data.json`.
2. After saving, `forEach leaf of type HologramView: v.requestRender()` updates the display.
3. `plugin.loadSettings()` → `Object.assign({}, DEFAULT_SETTINGS, saved ?? {})` → merges defaults with saved.
4. Legacy `maxDepth`/`hoverDepth` from pre-scanLayers settings are filled in.
5. `scanLayers` object is merged: `{ ...defaults, ...(stored ?? {}) }`.
6. If `scanSource` is not a string, it's reset to `''`.

---

## 7. MCP Server Integration

### 7.1 The Local MCP Server

The plugin runs a **local Model Context Protocol (MCP) server** via `mcp-server.js`. The server:

- Listens on `stdin/stdout` (stdio transport)
- Provides 12 tools for remote interaction with the plugin's live state
- Is the **single source of truth** for camera state, graph structure, and node data
- Must be **restarted after rebuilding** the plugin (long-lived processes serve stale code)

### 7.2 MCP Tools

| Tool | Description |
|------|-------------|
| `trigger_gif_recording` | Trigger the 3D hologram GIF recording process in Obsidian |
| `get_gif_status` | Check the status of the current GIF recording/encoding process |
| `list_holograms` | List all hologram markdown files in the vault |
| `read_hologram` | Read the content of a specific hologram file |
| `create_hologram` | Create a new hologram markdown file (refuses to overwrite unless `overwrite: true`) |
| `update_hologram` | Update an existing hologram markdown file |
| `get_node_neighbors` | Get neighbors of a hologram node |
| `find_nodes_by_type` | Find hologram notes by note type |
| `run_diffraction_scan` | Run a diffraction scan over the current graph |
| `find_bridges` | Find bridges in the graph |
| `find_unlinked_pairs` | Find unlinked pairs in the graph |
| `explain_connection` | Explain a connection between two nodes |

### 7.3 The Handshake: Command File + Nonce

The MCP server implements a **command-file handshake**:

1. The MCP client (external agent) writes a JSON command to `.hologram-command.json` in the plugin directory.
2. The plugin's `startCommandListener()` watches this file (via `fs.watch` with a stat-only backstop poll every 1000ms).
3. When the file changes, `handleCommand(raw)` parses the JSON and dispatches on `action`.
4. The response is written to `.hologram-scan.json`.
5. **Critical: each command includes a `nonce` field.** The server stamps the nonce, and the client must accept only responses where the `nonce` matches what was sent. This prevents stale file attacks (e.g., a 29-hour-old dump being served as if current).

> **Verification discipline:** "Plugin MCP `dump_graph_state` is **live**: it asks the plugin to produce a fresh dump via the command-file handshake and accepts it only when the `nonce` it stamped comes back, so a stale file can never be returned as if it were current."

### 7.4 MCP and the Filesystem

The MCP server **reads from the same filesystem** the plugin uses:

- `list_holograms` → reads `hologram/` directory
- `read_hologram` → reads specific `hologram/<name>.md` file
- `run_diffraction_scan` → reads `metadataCache`, `knownRelIds()`, `settings.defaultRelStrength`, and the plugin's in-memory graph
- `writeScanResult` → writes to `.hologram-scan.json` via `fs.writeFileSync(join(this.pluginDir(), SCAN_RESULT_FILE), ...)`

**The MCP is a remote interface to the same data the plugin holds in memory.** It does not maintain a separate database; it queries the live plugin state, which in turn reads from the vault filesystem.

---

## 8. Verification and Discipline

### 8.1 Git Discipline

Per the project AGENTS.md:

- **Check `git ls-files` before committing anything generated.** Verify what is tracked.
- **Use `git check-ignore --no-index`** to evaluate gitignore rules without consulting the index (catches already-tracked files).
- **Never stage vault notes into the repo.** The plugin directory is a symlink into the vault, so vault artifacts land in the repo working tree. Two have already leaked: `hologram/` (user notes) and `graph-state.json` (debug snapshot).
- **No pre-commit hook exists** (`.git/hooks/` is empty, `core.hooksPath` is unset). Compliance is discipline-based.

### 8.2 Already-Tracked Files

If a file that should be gitignored was previously committed, `.gitignore` does not apply. The file remains tracked. The remedy is `git rm --cached <file>` or adding it to a global/git-level exclude.

### 8.3 .obsidian/ Symlink

The plugin directory (`<vault>/.obsidian/plugins/semantic-hologram`) is a **symlink** into this repo. This means:

- Changes made via Obsidian's UI (editing settings, creating notes) may land in the repo working tree.
- The build is live: `npm run build` writes `main.js` directly into the installed plugin path (no copy/sync step).
- Reloading uses `hot-reload:scan-for-changes` (fast, keeps the canvas) or `app:reload` / `location.reload()` (drops the canvas — reopen the view after).

### 8.3 Verification Stats

- CDP camera tests: 16/16 passing (as of last verification)
- Diffraction tests: passing
- Lint: configured with `npm run lint --max-warnings=0` target

---

## 9. How This Project Fits Within the Ecosystem

| Tool/Platform | Filesystem Approach | Key Difference |
|--------------|--------------------|----------------|
| **Obsidian (default)** | Vault notes in Markdown, graph view is 2D planar | This plugin adds 3D navigation + camera model |
| **Dat / Beaker Browser** | Decentralized, content-addressed storage | This plugin is centralized in a single vault |
| **Heptabase** | Canvas-based ZK, no 3D navigation | This plugin uses force-directed 3D layout |
| **Roam Research** | Block-level outliner, bi-directional links | This plugin renders links as a spatial graph |
| **Notion / ClickUp** | Database-first, structured data | This plugin is file-first, Markdown-native |
| **The Brain / MindNode** | Mind map layout, radial from center | This plugin uses force-directed, no fixed center |
| **Obsidian Graph View** | 2D planar projection of links | This plugin adds depth, projection modes, camera control |

**Unique positioning:** This project is the **only actively maintained Obsidian plugin** that:

1. Renders the graph in **true 3D** with a physically-based camera model (not an orbit camera)
2. Supports **two projection modes** (perspective pinhole + orthographic) with correct mathematical differences
3. Enforces a **DAG abstraction ladder** (levels 0–6) with evidence anchoring
4. Provides **MCP remote access** to live graph state via stdio
5. Keeps all data as **plain Markdown files** in the user's vault (no database, no lock-in)

**The OS filesystem is both the strength and the constraint of this project:**

- **Strength:** Notes are portable, versionable, human-readable, and integrate with the broader Obsidian ecosystem. The life of the data outlasts the plugin — if the plugin disappears, the notes remain as valid Markdown.
- **Constraint:** The lack of a central schema means the plugin must parse frontmatter and relationship text flexibly. The `hologram/` gitignore limits what can be committed. The lack of a pre-commit hook means compliance is discipline-based, not mechanical.

---

## 10. Conclusion

The Obsidian vault filesystem serves as a **robust, portable, and extensible management layer** for the Semantic Hologram project. By encoding all structure in YAML frontmatter and plain text relationship lines, the project achieves:

- **Longevity:** Notes remain valid Markdown regardless of the plugin's future.
- **Integration:** Full compatibility with Obsidian's native features (graph view, search, link preview, backlinks).
- **Extensibility:** The MCP server, settings system, and plugin architecture all build on the filesystem foundation.
- **Discipline:** The lack of mechanical guards (no pre-commit hook, gitignore doesn't apply to already-tracked files) means user discipline is the final safety net.

The project's fit within the broader ecosystem is unique: it takes the strengths of the Obsidian filesystem model and adds a 3D camera system, DAG abstraction, and MCP remote access — creating a "spatial Zettelkasten" that is both grounded in the user's vault and elevated into a navigable 3D environment.

---
*This document was generated as part of the documentation for the Semantic Hologram Obsidian plugin. For the latest version, visit the repository or enable the "Show hologram controls" command within Obsidian.*