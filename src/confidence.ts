import { App, Modal, Notice, Setting, TFile } from 'obsidian';
import type SemanticHologramPlugin from './main';
import { scanRelations, extractFrontmatter, parseNoteFrontmatter, setGravitasRowsInContent, findGravitasSection } from './relations';
import type { NodeStats } from './gravitas';
import { computeNodeStats, isEvidenceType, readNodeMetasFresh, scanGravitas } from './gravitas';
import { defaultNodeType } from './settings';

/** Set (or add) the `local-confidence:` frontmatter field of a note body. */
export function setConfidenceInContent(content: string, value: number): string {
	const v = formatNumber(Math.min(1, Math.max(0, value)));
	const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!m) {
		return `---\nlocal-confidence: ${v}\n---\n\n${content}`;
	}
	let body = m[1]!;
	if (/^local-confidence:/im.test(body)) {
		body = body.replace(/^local-confidence:.*$/im, `local-confidence: ${v}`);
	} else {
		body = `${body.trimEnd()}\nlocal-confidence: ${v}`;
	}
	return `---\n${body}\n---${content.slice(m[0].length)}`;
}

function formatNumber(v: number): string {
	const s = v.toFixed(2);
	if (s.endsWith('.00')) {
		return s.slice(0, s.length - 3);
	}
	if (s.endsWith('0')) {
		return s.slice(0, s.length - 1);
	}
	return s;
}

interface ConfidenceMap {
	path: string;
	value: number | null;
	nodeType: string;
}

export async function readConfidences(
	app: App,
	files: TFile[],
	defaultType: string = defaultNodeType(undefined),
): Promise<ConfidenceMap[]> {
	return files.map((f) => {
		const cache = app.metadataCache.getFileCache(f);
		const fm = (cache?.frontmatter ?? {}) as Record<string, unknown>;
		const localRaw = fm['local-confidence'] ?? fm['confidence'];
		const local = typeof localRaw === 'number' ? localRaw : null;
		const confidence = typeof local === 'number' ? Math.min(1, Math.max(0, local)) : null;
		const rawNodeType = typeof fm['node-type'] === 'string' ? fm['node-type'] : (typeof fm['note-type'] === 'string' ? fm['note-type'] : null);
		const nodeType = rawNodeType ?? defaultType;
		return { path: f.path, value: confidence, nodeType };
	});
}

/**
 * Average confidence of every node in a node's subtree (via
 * `structural/subsumed-by` edges), shown as a percentage — a proxy for the
 * user's felt command of that topic. Nodes without a confidence are skipped.
 */
export async function computeTopicKnowledge(
	plugin: SemanticHologramPlugin,
	files: TFile[],
): Promise<Map<string, { aggregate: number | null; size: number }>> {
	const scan = await scanRelations(
		files,
		plugin.app.vault,
		plugin.app.metadataCache,
		plugin.knownRelIds(),
		plugin.settings.defaultRelStrength,
		(path) => plugin.isInScope(path),
	);

	const childrenOf = new Map<string, string[]>();
	for (const e of scan.edges) {
		if (e.relId !== 'structural/subsumed-by') {
			continue;
		}
		const arr = childrenOf.get(e.target) ?? [];
		arr.push(e.source);
		childrenOf.set(e.target, arr);
	}

	const confidences = new Map<string, number>();
	for (const c of await readConfidences(plugin.app, files, defaultNodeType(plugin.settings.nodeTypes))) {
		if (c.value !== null) {
			confidences.set(c.path, c.value);
		}
	}

	const result = new Map<string, { aggregate: number | null; size: number }>();
	for (const f of files) {
		const seen = new Set<string>();
		const stack = [...(childrenOf.get(f.path) ?? [])];
		const values: number[] = [];
		while (stack.length > 0) {
			const p = stack.pop()!;
			if (seen.has(p)) {
				continue;
			}
			seen.add(p);
			const v = confidences.get(p);
			if (v !== undefined) {
				values.push(v);
			}
			stack.push(...(childrenOf.get(p) ?? []));
		}
		const aggregate = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
		result.set(f.path, { aggregate, size: values.length });
	}
	return result;
}

interface GravitasRow {
	targetName: string;
	amount: number;
}

interface GravitasEntry {
	file: TFile;
	kind: string | null;
	kindPercent: number;
	rows: GravitasRow[];
}

