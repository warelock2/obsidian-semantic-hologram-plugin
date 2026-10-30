import { MetadataCache, TFile, Vault } from 'obsidian';
import {
	findConfidenceSection,
	findGravitasProvenanceSection,
	findGravitasSection,
	findIncomingSection,
	findRelationsSection,
	formatStrength,
	scanRelations,
} from './relations';
import { computeNodeStats, readNodeMetasFresh } from './gravitas';
import type { NodeMeta } from './gravitas';
import type { RelationEdge } from './relations';
import { computeProvenance } from './gravitasProvenance';
import type { NodeMeta as ProvenanceNodeMeta, ProvenanceEntry } from './gravitasProvenance';
import type { SourceKindEntry } from './settings';

const CONFIDENCE_SECTION_HEADER = '## Confidence (generated)';
import { CONFIDENCE_HEADER } from './headers';
const GRAVITAS_PROVENANCE_HEADER = '## Gravitas Provenance (generated)';

/** Node types that *lend* gravitas — they are never backed by other notes. */
const EVIDENCE_NODE_TYPES = ['source', 'authority', 'data'];

/** Canonical link to a note path: bare wikilink (hologram-internal links). */
function wikiLink(path: string): string {
	const base = path.split('/').pop()?.replace(/\.md$/i, '') ?? path;
	return `[[${base}]]`;
}

export interface GravitasSyncResult {
	updated: string[];
}

/**
 * Rewrite each hologram note's derived `## Gravitas Provenance` (mechanism
 * notes: the sources backing them, direct and inherited) and `## Confidence`
 * (all notes: local / inherited / total) sections so they mirror the live
 * calculation. Evidence notes author their own `epistemic/evidence` lines: only
 * their header is migrated (`## Gravitas` → `## Gravitas Provenance`), the
 * authored body is preserved verbatim. No-op when nothing changed.
 */
export async function syncGravitasAndConfidence(
	files: TFile[],
	vault: Vault,
	metadataCache: MetadataCache,
	sourceKinds: SourceKindEntry[],
	defaultType: string,
	defaultConfidence: number,
	defaultRelStrength: number,
	knownRelIds: Set<string>,
	inScope: (path: string) => boolean,
): Promise<GravitasSyncResult> {
	const metas = await readNodeMetasFresh(files, vault, defaultConfidence, defaultType);
	const scan = await scanRelations(files, vault, metadataCache, knownRelIds, defaultRelStrength, inScope);
	const stats = computeNodeStats(metas, scan.edges.filter(e => e.relId === 'structural/subsumed-by'), scan.edges, sourceKinds, defaultConfidence);

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
		const isEvidence = meta ? EVIDENCE_NODE_TYPES.includes(meta.nodeType) : false;

		const st = stats.get(f.path);
		if (isEvidence) {
			const kind = meta ? meta.sourceKind : null;
			const pct = kind ? (sourceKinds.find((k) => k.id === kind)?.percent ?? 0) / 100 : 0;
			after = applyEvidenceGravitasLevel(after, pct);
		} else {
			after = applyGravitasProvenanceSection(after, st);
		}
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

/**
 * One provenance row: `  - ([[Source]]) epistemic/evidence (0.72)`.
 * An inherited contribution (the source reached this node through the
 * `structural/subsumed-by` chain) is marked `(inherited)` after the amount.
 */
export function provenanceLine(entry: ProvenanceEntry): string {
	const amount = formatStrength(entry.amount);
	const marker = entry.direct ? '' : ' (inherited)';
	return `  - (${wikiLink(entry.sourcePath)}) epistemic/evidence (${amount})${marker}`;
}

/**
 * Line index at which the derived section belongs: directly below
 * `## Incoming relationships`, else below `## Relationships`, else before
 * `## Confidence`, else at the end of the note. Never inside `## Confidence`.
 */
function findProvenancePlacement(lines: string[]): number {
	const content = lines.join('\n');
	const incoming = findIncomingSection(content);
	if (incoming) {
		return incoming.endLine;
	}
	const relations = findRelationsSection(content);
	if (relations) {
		return relations.endLine;
	}
	const confidence = findConfidenceSection(content);
	if (confidence) {
		return confidence.startLine;
	}
	return lines.length;
}

/**
 * Write the derived `## Gravitas Provenance` section.
 *
 * An existing `## Gravitas` / `## Gravitas Provenance` block is replaced and
 * re-emitted at its canonical position, so a legacy header ends up renamed
 * *and* moved. A note without backers keeps no stale section.
 */
export function applyGravitasProvenanceSection(
	content: string,
	stats: { gravitasDirect: number; gravitasReal: number; gravitasDisplay: number } | undefined,
): string {
	const lines = content.replace(/^\n+/, '').split(/\r?\n/);
	const existing = findGravitasProvenanceSection(content);
	const cleaned = existing
		? [...lines.slice(0, existing.startLine), ...lines.slice(existing.endLine)]
		: lines;

	const body: string[] = [];
	if (stats) {
		const localV = Math.min(1, Math.max(0, stats.gravitasDirect));
		const inheritedV = Math.min(1, Math.max(0, stats.gravitasReal - stats.gravitasDirect));
		const totalV = Math.min(1, Math.max(0, stats.gravitasDisplay));
		const fmt = (v: number) => {
			const s = v.toFixed(2);
			return s.endsWith('.00') ? s.slice(0, -3) : s.endsWith('0') ? s.slice(0, -1) : s;
		};
		body.push(`  - local-gravitas: ${fmt(localV)}`);
		body.push(`  - inherited-gravitas: ${fmt(inheritedV)}`);
		body.push(`  - total-gravitas: ${fmt(totalV)}`);
	}
	if (body.length === 0) {
		return existing ? cleaned.join('\n') : content;
	}

	const at = findProvenancePlacement(cleaned);
	const out = [...cleaned.slice(0, at)];
	if (out.length > 0 && out[out.length - 1]!.trim() !== '') {
		out.push('');
	}
	out.push(GRAVITAS_PROVENANCE_HEADER, '', ...body);
	if (at < cleaned.length && cleaned[at]!.trim() !== '') {
		out.push('');
	}
	out.push(...cleaned.slice(at));
	return out.join('\n');
}

/**
 * Evidence notes: write derived source provision info.
 */
export function applyEvidenceGravitasLevel(content: string, kindPercent: number): string {
	const section = findGravitasSection(content);
	const fmt = (v: number) => {
		const s = v.toFixed(2);
		return s.endsWith('.00') ? s.slice(0, -3) : s.endsWith('0') ? s.slice(0, -1) : s;
	};
	const localV = Math.min(1, Math.max(0, kindPercent));
	const derived = `  - local-gravitas: ${fmt(localV)}\n  - inherited-gravitas: 0\n  - total-gravitas: ${fmt(localV)}`;
	if (!section) {
		return content + '\n\n## Gravitas (generated)\n\n' + derived + '\n';
	}
	const lines = content.replace(/^\n+/, '').split(/\r?\n/);
	const out: string[] = [];
	let inSection = false;
	let wroteRows = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		if (i === section.startLine) {
			out.push(line);
			inSection = true;
			continue;
		}
		if (inSection && i >= section.endLine) {
			inSection = false;
			out.push(line);
			continue;
		}
		if (inSection) {
			if (!wroteRows) {
				out.push(derived);
				wroteRows = true;
			}
			continue;
		}
		out.push(line);
	}
	if (!wroteRows && inSection) {
		out.push(derived);
	}
	return out.join('\n');
}

