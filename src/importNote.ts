import { App, FuzzySuggestModal, Modal, Notice, Setting, TFile, Vault } from 'obsidian';
import { DEFAULT_NODE_TYPE_ID, HOLOGRAM_FOLDER, defaultNodeType } from './settings';
import { normalizeFrontmatterOrder, RELATIONS_HEADER } from './skeleton';
import { RELATION_HEADER, findRelationsSection } from './relations';
import { auditHologramNodes, HologramAuditModal } from './audit';
import type SemanticHologramPlugin from './main';

/** Ensure a note declares `hologram-node: true`, preserving existing frontmatter. */
export function ensureHologramContent(
	content: string,
	defaultNoteType = DEFAULT_NODE_TYPE_ID,
	source: TFile,
	plugin: SemanticHologramPlugin,
	hologramTag?: string,
): string {
	const created = new Date().toISOString().slice(0, 10);
	// 1. Ensure frontmatter
	let res = content;
	const m = res.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (m) {
		let body = m[1]!;
		let modified = false;
		if (!/^hologram-node:\s*true/im.test(body)) {
			body = `hologram-node: true\n${body}`;
			modified = true;
		}
		// Both spellings exist in the wild: `setHologramsInContent` writes the
		// plural `holograms:` as a block list, while this function used to emit
		// the singular `hologram:` as a flow list. Probing only `/^hologram:/`
		// did NOT match `holograms:` (the `s` precedes the colon), so a note
		// whose holograms had already been set got a second key appended, and
		// `parseNoteFrontmatter` reads plural-first — silently discarding the
		// tag that had just been added.
		if (hologramTag) {
			const key = /^holograms?:/im.exec(body);
			if (!key) {
				body = `${body}\nholograms: [${hologramTag}]`;
				modified = true;
			} else if (/^holograms?:\s*\[/im.test(body)) {
				body = body.replace(/^(holograms?):\s*\[(.*)\]/im, `$1: [$2, ${hologramTag}]`);
				modified = true;
			} else {
				// Existing block list: append an item rather than add a rival key.
				const lines = body.split('\n');
				const at = lines.findIndex((l) => /^holograms?:/i.test(l));
				if (at >= 0) {
					let last = at;
					for (let i = at + 1; i < lines.length && /^\s+-\s/.test(lines[i]!); i++) {
						last = i;
					}
					lines.splice(last + 1, 0, `  - "${hologramTag.replace(/"/g, '\\"')}"`);
					body = lines.join('\n');
					modified = true;
				}
			}
		}
		if (!/^node-type:/im.test(body) && !/^note-type:/im.test(body)) {
			body = `${body}\nnode-type: ${defaultNoteType}`;
			modified = true;
		}
		if (!/^created:/im.test(body)) {
			body = `${body}\ncreated: ${created}`;
			modified = true;
		}
		if (modified) {
			res = `---\n${normalizeFrontmatterOrder(body.trim())}\n---${res.slice(m[0].length)}`;
		}
	} else {
		res = `---\nhologram-node: true\nnode-type: ${defaultNoteType}\ncreated: ${created}\n${hologramTag ? `holograms: [${hologramTag}]` : ''}\n---\n\n${res}`;
	}

	// 2. Ensure sections
	if (!findRelationsSection(res)) {
		// Appended last so it bounds only itself: a relations header above the
		// prose would swallow the prose as malformed relation lines.
		res = res.trimEnd() + `\n\n${RELATIONS_HEADER}\n`;
	}
	// Removed hard-coded incoming relationships header insertion, as it is now dynamically rendered.

	return injectWikilinksAsRelations(res, source, plugin);
}

// Regex for matching a relation line anywhere in the note body
const REL_LINE_SEARCH = /-\s+([a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?)\s+\[\[([^\]]+)\]\]\s*(\{R\})?\s*\((\d{1,2}(?:\.\d{1,2})?)\)/;

export function injectWikilinksAsRelations(content: string, source: TFile, plugin: SemanticHologramPlugin): string {
	// 1. Parse existing Relations section
	const relHeaderMatch = content.match(new RegExp(`(^[\\t]*${RELATION_HEADER.source}[\\t]*\\r?$)`, 'im'));
	if (!relHeaderMatch || relHeaderMatch.index === undefined) {
		return content;
	}

	const headerEndIndex = relHeaderMatch.index + relHeaderMatch[0].length;
	const remainder = content.slice(headerEndIndex);
	const nextHeaderMatch = remainder.match(/\n#{1,6}\s+/);
	const relationsSectionContent = nextHeaderMatch ? remainder.slice(0, nextHeaderMatch.index) : remainder;

	const bodyContent = content.slice(0, relHeaderMatch.index);

	// 2. Find and extract existing valid relationship lines from body to move to Relations section
	const existingLinesInBody: string[] = [];
	let newBodyContent = bodyContent;
	const bodyLines = bodyContent.split('\n');
	const cleanedBodyLines: string[] = [];

	for (const line of bodyLines) {
		if (REL_LINE_SEARCH.test(line.trim())) {
			existingLinesInBody.push(line.trim());
		} else {
			cleanedBodyLines.push(line);
		}
	}
	newBodyContent = cleanedBodyLines.join('\n');

	// 2.5 Extract existing lines from the current Relations section
	const existingLinesInRelations: string[] = [];
	const relSectionLines = relationsSectionContent.split('\n');
	for (const line of relSectionLines) {
		if (REL_LINE_SEARCH.test(line.trim())) {
			existingLinesInRelations.push(line.trim());
		}
	}

	// 3. Identify wikilinks to convert (excluding those already in relations)
	const wikilinkRegex = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
	const targets = new Set<string>();
	let match;

	while ((match = wikilinkRegex.exec(newBodyContent)) !== null) {
		const target = match[1]?.trim();
		// Get target path via metadata cache, using source.path for proper disambiguation
		const targetFile = plugin.app.metadataCache.getFirstLinkpathDest(target ?? '', source.path);
		if (target && targetFile && targetFile.path !== source.path) {
			targets.add(target);
		}
	}

	// 4. Check targets already present in relations
	const existingRelTargets = new Set<string>();
	
	for (const line of [...existingLinesInBody, ...existingLinesInRelations]) {
		const m = line.match(REL_LINE_SEARCH);
		if (m && m[2]) {
			existingRelTargets.add(m[2].trim());
		}
	}

	// 5. Build new lines (existing lines + new related)
	const linesToAdd: string[] = [...existingLinesInBody, ...existingLinesInRelations];
	for (const target of targets) {
		if (!existingRelTargets.has(target)) {
			linesToAdd.push(`- related [[${target}]] (${String(plugin.settings?.defaultRelStrength ?? 0.5)})`);
		}
	}

	// 6. Assemble
	const updatedRelations = linesToAdd.length > 0 ? `\n${linesToAdd.join('\n')}\n` : `\n`;

	return newBodyContent + content.slice(relHeaderMatch.index, headerEndIndex) + updatedRelations + (nextHeaderMatch ? remainder.slice(nextHeaderMatch.index) : '\n');

}



/** Find a free `Holograms/<basename>.md` path, appending ` 2`, ` 3`, … on collision. */
export function nextAvailablePath(vault: Vault, baseName: string): string {
	let name = baseName;
	let i = 2;
	let p = `${HOLOGRAM_FOLDER}/${name}.md`;
	while (vault.getAbstractFileByPath(p)) {
		name = `${baseName} ${i++}`;
		p = `${HOLOGRAM_FOLDER}/${name}.md`;
	}
	return p;
}

export class ImportNoteModal extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private plugin: SemanticHologramPlugin,
	) {
		super(app);
		this.setPlaceholder('Pick a note to copy into holograms/');
		this.setInstructions([{ command: '↵', purpose: 'import into Holograms/' }]);
	}

	getItems(): TFile[] {
		return this.app.vault
			.getMarkdownFiles()
			.filter((f) => !this.plugin.isInScope(f.path))
			.sort((a, b) => a.path.localeCompare(b.path));
	}

	getItemText(item: TFile): string {
		return item.path;
	}

	onChooseItem(item: TFile): void {
		new HologramTagModal(this.app, (tag) => {
			void importNoteIntoHolograms(this.plugin, item, tag);
		}).open();
	}
}

