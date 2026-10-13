import { App, ButtonComponent, FuzzySuggestModal, Modal, Notice, Setting, TFolder, TFile } from 'obsidian';
import type { RelationEdge } from './relations';
import { formatStrength } from './relations';
import { HOLOGRAM_FOLDER, defaultNodeType } from './settings';
import { ensureHologramContent, rewriteLinks, HologramTagModal } from './importNote';
import { auditHologramNodes, HologramAuditModal } from './audit';
import { syncIncomingRelationships } from './incoming';
import type SemanticHologramPlugin from './main';
import {
	addRelation as addRelationShared,
	removeRelation as removeRelationShared,
	collectReviewData,
	setGroupState,
	typeBucketKey,
} from './reviewCommon';
import type { ReviewData, ReviewPair, GroupBucket, GroupSubject, GroupState } from './reviewCommon';

export interface ReviewAddRequest {
	relId: string;
	strength: number;
	reversed: boolean;
}

/** Copy notes into `Holograms/` with `hologram-node: true`, collision-safe names. */
export async function bulkImportNotes(plugin: SemanticHologramPlugin, files: TFile[], hologramTag: string): Promise<TFile[]> {
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
		
		const destPath = `${HOLOGRAM_FOLDER}/${source.basename}.md`;
		const existingFile = vault.getAbstractFileByPath(destPath);
		if (existingFile instanceof TFile) {
			const existingContent = await vault.read(existingFile);
			content = existingContent + '\n\n' + content;
		}
		
		content = rewriteLinks(plugin, content);
		content = ensureHologramContent(content, defaultNodeType(plugin.settings.nodeTypes), source, plugin, hologramTag);
		try {
			if (existingFile instanceof TFile) {
				await vault.modify(existingFile, content);
				imported.push(existingFile);
			} else {
				const f = await vault.create(destPath, content);
				imported.push(f);
			}
		} catch (e) {
			console.error('Import failed for:', source.path, e);
			failed.push(source.path);
		}
	}
	await plugin.refreshIncomingRelationships();
	await plugin.refreshGraphs();
	if (imported.length > 0) {
		new Notice(`Imported ${imported.length} note(s) into ${HOLOGRAM_FOLDER}/.`);
		const auditResults = await auditHologramNodes(plugin);
		if (auditResults.length > 0) {
			new HologramAuditModal(plugin.app, plugin, auditResults).open();
		}
	}
	if (failed.length > 0) {
		new Notice(`Failed to import ${failed.length} note(s).`);
	}
	return imported;
}

