import {
	App,
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	TFile,
	editorInfoField,
} from 'obsidian';
import { RangeSetBuilder, Extension, Prec } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType, keymap } from '@codemirror/view';
import type SemanticHologramPlugin from './main';
import type { RelTypeEntry } from './settings';
import { inScopePath } from './relations';
import { ANY_HEADER, RELATION_HEADER } from './headers';

function isRelationsSectionAt(lines: string[], line: number): boolean {
	for (let i = line; i >= 0; i--) {
		const text = lines[i] ?? '';
		if (ANY_HEADER.test(text)) {
			return RELATION_HEADER.test(text);
		}
	}
	return false;
}

/** Returns the partial relation id before the cursor and the line's layout, or null. */
function partialAtLine(
	text: string,
	cursorOffset: number,
): { idStart: number; idEnd: number; partial: string } | null {
	const m = text.match(/^-\s+([a-z0-9/-]*)\s*$/);
	if (!m) {
		return null;
	}
	const lead = m[0].match(/^-\s+/)?.[0].length ?? 2;
	const partial = m[1] ?? '';
	const idStart = lead;
	const idEnd = idStart + partial.length;
	if (cursorOffset < idStart || cursorOffset > idEnd) {
		return null;
	}
	return { idStart, idEnd, partial };
}

class GhostWidget extends WidgetType {
	constructor(
		readonly completion: string,
		readonly suffix: string,
	) {
		super();
	}

	toDOM(): HTMLElement {
		const span = createSpan();
		span.className = 'sh-ghost';
		span.textContent = ` ${this.completion}`;
		return span;
	}

	eq(other: GhostWidget): boolean {
		return other.completion === this.completion && other.suffix === this.suffix;
	}

	ignoreEvent(): boolean {
		return true;
	}
}

interface GhostState {
	idStart: number;
	idEnd: number;
	completion: string;
}

function ghostAtCursor(view: EditorView, plugin: SemanticHologramPlugin): GhostState | null {
	const info = view.state.field(editorInfoField, false);
	if (!info?.file || !inScopePath(info.file.path, plugin.app.vault, plugin.app.metadataCache)) {
		return null;
	}
	const head = view.state.selection.main.head;
	const line = view.state.doc.lineAt(head);
	const lines: string[] = [];
	for (let i = 0; i < line.number; i++) {
		lines.push(view.state.doc.line(i + 1).text);
	}
	if (!isRelationsSectionAt(lines, line.number - 1)) {
		return null;
	}
	const found = partialAtLine(line.text, head - line.from);
	if (!found || !found.partial) {
		return null;
	}
	const partial = found.partial.toLowerCase();
	let completion: string | null = null;
	for (const t of plugin.settings.relTypes) {
		const id = t.id.toLowerCase();
		if (t.enabled && id.startsWith(partial) && id !== partial) {
			completion = t.id;
			break;
		}
	}
	if (!completion) {
		return null;
	}
	return { idStart: line.from + found.idStart, idEnd: line.from + found.idEnd, completion };
}

class GhostPlugin {
	decorations: DecorationSet;

	constructor(
		view: EditorView,
		private plugin: SemanticHologramPlugin,
	) {
		this.decorations = this.compute(view);
	}

	update(u: ViewUpdate): void {
		if (u.docChanged || u.selectionSet || u.viewportChanged) {
			this.decorations = this.compute(u.view);
		}
	}

	private compute(view: EditorView): DecorationSet {
		const builder = new RangeSetBuilder<Decoration>();
		const ghost = ghostAtCursor(view, this.plugin);
		if (ghost) {
			const widget = new GhostWidget(ghost.completion, ghost.completion.slice(ghost.idEnd - ghost.idStart));
			builder.add(ghost.idEnd, ghost.idEnd, Decoration.widget({ widget, side: 1 }));
		}
		return builder.finish();
	}
}

const ghostView = (plugin: SemanticHologramPlugin): Extension =>
	ViewPlugin.define(
		(view: EditorView) => new GhostPlugin(view, plugin),
		{
			decorations: (v: GhostPlugin) => v.decorations,
		},
	);

function acceptGhost(view: EditorView, plugin: SemanticHologramPlugin): boolean {
	const ghost = ghostAtCursor(view, plugin);
	if (!ghost) {
		return false;
	}
	view.dispatch({
		changes: {
			from: ghost.idStart,
			to: ghost.idEnd,
			insert: `${ghost.completion} `,
		},
		selection: { anchor: ghost.idStart + ghost.completion.length + 1 },
	});
	return true;
}

const ghostKeymap = (plugin: SemanticHologramPlugin): Extension =>
	keymap.of([
		{
			key: 'Tab',
			run: (view: EditorView): boolean => acceptGhost(view, plugin),
		},
	]);

export function relationGhostExtension(plugin: SemanticHologramPlugin): Extension {
	return [Prec.highest(ghostKeymap(plugin)), ghostView(plugin)];
}

export class RelationSuggest extends EditorSuggest<RelTypeEntry> {
	constructor(
		app: App,
		private plugin: SemanticHologramPlugin,
	) {
		super(app);
		this.setInstructions([
			{ command: '↑↓', purpose: 'to navigate' },
			{ command: '↵', purpose: 'to insert the type' },
			{ command: 'Tab', purpose: 'to accept the ghost type' },
		]);
	}

	onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
		if (!file) {
			return null;
		}
		if (!inScopePath(file.path, this.app.vault, this.app.metadataCache)) {
			return null;
		}
		const lines = editor.getValue().split(/\r?\n/);
		if (!isRelationsSectionAt(lines, cursor.line)) {
			return null;
		}
		const line = editor.getLine(cursor.line);
		const found = partialAtLine(line, cursor.ch);
		if (!found) {
			return null;
		}
		return {
			start: { line: cursor.line, ch: found.idStart },
			end: cursor,
			query: found.partial.toLowerCase(),
		};
	}

	getSuggestions(context: EditorSuggestContext): RelTypeEntry[] {
		const q = context.query.toLowerCase();
		return this.plugin.settings.relTypes
			.filter((t) => t.enabled && (q ? t.id.toLowerCase().includes(q) : true))
			.slice(0, 20);
	}

	renderSuggestion(item: RelTypeEntry, el: HTMLElement): void {
		el.addClass('sh-suggest-item');
		const swatch = el.createSpan({ cls: 'sh-suggest-swatch' });
		swatch.style.background = item.color;
		el.createSpan({ text: item.id });
	}

	selectSuggestion(item: RelTypeEntry, evt: MouseEvent | KeyboardEvent): void {
		const ctx = this.context;
		if (!ctx) {
			return;
		}
		const startCh = ctx.start.ch;
		ctx.editor.replaceRange(`${item.id} `, ctx.start, ctx.end);
		ctx.editor.setCursor({ line: ctx.start.line, ch: startCh + item.id.length + 1 });
		this.close();
	}
}