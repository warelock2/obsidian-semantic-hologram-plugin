import { App, Modal, Notice, Plugin, Setting, TFile, TFolder, View, WorkspaceLeaf } from 'obsidian';
import { readFileSync, watch, writeFileSync } from 'fs';
import { join } from 'path';
import {
	DEFAULT_SETTINGS,
	HOLOGRAM_FOLDER,
	HologramMode,
	HologramTool,
	ProjectionMode,
	SemanticHologramSettings,
	SemanticHologramSettingTab,
	isPermanentNodeType,
} from './settings';
import { defaultNodeType } from './settings';
import { buildHologramSkeleton, todayIso } from './skeleton';
import type { ScanLayerSettings } from './settings';
import { SemanticHologramControlsView, VIEW_TYPE_HOLOGRAM_CONTROLS } from './controlsView';
import { SemanticHologramView, VIEW_TYPE_HOLOGRAM } from './view';
import { syncIncomingRelationships } from './incoming';
import { syncGravitasAndConfidence } from './gravitasSync';
import { inScopePath, scanRelations } from './relations';
import { RelationSuggest, relationGhostExtension } from './relationSuggest';
import { ReviewConnectionsView, VIEW_TYPE_REVIEW_CONNECTIONS } from './reviewView';
import { AuditConnectionsView, VIEW_TYPE_AUDIT_CONNECTIONS } from './auditView';
import { ImportNoteModal, importNoteIntoHolograms } from './importNote';
import { FolderPickModal } from './review';
import { auditHologramNodes, HologramAuditModal } from './audit';
import { NodeConfidenceModal } from './confidence';
import { IncomingImportModal } from './incomingImportModal';

import { HologramService } from './hologramService';
import { migrateToDirectories } from './migrate';
import { unEmulsifyAll, reportMoveResult } from './hologramDirs';
import { ExportNoteModal } from './exportNote';

/** Vault file the MCP server writes to ask the plugin to run something. */
const COMMAND_FILE = '.hologram-command.json';

/** Where the plugin publishes a scan result for the MCP server to read. */
const SCAN_RESULT_FILE = '.hologram-scan.json';

/** Backstop poll interval for the command file. Stat-cheap, and it must not be slow. */
const COMMAND_POLL_MS = 1000;

/** Coalescing window for cache reloads and path-keyed graph rebuilds. */
const CACHE_REFRESH_DEBOUNCE_MS = 250;

/** `DataAdapter.getBasePath` exists at runtime but is absent from the typings. */
type BasePathAdapter = { getBasePath(): string };

export default class SemanticHologramPlugin extends Plugin {
	settings!: SemanticHologramSettings;
	hologramService!: HologramService;
	private ribbonIcon: HTMLElement | null = null;
	private cacheRefreshTimer: number | null = null;
	private renameRebuildTimer: number | null = null;
	private lastCommandStamp = '';