/** Review all hologram nodes (Confidence tab) and evidence notes (Gravitas tab). */
export class NodeConfidenceModal extends Modal {
	private plugin: SemanticHologramPlugin;
	private stats: Map<string, NodeStats> = new Map();
	private confEntries: Array<{ file: TFile; local: number; inherited: number; total: number; knowledgeTitle: string | null }> = [];
	private gravEntries: GravitasEntry[] = [];
	private activeTab: 'confidence' | 'gravitas' = 'confidence';

	constructor(
		app: App,
		plugin: SemanticHologramPlugin,
	) {
		super(app);
		this.plugin = plugin;
	}

	async onOpen(): Promise<void> {
		const scope = new Set<string>();
		const files = this.plugin.app.vault.getMarkdownFiles().filter((f) => this.plugin.isInScope(f.path));
		for (const f of files) {
			scope.add(f.path);
		}
		const metas = await readNodeMetasFresh(
			files,
			this.plugin.app.vault,
			this.plugin.settings.defaultConfidence,
			defaultNodeType(this.plugin.settings.nodeTypes),
		);
		const scan = await scanRelations(
			files,
			this.plugin.app.vault,
			this.plugin.app.metadataCache,
			this.plugin.knownRelIds(),
			this.plugin.settings.defaultRelStrength,
			(path) => this.plugin.isInScope(path),
		);
		const gscan = await scanGravitas(
			files,
			this.plugin.app.vault,
			this.plugin.app.metadataCache,
			(path) => this.plugin.isInScope(path),
			defaultNodeType(this.plugin.settings.nodeTypes),
		);
		this.stats = computeNodeStats(metas, scan.edges, gscan.edges, this.plugin.settings.sourceKinds, this.plugin.settings.defaultConfidence);
		const topic = await computeTopicKnowledge(this.plugin, files);

		const resolve = (name: string, sourcePath: string): string | null => {
			const file = this.plugin.app.metadataCache.getFirstLinkpathDest(name, sourcePath);
			if (file && this.plugin.isInScope(file.path)) {
				return file.path;
			}
			return null;
		};

		this.confEntries = files
			.filter((f) => !isEvidenceType(metas.get(f.path)?.nodeType))
			.map((f) => {
				const st = this.stats.get(f.path);
				const knowledge = topic.get(f.path);
				return {
					file: f,
					local: st?.confidenceLocal ?? this.plugin.settings.defaultConfidence,
					inherited: st?.confidenceInherited ?? 0,
					total: st?.confidenceTotal ?? this.plugin.settings.defaultConfidence,
					knowledgeTitle:
						knowledge && knowledge.aggregate !== null
							? `Knowledge: ${Math.round(knowledge.aggregate * 100)}% (${knowledge.size} node${knowledge.size === 1 ? '' : 's'})`
							: null,
				};
			})
			.sort((a, b) => a.file.basename.localeCompare(b.file.basename));

		this.gravEntries = [];
		for (const f of files) {
			const meta = metas.get(f.path);
			if (!meta || !isEvidenceType(meta.nodeType)) {
				continue;
			}
			let content = '';
			try {
				content = await this.plugin.app.vault.cachedRead(f);
			} catch {
				content = '';
			}
			const fm = parseNoteFrontmatter(extractFrontmatter(content));
			const entries: GravitasRow[] = [];
			if (findGravitasSection(content)) {
				const parsed = parseGravitasSectionJson(content, resolve, f.path);
				for (const e of parsed) {
					entries.push({ targetName: targetLabel(e.target), amount: e.amount });
				}
			}
			const kind = fm.sourceKind;
			const kindPercent = this.plugin.settings.sourceKinds.find((k) => k.id === kind)?.percent ?? 0;
			this.gravEntries.push({ file: f, kind, kindPercent, rows: entries });
		}
		this.gravEntries.sort((a, b) => a.file.basename.localeCompare(b.file.basename));

		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('sh-review-modal');

		const tabs = contentEl.createDiv({ cls: 'sh-review-tabs' });
		const mkTab = (key: 'confidence' | 'gravitas', label: string) => {
			const btn = tabs.createEl('button', { text: label, cls: 'sh-review-tab' });
			btn.addClass(this.activeTab === key ? 'is-active' : '');
			btn.addEventListener('click', () => {
				this.activeTab = key;
				this.render();
			});
			return btn;
		};
		mkTab('confidence', `Confidence (${this.confEntries.length} nodes)`);
		mkTab('gravitas', `Gravitas (${this.gravEntries.length} sources)`);

		const panel = contentEl.createDiv({ cls: 'sh-review-panel' });
		if (this.activeTab === 'confidence') {
			this.renderConfidence(panel);
		} else {
			this.renderGravitas(panel);
		}
	}

