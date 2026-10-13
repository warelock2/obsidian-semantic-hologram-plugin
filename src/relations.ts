import { MetadataCache, TFile, Vault, parseYaml } from 'obsidian';
import type { RelTypeEntry } from './settings';
import { HOLOGRAM_FOLDER } from './settings';
// Header delimiters are pure and live in ./headers so they can be unit-tested
// without the type-only `obsidian` package. Re-exported below for the many
// existing `./relations` importers.
import { ANY_HEADER, CONFIDENCE_HEADER, GRAVITAS_HEADER, INCOMING_HEADER, RELATION_HEADER } from './headers';

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

/** A lends-gravitas-to edge authored in an evidence note's ## Gravitas section. */
export interface GravitasEdge {
	source: string; // path of the evidence note
	target: string; // path of the concept note supported
	amount: number; // 0.1..1 (pre-kind, pre-DAG)
	authoredFrom: string;
	raw: string;
}

export interface RelationsData {
	outgoing: RelationEdge[];
	malformed: MalformedRelation[];
}

export interface NoteFrontmatter {
	hologramNode: boolean;
	noteType: string | null;
	confidence: number | null;
	localConfidence: number | null;
	sourceKind: string | null;
	created: string | null;
	groups: string[];
	groupsExcluded: string[];
	holograms?: string[];
}

export { ANY_HEADER, CONFIDENCE_HEADER, GRAVITAS_HEADER, INCOMING_HEADER, PROVENANCE_HEADER, RELATION_HEADER, sectionHeader } from './headers';

// - logic/supports [[Target]] {R}? (0.5)
// - related [[Target]] (0.5)
// - structural/subsumed-by [[Target]] (0.75)
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
	return path.startsWith(`${HOLOGRAM_FOLDER}/`);
}

export function parseNoteFrontmatter(frontmatter: string | null): NoteFrontmatter {
	const out: NoteFrontmatter = {
		hologramNode: false,
		noteType: null,
		confidence: null,
		localConfidence: null,
		sourceKind: null,
		created: null,
		groups: [],
		groupsExcluded: [],
	};
	if (!frontmatter) {
		return out;
	}
	try {
		const fm = parseYaml(frontmatter) as Record<string, unknown>;
		out.hologramNode = !!fm['hologram-node'] || !!fm['hologram_node'];
		let rawType: unknown = fm['node-type'] || fm['note-type'] || null;
		if (typeof rawType === 'string' && rawType.startsWith('DEFUNCT:')) {
			rawType = null;
		}
		out.noteType = typeof rawType === 'string' ? rawType : null;
		const clamp = (v: unknown): number | null => (typeof v === 'number' ? Math.min(1, Math.max(0, v)) : null);
		out.confidence = clamp(fm['confidence']);
		out.localConfidence = clamp(fm['local-confidence'] ?? fm['confidence']);
		out.sourceKind = typeof fm['source-kind'] === 'string' ? fm['source-kind'] : null;
		out.created = fm['created'] ? (typeof fm['created'] === 'object' ? JSON.stringify(fm['created']) : String(fm['created'])) : null;
		if (Array.isArray(fm['groups'])) {
			out.groups = fm['groups'].flatMap((g: unknown): string[] => {
				if (typeof g === 'string') {
					return [g];
				}
				// Unquoted YAML like `- [[Dirty Bit]]` parses as a nested flow
				// sequence (e.g. [['Dirty Bit']]); unwrap a single-element array.
				if (Array.isArray(g) && g.length === 1 && typeof g[0] === 'string') {
					return [g[0]];
				}
				return [];
			});
		}
		if (Array.isArray(fm['groups-excluded'])) {
			out.groupsExcluded = fm['groups-excluded'].flatMap((g: unknown): string[] => {
				if (typeof g === 'string') {
					return [g];
				}
				if (Array.isArray(g) && g.length === 1 && typeof g[0] === 'string') {
					return [g[0]];
				}
				return [];
			});
		}
		const rawHolograms: unknown = fm['holograms'] ?? fm['hologram'];
		if (Array.isArray(rawHolograms)) {
			out.holograms = rawHolograms.flatMap((h: unknown): string[] => {
				if (typeof h === 'string') {
					return [h];
				}
				if (Array.isArray(h) && h.length === 1 && typeof h[0] === 'string') {
					return [h[0]];
				}
				return [];
			});
		} else if (typeof rawHolograms === 'string') {
			out.holograms = [rawHolograms];
		}
	} catch (e) {
		console.error('Failed to parse frontmatter', e);
	}
	return out;
}

