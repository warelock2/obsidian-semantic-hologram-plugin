import { App, ButtonComponent, FuzzySuggestModal, Modal, Notice, Setting, TFolder, TFile } from 'obsidian';
import type { RelationEdge } from './relations';
import { findIncomingSection, findRelationsSection, formatStrength, scanRelations } from './relations';
import { HOLOGRAM_FOLDER } from './settings';
import { ensureHologramContent, nextAvailablePath } from './importNote';
import { syncIncomingRelationships } from './incoming';
import type SemanticHologramPlugin from './main';

export interface ReviewAddRequest {
	relId: string;
	strength: number;
	reversed: boolean;
}

interface ReviewPair {
	source: TFile;
	target: TFile;
	edges: RelationEdge[];
}

/** Copy notes into `Holograms/` with `hologram-node: true`, collision-safe names. */
export async function bulkImportNotes(plugin: SemanticHologramPlugin, files: TFile[]): Promise<TFile[]> {
	const vault = plugin.app.vault;
	try {
		if (!vault.getAbstractFileByPath(HOLOGRAM_FOLDER)) {
			await vault.createFolder(HOLOGRAM_FOLDER);
		}
	} catch {
		// Folder already exists.
	}
	const imported: TFile[] = [];
	const failed: string[] = [];
	for (const source of files) {
		if (plugin.isInScope(source.path)) {
			continue;
		}
		let content = '';
		try {
			content = await vault.read(source);
		} catch {
			failed.push(source.path);
			continue;
		}
		const defaultType = plugin.settings.nodeTypes[0]?.id ?? 'concept';
		content = ensureHologramContent(content, defaultType);
		try {
			const p = nextAvailablePath(vault, source.basename);
			console.log('Importing to:', p);
			const f = await vault.create(p, content);
			imported.push(f);
			console.log('Imported:', f.path);
		} catch (e) {
			console.error('Import failed for:', source.path, e);
			failed.push(source.path);
		}
	}
	await plugin.refreshGraphs();
	if (imported.length > 0) {
		new Notice(`Imported ${imported.length} note(s) into ${HOLOGRAM_FOLDER}/.`);
	}
	if (failed.length > 0) {
		new Notice(`Failed to import ${failed.length} note(s).`);
	}
	return imported;
}

/** Append a relation line to a note's `## Relations` section, creating it if needed. */
async function addRelationTo(
	plugin: SemanticHologramPlugin,
	sourceFile: TFile,
	targetFile: TFile,
	req: ReviewAddRequest,
): Promise<void> {
	const vault = plugin.app.vault;
	let content = await vault.read(sourceFile);
	const lines = content.split(/\r?\n/);
	const line = `- ${req.relId} [[${targetFile.basename}]]${req.reversed ? ' {R}' : ''} (${formatStrength(req.strength)})`;
	const section = findRelationsSection(content);
	if (section) {
		lines.splice(section.startLine + 1, 0, '', line);
	} else {
		const incoming = findIncomingSection(content);
		lines.splice(incoming ? incoming.startLine : lines.length, 0, '', '## Relations', '', line);
	}
	await vault.modify(sourceFile, lines.join('\n').replace(/\n{3,}/g, '\n\n'));
}

/** Remove a relation line (verbatim `raw`) from the note that hosts it. */
async function removeRelationFrom(plugin: SemanticHologramPlugin, authoringFile: TFile, raw: string): Promise<void> {
	const vault = plugin.app.vault;
	let content = await vault.read(authoringFile);
	const section = findRelationsSection(content);
	if (!section) {
		return;
	}
	const lines = content.split(/\r?\n/);
	const idx = lines.findIndex((l) => l.trim().length > 0 && l.trim() === raw.trim());
	if (idx < 0) {
		return;
	}
	lines.splice(idx, 1);
	if (lines[idx]?.trim() === '') {
		lines.splice(idx, 1);
	}
	await vault.modify(authoringFile, lines.join('\n').replace(/\n{3,}/g, '\n\n'));
}

export class FolderPickModal extends FuzzySuggestModal<TFolder> {
	constructor(
		app: App,
		private plugin: SemanticHologramPlugin,
	) {
		super(app);
		this.setPlaceholder('Pick the folder containing ZK notes to import');
		this.setInstructions([
			{ command: '↑↓', purpose: 'to navigate' },
			{ command: '↵', purpose: 'to choose this folder' },
		]);
	}

