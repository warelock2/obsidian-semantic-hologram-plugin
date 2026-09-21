import { MetadataCache, TFile, Vault } from 'obsidian';
import { findGravitasSection, formatStrength, scanRelations } from './relations';
import { computeNodeStats, readNodeMetasFresh, scanGravitas } from './gravitas';
import type { SourceKindEntry } from './settings';

const CONFIDENCE_SECTION_HEADER = '## Confidence';

/** Canonical link to a note path: bare wikilink (hologram-internal links). */
function wikiLink(path: string): string {
	const base = path.split('/').pop()?.replace(/\.md$/i, '') ?? path;
	return `[[${base}]]`;
}

export interface GravitasSyncResult {
	updated: string[];
}

interface GravitasBacker {
	sourcePath: string;
	sourceName: string;
	nodeType: string;
	sourceKind: string | null;
	amount: number;
}

/**
 * Rewrite each hologram note's read-only `## Gravitas` (concept notes: the
 * evidence backing them) and `## Confidence` (all notes: local / inherited /
 * total) sections so they mirror the live calculation. Evidence notes keep
 * their authored `## Gravitas` section untouched; only their `## Confidence`
 * mirror is maintained. No-op when nothing changed.
 */
export async function syncGravitasAndConfidence(
	files: TFile[],
	vault: Vault,
	metadataCache: MetadataCache,
	sourceKinds: SourceKindEntry[],
	defaultConfidence: number,
	defaultRelStrength: number,
	knownRelIds: Set<string>,
	inScope: (path: string) => boolean,
): Promise<GravitasSyncResult> {
	const metas = await readNodeMetasFresh(files, vault, defaultConfidence);
	const scan = await scanRelations(files, vault, metadataCache, knownRelIds, defaultRelStrength, inScope);
	const gscan = await scanGravitas(files, vault, metadataCache, inScope);
	const stats = computeNodeStats(metas, scan.edges, gscan.edges, sourceKinds, defaultConfidence);

	const backersByTarget = new Map<string, GravitasBacker[]>();
	for (const e of gscan.edges) {
		const meta = metas.get(e.source);
		const arr = backersByTarget.get(e.target) ?? [];
		arr.push({
			sourcePath: e.source,
			sourceName: e.source.split('/').pop()?.replace(/\.md$/i, '') ?? e.source,
			nodeType: meta?.nodeType ?? 'source',
			sourceKind: meta?.sourceKind ?? null,
			amount: e.amount,
		});
		backersByTarget.set(e.target, arr);
	}

	const updated: string[] = [];
	for (const f of files) {
		if (!inScope(f.path)) {
			continue;
		}
		let before: string;
		try {
			before = await vault.read(f);
		} catch {
			continue;
		}
		let after = before;
		const meta = metas.get(f.path);
		const isEvidence = meta ? ['source', 'authority', 'data'].includes(meta.nodeType) : false;

		if (!isEvidence) {
			after = applyGravitasMirror(after, backersByTarget.get(f.path) ?? []);
		}
		const st = stats.get(f.path);
		if (st) {
			after = applyConfidenceSection(after, st.confidenceLocal, st.confidenceInherited, st.confidenceTotal);
		}
		if (after !== before) {
			await vault.modify(f, after);
			updated.push(f.path);
		}
	}
	return { updated };
}

/** Mirror of lending into the supported concept: `- ([[Source]]) lends-gravitas-to (0.8)`. */
function applyGravitasMirror(content: string, backers: GravitasBacker[]): string {
	const lines = content.split(/\r?\n/);
	const section = findGravitasSection(content);
	const body = backers
		.map((b) => `- (${wikiLink(b.sourcePath)}) lends-gravitas-to (${formatStrength(b.amount)})${b.nodeType !== 'source' ? ` — ${b.nodeType}` : ''}`)
		.sort()
		.map((l) => `  ${l}`);

	if (!section) {
		if (body.length === 0) {
			return content;
		}
		const ending = content.endsWith('\n') ? '\n' : '\n\n';
		return content + ending + '## Gravitas\n\n' + body.join('\n') + '\n';
	}
	if (body.length === 0) {
		const newLines = [...lines.slice(0, section.startLine), ...lines.slice(section.endLine)];
		return newLines.join('\n').replace(/\n{3,}/g, '\n\n');
	}
	const newLines = [...lines.slice(0, section.startLine), '## Gravitas', ...body, ...lines.slice(section.endLine)];
	return newLines.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** Read-only mirror section listing local / inherited / total confidence. */
function applyConfidenceSection(content: string, local: number, inherited: number, total: number): string {
	const lines = content.split(/\r?\n/);
	const headerIdx = lines.findIndex((l) => /^#{1,6}\s+Confidence\s*$/i.test(l.trim()));
	const body = [
		`  - local-confidence: ${formatStrength(local)}`,
		`  - inherited-confidence: ${formatStrength(inherited)}`,
		`  - total-confidence: ${formatStrength(total)}`,
	];

	if (headerIdx < 0) {
		const ending = content.endsWith('\n') ? '\n' : '\n\n';
		return content + ending + CONFIDENCE_SECTION_HEADER + '\n\n' + body.join('\n') + '\n';
	}
	let end = headerIdx + 1;
	while (end < lines.length && /^\s+-\s+/.test(lines[end]!)) {
		end++;
	}
	const newLines = [...lines.slice(0, headerIdx), CONFIDENCE_SECTION_HEADER, ...body, ...lines.slice(end)];
	return newLines.join('\n').replace(/\n{3,}/g, '\n\n');
}