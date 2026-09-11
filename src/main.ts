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
import { inScopePath, scanRelations } from './relations';
import { RelationSuggest, relationGhostExtension } from './relationSuggest';
import { ImportNoteModal } from './importNote';
import { FolderPickModal } from './review';

export default class SemanticHologramPlugin extends Plugin {
	settings!: SemanticHologramSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_HOLOGRAM,
			(leaf: WorkspaceLeaf) => new SemanticHologramView(leaf, this),
		);
		this.registerView(
			VIEW_TYPE_HOLOGRAM_CONTROLS,
			(leaf: WorkspaceLeaf) => new SemanticHologramControlsView(leaf, this),
		);

		this.addRibbonIcon('waypoints', 'Semantic Hologram', () => {
			void this.activateView();
		});

		this.addCommand({
			id: 'open-semantic-hologram',
			name: 'Open Semantic Hologram graph',
			callback: () => {
				void this.activateView();
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
			id: 'refresh-incoming-relationships',
			name: 'Refresh incoming relationships',
			callback: () => {
				void this.refreshIncomingRelationships();
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
				(path) => this.isInScope(path),
			);
		} catch (e) {
			new Notice(`Semantic Hologram: refresh failed: ${String(e)}`);
			return;
		}
		new Notice(`Updated incoming relationships in ${result.updated.length} hologram note(s).`);
		await this.refreshGraphs();
	}

	async scanForInvalidHolograms(): Promise<void> {
		const scan = await scanRelations(
			this.app.vault.getMarkdownFiles(),
			this.app.vault,
			this.app.metadataCache,
			this.knownRelIds(),
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

	onunload() {}

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
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<SemanticHologramSettings>,
		);
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