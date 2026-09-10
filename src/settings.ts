import { App, Modal, PluginSettingTab, Setting } from 'obsidian';
import type SemanticHologramPlugin from './main';

export type HologramMode = '2d' | '3d';
export type HologramTool = 'navigate' | 'select' | 'rotate';

export const HOLOGRAM_FOLDER = 'Holograms';

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
			addColorControl(controls, nt.color, (hex) => {
				nt.color = `#${hex}`;
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
			addColorControl(controls, rt.color, (hex) => {
				rt.color = `#${hex}`;
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
	}
}