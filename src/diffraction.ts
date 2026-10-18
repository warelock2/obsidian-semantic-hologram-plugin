/**
 * Diffraction — activation analysis over the hologram graph.
 *
 * Ported from `oldproject/` (read-only reference, never modified). The
 * original instrument vocabulary was electrical: voltage applied at a source,
 * current flowing through resistors (connections), brightness read at every
 * other concept. That vocabulary was metaphor, but the maths under it was real
 * and worth keeping — this file is the "beam through the lattice" step of
 * `docs/thought-crystallography.md`.
 *
 * Three things were deliberately changed rather than translated:
 *
 *  1. One `applyVoltage`, not seven. The originals exist in seven files with
 *     three different signatures and drifting `steps`/`decay` defaults. Every
 *     lens here calls this one.
 *  2. No vault access. The originals walked the filesystem with `os.walk`
 *     against a hardcoded path and read note bodies. This takes a graph
 *     structure in and gives data out, so the whole module is pure and never
 *     touches note content — only labels and path keys.
 *  3. The hand-written domain map is gone. `score_engine.py` scored novelty
 *     against a literal table of five subsystems and twenty Linux-kernel note
 *     names. Communities are derived from the graph instead.
 *
 * Everything here is a pure function over indices into `ScanGraph.nodes`.
 * Nothing in this file may import the view, the plugin, or Obsidian.
 */

/** A node as the analysis needs it: identity and a display label, nothing more. */
export interface ScanNode {
	path: string;
	label: string;
}

/** A directed connection. `strength` is the resistor's conductance share. */
export interface ScanEdge {
	a: number;
	b: number;
	strength: number;
	relId?: string;
	justification?: string;
}

/** The whole input. Deliberately minimal — no positions, no gravitas, no DOM. */
export interface ScanGraph {
	nodes: readonly ScanNode[];
	edges: readonly ScanEdge[];
}

/**
 * Tuning for the activation pass.
 *
 * The defaults are the originals' (`voltage_meter.py`), which were themselves
 * tuned against a 25-note reference vault. Every one is a parameter rather
 * than a literal so a caller can measure rather than edit.
 */
export const DIFFRACTION = {
	/** Below this a node is treated as dark and stops propagating. */
	activationFloor: 0.001,
	/** Floor on an edge's conductance, so a zero-strength edge is not a wall. */
	conductanceFloor: 0.1,
	/** Uniform grounding conductance from every node to common ground. */
	groundConductance: 0.05,
	/** Iteration stops when the maximum absolute change per step is below this residual threshold. */
	residualThreshold: 0.0001,
	/** Children on a channel tree node are filtered by this quantile. */
	quantile: 0.5,
	/** Charge injected at a source. */
	sourceVoltage: 1.0,
} as const;

export interface ActivationOptions {
	activationFloor?: number;
	conductanceFloor?: number;
	groundConductance?: number;
	residualThreshold?: number;
	quantile?: number;
	sourceVoltage?: number;
}

/** Adjacency with strengths, plus directional (outbound) and inverse structures. */
export interface Adjacency {
	/** Outbound neighbours for each node. */
	neighbours: number[][];
	/** neighbours[i] with the connecting strength, parallel to `neighbours`. */
	conductance: number[][];
	/** Inbound neighbours for each node. */
	inverse: number[][];
	/** inverse[i] with the connecting strength, parallel to `inverse`. */
	inverseConductance: number[][];
	/** Undirected union of a and b (for lens compatibility). */
	has: (a: number, b: number) => boolean;
	/** Undirected union strength between a and b. */
	strengthBetween: (a: number, b: number) => number;
	/** Directed edge from a to b? */
	hasDirected: (a: number, b: number) => boolean;
	/** Directed strength from a to b. */
	strengthBetweenDirected: (a: number, b: number) => number;
}

