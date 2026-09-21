import { App, Modal, Notice, PluginSettingTab, Setting, TextComponent } from 'obsidian';
import { migrateRelationship, restoreRelationship, migrateNodeType, restoreNodeType, renameRelationship, renameNodeType } from './migration';
import type SemanticHologramPlugin from './main';

export type HologramMode = '2d' | '3d';
export type HologramTool = 'navigate' | 'select' | 'rotate';

export const HOLOGRAM_FOLDER = 'hologram';

export interface NodeTypeEntry {
	id: string;
	name: string;
	color: string;
	description?: string;
	enabled: boolean;
	level?: number;
}

export interface RelTypeEntry {
	id: string; // 'family/type'
	color: string;
	description?: string;
	enabled: boolean;
}

export interface LevelEntry {
	id: string; // 'level-0'
	name: string; // 'Percept'
	level: number; // 0
}

export interface SemanticHologramSettings {
	hologramMode: HologramMode;
	hologramTool: HologramTool;
	hologramType: string; // 'Conceptual', 'Causal', 'Structural', 'Phenomenological'
	showRotationCenter: boolean;
	nodeTypes: NodeTypeEntry[];
	relTypes: RelTypeEntry[];
	levels: LevelEntry[];
	edgeMinLength: number;
	edgeMaxLength: number;
	hoverDepth: number;
	maxDepth: number;
	depthBase: number;
	levelHighlight: number;
	levelHighlightOpacity: number;
	mcpEnabled: boolean;
	mcpWriteAccess: boolean;
	mcpKeyHash?: string;
	mcpKeyMasked?: string;
	facesEnabled: boolean;
	facesOpacity: number;
	facesColor: string;
	defaultRelStrength: number;
	defaultConfidence: number;
	showGravitasColor: boolean;
	showConfidenceHalo: boolean;
	selectedHolograms: string[];
}

export const PALETTE = [
	'#7C6FF6',
	'#4D9DE0',
	'#277DA1',
	'#43AA8B',
	'#90BE6D',
	'#A98467',
	'#FFD166',
	'#F4A261',
	'#E76F51',
	'#F08080',
	'#FF595E',
	'#8AC926',
	'#577590',
	'#B5838D',
	'#E9C46A',
	'#6D6875',
];

export const DEFAULT_SETTINGS: SemanticHologramSettings = {
	hologramMode: '2d',
	hologramTool: 'navigate',
	hologramType: 'Conceptual',
	showRotationCenter: true,
	edgeMinLength: 120,
	edgeMaxLength: 280,
	hoverDepth: 1,
	maxDepth: 1,
	depthBase: 0.55,
	levelHighlight: 0,
	levelHighlightOpacity: 0.3,
	levels: [
		{ id: 'level-6', name: 'Field', level: 6 },
		{ id: 'level-5', name: 'Domain', level: 5 },
		{ id: 'level-4', name: 'Topic', level: 4 },
		{ id: 'level-3', name: 'Pattern', level: 3 },
		{ id: 'level-2', name: 'Idea', level: 2 },
		{ id: 'level-1', name: 'Concept', level: 1 },
		{ id: 'level-0', name: 'Percept', level: 0 },
	],
	mcpEnabled: false,
	mcpWriteAccess: false,
	facesEnabled: true,
	facesOpacity: 1.0,
	facesColor: '#277DA1',
	nodeTypes: [
		{ id: 'percept', name: 'Percept', color: '#B5838D', description: 'A base-level observed percept or raw data point (Level 0).', enabled: true, level: 0 },
		{ id: 'concept', name: 'Concept', color: '#7C6FF6', description: 'A single foundational concept.', enabled: true, level: 1 },
		{ id: 'idea', name: 'Idea', color: '#4D9DE0', description: 'An emerging idea or thought.', enabled: true, level: 2 },
		{ id: 'pattern', name: 'Pattern', color: '#F4A261', description: 'A recognized recurring pattern.', enabled: true, level: 3 },
		{ id: 'topic', name: 'Topic', color: '#43AA8B', description: 'A broader topical grouping.', enabled: true, level: 4 },
		{ id: 'domain', name: 'Domain', color: '#E76F51', description: 'A subject domain or field of study.', enabled: true, level: 5 },
		{ id: 'field', name: 'Field', color: '#90BE6D', description: 'A high-level academic or professional field.', enabled: true, level: 6 },
		{ id: 'source', name: 'Source', color: '#8AC926', description: 'A source document: book, paper, video, interview, article.', enabled: true, level: 0 },
	],
	relTypes: [
		{ id: 'logic/supports', color: '#4D9DE0', description: 'Provides support for the target.', enabled: true },
		{ id: 'logic/contradicts', color: '#E76F51', description: 'Contradicts the target.', enabled: true },
		{ id: 'structural/depends-on', color: '#43AA8B', description: 'Depends on the target.', enabled: true },
		{ id: 'structural/subsumed-by', color: '#9B5DE5', description: 'Lower-order concept is subsumed by higher-order concept.', enabled: true },
		{ id: 'related', color: '#C0C0C0', description: 'General relatedness.', enabled: true },
	],
	defaultRelStrength: 0.5,
	defaultConfidence: 0.5,
	showGravitasColor: true,
	showConfidenceHalo: true,
	selectedHolograms: [],
};