	private renderConfidence(panel: HTMLElement): void {
		panel.createDiv({
			cls: 'sh-review-sub',
			text: "Local confidence is user-set (#'.##' or slider). Inherited = Σ children's total confidence; total = local + inherited, capped at 1.",
		});
		const list = panel.createDiv({ cls: 'sh-review-list' });
		for (const entry of this.confEntries) {
			const row = list.createDiv({ cls: 'sh-review-row' });
			const header = row.createDiv({ cls: 'sh-review-header' });
			const name = header.createDiv({ cls: 'sh-review-names' });
			name.createSpan({ cls: 'sh-review-name', text: entry.file.basename, attr: { title: entry.file.basename } });
			if (entry.knowledgeTitle) {
				name.createDiv({ cls: 'sh-conf-aggregate', text: entry.knowledgeTitle });
			}

			const relsContainer = row.createDiv({ cls: 'sh-review-rels-container' });
			const relRow = relsContainer.createDiv({ cls: 'sh-review-rel-row' });

			const localLabel = relRow.createSpan({ cls: 'sh-review-rel-type sh-conf-local-label', text: `Local: ${formatNumber(entry.local)}` });

			const slider = relRow.createEl('input', {
				type: 'range',
				cls: 'sh-conf-slider',
				attr: { min: '0', max: '100', step: '1', value: String(Math.round(entry.local * 100)) },
			});

			const text = relRow.createEl('input', {
				type: 'number',
				cls: 'sh-conf-input',
				attr: { min: '0', max: '1', step: '0.01', value: String(entry.local) },
			});

			const sync = (v: number) => {
				entry.local = Math.min(1, Math.max(0, v));
				slider.value = String(Math.round(entry.local * 100));
				text.value = String(entry.local);
				localLabel.setText(`Local: ${formatNumber(entry.local)}`);
			};
			slider.addEventListener('input', () => sync(parseInt(slider.value, 10) / 100));
			text.addEventListener('change', () => {
				const v = parseFloat(text.value);
				if (!Number.isFinite(v)) {
					text.value = String(entry.local);
					return;
				}
				sync(v);
			});

			relRow.createSpan({ cls: 'sh-conf-pct', text: `Inherited ${formatNumber(entry.inherited)} / Total ${formatNumber(entry.total)}` });

			const controls = relRow.createDiv({ cls: 'sh-review-rel-controls' });
			const save = controls.createEl('button', { text: '✓', cls: 'sh-review-btn sh-review-save-btn' });
			save.setAttribute('title', 'Save local confidence');
			save.addEventListener('click', () => {
				void this.saveConfidence(entry.file, entry.local);
			});
		}
		new Setting(panel).addButton((b) => b.setButtonText('Done').setCta().onClick(() => this.close()));
	}

