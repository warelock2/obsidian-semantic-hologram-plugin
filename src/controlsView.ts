import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type SemanticHologramPlugin from './main';
import { SemanticHologramView, VIEW_TYPE_HOLOGRAM, buildNodePreviewModel } from './view';
import type { SearchIndexEntry } from './view';
import { parseSearchQuery, matchEntry } from './searchLogic';

export const VIEW_TYPE_HOLOGRAM_CONTROLS = 'semantic-hologram-controls';

export class SemanticHologramControlsView extends ItemView {
	private plugin: SemanticHologramPlugin;
	private lastHologramIndex = -1;
	private searchQuery: string = '';

	private get mergeModeLabel(): 'absorb' | 'emulsify' {
		return this.plugin.settings.mergeMode ?? 'emulsify';
	}

	private get splitModeLabel(): 'move' | 'copy' {
		return this.plugin.settings.splitMode ?? 'move';
	}

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

		// Add a listener to re-render when camera changes
		this.registerEvent(this.app.workspace.on('layout-change', () => this.render()));
		// Also re-render periodically or when the view indicates it's changed? 
		// Actually, let's just make sure the fields update.
		// For simplicity, we can just force-re-render the whole controls view on view updates.
		// A better way would be adding a specific event or observer, but for now we'll just 
		// force re-render when the main graph is redrawn if possible, 
		// or just rely on the user interacting with it.

	}

	onClose(): Promise<void> {
		this.contentEl.empty();
		return Promise.resolve();
	}

	render(): void {
		console.log('Rendering controls view, settings:', this.plugin.settings);
		const { contentEl } = this;
		contentEl.empty();
		document.querySelectorAll('.sh-node-preview-card').forEach(el => el.remove());

		const view = this.getView();
		const state = view ? view.getCameraState() : { elevation: 0, azimuth: 0, distance: 1000 };
		const focal = view ? view.getFocalPoint() : { x: 0, y: 0, z: 0 };

		const header = contentEl.createDiv({ cls: 'sh-controls-header' });
		header.createEl('h4', { text: 'Semantic Hologram' });

		// Camera Controls
		const cameraControls = contentEl.createDiv({ cls: 'sh-camera-controls' });
		cameraControls.createEl('div', { text: 'Camera', cls: 'sh-settings-label' });
		const cameraRow = cameraControls.createDiv({ cls: 'sh-controls-row' });
		cameraRow.style.display = 'grid';
		cameraRow.style.gridTemplateColumns = 'auto 1fr 1fr 1fr';
		cameraRow.style.gap = '5px';
		cameraRow.style.alignItems = 'center';

		const addInput = (label: string, value: number, onUpdate: (v: number) => void) => {
			if (label) {
				cameraRow.createEl('span', { text: label, cls: 'sh-controls-label', attr: { style: 'font-size: 10px;' } });
			}
			const input = cameraRow.createEl('input', {
				type: 'number',
				attr: { value: value.toFixed(1), step: '1', style: 'width: 100%;' }
			}) as HTMLInputElement;
			input.addEventListener('change', () => onUpdate(parseFloat(input.value)));
			return input;
		};

		addInput('Elev (°)', state.elevation, v => view?.setCameraState({ ...view.getCameraState(), elevation: v }));
		addInput('Azim (°)', state.azimuth, v => view?.setCameraState({ ...view.getCameraState(), azimuth: v }));
		cameraRow.createDiv(); // Spacer

		// Focal point controls
		cameraControls.createEl('div', { text: 'Focal point', cls: 'sh-settings-label', attr: { style: 'margin-top: 10px;' } });
		const focalRow = cameraControls.createDiv({ cls: 'sh-controls-row' });
		focalRow.style.display = 'grid';
		focalRow.style.gridTemplateColumns = 'auto 1fr 1fr 1fr';
		focalRow.style.gap = '5px';
		focalRow.style.alignItems = 'center';

		const inputs: HTMLInputElement[] = [];
		const addFocalInput = (label: string, value: number, onUpdate: (v: number) => void) => {
			if (label) {
				focalRow.createEl('span', { text: label, cls: 'sh-controls-label', attr: { style: 'font-size: 10px;' } });
			}
			const input = focalRow.createEl('input', {
				type: 'number',
				attr: { value: value.toFixed(1), step: '1', style: 'width: 100%;' }
			}) as HTMLInputElement;
			input.addEventListener('change', () => onUpdate(parseFloat(input.value)));
			inputs.push(input);
			return input;
		};

		const initialFocal = view ? view.getFocalPoint() : { x: 0, y: 0, z: 0 };
		addFocalInput('Focal', initialFocal.x, v => { if (view) { view.setFocalPoint(v, view.getFocalPoint().y); view.requestRedraw(); } });
		addFocalInput('', initialFocal.y, v => { if (view) { view.setFocalPoint(view.getFocalPoint().x, v); view.requestRedraw(); } });
		addFocalInput('', initialFocal.z, v => { }); 

		// Expose update function to view for live updates
		if (view) {
			(view as any).onCameraChange = () => {
				const currentFocal = view.getFocalPoint();
				if (inputs[0]) inputs[0].value = currentFocal.x.toFixed(1);
				if (inputs[1]) inputs[1].value = currentFocal.y.toFixed(1);
				if (inputs[2]) inputs[2].value = currentFocal.z.toFixed(1);
				
				const currentState = view.getCameraState();
				const cameraInputs = cameraRow.querySelectorAll('input');
				if (cameraInputs[0]) cameraInputs[0].value = currentState.elevation.toFixed(1);
				if (cameraInputs[1]) cameraInputs[1].value = currentState.azimuth.toFixed(1);
			};
		}









		const helpHint = contentEl.createDiv({ cls: 'sh-controls-help-hint' });
		helpHint.setText("Press 'h' for help");

		const dragModeRow = contentEl.createDiv({ cls: 'sh-controls-modes' });

		const mergeBtn = dragModeRow.createEl('button', {
			cls: `sh-mode-btn is-merge ${this.mergeModeLabel}`,
			attr: { title: 'Merge mode (Shift+M): how the dragged set merges onto another hologram' },
		});
		mergeBtn.createSpan({ cls: 'sh-mode-key', text: 'M' });
		mergeBtn.createSpan({ cls: 'sh-mode-label', text: this.mergeModeLabel === 'absorb' ? 'Absorb' : 'Emulsify' });
		mergeBtn.addEventListener('click', () => {
			this.plugin.settings.mergeMode = this.plugin.settings.mergeMode === 'absorb' ? 'emulsify' : 'absorb';
			void this.plugin.saveSettings();
			this.render();
		});

		const splitBtn = dragModeRow.createEl('button', {
			cls: `sh-mode-btn is-split ${this.splitModeLabel}`,
			attr: { title: 'Split mode (Shift+S): what happens to the dragged set when it separates' },
		});
		splitBtn.createSpan({ cls: 'sh-mode-key', text: 'S' });
		splitBtn.createSpan({ cls: 'sh-mode-label', text: this.splitModeLabel === 'move' ? 'Move' : 'Copy' });
		splitBtn.addEventListener('click', () => {
			this.plugin.settings.splitMode = this.plugin.settings.splitMode === 'move' ? 'copy' : 'move';
			void this.plugin.saveSettings();
			this.render();
		});

		// Edge Creation Settings
		const edgeSettings = contentEl.createDiv({ cls: 'sh-controls-edge-settings' });
		edgeSettings.createEl('div', { text: 'Default Edge Settings (Alt+Drag):', cls: 'sh-settings-label' });
		
		const relTypeSelect = edgeSettings.createEl('select', { cls: 'sh-rel-type-select' });
		this.plugin.settings.relTypes.forEach(t => {
			const opt = relTypeSelect.createEl('option', { value: t.id, text: t.id });
			if (t.id === (this.plugin.settings as any).defaultRelType) opt.selected = true;
		});
		relTypeSelect.addEventListener('change', (e) => {
			(this.plugin.settings as any).defaultRelType = (e.target as HTMLSelectElement).value;
			void this.plugin.saveSettings();
		});

		const strengthRow = edgeSettings.createDiv({ cls: 'sh-strength-row' });
		strengthRow.style.display = 'flex';
		strengthRow.style.alignItems = 'center';
		strengthRow.style.gap = '8px';

		const strengthSlider = strengthRow.createEl('input', {
			type: 'range',
			cls: 'sh-strength-slider',
			attr: { min: '0', max: '1', step: '0.1', value: this.plugin.settings.defaultRelStrength.toString() }
		});
		
		const strengthInput = strengthRow.createEl('input', {
			type: 'number',
			cls: 'sh-strength-input',
			attr: { min: '0', max: '1', step: '0.1', value: this.plugin.settings.defaultRelStrength.toString(), style: 'width: 50px;' }
		});

		strengthSlider.addEventListener('input', (e) => {
			const val = (e.target as HTMLInputElement).value;
			strengthInput.value = val;
			this.plugin.settings.defaultRelStrength = parseFloat(val);
			void this.plugin.saveSettings();
		});

		strengthInput.addEventListener('change', (e) => {
			const val = (e.target as HTMLInputElement).value;
			strengthSlider.value = val;
			this.plugin.settings.defaultRelStrength = parseFloat(val);
			void this.plugin.saveSettings();
		});

		// Node Search Box (gear sits to the left of the field)
		const searchContainer = contentEl.createDiv({ cls: 'sh-controls-search' });
		const searchBar = searchContainer.createDiv({ cls: 'sh-search-bar' });
		searchBar.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': 'Open settings' } }, (btn) => {
			setIcon(btn, 'settings');
			btn.addEventListener('click', () => {
				(this.app as any).setting.open();
				(this.app as any).setting.openTabById(this.plugin.manifest.id);
			});
		});
		const searchInput = searchBar.createEl('input', {
			type: 'text',
			placeholder: 'Search nodes...',
			cls: 'sh-search-input',
		});
		if (this.searchQuery) {
			searchInput.value = this.searchQuery;
		}
		const resultsContainer = searchContainer.createDiv({ cls: 'sh-search-results' });
		resultsContainer.style.display = 'none';

		if (this.searchQuery) {
			setTimeout(() => searchInput.dispatchEvent(new Event('input')), 0);
		}

		let selectedResultIndex = -1;

		searchInput.addEventListener('keydown', (e) => {
			const items = resultsContainer.querySelectorAll('.sh-search-item');
			const view = this.getView();
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				selectedResultIndex = Math.min(selectedResultIndex + 1, items.length - 1);
				updateHighlight();
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				selectedResultIndex = Math.max(selectedResultIndex - 1, 0);
				updateHighlight();
			} else if (e.key === ' ') {
				if (selectedResultIndex >= 0 && selectedResultIndex < items.length) {
					e.preventDefault();
					const item = items[selectedResultIndex] as HTMLElement;
					const path = item.getAttribute('data-path');
					if (path && view) {
						view.toggleCandidateNode(path);
						updateCandidateStates();
					}
				}
			} else if (e.key === 'Enter') {
				e.preventDefault();
				if (selectedResultIndex >= 0 && selectedResultIndex < items.length) {
					const item = items[selectedResultIndex] as HTMLElement;
					const path = item.getAttribute('data-path');
					if (path && view) {
						view.setCandidateNodes([path]);
						view.focusGraph();
						resultsContainer.style.display = 'none';
					}
				} else {
					// Center view on all candidates
					if (view) {
						view.focusGraph();
						resultsContainer.style.display = 'none';
					}
				}
			}
		});

		const updateHighlight = () => {
			const items = resultsContainer.querySelectorAll('.sh-search-item');
			items.forEach((item, index) => {
				item.toggleClass('is-selected', index === selectedResultIndex);
			});
		};

		const updateCandidateStates = () => {
			const view = this.getView();
			const candidates = view ? view.getCandidateNodes() : new Set<string>();
			resultsContainer.querySelectorAll('.sh-search-item').forEach((item) => {
				const path = item.getAttribute('data-path');
				if (path) {
					item.toggleClass('is-chosen', candidates.has(path));
				}
			});
		};

		let activePreview: HTMLElement | null = null;
		let previewTimer: number | null = null;

		const hidePreview = () => {
			if (activePreview) {
				activePreview.remove();
				activePreview = null;
			}
			if (previewTimer) {
				clearTimeout(previewTimer);
				previewTimer = null;
			}
		};

		const showPreview = (itemEl: HTMLElement, entry: SearchIndexEntry) => {
			if (previewTimer) {
				clearTimeout(previewTimer);
				previewTimer = null;
			}
			if (activePreview && activePreview.getAttribute('data-path') === entry.path) {
				return;
			}
			if (activePreview) {
				activePreview.remove();
			}
			const view = this.getView();
			if (!view) return;
			const previewData = buildNodePreviewModel(entry, this.plugin.settings);

			activePreview = document.body.createDiv({ cls: 'sh-node-preview-card' });
			activePreview.setAttribute('data-path', entry.path);
			activePreview.style.position = 'fixed';
			activePreview.style.zIndex = '1000';
			
			activePreview.addEventListener('mouseenter', () => {
				if (previewTimer) clearTimeout(previewTimer);
			});
			activePreview.addEventListener('mouseleave', (e) => {
                const related = e.relatedTarget as HTMLElement | null;
                // Don't close if moving into the search item OR if moving to something else that is part of the preview card
                if (related && (itemEl.contains(related) || activePreview?.contains(related))) return;
				previewTimer = window.setTimeout(hidePreview, 300);
			});

			activePreview.createDiv({ cls: 'sh-preview-label', text: previewData.label });
			activePreview.createDiv({ cls: 'sh-preview-path', text: entry.path });
			const metaText = `${previewData.typeName} · Confidence ${previewData.confidencePct}% · Gravitas ${previewData.gravitasPct}%`;
			activePreview.createDiv({ cls: 'sh-preview-meta', text: metaText });
			activePreview.createDiv({ cls: 'sh-preview-content', text: previewData.content });

			// Position to the left of the item
			const rect = itemEl.getBoundingClientRect();
			const viewportWidth = window.innerWidth;
			const viewportHeight = window.innerHeight;
			const cardWidth = 320; // Matches CSS
			
			let left = rect.left - cardWidth - 16; // Increased gap to ensure no overlap
			let top = rect.top;

			// Flip if too close to left edge
			if (left < 8) {
				left = rect.right + 16;
			}

			// Clamp top
			const cardHeight = activePreview.getBoundingClientRect().height;
			if (top + cardHeight > viewportHeight - 8) {
				top = viewportHeight - cardHeight - 8;
			}
			if (top < 8) top = 8;

			activePreview.style.left = `${left}px`;
			activePreview.style.top = `${top}px`;
		};


		searchInput.addEventListener('input', () => {
			this.searchQuery = searchInput.value;
			selectedResultIndex = -1;
			const query = searchInput.value.trim();
			resultsContainer.empty();
			hidePreview();

			if (!query) {
				resultsContainer.style.display = 'none';
				return;
			}

			const view = this.getView();
			const index = view?.getSearchIndex() ?? new Map<string, SearchIndexEntry>();
			const { field, term } = parseSearchQuery(query);

			if (index.size === 0) {
				resultsContainer.style.display = 'none';
				return;
			}

			const matches: Array<{ entry: SearchIndexEntry; matched: Set<string> }> = [];
			for (const entry of index.values()) {
				const matched = matchEntry(entry, field, term);
				if (matched.size > 0) {
					matches.push({ entry, matched });
				}
			}

            matches.sort((a, b) => a.entry.label.localeCompare(b.entry.label));
            const finalMatches = matches.slice(0, 15);

			if (matches.length === 0) {
				resultsContainer.style.display = 'none';
				return;
			}

			resultsContainer.style.display = 'block';
			const candidates = view ? view.getCandidateNodes() : new Set<string>();

			for (const { entry, matched } of finalMatches) {
				const item = resultsContainer.createDiv({
					cls: `sh-search-item ${candidates.has(entry.path) ? 'is-chosen' : ''}`,
					attr: { 'data-path': entry.path },
				});

				const titleEl = item.createDiv({ cls: 'sh-search-item-title', text: entry.label });

				item.addEventListener('mouseenter', () => {
					showPreview(item, entry);
				});

				item.addEventListener('mouseleave', (e) => {
					const related = e.relatedTarget as HTMLElement | null;
					if (activePreview && related && activePreview.contains(related)) return;
					if (!previewTimer) {
						previewTimer = window.setTimeout(hidePreview, 300);
					}
				});

				item.addEventListener('click', (e) => {
					if (!view) return;
					if (e.ctrlKey || e.metaKey) {
						// Deselect or toggle individual
						view.toggleCandidateNode(entry.path);
					} else {
						// Toggle immediately per pick
						view.toggleCandidateNode(entry.path);
						view.focusGraph();
						resultsContainer.style.display = 'none';
					}
					updateCandidateStates();
				});
			}

			resultsContainer.addEventListener('mouseleave', (e) => {
				const related = e.relatedTarget as HTMLElement | null;
				if (activePreview && related && activePreview.contains(related)) return;
				if (!previewTimer) {
					previewTimer = window.setTimeout(hidePreview, 300);
				}
			});
		});

	// Hologram Manager (integrated)
		contentEl.createEl('h5', { text: 'Emulsified Holograms' });
		const hologramList = contentEl.createDiv({ cls: 'sh-hologram-list' });
		const allTags = this.plugin.hologramService.getAllTags();
		const selected = new Set(this.plugin.settings.selectedHolograms);

		const refreshRows = () => {
			hologramList.querySelectorAll<HTMLElement>('.sh-hologram-row').forEach((row) => {
				const tag = row.getAttribute('data-tag');
				row.toggleClass('is-active', tag !== null && selected.has(tag));
			});
		};

		const saveAndRefresh = () => {
			this.plugin.settings.selectedHolograms = [...selected];
			void this.plugin.saveSettings();
			this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_HOLOGRAM).forEach((leaf) => (leaf.view as any).render());
		};

		contentEl.createDiv({ cls: 'sh-controls-hint', text: 'Click: select · Shift+click: range · Ctrl+click: toggle' });

		if (allTags.length === 0) {
			hologramList.createDiv({ cls: 'sh-controls-hint', text: 'No hologram tags yet — add `holograms:` to a note in scope.' });
		}
		allTags.forEach((tag, i) => {
			const row = hologramList.createDiv({
				cls: 'sh-hologram-row',
				attr: { role: 'button', tabindex: '0', 'data-tag': tag },
			});
			if (selected.has(tag)) {
				row.addClass('is-active');
			}
			row.createSpan({ text: tag, cls: 'sh-hologram-label' });
			row.addEventListener('click', (e) => {
				if (e.ctrlKey || e.metaKey) {
					if (selected.has(tag)) {
						selected.delete(tag);
					} else {
						selected.add(tag);
					}
					this.lastHologramIndex = i;
				} else if (e.shiftKey) {
					const anchor = this.lastHologramIndex >= 0 ? this.lastHologramIndex : i;
					const from = Math.min(anchor, i);
					const to = Math.max(anchor, i);
					selected.clear();
					for (let k = from; k <= to; k++) {
						const t = allTags[k];
						if (t !== undefined) {
							selected.add(t);
						}
					}
					this.lastHologramIndex = i;
				} else {
					selected.clear();
					selected.add(tag);
					this.lastHologramIndex = i;
				}
				refreshRows();
				saveAndRefresh();
			});
			row.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					row.click();
				}
			});
		});

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