export function validateHex(hex: string): boolean {
	return /^[0-9A-F]{6}$/.test(hex);
}

export function normalizeHex(input: string): string {
	return input.replace(/[^0-9A-Fa-f]/g, '').slice(0, 6).toUpperCase();
}

/** Accepts a non-negative integer or float within [0.01, 1]. */
export function validateStrength(v: string): boolean {
	const trimmed = v.trim();
	if (!/^(?:\d+(?:\.\d+)?)$/.test(trimmed)) {
		return false;
	}
	const n = Number(trimmed);
	return Number.isFinite(n) && n >= 0.01 && n <= 1;
}

/** Build a reusable color control: a swatch palette + a hex text input. */
export function addColorControl(
	containerEl: HTMLElement,
	initial: string,
	onChange: (hex: string) => void,
	showDot: boolean = false,
): { update: (hex: string) => void } {
	const wrap = containerEl.createDiv({ cls: 'sh-color-control' });
	let dot: HTMLDivElement | undefined;
	if (showDot) {
		dot = wrap.createDiv({ cls: 'sh-glossary-color-dot' });
		dot.style.background = initial;
	}

	const inputWrap = wrap.createDiv({ cls: 'sh-color-input-wrap' });
	inputWrap.createSpan({ cls: 'sh-color-hash', text: '#' });
	const input = inputWrap.createEl('input', {
		type: 'text',
		cls: 'sh-color-input',
		attr: { maxlength: '6', spellcheck: 'false' },
	});
	const state = { active: normalizeHex(initial), invalid: false };

	const refresh = (): void => {
		if (!state.active) {
			return;
		}
		input.value = state.active;
		input.classList.remove('is-invalid');
		inputWrap.classList.remove('sh-has-invalid');
		state.invalid = false;
		if (dot) dot.style.background = `#${state.active}`;
		onChange(state.active);
	};

	input.addEventListener('input', () => {
		const norm = normalizeHex(input.value);
		input.value = norm;
		if (validateHex(norm)) {
			state.active = norm;
			state.invalid = false;
			input.classList.remove('is-invalid');
			inputWrap.classList.remove('sh-has-invalid');
			if (dot) dot.style.background = `#${norm}`;
			onChange(norm);
		} else {
			state.invalid = true;
			input.classList.add('is-invalid');
			inputWrap.classList.add('sh-has-invalid');
		}
	});

	const pal = wrap.createDiv({ cls: 'sh-color-palette' });
	for (const color of PALETTE) {
		const swatch = pal.createDiv({ cls: 'sh-color-swatch' });
		swatch.style.background = color;
		swatch.addEventListener('click', () => {
			state.active = normalizeHex(color);
			refresh();
		});
	}

	state.active = normalizeHex(initial);
	refresh();
	return { update: (hex: string) => { state.active = normalizeHex(hex); refresh(); } };
}

class EntryModal extends Modal {
	private result: { id: string; name: string; description: string; family?: string; type?: string } | null = null;

	constructor(
		app: App,
		private kind: 'node' | 'rel',
		private onOk: (result: { id: string; name: string; description: string; family?: string; type?: string }) => void,
		private initialValue?: { id: string; name: string; description: string; family?: string; type?: string },
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('sh-entry-modal');

		let id = this.initialValue?.id ?? '';
		let name = this.initialValue?.name ?? '';
		let desc = this.initialValue?.description ?? '';
		let family = this.initialValue?.family ?? '';

		contentEl.createEl('h4', {
			text: this.initialValue
				? (this.kind === 'node' ? 'Edit node type' : 'Edit relationship type')
				: (this.kind === 'node' ? 'Add node type' : 'Add relationship type'),
		});

		if (this.kind === 'rel') {
			new Setting(contentEl)
				.setName('Family')
				.setDesc('e.g. logic, structural')
				.addText((t) => {
					t.setValue(family);
					t.inputEl.placeholder = 'logic';
					t.onChange((v) => (family = v.trim().toLowerCase()));
				});
			new Setting(contentEl)
				.setName('Type')
				.setDesc('e.g. supports')
				.addText((t) => {
					t.setValue(id);
					t.inputEl.placeholder = 'supports';
					t.onChange((v) => (id = v.trim().toLowerCase()));
				});
		} else {
			new Setting(contentEl)
				.setName('ID')
				.setDesc('kebab-case, e.g. concept')
				.addText((t) => {
					t.setValue(id);
					t.inputEl.placeholder = 'concept';
					t.onChange((v) => (id = v.trim().toLowerCase()));
				});
			new Setting(contentEl)
				.setName('Name')
				.setDesc('Display name, e.g. Concept')
				.addText((t) => {
					t.setValue(name);
					t.inputEl.placeholder = 'Concept';
					t.onChange((v) => (name = v.trim()));
				});
		}
		new Setting(contentEl)
			.setName('Description')
			.addText((t) => {
				t.setValue(desc);
				t.onChange((v) => (desc = v.trim()));
			});

		new Setting(contentEl)
			.addButton((b) =>
				b.setButtonText('Cancel').onClick(() => {
					this.close();
				}),
			)
			.addButton((b) =>
				b.setButtonText(this.initialValue ? 'Save' : 'Add').setCta().onClick(() => {
					this.result = { id, name: name || id, description: desc, family, type: id };
					this.close();
				}),
			);
	}

