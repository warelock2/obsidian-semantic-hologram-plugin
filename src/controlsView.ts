import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type SemanticHologramPlugin from './main';
import { SemanticHologramView, VIEW_TYPE_HOLOGRAM } from './view';

export const VIEW_TYPE_HOLOGRAM_CONTROLS = 'semantic-hologram-controls';

export class SemanticHologramControlsView extends ItemView {
	private plugin: SemanticHologramPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: SemanticHologramPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_HOLOGRAM_CONTROLS;
	}

	getDisplayText(): string {
		return 'Hologram Controls';
	}

	getIcon(): string {
		return 'waypoints';
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('sh-controls');
		this.render();

		this.registerEvent(
			this.app.workspace.on('layout-change', () => this.render()),
		);
		this.registerEvent(
			this.app.vault.on('modify', () => {
				const slider = this.contentEl.querySelector('input[type="range"]') as HTMLInputElement;
				if (slider && slider.value !== String(this.plugin.settings.maxDepth)) {
					slider.value = String(this.plugin.settings.maxDepth);
					const label = this.contentEl.querySelector('.sh-controls-label');
					if (label) {
						label.textContent = `Max Depth: ${this.plugin.settings.maxDepth}`;
					}
				}
			})
		);
	}

	onClose(): Promise<void> {
		this.contentEl.empty();
		return Promise.resolve();
	}

	render(): void {
		const { contentEl } = this;
		contentEl.empty();

		const header = contentEl.createDiv({ cls: 'sh-controls-header' });
		header.createEl('h4', { text: 'Semantic Hologram' });
		header.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': 'Open settings' } }, (btn) => {
			setIcon(btn, 'settings');
			btn.addEventListener('click', () => {
				(this.app as any).setting.open();
				(this.app as any).setting.openTabById(this.plugin.manifest.id);
			});
		});

		const helpHint = contentEl.createDiv({ cls: 'sh-controls-help-hint' });
		helpHint.setText("Press 'h' for help");

		const mode = this.plugin.settings.hologramMode;

		const modeRow = contentEl.createDiv({ cls: 'sh-controls-row' });
		modeRow.createEl('span', { text: 'Mode', cls: 'sh-controls-label' });
		const toggle = modeRow.createEl('button', {
			cls: mode === '3d' ? 'mod-cta sh-mode-toggle' : 'sh-mode-toggle',
			text: mode === '3d' ? '3D' : '2D',
		});
		toggle.title = 'Toggle 2D / 3D';
		toggle.addEventListener('click', () => {
			const next = mode === '2d' ? '3d' : '2d';
			void this.plugin.setMode(next);
			this.render();
		});

		const centerRow = contentEl.createDiv({ cls: 'sh-controls-row' });
		centerRow.createEl('span', { text: 'Show rotation center', cls: 'sh-controls-label' });
		const centerCheckbox = centerRow.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
		centerCheckbox.checked = this.plugin.settings.showRotationCenter;
		centerCheckbox.addEventListener('change', () => {
			void this.plugin.setShowRotationCenter(centerCheckbox.checked);
		});

		const depthRow = contentEl.createDiv({ cls: 'sh-controls-row sh-controls-col' });
		depthRow.createEl('span', { text: `Max Depth: ${this.plugin.settings.maxDepth}`, cls: 'sh-controls-label' });
		const depthSlider = depthRow.createEl('input', {
			type: 'range',
			attr: { min: '0', max: '5', step: '1', value: String(this.plugin.settings.maxDepth) },
		}) as HTMLInputElement;
		depthSlider.addEventListener('input', () => {
			this.plugin.settings.maxDepth = parseInt(depthSlider.value);
			void this.plugin.saveSettings();
			const label = depthRow.querySelector('.sh-controls-label');
			if (label) {
				label.textContent = `Max Depth: ${this.plugin.settings.maxDepth}`;
			}
		});

		const hint = contentEl.createDiv({ cls: 'sh-controls-hint' });
		hint.setText(
			mode === '3d'
				? '3D mode — Shift+drag to rotate, drag to pan, scroll to zoom. Nodes live in full 3D physics.'
				: '2D canvas mode. Toggle to 3D for depth — Shift+drag rotates once you switch.',
		);

		const actions = contentEl.createDiv({ cls: 'sh-controls-actions' });

		const openBtn = actions.createEl('button', { text: 'Open graph' });
		openBtn.addEventListener('click', () => {
			void this.plugin.activateView();
		});

		const fitBtn = actions.createEl('button', { text: 'Fit to view' });
		fitBtn.addEventListener('click', () => {
			const view = this.app.workspace
				.getLeavesOfType(VIEW_TYPE_HOLOGRAM)
				.map((l) => l.view)
				.find((v): v is SemanticHologramView => v instanceof SemanticHologramView);
			if (view) {
				view.fitToViewPublic();
			} else {
				void this.plugin.activateView();
			}
		});

		const footer = contentEl.createDiv({ cls: 'sh-controls-footer' });
		footer.createEl('span', {
			text: `${mode.toUpperCase()} · ${this.plugin.app.vault.getMarkdownFiles().length} notes`,
			cls: 'sh-controls-meta',
		});
	}
}
