import { App, TFile, Notice, Modal } from 'obsidian';

export interface TableSpreadIndexCache {
	[spreadName: string]: {
		lastSeq: number;
		created?: string;
	};
}

export class TableSpreadModal extends Modal {
	result: string = '';
	onSubmit: (result: string) => void;

	constructor(app: App, onSubmit: (result: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Name this table spread' });

		const inputEl = contentEl.createEl('input', { type: 'text', placeholder: 'e.g. hologram1' });
		// Defer focus: Obsidian's modal container grabs focus during onOpen,
		// so a synchronous focus() is stolen and keystrokes leak to the editor.
		window.setTimeout(() => inputEl.focus(), 10);

		inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				this.result = inputEl.value.trim();
				if (this.result) {
					this.onSubmit(this.result);
					this.close();
				} else {
					new Notice('Spread name cannot be empty.');
				}
			}
		});

		const buttonEl = contentEl.createEl('button', { text: 'Start spread' });
		buttonEl.addEventListener('click', () => {
			this.result = inputEl.value.trim();
			if (this.result) {
				this.onSubmit(this.result);
				this.close();
			} else {
				new Notice('Spread name cannot be empty.');
			}
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

export class TableSpreadChooseModal extends Modal {
	result: string | null = null;
	onSubmit: (result: string | null) => void;
	spreads: string[];

	constructor(app: App, spreads: string[], onSubmit: (result: string | null) => void) {
		super(app);
		this.spreads = spreads;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Choose a table spread' });

		for (const name of this.spreads) {
			const btn = contentEl.createEl('button', { text: name });
			btn.style.display = 'block';
			btn.style.margin = '4px 0';
			btn.addEventListener('click', () => {
				this.result = name;
				this.onSubmit(name);
				this.close();
			});
		}

		const newBtn = contentEl.createEl('button', { text: 'Start new spread...' });
		newBtn.style.display = 'block';
		newBtn.style.margin = '8px 0 0 0';
		newBtn.addEventListener('click', () => {
			this.result = null;
			this.onSubmit(null);
			this.close();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

export async function getOrCreateIndexFile(app: App): Promise<TFile | null> {
	const indexPath = '_tspread_index.json';
	const abstractFile = app.vault.getAbstractFileByPath(indexPath);
	if (abstractFile instanceof TFile) {
		return abstractFile;
	}
	try {
		const newFile = await app.vault.create(indexPath, JSON.stringify({}, null, 2));
		return newFile;
	} catch (e) {
		console.error('Failed to create _tspread_index.json', e);
		return null;
	}
}

export async function readSpreadIndex(app: App): Promise<TableSpreadIndexCache> {
	const file = await getOrCreateIndexFile(app);
	if (!file) return {};
	try {
		const content = await app.vault.read(file);
		const parsed = JSON.parse(content) as unknown;
		if (parsed && typeof parsed === 'object') {
			return parsed as TableSpreadIndexCache;
		}
		return {};
	} catch (e) {
		console.error('Failed to parse _tspread_index.json', e);
		return {};
	}
}

export async function writeSpreadIndex(app: App, cache: TableSpreadIndexCache): Promise<void> {
	const file = await getOrCreateIndexFile(app);
	if (!file) return;
	try {
		await app.vault.modify(file, JSON.stringify(cache, null, 2));
	} catch (e) {
		console.error('Failed to write _tspread_index.json', e);
	}
}

export interface TableSpreadClickOptions {
	/** Force prompting for a brand-new spread name (used by the palette command). */
	forceNew?: boolean;
	/** Record the step on this file instead of the currently active one (e.g. a link destination). */
	targetFile?: TFile;
	/** Spread name to use (e.g. the active mode's spread). Skips derivation/prompting. */
	spreadName?: string;
}

/**
 * Handles the Ctrl+Shift+Click event on a link:
 * Increments or initializes sequence index for the active spread on the current active note.
 *
 * A spread is "current" across the whole trail: once named, clicking links in
 * subsequent notes continues that same spread without re-prompting. A note that
 * already participates in a spread reuses its last spread. Prompting only happens
 * when there is no current spread and the note has none (or forceNew is set).
 */
export async function recordTableSpreadStep(app: App, spreadName: string, targetFile: TFile): Promise<number> {
	const cache = await readSpreadIndex(app);
	const spreadInfo = cache[spreadName] ?? { lastSeq: 0, created: new Date().toISOString() };
	const nextSeq = spreadInfo.lastSeq + 1;
	spreadInfo.lastSeq = nextSeq;
	cache[spreadName] = spreadInfo;
	await writeSpreadIndex(app, cache);

	// Read file and strip leading blank lines.
	let content = await app.vault.read(targetFile);
	content = content.replace(/^\n+/, '');

	const spreadTag = `table-spread-${spreadName}`;
	const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
	if (!fmMatch) {
		// No frontmatter; cannot record. Restore file and bail.
		await app.vault.modify(targetFile, content);
		return nextSeq;
	}
	let fm = fmMatch[1]!;
	const rest = content.slice(fmMatch[0].length);

	// Update tableSpreadIndexes.
	if (/^tableSpreadIndexes:/m.test(fm)) {
		if (new RegExp(`^  ${spreadName}:`, 'm').test(fm)) {
			fm = fm.replace(new RegExp(`^  ${spreadName}:.*$`, 'm'), `  ${spreadName}: ${nextSeq}`);
		} else {
			fm = fm.replace(/^tableSpreadIndexes:/m, `tableSpreadIndexes:\n  ${spreadName}: ${nextSeq}`);
		}
	} else {
		fm = fm.trimEnd() + `\ntableSpreadIndexes:\n  ${spreadName}: ${nextSeq}`;
	}

	// Update tags.
	if (/^tags:/m.test(fm)) {
		if (!new RegExp(`^  - ${spreadTag}$`, 'm').test(fm)) {
			fm = fm.replace(/^tags:/m, `tags:\n  - ${spreadTag}`);
		}
	} else {
		fm = fm.trimEnd() + `\ntags:\n  - ${spreadTag}`;
	}

	const newContent = `---\n${fm}\n---${rest}`;
	await app.vault.modify(targetFile, newContent.replace(/^\n+/, ''));
	return nextSeq;
}

export async function handleTableSpreadClick(app: App, options: TableSpreadClickOptions = {}): Promise<string | null> {
	const activeFile = app.workspace.getActiveFile();
	if (!activeFile) {
		new Notice('No active note to record table spread step.');
		return null;
	}

	const recordFile = options.targetFile ?? activeFile;

	const cache = await readSpreadIndex(app);
	// Stateless continuation: derive the spread from the note we're clicking FROM.
	const sourceMetadata = app.metadataCache.getFileCache(activeFile);
	const sourceFm = (sourceMetadata?.frontmatter ?? {}) as Record<string, unknown>;
	const sourceSpreads = Object.keys((sourceFm.tableSpreadIndexes ?? {}) as Record<string, number>);
	const metadata = app.metadataCache.getFileCache(recordFile);
	const fm = (metadata?.frontmatter ?? {}) as Record<string, unknown>;
	const existingIndexes = (fm.tableSpreadIndexes ?? {}) as Record<string, number>;
	const activeSpreads = Object.keys(existingIndexes);

	let spreadName = options.spreadName ?? '';
	if (!spreadName && options.forceNew) {
		await new Promise<void>((resolve) => {
			new TableSpreadModal(app, (name) => {
				spreadName = name.replace(/[^a-zA-Z0-9-_]/g, '-');
				resolve();
			}).open();
		});
	} else if (!spreadName && sourceSpreads.length === 1) {
		spreadName = sourceSpreads[0] ?? '';
	} else if (!spreadName && sourceSpreads.length > 1) {
		spreadName = sourceSpreads[sourceSpreads.length - 1] ?? '';
	} else if (!spreadName && activeSpreads.length === 1) {
		spreadName = activeSpreads[0] ?? '';
	} else if (!spreadName && activeSpreads.length > 1) {
		spreadName = activeSpreads[activeSpreads.length - 1] ?? '';
	} else if (!spreadName) {
		await new Promise<void>((resolve) => {
			new TableSpreadModal(app, (name) => {
				spreadName = name.replace(/[^a-zA-Z0-9-_]/g, '-');
				resolve();
			}).open();
		});
	}

	if (!spreadName) return null;

	// No global "current spread" pointer: the spread propagates via the click itself
	// (source note's spread -> destination note). Stateless.

	const nextSeq = await recordTableSpreadStep(app, spreadName, recordFile);
	new Notice(`Table Spread [${spreadName}]: Step ${nextSeq} recorded.`);
	return spreadName;
}

/**
 * Backtracks the last table spread step on the active note.
 */
export async function handleTableSpreadBacktrack(app: App): Promise<boolean> {
	const activeFile = app.workspace.getActiveFile();
	if (!activeFile) {
		new Notice('No active note to backtrack.');
		return false;
	}

	let content = await app.vault.read(activeFile);
	content = content.replace(/^\n+/, '');

	const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
	if (!fmMatch) {
		new Notice('No active table spread sequence on this note.');
		return false;
	}
	const fm = fmMatch[1]!;
	const existingIndexes: Record<string, number> = {};
	const tsMatch = fm.match(/^tableSpreadIndexes:\n((?:  .+\n?)*)/m);
	if (tsMatch) {
		const lines = (tsMatch[1] ?? '').split('\n');
		for (const line of lines) {
			const m = line.match(/^  ([^:]+):\s*(.+)$/);
			if (m && m[1] && m[2]) existingIndexes[m[1].trim()] = Number(m[2].trim());
		}
	}
	const activeSpreads = Object.keys(existingIndexes);

	if (activeSpreads.length === 0) {
		new Notice('No active table spread sequence on this note.');
		return false;
	}

	const spreadName = activeSpreads[activeSpreads.length - 1] ?? '';
	if (!spreadName) return false;
	const seq = existingIndexes[spreadName] ?? 0;
	const wasSeed = seq === 1;

	const spreadTag = `table-spread-${spreadName}`;

	// Remove entry from tableSpreadIndexes in frontmatter text.
	let newFm = fm.replace(new RegExp(`^  ${spreadName}:.*\n?`, 'm'), '');
	// If tableSpreadIndexes block is now empty, remove the key line.
	if (!/^  .+:/m.test(newFm.split('tableSpreadIndexes:')[1]?.split('\n---')[0] ?? '')) {
		// remove the tableSpreadIndexes: line and trailing blank
		newFm = newFm.replace(/^tableSpreadIndexes:\n/m, '');
	}
	// Remove tag from tags list.
	newFm = newFm.replace(new RegExp(`^  - ${spreadTag}\\s*\n?`, 'm'), '');
	// If tags block is now empty, remove the key line.
	const tagsMatch = newFm.match(/^tags:\n((?:  .+\n?)*)/m);
	if (tagsMatch) {
		const remaining = (tagsMatch[1] ?? '').trim();
		if (!remaining) {
			newFm = newFm.replace(/^tags:\n/m, '');
		}
	}

	const rest = content.slice(fmMatch[0].length);
	const newContent = `---\n${newFm}\n---${rest}`.replace(/^\n+/, '');
	await app.vault.modify(activeFile, newContent);

	const cache = await readSpreadIndex(app);
	if (cache[spreadName] && cache[spreadName].lastSeq === seq) {
		cache[spreadName].lastSeq = Math.max(0, seq - 1);
		await writeSpreadIndex(app, cache);
	}

	new Notice(`Table Spread [${spreadName}]: Backtracked step ${seq}.`);

	try {
		// @ts-ignore
		await app.commands.executeCommandById('app:go-back');
	} catch (e) {
		console.error('Failed to navigate back', e);
	}

	return wasSeed;
}


/**
 * Playback: auto-follow relationship links from startFile to notes carrying the
 * given spread tag, opening each in sequence until none is found (or a loop).
 */
export async function playbackTableSpread(app: App, spreadTag: string, startFile: TFile): Promise<void> {
	const visited = new Set<string>();
	let current: TFile | null = startFile;
	visited.add(startFile.path);

	while (current) {
		// Find outgoing relationship links in the current note.
		const content = await app.vault.read(current);
		const links = extractWikilinks(content);
		let nextPath: string | null = null;
		for (const link of links) {
			const target = app.metadataCache.getFirstLinkpathDest(link, current.path);
			if (!target) continue;
			if (visited.has(target.path)) continue;
			const fm = app.metadataCache.getFileCache(target)?.frontmatter ?? {};
			const tags = (fm.tags ?? []) as string[];
			if (tags.includes(spreadTag)) {
				nextPath = target.path;
				break;
			}
		}
		if (!nextPath) break;
		visited.add(nextPath);
		const nextFile = app.vault.getAbstractFileByPath(nextPath);
		if (!(nextFile instanceof TFile)) break;
		await app.workspace.getLeaf(false).openFile(nextFile);
		// Small delay so the user can see the trail unfold.
		await new Promise((r) => setTimeout(r, 400));
		current = nextFile;
	}
}

/** Extract [[wikilink]] targets from note content (relationships + body). */
function extractWikilinks(content: string): string[] {
	const out: string[] = [];
	const re = /\[\[([^\]|]+)\]\]/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(content)) !== null) {
		const target = ((m[1] ?? '').split('|')[0] ?? '').trim();
		if (target && !out.includes(target)) out.push(target);
	}
	return out;
}