	onClose(): void {
		if (this.result) {
			this.onOk(this.result);
		}
		this.contentEl.empty();
	}
}

class ConfirmModal extends Modal {
	constructor(
		app: App,
		private options: {
			title: string;
			message: string;
			onConfirm: () => void;
			onCancel?: () => void;
		},
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('sh-confirm-modal');

		contentEl.createEl('h4', { text: this.options.title });
		contentEl.createEl('p', { text: this.options.message });

		new Setting(contentEl)
			.addButton((b) =>
				b.setButtonText('Cancel').onClick(() => {
					if (this.options.onCancel) {
						this.options.onCancel();
					}
					this.close();
				}),
			)
			.addButton((b) =>
				b.setButtonText('Yes')
					.setWarning()
					.onClick(() => {
						this.options.onConfirm();
						this.close();
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
		if (this.options.onCancel) {
			// If closed via ESC or outside click without clicking Cancel button
			// Wait, onClose is called for any close. Let's just handle it in Cancel button.
		}
	}
}

export class SemanticHologramSettingTab extends PluginSettingTab {
	plugin: SemanticHologramPlugin;

	constructor(app: App, plugin: SemanticHologramPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private async persist(): Promise<void> {
		await this.plugin.saveSettings();
		await this.plugin.refreshGraphs();
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Graph & relationships')
			.setDesc('Hologram node creation, relationship editing and graph glossary configuration.')
			.setHeading();

		const edgeRow = new Setting(containerEl).setName('Edge length range').setDesc(
			'Edges range between these lengths (world units) according to the average relationship strength. Stronger = shorter.',
		);
		edgeRow.addSlider((s) =>
			s
				.setLimits(40, 400, 10)
				.setValue(this.plugin.settings.edgeMinLength)
				.setDynamicTooltip()
				.onChange(async (v) => {
					this.plugin.settings.edgeMinLength = v;
					await this.persist();
					s.setValue(v);
				}),
		);
		edgeRow.addSlider((s) =>
			s
				.setLimits(120, 800, 10)
				.setValue(this.plugin.settings.edgeMaxLength)
				.setDynamicTooltip()
				.onChange(async (v) => {
					this.plugin.settings.edgeMaxLength = Math.max(v, this.plugin.settings.edgeMinLength);
					await this.persist();
					s.setValue(v);
				}),
		);

		new Setting(containerEl)
			.setName('Confidence & gravitas')
			.setDesc('How each node\'s confidence is shown on the graph. Colors range from red (0) to yellow (0.5) to green (1).')
			.setHeading();

		new Setting(containerEl)
			.setName('Show Gravitas as a node color')
			.setDesc('Fill each node with the confidence spectrum: red (confidence 0) → yellow (0.5) → green (1). Nodes without a confidence frontmatter value use the default confidence.')
			.addToggle((t) =>
				t.setValue(this.plugin.settings.showGravitasColor).onChange(async (v) => {
					this.plugin.settings.showGravitasColor = v;
					await this.persist();
				}),
			);

		new Setting(containerEl)
			.setName('Show confidence level as a node halo')
			.setDesc('Draw a colored ring around each node matching its confidence level using the same red → yellow → green spectrum.')
			.addToggle((t) =>
				t.setValue(this.plugin.settings.showConfidenceHalo).onChange(async (v) => {
					this.plugin.settings.showConfidenceHalo = v;
					await this.persist();
				}),
			);

		new Setting(containerEl)
			.setName('Default confidence')
			.setDesc('Confidence used for nodes that do not have a confidence frontmatter value. Range 0 (red) to 1 (green).')
			.addSlider((s) =>
				s
					.setLimits(0, 1, 0.01)
					.setValue(this.plugin.settings.defaultConfidence)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.defaultConfidence = v;
						await this.persist();
					}),
			);

		new Setting(containerEl)
			.setName('Depth visualization')
			.setDesc('Configure how depth affects node size and highlighting.')
			.setHeading();

		new Setting(containerEl)
			.setName('Max depth / connection level')
			.setDesc('How many connection levels away to highlight when hovering over a node.')
			.addSlider((s) =>
				s
					.setLimits(0, 6, 1)
					.setValue(this.plugin.settings.hoverDepth)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.hoverDepth = v;
						this.plugin.settings.maxDepth = v;
						await this.persist();
					}),
			);

		new Setting(containerEl)
			.setName('Wireframe Faces')
			.setDesc('Configure color for 3D polygon faces.')
			.setHeading();

		const facesColorSetting = new Setting(containerEl)
			.setName('Faces color')
			.setDesc('The fill color for 3D wireframe faces.');
		
		const facesColorContainer = facesColorSetting.controlEl.createDiv();

		addColorControl(facesColorContainer, this.plugin.settings.facesColor, (hex) => {
			this.plugin.settings.facesColor = `#${hex}`;
			void this.persist();
		}, true);

		new Setting(containerEl)
			.setName('Plugin MCP Authentication')
			.setDesc('Generate an authentication token for local plugin MCP access. Keys are only shown once upon generation. This plugin uses a standard `stdio` MCP server (no network URL or HTTP endpoint).\n\nBenefits & Capabilities when enabled:\n• List, read, create, & update hologram notes\n• Query graph node neighbors & filter notes by type\n• Inspect graph state dumps programmatically')
			.setHeading();

		new Setting(containerEl)
			.setName('Enable MCP Service')
			.setDesc('Enable or disable the local MCP server.')
			.addToggle((t) =>
				t.setValue(this.plugin.settings.mcpEnabled).onChange(async (v) => {
					this.plugin.settings.mcpEnabled = v;
					await this.persist();
					this.display(); // Refresh to update greyed-out state
				}),
			);

		new Setting(containerEl)
			.setName('Enable Write Access')
			.setDesc('Allow MCP tools to create/update hologram notes (read-only by default).')
			.setDisabled(!this.plugin.settings.mcpEnabled)
			.addToggle((t) =>
				t.setValue(this.plugin.settings.mcpWriteAccess).onChange(async (v) => {
					this.plugin.settings.mcpWriteAccess = v;
					await this.persist();
					this.display(); // Refresh to update greyed-out state
				}),
			);

		let generatedKeyCache = '';
		const initialDesc = this.plugin.settings.mcpKeyMasked 
			? `Key (obscured): ${this.plugin.settings.mcpKeyMasked} (Status: ${this.plugin.settings.mcpEnabled ? 'Enabled' : 'Disabled'})` 
			: (this.plugin.settings.mcpKeyHash ? 'Key configured (hash stored).' : 'No active key generated.');

		const mcpSetting = new Setting(containerEl)
			.setName('MCP Key')
			.setDesc(initialDesc);

		mcpSetting.addButton((b) =>
			b.setButtonText('Generate Key').setCta().onClick(async () => {
				const arr = new Uint8Array(24);
				window.crypto.getRandomValues(arr);
				const newKey = 'sh_' + Array.from(arr, byte => byte.toString(16).padStart(2, '0')).join('');
				
				// Generate hash
				const encoder = new TextEncoder();
				const data = encoder.encode(newKey);
				const hashBuffer = await crypto.subtle.digest('SHA-256', data);
				const hashArray = Array.from(new Uint8Array(hashBuffer));
				const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
				
				const masked = newKey.slice(0, 6) + '••••••••••••••••' + newKey.slice(-4);
				
				this.plugin.settings.mcpKeyHash = hashHex;
				this.plugin.settings.mcpKeyMasked = masked;
				await this.persist();
				
				generatedKeyCache = newKey;
				mcpSetting.setDesc(`Generated: ${newKey} (Copy it now, it will obscure after copying!)`);
			}),
		);

		mcpSetting.addButton((b) =>
			b.setButtonText('Copy to Clipboard').onClick(async () => {
				if (!generatedKeyCache) {
					new Notice('No MCP key generated yet.');
					return;
				}
				await navigator.clipboard.writeText(generatedKeyCache);
				new Notice('MCP key copied to clipboard.');
				const masked = generatedKeyCache.slice(0, 6) + '••••••••••••••••' + generatedKeyCache.slice(-4);
				mcpSetting.setDesc(`Key (obscured): ${masked}`);
			}),
		);

		this.renderLevelsGlossary(containerEl);
		this.renderNodeGlossary(containerEl);
		this.renderRelGlossary(containerEl);
	}

