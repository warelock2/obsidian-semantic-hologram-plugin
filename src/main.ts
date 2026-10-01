import { App, Modal, Notice, Plugin, Setting, TFile, WorkspaceLeaf } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	HOLOGRAM_FOLDER,
	HologramMode,
	HologramTool,
	SemanticHologramSettings,
	SemanticHologramSettingTab,
} from './settings';
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

import { IncomingIndex } from './incomingIndex';
import { HologramService } from './hologramService';

export default class SemanticHologramPlugin extends Plugin {
	settings!: SemanticHologramSettings;
	incomingIndex!: IncomingIndex;
	hologramService!: HologramService;
	private ribbonIcon: HTMLElement | null = null;

	async onload() {
		await this.loadSettings();
		this.hologramService = new HologramService(this);
		await this.hologramService.loadCache();
		this.incomingIndex = new IncomingIndex(this);
		await this.incomingIndex.update();

		this.registerEvent(
			this.app.vault.on('modify', async (file) => {
				if (file instanceof TFile) {
					void this.incomingIndex.update();
					void this.hologramService.loadCache();
					// Only sync if it's a hologram note to avoid infinite loops and bloat
					if (this.isInScope(file.path)) {
						await this.refreshIncomingRelationships();
						await this.refreshGravitasSections();
					}
				}
				if (file.path === '.hologram-command.json') {
					void this.handleCommandFile();
				}
			})
		);
		this.registerEvent(
			this.app.vault.on('create', async (file) => {
				if (file instanceof TFile && this.isInScope(file.path)) {
					void this.hologramService.loadCache();
					await this.refreshIncomingRelationships();
					await this.refreshGravitasSections();
				}
				if (file.path === '.hologram-command.json') {
					void this.handleCommandFile();
				}
			})
		);
		this.registerEvent(
			this.app.vault.on('delete', async (file) => {
				void this.incomingIndex.update();
				if (file instanceof TFile && this.isInScope(file.path)) {
					await this.refreshIncomingRelationships();
					await this.refreshGravitasSections();
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

		this.ribbonIcon = this.addRibbonIcon('waypoints', 'Semantic Hologram', () => {
			void this.activateView();
		});



		this.addCommand({
			id: 'refresh-incoming-relationships',
			name: 'Refresh incoming relationships in notes',
			callback: async () => {
				await this.refreshIncomingRelationships();
			},
		});

		this.addCommand({
			id: 'refresh-gravitas-confidence',
			name: 'Refresh gravitas and confidence sections in notes',
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
			name: 'Start Hologram GIF Recording',
			callback: () => {
				const view = this.app.workspace.getActiveViewOfType(SemanticHologramView);
				if (view) {
					console.log('[SH] Command triggered recording');
					(view as any).startRecording();
				} else {
					new Notice('Open Semantic Hologram view first.');
				}
			},
		});

		this.addCommand({
			id: 'open-semantic-hologram',
			name: 'Open Semantic Hologram graph',
			callback: () => {
				void this.activateView();
			},
		});

		this.addCommand({
			id: 'zoom-in',
			name: 'Magnify (dolly in 3D)',
			hotkeys: [{ modifiers: ['Mod', 'Shift'], key: '=' }],
			callback: () => {
				const view = this.app.workspace.getActiveViewOfType(SemanticHologramView);
				view?.magnify();
			},
		});

		this.addCommand({
			id: 'zoom-out',
			name: 'Demagnify (dolly in 3D)',
			hotkeys: [{ modifiers: ['Mod'], key: '-' }],
			callback: () => {
				const view = this.app.workspace.getActiveViewOfType(SemanticHologramView);
				view?.demagnify();
			},
		});

		this.addCommand({
			id: 'fit-to-view',
			name: 'Fit To View',
			hotkeys: [{ modifiers: ['Mod'], key: '=' }],
			callback: () => {
				const view = this.app.workspace.getActiveViewOfType(SemanticHologramView);
				view?.fitToViewPublic();
			},
		});

		this.addCommand({
			id: 'create-hologram-node',
			name: 'Create hologram node',
			callback: () => {
				new CreateNodeModal(this.app, this).open();
			},
		});

		this.addCommand({
			id: 'import-note-into-hologram',
			name: 'Import note into Holograms',
			callback: () => {
				const modal = new ImportNoteModal(this.app, this);
				if (modal.getItems().length === 0) {
					new Notice('No notes to import — all markdown notes are already in the hologram scope.');
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
			name: 'Import incoming Zettelkasten notes',
			callback: () => {
				new IncomingImportModal(this.app, this).open();
			},
		});

		this.addCommand({
			id: 'dump-graph-state',
			name: 'Dump graph state (debug)',
			callback: () => {
				void this.dumpGraphState();
			},
		});

		this.addCommand({
			id: 'open-hologram-controls',
			name: 'Show Hologram controls',
			callback: () => {
				void this.activateControlsView();
			},
		});

		this.addCommand({
			id: 'focus-search',
			name: 'Focus node search',
			callback: () => {
				const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_HOLOGRAM);
				if (leaves.length > 0) {
					const view = leaves[0]?.view as any;
					if (view && typeof view.focusSearchInput === 'function') {
						view.focusSearchInput();
						return;
					}
				}
				const searchInput = document.querySelector('.sh-search-input') as HTMLInputElement | null;
				if (searchInput) {
					searchInput.focus();
					searchInput.select();
				}
			},
		});

		this.addSettingTab(new SemanticHologramSettingTab(this.app, this));

		this.registerEditorSuggest(new RelationSuggest(this.app, this));
		this.registerEditorExtension(relationGhostExtension(this));

		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (file instanceof TFile && this.isInScope(file.path)) {
					void this.refreshGraphs();
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on('create', (file) => {
				if (file instanceof TFile && this.isInScope(file.path)) {
					void this.refreshGraphs();
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (file instanceof TFile && this.isInScope(file.path)) {
					void this.refreshGraphs();
				}
			}),
		);

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
		this.settings.hologramMode = mode;
		await this.saveSettings();
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_HOLOGRAM)) {
			const v = leaf.view;
			if (v instanceof SemanticHologramView) {
				v.setMode(mode);
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
	}

	knownRelIds(): Set<string> {
		return new Set(this.settings.relTypes.map((t) => t.id));
	}

	isInScope(path: string): boolean {
		return inScopePath(path, this.app.vault, this.app.metadataCache);
	}

	async refreshIncomingRelationships(): Promise<void> {
		const files = this.app.vault.getMarkdownFiles();
		let result;
		try {
			result = await syncIncomingRelationships(
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
		// new Notice(`Updated incoming relationships in ${result.updated.length} hologram note(s).`);
		console.log(`Updated incoming relationships in ${result.updated.length} hologram note(s).`);
		await this.refreshGraphs();
	}

	async refreshGravitasSections(): Promise<void> {
		const files = this.app.vault.getMarkdownFiles();
		let result;
		try {
			result = await syncGravitasAndConfidence(
				files,
				this.app.vault,
				this.app.metadataCache,
				this.settings.sourceKinds,
				this.settings.defaultConfidence,
				this.settings.defaultRelStrength,
				this.knownRelIds(),
				(path) => this.isInScope(path),
			);
		} catch (e) {
			new Notice(`Semantic Hologram: gravitas refresh failed: ${String(e)}`);
			return;
		}
		console.log(`Updated gravitas/confidence sections in ${result.updated.length} hologram note(s).`);
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
			workspace.revealLeaf(existing[0]!);
			return;
		}
		const leaf = workspace.getRightLeaf(false);
		if (!leaf) {
			return;
		}
		await leaf.setViewState({ type: VIEW_TYPE_HOLOGRAM_CONTROLS, active: true });
		workspace.revealLeaf(leaf);
	}

	async activateReviewView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_REVIEW_CONNECTIONS);
		if (existing.length > 0) {
			workspace.revealLeaf(existing[0]!);
			return;
		}
		const leaf = workspace.getLeaf('tab');
		await leaf.setViewState({ type: VIEW_TYPE_REVIEW_CONNECTIONS, active: true });
		workspace.revealLeaf(leaf);
	}

	async activateAuditView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_AUDIT_CONNECTIONS);
		if (existing.length > 0) {
			workspace.revealLeaf(existing[0]!);
			return;
		}
		const leaf = workspace.getLeaf('tab');
		await leaf.setViewState({ type: VIEW_TYPE_AUDIT_CONNECTIONS, active: true });
		workspace.revealLeaf(leaf);
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_HOLOGRAM);
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_HOLOGRAM_CONTROLS);
		if (this.ribbonIcon) {
			this.ribbonIcon.remove();
			this.ribbonIcon = null;
		}
	}

	private async dumpGraphState(): Promise<void> {
		const view = this.app.workspace
			.getLeavesOfType(VIEW_TYPE_HOLOGRAM)
			.map((leaf) => leaf.view)
			.find((v): v is SemanticHologramView => v instanceof SemanticHologramView);
		if (!view) {
			new Notice('Semantic Hologram: open the graph view first.');
			return;
		}
		const path = await view.dumpGraphState();
		new Notice(`Graph state written to ${path}`);
	}

	async activateView() {
		const { workspace } = this.app;

		// If there is an empty leaf (e.g. new tab), reuse it.
		const emptyLeaves = workspace.getLeavesOfType('empty');
		const targetLeaf = workspace.activeLeaf?.view.getViewType() === 'empty' 
			? workspace.activeLeaf 
			: (emptyLeaves.length > 0 ? emptyLeaves[0] : null);
		
		if (targetLeaf) {
			await targetLeaf.setViewState({ type: VIEW_TYPE_HOLOGRAM, active: true });
			workspace.revealLeaf(targetLeaf);
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
			workspace.revealLeaf(mainLeaf);
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
			workspace.revealLeaf(leaf);
		}
	}

	async loadSettings() {
		const saved = (await this.loadData()) as Partial<SemanticHologramSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved ?? {});
		if ((this.settings.hoverDepth ?? 0) === 0 && (saved as any)?.maxDepth) {
			this.settings.hoverDepth = (saved as any).maxDepth;
			this.settings.maxDepth = (saved as any).maxDepth;
		}
		if (this.settings.maxDepth === undefined) this.settings.maxDepth = this.settings.hoverDepth;
		if ((this.settings as any).depthBase === undefined) (this.settings as any).depthBase = 0.55;
	}

