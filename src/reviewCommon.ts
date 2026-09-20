import { TFile } from 'obsidian';
import type SemanticHologramPlugin from './main';
import type { RelationEdge } from './relations';
import { scanRelations, formatStrength } from './relations';
import { extractFrontmatter, parseNoteFrontmatter, findIncomingSection, findRelationsSection, setGroupsInContent } from './relations';

export type GroupState = 'candidate' | 'member' | 'deleted';

export interface ReviewPair {
	source: TFile;
	target: TFile;
	sourceType: string;
	targetType: string;
	edges: RelationEdge[];
}

export interface GroupSubject {
	node: TFile;
	noteType: string;
	state: GroupState;
}

export interface GroupBucket {
	group: TFile;
	groupType: string;
	members: GroupSubject[];
	deleted: GroupSubject[];
	candidates: GroupSubject[];
}

export interface ReviewData {
	nodes: TFile[];
	nodeTypes: Map<string, string>;
	pairs: ReviewPair[];
	groups: GroupBucket[];
}

/** Read a note's type from frontmatter cache, defaulting to `concept`. */
export function noteTypeOf(plugin: SemanticHologramPlugin, file: TFile): string {
	const cache = plugin.app.metadataCache.getFileCache(file);
	const fm: Record<string, unknown> | undefined = cache?.frontmatter;
	const raw = fm?.['node-type'] ?? fm?.['note-type'];
	return typeof raw === 'string' && raw.trim() ? raw : 'concept';
}

/** Sortable bucket key for a type pair, e.g. `concept|pattern` (alphabetical). */
export function typeBucketKey(a: string, b: string): string {
	return a.localeCompare(b) <= 0 ? `${a}|${b}` : `${b}|${a}`;
}