/** Extract the text between the first frontmatter fences if present. */
export function extractFrontmatter(content: string): string | null {
	const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	return m && m[1] !== undefined ? m[1] : null;
}

/** Shared bounds scan: the first matching header at column 0, up to the next header. */
function findSection(content: string, header: RegExp): { startLine: number; endLine: number } | null {
	const lines = content.split(/\r?\n/);
	let start = -1;
	for (let i = 0; i < lines.length; i++) {
		if (header.test(lines[i]!)) {
			start = i;
			break;
		}
	}
	if (start < 0) {
		return null;
	}
	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) {
		if (ANY_HEADER.test(lines[i]!)) {
			end = i;
			break;
		}
	}
	return { startLine: start, endLine: end };
}

/** Find the line range of the `## Relations` (or Relationships) section. */
export function findRelationsSection(content: string): { startLine: number; endLine: number } | null {
	return findSection(content, RELATION_HEADER);
}

/** Find the line range of the `## Gravitas` section, if any. */
export function findGravitasSection(content: string): { startLine: number; endLine: number } | null {
	return findSection(content, GRAVITAS_HEADER);
}

/** Author-led line in an evidence note: `- lends-gravitas-to [[Target]] (0.8)`. */
const GRAVITAS_LINE = /^-\s+lends-gravitas-to\s+\[\[([^\]]+)\]\]\s*\((\d{1,2}(?:\.\d{1,2})?)\)\s*$/;

/**
 * Parse a note's ## Gravitas section into lends-gravitas-to edges.
 * Only authored lines count; mirror lines (`- ([[source]]) ...`) are skipped.
 */
export function parseGravitasSection(
	path: string,
	content: string,
	resolve: (name: string, sourcePath: string) => string | null,
): { edges: GravitasEdge[]; malformed: MalformedRelation[] } {
	const edges: GravitasEdge[] = [];
	const malformed: MalformedRelation[] = [];
	const section = findGravitasSection(content);
	if (!section) {
		return { edges, malformed };
	}
	const lines = content.split(/\r?\n/);
	for (let i = section.startLine + 1; i < section.endLine; i++) {
		const line = lines[i] ?? '';
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('---') || trimmed.startsWith('- DEFUNCT:') || trimmed.startsWith('- (')) {
			continue;
		}
		if (!trimmed.startsWith('-')) {
			continue;
		}
		const m = trimmed.match(GRAVITAS_LINE);
		if (!m) {
			malformed.push({ path, line: i, text: trimmed, reason: 'unparsable gravitas line' });
			continue;
		}
		const targetName = m[1]!;
		const amount = parseFloat(m[2]!);
		if (amount < 0.1 || amount > 1) {
			malformed.push({ path, line: i, text: trimmed, reason: `lends-gravitas-to amount out of range [0.1,1]: ${m[2]}` });
			continue;
		}
		const target = resolve(targetName, path);
		if (!target || target === path) {
			console.log(`[SH-Gravitas] Failed to resolve target '${targetName}' from source '${path}'`);
			malformed.push({ path, line: i, text: trimmed, reason: `unresolved target '${targetName}'` });
			continue;
		}
		edges.push({ source: path, target, amount, authoredFrom: path, raw: trimmed });
	}
	return { edges, malformed };
}

