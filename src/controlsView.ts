import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type SemanticHologramPlugin from './main';
import { SemanticHologramView, VIEW_TYPE_HOLOGRAM } from './view';

export const VIEW_TYPE_HOLOGRAM_CONTROLS = 'semantic-hologram-controls';

export class SemanticHologramControlsView extends ItemView {
	private plugin: SemanticHologramPlugin;

	public updateLevelSlider(): void {
		const levelSlider = this.containerEl.querySelector('.sh-level-slider') as HTMLInputElement | null;
		if (levelSlider) {
			levelSlider.value = String(this.plugin.settings.levelHighlight);
			const levelNames = ['Concept', 'Idea', 'Pattern', 'Topic', 'Domain', 'Field'];
			const levelRow = levelSlider.parentElement;
			const label = levelRow?.querySelector('.sh-controls-label');
			const levelName = levelNames[this.plugin.settings.levelHighlight];
			if (label && levelName) {
				label.textContent = `Level: ${levelName}`;
			}
		}
	}

	private getView(): SemanticHologramView | undefined {
		return this.app.workspace
			.getLeavesOfType(VIEW_TYPE_HOLOGRAM)
			.map((l) => l.view)
			.find((v): v is SemanticHologramView => v instanceof SemanticHologramView);
	}

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
		return 'settings';
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('sh-controls');
		this.render();