/** Normalize a `groups:` entry to a plain name for member matching. */
function groupTargetName(entry: string): string {
	const wikilink = entry.match(/\[\[([^\]|#]+)/);
	let target = wikilink ? wikilink[1]! : entry;
	target = target.trim().replace(/\s*\(\d{1,2}(?:\.\d{1,2})?\)\s*$/, '');
	const slash = target.lastIndexOf('/');
	return slash >= 0 ? target.slice(slash + 1) : target;
}

/** Collect everything the Review view/modal renders in one pass. */
export async function collectReviewData(plugin: SemanticHologramPlugin): Promise<ReviewData> {
	const vault = plugin.app.vault;
	const files = vault
		.getMarkdownFiles()
		.filter((f) => plugin.isInScope(f.path))
		.sort((a, b) => a.path.localeCompare(b.path));

	const nodeTypes = new Map<string, string>();
	for (const f of files) {
		nodeTypes.set(f.path, noteTypeOf(plugin, f));
	}

	const scan = await scanRelations(
		files,
		vault,
		plugin.app.metadataCache,
		plugin.knownRelIds(),
		plugin.settings.defaultRelStrength,
		(path) => plugin.isInScope(path),
	);

	const pairEdges = new Map<string, RelationEdge[]>();
	for (const e of scan.edges) {
		const key = e.source < e.target ? `${e.source}|${e.target}` : `${e.target}|${e.source}`;
		const arr = pairEdges.get(key) ?? [];
		arr.push(e);
		pairEdges.set(key, arr);
	}

	const pairs: ReviewPair[] = [];
	for (let i = 0; i < files.length; i++) {
		const a = files[i]!;
		for (let j = i + 1; j < files.length; j++) {
			const b = files[j]!;
			const key = `${a.path}|${b.path}`;
			pairs.push({
				source: a,
				target: b,
				sourceType: nodeTypes.get(a.path) ?? 'concept',
				targetType: nodeTypes.get(b.path) ?? 'concept',
				edges: pairEdges.get(key) ?? [],
			});
		}
	}
	pairs.sort((a, b) => {
		const ak = `${a.sourceType}|${a.targetType}|${a.source.basename}|${a.target.basename}`;
		const bk = `${b.sourceType}|${b.targetType}|${b.source.basename}|${b.target.basename}`;
		return ak.localeCompare(bk);
	});

	const groups = await collectGroups(plugin, files, nodeTypes);
	return { nodes: files, nodeTypes, pairs, groups };
}

/** Group membership: non-concept nodes act as groups; other nodes are subjects. */
async function collectGroups(
	plugin: SemanticHologramPlugin,
	files: TFile[],
	nodeTypes: Map<string, string>,
): Promise<GroupBucket[]> {
	// name -> group file (by basename, folder-qualified ignored)
	const groupByName = new Map<string, TFile>();
	for (const f of files) {
		if ((nodeTypes.get(f.path) ?? 'concept') !== 'percept') {
			groupByName.set(f.basename, f);
		}
	}

	// Read each node's groups / groups-excluded frontmatter once.
	const memberships = new Map<string, Set<string>>(); // path -> set of group basenames (member)
	const exclusions = new Map<string, Set<string>>(); // path -> set of group basenames (deleted)
	await Promise.all(
		files.map(async (f) => {
			try {
				const content = await plugin.app.vault.cachedRead(f);
				const fm = parseNoteFrontmatter(extractFrontmatter(content));
				memberships.set(
					f.path,
					new Set(fm.groups.map((g) => groupTargetName(g)).filter((g) => g.length > 0)),
				);
				exclusions.set(
					f.path,
					new Set(fm.groupsExcluded.map((g) => groupTargetName(g))),
				);
			} catch {
				memberships.set(f.path, new Set());
				exclusions.set(f.path, new Set());
			}
		}),
	);

	const buckets: GroupBucket[] = [];
	for (const [name, group] of groupByName) {
		const groupType = nodeTypes.get(group.path) ?? 'concept';
		const members: GroupSubject[] = [];
		const deleted: GroupSubject[] = [];
		const candidates: GroupSubject[] = [];
		for (const f of files) {
			if (f.path === group.path) {
				continue;
			}
			const type = nodeTypes.get(f.path) ?? 'concept';
			if (memberships.get(f.path)?.has(name)) {
				members.push({ node: f, noteType: type, state: 'member' });
			} else if (exclusions.get(f.path)?.has(name)) {
				deleted.push({ node: f, noteType: type, state: 'deleted' });
			} else {
				candidates.push({ node: f, noteType: type, state: 'candidate' });
			}
		}
		const great = (x: GroupSubject, y: GroupSubject) =>
			`${x.noteType}|${x.node.basename}`.localeCompare(`${y.noteType}|${y.node.basename}`);
		members.sort(great);
		deleted.sort(great);
		candidates.sort(great);
		buckets.push({ group, groupType, members, deleted, candidates });
	}
	buckets.sort((a, b) =>
		`${a.groupType}|${a.group.basename}`.localeCompare(`${b.groupType}|${b.group.basename}`),
	);
	return buckets;
}

/** Append a relation line to a note's `## Relations` section, creating it if needed. */
export async function addRelation(
	plugin: SemanticHologramPlugin,
	sourceFile: TFile,
	targetFile: TFile,
	relId: string,
	strength: number,
	reversed: boolean,
): Promise<void> {
	const vault = plugin.app.vault;
	let content = await vault.read(sourceFile);
	const lines = content.split(/\r?\n/);
	const line = `- ${relId} [[${targetFile.basename}]]${reversed ? ' {R}' : ''} (${formatStrength(strength)})`;
	const section = findRelationsSection(content);
	if (section) {
		lines.splice(section.startLine + 1, 0, '', line);
	} else {
		const incoming = findIncomingSection(content);
		lines.splice(incoming ? incoming.startLine : lines.length, 0, '', '## Relations', '', line);
	}
	await vault.modify(sourceFile, lines.join('\n').replace(/\n{3,}/g, '\n\n'));
}

/** Remove a relation line (verbatim `raw`) from the note that hosts it. */
export async function removeRelation(plugin: SemanticHologramPlugin, authoringFile: TFile, raw: string): Promise<void> {
	const vault = plugin.app.vault;
	let content = await vault.read(authoringFile);
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

/** Set a node's membership state in a group (writes frontmatter). */
export async function setGroupState(
	plugin: SemanticHologramPlugin,
	subject: TFile,
	groupName: string,
	state: GroupState,
): Promise<void> {
	const vault = plugin.app.vault;
	let content = await vault.read(subject);
	const fm = parseNoteFrontmatter(extractFrontmatter(content));
	let members = fm.groups.map((g) => groupTargetName(g));
	let excluded = fm.groupsExcluded.map((g) => groupTargetName(g));
	members = members.filter((g) => g !== groupName);
	excluded = excluded.filter((g) => g !== groupName);
	if (state === 'member') {
		members.push(groupName);
	} else if (state === 'deleted') {
		excluded.push(groupName);
	}
	await vault.modify(subject, setGroupsInContent(content, members, excluded));
}