export class FolderPickModal extends FuzzySuggestModal<TFolder> {
	constructor(
		app: App,
		private plugin: SemanticHologramPlugin,
	) {
		super(app);
		this.setPlaceholder('Pick the folder containing zk notes to import');
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
		const under = folder.isRoot() ? (_f: TFile) => true : (f: TFile) => f.path.startsWith(`${folder.path}/`);
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

		this.contentEl.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				void this.runImport();
			}
		});

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
		new HologramTagModal(this.app, (tag) => {
			void bulkImportNotes(this.plugin, files, tag).then((imported) => {
				if (imported.length === 0) {
					return;
				}
				new ReviewConnectionsModal(this.app, this.plugin).open();
			});
		}).open();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class ReviewConnectionsModal extends Modal {
	private data: ReviewData | null = null;
	private activeTab: 'pairings' | 'groups' | 'holograms' = 'pairings';
	private mode: 'all' | 'random' = 'all';
	private sampleSize = 20;
	private dirByPair = new Map<string, boolean>();

	constructor(
		app: App,
		private plugin: SemanticHologramPlugin,
		_sources?: TFile[],
		private onCloseCallback?: () => void,
	) {
		super(app);
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass('sh-review-modal');
		await this.reload();
	}

	private async reload(): Promise<void> {
		this.dirByPair.clear();
		this.data = await collectReviewData(this.plugin);
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		const header = contentEl.createDiv({ cls: 'sh-review-header-container' });
		header.createEl('h4', { text: 'Review connections' });

		const tabs = contentEl.createDiv({ cls: 'sh-review-tabs' });
		const mkTab = (label: string, tab: 'pairings' | 'groups' | 'holograms') => {
			const btn = tabs.createEl('button', { text: label, cls: 'sh-review-tab' });
			btn.toggleClass('is-active', this.activeTab === tab);
			btn.addEventListener('click', () => {
				this.activeTab = tab;
				this.render();
			});
		};
		mkTab('Pairings', 'pairings');
		mkTab('Groups', 'groups');
		mkTab('Holograms', 'holograms');

		const scroll = contentEl.createDiv({ cls: 'sh-review-scroll' });

		if (!this.data) {
			return;
		}
		if (this.activeTab === 'pairings') {
			this.renderPairings(scroll);
		} else if (this.activeTab === 'groups') {
			this.renderGroups(scroll);
		} else {
			this.renderHolograms(scroll);
		}
	}

	private visiblePairs(): ReviewPair[] {
		if (!this.data) {
			return [];
		}
		if (this.mode === 'all') {
			return this.data.pairs;
		}
		if (this.data.pairs.length === 0) {
			return [];
		}
		const copy = [...this.data.pairs];
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

	private renderPairings(scroll: HTMLElement): void {
		if (!this.data) {
			return;
		}
		scroll.createDiv({
			cls: 'sh-review-sub',
			text: `${this.data.pairs.length} possible pair(s).`,
		});

		const toolbar = scroll.createDiv({ cls: 'sh-review-toolbar' });
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
		if (this.mode === 'random' && this.data.pairs.length > 0) {
			const sizeWrap = toolbar.createSpan({ cls: 'sh-review-size' });
			sizeWrap.createSpan({ text: 'sample:' });
			const size = sizeWrap.createEl('input', {
				type: 'number',
				attr: { min: '1', max: String(this.data.pairs.length), value: String(this.sampleSize) },
			});
			size.addEventListener('change', () => {
				const v = Math.max(1, Math.min(this.data?.pairs.length ?? 1, parseInt(size.value, 10) || 1));
				this.sampleSize = v;
				this.render();
			});
		}

		const shown = this.visiblePairs();
		if (shown.length === 0) {
			scroll.createDiv({ cls: 'sh-review-empty', text: 'No pairs to review.' });
			return;
		}

		const buckets = new Map<string, ReviewPair[]>();
		for (const p of shown) {
			const key = typeBucketKey(p.sourceType, p.targetType);
			const arr = buckets.get(key) ?? [];
			arr.push(p);
			buckets.set(key, arr);
		}
		const sorted = [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]));

		const list = scroll.createDiv({ cls: 'sh-review-list' });
		for (const [bucketKey, pairs] of sorted) {
			const [ta, tb] = bucketKey.split('|');
			const bucketHeader = list.createDiv({ cls: 'sh-review-bucket' });
			bucketHeader.createSpan({
				cls: 'sh-review-bucket-label',
				text: `${ta} — ${tb} (${pairs.length})`,
			});
			for (const p of pairs) {
				this.renderPairRow(list, p);
			}
		}
	}

	private pairKey(p: ReviewPair): string {
		return `${p.source.path}|${p.target.path}`;
	}

	private pairDir(p: ReviewPair): boolean {
		const v = this.dirByPair.get(this.pairKey(p));
		return v === undefined ? true : v;
	}

	private renderPairRow(list: HTMLElement, p: ReviewPair): void {
		const row = list.createDiv({ cls: 'sh-review-row' });

		const header = row.createDiv({ cls: 'sh-review-header' });
		const names = header.createDiv({ cls: 'sh-review-names' });

		const dirForward = this.pairDir(p);
		const left = dirForward ? p.source : p.target;
		const right = dirForward ? p.target : p.source;

		names.createSpan({
			cls: 'sh-review-name',
			text: left.basename,
			attr: { title: left.basename },
		});

		const dirBtn = names.createEl('button', {
			text: dirForward ? '→' : '←',
			cls: 'sh-review-btn sh-review-dir',
		});
		dirBtn.setAttribute('title', dirForward ? 'Source → Target' : 'Target → Source');
		dirBtn.addEventListener('click', () => {
			this.dirByPair.set(this.pairKey(p), !dirForward);
			this.render();
		});

		names.createSpan({
			cls: 'sh-review-name',
			text: right.basename,
			attr: { title: right.basename },
		});

		const addBtn = header.createEl('button', { text: '+', cls: 'sh-review-btn sh-review-add-rel' });
		addBtn.setAttribute('title', 'Add relationship');
		addBtn.addEventListener('click', () => {
			this.renderAddEdgeRow(relsContainer, p);
		});

		const relsContainer = row.createDiv({ cls: 'sh-review-rels-container' });
		for (const e of p.edges) {
			this.renderEdgeRow(relsContainer, p, e);
		}
	}

	private renderEdgeRow(container: HTMLElement, p: ReviewPair, e: RelationEdge): void {
		const relRow = container.createDiv({ cls: 'sh-review-rel-row' });

		const forward = e.source === p.source.path && e.target === p.target.path;

		relRow.createSpan({
			cls: 'sh-review-rel-type',
			text: `${e.relId} (${formatStrength(e.strength)})`,
		});

		const controls = relRow.createDiv({ cls: 'sh-review-rel-controls' });

		const toggle = controls.createEl('button', {
			text: forward ? '→' : '←',
			cls: 'sh-review-btn sh-review-rel-toggle',
		});
		toggle.setAttribute('title', 'Toggle direction (left/right)');
		toggle.addEventListener('click', () => {
			void this.onDeleteEdge(e).then(() => {
				void this.onAdd(p, { relId: e.relId, strength: e.strength, reversed: !e.reversed });
			});
		});

		const edit = controls.createEl('button', { text: '✎', cls: 'sh-review-btn sh-review-rel-toggle' });
		edit.setAttribute('title', 'Edit relationship type and strength');
		edit.addEventListener('click', () => {
			new RelationEditModal(
				this.app,
				this.plugin,
				p,
				async (req) => {
					await removeRelationShared(this.plugin, this.fileOf(e.authoredFrom)!, e.raw);
					await this.onAdd(p, req);
				},
				{ relId: e.relId, strength: e.strength, reversed: e.reversed },
			).open();
		});

		const del = controls.createEl('button', { text: '✕', cls: 'sh-review-btn sh-review-rel-del' });
		del.setAttribute('title', 'Delete relationship');
		del.addEventListener('click', () => {
			void this.onDeleteEdge(e);
		});
	}

	private fileOf(path: string): TFile | null {
		const f = this.plugin.app.vault.getAbstractFileByPath(path);
		return f instanceof TFile ? f : null;
	}

	private renderAddEdgeRow(container: HTMLElement, p: ReviewPair): void {
		const relRow = container.createDiv({ cls: 'sh-review-rel-row' });

		const enabled = this.plugin.settings.relTypes.filter((t) => t.enabled);
		const relTypes = enabled.length > 0 ? enabled : this.plugin.settings.relTypes;

		const dropdown = relRow.createEl('select');
		dropdown.addClass('sh-margin-right-8');
		for (const t of relTypes) dropdown.createEl('option', { value: t.id, text: t.id });

		const strengthInput = relRow.createEl('input', {
			type: 'number',
			cls: 'sh-w-60',
			attr: {
				min: '0.01',
				max: '1',
				step: '0.01',
				value: String(this.plugin.settings.defaultRelStrength ?? 0.5),
				title: 'Strength',
			},
		});

		const controls = relRow.createDiv({ cls: 'sh-review-rel-controls sh-margin-left-auto sh-flex-center sh-flex-gap-4' });

		const saveBtn = controls.createEl('button', { text: '✓', cls: 'sh-review-btn sh-review-save-btn' });
		saveBtn.addEventListener('click', () => {
			void this.onAdd(p, {
				relId: dropdown.value,
				strength: parseFloat(strengthInput.value) || (this.plugin.settings.defaultRelStrength ?? 0.5),
				reversed: !this.pairDir(p),
			});
			relRow.remove();
		});

		const cancelBtn = controls.createEl('button', { text: '✕', cls: 'sh-review-btn sh-review-rel-del' });
		cancelBtn.addEventListener('click', () => {
			relRow.remove();
		});
	}

	private async onDeleteEdge(e: RelationEdge): Promise<void> {
		const file = this.fileOf(e.authoredFrom);
		if (file) {
			await removeRelationShared(this.plugin, file, e.raw);
			await this.syncAndReload();
		}
	}

	private async onAdd(p: ReviewPair, req: ReviewAddRequest): Promise<void> {
		const dirForward = this.pairDir(p);
		const source = dirForward ? p.source : p.target;
		const target = dirForward ? p.target : p.source;
		await addRelationShared(this.plugin, source, target, req.relId, req.strength, req.reversed);
		await this.syncAndReload();
	}

	private async syncAndReload(): Promise<void> {
		try {
			await syncIncomingRelationships(
				this.plugin.app.vault.getMarkdownFiles(),
				this.plugin.app.vault,
				this.plugin.app.metadataCache,
				this.plugin.knownRelIds(),
				this.plugin.settings.defaultRelStrength,
				(path) => this.plugin.isInScope(path),
			);
		} catch (e) {
			new Notice(`Refresh incoming relationships failed: ${String(e)}`);
		}
		await this.plugin.refreshGraphs();
		await this.reload();
	}

	// ─── Groups ──────────────────────────────────────────────────────────────

	private renderGroups(scroll: HTMLElement): void {
		const data = this.data;
		if (!data) {
			return;
		}
		const groups = data.groups.filter((g) => g.groupType !== 'percept');
		const total = groups.reduce((s, g) => s + g.members.length + g.deleted.length + g.candidates.length, 0);
		scroll.createDiv({
			cls: 'sh-review-sub',
			text: `${groups.length} group(s), ${total} membership(s) to review.`,
		});

		if (groups.length === 0) {
			scroll.createDiv({ cls: 'sh-review-empty', text: 'No groups: create notes with a valid group node type (anything but a percept).' });
			return;
		}

		const list = scroll.createDiv({ cls: 'sh-review-list' });
		for (const g of groups) {
			this.renderGroupBucket(list, g);
		}
	}

	private renderGroupBucket(list: HTMLElement, g: GroupBucket): void {
		const bucket = list.createDiv({ cls: 'sh-review-bucket' });

		const head = bucket.createDiv({ cls: 'sh-review-group-head' });
		head.createSpan({
			cls: 'sh-review-group-name',
			text: `${g.group.basename}`,
			attr: { title: g.group.path },
		});
		head.createSpan({ cls: 'sh-review-group-type', text: g.groupType });
		head.createSpan({
			cls: 'sh-review-group-count',
			text: `${g.members.length} member(s), ${g.candidates.length} candidate(s)`,
		});

		this.renderSubjectSection(bucket, 'Members', g.members, g.group.basename, 'member');
		this.renderSubjectSection(bucket, 'Candidates', g.candidates, g.group.basename, 'candidate');
		this.renderSubjectSection(bucket, `Deleted (${g.deleted.length})`, g.deleted, g.group.basename, 'deleted', true);
	}

	private renderSubjectSection(
		bucket: HTMLElement,
		label: string,
		list: GroupSubject[],
		groupName: string,
		currentState: GroupState,
		collapsed = false,
	): void {
		const section = bucket.createDiv({ cls: 'sh-review-subject-section' });
		const toggleBtn = section.createEl('button', {
			text: `${collapsed ? '▸' : '▾'} ${label} (${list.length})`,
			cls: 'sh-review-section-toggle',
		});
		const container = section.createDiv({ cls: 'sh-review-subject-list' });
		if (collapsed) {
			container.addClass('is-collapsed');
		}
		toggleBtn.addEventListener('click', () => {
			const isHidden = container.hasClass('is-collapsed');
			container.toggleClass('is-collapsed', !isHidden);
			toggleBtn.setText(`${!isHidden ? '▸' : '▾'} ${label} (${list.length})`);
		});

		if (list.length === 0) {
			container.createDiv({ cls: 'sh-review-subject-empty', text: '—' });
			return;
		}
		for (const s of list) {
			const subRow = container.createDiv({ cls: 'sh-review-subject-row' });
			subRow.createSpan({ cls: 'sh-review-subject-name', text: s.node.basename, attr: { title: s.node.path } });
			subRow.createSpan({ cls: 'sh-review-subject-type', text: s.noteType });

			const controls = subRow.createDiv({ cls: 'sh-review-rel-controls sh-margin-left-auto sh-flex-center sh-flex-gap-4' });

			const mkStateBtn = (label: string, state: GroupState, title?: string) => {
				const b = controls.createEl('button', { text: label, cls: 'sh-review-btn sh-review-subject-state' });
				b.setAttribute('title', title ?? `Set to ${state}`);
				b.addEventListener('click', () => {
					void this.onGroupState(s, groupName, state);
				});
			};

			if (currentState === 'member') {
				mkStateBtn('Candidate', 'candidate', 'Remove membership');
				mkStateBtn('Deleted', 'deleted', 'Exclude from this group');
			} else if (currentState === 'candidate') {
				mkStateBtn('Member', 'member', 'Add to group');
				mkStateBtn('Deleted', 'deleted', 'Exclude from this group');
			} else {
				mkStateBtn('Candidate', 'candidate', 'Restore as candidate');
				mkStateBtn('Member', 'member', 'Add to group');
			}
		}
	}

	private async onGroupState(s: GroupSubject, groupName: string, state: GroupState): Promise<void> {
		await setGroupState(this.plugin, s.node, groupName, state);
		await this.syncAndReload();
	}

	private renderHolograms(scroll: HTMLElement): void {
		if (!this.data) return;

		const tagMap = new Map<string, TFile[]>();
		for (const file of this.data.nodes) {
			const tags = this.plugin.hologramService.getTags(file.path);
			for (const t of tags) {
				const arr = tagMap.get(t) ?? [];
				arr.push(file);
				tagMap.set(t, arr);
			}
		}

		scroll.createDiv({
			cls: 'sh-review-sub',
			text: `${tagMap.size} hologram tag(s) across ${this.data.nodes.length} note(s).`,
		});

		if (tagMap.size === 0) {
			scroll.createDiv({ cls: 'sh-review-empty', text: 'No hologram tags assigned yet.' });
			return;
		}

		const list = scroll.createDiv({ cls: 'sh-review-list' });
		for (const [tag, files] of tagMap.entries()) {
			const bucket = list.createDiv({ cls: 'sh-review-bucket' });
			const head = bucket.createDiv({ cls: 'sh-review-group-head' });
			head.createSpan({ cls: 'sh-review-group-name', text: tag });
			head.createSpan({ cls: 'sh-review-group-count', text: `${files.length} note(s)` });

			const subList = bucket.createDiv({ cls: 'sh-review-subject-list' });
			for (const file of files) {
				const row = subList.createDiv({ cls: 'sh-review-subject-row' });
				row.createSpan({ cls: 'sh-review-subject-name', text: file.basename, attr: { title: file.path } });
				const controls = row.createDiv({ cls: 'sh-review-rel-controls sh-margin-left-auto' });
				const removeBtn = controls.createEl('button', { text: '✕', cls: 'sh-review-btn sh-review-rel-del' });
				removeBtn.setAttribute('title', 'Remove hologram tag');
				removeBtn.addEventListener('click', () => {
					void this.plugin.hologramService.removeTag(file, tag).then(() => this.reload());
				});
			}
		}
	}

	onClose(): void {
		this.contentEl.empty();
		this.onCloseCallback?.();
	}
}