/** Build the adjacency structure. Directional; outbound and inverse structures. */
export function buildAdjacency(graph: ScanGraph, conductanceFloor = DIFFRACTION.conductanceFloor): Adjacency {
	const n = graph.nodes.length;
	const neighbours: number[][] = Array.from({ length: n }, () => []);
	const conductance: number[][] = Array.from({ length: n }, () => []);
	const inverse: number[][] = Array.from({ length: n }, () => []);
	const inverseConductance: number[][] = Array.from({ length: n }, () => []);
	const weightDirected = new Map<string, number>();

	const link = (a: number, b: number, strength: number): void => {
		const key = `${a}|${b}`;
		const newStrength = Math.max(strength, 0);
		const existing = weightDirected.get(key);
		const finalStrength = existing !== undefined ? Math.max(existing, newStrength) : newStrength;
		weightDirected.set(key, finalStrength);

		const c = Math.max(finalStrength, conductanceFloor);
		if (existing === undefined) {
			neighbours[a]?.push(b);
			conductance[a]?.push(c);
			inverse[b]?.push(a);
			inverseConductance[b]?.push(c);
		} else {
			const idx = neighbours[a]?.indexOf(b);
			if (idx !== undefined && idx >= 0 && conductance[a]) conductance[a][idx] = c;
			const invIdx = inverse[b]?.indexOf(a);
			if (invIdx !== undefined && invIdx >= 0 && inverseConductance[b]) inverseConductance[b][invIdx] = c;
		}
	};

	for (const e of graph.edges) {
		if (e.a === e.b) continue; // self-loop carries no information here
		if (e.a < 0 || e.b < 0 || e.a >= n || e.b >= n) continue;
		link(e.a, e.b, e.strength);
	}

	// Undirected union for lens compatibility
	const undirectedWeight = new Map<string, number>();
	for (const e of graph.edges) {
		if (e.a === e.b) continue;
		const key = e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`;
		const existing = undirectedWeight.get(key);
		undirectedWeight.set(key, Math.max(existing ?? 0, e.strength, 0));
	}

	return {
		neighbours,
		conductance,
		inverse,
		inverseConductance,
		has: (a, b) => undirectedWeight.has(a < b ? `${a}|${b}` : `${b}|${a}`),
		strengthBetween: (a, b) => undirectedWeight.get(a < b ? `${a}|${b}` : `${b}|${a}`) ?? 0,
		hasDirected: (a, b) => weightDirected.has(`${a}|${b}`),
		strengthBetweenDirected: (a, b) => weightDirected.get(`${a}|${b}`) ?? 0,
	};
}

/** A node in the channel tree. */
export interface ChannelNode {
	node: number;
	shareFromParent: number;
	children: ChannelNode[];
}

/** A root-to-leaf trace through the channel tree. */
export interface Claim {
	path: number[];
	hops: Hop[];
	depth: number;
	minShare: number;
	meanShare: number;
	endpointsLinked: boolean;
}

/** Per-hop metadata for a claim. */
export interface Hop {
	from: number;
	to: number;
	share: number;
	strength: number;
	relId: string;
}

/**
 * Enumerate claims from channel tree roots and rank them.
 * Novelty first, then depth, then mean share.
 */
export function rankClaims(
	graph: ScanGraph,
	roots: ChannelNode[],
	adjacency: Adjacency,
	limit = 20,
): Claim[] {
	const claims: Claim[] = [];
	for (const root of roots) {
		enumerateClaims(root, [root.node], [], graph, adjacency, claims);
	}
	claims.sort((a, b) => {
		if (a.endpointsLinked !== b.endpointsLinked) return a.endpointsLinked ? 1 : -1;
		if (a.depth !== b.depth) return b.depth - a.depth;
		return b.meanShare - a.meanShare;
	});
	return claims.slice(0, limit);
}

function enumerateClaims(
	node: ChannelNode,
	path: number[],
	hops: Hop[],
	graph: ScanGraph,
	adjacency: Adjacency,
	claims: Claim[],
): void {
	if (node.children.length === 0) {
		const first = path[0]!;
		const last = path[path.length - 1]!;
		const depth = path.length - 1;
		const minShare = hops.length > 0 ? Math.min(...hops.map(h => h.share)) : 0;
		const meanShare = hops.length > 0 ? hops.reduce((s, h) => s + h.share, 0) / hops.length : 0;
		claims.push({ path: [...path], hops: [...hops], depth, minShare, meanShare, endpointsLinked: adjacency.has(first, last) });
		return;
	}
	for (const child of node.children) {
		const parentIdx = path[path.length - 1]!;
		const share = child.shareFromParent;
		const strength = adjacency.strengthBetweenDirected(parentIdx, child.node);
		const relId = findRelId(graph, parentIdx, child.node);
		enumerateClaims(child, [...path, child.node], [...hops, { from: parentIdx, to: child.node, share, strength, relId }], graph, adjacency, claims);
	}
}

function findRelId(graph: ScanGraph, from: number, to: number): string {
	const edge = graph.edges.find(e => e.a === from && e.b === to);
	return edge?.relId ?? 'unknown';
}

/**
 * Format claims for console readout.
 */
export function consoleReadout(graph: ScanGraph, claims: Claim[]): string {
	if (claims.length === 0) return 'No claims found.';
	const lines: string[] = [];
	for (let i = 0; i < claims.length; i++) {
		const c = claims[i]!;
		const labels = c.path.map(n => graph.nodes[n]?.label ?? `node${n}`).join(' → ');
		const shares = c.hops.map(h => h.share.toFixed(3)).join(', ');
		lines.push(`${i + 1}. [${c.endpointsLinked ? 'LINKED' : 'NOVEL'}] depth=${c.depth} meanShare=${c.meanShare.toFixed(3)}`);
		lines.push(`   path: ${labels}`);
		lines.push(`   shares: [${shares}]`);
	}
	return lines.join('\n');
}

/** The activation field plus the channel tree roots. */
export interface Field {
	energy: Map<number, number>;
	roots: ChannelNode[];
	maxEnergy: number;
	meanEnergy: number;
}

/**
 * Activation pass — the primitive every lens is built on.
 *
 * Charge is held at `sources` (a maintained voltage source, re-clamped to
 * `sourceVoltage` after every pass), spreads to each node's outbound
 * neighbours in proportion to conductance, and leaks to a uniform grounding
 * conductance. Iteration runs until the maximum absolute change per step is
 * below the residual threshold. Synchronous update (all deltas read the
 * previous step), which is what makes the result deterministic and
 * order-independent.
 *
 * Charge is conserved along the edges: a node hands out exactly what it holds
 * (ground loss plus its edge shares sum to its whole charge) and keeps only
 * what arrives, so a node with no inbound edges is driven to exactly zero and
 * no edge flow can create charge.
 *
 * That conservation is why the source must be sustained. With a ground sink on
 * every node and a single injection at t = 0, the ONLY fixed point is the zero
 * field — charge drains outward one hop per step and the frontier falls below
 * the floor, so every run converges dark and the Activation, gaps and resonance
 * layers have nothing to report. Re-clamping the source each step supplies the
 * boundary condition that makes the steady state non-zero: charge enters as
 * fast as the grounding removes it, and the field settles at a graded, lit
 * fixed point. The residual threshold then does real work, because transfers
 * genuinely stop changing instead of everything freezing below the floor.
 *
 * The fixed point is therefore set by `groundConductance`: it is the decay rate
 * with distance, and it is the only meaningful unknown. Scaling all
 * conductances together cancels, since the circuit is linear, so the
 * dimensionless grounding-to-edge ratio is what the parameter controls.
 *
 * Pure: same graph and sources always give the same field.
 */
export function applyVoltage(
	graph: ScanGraph,
	sources: readonly number[],
	options: ActivationOptions = {},
	adjacency?: Adjacency,
): Field {
	const floor = options.activationFloor ?? DIFFRACTION.activationFloor;
	const residualThreshold = options.residualThreshold ?? DIFFRACTION.residualThreshold;
	const quantile = options.quantile ?? DIFFRACTION.quantile;
	const ground = options.groundConductance ?? DIFFRACTION.groundConductance;
	const voltage = options.sourceVoltage ?? DIFFRACTION.sourceVoltage;

	const adj = adjacency ?? buildAdjacency(graph);
	const energy = new Array<number>(graph.nodes.length).fill(0);
	for (const s of sources) {
		if (s >= 0 && s < energy.length) energy[s] = voltage;
	}

	const steps: Array<{ from: number; to: number; share: number }> = [];
	let maxDelta = Infinity;
	let stepCount = 0;
	while (maxDelta > residualThreshold && stepCount < 10000) {
		maxDelta = 0;
		stepCount++;
		const next = energy.slice();
		for (let i = 0; i < energy.length; i++) {
			const charge = energy[i] ?? 0;
			if (charge <= floor) continue;
			const ns = adj.neighbours[i] ?? [];
			if (ns.length === 0) {
				const groundLoss = ground > 0 ? charge : 0;
				next[i] = (next[i] ?? 0) - groundLoss;
				continue;
			}
			const cs = adj.conductance[i] ?? [];
			let total = 0;
			for (let k = 0; k < ns.length; k++) total += cs[k] ?? 0;
			if (total <= 0) continue;

			const totalConductance = total + ground;
			const groundLoss = charge * ground / totalConductance;
			next[i] = (next[i] ?? 0) - groundLoss;

			// Outflow is a TRANSFER, not a copy. The sender is debited the same
			// amount the receiver is credited, so a node keeps nothing: it hands
			// out `charge * sum(c_k) / tc` along its edges and the remaining
			// `charge * ground / tc` to ground, which together are the whole of
			// its charge. `next[i]` therefore ends up as its inflow alone.
			//
			// Without that debit the field GAINS charge every step, because a
			// node keeps its own share *and* is credited its neighbours' shares.
			// For a reciprocal pair (edges both ways, conductance c) that map is
			// `next[i] = r * (q_i + q_j)` with r = c / (c + g): growth factor
			// 2r on the symmetric mode, which is > 1 for every edge stronger
			// than the grounding — at the shipped defaults that is every edge,
			// since conductanceFloor (0.1) > groundConductance (0.05). Such a
			// run overflows to Infinity and then to NaN.
			let sent = 0;
			for (let k = 0; k < ns.length; k++) {
				const share = (cs[k] ?? 0) / totalConductance;
				const target = ns[k] ?? 0;
				const amount = charge * share;
				sent += amount;
				next[target] = (next[target] ?? 0) + amount;
				steps.push({ from: i, to: target, share });
			}
			next[i] = (next[i] ?? 0) - sent;
		}

		// The source is a MAINTAINED VOLTAGE SOURCE, not a one-shot injection:
		// after every transfer pass each source node is clamped back to `voltage`.
		// Setting (not adding) is what makes it an ideal voltage source — it
		// replaces whatever arrived rather than pumping on top of it.
		//
		// This is the boundary condition that makes the fixed point non-zero.
		// Without it, a ground sink on every node forces the only solution to be
		// the zero field (see the note above): charge drains outward one hop per
		// step and the frontier falls below the floor, so every run converges
		// dark. With it, charge enters as fast as the grounding removes it, and
		// the field settles at a graded, lit steady state — the loop exits on
		// the residual threshold because transfers genuinely stop changing.
		//
		// Clamping happens after the whole pass, not during it, so every node
		// reads the previous step's field and the update stays synchronous.
		for (const s of sources) {
			if (s >= 0 && s < next.length) next[s] = voltage;
		}

		// Clamp floating-point residue: a node that should be exactly zero can
		// land at a tiny negative value (a few ulp) at high degree. Downstream
		// consumers filter on positive thresholds, so the value is meaningless;
		// zero it out rather than let NaN-prone comparisons see a negative.
		for (let i = 0; i < next.length; i++) {
			const v = next[i] ?? 0;
			if (v < 0 && v > -1e-12) next[i] = 0;
		}

		// Residual is the fixed-point residual ||f(x) - x||: how far the FIELD
		// moved this step, node by node. It deliberately is NOT the size of an
		// individual transfer. At a sustained fixed point the transfers are
		// large and CONSTANT — the source keeps pushing `r` down the chain
		// forever — so a per-transfer measure would never fall below the
		// threshold and every run would grind to the 10000-step cap while
		// reporting a field that had in fact settled. Measured: with the
		// per-transfer measure the A->B->C chain ran all 10000 steps; with the
		// field residual it settles in a handful and exits on maxDelta = 0.
		maxDelta = 0;
		for (let i = 0; i < next.length; i++) {
			const d = Math.abs((next[i] ?? 0) - (energy[i] ?? 0));
			if (d > maxDelta) maxDelta = d;
		}
		energy.length = 0;
		energy.push(...next);
	}

	// Aggregate additive shares across steps
	const edgeShares = new Map<string, number>();
	for (const step of steps) {
		const key = `${step.from}|${step.to}`;
		edgeShares.set(key, (edgeShares.get(key) ?? 0) + step.share);
	}

	const roots: ChannelNode[] = [];
	for (const s of sources) {
		if (s >= 0 && s < graph.nodes.length) {
			roots.push(buildChannelNode(s, -1, edgeShares, adj, quantile, new Set()));
		}
	}

	const out = new Map<number, number>();
	let maxEnergy = 0;
	let sumEnergy = 0;
	for (let i = 0; i < energy.length; i++) {
		let e = energy[i] ?? 0;
		if (e < 0 && e > -1e-12) e = 0;
		out.set(i, e);
		if (e > maxEnergy) maxEnergy = e;
		sumEnergy += e;
	}
	const meanEnergy = graph.nodes.length > 0 ? sumEnergy / graph.nodes.length : 0;
	return { energy: out, roots, maxEnergy, meanEnergy };
}

function quantileThreshold(values: number[], q: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const idx = Math.floor(q * sorted.length);
	return sorted[Math.min(idx, sorted.length - 1)] ?? 0;
}

function buildChannelNode(
	node: number,
	parent: number,
	edgeShares: Map<string, number>,
	adj: Adjacency,
	quantile: number,
	visited: Set<number>,
): ChannelNode {
	visited.add(node);
	const children: ChannelNode[] = [];
	const ns = adj.neighbours[node] ?? [];
	const childShares: Array<{ node: number; share: number }> = [];
	for (const child of ns) {
		if (visited.has(child)) continue;
		const share = edgeShares.get(`${node}|${child}`) ?? 0;
		if (share > 0) childShares.push({ node: child, share });
	}
	childShares.sort((a, b) => b.share - a.share);
	const threshold = quantileThreshold(childShares.map(c => c.share), quantile);
	for (const c of childShares) {
		if (c.share >= threshold) {
			children.push(buildChannelNode(c.node, node, edgeShares, adj, quantile, new Set(visited)));
		}
	}
	return { node, shareFromParent: parent >= 0 ? (edgeShares.get(`${parent}|${node}`) ?? 0) : 1.0, children };
}

/** An activation reading. Measurement only — no interpretation attached. */
export interface ActivationLayer {
	/** node index → charge, for every node the pass reached. */
	energy: Map<number, number>;
	maxEnergy: number;
	meanEnergy: number;
	loudestNode: number | null;
	/** Nodes that received any charge at all. */
	litCount: number;
}

/**
 * A blank field and a live field are different findings.
 *
 * The original `runDiffractometerScan` was called with an empty relation
 * vocabulary, which made every relation line an unknown type, which returned
 * zero edges — and the tool then reported "no latent connections found" with
 * total confidence. `degenerate` is the guard against repeating that: it is
 * true when the graph had no usable edges, so a caller can distinguish "we
 * looked and found nothing" from "we never ran".
 */
export interface ScanDiagnostics {
	/** No usable edges: any "nothing found" below is meaningless. */
	degenerate: boolean;
	edgeCount: number;
	nodeCount: number;
	/** Why it was degenerate, when it was. */
	degenerateReason: string | null;
	/** Candidates considered vs. candidates reported, so a bound is never silent. */
	bounds: Record<string, { found: number; reported: number; limit: number }>;
}

/** A node whose neighbourhood does not connect to itself — a structural fact. */
export interface Bridge {
	node: number;
	neighbourCount: number;
	/** Neighbour pairs that are NOT themselves connected. Higher is a stronger bridge. */
	bridgingPower: number;
	/** Share of neighbour pairs that are not connected, 0..1. */
	bridgingFraction: number;
}

/**
 * Bridge detection — a fact about the graph, not an inference.
 *
 * For each node, compare how many of its neighbours are mutually connected
 * against how many pairs there are. A node whose neighbours barely know each
 * other is holding two regions together.
 *
 * The original counted *ordered* neighbour pairs, which doubles the figure.
 * Ranking is unaffected (it is a monotone transform) but the reported number is
 * meaningless as a count, so this counts unordered pairs and reports a fraction
 * alongside.
 */
export function findBridges(
	graph: ScanGraph,
	adjacency: Adjacency,
	options: { minNeighbours?: number; limit?: number } = {},
): Bridge[] {
	const minNeighbours = options.minNeighbours ?? 2;
	const limit = options.limit ?? 25;
	const found: Bridge[] = [];

	for (let i = 0; i < graph.nodes.length; i++) {
		const ns = Array.from(new Set([...(adjacency.neighbours[i] ?? []), ...(adjacency.inverse[i] ?? [])]));
		if (ns.length < minNeighbours) continue;
		let connectedPairs = 0;
		for (let p = 0; p < ns.length; p++) {
			for (let q = p + 1; q < ns.length; q++) {
				if (adjacency.has(ns[p]!, ns[q]!)) connectedPairs++;
			}
		}
		const totalPairs = (ns.length * (ns.length - 1)) / 2;
		const bridgingPower = ns.length - connectedPairs;
		if (bridgingPower <= 0) continue;
		found.push({
			node: i,
			neighbourCount: ns.length,
			bridgingPower,
			bridgingFraction: totalPairs > 0 ? bridgingPower / totalPairs : 0,
		});
	}

	found.sort((x, y) => y.bridgingPower - x.bridgingPower || x.node - y.node);
	return found.slice(0, limit);
}

/** Two independently-lit notes with no edge between them. An absence. */
export interface UnlinkedPair {
	a: number;
	b: number;
	/** Combined charge — the pair's joint prominence. */
	combined: number;
}

/**
 * Gap detection — the strongest form of the idea and the easiest to overstate.
 *
 * Two nodes both receiving charge but with no edge between them is a claim that
 * a link may be missing. It has **no predicate**: there is nothing in the data
 * that matches, only something absent. So the bound is reported rather than
 * applied silently — a bounded view that reports only what it drew tells the
 * flattering half of the truth.
 */
export function findUnlinkedPairs(
	graph: ScanGraph,
	energy: Map<number, number>,
	adjacency: Adjacency,
	options: { threshold?: number; limit?: number } = {},
): { pairs: UnlinkedPair[]; found: number } {
	const threshold = options.threshold ?? 0.01;
	const limit = options.limit ?? 30;

	const lit: number[] = [];
	for (const [i, e] of energy) {
		if (i >= 0 && i < graph.nodes.length && e >= threshold) lit.push(i);
	}
	lit.sort((x, y) => (energy.get(y) ?? 0) - (energy.get(x) ?? 0) || x - y);

	const found: UnlinkedPair[] = [];
	for (let p = 0; p < lit.length; p++) {
		for (let q = p + 1; q < lit.length; q++) {
			const a = lit[p]!;
			const b = lit[q]!;
			if (adjacency.has(a, b)) continue;
			found.push({ a, b, combined: (energy.get(a) ?? 0) + (energy.get(b) ?? 0) });
		}
	}

	found.sort((x, y) => y.combined - x.combined || x.a - y.a || x.b - y.b);
	return { pairs: found.slice(0, limit), found: found.length };
}

/** Lit by the field but not directly connected to any source. */
export interface Resonance {
	node: number;
	charge: number;
	degree: number;
}

/**
 * Resonance — the field says these are related; the graph does not say so.
 *
 * Unlike gaps this is a single node, so it needs no pair search. A node is
 * excluded if it is a source or a direct neighbour of one, since those are lit
 * trivially.
 */
export function findResonance(
	graph: ScanGraph,
	energy: Map<number, number>,
	sources: readonly number[],
	adjacency: Adjacency,
	options: { threshold?: number; limit?: number } = {},
): { nodes: Resonance[]; found: number } {
	const threshold = options.threshold ?? 0.01;
	const limit = options.limit ?? 50;

	const trivial = new Set<number>(sources);
	for (const s of sources) {
		for (const nb of adjacency.neighbours[s] ?? []) trivial.add(nb);
	}

	const found: Resonance[] = [];
	for (const [i, e] of energy) {
		if (trivial.has(i)) continue;
		if (e < threshold) continue;
		found.push({ node: i, charge: e, degree: adjacency.neighbours[i]?.length ?? 0 });
	}

	found.sort((x, y) => y.charge - x.charge || x.node - y.node);
	return { nodes: found.slice(0, limit), found: found.length };
}

/** "Why are these two connected?" — the most useful single query here. */
export interface ConnectionExplanation {
	source: number;
	target: number;
	connected: boolean;
	/** Shortest hop path, empty when unreachable. */
	shortestPath: number[];
	/** Every node lying on some path between the two, brightest first. */
	intermediates: Array<{ node: number; charge: number; degree: number }>;
}

/**
 * Explain a connection: shortest path, plus which intermediates actually carry
 * charge. The hop path alone is uninformative — a 4-hop path through dead
 * notes and a 4-hop path through load-bearing ones look identical until you
 * read the activation field.
 */
export function explainConnection(
	graph: ScanGraph,
	source: number,
	target: number,
	energy: Map<number, number>,
	adjacency: Adjacency,
	options: { limit?: number } = {},
): ConnectionExplanation {
	const limit = options.limit ?? 10;
	const n = graph.nodes.length;

	// Breadth-first, so the first time we reach the target is a shortest path.
	const prev = new Array<number>(n).fill(-1);
	const seen = new Array<boolean>(n).fill(false);
	seen[source] = true;
	const queue: number[] = [source];
	let head = 0;
	while (head < queue.length) {
		const node = queue[head++]!;
		if (node === target) break;
		for (const nb of adjacency.neighbours[node] ?? []) {
			if (seen[nb]) continue;
			seen[nb] = true;
			prev[nb] = node;
			queue.push(nb);
		}
	}

	const connected = seen[target] === true;
	const shortestPath: number[] = [];
	if (connected) {
		let cur = target;
		while (cur !== -1) {
			shortestPath.push(cur);
			if (cur === source) break;
			cur = prev[cur]!;
		}
		shortestPath.reverse();
	}

	// Every node on some path from source to target: anything the traversal
	// reached that still has a continuation towards the target.
	const onPath = new Set<number>();
	if (connected) {
		const reachable = new Array<boolean>(n).fill(false);
		const back = new Array<boolean>(n).fill(false);
		const q2: number[] = [source];
		reachable[source] = true;
		let h2 = 0;
		while (h2 < q2.length) {
			const node = q2[h2++]!;
			for (const nb of adjacency.neighbours[node] ?? []) {
				if (!reachable[nb]) {
					reachable[nb] = true;
					q2.push(nb);
				}
			}
		}
		back[target] = true;
		const q3: number[] = [target];
		let h3 = 0;
		while (h3 < q3.length) {
			const node = q3[h3++]!;
			for (const nb of adjacency.neighbours[node] ?? []) {
				if (!back[nb]) {
					back[nb] = true;
					q3.push(nb);
				}
			}
		}
		for (let i = 0; i < n; i++) if (reachable[i] && back[i]) onPath.add(i);
		onPath.delete(source);
		onPath.delete(target);
	}

	const intermediates = Array.from(onPath)
		.map((node) => ({ node, charge: energy.get(node) ?? 0, degree: adjacency.neighbours[node]?.length ?? 0 }))
		.sort((x, y) => y.charge - x.charge || x.node - y.node)
		.slice(0, limit);

	return { source, target, connected, shortestPath, intermediates };
}

/** Resonance chains — the interference pattern. */
export interface ChainOptions {
	minHops?: number;
	maxHops?: number;
	limit?: number;
}

/**
 * Chain extraction — a **partition**, not a detector.
 *
 * Edges are walked strongest-first; each chain greedily extends in both
 * directions along its strongest unused edge; every edge on a chain is consumed
 * so chains stay disjoint. Nodes may still appear in more than one chain.
 *
 * Disjoint and overlapping extraction answer different questions — "the N
 * strongest independent threads" versus "everywhere this resonates" — and both
 * are wanted. Overlapping extraction is a different mode, not a fix.
 */
export function findChains(graph: ScanGraph, adjacency: Adjacency, options: ChainOptions = {}): number[][] {
	const minHops = options.minHops ?? 2;
	const maxHops = options.maxHops ?? 4;
	const limit = options.limit ?? 20;

	type Pair = { a: number; b: number; strength: number };
	const edges: Pair[] = [];
	for (let i = 0; i < graph.nodes.length; i++) {
		const ns = adjacency.neighbours[i] ?? [];
		for (const nb of ns) {
			if (i < nb) edges.push({ a: i, b: nb, strength: adjacency.strengthBetween(i, nb) });
		}
	}
	edges.sort((x, y) => y.strength - x.strength || x.a - y.a || x.b - y.b);

	const consumed = new Set<string>();
	const take = (a: number, b: number): boolean => {
		const key = a < b ? `${a}|${b}` : `${b}|${a}`;
		if (consumed.has(key)) return false;
		consumed.add(key);
		return true;
	};
	const strongestFree = (from: number, inChain: Set<number>): number | null => {
		const ns = adjacency.neighbours[from] ?? [];
		let best: number | null = null;
		let bestStrength = -Infinity;
		for (const nb of ns) {
			if (inChain.has(nb)) continue;
			const key = from < nb ? `${from}|${nb}` : `${nb}|${from}`;
			if (consumed.has(key)) continue;
			const s = adjacency.strengthBetween(from, nb);
			if (s > bestStrength) {
				bestStrength = s;
				best = nb;
			}
		}
		return best;
	};

	const chains: number[][] = [];
	for (const seed of edges) {
		if (consumed.has(`${seed.a}|${seed.b}`)) continue;
		const chain = [seed.a, seed.b];
		const inChain = new Set(chain);
		take(seed.a, seed.b);

		while (chain.length < maxHops + 1) {
			const next = strongestFree(chain[chain.length - 1]!, inChain);
			if (next === null) break;
			take(chain[chain.length - 1]!, next);
			chain.push(next);
			inChain.add(next);
		}
		while (chain.length < maxHops + 1) {
			const next = strongestFree(chain[0]!, inChain);
			if (next === null) break;
			take(chain[0]!, next);
			chain.unshift(next);
			inChain.add(next);
		}

		if (chain.length >= minHops + 1) chains.push(chain);
		if (chains.length >= limit) break;
	}

	return chains;
}

/**
 * Label-propagation communities.
 *
 * Replaces the original's hardcoded table of subsystems and note names. Not a
 * substitute for a real community detector, but it is derived, deterministic,
 * and it is what "novelty" is measured against.
 */
export function labelCommunities(graph: ScanGraph, adjacency: Adjacency, options: { iterations?: number } = {}): number[] {
	const iterations = options.iterations ?? 12;
	const n = graph.nodes.length;
	const labels = new Array<number>(n).fill(0).map((_, i) => i);

	for (let iter = 0; iter < iterations; iter++) {
		let changed = false;
		for (let i = 0; i < n; i++) {
			const ns = adjacency.neighbours[i] ?? [];
			if (ns.length === 0) continue;
			const tally = new Map<number, number>();
			for (const nb of ns) {
				const l = labels[nb]!;
				tally.set(l, (tally.get(l) ?? 0) + 1);
			}
			let bestLabel = labels[i]!;
			let bestCount = -1;
			// Sorted so ties resolve to the lowest label — determinism matters here,
			// because a ranking that reorders between runs is not a measurement.
			for (const label of Array.from(tally.keys()).sort((x, y) => x - y)) {
				const c = tally.get(label)!;
				if (c > bestCount) {
					bestCount = c;
					bestLabel = label;
				}
			}
			if (bestLabel !== labels[i]) {
				labels[i] = bestLabel;
				changed = true;
			}
		}
		if (!changed) break;
	}

	// Compact the labels to 0..k-1 so callers can index communities directly.
	const remap = new Map<number, number>();
	return labels.map((l) => {
		let id = remap.get(l);
		if (id === undefined) {
			id = remap.size;
			remap.set(l, id);
		}
		return id;
	});
}

/** A chain scored on three axes and ranked by a weighted mean. */
export interface ScoredChain {
	chain: number[];
	/** 1..10 — how well-supported the chain is. */
	truth: number;
	/** 1..10 — how many distinct regions it crosses. */
	novelty: number;
	/** 1..10 — how much it connects a hub to something peripheral. */
	usefulness: number;
	/** Weighted mean, the ranking key. */
	composite: number;
	communities: number[];
	span: number;
	meanStrength: number;
}

export interface ScoreWeights {
	truth: number;
	novelty: number;
	usefulness: number;
}

/**
 * The original's weights, kept because they encode a real judgement: soundness
 * and surprise matter more than utility.
 */
export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = { truth: 0.35, novelty: 0.35, usefulness: 0.3 };

export interface ScoreOptions {
	/** Per-node weight for the truth axis. Pass gravitas to use it. */
	nodeWeight?: ArrayLike<number>;
	weights?: ScoreWeights;
}

const clamp10 = (x: number): number => Math.min(10, Math.max(1, x));

/**
 * Rank chains on soundness, surprise, and utility.
 *
 * Replaces `score_engine.py`, whose truth axis was edge strength rescaled and
 * whose novelty axis counted entries in a literal table. Here truth reads a
 * caller-supplied per-node weight — gravitas, which already aggregates mass
 * through the derivation DAG — and novelty counts communities actually crossed.
 *
 * Usefulness is derived rather than hand-tuned per domain: a chain earns it by
 * joining a well-connected note to a poorly-connected one, which is the
 * structural signature of a bridge that does work.
 */
export function scoreChains(
	graph: ScanGraph,
	chains: readonly number[][],
	adjacency: Adjacency,
	communities: ArrayLike<number>,
	options: ScoreOptions = {},
): ScoredChain[] {
	const weights = options.weights ?? DEFAULT_SCORE_WEIGHTS;
	const nodeWeight = options.nodeWeight;

	const communityCount = new Set(Array.from(communities)).size;
	const degree = (i: number): number => adjacency.neighbours[i]?.length ?? 0;
	const maxDegree = Math.max(1, ...graph.nodes.map((_, i) => degree(i)));

	let maxWeight = 0;
	for (let i = 0; i < graph.nodes.length; i++) {
		maxWeight = Math.max(maxWeight, nodeWeight ? (nodeWeight[i] ?? 0) : 0);
	}
	if (maxWeight <= 0) {
		for (const e of graph.edges) maxWeight = Math.max(maxWeight, e.strength);
	}

	const scored: ScoredChain[] = [];
	for (const chain of chains) {
		let strengthSum = 0;
		let weightSum = 0;
		for (let i = 0; i + 1 < chain.length; i++) {
			strengthSum += adjacency.strengthBetween(chain[i]!, chain[i + 1]!);
			weightSum += nodeWeight
				? ((nodeWeight[chain[i]!] ?? 0) + (nodeWeight[chain[i + 1]!] ?? 0)) / 2
				: adjacency.strengthBetween(chain[i]!, chain[i + 1]!);
		}
		const hops = Math.max(1, chain.length - 1);
		const meanStrength = strengthSum / hops;
		const meanWeight = weightSum / hops;

		// Truth: how well-supported, normalised against the graph's own maximum so
		// the scale is self-describing rather than tuned to one vault.
		const truth = clamp10(1 + 9 * (meanWeight / maxWeight));

		const spanned = new Set(chain.map((n) => communities[n] ?? 0));
		const span = spanned.size;
		const novelty =
			communityCount <= 1 || span <= 1 ? 1 : clamp10(1 + 9 * ((span - 1) / (communityCount - 1)));

		const degrees = chain.map(degree);
		const maxInChain = Math.max(...degrees);
		const minInChain = Math.min(...degrees);
		// Hub-to-peripheral spans do work; hub-to-hub and leaf-to-leaf do not.
		let usefulness = 5 + 4 * (maxInChain / maxDegree) - 2 * (minInChain / maxDegree);
		if (span >= 3) usefulness += 1;
		usefulness = clamp10(usefulness);

		const composite =
			weights.truth * truth + weights.novelty * novelty + weights.usefulness * usefulness;

		scored.push({
			chain,
			truth: Math.round(truth * 100) / 100,
			novelty: Math.round(novelty * 100) / 100,
			usefulness: Math.round(usefulness * 100) / 100,
			composite: Math.round(composite * 100) / 100,
			communities: Array.from(spanned).sort((x, y) => x - y),
			span,
			meanStrength: Math.round(meanStrength * 1000) / 1000,
		});
	}

	scored.sort((x, y) => y.composite - x.composite || x.chain[0]! - y.chain[0]!);
	return scored;
}

/** Everything the render layer and the MCP server need, from one pass. */
export interface ScanResult {
	activation: ActivationLayer;
	bridges: Bridge[];
	resonance: Resonance[];
	gaps: UnlinkedPair[];
	chains: ScoredChain[];
	communities: number[];
	channelRoots: ChannelNode[];
	diagnostics: ScanDiagnostics;
}

export interface ScanOptions extends ActivationOptions {
	sources?: readonly number[];
	gapThreshold?: number;
	gapLimit?: number;
	resonanceThreshold?: number;
	resonanceLimit?: number;
	bridgeLimit?: number;
	chainMinHops?: number;
	chainMaxHops?: number;
	chainLimit?: number;
	nodeWeight?: ArrayLike<number>;
}

/**
 * One pass, all five layers, with diagnostics.
 *
 * Two entry points call this and nothing else: the view (directly, from its
 * in-memory graph) and the MCP server (via a command file, so it sees live
 * state rather than a stale dump).
 */
export function runScan(graph: ScanGraph, options: ScanOptions = {}): ScanResult {
	const bounds: ScanDiagnostics['bounds'] = {};
	const adjacency = buildAdjacency(graph);
	const edgeCount = adjacency.neighbours.reduce((s, ns) => s + ns.length, 0);

	const sources = (options.sources ?? []).filter((s) => s >= 0 && s < graph.nodes.length);

	const degenerate = edgeCount === 0;
	const degenerateReason = degenerate
		? 'graph has no usable edges, so every "nothing found" below is meaningless'
		: null;

	const field = applyVoltage(graph, sources, options, adjacency);
	const energy = field.energy;
	const channelRoots = field.roots;

	let maxEnergy = 0;
	let sumEnergy = 0;
	let loudestNode: number | null = null;
	let litCount = 0;
	for (const [i, e] of energy) {
		sumEnergy += e;
		if (e > maxEnergy) {
			maxEnergy = e;
			loudestNode = i;
		}
		if (e > (options.activationFloor ?? DIFFRACTION.activationFloor)) litCount++;
	}
	const meanEnergy = graph.nodes.length > 0 ? sumEnergy / graph.nodes.length : 0;

	const activation: ActivationLayer = { energy, maxEnergy, meanEnergy, loudestNode, litCount };

	const bridges = findBridges(graph, adjacency, { limit: options.bridgeLimit ?? 25 });
	bounds.bridges = { found: bridges.length, reported: bridges.length, limit: options.bridgeLimit ?? 25 };

	const resonanceResult = findResonance(graph, energy, sources, adjacency, {
		threshold: options.resonanceThreshold,
		limit: options.resonanceLimit ?? 50,
	});
	bounds.resonance = {
		found: resonanceResult.found,
		reported: resonanceResult.nodes.length,
		limit: options.resonanceLimit ?? 50,
	};

	const gapResult = findUnlinkedPairs(graph, energy, adjacency, {
		threshold: options.gapThreshold,
		limit: options.gapLimit ?? 30,
	});
	bounds.gaps = { found: gapResult.found, reported: gapResult.pairs.length, limit: options.gapLimit ?? 30 };

	const communities = labelCommunities(graph, adjacency);
	const rawChains = findChains(graph, adjacency, {
		minHops: options.chainMinHops,
		maxHops: options.chainMaxHops,
		limit: options.chainLimit ?? 20,
	});
	const chains = scoreChains(graph, rawChains, adjacency, communities, { nodeWeight: options.nodeWeight });
	bounds.chains = {
		found: rawChains.length,
		reported: chains.length,
		limit: options.chainLimit ?? 20,
	};

	return {
		activation,
		bridges,
		resonance: resonanceResult.nodes,
		gaps: gapResult.pairs,
		chains,
		communities,
		channelRoots,
		diagnostics: {
			degenerate,
			edgeCount,
			nodeCount: graph.nodes.length,
			degenerateReason,
			bounds,
		},
	};
}

/** Resolve a path or label to a node index. Shared by the MCP surface. */
export function findNodeByRef(graph: ScanGraph, ref: string): number {
	const needle = ref.trim().toLowerCase();
	const asPath = needle.endsWith('.md') ? needle : `${needle}.md`;
	const byPath = graph.nodes.findIndex((x) => x.path.toLowerCase() === asPath || x.path.toLowerCase() === needle);
	if (byPath >= 0) return byPath;
	return graph.nodes.findIndex((x) => x.label.toLowerCase() === needle);
}