		this.registerEvent(
			this.app.workspace.on('layout-change', () => this.render()),
		);
		// Listen for cache updates
		this.registerEvent(
			this.app.vault.on('modify', () => setTimeout(() => this.render(), 100)),
		);
		this.registerEvent(
			this.app.vault.on('create', () => setTimeout(() => this.render(), 100)),
		);
	}

	onClose(): Promise<void> {
		this.contentEl.empty();
		return Promise.resolve();
	}

	render(): void {
		console.log('Rendering controls view, settings:', this.plugin.settings);
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

		// Node Search Box
		const searchContainer = contentEl.createDiv({ cls: 'sh-controls-search' });
		const searchInput = searchContainer.createEl('input', {
			type: 'text',
			placeholder: 'Search nodes...',
			cls: 'sh-search-input',
		});
		const resultsContainer = searchContainer.createDiv({ cls: 'sh-search-results' });
		resultsContainer.style.display = 'none';

		let selectedResultIndex = -1;

		searchInput.addEventListener('keydown', (e) => {
			const items = resultsContainer.querySelectorAll('.sh-search-item');
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				selectedResultIndex = Math.min(selectedResultIndex + 1, items.length - 1);
				updateHighlight();
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				selectedResultIndex = Math.max(selectedResultIndex - 1, 0);
				updateHighlight();
			} else if (e.key === 'Enter') {
				e.preventDefault();
				if (selectedResultIndex >= 0 && selectedResultIndex < items.length) {
					(items[selectedResultIndex] as HTMLElement).click();
				}
			}
		});

		const updateHighlight = () => {
			const items = resultsContainer.querySelectorAll('.sh-search-item');
			items.forEach((item, index) => {
				item.toggleClass('is-selected', index === selectedResultIndex);
			});
		};

		searchInput.addEventListener('input', () => {
			selectedResultIndex = -1;
			const query = searchInput.value.trim().toLowerCase();
			resultsContainer.empty();
			if (!query) {
				resultsContainer.style.display = 'none';
				return;
			}
			const view = this.getView();
			const nodes = view?.['nodes'] ?? [];
			const matches = nodes.filter(n => n.label.toLowerCase().includes(query) || n.path.toLowerCase().includes(query)).slice(0, 10);

			if (matches.length === 0) {
				resultsContainer.style.display = 'none';
				return;
			}

			resultsContainer.style.display = 'block';
			for (const node of matches) {
				const item = resultsContainer.createDiv({ cls: 'sh-search-item', text: node.label });
				item.addEventListener('click', () => {
					if (view) {
						view.setCandidateNode(node.path);
						searchInput.value = node.label;
						resultsContainer.style.display = 'none';
					}
				});
			}
		});

		this.contentEl.addEventListener('click', (e) => {
			if (!(e.target as HTMLElement).closest('.sh-controls-search')) {
				resultsContainer.style.display = 'none';
			}
		});

		// Hologram Manager (integrated)
		contentEl.createEl('h5', { text: 'Emulsified Holograms' });
		const hologramList = contentEl.createDiv({ cls: 'sh-hologram-list' });
		const allTags = this.plugin.hologramService.getAllTags();
		
		for (const tag of allTags) {
			const row = hologramList.createDiv({ cls: 'sh-hologram-row' });
			const cb = row.createEl('input', { type: 'checkbox' });
			cb.checked = this.plugin.settings.selectedHolograms.includes(tag);
			cb.addEventListener('change', () => {
				if (cb.checked) {
					this.plugin.settings.selectedHolograms.push(tag);
				} else {
					this.plugin.settings.selectedHolograms = this.plugin.settings.selectedHolograms.filter((t) => t !== tag);
				}
				void this.plugin.saveSettings();
				// Refresh graph
				this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_HOLOGRAM).forEach(leaf => (leaf.view as any).render());
			});
			row.createSpan({ text: tag, cls: 'sh-hologram-label' });
		}

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

		const depthRow = contentEl.createDiv({ cls: 'sh-controls-row' });
		depthRow.createEl('span', { text: `Hover depth: ${this.plugin.settings.hoverDepth}`, cls: 'sh-controls-label' });
		const depthSlider = depthRow.createEl('input', {
			type: 'range',
			attr: { min: '0', max: '6', step: '1', value: String(this.plugin.settings.hoverDepth) },
		}) as HTMLInputElement;
		depthSlider.addEventListener('input', () => {
			const v = parseInt(depthSlider.value, 10);
			this.plugin.settings.hoverDepth = v;
			this.plugin.settings.maxDepth = v;
			void this.plugin.saveSettings();
			const label = depthRow.querySelector('.sh-controls-label');
			if (label) label.textContent = `Hover depth: ${v}`;
		});

		// Level Highlight Slider
		const levelRow = contentEl.createDiv({ cls: 'sh-controls-row' });
		const levelNames = ['Concept', 'Idea', 'Pattern', 'Topic', 'Domain', 'Field'];
		levelRow.createEl('span', { text: `Level: ${levelNames[this.plugin.settings.levelHighlight]}`, cls: 'sh-controls-label' });
		const levelSlider = levelRow.createEl('input', {
			cls: 'sh-level-slider',
			type: 'range',
			attr: { min: '0', max: '5', step: '1', value: String(this.plugin.settings.levelHighlight), dir: 'rtl' },
		}) as HTMLInputElement;
		levelSlider.addEventListener('input', () => {
			const v = parseInt(levelSlider.value, 10);
			void this.plugin.setLevelHighlight(v);
			const label = levelRow.querySelector('.sh-controls-label');
			if (label) label.textContent = `Level: ${levelNames[v]}`;
		});

		// Opacity/Translucence Slider
		const opacityRow = contentEl.createDiv({ cls: 'sh-controls-row' });
		opacityRow.createEl('span', { text: `Level Opacity: ${Math.round(this.plugin.settings.levelHighlightOpacity * 100)}%`, cls: 'sh-controls-label' });
		const opacitySlider = opacityRow.createEl('input', {
			type: 'range',
			attr: { min: '10', max: '90', step: '5', value: String(this.plugin.settings.levelHighlightOpacity * 100) },
		}) as HTMLInputElement;
		opacitySlider.addEventListener('input', () => {
			const v = parseInt(opacitySlider.value, 10) / 100;
			this.plugin.settings.levelHighlightOpacity = v;
			void this.plugin.saveSettings();
			const label = opacityRow.querySelector('.sh-controls-label');
			if (label) label.textContent = `Level Opacity: ${Math.round(v * 100)}%`;
			this.getView()?.requestRedraw();
		});

		// Face Opacity Controls
		const faceOpacityRow = contentEl.createDiv({ cls: 'sh-controls-row' });
		
		faceOpacityRow.createEl('span', { text: `Face Opacity: ${Math.round(this.plugin.settings.facesOpacity * 100)}%`, cls: 'sh-controls-label' });
		const faceOpacitySlider = faceOpacityRow.createEl('input', {
			type: 'range',
			attr: { min: '0', max: '100', step: '5', value: String(this.plugin.settings.facesOpacity * 100) },
		}) as HTMLInputElement;
		faceOpacitySlider.addEventListener('input', () => {
			const v = parseInt(faceOpacitySlider.value, 10) / 100;
			this.plugin.settings.facesOpacity = v;
			void this.plugin.saveSettings();
			const label = faceOpacityRow.querySelector('.sh-controls-label');
			if (label) label.textContent = `Face Opacity: ${Math.round(v * 100)}%`;
			this.getView()?.requestRedraw();
		});

		const faceToggle = faceOpacityRow.createEl('input', {
			type: 'checkbox',
			attr: { checked: this.plugin.settings.facesEnabled ? 'checked' : null, title: 'Toggle faces (F)' },
		});
		faceToggle.addEventListener('change', () => {
			this.plugin.settings.facesEnabled = faceToggle.checked;
			void this.plugin.saveSettings();
			this.getView()?.requestRedraw();
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

		const fitBtn = actions.createEl('button', { text: 'Fit to view', attr: { title: 'Fit to view (Shift+F)' } });
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

		const gifBtn = actions.createEl('button', { text: 'Record GIF' });
		gifBtn.addEventListener('click', () => {
			const view = this.app.workspace
				.getLeavesOfType(VIEW_TYPE_HOLOGRAM)
				.map((l) => l.view)
				.find((v): v is SemanticHologramView => v instanceof SemanticHologramView);
			if (view) {
				view.startRecording();
			}
		});

		const dumpBtn = actions.createEl('button', { text: 'Dump State' });
		dumpBtn.addEventListener('click', () => {
			const view = this.app.workspace
				.getLeavesOfType(VIEW_TYPE_HOLOGRAM)
				.map((l) => l.view)
				.find((v): v is SemanticHologramView => v instanceof SemanticHologramView);
			if (view) {
				void view.dumpGraphState();
			}
		});

		const footer = contentEl.createDiv({ cls: 'sh-controls-footer' });
		footer.createEl('span', {
			text: `${mode.toUpperCase()} · ${this.plugin.app.vault.getMarkdownFiles().length} notes`,
			cls: 'sh-controls-meta',
		});
	}
}