/** Replace the `## Gravitas` section body with authored lends-gravitas-to rows. */
export function setGravitasRowsInContent(content: string, rows: Array<{ targetName: string; amount: number }>): string {
	const header = '## Gravitas';
	const body = rows
		.map((r) => `- lends-gravitas-to [[${r.targetName}]] (${formatStrength(r.amount)})`)
		.sort();
	const section = findGravitasSection(content);
	if (!section) {
		if (body.length === 0) {
			return content;
		}
		const ending = content.endsWith('\n') ? '\n' : '\n\n';
		return content + ending + header + '\n\n' + body.join('\n') + '\n';
	}
	const lines = content.split(/\r?\n/);
	if (body.length === 0) {
		const newLines = [...lines.slice(0, section.startLine), ...lines.slice(section.endLine)];
		return newLines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
	}
	const newLines = [...lines.slice(0, section.startLine), header, ...body.map((b) => `  ${b}`), ...lines.slice(section.endLine)];
	return newLines.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** Find the line range of the `## Confidence` mirror section, if any. */
export function findConfidenceSection(content: string): { startLine: number; endLine: number } | null {
	return findSection(content, CONFIDENCE_HEADER);
}

/** Replace the read-only `## Confidence` mirror section (local / inherited / total). */
export function setConfidenceFieldsInContent(content: string, local: number, inherited: number, total: number): string {
	const header = '## Confidence';
	const body = [
		`- local-confidence: ${formatStrength(local)}`,
		`- inherited-confidence: ${formatStrength(inherited)}`,
		`- total-confidence: ${formatStrength(total)}`,
	];
	const section = findConfidenceSection(content);
	if (!section) {
		const ending = content.endsWith('\n') ? '\n' : '\n\n';
		return content + ending + header + '\n\n' + body.join('\n') + '\n';
	}
	const lines = content.split(/\r?\n/);
	const newLines = [...lines.slice(0, section.startLine), header, ...body.map((b) => `  ${b}`), ...lines.slice(section.endLine)];
	return newLines.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** Find the line range of the `## Incoming relationships` section, if any. */
export function findIncomingSection(content: string): { startLine: number; endLine: number } | null {
	return findSection(content, INCOMING_HEADER);
}

/**
	 * Parse a note's Relations section into directed relation edges.
	 * Missing/unresolvable lines are returned in `malformed`.
	 * `resolve` maps a wikilink display name (plus source note path for disambiguation) to a vault path (or null).
	 */
	export function parseRelations(
		path: string,
		content: string,
		resolve: (name: string, sourcePath: string) => string | null,
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
			if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('---') || trimmed.startsWith('- DEFUNCT:')) {
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
			const strengthStr = m[4];
			const strength = parseFloat(strengthStr!);

			if (!knownIds.has(relId)) {
				malformed.push({ path, line: i, text: trimmed, reason: `unknown relationship type '${relId}'` });
				continue;
			}
			if (strength < 0.01 || strength > 1) {
				malformed.push({ path, line: i, text: trimmed, reason: `strength out of range [0.01,1]: ${strengthStr}` });
				continue;
			}

			const target = resolve(targetName, path);
			if (!target || target === path) {
				console.log(`[SH-Relations] Failed to resolve target '${targetName}' from source '${path}'`);
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
		defaultRelStrength: number,
		inScope: (path: string) => boolean,
	): Promise<RelationScan> {
		const edges: RelationEdge[] = [];
		const malformed: MalformedRelation[] = [];

		const resolve = (name: string, sourcePath: string): string | null => {
			const file = metadataCache.getFirstLinkpathDest(name, sourcePath);
			// Enforce separate context: only resolve to files within HOLOGRAM_FOLDER
			if (file && file.path.startsWith(HOLOGRAM_FOLDER + '/')) {
				return file.path;
			}
			return null;
		};

		// A `groups:` membership entry may be any of: a bare name (`Linux Kernel
		// Internals`), a wikilink (`[[Linux Kernel Internals]]`), a folder-qualified
		// wikilink with alias (`[[hologram/Linux Kernel Internals|Linux Kernel
		// Internals (0.50)]]`), or a wikilink with a trailing strength token
		// (`[[hologram/Demand Paging]] (0.50)`). Normalize to the link target and
		// resolve it to a hologram note path.
		const resolveGroup = (group: string, sourcePath: string): string | null => {
			const wikilink = group.match(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]*)?\]\]/);
			let target = wikilink ? wikilink[1]!.trim() : group.trim();
			// Drop any leftover strength token like `(0.50)` after the target.
			target = target.replace(/\s*\(\d{1,2}(?:\.\d{1,2})?\)\s*$/, '');
			const file = metadataCache.getFirstLinkpathDest(target, sourcePath);
			if (file && file.path.startsWith(HOLOGRAM_FOLDER + '/')) {
				return file.path;
			}
			return null;
		};

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
			console.log(`[SH-Relations] Parsed ${data.outgoing.length} edges from ${f.path}`);
			edges.push(...data.outgoing);
			malformed.push(...data.malformed);

			for (const group of fm.groups) {
				const parentPath = resolveGroup(group, f.path);
				if (parentPath) {
					edges.push({
						source: f.path,          // Lower-order concept (Child/Specialization)
						target: parentPath,      // Higher-order concept (Parent)
						relId: 'structural/subsumed-by',
						strength: defaultRelStrength, // structural factor — keeps gravitas independent of confidence
						reversed: false,
						authoredFrom: f.path,
						raw: `groups: ${group}`,
					});
				}
			}
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