	private renderLevelsGlossary(containerEl: HTMLElement): void {
		const head = new Setting(containerEl).setName('DAG (Directed Acyclic Graph) Hierarchy Levels').setDesc('Configure levels starting from Level 0 (Percept) at the bottom. Level 0 nodes cannot function as groups.').setHeading();
		head.addButton(b => b.setButtonText('Add Level').onClick(() => {
			const maxLevel = Math.max(...this.plugin.settings.levels.map(l => l.level));
			const newLevel = maxLevel + 1;
			this.plugin.settings.levels.unshift({ id: `level-${newLevel}`, name: 'New Level', level: newLevel });
			void this.persist();
			this.display();
		}));

		const headerRow = containerEl.createDiv({ cls: 'sh-glossary-row sh-glossary-header' });
		headerRow.createDiv({ cls: 'sh-glossary-level' }).createEl('b', { text: '#' });
		headerRow.createDiv({ cls: 'sh-glossary-info' }).createEl('b', { text: 'Title' });

		const listEl = containerEl.createDiv({ cls: 'sh-glossary-list' });
		// display in order of level (descending in list)
		const sortedLevels = [...this.plugin.settings.levels].sort((a, b) => b.level - a.level);
		
		sortedLevels.forEach((lvl) => {
			const row = listEl.createDiv({ cls: 'sh-glossary-row' });
			row.createDiv({ cls: 'sh-glossary-level' }).setText(String(lvl.level));
			const info = row.createDiv({ cls: 'sh-glossary-info' });
			
			const input = info.createEl('input', { type: 'text', value: lvl.name, cls: 'sh-glossary-title' });
			input.addEventListener('change', () => {
				lvl.name = input.value;
				void this.persist();
			});
		});
	}