	/**
	 * Coalesce hologram-tag cache reloads into a single pass.
	 *
	 * Every vault event that can change a note's `holograms:` frontmatter has to
	 * invalidate this cache, because `getAllTags()` and the anchor groups are
	 * both derived from it. `delete` and `rename` used to be missing from that
	 * set entirely, so a trashed or renamed note kept contributing its tags
	 * until some unrelated modify reloaded the whole map. Reloading is O(vault),
	 * so bulk operations collapse into one reload rather than N.
	 */
	private scheduleCacheRefresh(): void {
		if (this.cacheRefreshTimer !== null) {
			window.clearTimeout(this.cacheRefreshTimer);
		}
		this.cacheRefreshTimer = window.setTimeout(() => {
			this.cacheRefreshTimer = null;
			void this.hologramService.loadCache().then(() => {
				for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_HOLOGRAM_CONTROLS)) {
					const v = leaf.view as any;
					if (v && typeof v.render === 'function') {
						v.render();
					}
				}
			});
		}, CACHE_REFRESH_DEBOUNCE_MS);
	}

	/**
	 * Debounced graph rebuild for path-keyed events.
	 *
	 * Renaming a folder fires one event per file, and a rebuild is a full
	 * re-derive of the graph, so the last event wins instead of the first.
	 */
	private scheduleRebuild(): void {
		if (this.renameRebuildTimer !== null) {
			window.clearTimeout(this.renameRebuildTimer);
		}
		this.renameRebuildTimer = window.setTimeout(() => {
			this.renameRebuildTimer = null;
			void this.refreshGraphs();
		}, CACHE_REFRESH_DEBOUNCE_MS);
	}

	async onload() {
		await this.loadSettings();
		this.hologramService = new HologramService(this);
		await this.hologramService.loadCache();
		this.startCommandListener();

		this.registerEvent(
			this.app.vault.on('modify', async (file) => {
				if (file instanceof TFile) {
					this.scheduleCacheRefresh();
					// Only sync if it's a hologram note to avoid infinite loops and bloat
					if (this.isInScope(file.path)) {
						await this.refreshIncomingRelationships();
						await this.refreshGravitasSections();
					}
				}
			})
		);
		this.registerEvent(
			this.app.vault.on('create', async (file) => {
				if (file instanceof TFile && this.isInScope(file.path)) {
					this.scheduleCacheRefresh();
					await this.refreshIncomingRelationships();
					await this.refreshGravitasSections();
				}
			})
		);
		this.registerEvent(
			this.app.vault.on('delete', async (file) => {
				if (file instanceof TFolder) {
					// A folder delete is a membership change, exactly like a folder
					// rename: every note under it loses its membership in that
					// hologram, so the path-keyed tag cache and the derived anchor
					// groups must both be invalidated. The rename handler below
					// already treats folders this way; this one used to return
					// early for anything that was not a TFile, which left a
					// deleted hologram's anchor on screen until something else
					// (a reveal toggle, a reload) happened to rebuild it.
					if (file.path.startsWith(`${HOLOGRAM_FOLDER}/`)) {
						this.scheduleCacheRefresh();
						this.scheduleRebuild();
					}
					return;
				}
				if (file instanceof TFile && this.isInScope(file.path)) {
					this.scheduleCacheRefresh();
					await this.refreshIncomingRelationships();
					await this.refreshGravitasSections();
				}
			})
		);
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (file instanceof TFolder) {
					// A folder move *is* a membership change: hologram/<a>/note.md
					// belongs to `a`, and reparenting the folder is how a merge is
					// expressed. Ignoring folder renames — as this handler used to —
					// meant dragging an anchor onto another updated the filesystem
					// and left the graph stale until something else forced a rebuild.
					if (file.path.startsWith(`${HOLOGRAM_FOLDER}/`) || oldPath.startsWith(`${HOLOGRAM_FOLDER}/`)) {
						this.scheduleCacheRefresh();
						this.scheduleRebuild();
					}
					return;
				}
				if (!(file instanceof TFile)) {
					return;
				}
				// Both the tag cache and the graph are keyed by path, and a rename
				// can move a note either into or out of scope, so re-derive both.
				this.scheduleCacheRefresh();
				this.scheduleRebuild();
				if (this.isInScope(file.path) || this.isInScope(oldPath)) {
					void this.refreshIncomingRelationships();
					void this.refreshGravitasSections();
				}
			})
		);

		// Post-processor removed in favor of dedicated side panel view



		this.registerView(
			VIEW_TYPE_HOLOGRAM,
			(leaf: WorkspaceLeaf) => new SemanticHologramView(leaf, this),
		);
		this.registerView(
			VIEW_TYPE_HOLOGRAM_CONTROLS,
			(leaf: WorkspaceLeaf) => new SemanticHologramControlsView(leaf, this),
		);
		this.registerView(
			VIEW_TYPE_REVIEW_CONNECTIONS,
			(leaf: WorkspaceLeaf) => new ReviewConnectionsView(leaf, this),
		);
		this.registerView(
			VIEW_TYPE_AUDIT_CONNECTIONS,
			(leaf: WorkspaceLeaf) => new AuditConnectionsView(leaf, this),
		);

		this.ribbonIcon = this.addRibbonIcon('waypoints', 'Semantic hologram', () => {
			void this.activateView();
		});

		this.addCommand({
			id: 'refresh-gravitas-confidence',
			name: 'Refresh gravitas and confidence sections',
			callback: async () => {
				await this.refreshGravitasSections();
			},
		});

		this.addCommand({
			id: 'test-import-specific-note',
			name: 'Test import specific note',
			callback: async () => {
				const sourceFile = this.app.vault.getAbstractFileByPath('Test Import Source Note.md');
				if (sourceFile instanceof TFile) {
					const imported = await importNoteIntoHolograms(this, sourceFile, '#hologram');
					new Notice(imported ? `Test import succeeded: ${imported.path}` : 'Test import failed');
				} else {
					new Notice('Test Import Source Note.md not found');
				}
			},
		});

		this.addCommand({
			id: 'start-hologram-recording',
			name: 'Start hologram GIF recording',
			callback: () => {
				const view = this.app.workspace.getActiveViewOfType(SemanticHologramView);
				if (view) {
					void view.startRecording();
				} else {
					new Notice('Open semantic hologram view first.');
				}
			},
		});

		this.addCommand({
			id: 'open-semantic-hologram',
			name: 'Open semantic hologram graph',
			callback: () => {
				void this.activateView();
			},
		});

		this.addCommand({
			id: 'zoom-in',
			name: 'Magnify (dolly in 3d)',
			hotkeys: [{ modifiers: ['Mod', 'Shift'], key: '=' }],
			callback: () => {
				const view = this.app.workspace.getActiveViewOfType(SemanticHologramView);
				view?.magnify();
			},
		});

		this.addCommand({
			id: 'zoom-out',
			name: 'Demagnify (dolly in 3d)',
			hotkeys: [{ modifiers: ['Mod'], key: '-' }],
			callback: () => {
				const view = this.app.workspace.getActiveViewOfType(SemanticHologramView);
				view?.demagnify();
			},
		});

		this.addCommand({
			id: 'fit-to-view',
			name: 'Fit to view',
			hotkeys: [{ modifiers: ['Mod'], key: '=' }],
			callback: () => {
				const view = this.app.workspace.getActiveViewOfType(SemanticHologramView);
				view?.fitToViewPublic();
			},
		});

		this.addCommand({
			id: 'create-hologram-node',
			name: 'Create hologram node',
			hotkeys: [{ modifiers: ['Shift'], key: 'N' }],
			callback: () => {
				new CreateNodeModal(this.app, this).open();
			},
		});

		this.addCommand({
			id: 'import-note-into-hologram',
			name: 'Import note into holograms',
			callback: () => {
				const modal = new ImportNoteModal(this.app, this);
				if (modal.getItems().length === 0) {
					new Notice('No notes to import — all Markdown notes are already in the hologram scope.');
					return;
				}
				modal.open();
			},
		});

		this.addCommand({
			id: 'bulk-import-zk-notes',
			name: 'Bulk import zk notes and review connections',
			callback: () => {
				new FolderPickModal(this.app, this).open();
			},
		});

		this.addCommand({
			id: 'review-all-connections',
			name: 'Review connections for all hologram notes',
			callback: () => {
				void this.activateReviewView();
			},
		});

		this.addCommand({
			id: 'review-node-confidence',
			name: 'Review node confidence',
			callback: () => {
				new NodeConfidenceModal(this.app, this).open();
			},
		});

		this.addCommand({
			id: 'refresh-incoming-relationships',
			name: 'Refresh incoming relationships',
			callback: () => {
				void this.refreshIncomingRelationships();
			},
		});

		this.addCommand({
			id: 'audit-hologram-nodes',
			name: 'Audit and fix hologram nodes',
			callback: () => {
				void this.activateAuditView();
			},
		});

		this.addCommand({
			id: 'scan-hologram-relations',
			name: 'Scan hologram relations (diagnostics)',
			callback: () => {
				void this.scanForInvalidHolograms();
			},
		});

		this.addCommand({
			id: 'import-incoming-notes',
			name: 'Import incoming zettelkasten notes',
			callback: () => {
				new IncomingImportModal(this.app, this).open();
			},
		});


		this.addCommand({
			id: 'open-hologram-controls',
			name: 'Show hologram controls',
			callback: () => {
				void this.activateControlsView();
			},
		});

		this.addCommand({
			id: 'un-emulsify-holograms',
			name: 'Un-emulsify: lift nested hologram folders back to the top level',
			callback: async () => {
				const res = await unEmulsifyAll(this.app.vault);
				reportMoveResult(res, 'Un-emulsify');
				if (res.moved.length) {
					await this.hologramService.loadCache();
					await this.refreshGraphs();
				}
			},
		});

		this.addCommand({
			id: 'export-note-from-hologram',
			name: 'Export hologram node as a plain note',
			callback: () => {
				new ExportNoteModal(this.app, this).open();
			},
		});

		this.addCommand({
			id: 'migrate-to-directories',
			name: 'Migrate tag-based holograms to directories',
			callback: async () => {
				await migrateToDirectories(this.app);
				await this.hologramService.loadCache();
				this.scheduleRebuild();
				this.scheduleCacheRefresh();
			},
		});

		this.addCommand({
			id: 'focus-search',
			name: 'Focus node search',
			callback: () => {
				const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_HOLOGRAM);
				if (leaves.length > 0) {
					const view = leaves[0]?.view;
					if (view instanceof SemanticHologramView) {
						view.focusSearchInput();
						return;
					}
				}
				const searchInput = document.querySelector('.sh-search-input');
				if (searchInput instanceof HTMLInputElement || searchInput instanceof HTMLTextAreaElement) {
					searchInput.focus();
					searchInput.select();
				}
			},
		});

		this.addSettingTab(new SemanticHologramSettingTab(this.app, this));

		this.registerEditorSuggest(new RelationSuggest(this.app, this));
		this.registerEditorExtension(relationGhostExtension(this));

		this.app.workspace.onLayoutReady(() => {
			void this.activateControlsView();
		});
	}

	getMode(): HologramMode {
		return this.settings.hologramMode;
	}

	getTool(): HologramTool {
		return this.settings.hologramTool;
	}

	getProjectionMode(): ProjectionMode {
		return this.settings.projectionMode;
	}

	/** Toggle (or set) the 3D projection used by every open hologram view. */
	async setProjectionMode(mode: ProjectionMode): Promise<void> {
		this.settings.projectionMode = mode;
		await this.saveSettings();
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_HOLOGRAM)) {
			const v = leaf.view;
			if (v instanceof SemanticHologramView) {
				v.setProjectionMode(mode);
			}
		}
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_HOLOGRAM_CONTROLS)) {
			const v = leaf.view;
			if (v instanceof SemanticHologramControlsView) {
				v.render();
			}
		}
	}

	async setTool(tool: HologramTool): Promise<void> {
		this.settings.hologramTool = tool;
		await this.saveSettings();
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_HOLOGRAM)) {
			const v = leaf.view;
			if (v instanceof SemanticHologramView) {
				v.setTool(tool);
			}
		}
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_HOLOGRAM_CONTROLS)) {
			const v = leaf.view;
			if (v instanceof SemanticHologramControlsView) {
				v.render();
			}
		}
	}

	getShowRotationCenter(): boolean {
		return this.settings.showRotationCenter;
	}

	/**
	 * Switch one diffraction highlight layer.
	 *
	 * Layers are independent toggles, and precedence is resolved at scan time
	 * rather than here, so switching one never silently turns another off. The
	 * controls panel re-renders and the graph recomputes on its next frame.
	 */
	async setScanLayer(key: keyof ScanLayerSettings, value: boolean): Promise<void> {
		this.settings.scanLayers[key] = value;
		await this.saveSettings();
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_HOLOGRAM)) {
			const v = leaf.view;
			if (v instanceof SemanticHologramView) v.invalidateScan();
		}
	}

	async setScanSource(value: string): Promise<void> {
		this.settings.scanSource = value;
		await this.saveSettings();
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_HOLOGRAM)) {
			const v = leaf.view;
			if (v instanceof SemanticHologramView) v.invalidateScan();
		}
	}

	async setShowRotationCenter(value: boolean): Promise<void> {
		this.settings.showRotationCenter = value;
		await this.saveSettings();
	}

	async setHoverDepth(value: number): Promise<void> {
		this.settings.hoverDepth = value;
		this.settings.maxDepth = value;
		await this.saveSettings();
	}

	async setMode(mode: HologramMode): Promise<void> {
		// The view derives all mode bookkeeping from the focal point, and it must
		// read the focal point of the mode being LEFT. The view learns the current
		// mode from settings.hologramMode via its is3D getter, so that value has
		// to still hold the OLD mode while v.setMode() runs. Capture it first and
		// pass it explicitly; otherwise the view reads the destination mode's
		// stale bookkeeping and the focal point jumps on every switch.
		const fromMode: HologramMode = this.settings.hologramMode;
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_HOLOGRAM)) {
			const v = leaf.view;
			if (v instanceof SemanticHologramView) {
				v.setMode(mode, fromMode);
			}
		}
		this.settings.hologramMode = mode;
		await this.saveSettings();
		// Now that is3D reports the new mode, refresh the parts of the switch that
		// are correct only in the destination mode (projection banner, magnify
		// tooltips, tool dock, cursor).
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_HOLOGRAM)) {
			const v = leaf.view;
			if (v instanceof SemanticHologramView) {
				v.refreshAfterModeSwitch();
			}
		}
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_HOLOGRAM_CONTROLS)) {
			const v = leaf.view;
			if (v instanceof SemanticHologramControlsView) {
				v.render();
			}
		}
	}

	async setMaxDepth(depth: number): Promise<void> {
		this.settings.maxDepth = depth;
		this.settings.hoverDepth = depth;
		await this.saveSettings();
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_HOLOGRAM_CONTROLS)) {
			const v = leaf.view;
			if (v instanceof SemanticHologramControlsView) {
				v.render();
			}
		}
	}

	async setLevelHighlight(level: number): Promise<void> {
		this.settings.levelHighlight = level;
		await this.saveSettings();
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_HOLOGRAM_CONTROLS)) {
			const v = leaf.view;
			if (v instanceof SemanticHologramControlsView) {
				v.updateLevelSlider();
			}
		}
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_HOLOGRAM)) {
			const v = leaf.view;
			if (v instanceof SemanticHologramView) {
				v.showLevelTooltip(true);
				await v.rebuildGraph();
			}
		}
	}

	async refreshGraphs(): Promise<void> {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_HOLOGRAM)) {
			const v = leaf.view;
			if (v instanceof SemanticHologramView) {
				await v.rebuildGraph();
			}
		}
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_HOLOGRAM_CONTROLS)) {
			const v = leaf.view as any;
			if (v && typeof v.render === 'function') {
				v.render();
			}
		}
	}

	knownRelIds(): Set<string> {
		return new Set(this.settings.relTypes.map((t) => t.id));
	}

	isInScope(path: string): boolean {
		return inScopePath(path, this.app.vault, this.app.metadataCache);
	}

	async refreshIncomingRelationships(): Promise<void> {
		const files = this.app.vault.getMarkdownFiles();
		try {
			await syncIncomingRelationships(
				files,
				this.app.vault,
				this.app.metadataCache,
				this.knownRelIds(),
				this.settings.defaultRelStrength,
				(path) => this.isInScope(path),
			);
		} catch (e) {
			new Notice(`Semantic Hologram: refresh failed: ${String(e)}`);
			return;
		}
		await this.refreshGraphs();
	}

	async refreshGravitasSections(): Promise<void> {
		const files = this.app.vault.getMarkdownFiles();
		try {
			await syncGravitasAndConfidence(
				files,
				this.app.vault,
				this.app.metadataCache,
				this.settings.sourceKinds,
				defaultNodeType(this.settings.nodeTypes),
				this.settings.defaultConfidence,
				this.settings.defaultRelStrength,
				this.knownRelIds(),
				(path: string) => this.isInScope(path),
			);
		} catch (e) {
			new Notice(`Semantic Hologram: gravitas refresh failed: ${String(e)}`);
			return;
		}
		await this.refreshGraphs();
	}

	async auditNodes(): Promise<void> {
		const results = await auditHologramNodes(this);
		new HologramAuditModal(this.app, this, results).open();
	}

	async scanForInvalidHolograms(): Promise<void> {
		const scan = await scanRelations(
			this.app.vault.getMarkdownFiles(),
			this.app.vault,
			this.app.metadataCache,
			this.knownRelIds(),
			this.settings.defaultRelStrength,
			(path) => this.isInScope(path),
		);
		const lines: string[] = [];
		if (scan.malformed.length === 0 && scan.conflicts.length === 0) {
			lines.push(`Scanned ${scan.edges.length} relation edge(s) — no issues found.`);
		} else {
			for (const m of scan.malformed) {
				lines.push(`[${m.path}:${m.line + 1}] ${m.reason} — “${m.text}”`);
			}
			for (const c of scan.conflicts) {
				lines.push(
					`${c.path}: conflicting strengths for ${c.relId} → ${c.target}: ${c.strengths.join(', ')}`,
				);
			}
		}
		new DiagnosticsModal(this.app, lines.join('\n')).open();
		this.refreshGraphs().catch(() => undefined);
	}

	async activateControlsView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_HOLOGRAM_CONTROLS);
		if (existing.length > 0) {
			await workspace.revealLeaf(existing[0]!);
			return;
		}
		const leaf = workspace.getRightLeaf(false);
		if (!leaf) {
			return;
		}
		await leaf.setViewState({ type: VIEW_TYPE_HOLOGRAM_CONTROLS, active: true });
		await workspace.revealLeaf(leaf);
	}

	async activateReviewView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_REVIEW_CONNECTIONS);
		if (existing.length > 0) {
			await workspace.revealLeaf(existing[0]!);
			return;
		}
		const leaf = workspace.getLeaf('tab');
		await leaf.setViewState({ type: VIEW_TYPE_REVIEW_CONNECTIONS, active: true });
		await workspace.revealLeaf(leaf);
	}

	async activateAuditView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_AUDIT_CONNECTIONS);
		if (existing.length > 0) {
			await workspace.revealLeaf(existing[0]!);
			return;
		}
		const leaf = workspace.getLeaf('tab');
		await leaf.setViewState({ type: VIEW_TYPE_AUDIT_CONNECTIONS, active: true });
		await workspace.revealLeaf(leaf);
	}

	onunload() {
		
		
		if (this.ribbonIcon) {
			this.ribbonIcon.remove();
			this.ribbonIcon = null;
		}
	}

	async activateView() {
		const { workspace } = this.app;

		// If there is an empty leaf (e.g. new tab), reuse it.
		const emptyLeaves = workspace.getLeavesOfType('empty');
		const activeView = workspace.getActiveViewOfType(View);
		const targetLeaf = activeView?.getViewType() === 'empty' 
			? activeView.leaf 
			: (emptyLeaves.length > 0 ? emptyLeaves[0] : null);
		
		if (targetLeaf) {
			await targetLeaf.setViewState({ type: VIEW_TYPE_HOLOGRAM, active: true });
			await workspace.revealLeaf(targetLeaf);
			return;
		}

		// Reuse an existing hologram view, but only if it lives in the main
		// workspace area (not the right sidebar). Otherwise close stale sidebar
		// copies and open a fresh pane split from the active note.
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_HOLOGRAM);
		const mainLeaf = leaves.find(
			(leaf) => leaf.view instanceof SemanticHologramView && leaf.getRoot() === workspace.rootSplit,
		);
		if (mainLeaf) {
			await workspace.revealLeaf(mainLeaf);
			return;
		}

		for (const leaf of leaves) {
			if (leaf.view instanceof SemanticHologramView) {
				leaf.detach();
			}
		}

		let leaf: WorkspaceLeaf | null = workspace.getLeaf('split');
		if (leaf && leaf.getRoot() !== workspace.rootSplit) {
			leaf.detach();
			leaf = workspace.getLeaf('tab');
		}

		if (leaf) {
			await leaf.setViewState({ type: VIEW_TYPE_HOLOGRAM, active: true });
			await workspace.revealLeaf(leaf);
		}
	}

	async loadSettings() {
		const savedRaw = (await this.loadData()) as unknown;
		const saved = savedRaw as Partial<SemanticHologramSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved ?? {});
		// `Object.assign` is shallow: a saved `nodeTypes` array replaces the default
		// one wholesale, so anything derived from the defaults (e.g. `locked`) is
		// absent on any vault that already had settings saved. Permanent types are
		// therefore re-asserted here, keyed by id, rather than trusted from the blob.
		for (const nt of this.settings.nodeTypes ?? []) {
			if (isPermanentNodeType(nt) && !nt.enabled) {
				nt.enabled = true;
			}
		}
		const legacyMaxDepth = (savedRaw as { maxDepth?: number } | null)?.maxDepth;
		if ((this.settings.hoverDepth ?? 0) === 0 && typeof legacyMaxDepth === 'number') {
			this.settings.hoverDepth = legacyMaxDepth;
			this.settings.maxDepth = legacyMaxDepth;
		}
		if ((this.settings.maxDepth) === undefined) this.settings.maxDepth = this.settings.hoverDepth;
		// scanLayers was added as a nested object; a settings blob written before it
		// merges to undefined rather than picking up the default, so fill it in.
		const stored = (saved as { scanLayers?: Partial<SemanticHologramSettings['scanLayers']> })?.scanLayers;
		const defaults = DEFAULT_SETTINGS.scanLayers;
		this.settings.scanLayers = { ...defaults, ...(stored ?? {}) };
		if (typeof this.settings.scanSource !== 'string') this.settings.scanSource = '';
	}

	/**
 * Absolute path of this plugin's own directory.
 *
 * `manifest.dir` is **relative** (`.obsidian/plugins/semantic-hologram`), and it
 * resolves against two different bases depending on the caller: the vault base
 * for `vault.adapter`, but Obsidian's own process cwd for `fs` — which is the
 * user's home directory, not the plugin. Anything using `fs` has to anchor it
 * here or it silently reads the wrong path.
 */
