#!/usr/bin/env node
/**
 * Grounding sweep harness — plan step 8.
 *
 * `DIFFRACTION.groundConductance` is a placeholder. This measures what the
 * field actually does across a range of values and prints the numbers. It does
 * not choose one: that is a judgement about what the field is *for*, and this
 * file has no opinion about it.
 *
 * Usage:
 *   node scripts/sweep-grounding.mjs [options]
 *     --vault <dir>        vault root (default: auto-detected from the plugin symlink)
 *     --source <path|label> injection source (default: the vault's own scanSource setting)
 *     --min <g> --max <g>  sweep bounds (default 0.01 .. 0.5)
 *     --steps <n>          log-spaced samples (default 20)
 *     --synthetic          also sweep a 300-node synthetic graph (scale check)
 *     --no-verify          skip the self-checks (they are cheap; do not skip them)
 *
 * Two things are load-bearing here and easy to get wrong, so they are asserted
 * rather than assumed:
 *
 *  1. **The graph is the real vault graph**, built by the *real* `scanRelations`
 *     and the *real* `view.scanGraph()` aggregation rules, driven against
 *     filesystem-backed stand-ins for `Vault` / `MetadataCache`. Nothing is
 *     re-derived by hand, so the harness cannot drift from what the plugin
 *     scans. It reads notes; it never writes them.
 *  2. **The iteration count is measured, not estimated.** `applyVoltage` does
 *     not return `stepCount`, so this file runs an instrumented copy of the
 *     iteration loop (`instrumentedVoltage`) and then *proves* the copy is the
 *     same loop by checking, against the real function's own output: exact
 *     energy-map equality at every swept value, equality at four extra
 *     residual thresholds, agreement with the hardcoded 10000 cap, agreement
 *     with a closed-form single step, and agreement on the exact step index at
 *     which a bracketing threshold pair stops. Any of those failing means the
 *     reported iteration count is a lie, and the script says so and exits 1.
 *
 * Neither the source file `src/diffraction.ts` nor any file under `src/` is
 * imported from disk by Node — the whole thing is bundled in memory by
 * esbuild (the same bundler the plugin's own build uses) with the type-only
 * `obsidian` package replaced by a stub. That is not incidental: strip-only
 * TypeScript cannot parse `src/settings.ts` (it uses constructor parameter
 * properties), so `src/relations.ts` is unreachable without a real transform.
 */

import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

// ---------------------------------------------------------------------------
// Obsidian stand-in
// ---------------------------------------------------------------------------

/**
 * `obsidian` is a type-only package (`"main": ""`). Only `parseYaml` is
 * actually called at runtime by the modules this harness pulls in, and it is
 * called on note frontmatter — where a wrong answer silently drops every
 * `groups:` structural edge. So it gets a real YAML parser.
 */
const OBSIDIAN_STUB = `
class Stub {}
export const App = Stub, TFile = Stub, TFolder = Stub, Vault = Stub, MetadataCache = Stub;
export const Modal = Stub, PluginSettingTab = Stub, Notice = Stub, Setting = Stub;
export const TextComponent = Stub, Component = Stub, Plugin = Stub, ItemView = Stub;
export const WorkspaceLeaf = Stub, Events = Stub, Platform = {};
export const MarkdownRenderer = {}, MarkdownView = {};
export const parseFrontMatterAliases = () => null;
export const setIcon = () => {};
export const requestUrl = async () => ({ text: '' });
export const debounce = (f) => f;
export const moment = () => ({});
// The harness installs a real YAML parser on globalThis before importing the
// bundle; a bare import('js-yaml') here would not resolve, because this module
// is evaluated from a data: URL with no package context.
export function parseYaml(text) {
  return globalThis.__SH_PARSE_YAML__(text) ?? {};
}
`;

const obsidianStubPlugin = {
	name: 'obsidian-stub',
	setup(build) {
		build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'sh-stub' }));
		build.onLoad({ filter: /.*/, namespace: 'sh-stub' }, () => ({ contents: OBSIDIAN_STUB, loader: 'js' }));
	},
};

const ENTRY = `
export {
  DIFFRACTION, applyVoltage, buildAdjacency, findNodeByRef,
} from './src/diffraction.ts';
export {
  scanRelations, extractFrontmatter,
} from './src/relations.ts';
export { HOLOGRAM_FOLDER, DEFAULT_SETTINGS } from './src/settings.ts';
export { readNodeMetas, isEvidenceType } from './src/gravitas.ts';
`;

async function loadPluginModules() {
	const res = await esbuild.build({
		stdin: {
			contents: ENTRY,
			resolveDir: ROOT,
			sourcefile: 'sweep-grounding-entry.mjs',
			loader: 'js',
		},
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: 'node22',
		write: false,
		plugins: [obsidianStubPlugin],
		logLevel: 'warning',
	});
	const code = res.outputFiles[0].text;
	const url = `data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`;
	return import(url);
}

// ---------------------------------------------------------------------------
// Graph construction — mirrors view.buildGraph() + view.scanGraph()
// ---------------------------------------------------------------------------

