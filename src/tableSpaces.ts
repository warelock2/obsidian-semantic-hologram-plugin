/* @ts-nocheck */
import { App, Notice, Modal, TFile } from 'obsidian';

/** Persistence interface for table spaces. */
export interface TableSpacesSettings {
  /** Names of table spaces currently selected in the panel (in creation order). */
  selectedTableSpaces: string[];
  /** Additional metadata if needed (e.g., expanded/collapsed flags). */
  tableSpaceMeta?: Record<string, unknown>;
}

/** In-memory view of a table space (populated from frontmatter). */
export interface TableSpace {
  name: string;
  nodes: string[]; // List of node paths in creation order (index = order)
  createdAt: string; // ISO string from cache
}

/** Discover a new table space from a crossing of existing table spaces. */
export async function discoverTableSpaceFromCross(
  app: App,
  existingTableSpaces: Map<string, TableSpace>,
  crossedPairs: Array<[string, string]>
): Promise<TableSpace | null> {
  if (crossedPairs.length < 2) return null;

  // Build a combined node list from both table spaces (deduplicate, preserve order)
  const firstEntry = crossedPairs[0];
  const secondEntry = crossedPairs[1];
  if (!firstEntry || !secondEntry) return null;
  const firstName = firstEntry[0];
  const secondName = secondEntry[0];
  const first = existingTableSpaces.get(firstName);
  const second = existingTableSpaces.get(secondName);
  if (!first || !second) return null;

  // Combine nodes: first's nodes + second's nodes that aren't already present
  const combined = [...first.nodes];
  for (const node of second.nodes) {
    if (!combined.includes(node)) {
      combined.push(node);
    }
  }

  // Determine the new name: concatenate both names
  const newName = `${firstName}-${secondName}`;
  const newTableSpace: TableSpace = {
    name: newName,
    nodes: combined,
    createdAt: new Date().toISOString(),
  };

  return newTableSpace;
}

/** Incremental scan: detect new table spaces created by a recent modification (record step or backtrack). */
export async function incrementalScan(
  app: App,
  activeTableSpaces: TableSpace[]
): Promise<TableSpace[]> {
  // Read all tableSpreadIndexes from frontmatter of notes that belong to hologram scope
  const allTableSpreads: TableSpace[] = [];
  const allActive = activeTableSpaces.filter(ts => ts.name);

  for (const tableSpace of allActive) {
    // Table space already exists in our list; keep it
    allTableSpreads.push(tableSpace);
  }

  // Build a map of name -> TableSpace for quick lookup
  const existingMap = new Map<string, TableSpace>();
  for (const ts of allTableSpreads) {
    existingMap.set(ts.name, ts);
  }

  // Detect crossings: nodes that appear in more than one table space
  const nodeToSpreads: Map<string, string[]> = new Map();
  for (const [name, ts] of existingMap) {
    for (const node of ts.nodes) {
      nodeToSpreads.set(node, [...(nodeToSpreads.get(node) || []), name]);
    }
  }

  // For each node that appears in at least two table spaces, merge those table spaces
  const merged: TableSpace[] = [];
  for (const [, spreads] of nodeToSpreads.entries()) {
    if (spreads.length < 2) continue;
    // Sort spreads by name to ensure deterministic order
    spreads.sort();
    // Merge all node sets from these spreads
    const mergedNodes: string[] = [];
    for (const s of spreads) {
      const ts = existingMap.get(s);
      if (ts) {
        for (const n of ts.nodes) {
          if (!mergedNodes.includes(n)) {
            mergedNodes.push(n);
          }
        }
      }
    }
    if (mergedNodes.length === 0) continue;
    const newName = spreads.join('-');
    const mergedTableSpace: TableSpace = {
      name: newName,
      nodes: mergedNodes,
      createdAt: new Date().toISOString(),
    };
    merged.push(mergedTableSpace);
    // Update map so later crossings use the merged version
    existingMap.set(newName, mergedTableSpace);
    // Also update existingMap entries for the old spreads so they no longer appear separately
    // (optional: keep them if we want to preserve history; for now, we remove them)
    for (const s of spreads) {
      existingMap.delete(s);
    }
    // Add mergedTableSpace back to existingMap (already done)
  }

  // Combine active table spaces + newly discovered ones
  const result = [...allTableSpreads, ...merged];
  // Deduplicate by name, keeping the first occurrence (newest creation order)
  const dedup = new Map<string, TableSpace>();
  for (const ts of result) {
    if (!dedup.has(ts.name)) {
      dedup.set(ts.name, ts);
    }
  }
  return Array.from(dedup.values());
}

