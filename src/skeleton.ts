/**
 * The canonical Semantic Node skeleton.
 *
 * There is exactly one generator for a new node's text, because three
 * divergent hand-rolled copies had drifted apart:
 *
 *   - `main.ts` CreateNodeModal wrote `## Relations` *and* a hard-coded
 *     `## Incoming relationships` section (the latter is now rendered
 *     dynamically, so it was a stale duplicate).
 *   - `importNote.ts` wrote `## Relationships` and nothing else.
 *   - `review.ts` / `incomingImportModal.ts` went through
 *     `ensureHologramContent`, which appended the delimiter *after* whatever
 *     prose the user had already written.
 *
 * A note is only two regions: frontmatter, and one body string. Meaning is
 * imposed on the body's slices by header delimiters — nothing else. So this
 * module returns exactly that, in that shape.
 *
 * Pure by construction: no Obsidian imports, so it is unit-testable and
 * callable from the doc generator.
 */

/** Canonical frontmatter key order. Deliberate, not insertion order. */
export const FM_KEY_ORDER = [
	'hologram-node',
	'node-type',
	'source-kind',
	'created',
	'hologram',
	'groups',
	'groups-excluded',
	'confidence',
	'local-confidence',
	'provenance',
] as const;

/** The header that opens the authored relation region. Must be last authored. */
export const RELATIONS_HEADER = '## Relationships';

/**
 * The body with its delimiters, in the one order that is safe:
 * title, then prose, then relations last.
 *
 * Relations go last because `findRelationsSection` defines a section as
 * "everything up to the next `#` header" — so a `## Relationships` placed
 * above the prose would swallow the prose as relation lines and report every
 * paragraph as malformed.
 */
export interface SkeletonBodyParts {
	title: string;
	/** The user's seed. May be empty; never re-emitted if absent. */
	body: string;
}

export interface BuildSkeletonOptions extends SkeletonBodyParts {
	noteType: string;
	created: string;
	/** Optional topic this node belongs to. */
	hologram?: string | undefined;
	/** Optional provenance source ids, as frontmatter list values. */
	sourceKind?: string | undefined;
}

/**
 * Build the frontmatter block. Keys are emitted in `FM_KEY_ORDER`; unknown or
 * caller-supplied extras are appended alphabetically so nothing is dropped.
 */
export function buildSkeletonFrontmatter(opts: BuildSkeletonOptions): string {
	const fields = new Map<string, string>();
	fields.set('hologram-node', 'true');
	fields.set('node-type', opts.noteType);
	if (opts.sourceKind) {
		fields.set('source-kind', opts.sourceKind);
	}
	fields.set('created', opts.created);
	if (opts.hologram) {
		fields.set('hologram', `[${opts.hologram}]`);
	}

	const known = FM_KEY_ORDER.filter((k) => fields.has(k));
	const extras = [...fields.keys()].filter((k) => !FM_KEY_ORDER.includes(k as never)).sort();

	return ['---', ...[...known, ...extras].map((k) => `${k}: ${fields.get(k)}`), '---'].join('\n');
}

/** Build the body: title, prose, then the relations delimiter last. */
export function buildSkeletonBody(parts: SkeletonBodyParts): string {
	const prose = (parts.body ?? '').trim();
	const head = `# ${parts.title}`;
	return prose ? `${head}\n\n${prose}\n\n${RELATIONS_HEADER}\n` : `${head}\n\n${RELATIONS_HEADER}\n`;
}

/** The full note text. The single entry point. */
export function buildHologramSkeleton(opts: BuildSkeletonOptions): string {
	const fm = buildSkeletonFrontmatter(opts);
	const body = buildSkeletonBody(opts);
	return `${fm}\n\n${body}`;
}

/** `created` in the one format the vault uses: ISO date, UTC. */
export function todayIso(now: Date = new Date()): string {
	return now.toISOString().slice(0, 10);
}

/**
 * Reorder an existing frontmatter body's top-level keys into
 * `FM_KEY_ORDER`, leaving unknown keys at the end in their original order.
 *
 * The vault already contains both orderings — `created:` lands before or after
 * `groups:` depending on which code path last wrote the note — so anything that
 * rewrites frontmatter should pass through here to stop the drift spreading.
 * Block-list values stay attached to their key.
 */
export function normalizeFrontmatterOrder(fmBody: string): string {
	interface Chunk {
		key: string;
		lines: string[];
	}
	const chunks: Chunk[] = [];
	let current: Chunk | null = null;
	for (const line of fmBody.split('\n')) {
		const m = line.match(/^([A-Za-z0-9_-]+):/);
		if (m) {
			current = { key: m[1]!, lines: [line] };
			chunks.push(current);
		} else if (current) {
			current.lines.push(line);
		} else if (line.trim()) {
			// Preamble before any key: keep it ahead of everything, untouched.
			chunks.push({ key: '', lines: [line] });
		}
	}
	const preamble = chunks.filter((c) => c.key === '');
	const keyed = chunks.filter((c) => c.key !== '');
	const rank = (key: string): number => {
		const i = FM_KEY_ORDER.indexOf(key as never);
		return i === -1 ? FM_KEY_ORDER.length : i;
	};
	keyed.sort((a, b) => rank(a.key) - rank(b.key));
	return [...preamble, ...keyed].flatMap((c) => c.lines).join('\n');
}

/** Apply `normalizeFrontmatterOrder` to a whole note, if it has frontmatter. */
export function normalizeNoteFrontmatterOrder(content: string): string {
	const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!m) {
		return content;
	}
	const ordered = normalizeFrontmatterOrder(m[1]!);
	if (ordered === m[1]) {
		return content;
	}
	return `---${content.slice(3, m[0].length - 3).replace(m[1]!, ordered)}---${content.slice(m[0].length)}`;
}