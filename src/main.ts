import { ItemView, Notice, Plugin, WorkspaceLeaf } from 'obsidian';
import { DEFAULT_SETTINGS, HologramMode, SemanticHologramSettings, SemanticHologramSettingTab } from './settings';
import { SemanticHologramControlsView, VIEW_TYPE_HOLOGRAM_CONTROLS } from './controlsView';
import { SemanticHologramView, VIEW_TYPE_HOLOGRAM } from './view';

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

		this.app.workspace.onLayoutReady(() => {
			void this.activateControlsView();
		});
	}

	getMode(): HologramMode {
		return this.settings.hologramMode;
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