/** Every `.md` under a directory, vault-relative, sorted for determinism. */
async function markdownFilesUnder(vaultRoot, dirAbs) {
	const out = [];
	async function walk(abs, rel) {
		let entries;
		try {
			entries = await readdir(abs, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
			if (e.name.startsWith('.')) continue;
			const childAbs = path.join(abs, e.name);
			const childRel = rel ? `${rel}/${e.name}` : e.name;
			if (e.isDirectory()) await walk(childAbs, childRel);
			else if (e.isFile() && e.name.endsWith('.md')) out.push(childRel);
		}
	}
	await walk(dirAbs, '');
	return out.sort();
}

/**
 * Obsidian's `getFirstLinkpathDest`, approximated: strip alias and heading,
 * then try the link's own path suffixes against progressively shorter source
 * directories, deepest first.
 */
function makeResolver(allPaths) {
	return (name, sourcePath) => {
		let target = String(name).trim();
		const bar = target.indexOf('|');
		if (bar >= 0) target = target.slice(0, bar);
		const hash = target.indexOf('#');
		if (hash >= 0) target = target.slice(0, hash);
		target = target.trim();
		if (!target) return null;
		if (target.endsWith('.md')) return allPaths.has(target) ? target : null;
		const parts = target.split('/').filter(Boolean);
		if (parts.length === 0) return null;
		const dirs = sourcePath.split('/').slice(0, -1);
		for (let k = 0; k <= dirs.length; k++) {
			const base = dirs.slice(0, dirs.length - k);
			for (let s = parts.length; s >= 1; s--) {
				const cand = `${[...base, ...parts.slice(parts.length - s)].join('/')}.md`;
				if (allPaths.has(cand)) return cand;
			}
		}
		return null;
	};
}

/** `[[...]]` outside fenced code blocks and inline code — Obsidian's own rule. */
function extractWikilinks(content) {
	const noFence = content.replace(/^([ \t]*)```[\s\S]*?^[ \t]*```[ \t]*$/gm, '');
	const noInline = noFence.replace(/`[^`\n]*`/g, '');
	const out = [];
	const re = /\[\[([^\][]+)\]\]/g;
	let m;
	while ((m = re.exec(noInline)) !== null) out.push(m[1]);
	return out;
}

/**
 * Build the `ScanGraph` the plugin would scan, from vault notes on disk.
 *
 * Steps and their sources, so a reader can check each one:
 *   - file set / owner dirs ....... `displayedHolograms()` + `vault.getMarkdownFiles().filter(...)`
 *   - evidence-node exclusion ..... `readNodeMetas()` + `isEvidenceType()`
 *   - typed relations ............. `scanRelations()` (the real one)
 *   - plain wikilink fallback ..... `metadataCache.resolvedLinks`
 *   - pair aggregation, a<b ...... `view.buildGraph()` link pass
 *   - node/edge projection ........ `view.scanGraph()`
 */
async function buildRealGraph(M, vaultRoot) {
	const holoDir = M.HOLOGRAM_FOLDER;
	const holoAbs = path.join(vaultRoot, holoDir);
	const scoped = await markdownFilesUnder(vaultRoot, holoAbs);
	if (scoped.length === 0) {
		throw new Error(`no .md notes found under ${holoAbs} — is --vault pointing at the right vault?`);
	}

	// `displayedHolograms`: direct notes in hologram/ form one partition, each
	// child folder another. Only the owner mapping matters for the graph.
	const ownerByPath = new Map();
	for (const name of scoped) {
		const slash = name.indexOf('/');
		ownerByPath.set(`${holoDir}/${name}`, slash === -1 ? holoDir : `${holoDir}/${name.slice(0, slash)}`);
	}

	const allPaths = new Set(await markdownFilesUnder(vaultRoot, vaultRoot));
	const resolve = makeResolver(allPaths);

	// `files` order decides node indices, and indices decide edge orientation
	// (the link pass always writes a=min, b=max). Obsidian's own order is its
	// internal file map; this uses sorted order, which is deterministic but
	// not identical. See the report.
	const allInVault = await markdownFilesUnder(vaultRoot, vaultRoot);
	const files = allInVault.filter((p) => ownerByPath.has(p)).map((p) => ({ path: p, basename: p.split('/').pop().replace(/\.md$/, '') }));
	const byPath = new Map(files.map((f) => [f.path, path.join(vaultRoot, f.path)]));

	const contents = new Map();
	for (const f of files) contents.set(f.path, await readFile(byPath.get(f.path), 'utf8'));

	const metadataCache = {
		getFirstLinkpathDest: (name, sourcePath) => {
			const r = resolve(name, sourcePath);
			return r ? { path: r } : null;
		},
		getFileCache: (f) => {
			const fmText = M.extractFrontmatter(contents.get(f.path) ?? '');
			if (fmText === null) return null;
			return { frontmatter: parseYamlSync(fmText, f.path) };
		},
		resolvedLinks: (() => {
			const links = {};
			for (const f of files) {
				const targets = {};
				for (const raw of extractWikilinks(contents.get(f.path) ?? '')) {
					const t = resolve(raw, f.path);
					if (!t) continue;
					targets[t] = (targets[t] ?? 0) + 1;
				}
				if (Object.keys(targets).length > 0) links[f.path] = targets;
			}
			return links;
		})(),
	};

	const vault = {
		read: async (f) => contents.get(f.path) ?? (await readFile(byPath.get(f.path), 'utf8')),
		cachedRead: async (f) => contents.get(f.path) ?? (await readFile(byPath.get(f.path), 'utf8')),
		getMarkdownFiles: () => files,
		getAbstractFileByPath: () => null,
	};

	// --- typed relations, via the real scanner ---------------------------
	const knownIds = new Set(settings.relTypes.map((r) => r.id));
	const relById = new Map(settings.relTypes.map((r) => [r.id, r]));
	const quietLog = console.log;
	const quietError = console.error;
	console.log = () => {}; // `scanRelations` logs a line per note; keep the table readable
	console.error = () => {}; // `parseNoteFrontmatter` logs unparseable frontmatter
	let scan;
	try {
		scan = await M.scanRelations(
			files,
			vault,
			metadataCache,
			knownIds,
			settings.defaultRelStrength,
			(p) => ownerByPath.has(p),
		);
	} finally {
		console.log = quietLog;
		console.error = quietError;
	}

	// --- node set, minus evidence notes ----------------------------------
	const metas = M.readNodeMetas(files, metadataCache, settings.defaultConfidence);
	const nodes = [];
	const index = new Map();
	for (const f of files) {
		const meta = metas.get(f.path);
		if (meta && M.isEvidenceType(meta.nodeType)) continue;
		index.set(f.path, nodes.length);
		nodes.push({ path: f.path, label: f.basename });
	}

	// --- link pass (view.buildGraph) -------------------------------------
	const pairEdges = new Map();
	for (const e of scan.edges) {
		const srcIdx = index.get(e.source);
		const dstIdx = index.get(e.target);
		if (srcIdx === undefined || dstIdx === undefined || srcIdx === dstIdx) continue;
		if (!relById.get(e.relId)?.enabled) continue;
		if (ownerByPath.get(e.source) !== ownerByPath.get(e.target)) continue;
		const key = `${Math.min(srcIdx, dstIdx)}|${Math.max(srcIdx, dstIdx)}`;
		const arr = pairEdges.get(key) ?? [];
		arr.push(e);
		pairEdges.set(key, arr);
	}

	const links = [];
	const covered = new Set();
	for (const [key, edges] of pairEdges) {
		const [aRaw, bRaw] = key.split('|');
		links.push({ a: Number(aRaw), b: Number(bRaw), relations: edges.map((e) => ({ type: e.relId, strength: e.strength, justification: e.justification })) });
		covered.add(key);
	}

	const seen = new Set(covered);
	for (const f of files) {
		const srcIdx = index.get(f.path);
		if (srcIdx === undefined) continue;
		const targets = metadataCache.resolvedLinks[f.path];
		if (!targets) continue;
		for (const targetPath of Object.keys(targets)) {
			const dstIdx = index.get(targetPath);
			if (dstIdx === undefined || dstIdx === srcIdx) continue;
			if (ownerByPath.get(f.path) !== ownerByPath.get(targetPath)) continue;
			const key = srcIdx < dstIdx ? `${srcIdx}|${dstIdx}` : `${dstIdx}|${srcIdx}`;
			if (seen.has(key)) continue;
			seen.add(key);
			links.push({ a: Math.min(srcIdx, dstIdx), b: Math.max(srcIdx, dstIdx), relations: [{ type: 'default', strength: 0.5 }] });
		}
	}

	// --- view.scanGraph() projection -------------------------------------
	const graph = {
		nodes,
		edges: links.flatMap((l) => {
			const strengths = l.relations.map((r) => r.strength).filter((s) => Number.isFinite(s));
			const strength = strengths.length > 0 ? strengths.reduce((a, b) => a + b, 0) / strengths.length : 0.5;
			return l.relations.map((r) => ({ a: l.a, b: l.b, strength, relId: r.type, justification: r.justification }));
		}),
	};

	const linkStrengths = links.map((l) => {
		const s = l.relations.map((r) => r.strength).filter((x) => Number.isFinite(x));
		return s.length ? s.reduce((a, b) => a + b, 0) / s.length : 0.5;
	});

	return {
		graph,
		noteCount: files.length,
		linkCount: links.length,
		typedRelationCount: scan.edges.length,
		malformedCount: scan.malformed.length,
		badFrontmatterCount: badFrontmatter.size,
		badFrontmatterPaths: [...badFrontmatter].map((p) => p.split('/').pop()),
		malformedLines: scan.malformed.map((m) => `${m.path.split('/').pop()}:${m.line} ${m.reason}`),
		linkStrengths,
		skippedEvidence: files.length - nodes.length,
	};
}

// ---------------------------------------------------------------------------
// YAML (sync). js-yaml's `load` is the same parser Obsidian's parseYaml uses.
// ---------------------------------------------------------------------------

let jsYaml = null;
async function ensureYaml() {
	if (jsYaml === null) {
		jsYaml = await import('js-yaml');
		// Shared with the bundled stub through globalThis — a data: URL module has
		// no package context of its own to resolve `js-yaml` from. Routed through
		// the same recorder so failures are counted wherever they are raised.
		globalThis.__SH_PARSE_YAML__ = (text) => parseYamlSync(text, null);
	}
	return jsYaml;
}
/**
 * Obsidian's metadata cache simply has no frontmatter when a note's frontmatter
 * block will not parse — it does not throw at the call site, and
 * `parseNoteFrontmatter` swallows the error and returns defaults. The vault in
 * question has notes whose `groups:` list runs past `created:` and leaves the
 * block invalid YAML, so this path is load-bearing, not defensive.
 */
function parseYamlSync(text, path = null) {
	if (jsYaml === null) throw new Error('parseYamlSync called before ensureYaml()');
	try {
		return jsYaml.load(text) ?? {};
	} catch {
		if (path !== null) badFrontmatter.add(path);
		return {};
	}
}
const badFrontmatter = new Set();

// ---------------------------------------------------------------------------
// Synthetic graph — scale check only
// ---------------------------------------------------------------------------

/** mulberry32: deterministic, so a run is reproducible rather than a sample. */
function mulberry32(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Barabási–Albert preferential attachment, `m` out-links per new node, with
 * strengths drawn from the real graph's empirical strength multiset and edges
 * written a<b by index — the same orientation convention `view.buildGraph()`
 * uses, so the two graphs are comparable rather than differently wired.
 */
function buildSyntheticGraph(nodeCount, m, strengthPool, seed) {
	const rnd = mulberry32(seed);
	const nodes = Array.from({ length: nodeCount }, (_, i) => ({
		path: `synthetic/node-${String(i).padStart(4, '0')}.md`,
		label: `node-${String(i).padStart(4, '0')}`,
	}));
	const edges = [];
	const degree = new Array(nodeCount).fill(0);
	const targets = [];
	// The seed pool must hold at least `m` nodes or `while (seen.size < m)` can
	// never terminate. Seed with m+1 fully connected nodes, as standard BA does.
	for (let i = 1; i <= m; i++) targets.push(i);
	if (targets.length < m) throw new Error(`synthetic seed pool of ${targets.length} cannot supply m=${m} distinct targets`);
	const pick = () => {
		// preferential attachment by repeated selection on degree
		let total = 0;
		for (let i = 0; i < targets.length; i++) total += degree[targets[i]] + 1;
		let r = rnd() * total;
		for (let i = 0; i < targets.length; i++) {
			r -= degree[targets[i]] + 1;
			if (r <= 0) return targets[i];
		}
		return targets[targets.length - 1];
	};
	for (let e = 0; e < targets.length; e++) {
		const a = 0;
		const b = targets[e];
		edges.push({ a: Math.min(a, b), b: Math.max(a, b), strength: pickStrength(strengthPool, rnd) });
		degree[a]++;
		degree[b]++;
	}
	for (let i = m + 1; i < nodeCount; i++) {
		const seen = new Set();
		// Guarded: with a pool of exactly m heavily-tied nodes this could spin.
		let guard = 0;
		while (seen.size < m && guard++ < 10000) seen.add(pick());
		if (seen.size < m) throw new Error(`synthetic generator could not find ${m} distinct targets at node ${i}`);
		for (const t of seen) {
			edges.push({ a: Math.min(i, t), b: Math.max(i, t), strength: pickStrength(strengthPool, rnd) });
			degree[i]++;
			degree[t]++;
		}
		targets.push(i);
	}
	// Deduplicate directed duplicates; buildAdjacency already resolves them
	// strongest-wins, but a clean input makes the numbers easier to read.
	const uniq = new Map();
	for (const e of edges) {
		const k = `${e.a}|${e.b}`;
		const prev = uniq.get(k);
		if (!prev || e.strength > prev.strength) uniq.set(k, e);
	}
	return { graph: { nodes, edges: [...uniq.values()] }, degree };
}

function pickStrength(pool, rnd) {
	if (pool.length === 0) return 0.5;
	return pool[Math.floor(rnd() * pool.length)];
}

// ---------------------------------------------------------------------------
// Instrumented copy of applyVoltage's iteration loop
// ---------------------------------------------------------------------------

/**
 * Byte-for-byte the loop in `src/diffraction.ts:applyVoltage`, plus a record of
 * the per-step maximum delta and an optional forced stop index. The channel
 * tree is deliberately not reproduced — it is not measured here, and the real
 * function owns it.
 *
 * Everything this file reports about iterations rests on this copy matching
 * the real one, which is why `verifyInstrumentation()` checks that against the
 * real function's own output rather than against itself.
 */
function instrumentedVoltage(graph, sources, options, adjacency, forceStopAt = null) {
	const floor = options.activationFloor ?? DIFFRACTION.activationFloor;
	const residualThreshold = options.residualThreshold ?? DIFFRACTION.residualThreshold;
	const ground = options.groundConductance ?? DIFFRACTION.groundConductance;
	const voltage = options.sourceVoltage ?? DIFFRACTION.sourceVoltage;

	const adj = adjacency ?? buildAdjacency(graph);
	const energy = new Array(graph.nodes.length).fill(0);
	for (const s of sources) {
		if (s >= 0 && s < energy.length) energy[s] = voltage;
	}

	const residuals = [];
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
				if (next[i] < 0 && next[i] > -1e-12) next[i] = 0;
				continue;
			}
			const cs = adj.conductance[i] ?? [];
			let total = 0;
			for (let k = 0; k < ns.length; k++) total += cs[k] ?? 0;
			if (total <= 0) continue;
			const totalConductance = total + ground;
			const groundLoss = charge * ground / totalConductance;
			next[i] = (next[i] ?? 0) - groundLoss;
			let sent = 0;
			for (let k = 0; k < ns.length; k++) {
				const share = (cs[k] ?? 0) / totalConductance;
				const target = ns[k] ?? 0;
				const amount = charge * share;
				sent += amount;
				next[target] = (next[target] ?? 0) + amount;
			}
			next[i] = (next[i] ?? 0) - sent;
			if (next[i] < 0 && next[i] > -1e-12) next[i] = 0;
		}
		// sustained source: re-clamp after the whole pass
		for (const s of sources) {
			if (s >= 0 && s < next.length) next[s] = voltage;
		}
		// field residual ||f(x)-x||
		maxDelta = 0;
		for (let i = 0; i < next.length; i++) {
			const d = Math.abs((next[i] ?? 0) - (energy[i] ?? 0));
			if (d > maxDelta) maxDelta = d;
		}
		energy.length = 0;
		energy.push(...next);
		residuals.push(maxDelta);
		if (forceStopAt !== null && stepCount >= forceStopAt) break;
	}

	const out = new Map();
	for (let i = 0; i < energy.length; i++) {
		let v = energy[i] ?? 0;
		if (v < 0 && v > -1e-12) v = 0;
		out.set(i, v);
	}
	return { energy: out, steps: stepCount, residuals, hitCap: stepCount >= 10000 };
}

/** Closed form for the state after exactly one step. */
function oneStepClosedForm(graph, sources, adjacency, ground, voltage) {
	const e = new Array(graph.nodes.length).fill(0);
	for (const s of sources) if (s >= 0 && s < e.length) e[s] = voltage;
	const next = e.slice();
	for (let i = 0; i < e.length; i++) {
		const charge = e[i];
		if (charge <= DIFFRACTION.activationFloor) continue;
		const ns = adjacency.neighbours[i] ?? [];
		if (ns.length === 0) {
			next[i] = next[i] - (ground > 0 ? charge : 0);
			continue;
		}
		const cs = adjacency.conductance[i] ?? [];
		let total = 0;
		for (let k = 0; k < ns.length; k++) total += cs[k] ?? 0;
		const tc = total + ground;
		next[i] = next[i] - charge * ground / tc;
		let sent = 0;
		for (let k = 0; k < ns.length; k++) {
			const amount = charge * ((cs[k] ?? 0) / tc);
			sent += amount;
			next[ns[k]] = next[ns[k]] + amount;
		}
		next[i] = next[i] - sent;
	}
	// sustained source re-clamp after the pass
	for (const s of sources) if (s >= 0 && s < next.length) next[s] = voltage;
	return next;
}

// ---------------------------------------------------------------------------
// Instrumentation self-check
// ---------------------------------------------------------------------------

function maxAbsDiffMap(a, b) {
	let worst = 0;
	for (const [k, v] of a) {
		const d = Math.abs(v - (b.get(k) ?? 0));
		if (d > worst) worst = d;
		if (d > 0) return d; // first non-identical entry is already a failure
	}
	return worst;
}

function verifyInstrumentation(M, graph, sources, sweep, log) {
	const adj = buildAdjacency(graph);
	const failures = [];
	const check = (name, ok, detail = '') => {
		log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
		if (!ok) failures.push(name);
	};

	// V1 — the instrumented copy reproduces the real field at every swept g.
	let worstV1 = 0;
	let v1count = 0;
	for (const g of sweep) {
		const real = M.applyVoltage(graph, sources, { groundConductance: g }, adj).energy;
		const mine = instrumentedVoltage(graph, sources, { groundConductance: g }, adj).energy;
		worstV1 = Math.max(worstV1, maxAbsDiffMap(real, mine));
		v1count++;
	}
	check(`V1 real-vs-instrumented energy equality at all ${v1count} swept g`, worstV1 === 0, `max|diff| = ${worstV1}`);

	// V2 — same, across residual thresholds, so equality is not an artefact of
	// one stopping point.
	let worstV2 = 0;
	for (const t of [1e-1, 1e-3, 1e-5, 1e-7]) {
		for (const g of [sweep[0], DIFFRACTION.groundConductance, sweep[sweep.length - 1]]) {
			const real = M.applyVoltage(graph, sources, { groundConductance: g, residualThreshold: t }, adj).energy;
			const mine = instrumentedVoltage(graph, sources, { groundConductance: g, residualThreshold: t }, adj).energy;
			worstV2 = Math.max(worstV2, maxAbsDiffMap(real, mine));
		}
	}
	check('V2 equality across 4 residual thresholds x 3 g', worstV2 === 0, `max|diff| = ${worstV2}`);

	// V3 — the cap is real and is 10000, not something the copy invented.
	// The threshold must be *negative*: at 0 the loop still exits early, because
	// a step in which every node is already frozen computes maxDelta = 0 and
	// `0 > 0` is false. -1 makes `maxDelta > residualThreshold` unconditionally
	// true, so only the hardcoded 10000 can stop it.
	const capped = instrumentedVoltage(graph, sources, { residualThreshold: -1 }, adj);
	const cappedReal = M.applyVoltage(graph, sources, { residualThreshold: -1 }, adj).energy;
	check(
		'V3 hardcoded 10000-iteration cap honoured (threshold -1) and field matches real at that cap',
		capped.steps === 10000 && capped.hitCap && maxAbsDiffMap(capped.energy, cappedReal) === 0,
		`steps = ${capped.steps}`,
	);

	// V4 — a huge threshold must stop after exactly one step, and that step is
	// reproducible in closed form (independent of the loop entirely).
	const huge = 1e9;
	const oneReal = M.applyVoltage(graph, sources, { residualThreshold: huge }, adj).energy;
	const oneMine = instrumentedVoltage(graph, sources, { residualThreshold: huge }, adj);
	const oneClosed = oneStepClosedForm(graph, sources, adj, DIFFRACTION.groundConductance, DIFFRACTION.sourceVoltage);
	const closedMap = new Map(oneClosed.map((v, i) => [i, v]));
	check(
		'V4 huge threshold => exactly 1 step, matching closed form and real',
		oneMine.steps === 1 && maxAbsDiffMap(oneMine.energy, oneReal) === 0 && maxAbsDiffMap(closedMap, oneReal) === 0,
		`steps = ${oneMine.steps}`,
	);

	// V5 — the stopping *index* is right, checked against the real function.
	//
	// The thresholds that make the real function stop at step `n` are exactly
	// `residuals[n-1] <= T < min(residuals[0..n-2])`. That interval is often
	// empty (the per-step max delta jumps when individual nodes freeze), so this
	// searches for the highest step other than the default one whose interval is
	// non-empty, then asserts the real function stops there and returns a
	// genuinely different field. If the instrumented loop differed from the
	// real one, the real function would stop elsewhere and the fields differ.
	let v5checked = 0;
	let v5ok = true;
	let v5skipped = 0;
	let v5detail = '';
	for (const g of sweep) {
		const t = instrumentedVoltage(graph, sources, { groundConductance: g }, adj);
		if (t.hitCap || t.steps < 2) continue;
		if (t.steps > 3000) {
			v5skipped++;
			continue; // each lookback re-runs the whole trajectory; too costly at this length
		}
		// Steps where every node is already frozen compute maxDelta = 0 and change
		// nothing, so the field at such a step is identical to the default one and
		// proves nothing. Those are skipped rather than counted as failures.
		const refDefault = M.applyVoltage(graph, sources, { groundConductance: g }, adj).energy;
		let target = -1;
		let tMid = 0;
		const maxLookback = 20;
		for (let n = t.steps - 1, looked = 0; n >= 1 && looked < maxLookback; n--, looked++) {
			const lo = t.residuals[n - 1];
			const hi = n === 1 ? Infinity : Math.min(...t.residuals.slice(0, n - 1));
			if (!(hi > lo)) continue; // no threshold in this run stops at step n
			const mid = n === 1 ? lo + 1 : (lo + hi) / 2;
			const wantN = instrumentedVoltage(graph, sources, { groundConductance: g, residualThreshold: mid }, adj).energy;
			if (maxAbsDiffMap(wantN, refDefault) === 0) continue; // no-op step: not a discriminator
			target = n;
			tMid = mid;
			break;
		}
		if (target < 0) {
			v5skipped++;
			continue;
		}
		const gotN = M.applyVoltage(graph, sources, { groundConductance: g, residualThreshold: tMid }, adj).energy;
		const wantN = instrumentedVoltage(graph, sources, { groundConductance: g, residualThreshold: tMid }, adj).energy;
		if (maxAbsDiffMap(gotN, wantN) !== 0 || maxAbsDiffMap(gotN, refDefault) === 0) {
			v5ok = false;
			v5detail = ` (failed at g=${g}, steps=${t.steps}, bracket at step ${target})`;
			break;
		}
		v5checked++;
	}
	check(
		`V5 real function stops at the trajectory-derived step index (threshold-bracketed)`,
		v5ok && v5checked > 0,
		`${v5checked} bracketed, ${v5skipped} with no usable gap${v5detail}`,
	);

	return failures;
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

/**
 * Field statistics for one grounding value.
 *
 * `truncLevel` is the reported "activation level at which the tail truncates":
 * the energy of the dimmest node that is still above `activationFloor`, i.e.
 * the level at which the field's dim tail stops propagating. `frozenLevel` is
 * the residue underneath it — nodes that fell below the floor and stopped
 * entirely, which is where the actual cut happens.
 */
function measure(M, graph, sources, adjacency, g, options) {
	const field = M.applyVoltage(graph, sources, { ...options, groundConductance: g }, adjacency);
	const floor = options.activationFloor ?? DIFFRACTION.activationFloor;
	const inst = instrumentedVoltage(graph, sources, { ...options, groundConductance: g }, adjacency);

	const all = [];
	let sum = 0;
	let lit = 0;
	let frozen = 0;
	let never = 0;
	let truncLevel = null;
	let frozenLevel = null;
	for (let i = 0; i < graph.nodes.length; i++) {
		const e = field.energy.get(i) ?? 0;
		all.push(e);
		sum += e;
		if (e > floor) {
			lit++;
			if (truncLevel === null || e < truncLevel) truncLevel = e;
		} else if (e > 0) {
			frozen++;
			if (frozenLevel === null || e < frozenLevel) frozenLevel = e;
		} else {
			never++;
		}
	}
	const litSorted = all.filter((e) => e > floor).sort((a, b) => a - b);
	const median = (arr) => (arr.length === 0 ? 0 : arr[Math.floor(arr.length / 2)]);
	let treeNodes = 0;
	const walk = (cn) => {
		treeNodes++;
		for (const c of cn.children) walk(c);
	};
	for (const r of field.roots) walk(r);

	// The iteration is a linear map applied to the whole field. `next` starts as
	// a copy of `energy`, so a node keeps its charge *and* receives its outflow
	// again: total_new = 2 * sum(c_i * C_i/(C_i+ground)). That exceeds the
	// previous total whenever a node's total out-conductance C_i exceeds the
	// grounding — i.e. the field grows instead of settling unless grounding is
	// large relative to conductance. The only thing that stops such a run is the
	// 10000-iteration cap, so a capped run is a diverged one, not a converged one.
	const flag = inst.hitCap ? 'DIVERGED (hit 10000-step cap)' : lit === 0 ? 'dark: 0 lit' : '';

	return {
		ground: g,
		litCount: lit,
		maxEnergy: field.maxEnergy,
		meanEnergy: field.meanEnergy,
		sumEnergy: sum,
		truncLevel: truncLevel ?? 0,
		frozenLevel: frozenLevel ?? 0,
		frozenCount: frozen,
		neverReached: never,
		medianLit: median(litSorted),
		treeNodes,
		iterations: inst.steps,
		hitCap: inst.hitCap,
		flag,
	};
}

let reachableSet = new Set();
/** Nodes reachable from the sources along out-edges — the ceiling on `litCount`. */
function countReachable(adjacency, sources) {
	reachableSet = new Set(sources);
	const queue = [...sources];
	let head = 0;
	while (head < queue.length) {
		const n = queue[head++];
		for (const nb of adjacency.neighbours[n] ?? []) {
			if (reachableSet.has(nb)) continue;
			reachableSet.add(nb);
			queue.push(nb);
		}
	}
	return reachableSet.size;
}

function fmt(x, digits = 6) {
	if (!Number.isFinite(x)) return String(x);
	if (x === 0) return '0';
	if (Math.abs(x) >= 1e-4) return x.toFixed(digits);
	return x.toExponential(2);
}

function printTable(rows, title) {
	console.log(`\n${title}`);
	const header = ['ground', 'lit', 'maxE', 'meanE', 'sumE', 'truncLv', 'frozenLv', 'tree', 'iters', 'flag'];
	const body = rows.map((r) => [
		r.ground.toFixed(4),
		String(r.litCount),
		fmt(r.maxEnergy),
		fmt(r.meanEnergy),
		fmt(r.sumEnergy),
		fmt(r.truncLevel),
		fmt(r.frozenLevel),
		String(r.treeNodes),
		String(r.iterations),
		r.flag,
	]);
	const widths = header.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
	const line = (cells) => cells.map((c, i) => c.padStart(widths[i])).join('  ');
	console.log(`  ${line(header)}`);
	console.log(`  ${widths.map((w) => '-'.repeat(w)).join('  ')}`);
	for (const b of body) console.log(`  ${line(b)}`);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

let settings = null;
/** Bound after the bundle loads; every measurement reads these, never a copy. */
let DIFFRACTION = null;
let buildAdjacency = null;

async function loadSettings(M) {
	try {
		const raw = await readFile(path.join(ROOT, 'data.json'), 'utf8');
		const parsed = JSON.parse(raw);
		if (parsed && Array.isArray(parsed.relTypes) && parsed.relTypes.length > 0) return parsed;
	} catch {
		/* fall through to defaults */
	}
	return M.DEFAULT_SETTINGS;
}

/** Find the vault by following the installed plugin symlink. */
async function detectVaultRoot() {
	const { realpath } = await import('node:fs/promises');
	const roots = [
		path.resolve(ROOT, '..'),
		path.resolve(ROOT, '../..'),
		path.resolve(ROOT, '../../..'),
		'/home/warelock/Nextcloud/Notes',
	];
	async function scan(dir, depth) {
		if (depth > 3) return null;
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return null;
		}
		for (const e of entries) {
			if (!e.isDirectory() || e.name === 'node_modules' || e.name === '.git') continue;
			const child = path.join(dir, e.name);
			if (e.name === '.obsidian') {
				const link = path.join(child, 'plugins', 'semantic-hologram');
				const target = await realpath(link).catch(() => null);
				if (target && path.resolve(target) === ROOT) return dir;
			}
			const hit = await scan(child, depth + 1);
			if (hit) return hit;
		}
		return null;
	}
	for (const r of roots) {
		const hit = await scan(r, 0);
		if (hit) return hit;
	}
	return null;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function parseArgs(argv) {
	const out = { min: 0.01, max: 0.5, steps: 20, verify: true, synthetic: false, vault: null, source: null };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--min') out.min = Number(argv[++i]);
		else if (a === '--max') out.max = Number(argv[++i]);
		else if (a === '--steps') out.steps = Number(argv[++i]);
		else if (a === '--vault') out.vault = argv[++i];
		else if (a === '--source') out.source = argv[++i];
		else if (a === '--synthetic') out.synthetic = true;
		else if (a === '--no-verify') out.verify = false;
		else throw new Error(`unknown argument: ${a}`);
	}
	return out;
}

const args = parseArgs(process.argv.slice(2));
await ensureYaml();
const M = await loadPluginModules();
({ DIFFRACTION, buildAdjacency } = M);
settings = await loadSettings(M);

const vaultRoot = args.vault ?? (await detectVaultRoot());
if (!vaultRoot) {
	console.error('Could not auto-detect the vault. Pass --vault <dir>.');
	process.exit(2);
}

const sweep = [];
for (let i = 0; i < args.steps; i++) {
	const t = args.steps === 1 ? 0 : i / (args.steps - 1);
	sweep.push(Number((args.min * Math.pow(args.max / args.min, t)).toFixed(6)));
}

console.log('grounding sweep — measurement only; choosing a value is not this script\'s job');
for (const f of ['src/diffraction.ts', 'src/relations.ts', 'src/gravitas.ts', 'src/settings.ts']) {
	const bytes = await readFile(path.join(ROOT, f));
	console.log(`  measured ${f}  sha256:${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}`);
}
console.log(`  vault            ${vaultRoot}`);
console.log(`  settings         ${path.join(ROOT, 'data.json')} (relTypes: ${settings.relTypes.map((r) => r.id).join(', ')})`);
console.log(`  activationFloor  ${DIFFRACTION.activationFloor}`);
console.log(`  residualThresh.  ${DIFFRACTION.residualThreshold}`);
console.log(`  conductanceFloor ${DIFFRACTION.conductanceFloor}`);
console.log(`  current constant ${DIFFRACTION.groundConductance} (untouched by this script)`);
console.log(`  sweep            ${sweep.length} log-spaced values, ${sweep[0]} .. ${sweep[sweep.length - 1]}`);

let exitCode = 0;

// --- real vault graph ------------------------------------------------------
const real = await buildRealGraph(M, vaultRoot);
const adjReal = buildAdjacency(real.graph);
const degReal = real.graph.nodes.map((_, i) => adjReal.neighbours[i].length);
const degSorted = [...degReal].sort((a, b) => a - b);
const meanDeg = degReal.reduce((a, b) => a + b, 0) / degReal.length;
console.log(`\ngraph: REAL vault  ${real.noteCount} notes, ${real.linkCount} links, ${real.graph.edges.length} diffraction edges`);
console.log(`  ${real.skippedEvidence} evidence note(s) excluded (isEvidenceType); ${real.malformedCount} malformed relation line(s); ${real.badFrontmatterCount} note(s) with unparseable frontmatter (groups: dropped, as in the app)`);
console.log(`  out-degree  min ${degSorted[0]}  median ${degSorted[Math.floor(degSorted.length / 2)]}  mean ${meanDeg.toFixed(2)}  max ${degSorted[degSorted.length - 1]}`);
const strengthHist = new Map();
for (const s of real.linkStrengths) strengthHist.set(s, (strengthHist.get(s) ?? 0) + 1);
console.log(`  link strengths ${[...strengthHist.entries()].sort((a, b) => a[0] - b[0]).map(([s, c]) => `${s}x${c}`).join('  ')}`);
if (real.badFrontmatterCount > 0) {
	console.log(`  ! unparseable frontmatter in ${real.badFrontmatterCount} note(s) — their groups: list is dropped, in the app too:`);
	console.log(`      ${real.badFrontmatterPaths.join(', ')}`);
}
for (const m of real.malformedLines) console.log(`  ! malformed relation line: ${m}`);

const sourceRef = args.source ?? settings.scanSource ?? '';
let srcIdx = sourceRef ? M.findNodeByRef(real.graph, sourceRef) : -1;
let sourceLabel;
if (srcIdx < 0) {
	// Fall back to the highest out-degree node: the most connected thing in the
	// graph, which is the least arbitrary injection point available.
	srcIdx = degReal.indexOf(Math.max(...degReal));
	sourceLabel = `${real.graph.nodes[srcIdx].label} (highest out-degree, out of ${degSorted[degSorted.length - 1]})`;
} else {
	sourceLabel = `${real.graph.nodes[srcIdx].label} (scanSource setting)`;
}
console.log(`  source node      #${srcIdx}  ${real.graph.nodes[srcIdx].path}`);
console.log(`                    ${sourceLabel}`);
const reachable = countReachable(adjReal, [srcIdx]);
console.log(`  reachable        ${reachable} of ${real.graph.nodes.length} nodes along out-edges — a node below the source's index can never be lit,`);
console.log(`                    because view.buildGraph() writes every link as a=min(idx), b=max(idx)`);
if (reachable < real.graph.nodes.length) {
	console.log(`  UNREACHABLE      ${real.graph.nodes.map((n, i) => (reachableSet.has(i) ? null : `#${i} ${n.label}`)).filter(Boolean).join(', ')}`);
}

const realRows = sweep.map((g) => measure(M, real.graph, [srcIdx], adjReal, g, {}));

console.log('\nlegends');
console.log(`  truncLv   activation level of the dimmest still-lit node — where the field's tail stops propagating`);
console.log(`  frozenLv  energy of the dimmest node that fell below activationFloor and stopped — the actual cut`);
console.log(`  tree      nodes in the channel tree (quantile ${DIFFRACTION.quantile} pruning of the accumulated shares)`);
console.log(`  iters     iterations applyVoltage ran before maxDelta <= ${DIFFRACTION.residualThreshold} (see verification below)`);
console.log(`  flag      DIVERGED = the run hit the hardcoded 10000-iteration cap, i.e. it never settled`);
console.log(`            "dark: 0 lit" = it settled, but every node ended below activationFloor ${DIFFRACTION.activationFloor}`);
printTable(realRows, `grounding sweep — REAL vault graph, source #${srcIdx} (${real.graph.nodes[srcIdx].label})`);

if (args.verify) {
	console.log('\nverifying the iteration counter against the real applyVoltage');
	const failures = verifyInstrumentation(M, real.graph, [srcIdx], sweep, console.log);
	if (failures.length > 0) {
		console.error(`\nINSTRUMENTATION FAILED — iteration counts above are not trustworthy: ${failures.join(', ')}`);
		exitCode = 1;
	} else {
		console.log('  all checks passed; the reported iters column is the real function\'s stopping point');
	}
}

// --- synthetic scale check -------------------------------------------------
if (args.synthetic) {
	const N = 300;
	const syn = buildSyntheticGraph(N, 3, real.linkStrengths, 0x5eed1234);
	const adjSyn = buildAdjacency(syn.graph);
	const degSyn = syn.graph.nodes.map((_, i) => adjSyn.neighbours[i].length);
	const srcSyn = degSyn.indexOf(Math.max(...degSyn));
	console.log(`\ngraph: SYNTHETIC  ${N} nodes, ${syn.graph.edges.length} edges (Barabási–Albert m=3, seed 0x5eed1234)`);
	console.log(`  out-degree  min ${Math.min(...degSyn)}  mean ${(degSyn.reduce((a, b) => a + b, 0) / N).toFixed(2)}  max ${Math.max(...degSyn)}`);
	console.log(`  source node      #${srcSyn}  ${syn.graph.nodes[srcSyn].label} (highest out-degree)`);
	const synRows = sweep.map((g) => measure(M, syn.graph, [srcSyn], adjSyn, g, {}));
	printTable(synRows, `grounding sweep — SYNTHETIC ${N}-node graph, source #${srcSyn}`);

	if (args.verify) {
		console.log('\nverifying the iteration counter on the synthetic graph too');
		// Coarse subsample: at 300 nodes a single near-cap run is ~10^8 node
		// visits, and the full 20-value verification would dominate the runtime.
		// The real vault graph above is verified at every swept value.
		const coarse = sweep.filter((_, i) => i % 5 === 0 || i === sweep.length - 1);
		const failures = verifyInstrumentation(M, syn.graph, [srcSyn], coarse, console.log);
		if (failures.length > 0) {
			console.error(`\nINSTRUMENTATION FAILED on synthetic graph: ${failures.join(', ')}`);
			exitCode = 1;
		}
	}
}

console.log('\nno value is recommended. The numbers above are the measurement; the choice is a judgement about what the field is for.');
process.exit(exitCode);