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
		inputEl.focus();

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

/**
 * Handles the Ctrl+Shift+Click event on a link:
 * Increments or initializes sequence index for the active spread on the current active note.
 */
export async function handleTableSpreadClick(app: App): Promise<void> {
	const activeFile = app.workspace.getActiveFile();
	if (!activeFile) {
		new Notice('No active note to record table spread step.');
		return;
	}

	const cache = await readSpreadIndex(app);
	const metadata = app.metadataCache.getFileCache(activeFile);
	const fm = (metadata?.frontmatter ?? {}) as Record<string, unknown>;
	const existingIndexes = (fm.tableSpreadIndexes ?? {}) as Record<string, number>;
	const activeSpreads = Object.keys(existingIndexes);

	let spreadName = '';
	if (activeSpreads.length === 1) {
		spreadName = activeSpreads[0] ?? '';
	} else if (activeSpreads.length > 1) {
		spreadName = activeSpreads[activeSpreads.length - 1] ?? '';
	} else {
		await new Promise<void>((resolve) => {
			new TableSpreadModal(app, (name) => {
				spreadName = name.replace(/[^a-zA-Z0-9-_]/g, '-');
				resolve();
			}).open();
		});
	}

	if (!spreadName) return;

	const spreadInfo = cache[spreadName] ?? { lastSeq: 0, created: new Date().toISOString() };
	const nextSeq = spreadInfo.lastSeq + 1;
	spreadInfo.lastSeq = nextSeq;
	cache[spreadName] = spreadInfo;
	await writeSpreadIndex(app, cache);

	await app.fileManager.processFrontMatter(activeFile, (frontmatter: Record<string, unknown>) => {
		const indexes = (frontmatter.tableSpreadIndexes ?? {}) as Record<string, number>;
		indexes[spreadName] = nextSeq;
		frontmatter.tableSpreadIndexes = indexes;

		const tags = (frontmatter.tags ?? []) as string[];
		const spreadTag = `table-spread-${spreadName}`;
		if (!tags.includes(spreadTag)) {
			tags.push(spreadTag);
		}
		frontmatter.tags = tags;
	});

	new Notice(`Table Spread [${spreadName}]: Step ${nextSeq} recorded.`);
}

/**
 * Backtracks the last table spread step on the active note.
 */
export async function handleTableSpreadBacktrack(app: App): Promise<void> {
	const activeFile = app.workspace.getActiveFile();
	if (!activeFile) {
		new Notice('No active note to backtrack.');
		return;
	}

	const metadata = app.metadataCache.getFileCache(activeFile);
	const fm = (metadata?.frontmatter ?? {}) as Record<string, unknown>;
	const existingIndexes = (fm.tableSpreadIndexes ?? {}) as Record<string, number>;
	const activeSpreads = Object.keys(existingIndexes);

	if (activeSpreads.length === 0) {
		new Notice('No active table spread sequence on this note.');
		return;
	}

	const spreadName = activeSpreads[activeSpreads.length - 1] ?? '';
	if (!spreadName) return;
	const seq = existingIndexes[spreadName] ?? 0;

	await app.fileManager.processFrontMatter(activeFile, (frontmatter: Record<string, unknown>) => {
		const indexes = (frontmatter.tableSpreadIndexes ?? {}) as Record<string, number>;
		delete indexes[spreadName];
		if (Object.keys(indexes).length === 0) {
			delete frontmatter.tableSpreadIndexes;
		} else {
			frontmatter.tableSpreadIndexes = indexes;
		}

		const spreadTag = `table-spread-${spreadName}`;
		const tags = (frontmatter.tags ?? []) as string[];
		const filteredTags = tags.filter((t: string) => t !== spreadTag);
		if (filteredTags.length === 0) {
			delete frontmatter.tags;
		} else {
			frontmatter.tags = filteredTags;
		}
	});

	const cache = await readSpreadIndex(app);
	if (cache[spreadName] && cache[spreadName].lastSeq === seq) {
		cache[spreadName].lastSeq = Math.max(0, seq - 1);
		await writeSpreadIndex(app, cache);
	}

	new Notice(`Table Spread [${spreadName}]: Backtracked step ${seq}.`);

	// @ts-ignore
	app.workspace.trigger('go-back');
}