export class RelationEditModal extends Modal {
	constructor(
		app: App,
		private plugin: SemanticHologramPlugin,
		private pair: ReviewPair,
		private onSave: (req: ReviewAddRequest) => Promise<void>,
		private initial?: ReviewAddRequest,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('sh-relation-edit-modal');
		contentEl.createEl('h4', {
			text: `${this.initial ? 'Edit' : 'Add'} relationship: ${this.pair.source.basename} → ${this.pair.target.basename}`,
		});

		const enabled = this.plugin.settings.relTypes.filter((t) => t.enabled);
		const relTypes = enabled.length > 0 ? enabled : this.plugin.settings.relTypes;
		const state: ReviewAddRequest = this.initial
			? { ...this.initial }
			: { relId: relTypes[0]?.id ?? '', strength: this.plugin.settings.defaultRelStrength ?? 0.5, reversed: false };

		new Setting(contentEl).setName('Relationship type').addDropdown((d) => {
			for (const t of relTypes) {
				d.addOption(t.id, t.id);
			}
			d.setValue(state.relId).onChange((v) => (state.relId = v));
		});

		new Setting(contentEl).setName('Strength').addSlider((s) => {
			s.setLimits(0.01, 1, 0.01).setValue(state.strength).setDynamicTooltip().onChange((v) => (state.strength = v));
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