	private async handleCommandFile() {
		const view = this.app.workspace.getActiveViewOfType(SemanticHologramView);
		if (view) {
			(view as any).startRecording();
		} else {
			const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_HOLOGRAM);
			if (leaves.length > 0 && leaves[0]?.view) {
				const v = leaves[0].view as SemanticHologramView;
				(v as any).startRecording();
			} else {
				await this.activateView();
				const newView = this.app.workspace.getActiveViewOfType(SemanticHologramView);
				if (newView) {
					(newView as any).startRecording();
				}
			}
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class CreateNodeModal extends Modal {
	private plugin: SemanticHologramPlugin;
	private name = '';
	private noteType: string;

	constructor(app: App, plugin: SemanticHologramPlugin) {
		super(app);
		this.plugin = plugin;
		const enabled = plugin.settings.nodeTypes.filter((t) => t.enabled);
		this.noteType = enabled[0]?.id ?? 'concept';
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
					void this.create();
				}
			});
			t.onChange((v) => (this.name = v.trim()));
		});

		new Setting(contentEl).setName('Note type').addDropdown((d) => {
			for (const nt of this.plugin.settings.nodeTypes) {
				if (nt.enabled) {
					d.addOption(nt.id, nt.name || nt.id);
				}
			}
			d.setValue(this.noteType).onChange((v) => (this.noteType = v));
		});

		new Setting(contentEl)
			.addButton((b) =>
				b.setButtonText('Cancel').onClick(() => {
					this.close();
				}),
			)
			.addButton((b) =>
				b.setButtonText('Create').setCta().onClick(() => {
					void this.create();
				}),
			);
	}

	private async create(): Promise<void> {
		if (!this.name) {
			new Notice('Give the node a name.');
			return;
		}
		if (/[\\/:*?"<>|]/.test(this.name)) {
			new Notice('Name contains invalid characters.');
			return;
		}
		const folder = HOLOGRAM_FOLDER;
		const path = `${folder}/${this.name}.md`;
		if (this.app.vault.getAbstractFileByPath(path)) {
			new Notice(`A note already exists at ${path}`);
			return;
		}
		try {
			if (!this.app.vault.getAbstractFileByPath(folder)) {
				await this.app.vault.createFolder(folder);
			}
		} catch (e) {
			// Folder likely exists already; vault.create below reports otherwise.
		}
		const created = new Date().toISOString().slice(0, 10);
		const content = `---
hologram-node: true
note-type: ${this.noteType}
created: ${created}
---

# ${this.name}

## Relations

## Incoming relationships

`;
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