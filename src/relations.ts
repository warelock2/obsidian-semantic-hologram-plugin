import { MetadataCache, TFile, Vault } from 'obsidian';
import type { RelTypeEntry } from './settings';
import { HOLOGRAM_FOLDER } from './settings';

export interface RelationEdge {
	source: string; // path of the source note
	target: string; // path of the target note
	relId: string; // 'logic/supports' or 'related'
	strength: number; // 0..1
	reversed: boolean; // authored with {R}
	authoredFrom: string; // path of the note containing the line
	raw: string; // verbatim line text (for mirroring)
}

export interface MalformedRelation {
	path: string;
	line: number;
	text: string;
	reason: string;
}

export interface RelationConflict {
	path: string;
	relId: string;
	source: string;
	target: string;
	strengths: number[];
}

export interface RelationScan {
	edges: RelationEdge[];
	malformed: MalformedRelation[];
	conflicts: RelationConflict[];
}

export interface RelationsData {
	outgoing: RelationEdge[];
	malformed: MalformedRelation[];
}

export interface NoteFrontmatter {
	hologramNode: boolean;
	noteType: string | null;
	confidence: number | null;
	created: string | null;
}

export const RELATION_HEADER = /^#{1,6}\s+(Relations(?:hips)?|Relationship)\s*$/i;
export const INCOMING_HEADER = /^#{1,6}\s+Incoming\s+Relations(?:hips)?\s*$/i;

// - logic/supports [[Target]] {R}? (0.50)
// - related [[Target]] (0.5)
const REL_LINE =
	/^-\s+([a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?)\s+\[\[([^\]]+)\]\]\s*(\{R\})?\s*\((\d{1,2}(?:\.\d{1,2})?)\)\s*$/;

export function isHologramNote(
	frontmatter: Record<string, unknown> | null,
	inScope: (path: string) => boolean,
	path: string,
): boolean {
	if (frontmatter && (frontmatter['hologram-node'] === true || frontmatter['hologram_node'] === true)) {
		return true;
	}
	return inScope(path);
}

/** True when a vault path is a hologram-scoped note. */
export function inScopePath(path: string, vault: Vault, metadataCache: MetadataCache): boolean {
	if (path.startsWith(`${HOLOGRAM_FOLDER}/`)) {
		return true;
	}
	const f = vault.getAbstractFileByPath(path);
	if (f instanceof TFile) {
		const fm = metadataCache.getFileCache(f)?.frontmatter;
		if (fm && (fm['hologram-node'] === true || fm['hologram_node'] === true)) {
			return true;
		}
	}
	return false;
}

export function parseNoteFrontmatter(frontmatter: string | null): NoteFrontmatter {
	const out: NoteFrontmatter = {
		hologramNode: false,
		noteType: null,
		confidence: null,
		created: null,
	};
	if (!frontmatter) {
		return out;
	}
	const m = frontmatter.match(/^hologram-node:\s*(true|false)/i);
	if (m) {
		out.hologramNode = m[1]!.toLowerCase() === 'true';
	}
	const t = frontmatter.match(/^note-type:\s*(.+)$/im);
	if (t) {
		out.noteType = t[1]!.trim();
	}
	const c = frontmatter.match(/^confidence:\s*([0-9]*\.?[0-9]+)/im);
	if (c) {
		out.confidence = Math.min(1, Math.max(0, parseFloat(c[1]!)));
	}
	const cr = frontmatter.match(/^created:\s*(.+)$/im);
	if (cr) {
		out.created = cr[1]!.trim();
	}
	return out;
}

/** Extract the text between the first frontmatter fences if present. */
export function extractFrontmatter(content: string): string | null {
	const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	return m && m[1] !== undefined ? m[1] : null;
}

/** Find the line range of the `## Relations` (or Relationships) section. */
export function findRelationsSection(content: string): { startLine: number; endLine: number } | null {
	const lines = content.split(/\r?\n/);
	let start = -1;
	for (let i = 0; i < lines.length; i++) {
		if (RELATION_HEADER.test(lines[i]!.trim())) {
			start = i;
			break;
		}
	}
	if (start < 0) {
		return null;
	}
	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) {
		if (/^#{1,6}\s+/.test(lines[i]!.trim())) {
			end = i;
			break;
		}
	}
	return { startLine: start, endLine: end };
}

/** Find the line range of the `## Incoming relationships` section, if any. */
export function findIncomingSection(content: string): { startLine: number; endLine: number } | null {
	const lines = content.split(/\r?\n/);
	let start = -1;
	for (let i = 0; i < lines.length; i++) {
		if (INCOMING_HEADER.test(lines[i]!.trim())) {
			start = i;
			break;
		}
	}
	if (start < 0) {
		return null;
	}
	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) {
		if (/^#{1,6}\s+/.test(lines[i]!.trim())) {
			end = i;
			break;
		}
	}
	return { startLine: start, endLine: end };
}

