import { App, Modal, Notice, Setting, TFile } from 'obsidian';
import type SemanticHologramPlugin from './main';
import { scanRelations } from './relations';
import { extractFrontmatter, parseNoteFrontmatter, formatStrength, RelationEdge } from './relations';
import { HOLOGRAM_FOLDER } from './settings';

interface ConfidenceEntry {
	file: TFile;
	value: number;
	topicAggregate: number | null;
	subtreeSize: number;
}

/** Set (or add) the `confidence:` frontmatter field of a note body. */
export function setConfidenceInContent(content: string, value: number): string {
	const v = formatStrength(Math.min(1, Math.max(0, value)));
	const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!m) {
		return `---\nconfidence: ${v}\n---\n\n${content}`;
	}
	let body = m[1]!;
	if (/^confidence:/im.test(body)) {
		body = body.replace(/^confidence:.*$/im, `confidence: ${v}`);
	} else {
		body = `${body.trimEnd()}\nconfidence: ${v}`;
	}
	return `---\n${body}\n---${content.slice(m[0]!.length)}`;
}

interface ConfidenceMap {
	path: string;
	value: number | null;
	nodeType: string;
}

async function readConfidences(plugin: SemanticHologramPlugin, files: TFile[]): Promise<ConfidenceMap[]> {
	return Promise.all(
		files.map(async (f) => {
			let content = '';
			try {
				content = await plugin.app.vault.read(f);
			} catch {
				// Unreadable note: treat as unknown confidence.
			}
			const fm = parseNoteFrontmatter(extractFrontmatter(content));
			return { path: f.path, value: fm.confidence, nodeType: fm.noteType ?? 'concept' };
		}),
	);
}

export async function computeGrounding(
	plugin: SemanticHologramPlugin,
	files: TFile[],
	edges: RelationEdge[],
): Promise<Set<string>> {
	const confidences = await readConfidences(plugin, files);
	const nodeTypes = new Map<string, string>();
	for (const c of confidences) {
		nodeTypes.set(c.path, c.nodeType);
	}

	const grounded = new Set<string>();
	// 1. Initialise with all percept files
	for (const f of files) {
		if ((nodeTypes.get(f.path) ?? 'concept') === 'percept') {
			grounded.add(f.path);
		}
	}

	// 2. Iterate to find grounded nodes via relations
	let changed = true;
	while (changed) {
		changed = false;
		for (const e of edges) {
			if (grounded.has(e.source) && !grounded.has(e.target)) {
				// e.source is grounded, and supports e.target
				if (e.relId === 'logic/supports' || e.relId === 'structural/subsumed-by' || e.relId === 'related') {
					grounded.add(e.target);
					changed = true;
				}
			}
		}
	}
	return grounded;
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
	const grounded = await computeGrounding(plugin, files, scan.edges);

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
	for (const c of await readConfidences(plugin, files)) {
		if (c.value !== null) {
			const isGrounded = grounded.has(c.path);
			confidences.set(c.path, isGrounded ? c.value : 0);
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

/** Review all hologram nodes and set each node's confidence level. */
export class NodeConfidenceModal extends Modal {
	private entries: ConfidenceEntry[] = [];

	constructor(
		app: App,
		private plugin: SemanticHologramPlugin,
	) {
		super(app);
	}

	async onOpen(): Promise<void> {
		const files = this.plugin.app.vault
			.getMarkdownFiles()
			.filter((f) => f.path.startsWith(`${HOLOGRAM_FOLDER}/`));
		const confidences = await readConfidences(this.plugin, files);
		const confMap = new Map<string, number>();
		for (const c of confidences) {
			if (c.value !== null) {
				confMap.set(c.path, c.value);
			}
		}
		const topic = await computeTopicKnowledge(this.plugin, files);

		this.entries = files
			.map((f) => ({
				file: f,
				value: confMap.get(f.path) ?? this.plugin.settings.defaultRelStrength,
				topicAggregate: topic.get(f.path)?.aggregate ?? null,
				subtreeSize: topic.get(f.path)?.size ?? 0,
			}))
			.sort((a, b) => a.file.basename.localeCompare(b.file.basename));
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('sh-review-modal');
		contentEl.createEl('h4', { text: 'Review node confidence' });
		contentEl.createDiv({
			cls: 'sh-review-sub',
			text: `${this.entries.length} node(s). Confidence is read from each note's frontmatter; topic knowledge is the average confidence of everything subsumed under it.`,
		});

		const list = contentEl.createDiv({ cls: 'sh-review-list' });
		for (const entry of this.entries) {
			this.renderRow(list, entry);
		}

		new Setting(contentEl).addButton((b) => b.setButtonText('Done').setCta().onClick(() => this.close()));
	}

	private renderRow(list: HTMLElement, entry: ConfidenceEntry): void {
		const row = list.createDiv({ cls: 'sh-review-row' });
		const header = row.createDiv({ cls: 'sh-review-header' });
		const name = header.createDiv({ cls: 'sh-review-names' });
		const nameSpan = name.createSpan({ cls: 'sh-review-name', text: entry.file.basename, attr: { title: entry.file.basename } });
		nameSpan.style.justifySelf = 'center';
		if (entry.topicAggregate !== null) {
			nameSpan.createEl('br');
			const ag = nameSpan.createEl('span', {
				cls: 'sh-conf-aggregate',
				text: `Knowledge: ${Math.round(entry.topicAggregate * 100)}% (${entry.subtreeSize} node${entry.subtreeSize === 1 ? '' : 's'})`,
			});
			ag.style.fontSize = '11px';
			ag.style.color = 'var(--text-muted)';
		}

		const relsContainer = row.createDiv({ cls: 'sh-review-rels-container' });
		const relRow = relsContainer.createDiv({ cls: 'sh-review-rel-row' });
		const typeSpan = relRow.createSpan({ cls: 'sh-review-rel-type' });
		typeSpan.style.flex = '1';
		typeSpan.style.textAlign = 'left';

		const current = typeSpan.createSpan({ text: `Confidence: ${formatStrength(entry.value)} ` });
		current.style.color = 'var(--text-muted)';

		const slider = relRow.createEl('input', {
			type: 'range',
			attr: { min: '0', max: '100', step: '1', value: String(Math.round((entry.value ?? 0.5) * 100)) },
		});
		slider.style.flex = '1';

		const pct = relRow.createEl('span', { cls: 'sh-conf-pct', text: `${Math.round((entry.value ?? 0.5) * 100)}%` });
		pct.style.minWidth = '44px';
		pct.style.textAlign = 'right';

		const controls = relRow.createDiv({ cls: 'sh-review-rel-controls' });
		controls.style.marginLeft = 'auto';
		controls.style.display = 'flex';
		controls.style.gap = '4px';

		const save = controls.createEl('button', { text: '✓', cls: 'sh-review-btn sh-review-save-btn' });
		save.setAttribute('title', 'Save confidence');
		save.addEventListener('click', () => {
			void this.save(entry);
		});

		slider.addEventListener('input', () => {
			const v = parseInt(slider.value, 10) / 100;
			entry.value = v;
			current.setText(`Confidence: ${formatStrength(v)} `);
			pct.setText(`${Math.round(v * 100)}%`);
		});
	}

	private async save(entry: ConfidenceEntry): Promise<void> {
		try {
			const content = await this.plugin.app.vault.read(entry.file);
			await this.plugin.app.vault.modify(entry.file, setConfidenceInContent(content, entry.value));
			new Notice(`Saved confidence for ${entry.file.basename}.`);
		} catch (e) {
			new Notice(`Failed to save confidence for ${entry.file.basename}: ${String(e)}`);
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}