	private renderNodeGlossary(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Node types').setDesc('Glossary of hologram node types. Note: Level 0 nodes cannot function as groups.').setHeading();

		const headerRow = containerEl.createDiv({ cls: 'sh-glossary-row sh-glossary-header' });
		const levelHead = headerRow.createDiv({ cls: 'sh-glossary-level' });
		levelHead.style.textAlign = 'center';
		levelHead.createEl('b', { text: 'Level #' });
		headerRow.createDiv({ cls: 'sh-glossary-move' }); // Spacer
		headerRow.createDiv({ cls: 'sh-glossary-info' }).createEl('b', { text: 'Title' });

		const listEl = containerEl.createDiv({ cls: 'sh-glossary-list' });
		this.plugin.settings.nodeTypes.forEach((nt, i) => {
			const row = listEl.createDiv({ cls: 'sh-glossary-row' });
			
			const levelDiv = row.createDiv({ cls: 'sh-glossary-level' });
			levelDiv.style.textAlign = 'center';
			const levelInput = levelDiv.createEl('input', { type: 'number', value: nt.level !== undefined ? String(nt.level) : '', cls: 'sh-glossary-level-input' });
			levelInput.style.width = '45px';
			levelInput.addEventListener('change', () => {
				const val = levelInput.value;
				nt.level = val !== '' ? parseInt(val) : undefined;
				void this.persist();
			});

			const move = row.createDiv({ cls: 'sh-glossary-move' });
			const up = move.createEl('button', { text: '▲', cls: 'sh-glossary-up' });
			up.addEventListener('click', () => {
				if (i > 0) {
					[this.plugin.settings.nodeTypes[i], this.plugin.settings.nodeTypes[i - 1]] = [
						this.plugin.settings.nodeTypes[i - 1]!,
						this.plugin.settings.nodeTypes[i]!,
					];
					void this.persist();
					this.display();
				}
			});
			const down = move.createEl('button', { text: '▼', cls: 'sh-glossary-down' });
			down.addEventListener('click', () => {
				if (i < this.plugin.settings.nodeTypes.length - 1) {
					[this.plugin.settings.nodeTypes[i], this.plugin.settings.nodeTypes[i + 1]] = [
						this.plugin.settings.nodeTypes[i + 1]!,
						this.plugin.settings.nodeTypes[i]!,
					];
					void this.persist();
					this.display();
				}
			});
			const info = row.createDiv({ cls: 'sh-glossary-info' });
			info.createDiv({ cls: 'sh-glossary-title' }).setText(nt.name || nt.id);
			if (nt.description) {
				info.createDiv({ cls: 'sh-glossary-desc' }).setText(nt.description);
			}
			const controls = row.createDiv({ cls: 'sh-glossary-controls' });

			const edit = controls.createEl('button', {
				cls: 'sh-glossary-edit',
				attr: { 'aria-label': 'Edit' },
			});
			edit.setText('✎');
			edit.addEventListener('click', () => {
				new EntryModal(
					this.app,
					'node',
					(r) => {
						if (!r.id) return;
						const newId = r.id;
						const newName = r.name || newId;
						const oldId = nt.id;
						if (newId !== oldId && this.plugin.settings.nodeTypes.some((t) => t.id === newId)) {
							new Notice(`Node type "${newId}" already exists.`);
							return;
						}
						this.plugin.settings.nodeTypes[i] = {
							...this.plugin.settings.nodeTypes[i]!,
							id: newId,
							name: newName,
							description: r.description,
						};
						const migration = newId !== oldId
							? renameNodeType(this.app, oldId, newId)
							: Promise.resolve();
						void migration.then(() => {
							void this.persist();
							this.display();
						});
					},
					{ id: nt.id, name: nt.name, description: nt.description ?? '' },
				).open();
			});

			const dot = controls.createDiv({ cls: 'sh-glossary-color-dot' });
			dot.style.background = nt.color;
			addColorControl(controls, nt.color, (hex) => {
				nt.color = `#${hex}`;
				dot.style.background = nt.color;
				void this.persist();
			});
			
			const toggle = controls.createEl('button', {
				cls: 'sh-glossary-toggle',
				attr: { 'aria-label': nt.enabled ? 'Disable' : 'Enable' },
			});
			toggle.setText(nt.enabled ? 'On' : 'Off');
			toggle.addClass(nt.enabled ? 'is-on' : 'is-off');
			toggle.addEventListener('click', () => {
				nt.enabled = !nt.enabled;
				toggle.setText(nt.enabled ? 'On' : 'Off');
				toggle.toggleClass('is-on', nt.enabled);
				toggle.toggleClass('is-off', !nt.enabled);
				void this.persist();
			});
			
			const del = controls.createEl('button', {
				cls: 'sh-glossary-del',
				attr: { 'aria-label': 'Delete' },
			});
			del.setText('✕');
			del.addEventListener('click', () => {
				const availableNodes = this.plugin.settings.nodeTypes.map((t) => t.id);
				new DeleteNodeTypeModal(this.app, nt.id, availableNodes, (action, replacement) => {
					void migrateNodeType(this.app, nt.id, action, replacement).then(() => {
						this.plugin.settings.nodeTypes.splice(i, 1);
						void this.persist();
						this.display();
					});
				}).open();
			});
		});

		const addRow = containerEl.createDiv({ cls: 'sh-glossary-add' });
		const addBtn = addRow.createEl('button', { text: 'Add node type', cls: 'mod-cta' });
		addBtn.addEventListener('click', () => {
			new EntryModal(this.app, 'node', (r) => {
				if (!r.id) {
					return;
				}
				const id = r.id;
				const name = r.name || id;
				if (this.plugin.settings.nodeTypes.some((t) => t.id === id)) {
					new Notice(`Node type "${id}" already exists.`);
					return;
				}
				this.plugin.settings.nodeTypes.push({
					id,
					name,
					color: PALETTE[0] ?? '#7C6FF6',
					description: r.description,
					enabled: true,
					level: undefined,
				});
				void restoreNodeType(this.app, id).then(() => {
					void this.persist();
					this.display();
				});
			}).open();
		});
	}

