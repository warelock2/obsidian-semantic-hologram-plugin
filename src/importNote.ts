import { App, FuzzySuggestModal, Notice, TFile, Vault } from 'obsidian';
import { HOLOGRAM_FOLDER } from './settings';
import type SemanticHologramPlugin from './main';

/** Ensure a note declares `hologram-node: true`, preserving existing frontmatter. */
export function ensureHologramContent(content: string, defaultNoteType = 'concept', source: TFile, plugin: SemanticHologramPlugin): string {
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
		if (!/^note-type:/im.test(body)) {
			body = `${body}\nnote-type: ${defaultNoteType}`;
			modified = true;
		}
		if (!/^created:/im.test(body)) {
			body = `${body}\ncreated: ${created}`;
			modified = true;
		}
		if (modified) {
			res = `---\n${body.trim()}\n---${res.slice(m[0].length)}`;
		}
	} else {
		res = `---\nhologram-node: true\nnote-type: ${defaultNoteType}\ncreated: ${created}\n---\n\n${res}`;
	}

	// 2. Ensure sections
	if (!/(^|\n)#{1,6}\s+Relations/i.test(res)) {
		res = res.trimEnd() + '\n\n## Relations\n\n';
	}
	if (!/(^|\n)#{1,6}\s+Incoming\s+Relations/i.test(res)) {
		res = res.trimEnd() + '\n\n## Incoming relationships\n\n';
	}

	return injectWikilinksAsRelations(res, source, plugin);
}

// Regex for matching a relation line anywhere in the note body
const REL_LINE_SEARCH = /-\s+([a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?)\s+\[\[([^\]]+)\]\]\s*(\{R\})?\s*\((\d{1,2}(?:\.\d{1,2})?)\)/;

export function injectWikilinksAsRelations(content: string, source: TFile, plugin: SemanticHologramPlugin): string {
	// 1. Parse existing Relations section
	const relHeaderMatch = content.match(/(^|\n)(#{1,6}\s+Relations(?:hips)?\s*\r?\n)/i);
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
		// Get target path via metadata cache if possible, to compare with current file path
		const targetFile = plugin.app.metadataCache.getFirstLinkpathDest(target ?? '', '');
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
			linesToAdd.push(`- related [[${target}]] (0.5)`);
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
		void importNoteIntoHolograms(this.plugin, item);
	}
}

/** Copy a note into `Holograms/`, marking it as a hologram node, then rebuild the graph. */
export async function importNoteIntoHolograms(plugin: SemanticHologramPlugin, source: TFile): Promise<TFile | null> {
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
	const destPath = nextAvailablePath(vault, source.basename);
	let content = '';
	try {
		content = await vault.read(source);
	} catch (e) {
		new Notice(`Could not read ${source.path}: ${String(e)}`);
		return null;
	}
	const defaultType = plugin.settings.nodeTypes[0]?.id ?? 'concept';
	content = ensureHologramContent(content, defaultType, source, plugin);
	try {
		const f = await vault.create(destPath, content);
		await plugin.refreshGraphs();
		new Notice(`Imported ${source.basename} into ${destPath}`);
		return f;
	} catch (e) {
		new Notice(`Import failed: ${String(e)}`);
		return null;
	}
}