export class HologramTagModal extends Modal {
	constructor(
		app: App,
		private onConfirm: (tag: string) => void,
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Enter hologram tag' });
		const setting = new Setting(contentEl);
		let tag = '';
		setting.setName('Tag').addText((text) =>
			text.onChange((value) => {
				tag = value;
			})
		);
		setting.addButton((btn) =>
			btn
				.setButtonText('Import')
				.setCta()
				.onClick(() => {
					this.onConfirm(tag);
					this.close();
				})
		);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

/** Rewrites wikilinks to exclusively point to hologram-scoped notes. */
export function rewriteLinks(plugin: SemanticHologramPlugin, content: string): string {
    const vaultBasenames = new Set(plugin.app.vault.getMarkdownFiles().map(f => f.basename));

	return content.replace(/\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g, (match: string, target: string, section?: string, display?: string) => {
		const trimmedTarget = target.trim();
        const basename = trimmedTarget.split('/').pop() ?? '';

        if (trimmedTarget.startsWith(HOLOGRAM_FOLDER + '/')) {
            return match;
        }

        if (vaultBasenames.has(basename)) {
			const newDisplay = display || trimmedTarget;
			const sectionPart = section ? `#${section}` : '';
			return `[[${HOLOGRAM_FOLDER}/${basename}${sectionPart}|${newDisplay}]]`;
		}
		
		return match;
	});
}

/** Copy a note into `Holograms/`, marking it as a hologram node, then rebuild the graph. */
export async function importNoteIntoHolograms(plugin: SemanticHologramPlugin, source: TFile, hologramTag: string): Promise<TFile | null> {
	const vault = plugin.app.vault;
	if (plugin.isInScope(source.path)) {
		new Notice('This note is already in the hologram scope.');
		return null;
	}
	try {
		if (!vault.getAbstractFileByPath(HOLOGRAM_FOLDER)) {
			await vault.createFolder(HOLOGRAM_FOLDER);
		}
	} catch {
		// Folder already exists.
	}
	const destPath = `${HOLOGRAM_FOLDER}/${source.basename}.md`;
	let newContent = '';
	try {
		newContent = await vault.read(source);
	} catch (e) {
		new Notice(`Could not read ${source.path}: ${String(e)}`);
		return null;
	}

	let finalContent = '';
	const existingFile = vault.getAbstractFileByPath(destPath);
	if (existingFile instanceof TFile) {
		const existingContent = await vault.read(existingFile);
		// Simple concatenate: append new body to existing content
		finalContent = existingContent + '\n\n' + newContent;
	} else {
		finalContent = newContent;
	}

	finalContent = rewriteLinks(plugin, finalContent);
	finalContent = ensureHologramContent(
		finalContent,
		defaultNodeType(plugin.settings.nodeTypes),
		source,
		plugin,
		hologramTag,
	);
	
	try {
		let f: TFile;
		if (existingFile instanceof TFile) {
			await vault.modify(existingFile, finalContent);
			f = existingFile;
		} else {
			f = await vault.create(destPath, finalContent);
		}
		await plugin.refreshGraphs();
		new Notice(`Imported ${source.basename} into ${destPath}`);
		const auditResults = await auditHologramNodes(plugin);
		if (auditResults.length > 0) {
			new HologramAuditModal(plugin.app, plugin, auditResults).open();
		}
		return f;
	} catch (e) {
		new Notice(`Import failed: ${String(e)}`);
		return null;
	}
}