	private renderRelGlossary(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Relationship types').setDesc('Glossary of relationship (edge) types.').setHeading();

		let defInput!: TextComponent;
		new Setting(containerEl)
			.setName('Default relationship strength')
			.setDesc('Used whenever a relationship is created or repaired without an explicit strength: auto-added related edges, group-membership edges with no confidence, import re-qualification, review defaults, and audit fixes.')
			.addText((t) => {
				defInput = t;
				t.inputEl.classList.add('sh-strength-input');
				t.inputEl.setAttr('type', 'number');
				t.inputEl.setAttr('min', '0.01');
				t.inputEl.setAttr('max', '1');
				t.inputEl.setAttr('step', '0.01');
				t.setValue(String(this.plugin.settings.defaultRelStrength));
				t.onChange(async (v) => {
					if (!validateStrength(v)) {
						t.inputEl.classList.add('is-invalid');
						t.inputEl.parentElement?.classList.add('sh-has-invalid');
						return;
					}
					t.inputEl.classList.remove('is-invalid');
					t.inputEl.parentElement?.classList.remove('sh-has-invalid');
					this.plugin.settings.defaultRelStrength = Number(v.trim());
					await this.persist();
				});
			});
		defInput.inputEl.addEventListener('blur', () => {
			if (!validateStrength(defInput.getValue())) {
				defInput.setValue(String(this.plugin.settings.defaultRelStrength));
				defInput.inputEl.classList.remove('is-invalid');
				defInput.inputEl.parentElement?.classList.remove('sh-has-invalid');
			}
		});

		const listEl = containerEl.createDiv({ cls: 'sh-glossary-list' });
		this.plugin.settings.relTypes.forEach((rt, i) => {
			const row = listEl.createDiv({ cls: 'sh-glossary-row' });
			const move = row.createDiv({ cls: 'sh-glossary-move' });
			const up = move.createEl('button', { text: '▲', cls: 'sh-glossary-up' });
			up.addEventListener('click', () => {
				if (i > 0) {
					[this.plugin.settings.relTypes[i], this.plugin.settings.relTypes[i - 1]] = [
						this.plugin.settings.relTypes[i - 1]!,
						this.plugin.settings.relTypes[i]!,
					];
					void this.persist();
					this.display();
				}
			});
			const down = move.createEl('button', { text: '▼', cls: 'sh-glossary-down' });
			down.addEventListener('click', () => {
				if (i < this.plugin.settings.relTypes.length - 1) {
					[this.plugin.settings.relTypes[i], this.plugin.settings.relTypes[i + 1]] = [
						this.plugin.settings.relTypes[i + 1]!,
						this.plugin.settings.relTypes[i]!,
					];
					void this.persist();
					this.display();
				}
			});
			const info = row.createDiv({ cls: 'sh-glossary-info' });
			info.createDiv({ cls: 'sh-glossary-title' }).setText(rt.id);
			if (rt.description) {
				info.createDiv({ cls: 'sh-glossary-desc' }).setText(rt.description);
			}
			const controls = row.createDiv({ cls: 'sh-glossary-controls' });
			
			const edit = controls.createEl('button', {
				cls: 'sh-glossary-edit',
				attr: { 'aria-label': 'Edit' },
			});
			edit.setText('✎');
			edit.addEventListener('click', () => {
				const [family = '', type = ''] = rt.id.split('/');
				new EntryModal(
					this.app,
					'rel',
					(r) => {
						if (!r.family || !r.type) return;
						const oldId = rt.id;
						const newId = `${r.family}/${r.type}`;
						if (newId !== oldId && this.plugin.settings.relTypes.some((t) => t.id === newId)) {
							new Notice(`Relationship type "${newId}" already exists.`);
							return;
						}
						this.plugin.settings.relTypes[i] = {
							...this.plugin.settings.relTypes[i]!,
							id: newId,
							description: r.description ?? '',
						};
						const migration = newId !== oldId
							? renameRelationship(this.app, oldId, newId)
							: Promise.resolve();
						void migration.then(() => {
							void this.persist();
							this.display();
						});
					},
					{ id: type, name: '', description: rt.description ?? '', family, type },
				).open();
			});

			const dot = controls.createDiv({ cls: 'sh-glossary-color-dot' });
			dot.style.background = rt.color;
			addColorControl(controls, rt.color, (hex) => {
				rt.color = `#${hex}`;
				dot.style.background = rt.color;
				void this.persist();
			});
			const toggle = controls.createEl('button', {
				cls: 'sh-glossary-toggle',
				attr: { 'aria-label': rt.enabled ? 'Disable' : 'Enable' },
			});
			toggle.setText(rt.enabled ? 'On' : 'Off');
			toggle.addClass(rt.enabled ? 'is-on' : 'is-off');
			toggle.addEventListener('click', () => {
				rt.enabled = !rt.enabled;
				toggle.setText(rt.enabled ? 'On' : 'Off');
				toggle.toggleClass('is-on', rt.enabled);
				toggle.toggleClass('is-off', !rt.enabled);
				void this.persist();
			});
			const del = controls.createEl('button', {
				cls: 'sh-glossary-del',
				attr: { 'aria-label': 'Delete' },
			});
			del.setText('✕');
			del.addEventListener('click', () => {
				const availableRels = this.plugin.settings.relTypes.map((t) => t.id);
				new DeleteRelationshipModal(this.app, rt.id, availableRels, (action, replacement) => {
					void migrateRelationship(this.app, rt.id, action, replacement).then(() => {
						this.plugin.settings.relTypes.splice(i, 1);
						void this.persist();
						this.display();
					});
				}).open();
			});
		});

		const addRow = containerEl.createDiv({ cls: 'sh-glossary-add' });
		const addBtn = addRow.createEl('button', { text: 'Add relationship type', cls: 'mod-cta' });
		addBtn.addEventListener('click', () => {
			new EntryModal(this.app, 'rel', (r) => {
				if (!r.family || !r.type) {
					return;
				}
				const id = `${r.family}/${r.type}`;
				this.plugin.settings.relTypes.push({
					id,
					color: PALETTE[1] ?? '#4D9DE0',
					description: r.description,
					enabled: true,
				});
				void restoreRelationship(this.app, id).then(() => {
					void this.persist();
					this.display();
				});
			}).open();
		});

		new Setting(containerEl)
			.setName('Reset Node Types')
			.setDesc('Revert only node types to factory defaults.')
			.addButton((b) =>
				b.setButtonText('Reset node types')
					.setWarning()
					.onClick(() => {
						new ConfirmModal(this.app, {
							title: 'Are you sure?',
							message: 'Node types will revert to defaults.',
							onConfirm: () => {
								this.plugin.settings.nodeTypes = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.nodeTypes));
								void this.persist().then(() => this.display());
							},
						}).open();
					}),
			);

		new Setting(containerEl)
			.setName('Reset Relationship Types')
			.setDesc('Revert only relationship types to factory defaults.')
			.addButton((b) =>
				b.setButtonText('Reset relationship types')
					.setWarning()
					.onClick(() => {
						new ConfirmModal(this.app, {
							title: 'Are you sure?',
							message: 'Relationship types will revert to defaults.',
							onConfirm: () => {
								this.plugin.settings.relTypes = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.relTypes));
								void this.persist().then(() => this.display());
							},
						}).open();
					}),
			);

		new Setting(containerEl)
			.setName('Reset settings')
			.setDesc('Revert all settings to factory defaults.')
			.addButton((b) =>
				b.setButtonText('Reset to factory defaults')
					.setWarning()
					.onClick(() => {
						new ConfirmModal(this.app, {
							title: 'Are you sure?',
							message: 'All settings will revert to defaults.',
							onConfirm: () => {
								this.plugin.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
								void this.persist().then(() => this.display());
							},
						}).open();
					}),
			);
	}
}
class DeleteRelationshipModal extends Modal {
	private selectedRel: string;

