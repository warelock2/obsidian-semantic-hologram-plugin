import { App, PluginSettingTab, Setting } from 'obsidian';
import type SemanticHologramPlugin from './main';

export type HologramMode = '2d' | '3d';

export interface SemanticHologramSettings {
	hologramMode: HologramMode;
}

export const DEFAULT_SETTINGS: SemanticHologramSettings = {
	hologramMode: '2d',
};

export class SemanticHologramSettingTab extends PluginSettingTab {
	plugin: SemanticHologramPlugin;

	constructor(app: App, plugin: SemanticHologramPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Semantic Hologram')
			.setDesc('Graph rendering and glossary configuration will appear here.');
	}
}