import { App, FuzzySuggestModal, Notice, TFile, Vault } from 'obsidian';
import { HOLOGRAM_FOLDER } from './settings';
import type SemanticHologramPlugin from './main';

/** Ensure a note declares `hologram-node: true`, preserving existing frontmatter. */
export function ensureHologramFrontmatter(content: string): string {
	const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (m) {
		const body = m[1]!;
		if (/^hologram-node:\s*true/im.test(body)) {
			return content;
		}
		return `---\nhologram-node: true\n${body}\n---${content.slice(m[0]!.length)}`;
	}
	return `---\nhologram-node: true\n---\n\n${content}`;
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
		this.setPlaceholder('Pick a note to copy into Holograms/');
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

	async onChooseItem(item: TFile): Promise<void> {
		await importNoteIntoHolograms(this.plugin, item);
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
	content = ensureHologramFrontmatter(content);
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