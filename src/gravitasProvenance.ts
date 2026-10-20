import type { GravitasEdge, RelationEdge } from './relations';
import type { SourceKindEntry } from './settings';

export interface ProvenanceEntry {
	sourcePath: string;
	sourceName: string;
	amount: number;
	direct: boolean;
}

export interface NodeMeta {
	path: string;
	nodeType: string;
	sourceKind: string | null;
}

export function computeProvenance(
	metas: Map<string, NodeMeta>,
	subsumedEdges: RelationEdge[],
	gravEdges: GravitasEdge[],
	sourceKinds: SourceKindEntry[],
): Map<string, ProvenanceEntry[]> {
	const kindPercent = (kind: string | null): number => {
		if (!kind) return 0;
		return (sourceKinds.find((k) => k.id === kind)?.percent ?? 0) / 100;
	};
	const directBySource = new Map<string, Map<string, number>>();
	for (const e of gravEdges) {
		const meta = metas.get(e.source);
		const pct = meta ? kindPercent(meta.sourceKind) : 0;
		const v = e.amount * pct;
		const perSource = directBySource.get(e.target) ?? new Map<string, number>();
		perSource.set(e.source, (perSource.get(e.source) ?? 0) + v);
		directBySource.set(e.target, perSource);
	}

	const childrenOf = new Map<string, Array<{ child: string; strength: number }>>();
	for (const e of subsumedEdges) {
		if (e.relId !== 'structural/subsumed-by' || e.source === e.target) continue;
		const arr = childrenOf.get(e.target) ?? [];
		arr.push({ child: e.source, strength: Math.max(0, Math.min(1, e.strength)) });
		childrenOf.set(e.target, arr);
	}

	const memo = new Map<string, Map<string, number>>();
	const contrib = (path: string, depth: number): Map<string, number> => {
		const cached = memo.get(path);
		if (cached) return cached;
		if (depth > 500) return new Map();
		const out = new Map<string, number>();
		for (const [src, v] of directBySource.get(path) ?? []) out.set(src, v);
		for (const { child, strength } of childrenOf.get(path) ?? []) {
			for (const [src, v] of contrib(child, depth + 1)) {
				out.set(src, (out.get(src) ?? 0) + v * strength);
			}
		}
		memo.set(path, out);
		return out;
	};

	const result = new Map<string, ProvenanceEntry[]>();
	for (const meta of metas.values()) {
		const all = contrib(meta.path, 0);
		const direct = directBySource.get(meta.path) ?? new Map<string, number>();
		const raw: ProvenanceEntry[] = [];
		let total = 0;
		for (const [src, v] of all) {
			if (v <= 0) continue;
			total += v;
			const d = direct.get(src) ?? 0;
			const sourceName = src.split('/').pop()?.replace(/\.md$/i, '') ?? src;
			if (d > 0) {
				raw.push({ sourcePath: src, sourceName, amount: d, direct: true });
			}
			const inherited = v - d;
			if (inherited > 1e-12) raw.push({ sourcePath: src, sourceName, amount: inherited, direct: false });
		}
		const scale = total > 1 ? 1 / total : 1;
		for (const entry of raw) entry.amount = entry.amount * scale;
		raw.sort(
			(a, b) =>
				a.sourceName === b.sourceName
				? a.direct === b.direct ? 0 : a.direct ? -1 : 1
				: a.sourceName < b.sourceName ? -1 : 1,
		);
		result.set(meta.path, raw);
	}
	return result;
}