pluginDir(): string {
		const relative = this.manifest.dir;
		if (!relative) {
			// Never guess the config folder name: it is user-configurable, and a
			// wrong guess here silently reads and writes outside the plugin.
			throw new Error('semantic-hologram: manifest.dir is missing; cannot resolve the plugin directory');
		}
		const adapter = this.app.vault.adapter as unknown as BasePathAdapter;
		// The vault base, not `Vault.configDir` — for this vault the two disagree,
		// and only the base is the directory `manifest.dir` is relative to.
		return join(adapter.getBasePath(), relative);
	}

/**
	 * Watch the plugin directory for commands from the MCP server.
	 *
	 * The plugin directory is **not inside the vault** — it is symlinked in from
	 * outside, so nothing written there ever raises a vault event. The previous
	 * implementation listened for `.hologram-command.json` via `vault.on('create')`,
	 * which could therefore never fire, and the one tool that depended on it had
	 * been silently dead. The MCP server writes to its own cwd, which is this
	 * directory, so the directory itself is what has to be watched.
	 *
	 * A stat-only poll runs alongside `fs.watch` as a backstop: watch is not
	 * reliable on every filesystem, and a missed command fails silently.
	 */
	private startCommandListener(): void {
		const dir = this.pluginDir();
		if (!dir) return;

		const commandPath = join(dir, COMMAND_FILE);
		const tryHandle = (): void => {
			let raw: string;
			try {
				raw = readFileSync(commandPath, 'utf8');
			} catch {
				return; // no command pending
			}
			// Content-addressed, so the same command cannot run twice however it arrived.
			if (raw === this.lastCommandStamp) return;
			this.lastCommandStamp = raw;
			void this.handleCommand(raw);
		};

		try {
			const watcher = watch(dir, (_event, filename) => {
				if (filename === COMMAND_FILE) tryHandle();
			});
			this.registerEvent({
				destroy: () => watcher.close(),
			} as any);
			this.register(() => watcher.close());
		} catch {
			// Watch unsupported here; the poll below still delivers.
		}

		this.registerInterval(window.setInterval(tryHandle, COMMAND_POLL_MS));

		// Watch the vault for external filesystem changes (OS file browser, Nextcloud sync)
		this.startVaultWatcher();
	}

	/**
	 * Watch the vault directory for external changes.
	 * Obsidian's vault events catch changes made within Obsidian, but not
	 * changes made by external tools (OS file browser, sync clients).
	 */
	private startVaultWatcher(): void {
		const vault = this.app.vault;
		const adapter = vault.adapter;
		if (!adapter) return;

		try {
			// DataAdapter doesn't expose getBasePath in the type, but it exists at runtime
			const vaultPath = (adapter as any).getBasePath?.();
			if (!vaultPath) return;

			const holoPath = `${vaultPath}/${HOLOGRAM_FOLDER}`;

			let timeout: ReturnType<typeof setTimeout> | null = null;
			const debouncedRefresh = () => {
				if (timeout) clearTimeout(timeout);
				timeout = setTimeout(() => {
					this.scheduleCacheRefresh();
					this.scheduleRebuild();
				}, 300);
			};

			// Watch the hologram directory for external changes
			try {
				const watcher = watch(holoPath, { recursive: true }, () => {
					debouncedRefresh();
				});
				this.register(() => watcher.close());
			} catch {
				// Watch unsupported or directory doesn't exist yet
			}
		} catch {
			// Adapter doesn't support basePath
		}
	}

	/**
	 * Run one command from the MCP server.
	 *
	 * Dispatching on `action` is what lets the MCP server reach *live* state. It is
	 * a separate OS process with no handle on the view, so anything it computed
	 * itself would be reading a snapshot that can be arbitrarily stale. Asking the
	 * plugin makes it do the work against the graph it actually holds.
	 */
	private async handleCommand(raw: string): Promise<void> {
		let command: { action?: string; filename?: string; target?: string; nonce?: string };
		try {
			command = JSON.parse(raw) as { action?: string };
		} catch {
			return; // a half-written command file is not an error worth surfacing
		}

		switch (command.action) {
			case 'record_gif':
				await this.startGifRecording();
				return;
			case 'run_scan':
				await this.runScanCommand(command);
				return;
			default:
				return;
		}
	}

	private async startGifRecording() {
		const active = this.app.workspace.getActiveViewOfType(SemanticHologramView);
		if (active) {
			void active.startRecording();
			return;
		}
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_HOLOGRAM);
		const existing = leaves[0]?.view;
		if (existing instanceof SemanticHologramView) {
			void existing.startRecording();
			return;
		}
		await this.activateView();
		const opened = this.app.workspace.getActiveViewOfType(SemanticHologramView);
		if (opened) {
			void opened.startRecording();
		}
	}

	/**
	 * Run the diffraction scan and publish the result.
	 *
	 * `filename` is an optional injection source, `target` an optional second note
	 * to explain a connection to. The output is a plain JSON file rather than an MCP
	 * response so the render layer and the server read the same bytes.
	 */
	private async runScanCommand(command: { filename?: string; target?: string }) {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_HOLOGRAM);
		const view = leaves
			.map((l) => l.view)
			.find((v): v is SemanticHologramView => v instanceof SemanticHologramView);
		if (!view) {
			await this.writeScanResult({
				error: 'no open Semantic Hologram graph view; open one and retry',
				timestamp: Date.now(),
			});
			return;
		}

		const sourceIndex = command.filename ? view.resolveScanNode(command.filename) : undefined;
		if (sourceIndex === -1) {
			await this.writeScanResult({
				error: `no node matched "${command.filename}"`,
				timestamp: Date.now(),
			});
			return;
		}
		const sources = sourceIndex === undefined ? [] : [sourceIndex];

		const resolvedTarget = command.target ? view.resolveScanNode(command.target) : undefined;
		if (resolvedTarget === -1) {
			await this.writeScanResult({
				error: `no node matched "${command.target}"`,
				timestamp: Date.now(),
			});
			return;
		}

		const { result, targetExplanation } = view.runDiffractionScan(sources, resolvedTarget);
		const graph = view.scanGraph();
		const name = (i: number): { label: string; path: string } => ({
			label: graph.nodes[i]?.label ?? `#${i}`,
			path: graph.nodes[i]?.path ?? '',
		});

		await this.writeScanResult({
			timestamp: Date.now(),
			requestedSource: command.filename ?? null,
			requestedTarget: command.target ?? null,
			// A scan that found nothing and a scan that never ran must not look alike.
			degenerate: result.diagnostics.degenerate,
			degenerateReason: result.diagnostics.degenerateReason,
			diagnostics: result.diagnostics,
			sources: sources.map(name),
			activation: {
				maxEnergy: result.activation.maxEnergy,
				meanEnergy: result.activation.meanEnergy,
				litCount: result.activation.litCount,
				loudest: result.activation.loudestNode === null ? null : name(result.activation.loudestNode),
			},
			bridges: result.bridges.map((b) => ({ ...b, ...name(b.node) })),
			resonance: result.resonance.map((r) => ({ ...r, ...name(r.node) })),
			gaps: result.gaps.map((g) => ({ a: name(g.a), b: name(g.b), combined: g.combined })),
			chains: result.chains.map((c) => ({
				nodes: c.chain.map(name),
				truth: c.truth,
				novelty: c.novelty,
				usefulness: c.usefulness,
				composite: c.composite,
				span: c.span,
				communities: c.communities,
			})),
			connection: targetExplanation,
		});
	}

	private async writeScanResult(payload: unknown): Promise<void> {
		// Written with `fs`, not `vault.adapter`: the adapter treats its path as
		// vault-relative and prepends the vault base, which would double an already
		// absolute path. The command channel reads this file with `fs` too, so one
		// convention covers the whole handshake. Nothing indexes this directory, so
		// no vault change event is needed.
		writeFileSync(join(this.pluginDir(), SCAN_RESULT_FILE), JSON.stringify(payload, null, 2));
	}

	async saveSettings() {
		await this.saveData(this.settings);
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_HOLOGRAM)) {
			const v = leaf.view;
			if (v instanceof SemanticHologramView) {
				v.requestRender();
			}
		}
	}
}