	getItems(): TFolder[] {
		return this.app.vault
			.getAllLoadedFiles()
			.filter(
				(f): f is TFolder =>
					f instanceof TFolder &&
					f.path !== HOLOGRAM_FOLDER &&
					!f.path.startsWith(`${HOLOGRAM_FOLDER}/`),
			)
			.sort((a, b) => a.path.localeCompare(b.path));
	}

	getItemText(item: TFolder): string {
		return item.isRoot() ? 'Vault root' : item.path;
	}

	onChooseItem(item: TFolder): void {
		const modal = new BulkImportModal(this.app, this.plugin, item);
		if (modal.getCandidates().length === 0) {
			new Notice('No notes to import there — everything under it is already in the hologram scope.');
			return;
		}
		modal.open();
	}
}

export class BulkImportModal extends Modal {
	private candidates: TFile[] = [];
	private selected = new Set<string>();
	private importBtn: ButtonComponent | null = null;

	constructor(
		app: App,
		private plugin: SemanticHologramPlugin,
		folder: TFolder,
	) {
		super(app);
		const under = folder.isRoot() ? (f: TFile) => true : (f: TFile) => f.path.startsWith(`${folder.path}/`);
		this.candidates = app.vault
			.getMarkdownFiles()
			.filter((f) => under(f) && !plugin.isInScope(f.path))
			.sort((a, b) => a.path.localeCompare(b.path));
		for (const f of this.candidates) {
			this.selected.add(f.path);
		}
	}

	getCandidates(): TFile[] {
		return this.candidates;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('sh-bulk-import-modal');
		contentEl.createEl('h4', { text: `Bulk import — ${this.candidates.length} candidate note(s)` });
		if (this.candidates.length === 0) {
			contentEl.createDiv({ cls: 'sh-review-empty', text: 'Nothing to import: all markdown notes here are already hologram nodes.' });
			new Setting(contentEl).addButton((b) => b.setButtonText('Close').onClick(() => this.close()));
			return;
		}

		const list = contentEl.createDiv({ cls: 'sh-bulk-import-list' });
		this.candidates.forEach((f) => {
			const row = list.createDiv({ cls: 'sh-bulk-import-row' });
			const cb = row.createEl('input', { type: 'checkbox', attr: { 'aria-label': f.path } });
			cb.checked = true;
			cb.addEventListener('change', () => {
				if (cb.checked) {
					this.selected.add(f.path);
				} else {
					this.selected.delete(f.path);
				}
				this.importBtn?.setButtonText(`Import ${this.selected.size} note(s)`);
			});
			const label = row.createEl('label');
			label.setText(f.path);
			label.addEventListener('click', () => {
				cb.checked = !cb.checked;
				cb.dispatchEvent(new Event('change'));
			});
		});

		new Setting(contentEl)
			.addButton((b) =>
				b.setButtonText('Cancel').onClick(() => {
					this.close();
				}),
			)
			.addButton((b) => {
				this.importBtn = b.setButtonText(`Import ${this.selected.size} note(s)`).setCta();
				b.onClick(() => {
					void this.runImport();
				});
			});
	}

