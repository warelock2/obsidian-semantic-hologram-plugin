import { App, Modal, Notice, Setting, TFile, TFolder } from 'obsidian';
import type SemanticHologramPlugin from './main';
import { HOLOGRAM_FOLDER, defaultNodeType } from './settings';
import { ensureHologramContent } from './importNote';

export class IncomingImportModal extends Modal {
	private plugin: SemanticHologramPlugin;
	private selectedFiles: Set<TFile> = new Set();
	private targetChoice: 'thoughts' | 'new' = 'thoughts';
	private newHologramName: string = '';

	constructor(app: App, plugin: SemanticHologramPlugin) {
		super(app);
		this.plugin = plugin;
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Import incoming zettelkasten notes' });

		const incomingPath = this.plugin.settings.incomingFolderPath || 'Incoming';
		const folder = this.plugin.app.vault.getAbstractFileByPath(incomingPath);

		if (!(folder instanceof TFolder)) {
			contentEl.createDiv({
				cls: 'sh-review-empty',
				text: `No folder found at "${incomingPath}". Please create it or configure the incoming path in settings.`,
			});
			return;
		}

		const mdFiles = folder.children.filter((f): f is TFile => f instanceof TFile && f.extension === 'md');

		if (mdFiles.length === 0) {
			contentEl.createDiv({
				cls: 'sh-review-empty',
				text: `Folder "${incomingPath}" contains no markdown files.`,
			});
			return;
		}

		// Pre-select all files by default
		for (const f of mdFiles) {
			this.selectedFiles.add(f);
		}

		contentEl.createEl('p', { text: `Select files from "${incomingPath}" to import as thought nodes:` });

		const listDiv = contentEl.createDiv({ cls: 'sh-incoming-list' });

		for (const file of mdFiles) {
			const setting = new Setting(listDiv)
				.setName(file.basename)
				.addToggle((toggle) =>
					toggle.setValue(true).onChange((value) => {
						if (value) {
							this.selectedFiles.add(file);
						} else {
							this.selectedFiles.delete(file);
						}
					})
				);
			setting.controlEl.addClass('sh-incoming-setting-control');
		}

		new Setting(contentEl)
			.setName('Destination hologram')
			.setDesc('Choose whether to route these thought notes into the central "thoughts" whiteboard or a new named hologram.')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('thoughts', 'Central "thoughts" hologram')
					.addOption('new', 'New named hologram...')
					.setValue(this.targetChoice)
					.onChange((value: string) => {
						this.targetChoice = value as 'thoughts' | 'new';
					})
			);

		new Setting(contentEl)
			.setName('New hologram name')
			.setDesc('Required if "new named hologram" is selected.')
			.addText((text) =>
				text.setPlaceholder('E.g., epistemology').onChange((value) => {
					this.newHologramName = value;
				})
			);

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText('Import & normalize')
				.setCta()
				.onClick(async () => {
					await this.executeImport();
				})
		);
	}

	private async executeImport(): Promise<void> {
		if (this.selectedFiles.size === 0) {
			new Notice('No files selected for import.');
			return;
		}

		let hologramTag = 'thoughts';
		if (this.targetChoice === 'new') {
			if (!this.newHologramName.trim()) {
				new Notice('Please provide a valid name for the new hologram.');
				return;
			}
			hologramTag = this.newHologramName.trim().toLowerCase().replace(/\s+/g, '-');
		}

		const vault = this.plugin.app.vault;
		if (!vault.getAbstractFileByPath(HOLOGRAM_FOLDER)) {
			await vault.createFolder(HOLOGRAM_FOLDER);
		}

		let importedCount = 0;
		for (const source of this.selectedFiles) {
			const destPath = `${HOLOGRAM_FOLDER}/${source.basename}.md`;
			let content = await vault.read(source);

			// Normalize as thought node
			content = ensureHologramContent(content, defaultNodeType(this.plugin.settings.nodeTypes), source, this.plugin, hologramTag);

			// Ensure node-type is thought
			if (!content.includes('node-type:')) {
				content = content.replace(/---\r?\n/, `---\nnode-type: thought\n`);
			}

			// Check if file already exists in hologram folder
			const existing = vault.getAbstractFileByPath(destPath);
			if (existing instanceof TFile) {
				await vault.modify(existing, content);
			} else {
				await vault.create(destPath, content);
			}
			importedCount++;
		}

		new Notice(`Successfully imported and normalized ${importedCount} note(s) into hologram "${hologramTag}".`);
		this.close();
		await this.plugin.refreshGraphs();
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