	constructor(
		app: App,
		private relId: string,
		private availableRels: string[],
		private onConfirm: (action: 'keep' | 'replace' | 'remove', replacement?: string) => void,
	) {
		super(app);
		this.selectedRel = availableRels.filter(r => r !== relId)[0] || 'related';
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('sh-confirm-modal');

		contentEl.createEl('h4', { text: 'Delete ' + this.relId + '?' });
		contentEl.createEl('p', { text: 'What should happen to existing relationship instances of this type in your notes?' });
		contentEl.createEl('p', { cls: 'sh-modal-note', text: 'NOTE: Relationships marked as "DEFUNCT" in notes can be reverted by creating the matching relationship type again.' });

		const otherRels = this.availableRels.filter(r => r !== this.relId);

		if (otherRels.length > 0) {
			new Setting(contentEl)
				.setName('Replacement')
				.setDesc('Choose a relationship type to replace instances with')
				.addDropdown((d) => {
					for (const rel of otherRels) {
						d.addOption(rel, rel);
					}
					d.setValue(this.selectedRel);
					d.onChange((v) => (this.selectedRel = v));
				});
		}

		const buttons = new Setting(contentEl)
			.addButton((b) => b.setButtonText('Cancel').onClick(() => { this.close(); }));
		
		if (otherRels.length > 0) {
			buttons.addButton((b) => b.setButtonText('Replace').onClick(() => { this.onConfirm('replace', this.selectedRel); this.close(); }));
		}
			
		buttons.addButton((b) => b.setButtonText('Mark as defunct').onClick(() => { this.onConfirm('keep'); this.close(); }))
			.addButton((b) => b.setButtonText('Delete from notes').setWarning().onClick(() => { this.onConfirm('remove'); this.close(); }));
	}
}

