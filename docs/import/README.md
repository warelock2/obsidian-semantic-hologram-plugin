# Export Manifest

**Source project:** linuxresearch
**Date:** 2026-10-22
**Purpose:** Staged exports of system-level plugin ideation for the obsidian-semantic-hologram-plugin project to incorporate. Respects Rule 36 (no cross-project writes) — linuxresearch stages content in its own tree; the plugin project's AI reads and integrates.

## Exported files

| File | Content | Target in plugin project | Notes |
|---|---|---|---|
| `discovery-space-framework.md` | System-level framework definitions: Node/Hologram/Table spread/Discovery space, two-layer equation, emulsification, fractal self-similarity, path crossing/cross product, Binswangerization, honest limits | `docs/ideas/discovery-space-framework.md` | Add `> **Status:**` header per plugin conventions |
| `luhmann-to-digital-mapping.md` | Modern replacements table (Luhmann paper → digital equivalents) + decision that full-text search dominates hand-written register | `docs/ideas/luhmann-to-digital-mapping.md` | Add `> **Status:**` header per plugin conventions |
| `plugin-layer-fix-spec.md` | Layer separation fix spec (filter change in view.ts, data.json thought: level 1) + 4 enhancement requests (Luhmann wizard, Binswangerization, dreamwalk rendering, child holograms) | `docs/functional/plugin-layer-fix-spec.md` (or `docs/ideas/`) | Move from `docs/extra/` if already there; remove from linuxresearch `docs/` |

## Cross-reference strategy (linuxresearch side)

After the plugin project confirms incorporation, linuxresearch's `docs/zettelkasten-workflow.md` will have:
- The "Modern replacements" section replaced with a one-line cross-reference to `docs/ideas/luhmann-to-digital-mapping.md`.
- The "Discovery-space framework" section replaced with a one-line cross-reference to `docs/ideas/discovery-space-framework.md`.
- A `## See also` header at the end with four cross-references (including `docs/functional/plugin-layer-fix-spec.md`).

## Status

- [x] Export files created in `docs/export/`
- [ ] Plugin project incorporates exports into its docs buckets
- [ ] Linuxresearch replaces migrated sections with cross-references
- [ ] Linuxresearch removes exported originals
- [ ] Both projects commit

## See also

- Plugin project's `docs/README.md` — status, scope, and precedence for all plugin docs.
- `docs/extra/cross-project-request-spec.md` — the original handoff spec from the plugin project (historical record).
path: /home/warelock/projects/linuxresearch/docs/export/README.md