/**
 * Set the `groups:` and `groups-excluded:` frontmatter lists of a note body,
 * preserving every other field. `groupName` entries not present in the lists
 * are appended; entries already present are de-duplicated.
 */
export function setGroupsInContent(content: string, groups: string[], groupsExcluded: string[]): string {
	const clean = (arr: string[]): string[] =>
		[...new Set(arr.map((g) => g.trim()).filter(Boolean))];
	const g = stringifyList(clean(groups));
	const e = stringifyList(clean(groupsExcluded));
	const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!m) {
		return `---\ngroups:\n${g}groups-excluded:\n${e}---\n\n${content}`;
	}
	let body = m[1]!;
	body = replaceListKey(body, 'groups', g);
	body = replaceListKey(body, 'groups-excluded', e);
	return `---\n${body}\n---${content.slice(m[0].length)}`;
}

/**
 * Set the `holograms:` frontmatter list of a note body, preserving every other field.
 * Tags already present are deduplicated.
 */
export function setHologramsInContent(content: string, holograms: string[]): string {
	const clean = (arr: string[]): string[] =>
		[...new Set(arr.map((g) => g.trim()).filter(Boolean))];
	const h = stringifyList(clean(holograms));
	const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!m) {
		return `---\nholograms:\n${h}---\n\n${content}`;
	}
	let body = m[1]!;
	body = replaceListKey(body, 'holograms', h);
	return `---\n${body}\n---${content.slice(m[0].length)}`;
}

/** YAML block-list lines for the given strings (indented under a key). */
function stringifyList(arr: string[]): string {
	return arr.length === 0 ? '  []\n' : arr.map((s) => `  - "${s.replace(/"/g, '\\"')}"\n`).join('');
}

/**
 * Replace (or insert) a YAML list key inside a frontmatter body. Handles both
 * block lists (`groups:\n  - A`) and flow lists (`groups: [A]`).
 */
function replaceListKey(body: string, key: string, replacement: string): string {
	const re = new RegExp(`^${key}:.*$`, 'm');
	const line = `${key}:`;
	// Insert after the last non-empty line so we never land inside another key's
	// block. For a fresh key, append at the end.
	if (!re.test(body)) {
		const trimmed = body.trimEnd();
		return trimmed ? `${trimmed}\n${line}\n${replacement}` : `${line}\n${replacement}`;
	}
	// Remove the old key line and any following block-list items.
	const lines = body.split('\n');
	let idx = lines.findIndex((l) => new RegExp(`^${key}:`).test(l));
	if (idx < 0) {
		return body;
	}
	let end = idx + 1;
	while (end < lines.length && /^\s+[-[]/.test(lines[end]!)) {
		end++;
	}
	lines.splice(idx, end - idx, line, ...replacement.split('\n'));
	return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** Serialized representation of a relation line for mirroring. */
export function relationLineToText(rel: RelTypeEntry, targetName: string, strength: number, reversed: boolean): string {
	return `- ${rel.id} [[${targetName}]]${reversed ? ' {R}' : ''} (${formatStrength(strength)})`;
}

// An authored relation line (`- <relId> [[target]] [{R}]`) with no strength.
// Does not match incoming mirror lines (`- ([[...]])`) or `- DEFUNCT:` lines.
const REL_LINE_NO_STRENGTH =
	/^(-\s+[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?\s+\[\[[^\]]+\]\]\s*(?:\{R\})?\s*)$/gm;

export interface MissingStrengthLocation {
	line: number;
	text: string;
}

/** Locate authored relationship lines that are missing an explicit strength. */
export function findMissingStrengths(content: string): MissingStrengthLocation[] {
	const out: MissingStrengthLocation[] = [];
	const re = new RegExp(REL_LINE_NO_STRENGTH.source, REL_LINE_NO_STRENGTH.flags);
	let m: RegExpExecArray | null;
	while ((m = re.exec(content)) !== null) {
		if (m[0].length === 0) {
			re.lastIndex++;
			continue;
		}
		const line = (content.slice(0, m.index).match(/\n/g)?.length ?? 0) + 1;
		out.push({ line, text: m[0].trim() });
	}
	return out;
}

/** Re-append the configured default strength to relation lines that lack one. */
export function normalizeRelationStrengths(content: string, defaultRelStrength: number): string {
	const strength = formatStrength(defaultRelStrength);
	return content.replace(REL_LINE_NO_STRENGTH, (m) => `${m} (${strength})`);
}