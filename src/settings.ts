import { App, Modal, Notice, PluginSettingTab, Setting } from 'obsidian';
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
}

export interface RelTypeEntry {
	id: string; // 'family/type'
	color: string;
	description?: string;
	enabled: boolean;
}

export interface SemanticHologramSettings {
	hologramMode: HologramMode;
	hologramTool: HologramTool;
	showRotationCenter: boolean;
	nodeTypes: NodeTypeEntry[];
	relTypes: RelTypeEntry[];
	edgeMinLength: number;
	edgeMaxLength: number;
	hoverDepth: number;
	maxDepth: number;
	depthBase: number;
	mcpEnabled: boolean;
	mcpWriteAccess: boolean;
	mcpKeyHash?: string;
	mcpKeyMasked?: string;
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
	showRotationCenter: true,
	edgeMinLength: 120,
	edgeMaxLength: 280,
	hoverDepth: 1,
	maxDepth: 1,
	depthBase: 0.55,
	mcpEnabled: false,
	mcpWriteAccess: false,
	nodeTypes: [
		{ id: 'concept', name: 'Concept', color: '#7C6FF6', description: 'A single concept or idea.', enabled: true },
		{ id: 'literature', name: 'Literature', color: '#4D9DE0', description: 'A note sourced from literature.', enabled: true },
		{ id: 'speculation', name: 'Speculation', color: '#F4A261', description: 'Hypothesis or speculative thought.', enabled: true },
		{ id: 'claim', name: 'Claim', color: '#E76F51', description: 'A claim that can be supported or contradicted.', enabled: true },
		{ id: 'quote', name: 'Quote', color: '#43AA8B', description: 'A quote with source material reference.', enabled: true },
	],
	relTypes: [
		{ id: 'logic/supports', color: '#4D9DE0', description: 'Provides support for the target.', enabled: true },
		{ id: 'logic/contradicts', color: '#E76F51', description: 'Contradicts the target.', enabled: true },
		{ id: 'structural/depends-on', color: '#43AA8B', description: 'Depends on the target.', enabled: true },
		{ id: 'related', color: '#C0C0C0', description: 'General relatedness.', enabled: true },
	],
};

export function validateHex(hex: string): boolean {
	return /^[0-9A-F]{6}$/.test(hex);
}

export function normalizeHex(input: string): string {
	return input.replace(/[^0-9A-Fa-f]/g, '').slice(0, 6).toUpperCase();
}

/** Build a reusable color control: a swatch palette + a hex text input. */
export function addColorControl(
	containerEl: HTMLElement,
	initial: string,
	onChange: (hex: string) => void,
): void {
	const wrap = containerEl.createDiv({ cls: 'sh-color-control' });

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
}

class EntryModal extends Modal {
	private result: { family?: string; type: string; name: string; description: string } | null = null;

