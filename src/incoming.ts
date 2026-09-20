import { MetadataCache, TFile, Vault } from 'obsidian';
import type { RelationEdge, RelationScan } from './relations';
import { findIncomingSection, formatStrength, scanRelations } from './relations';

const INCOMING_HEADER_TEXT = '## Incoming relationships';

function relVerb(relId: string): string {
	return relId;
}

/** Canonical link to a note path: bare wikilink (hologram-internal links are unqualified). */
function wikiLink(path: string): string {
	const base = path.split('/').pop()?.replace(/\.md$/i, '') ?? path;
	return `[[${base}]]`;
}

/** Mirror line: `- (source note) relates (0.5)` on the target note's own section. */
function formatIncomingLine(e: RelationEdge): string {
	return `- (${wikiLink(e.source)}) ${relVerb(e.relId)} (${formatStrength(e.strength)})`;
}

export interface IncomingSyncResult {
	updated: string[];
	scan: RelationScan;
}

/**
 * Rewrite each hologram-scoped note's `## Incoming relationships` section so it
 * mirrors every directed relation that targets it. No-op when nothing changed.
 */
export async function syncIncomingRelationships(
	files: TFile[],
	vault: Vault,
	metadataCache: MetadataCache,
	knownIds: Set<string>,
	defaultRelStrength: number,
	inScope: (path: string) => boolean,
): Promise<IncomingSyncResult> {
	const scan = await scanRelations(files, vault, metadataCache, knownIds, defaultRelStrength, inScope);
	const byTarget = new Map<string, RelationEdge[]>();
	for (const e of scan.edges) {
		const arr = byTarget.get(e.target) ?? [];
		arr.push(e);
		byTarget.set(e.target, arr);
	}

	const updated: string[] = [];
	for (const f of files) {
		if (!inScope(f.path)) {
			continue;
		}
		const edges = byTarget.get(f.path) ?? [];
		if (edges.length === 0 && !findIncomingSection(await readSafe(f, vault))) {
			continue;
		}
		const before = await readSafe(f, vault);
		const after = applyIncomingSection(before, edges);
		if (after === before) {
			continue;
		}
		await vault.modify(f, after);
		updated.push(f.path);
	}
	return { updated, scan };
}

async function readSafe(f: TFile, vault: Vault): Promise<string> {
	try {
		return await vault.read(f);
	} catch {
		return '';
	}
}

function applyIncomingSection(content: string, edges: RelationEdge[]): string {
	const lines = content.split(/\r?\n/);
	const section = findIncomingSection(content);
	const body = edges.map((e) => formatIncomingLine(e)).sort();

	if (!section) {
		if (body.length === 0) {
			return content;
		}
		const ending = content.endsWith('\n') ? '\n' : '\n\n';
		return content + ending + INCOMING_HEADER_TEXT + '\n\n' + body.join('\n') + '\n';
	}

	if (body.length === 0) {
		const newLines = [...lines.slice(0, section.startLine), ...lines.slice(section.endLine)];
		return newLines.join('\n').replace(/\n{3,}/g, '\n\n');
	}

	const existing = lines
		.slice(section.startLine + 1, section.endLine)
		.map((l) => l.trim())
		.filter((l) => l.length > 0);
	const unchanged = existing.length === body.length && existing.every((l, i) => l === body[i]);
	if (unchanged) {
		return content;
	}

	const newLines = [
		...lines.slice(0, section.startLine + 1),
		'',
		...body,
		'',
		...lines.slice(section.endLine),
	];
	return newLines.join('\n').replace(/\n{3,}/g, '\n\n');
}