class DeleteNodeTypeModal extends Modal {
	private selectedNode: string;

	constructor(
		app: App,
		private nodeId: string,
		private availableNodes: string[],
		private onConfirm: (action: 'keep' | 'replace' | 'remove', replacement?: string) => void,
	) {
		super(app);
		this.selectedNode = availableNodes.filter(r => r !== nodeId)[0] || '';
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('sh-confirm-modal');

		contentEl.createEl('h4', { text: 'Delete ' + this.nodeId + '?' });
		contentEl.createEl('p', { text: 'What should happen to existing notes using this node type?' });
		contentEl.createEl('p', { cls: 'sh-modal-note', text: 'NOTE: Node types marked as "DEFUNCT" in notes can be reverted by creating the matching node type again.' });

		const otherNodes = this.availableNodes.filter(r => r !== this.nodeId);

		if (otherNodes.length > 0) {
			new Setting(contentEl)
				.setName('Replacement')
				.setDesc('Choose a node type to replace with')
				.addDropdown((d) => {
					for (const node of otherNodes) {
						d.addOption(node, node);
					}
					d.setValue(this.selectedNode);
					d.onChange((v) => (this.selectedNode = v));
				});
		}

		const buttons = new Setting(contentEl)
			.addButton((b) => b.setButtonText('Cancel').onClick(() => { this.close(); }));
		
		if (otherNodes.length > 0) {
			buttons.addButton((b) => b.setButtonText('Replace').onClick(() => { this.onConfirm('replace', this.selectedNode); this.close(); }));
		}
			
		buttons.addButton((b) => b.setButtonText('Mark as defunct').onClick(() => { this.onConfirm('keep'); this.close(); }))
			.addButton((b) => b.setButtonText('Delete from notes').setWarning().onClick(() => { this.onConfirm('remove'); this.close(); }));
	}
}