/** Render an overlay with numbered list of node titles matching node preview card styling and grace period. */
export async function showTableSpaceHoverOverlay(
  app: App,
  element: HTMLElement,
  tableSpace: TableSpace,
  onClose?: () => void
): Promise<() => void> {
  // Resolve node titles for display
  const titles: Array<{ index: number; title: string }> = [];
  for (const nodePath of tableSpace.nodes) {
    // @ts-ignore
    const raw = app.vault.getAbstractFileByPath(nodePath);
    const node = (raw instanceof TFile) ? raw : null;
    if (!node) continue;
    const cache = app.metadataCache.getFileCache(node);
    // @ts-ignore
    const title = (cache?.frontmatter?.title as string | undefined) ?? node.basename;
    titles.push({ index: titles.length + 1, title });
  }

  // Position and style overlay using the standard node preview card class for dark theme, width, and scrollability
  const overlay = document.body.createDiv({
    cls: 'sh-node-preview-card',
    attr: {
      style: `
        position: fixed;
        z-index: 1001;
        width: 360px;
        max-height: 400px;
        overflow-y: auto;
      `,
    },
  });

  // Add header label
  overlay.createDiv({
    cls: 'sh-preview-label',
    text: `Table spread: ${tableSpace.name}`,
  });

  // Add node count meta info
  overlay.createDiv({
    cls: 'sh-preview-meta',
    text: `${titles.length} node(s)`,
  });

  // Add numbered node list container
  const listContainer = overlay.createDiv({
    attr: { style: 'margin-top: 6px; border-top: 1px solid var(--background-modifier-border); padding-top: 6px;' },
  });

  for (const { index, title } of titles) {
    const row = listContainer.createDiv({
      attr: { style: 'display: grid; grid-template-columns: 36px 1fr; gap: 8px; align-items: center; padding: 3px 0; font-size: 11px;' },
    });
    row.createSpan({
      attr: { style: 'text-align: right; color: var(--text-muted); font-variant-numeric: tabular-nums;' },
      text: `${index < 10 ? '0' + index : index}`,
    });
    row.createSpan({
      attr: { style: 'color: var(--text-normal); word-break: break-word;' },
      text: title,
    });
  }

  // Auto-dismiss logic with grace period so mouse can move from row to overlay
  let hideTimer: number | null = null;
  const hide = () => {
    if (hideTimer !== null) window.clearTimeout(hideTimer);
    overlay.remove();
    if (onClose) onClose();
  };

  overlay.addEventListener('mouseenter', () => {
    if (hideTimer !== null) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
  });

  overlay.addEventListener('mouseleave', (e: MouseEvent) => {
    const related = e.relatedTarget as HTMLElement | null;
    if (related && (element.contains(related) || overlay.contains(related))) return;
    hideTimer = window.setTimeout(hide, 300);
  });

  element.addEventListener('mouseleave', (e: MouseEvent) => {
    const related = e.relatedTarget as HTMLElement | null;
    if (related && overlay.contains(related)) return;
    hideTimer = window.setTimeout(hide, 300);
  });

  // Escape key closes
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') hide();
  };
  document.addEventListener('keydown', escHandler);

  // Compute position (to the right of the element, within viewport)
  const rect = element.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const overlayWidth = 360;
  const overlayHeight = Math.min(titles.length * 24 + 60, 400);

  let left = rect.right + 8;
  let top = rect.top;
  if (left + overlayWidth > viewportWidth) {
    left = rect.left - overlayWidth - 8;
  }
  if (top + overlayHeight > viewportHeight) {
    top = viewportHeight - overlayHeight - 8;
  }
  if (top < 8) top = 8;

  overlay.style.left = `${left}px`;
  overlay.style.top = `${top}px`;

  // Return cleanup function
  return () => {
    hide();
    document.removeEventListener('keydown', escHandler);
  };
}

/** Modal for creating/editing a table space (reuse TableSpreadModal pattern). */
export class TableSpaceModal extends Modal {
  result: string = '';
  onSubmit: (result: string) => void;

  constructor(app: App, onSubmit: (result: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'Name this table spread' });

    const inputEl = contentEl.createEl('input', {
      type: 'text',
      placeholder: 'e.g. spread1',
    });
    inputEl.addClass('sh-table-space-input');

    window.setTimeout(() => inputEl.focus(), 10);

    inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        this.result = inputEl.value.trim();
        if (this.result) {
          this.onSubmit(this.result);
          this.close();
        } else {
          new Notice('Spread name cannot be empty.');
        }
      }
    });

    const buttonEl = contentEl.createEl('button', { text: 'Create' });
    buttonEl.addClass('mod-cta');
    buttonEl.addEventListener('click', () => {
      this.result = inputEl.value.trim();
      if (this.result) {
        this.onSubmit(this.result);
        this.close();
      } else {
        new Notice('Spread name cannot be empty.');
      }
    });
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
