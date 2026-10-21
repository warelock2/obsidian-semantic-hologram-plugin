import { App, FuzzySuggestModal, Modal, Notice, Setting, TFile, Vault } from 'obsidian';
import type SemanticHologramPlugin from './main';
import { HOLOGRAM_FOLDER } from './settings';
import { findRelationsSection } from './relations';

/**
 * The inverse of importing a note into a hologram: turn a hologram node back
 * into a plain zettelkasten note.
 *
 * Import is additive (frontmatter + a typed `## Relationships` section), so
 * export must be exactly its inverse or the cycle leaks structure: strip the
 * frontmatter this plugin owns, turn typed relations back into plain wikilinks,
 * and move the file out of the hologram tree. Nothing is destroyed — the
 * relationships survive as links in the prose, which is how a ZK note expresses
 * them to begin with.
 */

/** Strip the frontmatter block entirely. */
function stripFrontmatter(content: string): string {
	const m = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
	return m ? content.slice(m[0].length) : content;
}

/**
 * Turn `- logical/supports [[Target]] (0.70)` back into a `[[Target]]` wikilink.
 *
 * Only typed relation lines become links; prose that merely mentions a note is
 * left alone. Lines that are already bare links are skipped, so exporting twice
 * cannot accumulate duplicates.
 */
function relationsToWikilinks(section: string): string[] {
	const out: string[] = [];
	for (const raw of section.split('\n')) {
		const line = raw.trim();
		if (!line) continue;
		const m = line.match(
			/^-\s+(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)\s+\[\[([^\]]+)\]\](?:\s*\{R\})?\s*\(\d(?:\.\d+)?\)\s*$/i,
		);
		if (!m || !m[1]) continue;
		const target = m[1].trim();
		// The capture is the link's *inner* text — the brackets are not part of it.
		// Emitting it bare would write plain prose ("Page Table") where a
		// wikilink belongs, and the exported note would silently lose its
		// connection to the rest of the graph.
		if (!out.some((l) => l === target)) out.push(target);
	}
	return out.map((t) => `[[${t}]]`);
}

/** Remove the authored relations section, returning any links it contained. */
export function extractRelations(content: string): { body: string; links: string[] } {
	// Use the section bounds the parser already computed rather than re-finding
	// the header by string compare: `RELATION_HEADER` is a RegExp, so comparing a
	// line against it as a string never matches, and the section would silently
	// never be removed.
	const section = findRelationsSection(content);
	if (!section) return { body: content, links: [] };
	const lines = content.split(/\r?\n/);
	// `findSection` walks a 0-based loop, so startLine is the header line itself
	// and endLine is the next header (or EOF) — both 0-based, half-open. Taking
	// startLine as 1-based would keep the header and eat the last prose line.
	const links = relationsToWikilinks(lines.slice(section.startLine + 1, section.endLine).join('\n'));
	const body = [...lines.slice(0, section.startLine), ...lines.slice(section.endLine)]
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trimEnd();
	return { body, links };
}

/** A path under `dir` that nothing occupies, creating the folder if needed. */
async function freePathIn(vault: Vault, dir: string, fileName: string): Promise<string> {
	if (dir && !vault.getAbstractFileByPath(dir)) {
		await vault.createFolder(dir).catch(() => undefined);
	}
	const dot = fileName.lastIndexOf('.');
	const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
	const ext = dot > 0 ? fileName.slice(dot) : '';
	const prefix = dir ? `${dir}/` : '';
	if (!vault.getAbstractFileByPath(`${prefix}${stem}${ext}`)) return `${prefix}${stem}${ext}`;
	let i = 2;
	while (vault.getAbstractFileByPath(`${prefix}${stem} ${i}${ext}`)) i++;
	return `${prefix}${stem} ${i}${ext}`;
}

/** Rewrite a note as a plain ZK note and write it to `destDir`. */
export async function exportNoteBody(file: TFile, destDir: string): Promise<TFile | null> {
	const vault = file.vault;
	try {
		const original = await vault.read(file);
		const { body, links } = extractRelations(stripFrontmatter(original));
		const linkBlock = links.length ? `\n\n${links.join('\n')}` : '';
		const destPath = await freePathIn(vault, destDir, file.name);
		return await vault.create(destPath, `${body}${linkBlock}\n`);
	} catch (e) {
		new Notice(`Export failed: ${String(e)}`);
		return null;
	}
}

/** Pick a hologram node, then a destination folder. */
export class ExportNoteModal extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private plugin: SemanticHologramPlugin,
	) {
		super(app);
		this.setPlaceholder('Pick a hologram node to export…');
		this.setInstructions([{ command: '↵', purpose: 'export as a plain note' }]);
	}

	getItems(): TFile[] {
		return this.app.vault
			.getMarkdownFiles()
			.filter((f) => f.path.startsWith(`${HOLOGRAM_FOLDER}/`))
			.sort((a, b) => a.path.localeCompare(b.path));
	}

	getItemText(item: TFile): string {
		return item.path;
	}

	onChooseItem(item: TFile): void {
		new ExportDestinationModal(this.app, async (dir) => {
			// Write first, delete second: if the rewrite fails the original is
			// still on disk, so a failed export cannot lose the note.
			const written = await exportNoteBody(item, dir);
			if (!written) return;
			await item.vault.delete(item).catch(() => undefined);
			await this.plugin.refreshGraphs();
			new Notice(`Exported ${item.basename} → ${written.path}`);
		}).open();
	}
}

class ExportDestinationModal extends Modal {
	private value = '';
	constructor(
		app: App,
		private onConfirm: (dir: string) => void | Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Export destination folder' });
		contentEl.createEl('p', {
			text: 'Vault-relative folder. Leave empty to export to the vault root.',
		});
		new Setting(contentEl).addText((t) =>
			t.setPlaceholder('e.g. Zettelkasten').onChange((v) => {
				this.value = v.trim();
			}),
		);
		new Setting(contentEl).addButton((b) =>
			b
				.setButtonText('Export')
				.setCta()
				.onClick(async () => {
					this.close();
					// Strip leading/trailing slashes so `dir` stays a clean
					// path segment for `freePathIn`.
					await this.onConfirm(this.value.replace(/^\/+|\/+$/g, ''));
				}),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}