/**
 * Total gravitas an evidence note lends: the sum of its authored
 * `epistemic/evidence` amounts, each scaled by its `source-kind` percent.
 */
export function totalLentOf(
	path: string,
	relEdges: RelationEdge[],
	metas: Map<string, NodeMeta>,
	sourceKinds: SourceKindEntry[],
): number {
	const kind = metas.get(path)?.sourceKind ?? null;
	const pct = kind ? (sourceKinds.find((k) => k.id === kind)?.percent ?? 0) / 100 : 0;
	let sum = 0;
	for (const e of relEdges) {
		if (e.relId !== 'epistemic/evidence') continue;
		if (e.source === path) {
			sum += e.strength * pct;
		}
	}
	return sum;
}

/**
 * Evidence notes author their `epistemic/evidence` lines under `## Gravitas`.
 * Only the header migrates to `## Gravitas Provenance`; the authored body is
 * preserved verbatim.
 */
export function migrateEvidenceGravitasHeader(content: string): string {
	const legacy = findGravitasSection(content);
	if (!legacy) {
		return content;
	}
	const lines = content.split(/\r?\n/);
	lines[legacy.startLine] = GRAVITAS_PROVENANCE_HEADER;
	return lines.join('\n');
}

/** Read-only mirror section listing local / inherited / total confidence. */
function applyConfidenceSection(content: string, local: number, inherited: number, total: number): string {
	const lines = content.split(/\r?\n/);
	const CONFIDENCE_REGEX = CONFIDENCE_HEADER;

	// Remove all existing ## Confidence sections
	const cleanLines: string[] = [];
	let inConfidenceSection = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		if (CONFIDENCE_REGEX.test(line.trim())) {
			inConfidenceSection = true;
			continue;
		}
		if (inConfidenceSection) {
			if (line.trim() === '' || /^\s+-\s+/.test(line)) {
				continue;
			} else {
				inConfidenceSection = false;
			}
		}
		if (!inConfidenceSection) {
			cleanLines.push(line);
		}
	}

	const body = [
		`  - local-confidence: ${formatStrength(local)}`,
		`  - inherited-confidence: ${formatStrength(inherited)}`,
		`  - total-confidence: ${formatStrength(total)}`,
	];

	const ending = cleanLines.length > 0 && cleanLines[cleanLines.length - 1]!.trim() !== '' ? '\n\n' : '\n';
	return cleanLines.join('\n') + ending + CONFIDENCE_SECTION_HEADER + '\n\n' + body.join('\n') + '\n';
}