	constructor(
		app: App,
		private kind: 'node' | 'rel',
		private onOk: (result: { family?: string; type: string; name: string; description: string }) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('sh-entry-modal');

		let family = '';
		let type = '';
		let name = '';
		let desc = '';

		contentEl.createEl('h4', { text: this.kind === 'node' ? 'Add node type' : 'Add relationship type' });

		if (this.kind === 'rel') {
			new Setting(contentEl)
				.setName('Family')
				.setDesc('e.g. logic, structural')
				.addText((t) => {
					t.inputEl.placeholder = 'logic';
					t.onChange((v) => (family = v.trim().toLowerCase()));
				});
			new Setting(contentEl)
				.setName('Type')
				.setDesc('e.g. supports')
				.addText((t) => {
					t.inputEl.placeholder = 'supports';
					t.onChange((v) => (type = v.trim().toLowerCase()));
				});
		} else {
			new Setting(contentEl)
				.setName('ID')
				.setDesc('kebab-case, e.g. concept')
				.addText((t) => {
					t.inputEl.placeholder = 'concept';
					t.onChange((v) => (name = v.trim().toLowerCase()));
				});
			new Setting(contentEl)
				.setName('Name')
				.setDesc('Display name, e.g. Concept')
				.addText((t) => {
					t.inputEl.placeholder = 'Concept';
					t.onChange((v) => (name = v.trim()));
				});
		}
		new Setting(contentEl)
			.setName('Description')
			.addText((t) => t.onChange((v) => (desc = v.trim())));

		new Setting(contentEl)
			.addButton((b) =>
				b.setButtonText('Cancel').onClick(() => {
					this.close();
				}),
			)
			.addButton((b) =>
				b.setButtonText('Add').setCta().onClick(() => {
					this.result = { family, type, name, description: desc };
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
			.setName('Depth visualization')
			.setDesc('Configure how depth affects node size and highlighting.')
			.setHeading();

		new Setting(containerEl)
			.setName('Max depth / connection level')
			.setDesc('How many connection levels away to highlight when hovering over a node.')
			.addSlider((s) =>
				s
					.setLimits(0, 5, 1)
					.setValue(this.plugin.settings.hoverDepth)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.hoverDepth = v;
						this.plugin.settings.maxDepth = v;
						await this.persist();
					}),
			);

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

		this.renderNodeGlossary(containerEl);
		this.renderRelGlossary(containerEl);
	}


	private renderNodeGlossary(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Node types').setDesc('Glossary of hologram node types.').setHeading();

		const listEl = containerEl.createDiv({ cls: 'sh-glossary-list' });
		this.plugin.settings.nodeTypes.forEach((nt, i) => {
			const row = listEl.createDiv({ cls: 'sh-glossary-row' });
			const info = row.createDiv({ cls: 'sh-glossary-info' });
			info.createDiv({ cls: 'sh-glossary-title' }).setText(nt.name || nt.id);
			if (nt.description) {
				info.createDiv({ cls: 'sh-glossary-desc' }).setText(nt.description);
			}
			const controls = row.createDiv({ cls: 'sh-glossary-controls' });
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
				this.plugin.settings.nodeTypes.splice(i, 1);
				void this.persist();
				this.display();
			});
		});

		const addRow = containerEl.createDiv({ cls: 'sh-glossary-add' });
		const addBtn = addRow.createEl('button', { text: 'Add node type', cls: 'mod-cta' });
		addBtn.addEventListener('click', () => {
			new EntryModal(this.app, 'node', (r) => {
				if (!r.name) {
					return;
				}
				this.plugin.settings.nodeTypes.push({
					id: r.name,
					name: r.type || r.name,
					color: PALETTE[0] ?? '#7C6FF6',
					description: r.description,
					enabled: true,
				});
				void this.persist();
				this.display();
			}).open();
		});
	}

	private renderRelGlossary(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Relationship types').setDesc('Glossary of relationship (edge) types.').setHeading();

		const listEl = containerEl.createDiv({ cls: 'sh-glossary-list' });
		this.plugin.settings.relTypes.forEach((rt, i) => {
			const row = listEl.createDiv({ cls: 'sh-glossary-row' });
			const info = row.createDiv({ cls: 'sh-glossary-info' });
			info.createDiv({ cls: 'sh-glossary-title' }).setText(rt.id);
			if (rt.description) {
				info.createDiv({ cls: 'sh-glossary-desc' }).setText(rt.description);
			}
			const controls = row.createDiv({ cls: 'sh-glossary-controls' });
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
				this.plugin.settings.relTypes.splice(i, 1);
				void this.persist();
				this.display();
			});
		});

		const addRow = containerEl.createDiv({ cls: 'sh-glossary-add' });
		const addBtn = addRow.createEl('button', { text: 'Add relationship type', cls: 'mod-cta' });
		addBtn.addEventListener('click', () => {
			new EntryModal(this.app, 'rel', (r) => {
				if (!r.family || !r.type) {
					return;
				}
				this.plugin.settings.relTypes.push({
					id: `${r.family}/${r.type}`,
					color: PALETTE[1] ?? '#4D9DE0',
					description: r.description,
					enabled: true,
				});
				void this.persist();
				this.display();
			}).open();
		});

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