	private async runImport(): Promise<void> {
		const files = this.candidates.filter((f) => this.selected.has(f.path));
		this.close();
		const imported = await bulkImportNotes(this.plugin, files);
		if (imported.length === 0) {
			return;
		}
		new ReviewConnectionsModal(this.app, this.plugin, imported).open();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class ReviewConnectionsModal extends Modal {
	private others: TFile[] = [];
	private pairs: ReviewPair[] = [];
	private mode: 'all' | 'random' = 'all';
	private sampleSize = 20;
	private skippedPairs = new Set<string>();

	constructor(
		app: App,
		private plugin: SemanticHologramPlugin,
		private sources: TFile[],
	) {
		super(app);
	}

	async onOpen(): Promise<void> {
		await this.reload();
	}

	private getPairKey(p: ReviewPair): string {
		return [p.source.path, p.target.path].sort().join('|');
	}

	private async reload(): Promise<void> {
		const files = this.plugin.app.vault.getMarkdownFiles();
		const scan = await scanRelations(
			files,
			this.plugin.app.vault,
			this.plugin.app.metadataCache,
			this.plugin.knownRelIds(),
			(path) => this.plugin.isInScope(path),
		);
		const allInScope = files.filter((f) => this.plugin.isInScope(f.path));
		this.others = allInScope.filter((f) => !this.sources.some((s) => s.path === f.path));
		
		const targets = this.others.length > 0 ? this.others : allInScope;
		this.pairs = [];
		const seenPairs = new Set<string>();

		for (const src of this.sources) {
			for (const tgt of targets) {
				if (src.path === tgt.path) {
					continue;
				}
				const pairKey = [src.path, tgt.path].sort().join('|');
				if (seenPairs.has(pairKey)) {
					continue;
				}
				seenPairs.add(pairKey);

				const edges = scan.edges.filter(
					(e) =>
						(e.source === src.path && e.target === tgt.path) ||
						(e.source === tgt.path && e.target === src.path),
				);
				this.pairs.push({ source: src, target: tgt, edges });
			}
		}
		this.render();
	}

	private visiblePairs(): ReviewPair[] {
		if (this.mode === 'all') {
			return this.pairs;
		}
		if (this.pairs.length === 0) {
			return [];
		}
		const copy = [...this.pairs];
		for (let i = copy.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			const a = copy[i];
			const b = copy[j];
			if (a && b) {
				copy[i] = b;
				copy[j] = a;
			}
		}
		return copy.slice(0, Math.min(this.sampleSize, copy.length));
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('sh-review-modal');
		contentEl.createEl('h4', { text: 'Review connections' });
		contentEl.createDiv({
			cls: 'sh-review-sub',
			text: `${this.pairs.length} pair(s) to review.`,
		});

		const toolbar = contentEl.createDiv({ cls: 'sh-review-toolbar' });
		const mkMode = (label: string, mode: 'all' | 'random') => {
			const btn = toolbar.createEl('button', { text: label, cls: 'sh-review-mode' });
			btn.toggleClass('is-active', this.mode === mode);
			btn.addEventListener('click', () => {
				this.mode = mode;
				this.render();
			});
		};
		mkMode('All pairs', 'all');
		mkMode('Random sample', 'random');
		if (this.mode === 'random' && this.pairs.length > 0) {
			const sizeWrap = toolbar.createSpan({ cls: 'sh-review-size' });
			sizeWrap.createSpan({ text: 'sample:' });
			const size = sizeWrap.createEl('input', {
				type: 'number',
				attr: { min: '1', max: String(this.pairs.length), value: String(this.sampleSize) },
			});
			size.addEventListener('change', () => {
				const v = Math.max(1, Math.min(this.pairs.length, parseInt(size.value, 10) || 1));
				this.sampleSize = v;
				this.render();
			});
		}

		const shown = this.visiblePairs();
		contentEl.createDiv({ cls: 'sh-review-sub', text: `Showing ${shown.length} / ${this.pairs.length} pair(s).` });

		if (shown.length === 0) {
			contentEl.createDiv({ cls: 'sh-review-empty', text: 'No pairs to review.' });
		} else {
			const list = contentEl.createDiv({ cls: 'sh-review-list' });
			for (const p of shown) {
				this.renderPairRow(list, p);
			}
		}

		new Setting(contentEl).addButton((b) => b.setButtonText('Done').setCta().onClick(() => this.close()));
	}

	private renderPairRow(list: HTMLElement, p: ReviewPair): void {
		const row = list.createDiv({ cls: 'sh-review-row' });
		const pairKey = this.getPairKey(p);
		row.toggleClass('is-skipped', this.skippedPairs.has(pairKey));

		// Checkbox for skipping
		const skipCheck = row.createEl('input', { type: 'checkbox', cls: 'sh-review-skip' });
		skipCheck.checked = this.skippedPairs.has(pairKey);
		skipCheck.addEventListener('change', () => {
			if (skipCheck.checked) this.skippedPairs.add(pairKey);
			else this.skippedPairs.delete(pairKey);
			row.toggleClass('is-skipped', skipCheck.checked);
		});

		const names = row.createDiv({ cls: 'sh-review-names' });
		names.createSpan({ cls: 'sh-review-name', text: p.source.basename });
		
		const swapBtn = names.createEl('button', { text: '↔', cls: 'sh-review-swap' });
		swapBtn.addEventListener('click', () => {
			const tmp = p.source;
			p.source = p.target;
			p.target = tmp;
			this.render();
		});
		
		names.createSpan({ cls: 'sh-review-name', text: p.target.basename });

		const relationsList = row.createDiv({ cls: 'sh-review-relations' });
		for (const e of p.edges) {
			const relRow = relationsList.createDiv({ cls: 'sh-review-rel' });
			const color = this.plugin.settings.relTypes.find((t) => t.id === e.relId)?.color ?? '#C0C0C0';
			relRow.style.borderColor = color;
			const forward = e.source === p.source.path && e.target === p.target.path;
			relRow.createSpan({ text: `${forward ? '→' : '←'} ${e.relId} (${formatStrength(e.strength)})` });
			
			const del = relRow.createEl('button', { text: '✕', cls: 'sh-review-del' });
			del.addEventListener('click', () => {
				void this.onDeleteEdge(e);
			});
		}

		const addForm = row.createDiv({ cls: 'sh-review-add-form' });
		const enabled = this.plugin.settings.relTypes.filter((t) => t.enabled);
		const relTypes = enabled.length > 0 ? enabled : this.plugin.settings.relTypes;
		
		const dropdown = addForm.createEl('select');
		for (const t of relTypes) dropdown.createEl('option', { value: t.id, text: t.id });
		
		const strength = addForm.createEl('input', { type: 'number', attr: { min: '0', max: '1', step: '0.1', value: '0.5' } });
		
		const addBtn = addForm.createEl('button', { text: 'Add' });
		addBtn.addEventListener('click', () => {
			const req: ReviewAddRequest = {
				relId: dropdown.value,
				strength: parseFloat(strength.value) || 0.5,
				reversed: false // Simplified for now
			};
			void this.onAdd(p, req);
		});
	}

	private async onDeleteEdge(e: RelationEdge): Promise<void> {
		const file = this.plugin.app.vault.getAbstractFileByPath(e.authoredFrom);
		if (file instanceof TFile) {
			await removeRelationFrom(this.plugin, file, e.raw);
			await this.syncAndReload();
		}
	}

	private async syncAndReload(): Promise<void> {
		try {
			await syncIncomingRelationships(
				this.plugin.app.vault.getMarkdownFiles(),
				this.plugin.app.vault,
				this.plugin.app.metadataCache,
				this.plugin.knownRelIds(),
				(path) => this.plugin.isInScope(path),
			);
		} catch (e) {
			new Notice(`Refresh incoming relationships failed: ${String(e)}`);
		}
		await this.plugin.refreshGraphs();
		await this.reload();
	}

	private async onAdd(p: ReviewPair, req: ReviewAddRequest): Promise<void> {
		await addRelationTo(this.plugin, p.source, p.target, req);
		await this.syncAndReload();
	}


	onClose(): void {
		this.contentEl.empty();
	}
}

export class RelationEditModal extends Modal {
	constructor(
		app: App,
		private plugin: SemanticHologramPlugin,
		private pair: ReviewPair,
		private onSave: (req: ReviewAddRequest) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('sh-relation-edit-modal');
		contentEl.createEl('h4', {
			text: `Add relationship: ${this.pair.source.basename} → ${this.pair.target.basename}`,
		});

		const enabled = this.plugin.settings.relTypes.filter((t) => t.enabled);
		const relTypes = enabled.length > 0 ? enabled : this.plugin.settings.relTypes;
		const state: ReviewAddRequest = { relId: relTypes[0]?.id ?? '', strength: 0.5, reversed: false };

		new Setting(contentEl).setName('Relationship type').addDropdown((d) => {
			for (const t of relTypes) {
				d.addOption(t.id, t.id);
			}
			d.setValue(state.relId).onChange((v) => (state.relId = v));
		});

		new Setting(contentEl).setName('Strength').addSlider((s) => {
			s.setLimits(0, 1, 0.05).setValue(state.strength).setDynamicTooltip().onChange((v) => (state.strength = v));
		});

		new Setting(contentEl)
			.setName('Reversed')
			.setDesc('Mark the line with {R}: this note is the destination, the other note is the source.')
			.addToggle((t) => t.setValue(state.reversed).onChange((v) => (state.reversed = v)));

		new Setting(contentEl)
			.addButton((b) =>
				b.setButtonText('Cancel').onClick(() => {
					this.close();
				}),
			)
			.addButton((b) =>
				b.setButtonText('Save').setCta().onClick(() => {
					this.close();
					void this.onSave(state);
				}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}