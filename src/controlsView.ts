import { ItemView, WorkspaceLeaf, setIcon, TFolder, TFile } from 'obsidian';
import type SemanticHologramPlugin from './main';
import { SemanticHologramView, VIEW_TYPE_HOLOGRAM, buildNodePreviewModel } from './view';
import { descendantDirs } from './hologramDirs';
import type { SearchIndexEntry } from './view';
import { parseSearchQuery, matchEntry } from './searchLogic';
import { subscribeLegendRefresh } from './legendBus';
import type { ScanLayerSettings } from './settings';

export const VIEW_TYPE_HOLOGRAM_CONTROLS = 'semantic-hologram-controls';

export class SemanticHologramControlsView extends ItemView {
	private plugin: SemanticHologramPlugin;
	private lastHologramIndex = -1;
	private searchQuery: string = '';
	private peekTimer: number | null = null;
	private peekedTag: string | null = null;
	private panelClickHandler: ((e: MouseEvent) => void) | null = null;
	private cameraInputs: HTMLInputElement[] = [];
	private focalInputs: HTMLInputElement[] = [];

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

	private clearPeekTimer(): void {
		if (this.peekTimer !== null) {
			window.clearTimeout(this.peekTimer);
			this.peekTimer = null;
		}
	}

	/** Hover/focus previews a hologram after a short dwell; row switches are immediate. */
	private requestHologramPeek(tag: string, immediate: boolean): void {
		const view = this.getView();
		if (!view) return;
		if (this.peekedTag === tag && view.isHologramPeeking()) return;
		this.clearPeekTimer();
		const fire = () => {
			this.peekTimer = null;
			this.peekedTag = tag;
			view.peekHologram(tag);
		};
		if (immediate || view.isHologramPeeking()) {
			fire();
		} else {
			this.peekTimer = window.setTimeout(fire, 180);
		}
	}

	private endHologramPeek(): void {
		this.clearPeekTimer();
		this.peekedTag = null;
		this.getView()?.endHologramPeek();
	}

