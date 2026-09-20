import { App, Modal, Notice, Setting, TFile } from 'obsidian';
import { HOLOGRAM_FOLDER } from './settings';
import { findMissingStrengths, formatStrength, inScopePath, normalizeRelationStrengths, scanRelations } from './relations';
import type SemanticHologramPlugin from './main';
import { ensureHologramContent } from './importNote';

export interface AuditResult {
	file: TFile;
	issues: string[];
}

/**
 * Repair one hologram note: ensure frontmatter and sections, and restore
 * missing strengths.
 */
export function repairHologramNode(content: string, file: TFile, plugin: SemanticHologramPlugin): string {
	const defaultType = plugin.settings.nodeTypes[0]?.id ?? 'concept';
	let fixed = ensureHologramContent(content, defaultType, file, plugin);
	fixed = normalizeRelationStrengths(fixed, plugin.settings.defaultRelStrength);
	return fixed;
}

export async function auditHologramNodes(plugin: SemanticHologramPlugin): Promise<AuditResult[]> {
	const vault = plugin.app.vault;
	const files = vault.getMarkdownFiles().filter((f) => f.path.startsWith(`${HOLOGRAM_FOLDER}/`));
	const results: AuditResult[] = [];

	// Determine which notes actually have incoming edges; the incoming section is
	// only required (and only fixable) when edges exist.
	const scan = await scanRelations(
		files,
		vault,
		plugin.app.metadataCache,
		plugin.knownRelIds(),
		plugin.settings.defaultRelStrength,
		(path) => inScopePath(path, vault, plugin.app.metadataCache),
	);
	const incomingTargets = new Set(scan.edges.map((e) => e.target));

	for (const file of files) {
		const content = await vault.read(file);
		const issues: string[] = [];

		// Check frontmatter
		if (!/^---[\s\S]*?hologram-node:\s*true/im.test(content)) {
			issues.push('Missing hologram-node: true');
		}
		if (!/^---[\s\S]*?node-type:/im.test(content)) {
			issues.push('Missing node-type');
		}
		if (!/^---[\s\S]*?created:/im.test(content)) {
			issues.push('Missing created date');
		}

		// Check sections
		if (!/(^|\n)#{1,6}\s+Relations(?:hips)?/i.test(content)) {
			issues.push('Missing ## Relationships section');
		}
		if (incomingTargets.has(file.path) && !/(^|\n)#{1,6}\s+Incoming\s+Relations(?:hips)?/i.test(content)) {
			issues.push('Missing ## Incoming relationships section');
		}

		// Check every authored relation line carries an explicit strength.
		const expected = ` (${formatStrength(plugin.settings.defaultRelStrength)})`;
		for (const loc of findMissingStrengths(content)) {
			issues.push(`Missing strength '${expected}' expected (line ${loc.line}); line: ${loc.text}`);
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
						const fixed = repairHologramNode(content, res.file, this.plugin);
						await this.app.vault.modify(res.file, fixed);
					}
					new Notice(`Fixed ${this.results.length} nodes.`);
					this.close();
					await this.plugin.refreshIncomingRelationships();
					await this.plugin.refreshGraphs();
				}),
		).addButton((b) =>
			b
				.setButtonText('Skip')
				.onClick(() => {
					this.close();
				}),
		);
	}

	onClose() {
		this.contentEl.empty();
	}
}