/**
 * Parse a note's Relations section into directed relation edges.
 * Missing/unresolvable lines are returned in `malformed`.
 * `resolve` maps a wikilink display name to a vault path (or null).
 */
export function parseRelations(
	path: string,
	content: string,
	resolve: (name: string) => string | null,
	knownIds: Set<string>,
): RelationsData {
	const outgoing: RelationEdge[] = [];
	const malformed: MalformedRelation[] = [];
	const section = findRelationsSection(content);
	if (!section) {
		return { outgoing, malformed };
	}

	const lines = content.split(/\r?\n/);
	for (let i = section.startLine + 1; i < section.endLine; i++) {
		const line = lines[i] ?? '';
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('---')) {
			continue;
		}
		if (!trimmed.startsWith('-')) {
			continue;
		}
		const m = trimmed.match(REL_LINE);
		if (!m) {
			malformed.push({ path, line: i, text: trimmed, reason: 'unparsable relation line' });
			continue;
		}
		const relId = m[1]!;
		const targetName = m[2]!;
		const reversed = !!m[3];
		const strengthStr = m[4]!;
		const strength = parseFloat(strengthStr);

		if (!knownIds.has(relId)) {
			malformed.push({ path, line: i, text: trimmed, reason: `unknown relationship type '${relId}'` });
			continue;
		}
		if (strength < 0 || strength > 1) {
			malformed.push({ path, line: i, text: trimmed, reason: `strength out of range [0,1]: ${strengthStr}` });
			continue;
		}

		const target = resolve(targetName);
		if (!target || target === path) {
			malformed.push({ path, line: i, text: trimmed, reason: `unresolved target '${targetName}'` });
			continue;
		}

		// {R}: the authored line is reversed — the hosting note is the semantic
		// destination and the referenced note is the source.
		const source = reversed ? target : path;
		const edgeTarget = reversed ? path : target;
		outgoing.push({
			source,
			target: edgeTarget,
			relId,
			strength,
			reversed,
			authoredFrom: path,
			raw: trimmed,
		});
	}
	return { outgoing, malformed };
}

/**
 * Scan all hologram-scoped notes, parse their Relations and build the complete
 * typed edge set with dedup (first wins) and conflict detection (differing
 * strengths for the same (source, target, relId)).
 */
export async function scanRelations(
	files: TFile[],
	vault: Vault,
	metadataCache: MetadataCache,
	knownIds: Set<string>,
	inScope: (path: string) => boolean,
): Promise<RelationScan> {
	const edges: RelationEdge[] = [];
	const malformed: MalformedRelation[] = [];

	const resolve = (name: string): string | null => metadataCache.getFirstLinkpathDest(name, '')?.path ?? null;

	for (const f of files) {
		if (!inScope(f.path)) {
			continue;
		}
		let content: string;
		try {
			content = await vault.read(f);
		} catch {
			continue;
		}
		const frontmatter = extractFrontmatter(content);
		const fm = parseNoteFrontmatter(frontmatter);
		if (!fm.hologramNode && !inScope(f.path)) {
			continue;
		}
		const data = parseRelations(f.path, content, resolve, knownIds);
		edges.push(...data.outgoing);
		malformed.push(...data.malformed);
	}

	// Dedup on (source, target, relId): keep the first, aggregate strengths for conflicts.
	const unique = new Map<string, RelationEdge>();
	const strengthsByKey = new Map<string, number[]>();
	for (const e of edges) {
		const key = `${e.source}\u0001${e.target}\u0001${e.relId}`;
		if (!unique.has(key)) {
			unique.set(key, e);
		}
		const arr = strengthsByKey.get(key) ?? [];
		arr.push(e.strength);
		strengthsByKey.set(key, arr);
	}

	const conflicts: RelationConflict[] = [];
	for (const [key, strengths] of strengthsByKey) {
		if (new Set(strengths).size < 2) {
			continue;
		}
		const parts = key.split('\u0001');
		conflicts.push({
			path: unique.get(key)?.authoredFrom ?? '',
			relId: parts[1] ?? '',
			source: parts[0] ?? '',
			target: parts[2] ?? '',
			strengths,
		});
	}

	return { edges: [...unique.values()], malformed, conflicts };
}

/** Format strength like `0.5`, `0.25`, `1`. */
export function formatStrength(v: number): string {
	const clamped = Math.min(1, Math.max(0, v));
	const s = clamped.toFixed(2);
	if (s.endsWith('.00')) {
		return s.slice(0, s.length - 3);
	}
	if (s.endsWith('0')) {
		return s.slice(0, s.length - 1);
	}
	return s;
}

/** Serialized representation of a relation line for mirroring. */
export function relationLineToText(rel: RelTypeEntry, targetName: string, strength: number, reversed: boolean): string {
	return `- ${rel.id} [[${targetName}]]${reversed ? ' {R}' : ''} (${formatStrength(strength)})`;
}