	private renderGravitas(panel: HTMLElement): void {
		panel.createDiv({
			cls: 'sh-review-sub',
			text: "Each evidence note lends gravitas to concepts via its ## Gravitas section. Effective lent gravitas = amount × source-kind modifier. 0% kinds lend nothing.",
		});
		const list = panel.createDiv({ cls: 'sh-review-list' });
		for (const entry of this.gravEntries) {
			const row = list.createDiv({ cls: 'sh-review-row' });
			const header = row.createDiv({ cls: 'sh-review-header' });
			const name = header.createDiv({ cls: 'sh-review-names' });
			name.createSpan({ cls: 'sh-review-name', text: entry.file.basename, attr: { title: entry.file.basename } });
			name.createDiv({
				cls: 'sh-conf-aggregate',
				text: `kind: ${entry.kind ?? '(unset → 0%)'} — modifier ${entry.kindPercent}%`,
			});

			for (const gravRow of entry.rows) {
				const relsContainer = row.createDiv({ cls: 'sh-review-rels-container' });
				const relRow = relsContainer.createDiv({ cls: 'sh-review-rel-row' });

				relRow.createSpan({ cls: 'sh-review-rel-type', text: gravRow.targetName });
				relRow.createSpan({
					cls: 'sh-conf-aggregate',
					text: `→ ${formatNumber(gravRow.amount * (entry.kindPercent / 100))} effective`,
				});

				const slider = relRow.createEl('input', {
					type: 'range',
					cls: 'sh-conf-slider',
					attr: { min: '10', max: '100', step: '1', value: String(Math.round(gravRow.amount * 100)) },
				});

				const text = relRow.createEl('input', {
					type: 'number',
					cls: 'sh-conf-input',
					attr: { min: '0.1', max: '1', step: '0.01', value: gravRow.amount.toFixed(2) },
				});

				const sync = (v: number) => {
					gravRow.amount = Math.min(1, Math.max(0.1, v));
					slider.value = String(Math.round(gravRow.amount * 100));
					text.value = gravRow.amount.toFixed(2);
				};
				slider.addEventListener('input', () => sync(parseInt(slider.value, 10) / 100));
				text.addEventListener('change', () => {
					const v = parseFloat(text.value);
					if (!Number.isFinite(v)) {
						text.value = gravRow.amount.toFixed(2);
						return;
					}
					sync(v);
				});

				const controls = relRow.createDiv({ cls: 'sh-review-rel-controls' });
				const del = controls.createEl('button', { text: '✕', cls: 'sh-review-btn' });
				del.setAttribute('title', 'Remove support');
				del.addEventListener('click', () => {
					entry.rows = entry.rows.filter((r) => r !== gravRow);
					this.render();
				});
			}

			const addRow = row.createDiv({ cls: 'sh-review-rel-row' });
			const addInput = addRow.createEl('input', {
				type: 'text',
				cls: 'sh-conf-input',
				attr: { placeholder: 'Target note name…' },
			});
			addRow.createEl('button', { text: '+ support', cls: 'sh-review-btn mod-cta' }).addEventListener('click', () => {
				const targetName = addInput.value.trim();
				if (!targetName) {
					return;
				}
				entry.rows.push({ targetName, amount: 0.5 });
				this.render();
			});

			const controls = row.createDiv({ cls: 'sh-review-header' });
			const save = controls.createEl('button', { text: '✓ save source', cls: 'sh-review-btn sh-review-save-btn' });
			save.addEventListener('click', () => {
				void this.saveGravitas(entry);
			});
		}
		new Setting(panel).addButton((b) => b.setButtonText('Done').setCta().onClick(() => this.close()));
	}

	private async saveConfidence(file: TFile, value: number): Promise<void> {
		try {
			const content = await this.plugin.app.vault.read(file);
			await this.plugin.app.vault.modify(file, setConfidenceInContent(content, value));
			new Notice(`Saved local confidence for ${file.basename}.`);
		} catch (e) {
			new Notice(`Failed to save confidence for ${file.basename}: ${String(e)}`);
		}
	}

	private async saveGravitas(entry: GravitasEntry): Promise<void> {
		try {
			const content = await this.plugin.app.vault.read(entry.file);
			const rows = entry.rows.map((r) => ({ targetName: r.targetName, amount: r.amount }));
			await this.plugin.app.vault.modify(entry.file, setGravitasRowsInContent(content, rows));
			new Notice(`Saved gravitas for ${entry.file.basename}.`);
		} catch (e) {
			new Notice(`Failed to save gravitas for ${entry.file.basename}: ${String(e)}`);
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** Minimal internal re-parser of a note's Gravitas section for the modal. */
function parseGravitasSectionJson(
	content: string,
	resolve: (name: string, sourcePath: string) => string | null,
	sourcePath: string,
): Array<{ target: string; amount: number }> {
	const out: Array<{ target: string; amount: number }> = [];
	const section = findGravitasSection(content);
	if (!section) {
		return out;
	}
	const lines = content.split(/\r?\n/);
	for (let i = section.startLine + 1; i < section.endLine; i++) {
		const trimmed = (lines[i] ?? '').trim();
		if (!trimmed.startsWith('- lends-gravitas-to ')) {
			continue;
		}
		const m = trimmed.match(/^-\s+lends-gravitas-to\s+\[\[([^\]]+)\]\]\s*\((\d{1,2}(?:\.\d{1,2})?)\)\s*$/);
		if (!m) {
			continue;
		}
		const target = resolve(m[1]!, sourcePath);
		if (target) {
			out.push({ target, amount: parseFloat(m[2]!) });
		}
	}
	return out;
}

function targetLabel(path: string): string {
	return path.split('/').pop()?.replace(/\.md$/i, '') ?? path;
}