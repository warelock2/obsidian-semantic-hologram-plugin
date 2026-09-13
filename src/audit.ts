import { App, Modal, Notice, Setting, TFile, Vault } from 'obsidian';
import { HOLOGRAM_FOLDER } from './settings';
import type SemanticHologramPlugin from './main';
import { ensureHologramContent } from './importNote';

export interface AuditResult {
	file: TFile;
	issues: string[];
}

export async function auditHologramNodes(vault: Vault): Promise<AuditResult[]> {
	const files = vault.getMarkdownFiles().filter((f) => f.path.startsWith(`${HOLOGRAM_FOLDER}/`));
	const results: AuditResult[] = [];

	for (const file of files) {
		const content = await vault.read(file);
		const issues: string[] = [];

		// Check frontmatter
		if (!/^---[\s\S]*?hologram-node:\s*true/im.test(content)) {
			issues.push('Missing hologram-node: true');
		}
		if (!/^---[\s\S]*?note-type:/im.test(content)) {
			issues.push('Missing note-type');
		}
		if (!/^---[\s\S]*?created:/im.test(content)) {
			issues.push('Missing created date');
		}

		// Check sections
		if (!/(^|\n)#{1,6}\s+Relations/i.test(content)) {
			issues.push('Missing ## Relations section');
		}
		if (!/(^|\n)#{1,6}\s+Incoming\s+Relations/i.test(content)) {
			issues.push('Missing ## Incoming relationships section');
		}

		// Check relation links are qualified with the hologram folder
		const relLineRe = /-\s+[a-z0-9]+(?:\-[a-z0-9]+)*(?:\/[a-z0-9]+(?:\-[a-z0-9]+)*)?\s+\[\[([^\]|]+)\]\]/g;
		let relMatch;
		while ((relMatch = relLineRe.exec(content)) !== null) {
			const target = relMatch[1]!.trim();
			if (target.includes('/')) continue;
			if (vault.getAbstractFileByPath(`${HOLOGRAM_FOLDER}/${target}.md`)) {
				issues.push(`Unqualified relation link: [[${target}]]`);
			}
		}

		if (issues.length > 0) {
			results.push({ file, issues });
		}
	}
	return results;
}

export class HologramAuditModal extends Modal {
	constructor(
		app: App,
		private plugin: SemanticHologramPlugin,
		private results: AuditResult[],
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h4', { text: 'Audit Hologram Nodes' });

		if (this.results.length === 0) {
			contentEl.createEl('p', { text: 'All nodes are in compliance!' });
			return;
		}

		contentEl.createEl('p', { text: `Found ${this.results.length} nodes with issues.` });
		const list = contentEl.createEl('ul');
		for (const res of this.results) {
			const li = list.createEl('li');
			li.setText(`${res.file.basename}: ${res.issues.join(', ')}`);
		}

		new Setting(contentEl).addButton((b) =>
			b
				.setButtonText('Fix All')
				.setCta()
				.onClick(async () => {
					for (const res of this.results) {
						const content = await this.app.vault.read(res.file);
						// Use default type from settings or 'concept'
						const defaultType = this.plugin.settings.nodeTypes[0]?.id ?? 'concept';
						const fixed = ensureHologramContent(content, defaultType, res.file, this.plugin);
						await this.app.vault.modify(res.file, fixed);
					}
					new Notice(`Fixed ${this.results.length} nodes.`);
					this.close();
					await this.plugin.refreshGraphs();
				}),
		);
	}

	onClose() {
		this.contentEl.empty();
	}
}
