import { ItemView, WorkspaceLeaf, TFile, Notice, Setting } from 'obsidian';
import type SemanticHologramPlugin from './main';
import { scanRelations, formatStrength, RelationEdge } from './relations';
import { findRelationsSection, findIncomingSection } from './relations';
import { HOLOGRAM_FOLDER } from './settings';

export const VIEW_TYPE_REVIEW_CONNECTIONS = 'review-connections-view';

interface ReviewPair {
	source: TFile;
	target: TFile;
	edges: RelationEdge[];
}

export interface ReviewAddRequest {
	relId: string;
	strength: number;
	reversed: boolean;
}

export class ReviewConnectionsView extends ItemView {
	private pairs: ReviewPair[] = [];
	private mode: 'all' | 'random' = 'all';
	private sampleSize = 20;
	private sources: TFile[] = [];

	constructor(leaf: WorkspaceLeaf, private plugin: SemanticHologramPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_REVIEW_CONNECTIONS;
	}

	getDisplayText(): string {
		return 'Review Connections';
	}

	getIcon(): string {
		return 'link';
	}

	async onOpen(): Promise<void> {
		const files = this.plugin.app.vault.getMarkdownFiles().filter((f) => this.plugin.isInScope(f.path));
		this.sources = files;
		await this.reload();
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
		const allFiles = files;
		const others = allFiles.filter((f) => !this.sources.some((s) => s.path === f.path));
		const targets = others.length > 0 ? others : allFiles;
		
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
				
				const isRelated = await this.hasWikilinkConnection(src, tgt);
				if (edges.length > 0 || isRelated) {
					this.pairs.push({ source: src, target: tgt, edges });
				}
			}
		}
		this.pairs.sort((a, b) => {
			const aSrc = a.source.basename.toLowerCase();
			const bSrc = b.source.basename.toLowerCase();
			if (aSrc !== bSrc) return aSrc.localeCompare(bSrc);
			return a.target.basename.toLowerCase().localeCompare(b.target.basename.toLowerCase());
		});
		this.render();
	}

	private async hasWikilinkConnection(f1: TFile, f2: TFile): Promise<boolean> {
		try {
			const content1 = await this.plugin.app.vault.read(f1);
			const content2 = await this.plugin.app.vault.read(f2);
			const link1 = `[[${f2.basename}]]`;
			const link2 = `[[${f1.basename}]]`;
			return content1.includes(link1) || content2.includes(link2);
		} catch {
			return false;
		}
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
        contentEl.addClass('sh-review-view');
        
        // Ensure the view container fills the available height
        contentEl.style.display = 'flex';
        contentEl.style.flexDirection = 'column';
        contentEl.style.height = '100%';
        contentEl.style.boxSizing = 'border-box';
        contentEl.style.overflow = 'hidden';

        const header = contentEl.createDiv({ cls: 'sh-review-header-container' });
        header.createEl('h4', { text: 'Review connections' });
        
        const sub = header.createDiv({
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
        
        // Ensure the list container is scrollable and fills the remaining height
        const list = contentEl.createDiv({ cls: 'sh-review-list' });
        list.style.flex = '1';
        list.style.overflowY = 'auto';

        if (shown.length === 0) {
            contentEl.createDiv({ cls: 'sh-review-empty', text: 'No pairs to review.' });
        } else {
            for (const p of shown) {
                this.renderPairRow(list, p);
            }
        }
    }

	private renderPairRow(list: HTMLElement, p: ReviewPair): void {
		const row = list.createDiv({ cls: 'sh-review-row' });
		
		const header = row.createDiv({ cls: 'sh-review-header' });
		const names = header.createDiv({ cls: 'sh-review-names' });
		
		const leftName = names.createSpan({ cls: 'sh-review-name', text: p.source.basename, attr: { title: p.source.basename } });
		leftName.style.justifySelf = 'center';
		
		const arrow = names.createSpan({ text: '→' });
		arrow.style.justifySelf = 'center';
		
		const rightName = names.createSpan({ cls: 'sh-review-name', text: p.target.basename, attr: { title: p.target.basename } });
		rightName.style.justifySelf = 'center';

		const addBtn = header.createEl('button', { text: '+', cls: 'sh-review-btn sh-review-add-rel' });
		addBtn.setAttribute('title', 'Add relationship');
		addBtn.addEventListener('click', () => {
			this.renderAddEdgeRow(relsContainer, p);
		});

		const relsContainer = row.createDiv({ cls: 'sh-review-rels-container' });
		for (const e of p.edges) {
			const relRow = relsContainer.createDiv({ cls: 'sh-review-rel-row' });
			const forward = e.source === p.source.path && e.target === p.target.path;
			
			const typeSpan = relRow.createSpan({ cls: 'sh-review-rel-type', text: `${e.relId} (${formatStrength(e.strength)})` });
			typeSpan.style.flex = '1';
			typeSpan.style.textAlign = 'left';
			
			const controls = relRow.createDiv({ cls: 'sh-review-rel-controls' });
			controls.style.marginLeft = 'auto';
			controls.style.display = 'flex';
			controls.style.gap = '4px';

			const toggle = controls.createEl('button', { text: forward ? '→' : '←', cls: 'sh-review-btn sh-review-rel-toggle' });
			toggle.setAttribute('title', 'Toggle direction');
			toggle.addEventListener('click', () => {
				void this.onDeleteEdge(e).then(() => {
					void this.onAdd(p, { relId: e.relId, strength: e.strength, reversed: !e.reversed });
				});
			});

			const del = controls.createEl('button', { text: '✕', cls: 'sh-review-btn sh-review-rel-del' });
			del.setAttribute('title', 'Delete relationship');
			del.addEventListener('click', () => {
				void this.onDeleteEdge(e);
			});
		}
	}

	private renderAddEdgeRow(container: HTMLElement, p: ReviewPair) {
		const relRow = container.createDiv({ cls: 'sh-review-rel-row' });
		
		const enabled = this.plugin.settings.relTypes.filter((t) => t.enabled);
		const relTypes = enabled.length > 0 ? enabled : this.plugin.settings.relTypes;
		
		const dropdown = relRow.createEl('select');
		dropdown.style.marginRight = '8px';
		for (const t of relTypes) dropdown.createEl('option', { value: t.id, text: t.id });
		
		const strengthInput = relRow.createEl('input', { 
			type: 'number', 
			attr: { min: '0', max: '1', step: '0.1', value: '0.5', title: 'Strength' } 
		});
		strengthInput.style.width = '60px';

		const controls = relRow.createDiv({ cls: 'sh-review-rel-controls' });
		controls.style.marginLeft = 'auto';
		controls.style.display = 'flex';
		controls.style.gap = '4px';

		const saveBtn = controls.createEl('button', { text: '✓', cls: 'sh-review-btn sh-review-save-btn' });
		saveBtn.addEventListener('click', () => {
			const req: ReviewAddRequest = {
				relId: dropdown.value,
				strength: parseFloat(strengthInput.value) || 0.5,
				reversed: false
			};
			void this.onAdd(p, req);
			relRow.remove();
		});
		
		const cancelBtn = controls.createEl('button', { text: '✕', cls: 'sh-review-btn sh-review-rel-del' });
		cancelBtn.addEventListener('click', () => {
			relRow.remove();
		});
	}

	private async onDeleteEdge(e: RelationEdge): Promise<void> {
		const file = this.plugin.app.vault.getAbstractFileByPath(e.authoredFrom);
		if (file instanceof TFile) {
			await this.removeRelationFrom(file, e.raw);
			await this.syncAndReload();
		}
	}

	private async removeRelationFrom(authoringFile: TFile, raw: string): Promise<void> {
		const vault = this.plugin.app.vault;
		const content = await vault.read(authoringFile);
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

	private async syncAndReload(): Promise<void> {
		await this.plugin.refreshGraphs();
		await this.reload();
	}

	private async onAdd(p: ReviewPair, req: ReviewAddRequest): Promise<void> {
		const vault = this.plugin.app.vault;
		let content = await vault.read(p.source);
		const lines = content.split(/\r?\n/);
		const line = `- ${req.relId} [[${p.target.basename}]]${req.reversed ? ' {R}' : ''} (${formatStrength(req.strength)})`;
		const section = findRelationsSection(content);
		if (section) {
			lines.splice(section.startLine + 1, 0, '', line);
		} else {
			const incoming = findIncomingSection(content);
			lines.splice(incoming ? incoming.startLine : lines.length, 0, '', '## Relations', '', line);
		}
		await vault.modify(p.source, lines.join('\n').replace(/\n{3,}/g, '\n\n'));
		await this.syncAndReload();
	}
}
