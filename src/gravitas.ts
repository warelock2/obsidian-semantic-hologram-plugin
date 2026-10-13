import { MetadataCache, TFile, Vault } from 'obsidian';
import type { GravitasEdge, MalformedRelation, RelationEdge } from './relations';
import { parseGravitasSection, parseNoteFrontmatter, extractFrontmatter } from './relations';
import { DEFAULT_NODE_TYPE_ID } from './settings';
import type { SourceKindEntry } from './settings';

/** Evidence notes lend gravitas; they are never graph nodes themselves. */
export const EVIDENCE_TYPES = new Set(['source', 'authority', 'data']);

export function isEvidenceType(nodeType: string | null | undefined): boolean {
	return nodeType !== null && nodeType !== undefined && EVIDENCE_TYPES.has(nodeType);
}

export interface GravitasScan {
	edges: GravitasEdge[];
	malformed: MalformedRelation[];
}

/** Per-node derived values: gravitas (structural strength) + three-tier confidence. */
export interface NodeStats {
	gravitasDirect: number;
	gravitasReal: number;
	gravitasDisplay: number;
	confidenceLocal: number;
	confidenceInherited: number;
	confidenceTotal: number;
}

export interface NodeMeta {
	path: string;
	nodeType: string;
	localConfidence: number;
	sourceKind: string | null;
}

/** Read node-type / local-confidence / source-kind from cached frontmatter. */
export function readNodeMetas(
	files: TFile[],
	metadataCache: MetadataCache,
	defaultConfidence: number,
	defaultType: string = DEFAULT_NODE_TYPE_ID,
): Map<string, NodeMeta> {
	const metas = new Map<string, NodeMeta>();
	for (const f of files) {
		const fm = (metadataCache.getFileCache(f)?.frontmatter ?? {}) as Record<string, unknown>;
		const nodeType =
			(typeof fm['node-type'] === 'string' ? fm['node-type'] : undefined) ??
			(typeof fm['note-type'] === 'string' ? fm['note-type'] : undefined) ??
			defaultType;
		const rawLocal = fm['local-confidence'] ?? fm['confidence'];
		const local = typeof rawLocal === 'number' ? Math.min(1, Math.max(0, rawLocal)) : defaultConfidence;
		const sourceKind = typeof fm['source-kind'] === 'string' ? fm['source-kind'] : null;
		metas.set(f.path, { path: f.path, nodeType, localConfidence: local, sourceKind });
	}
	return metas;
}

/** Fresh frontmatter-based meta read (vault.read) — used by the mirror sync. */
export async function readNodeMetasFresh(
	files: TFile[],
	vault: Vault,
	defaultConfidence: number,
	defaultType: string = DEFAULT_NODE_TYPE_ID,
): Promise<Map<string, NodeMeta>> {
	const metas = new Map<string, NodeMeta>();
	for (const f of files) {
		let content: string;
		try {
			content = await vault.read(f);
		} catch {
			continue;
		}
		const fm = parseNoteFrontmatter(extractFrontmatter(content));
		metas.set(f.path, {
			path: f.path,
			nodeType: fm.noteType ?? defaultType,
			localConfidence: fm.localConfidence ?? defaultConfidence,
			sourceKind: fm.sourceKind,
		});
	}
	return metas;
}

/**
 * Scan every hologram note's `## Gravitas` section for lends-gravitas-to edges.
 * Only notes typed as evidence contribute; the target must resolve inside the
 * hologram scope.
 */
export async function scanGravitas(
	files: TFile[],
	vault: Vault,
	metadataCache: MetadataCache,
	inScope: (path: string) => boolean,
	defaultType: string = DEFAULT_NODE_TYPE_ID,
): Promise<GravitasScan> {
	const metas = readNodeMetas(files, metadataCache, 0.5, defaultType);
	const edges: GravitasEdge[] = [];
	const malformed: MalformedRelation[] = [];
	const resolve = (name: string, sourcePath: string): string | null => {
		const file = metadataCache.getFirstLinkpathDest(name, sourcePath);
		if (file && inScope(file.path)) {
			return file.path;
		}
		return null;
	};
	for (const f of files) {
		if (!inScope(f.path)) {
			continue;
		}
		const meta = metas.get(f.path);
		if (!meta || !isEvidenceType(meta.nodeType)) {
			continue;
		}
		let content: string;
		try {
			content = await vault.cachedRead(f);
		} catch {
			continue;
		}
		const parsed = parseGravitasSection(f.path, content, resolve);
		edges.push(...parsed.edges);
		malformed.push(...parsed.malformed);
	}
	return { edges, malformed };
}