	/** A row click is a filter action: end any preview but keep its camera. */
	private commitPeekOnClick(): void {
		this.clearPeekTimer();
		this.peekedTag = null;
		this.getView()?.keepHologramPeekCamera();
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
			this.app.workspace.on('layout-change', () => {
				const active = document.activeElement;
				if (active && this.contentEl.contains(active) && (active.tagName === 'SELECT' || active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
					return;
				}
				this.render();
			}),
		);
		// Re-render when the derived state this panel shows changes. `delete` and
		// `rename` used to be absent, so a trashed or renamed note left its tag
		// listed in the Hologram Manager until an unrelated modify landed.
		const rerenderSoon = () => {
			const active = document.activeElement;
			if (active && this.contentEl.contains(active) && (active.tagName === 'SELECT' || active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
				return;
			}
			window.setTimeout(() => this.render(), 100);
		};
		this.registerEvent(this.app.vault.on('modify', rerenderSoon));
		this.registerEvent(this.app.vault.on('create', rerenderSoon));
		this.registerEvent(this.app.vault.on('delete', rerenderSoon));
		this.registerEvent(this.app.vault.on('rename', rerenderSoon));

		// The scan counts below are derived from the graph, so they have to be
		// re-read when the graph changes — not only when the user touches a
		// checkbox. Without this, opening this panel while the graph was still
		// loading left zeros and a "scan degenerate" warning on screen with no
		// way to clear them short of toggling something.
		//
		// Subscribed on the shared bus rather than on the graph view directly:
		// this panel is often loaded before any graph view exists, and reaching
		// through to the view at load time found nothing. That version looked
		// correct in testing only because an unrelated layout-change re-render
		// happened to rescue it.
		this.register(subscribeLegendRefresh(() => this.refreshScanLegend()));

		// Add a listener to re-render when camera changes
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

	public onCameraChange(): void {
		const view = this.getView();
		if (!view) return;
		const is3D = this.plugin.settings.hologramMode === '3d';

		const state = view.getCameraState();
		if (this.cameraInputs[0]) {
			this.cameraInputs[0].value = is3D ? state.azimuth.toFixed(1) : '';
			this.cameraInputs[0].disabled = !is3D;
		}
		if (this.cameraInputs[1]) {
			this.cameraInputs[1].value = is3D ? state.elevation.toFixed(1) : '';
			this.cameraInputs[1].disabled = !is3D;
		}

		const focal = view.getFocalPoint();
		if (this.focalInputs[0]) this.focalInputs[0].value = focal.x.toFixed(1);
		if (this.focalInputs[1]) this.focalInputs[1].value = focal.y.toFixed(1);
		// In 2D there is no z-component; clear and disable the z field.
		if (this.focalInputs[2]) {
			this.focalInputs[2].value = is3D ? focal.z.toFixed(1) : '';
			this.focalInputs[2].disabled = !is3D;
		}
	}

	/**
	 * Redraw only the diffraction legend, in place.
	 *
	 * Three things this has to get right, all of them found by looking at the
	 * rendered panel rather than the code:
	 *
	 *  - It must not call `render()`. That empties the panel and resets scroll.
	 *  - It must force the scan. `setScanLayer` only invalidates; the recompute
	 *    otherwise happens lazily in the graph's next animation frame, so counts
	 *    read straight after a toggle are one frame stale.
	 *  - It must always say something. Previously, with no graph view open the
	 *    branch was skipped and the element was left empty — an invisible legend
	 *    that reads as "no legend" rather than "no graph".
	 */
	private refreshScanLegend(): void {
		const legendRow = this.contentEl.querySelector('.sh-scan-legend');
		const rows = Array.from(this.contentEl.querySelectorAll<HTMLElement>('.sh-scan-layer-row'));

		const scanView = this.getView();
		if (!scanView) {
			legendRow?.empty();
			legendRow?.createSpan({ text: 'Open the graph view to run a scan.', cls: 'sh-scan-legend-empty' });
			for (const row of rows) {
				const cell = row.querySelector<HTMLElement>('.sh-scan-layer-count');
				if (cell) cell.textContent = '\u2014';
			}
			return;
		}

		// Stamp-guarded, so this is free when nothing actually changed.
		scanView.refreshScan();
		const legend = scanView.getScanLegend();
		const hasSource = this.plugin.settings.scanSource.trim().length > 0;

		for (const row of rows) {
			const key = row.dataset.layer as keyof ScanLayerSettings | undefined;
			const cell = row.querySelector<HTMLElement>('.sh-scan-layer-count');
			if (!key || !cell) continue;
			const entry = legend.layers.find((l) => l.key === key);
			const count = entry?.count ?? 0;
			const needsSource = row.dataset.needsSource === 'true';

			cell.textContent = String(count);
			// Dim the row when its layer is off, but leave the number readable: it
			// is already-computed data, not something that was switched off.
			row.classList.toggle('sh-scan-layer-off', entry?.on !== true);

			const notes: string[] = [];
			// A zero has to be distinguishable from a finding. Gaps, resonance and
			// activation all read the activation field, which is empty in a
			// structural pass — reporting "0" there would state an absence the
			// scan never had the means to detect.
			if (count === 0 && needsSource && !hasSource) {
				notes.push('Needs an injection source — this layer reads the activation field, which is empty in a structural pass.');
			}
			// Truncation disclosure: a bounded view that reports only what it drew
			// tells the flattering half of the truth.
			if (entry?.found != null && entry.limit != null && entry.found > entry.limit) {
				notes.push(`${entry.found} found, ${entry.limit} drawn — ${entry.found - entry.limit} not shown.`);
			}
			if (notes.length > 0) {
				cell.setAttribute('data-note', notes.join(' '));
				cell.title = notes.join(' ');
			} else {
				cell.removeAttribute('data-note');
				cell.removeAttribute('title');
			}
		}

		if (!legendRow) return;
		legendRow.empty();

		if (legend.degenerate) {
			legendRow.createSpan({
				text: 'Scan degenerate \u2014 the graph has no usable edges, so every count here is meaningless.',
				cls: 'sh-scan-legend-warn',
			});
			return;
		}

		if (legend.suppressed > 0) {
			legendRow.createSpan({
				text: `${legend.suppressed} node(s) matched more than one layer; the strongest is drawn.`,
				cls: 'sh-scan-legend-note',
			});
		}
	}

	render(): void {
		const active = document.activeElement;
		const hasFocus = active && this.contentEl.contains(active) && (active.tagName === 'SELECT' || active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
		if (hasFocus) {
			this.onCameraChange();
			return;
		}
		this.endHologramPeek();

		// Validate CWD: if the folder no longer exists, reset to root
		const cwdView = this.getView();
		if (cwdView) {
			const cwd = cwdView.currentCwd || '';
			if (cwd !== '' && !this.plugin.app.vault.getAbstractFileByPath(cwd)) {
				cwdView.currentCwd = '';
			}
		}
		const { contentEl } = this;
		contentEl.empty();
		document.querySelectorAll('.sh-node-preview-card').forEach(el => el.remove());

		this.cameraInputs = [];
		this.focalInputs = [];

		const view = this.getView();
		const state = view ? view.getCameraState() : { elevation: 0, azimuth: 0, distance: 1000 };
		const is3D = this.plugin.settings.hologramMode === '3d';

		const header = contentEl.createDiv({ cls: 'sh-controls-header' });
		header.createEl('h4', { text: 'Semantic Hologram', attr: { style: 'margin-bottom: 6px;' } });
		header.createDiv({ text: "Press 'h' for help", cls: 'sh-controls-hint', attr: { style: 'font-size: 11px; opacity: 0.7; margin-bottom: 10px; text-align: center; width: 100%; display: block;' } });

		const cwdSelect = header.createEl('select', { cls: 'sh-cwd-selector', attr: { style: 'width: 100%; margin-bottom: 12px;' } });
		const populateCwd = (sel: HTMLSelectElement) => {
			sel.empty();
			sel.createEl('option', { value: '/', text: '/' });
			const dirs = descendantDirs(this.plugin.app.vault, 'hologram');
			dirs.sort((a, b) => a.path.localeCompare(b.path));
			for (const dir of dirs) {
				const relPath = dir.path.substring('hologram/'.length);
				const depth = relPath.split('/').length - 1;
				const indent = '\u00A0\u00A0\u00A0\u00A0'.repeat(depth);
				sel.createEl('option', {
					value: dir.path,
					text: `${indent}/${relPath}`
				});
			}
			if (view) {
				sel.value = view.currentCwd || '/';
			}
		};
		populateCwd(cwdSelect);
		cwdSelect.addEventListener('change', () => {
			if (view) {
				view.currentCwd = cwdSelect.value === '/' ? '' : cwdSelect.value;
				void this.plugin.refreshGraphs();
				view.fitToView();
			}
		});
		cwdSelect.addEventListener('keydown', (e) => {
			if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
				const options = Array.from(cwdSelect.options);
				let idx = cwdSelect.selectedIndex;
				if (e.key === 'ArrowUp') idx = Math.max(0, idx - 1);
				else idx = Math.min(options.length - 1, idx + 1);
				cwdSelect.selectedIndex = idx;
				if (view) {
					view.currentCwd = cwdSelect.value === '/' ? '' : cwdSelect.value;
					void this.plugin.refreshGraphs();
					view.fitToView();
				}
			}
		});

		// Camera Controls
		const cameraControls = contentEl.createDiv({ cls: 'sh-camera-controls' });
		cameraControls.createDiv({ text: 'Camera', cls: 'sh-settings-label' });
		const cameraRow = cameraControls.createDiv({ cls: 'sh-controls-row' });
		cameraRow.style.display = 'grid';
		cameraRow.style.gridTemplateColumns = 'auto 1fr 1fr 1fr';
		cameraRow.style.gap = '5px';
		cameraRow.style.alignItems = 'center';

		const addInput = (label: string, value: number, onUpdate: (v: number) => void, disabled = false) => {
			if (label) {
				const span = cameraRow.createSpan({ text: label, cls: 'sh-controls-label', attr: { style: 'font-size: 10px;' } });
				if (disabled) { span.style.opacity = '0.4'; }
			}
			const input = cameraRow.createEl('input', {
				type: 'number',
				attr: { value: value.toFixed(1), step: '1', style: 'width: 100%;' }
			});
			if (disabled) { input.disabled = true; input.style.opacity = '0.4'; }
			input.addEventListener('change', () => onUpdate(parseFloat(input.value)));
			this.cameraInputs.push(input);
			return input;
		};

		// θ′ is the yaw about the assembly's local up axis y′ and φ′ the pitch
		// about its local right axis x′ — the body-relative angles the rotation
		// controls modify. Home reads θ′ = 90, φ′ = 0 (docs sections 6.1, 6.3, 8).
		// These are 3D-only: a 2D canvas has no rotation, so the readout is
		// greyed out and the inputs disabled rather than hidden outright.
		addInput('θ (°)', state.azimuth, v => view?.setCameraState({ ...view.getCameraState(), azimuth: v }), !is3D);
		addInput('Φ (°)', state.elevation, v => view?.setCameraState({ ...view.getCameraState(), elevation: v }), !is3D);
		cameraRow.createDiv(); // Spacer

		// Focal point controls
		cameraControls.createDiv({ text: 'Focal point', cls: 'sh-settings-label', attr: { style: 'margin-top: 10px;' } });
		const focalRow = cameraControls.createDiv({ cls: 'sh-controls-row' });
		focalRow.style.display = 'grid';
		focalRow.style.gridTemplateColumns = 'auto 1fr 1fr 1fr';
		focalRow.style.gap = '5px';
		focalRow.style.alignItems = 'center';

		const addFocalInput = (label: string, value: number, onUpdate: (v: number) => void, disabled = false) => {
			if (label) {
				const span = focalRow.createSpan({ text: label, cls: 'sh-controls-label', attr: { style: 'font-size: 10px;' } });
				if (disabled) { span.style.opacity = '0.4'; }
			}
			const input = focalRow.createEl('input', {
				type: 'number',
				attr: { value: value.toFixed(1), step: '1', style: 'width: 100%;' }
			});
			if (disabled) { input.disabled = true; input.style.opacity = '0.4'; input.value = ''; }
			input.addEventListener('change', () => onUpdate(parseFloat(input.value)));
			this.focalInputs.push(input);
			return input;
		};

		const initialFocal = view ? view.getFocalPoint() : { x: 0, y: 0, z: 0 };
		addFocalInput('Focal', initialFocal.x, v => { if (view) { view.setFocalPoint(v, view.getFocalPoint().y); view.requestRedraw(); } });
		addFocalInput('', initialFocal.y, v => { if (view) { view.setFocalPoint(view.getFocalPoint().x, v); view.requestRedraw(); } });
		// z is 3D-only: greyed out, cleared and disabled in 2D.
		addFocalInput('', initialFocal.z, v => { if (view) { view.setFocalPoint(view.getFocalPoint().x, view.getFocalPoint().y, v); view.requestRedraw(); } }, !is3D);









		const helpHint = contentEl.createDiv({ cls: 'sh-controls-help-hint' });
		helpHint.setText("Press 'h' for help");

		// Edge Creation Settings
		const edgeSettings = contentEl.createDiv({ cls: 'sh-controls-edge-settings' });
		edgeSettings.createDiv({ text: 'Default Edge Settings (Alt+Drag):', cls: 'sh-settings-label' });
		
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
			window.setTimeout(() => searchInput.dispatchEvent(new Event('input')), 0);
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
				window.clearTimeout(previewTimer);
				previewTimer = null;
			}
		};

		const showPreview = (itemEl: HTMLElement, entry: SearchIndexEntry) => {
			if (previewTimer) {
				window.clearTimeout(previewTimer);
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
				if (previewTimer) window.clearTimeout(previewTimer);
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
			if (previewData.relDescs && previewData.relDescs.length > 0) {
				const relText = previewData.relDescs.map(desc => `• ${desc}`).join('\n');
				activePreview.createDiv({ cls: 'sh-preview-relationships', text: relText });
			}
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
					hidePreview();
					if (e.ctrlKey || e.metaKey) {
						// Deselect or toggle individual
						view.toggleCandidateNode(entry.path);
					} else {
						// Toggle immediately per pick
						view.toggleCandidateNode(entry.path);
						view.focusGraph();
						resultsContainer.style.display = 'none';
						resultsContainer.empty();
						// Clear search query to prevent re-triggering results
						searchInput.value = '';
						this.searchQuery = '';
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
		const headerRow = contentEl.createDiv({ cls: 'sh-hologram-header' });
		headerRow.createDiv({ text: 'E?', cls: 'sh-hologram-col-e' });
		headerRow.createDiv({ text: 'Visible Holograms', cls: 'sh-hologram-col-label' });
		const hologramList = contentEl.createDiv({ cls: 'sh-hologram-list' });
		let allTags: string[] = [];
		const activeView = this.app.workspace.getLeavesOfType('semantic-hologram-view')[0]?.view as any;
		const cwd = activeView?.currentCwd || '';
		const cache = (this.plugin.hologramService as any).cache; // Access private cache
		
		const visibleTags = new Set<string>();
		for (const [path, tags] of cache.entries()) {
			if (cwd === '' || path.startsWith(`${cwd}/`)) {
				for (const t of tags) visibleTags.add(t);
			}
		}
		allTags = Array.from(visibleTags).sort();

		// Filter out the root container folder name — it's not a hologram
		allTags = allTags.filter(t => t !== 'hologram');

		if (cwd !== '') {
			const folderName = cwd.split('/').pop();
			if (folderName && !allTags.includes(folderName)) {
				allTags.unshift(folderName);
			}
		}
		
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
		};

		contentEl.createDiv({ cls: 'sh-controls-hint', text: 'Click: select · Shift+click: range · Ctrl+click: toggle · Click panel background: clear' });

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
			// Emulsification status: only for children of CWD, only if they have their own children
			const isCwd = cwd !== '' && tag === cwd.split('/').pop();
			let isEmulsified = false;
			if (!isCwd) {
				const folder = this.app.vault.getAbstractFileByPath(`hologram/${tag}`);
				if (folder instanceof TFolder) {
					// Emulsified = has child folders that contain nodes (markdown files)
					isEmulsified = folder.children.some(c => {
						if (!(c instanceof TFolder)) return false;
						return c.children.some(f => f instanceof TFile && f.extension === 'md');
					});
				}
			}
			row.createDiv({ text: isEmulsified ? '✓' : '', cls: 'sh-hologram-col-e' });
			row.createSpan({ text: tag, cls: 'sh-hologram-label' });
			row.addEventListener('mouseenter', () => {
				this.requestHologramPeek(tag, false);
			});
			row.addEventListener('focus', (e) => {
				(e as Event).preventDefault?.();
				// Prevent browser scroll-on-focus snap; scroll position is preserved
				// by the container's scroll behavior settings.
				this.requestHologramPeek(tag, true);
			});
			row.addEventListener('click', (e) => {
				this.commitPeekOnClick();
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

		hologramList.addEventListener('mouseleave', () => {
			this.endHologramPeek();
		});
		hologramList.addEventListener('focusout', (e) => {
			const next = e.relatedTarget as Node | null;
			if (next && hologramList.contains(next)) return;
			this.endHologramPeek();
		});
		hologramList.addEventListener('keydown', (e) => {
			if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
			const rows = Array.from(hologramList.querySelectorAll<HTMLElement>('.sh-hologram-row'));
			const current = document.activeElement as HTMLElement | null;
			const idx = current ? rows.indexOf(current) : -1;
			const next = e.key === 'ArrowDown'
				? (idx < 0 ? 0 : Math.min(rows.length - 1, idx + 1))
				: (idx <= 0 ? 0 : idx - 1);
			const target = rows[next];
			if (!target) return;
			e.preventDefault();
			target.focus({ preventScroll: true });
			const tag = target.getAttribute('data-tag');
			if (tag) this.requestHologramPeek(tag, true);
		});
		// Clicking the panel background clears the hologram selection. The rows
		// exactly fill `.sh-hologram-list`, so a real background click lands on
		// `contentEl`, not on the list element. Ignore rows and interactive
		// controls so those keep working. Detach the previous handler first:
		// `render()` runs repeatedly and `contentEl` itself is never emptied.
		if (this.panelClickHandler) {
			contentEl.removeEventListener('click', this.panelClickHandler);
		}
		this.panelClickHandler = (e: MouseEvent) => {
			const scrollEl = contentEl.closest('.sh-controls') || contentEl;
			const savedScroll = (scrollEl as HTMLElement).scrollTop;
			const target = e.target as HTMLElement;
			if (target.closest('.sh-hologram-row, button, input, select, textarea, a, .sh-search-bar, .sh-search-results')) {
				return;
			}
			this.endHologramPeek();
			if (selected.size === 0) return;
			selected.clear();
			this.lastHologramIndex = -1;
			refreshRows();
			saveAndRefresh();
			// Restore scroll position to prevent snap to top
			requestAnimationFrame(() => {
				(scrollEl as HTMLElement).scrollTop = savedScroll;
			});
		};
		contentEl.addEventListener('click', this.panelClickHandler);

		const mode = this.plugin.settings.hologramMode;


		const modeRow = contentEl.createDiv({ cls: 'sh-controls-row' });
		modeRow.createSpan({ text: 'Mode', cls: 'sh-controls-label' });
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
		centerRow.createSpan({ text: 'Show indicators', cls: 'sh-controls-label' });
		const centerCheckbox = centerRow.createEl('input', { type: 'checkbox' });
		centerCheckbox.checked = this.plugin.settings.showRotationCenter;
		centerCheckbox.addEventListener('change', () => {
			void this.plugin.setShowRotationCenter(centerCheckbox.checked);
		});

		// --- diffraction highlight layers ---------------------------------------
		//
		// Five read-only projections of one scan. Shown as a table rather than five
		// loose checkboxes because `runScan` computes all five on every pass
		// regardless of which are enabled — the counts for a disabled layer are
		// already known, so hiding them behind a checkbox would be withholding
		// information we have. The count column is therefore always populated.
		contentEl.createEl('h4', { text: 'Diffraction layers', cls: 'sh-controls-heading' });

		const scanView = this.getView();
		const scanSettings = this.plugin.settings.scanLayers;
		const layerRows: Array<[keyof ScanLayerSettings, string, string, boolean]> = [
			['activation', 'Activation', 'raw charge field — a measurement, not a finding', true],
			['gaps', 'Gaps', 'lit notes with no edge between them — an absence', true],
			['resonance', 'Resonance', 'lit by the field but not linked to the source', true],
			['bridges', 'Bridges', 'notes holding two regions together — a fact', false],
			['discovered', 'Discovered', 'ranked resonance chains — the strongest reading', false],
		];

		// Injection source as a dropdown: the graph already knows every node, so
		// there is no reason to ask anyone to type a name we could have listed.
		const sourceRow = contentEl.createDiv({ cls: 'sh-controls-row' });
		sourceRow.createSpan({ text: 'Injection source', cls: 'sh-controls-label' });
		const sourceSelect = sourceRow.createEl('select', { cls: 'sh-controls-select' });
		sourceSelect.createEl('option', { value: '', text: 'none (structural pass)' });
		for (const node of scanView ? scanView.scanGraph().nodes : []) {
			sourceSelect.createEl('option', { value: node.path, text: node.label });
		}
		sourceSelect.value = this.plugin.settings.scanSource;
		sourceSelect.addEventListener('change', () => {
			void this.plugin.setScanSource(sourceSelect.value);
			this.refreshScanLegend();
		});

		const tableWrap = contentEl.createDiv({ cls: 'sh-scan-table' });
		const table = tableWrap.createEl('table', { cls: 'sh-scan-layers' });
		const thead = table.createEl('thead');
		const headRow = thead.createEl('tr');
		headRow.createEl('th', { text: 'Layer' });
		headRow.createEl('th', { text: 'On' });
		headRow.createEl('th', { text: 'Nodes' });
		const tbody = table.createEl('tbody');

		for (const [key, label, hint, needsSource] of layerRows) {
			const row = tbody.createEl('tr', { cls: 'sh-scan-layer-row' });
			row.dataset.layer = key;
			const nameCell = row.createEl('td', { cls: 'sh-scan-layer-name' });
			nameCell.createSpan({ text: label });
			nameCell.createEl('small', { text: hint });
			const onCell = row.createEl('td', { cls: 'sh-scan-layer-on' });
			const box = onCell.createEl('input', { type: 'checkbox' });
			box.checked = scanSettings[key];
			row.dataset.needsSource = String(needsSource);
			box.addEventListener('change', () => {
				void this.plugin.setScanLayer(key, box.checked);
				// Only the counts change — the checkbox is already in the right
				// state — so update those cells alone. Calling this.render() here
				// emptied the panel and reset its scroll position.
				this.refreshScanLegend();
			});
			row.createEl('td', { cls: 'sh-scan-layer-count', text: '—' });
		}

		contentEl.createDiv({ cls: 'sh-scan-legend' });
		this.refreshScanLegend();

		const depthRow = contentEl.createDiv({ cls: 'sh-controls-row' });
		depthRow.createSpan({ text: `Hover depth: ${this.plugin.settings.hoverDepth}`, cls: 'sh-controls-label' });
		const depthSlider = depthRow.createEl('input', {
			type: 'range',
			attr: { min: '0', max: '6', step: '1', value: String(this.plugin.settings.hoverDepth) },
		});
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
		levelRow.createSpan({ text: `Level: ${levelNames[this.plugin.settings.levelHighlight]}`, cls: 'sh-controls-label' });
		const levelSlider = levelRow.createEl('input', {
			cls: 'sh-level-slider',
			type: 'range',
			attr: { min: '0', max: '5', step: '1', value: String(this.plugin.settings.levelHighlight), dir: 'rtl' },
		});
		levelSlider.addEventListener('input', () => {
			const v = parseInt(levelSlider.value, 10);
			void this.plugin.setLevelHighlight(v);
			const label = levelRow.querySelector('.sh-controls-label');
			if (label) label.textContent = `Level: ${levelNames[v]}`;
		});

		// Opacity/Translucence Slider
		const opacityRow = contentEl.createDiv({ cls: 'sh-controls-row' });
		opacityRow.createSpan({ text: `Level Opacity: ${Math.round(this.plugin.settings.levelHighlightOpacity * 100)}%`, cls: 'sh-controls-label' });
		const opacitySlider = opacityRow.createEl('input', {
			type: 'range',
			attr: { min: '10', max: '90', step: '5', value: String(this.plugin.settings.levelHighlightOpacity * 100) },
		});
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
		
		faceOpacityRow.createSpan({ text: `Face Opacity: ${Math.round(this.plugin.settings.facesOpacity * 100)}%`, cls: 'sh-controls-label' });
		const faceOpacitySlider = faceOpacityRow.createEl('input', {
			type: 'range',
			attr: { min: '0', max: '100', step: '5', value: String(this.plugin.settings.facesOpacity * 100) },
		});
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
				? '3D mode — Shift+drag to rotate about the focal point, drag to pan, scroll to dolly. Nodes live in full 3D physics.'
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
			const view = this.getView();
			if (view) {
				if (view.isRecordingActive()) {
					view.stopRecording();
					gifBtn.setText('Record GIF');
				} else {
					void view.startRecording();
					gifBtn.setText('Stop Recording');
				}
			}
		});

		const gifMode = contentEl.createDiv({ cls: 'sh-controls-row' });
		gifMode.createSpan({ text: 'GIF Mode:', cls: 'sh-controls-label' });
		const gifSelect = gifMode.createEl('select', { cls: 'sh-controls-select' });
		gifSelect.createEl('option', { value: 'time', text: 'Fixed Time' });
		gifSelect.createEl('option', { value: 'continuous', text: 'Continuous' });
		// 'Full Rotation' is 3D-only; gate it behind is3D.
		const fullOption = gifSelect.createEl('option', { value: 'full', text: 'Full Rotation' });
		fullOption.disabled = !is3D;
		// In 2D 'full' is not a valid selection, so fall back to 'time' rather
		// than leaving the disabled option looking selected.
		const gifModeDefault = is3D
			? (this.plugin.settings.gifMode ?? 'full')
			: (this.plugin.settings.gifMode === 'full' || !this.plugin.settings.gifMode ? 'time' : this.plugin.settings.gifMode);
		gifSelect.value = gifModeDefault;
		if (!is3D && this.plugin.settings.gifMode === 'full') {
			this.plugin.settings.gifMode = 'time';
			void this.plugin.saveSettings();
		}
		gifSelect.addEventListener('change', () => {
			this.plugin.settings.gifMode = gifSelect.value as 'time' | 'full' | 'continuous';
			void this.plugin.saveSettings();
		});

		const gifDurationRow = contentEl.createDiv({ cls: 'sh-controls-row' });
		gifDurationRow.createSpan({ text: 'Duration (s):', cls: 'sh-controls-label' });
		const gifDurationInput = gifDurationRow.createEl('input', {
			type: 'number',
			attr: { value: String(this.plugin.settings.gifDuration ?? 10), min: '1', max: '60', step: '1', style: 'width: 100%;' }
		});
		gifDurationInput.addEventListener('change', () => {
			const v = parseFloat(gifDurationInput.value);
			if (Number.isFinite(v) && v > 0) {
				this.plugin.settings.gifDuration = v;
				void this.plugin.saveSettings();
			}
		});

		const footer = contentEl.createDiv({ cls: 'sh-controls-footer' });
		footer.createSpan({
			text: `${mode.toUpperCase()} · ${this.plugin.app.vault.getMarkdownFiles().length} notes`,
			cls: 'sh-controls-meta',
		});
	}
}