class CreateNodeModal extends Modal {
	private plugin: SemanticHologramPlugin;
	private name = '';
	private body = '';
	private noteType: string;
	private hologram = '';

	constructor(app: App, plugin: SemanticHologramPlugin) {
		super(app);
		this.plugin = plugin;
		this.noteType = defaultNodeType(plugin.settings.nodeTypes);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('sh-create-modal');

		contentEl.createEl('h4', { text: 'Create hologram node' });

		new Setting(contentEl).setName('Name').addText((t) => {
			t.inputEl.placeholder = 'Concept name';
			t.inputEl.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') {
					void this.create(false);
				}
			});
			t.onChange((v) => (this.name = v.trim()));
		});

		// `content` is the user-facing name, matching the codebase's existing
		// `content:` vocabulary. Called "Note" before, which read as vague — the
		// thing being typed is the node's prose, not the note itself.
		new Setting(contentEl).setName('Content').addTextArea((t) => {
			t.setPlaceholder('A sentence or two — the seed. You can leave it half-written.');
			// An Obsidian Setting gives a textarea no height of its own, so it
			// renders as a cramped single-line box. Set it explicitly, and let
			// the control wrap rather than scroll internally.
			t.inputEl.rows = 5;
			t.inputEl.addClass('sh-textarea-full');
			t.onChange((v) => (this.body = v));
		});

		new Setting(contentEl).setName('Note type').addDropdown((d) => {
			for (const nt of this.plugin.settings.nodeTypes) {
				if (nt.enabled) {
					d.addOption(nt.id, nt.name || nt.id);
				}
			}
			d.setValue(this.noteType).onChange((v) => (this.noteType = v));
		});

		const existing = new Set<string>(this.plugin.hologramService.getAllTags());
		// Free text, not a dropdown: a dropdown would make naming a new
		// hologram impossible without leaving the modal. Suggestions are offered
		// for the ones already in use, and anything typed is accepted as-is.
		new Setting(contentEl).setName('Hologram').setDesc('Optional topic. Pick an existing one or type a new name.').addText((t) => {
			t.inputEl.placeholder = existing.size ? [...existing].sort()[0]! : 'e.g. Linux Kernel Internals';
			t.inputEl.addClass('sh-hologram-input');
			t.inputEl.setAttribute('list', 'sh-existing-holograms');
			t.onChange((v) => (this.hologram = v.trim()));
		});
		if (existing.size) {
			const datalist = this.contentEl.createEl('datalist', { attr: { id: 'sh-existing-holograms' } });
			for (const h of [...existing].sort()) {
				datalist.createEl('option', { value: h });
			}
		}

		new Setting(contentEl)
			.addButton((b) =>
				b.setButtonText('Cancel').onClick(() => {
					this.close();
				}),
			)
			.addButton((b) =>
				b.setButtonText('Create another').onClick(() => {
					void this.create(true);
				}),
			)
			.addButton((b) =>
				b.setButtonText('Create').setCta().onClick(() => {
					void this.create(false);
				}),
			);
	}

	private async create(keepOpen: boolean): Promise<void> {
		if (!this.name) {
			new Notice('Give the node a name.');
			return;
		}
		if (/[\\/:*?"<>|]/.test(this.name)) {
			new Notice('Name contains invalid characters.');
			return;
		}
		// A named hologram means a subdirectory: membership is the path, not a tag.
		const folder = this.hologram ? `${HOLOGRAM_FOLDER}/${this.hologram}` : HOLOGRAM_FOLDER;
		const path = `${folder}/${this.name}.md`;
		if (this.app.vault.getAbstractFileByPath(path)) {
			new Notice(`A note already exists at ${path}`);
			return;
		}
		try {
			if (!this.app.vault.getAbstractFileByPath(HOLOGRAM_FOLDER)) {
				await this.app.vault.createFolder(HOLOGRAM_FOLDER);
			}
			if (folder !== HOLOGRAM_FOLDER && !this.app.vault.getAbstractFileByPath(folder)) {
				await this.app.vault.createFolder(folder);
			}
		} catch {
			// Folder likely exists already; vault.create below reports otherwise.
		}
		const content = buildHologramSkeleton({
			title: this.name,
			body: this.body,
			noteType: this.noteType,
			created: todayIso(),
		});
		try {
			await this.app.vault.create(path, content);
		} catch (e) {
			new Notice(`Failed to create ${path}: ${String(e)}`);
			return;
		}
		const f = this.app.vault.getAbstractFileByPath(path);
		if (f instanceof TFile) {
			void this.app.workspace.getLeaf('tab').openFile(f);
		}
		this.plugin.refreshGraphs().catch(() => undefined);
		if (keepOpen) {
			// Clear only the identity of the node; keeping the type and hologram
			// makes a burst of related nodes cheap. The name is deliberately not
			// re-focused — retyping over a selected title is the expected flow.
			const createdName = this.name;
			this.name = '';
			this.body = '';
			new Notice(`Created ${createdName}`);
			this.onOpen();
			return;
		}
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class DiagnosticsModal extends Modal {
	constructor(app: App, private text: string) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('sh-diagnostics-modal');
		contentEl.createEl('h4', { text: 'Hologram diagnostics' });
		const pre = contentEl.createEl('pre', { cls: 'sh-diagnostics' });
		pre.setText(this.text || 'No issues.');
		new Setting(contentEl).addButton((b) =>
			b.setButtonText('Close').onClick(() => {
				this.close();
			}),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}