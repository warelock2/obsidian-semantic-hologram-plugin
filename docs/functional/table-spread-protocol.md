# Table Spread Protocol Specification

**Status:** Draft / Approved Design  
**Scope:** Obsidian Semantic Hologram Plugin  

## 1. Overview
The Table Spread Protocol provides a frictionless, intuitive mechanism for capturing Zettelkasten traversal paths (formerly "dreamwalks") during active reading and exploration. By using `Ctrl+Shift+Click` on justified relationship links (`::`), the user records their intuitive sequence without breaking flow state, utilizing native Obsidian frontmatter (`tableSpreadIndexes`) and native tags (`tags:`).

## 2. Data Model
Every note participating in one or more table spreads stores its position and spread membership in YAML frontmatter:

```yaml
---
title: Entropy
tableSpreadIndexes:
  hologram1: 3
  hologram2: 7
tags:
  - table-spread-hologram1
  - table-spread-hologram2
---
```

- **`tableSpreadIndexes` (Object Map):** Keyed by spread name, holding integer sequence numbers. Supports multi-spread participation per node without collision.
- **`tags:` (Array):** Standard Obsidian tags (`#table-spread-<spreadName>`), enabling integration with the Tag Pane, search (`tag:#table-spread-*`), and graph/canvas filters.

## 3. Interaction Mechanics

### A. Initiation & Extension (`Ctrl+Shift+Click`)
1. **Trigger:** User holds `Ctrl + Shift` and clicks a `::`-justified relationship link.
2. **Spread Detection:** 
   - Inspect the active note (`app.workspace.getActiveFile()`).
   - If the note has no active table spread, prompt the user via an input modal: *"Name this table spread:"* (e.g., `hologram1`).
   - Create/reserve the tag `#table-spread-hologram1` and set `tableSpreadIndexes.<spreadName> = 1`.
3. **Sequence Advancement:**
   - If the note already participates in a spread, retrieve the current highest sequence number for that spread (via global index cache `_tspread_index.json` or frontmatter scan).
   - Increment and assign the next index to the active note.
4. **Navigation:** Allow Obsidian's native link navigation to open the clicked target note in place.

### B. Backtracking (`Ctrl+Shift+Z` / Hotkey)
1. **Trigger:** User presses the backtrack hotkey.
2. **Action:**
   - Read active note frontmatter.
   - Remove active table spread entry from `tableSpreadIndexes` and strip corresponding `#table-spread-*` tag from `tags:`.
   - Decrement global index cache if applicable.
   - Trigger Obsidian native `history.back()` to return to the prior note.

## 4. Global Spread Index (`_tspread_index.json`)
A lightweight append-only metadata cache stored at vault root tracking `lastSeq` per spread name to avoid full-vault scans during extension.