/**
 * Compute gravitas (structural strength) and confidence (local / inherited /
 * total) for every node. Gravitas: direct lending (amount × source-kind %)
 * plus members' real gravitas weighted by the subsumed-by edge strength,
 * accumulated up the DAG — the real (uncapped) value propagates, display caps
 * at 1. Confidence: total = local + inherited, where inherited = Σ children's
 * total. Shared descendants count once (memoized), cycles are guarded.
 */
export function computeNodeStats(
	metas: Map<string, NodeMeta>,
	subsumedEdges: RelationEdge[],
	gravEdges: GravitasEdge[],
	sourceKinds: SourceKindEntry[],
	defaultConfidence: number,
): Map<string, NodeStats> {
	const kindPercent = (kind: string | null): number => {
		if (!kind) {
			return 0;
		}
		return (sourceKinds.find((k) => k.id === kind)?.percent ?? 0) / 100;
	};

	const direct = new Map<string, number>();
	for (const e of gravEdges) {
		const meta = metas.get(e.source);
		const pct = meta ? kindPercent(meta.sourceKind) : 0;
		const v = e.amount * pct;
		direct.set(e.target, (direct.get(e.target) ?? 0) + v);
	}

	const childrenOf = new Map<string, Array<{ child: string; strength: number }>>();
	for (const e of subsumedEdges) {
		if (e.relId !== 'structural/subsumed-by' || e.source === e.target) {
			continue;
		}
		const arr = childrenOf.get(e.target) ?? [];
		arr.push({ child: e.source, strength: Math.max(0, Math.min(1, e.strength)) });
		childrenOf.set(e.target, arr);
	}

	const stats = new Map<string, NodeStats>();
	const memoG = new Map<string, number>();
	const memoC = new Map<string, number>();

	const gravitasReal = (path: string, depth: number): number => {
		if (memoG.has(path)) {
			return memoG.get(path)!;
		}
		if (depth > 500) {
			return 0;
		}
		let v = direct.get(path) ?? 0;
		for (const { child, strength } of childrenOf.get(path) ?? []) {
			v += gravitasReal(child, depth + 1) * strength;
		}
		memoG.set(path, v);
		return v;
	};

	const confidenceTotalReal = (path: string, depth: number): number => {
		if (memoC.has(path)) {
			return memoC.get(path)!;
		}
		if (depth > 500) {
			return 0;
		}
		let inherited = 0;
		for (const { child } of childrenOf.get(path) ?? []) {
			inherited += confidenceTotalReal(child, depth + 1);
		}
		const local = metas.get(path)?.localConfidence ?? defaultConfidence;
		const total = local + inherited;
		memoC.set(path, total);
		return total;
	};

	for (const meta of metas.values()) {
		const real = gravitasReal(meta.path, 0);
		const inheritedConf = confidencesOfChildren(confidenceTotalReal, meta.path);
		const totalReal = confidenceTotalReal(meta.path, 0);
		stats.set(meta.path, {
			gravitasDirect: direct.get(meta.path) ?? 0,
			gravitasReal: real,
			gravitasDisplay: Math.min(1, real),
			confidenceLocal: meta.localConfidence,
			confidenceInherited: inheritedConf,
			confidenceTotal: Math.min(1, totalReal),
		});
	}
	return stats;

	function confidencesOfChildren(totalReal: (p: string, d: number) => number, path: string): number {
		let inherited = 0;
		for (const { child } of childrenOf.get(path) ?? []) {
			inherited += totalReal(child, 0);
		}
		return inherited;
	}
}