import test from 'node:test';
import assert from 'node:assert';
import {
    buildAdjacency,
    applyVoltage,
    findBridges,
    findUnlinkedPairs,
    findResonance,
    explainConnection,
    findChains,
    scoreChains,
    labelCommunities,
    runScan,
    findNodeByRef
} from '../src/diffraction.ts';

test('Diffraction Pure Module Tests', async (t) => {
    const sampleGraph = {
        nodes: [
            { path: 'node0.md', label: 'Node Zero' },
            { path: 'node1.md', label: 'Node One' },
            { path: 'node2.md', label: 'Node Two' },
            { path: 'node3.md', label: 'Node Three' },
            { path: 'node4.md', label: 'Node Four' }
        ],
        edges: [
            { a: 0, b: 1, strength: 0.8 },
            { a: 1, b: 2, strength: 0.6 },
            { a: 2, b: 3, strength: 0.7 },
            { a: 3, b: 4, strength: 0.9 },
            { a: 1, b: 3, strength: 0.5 }
        ]
    };

    await t.test('buildAdjacency creates correct neighbours and conductance', () => {
        const adj = buildAdjacency(sampleGraph);
        assert.strictEqual(adj.neighbours.length, 5);
        assert(adj.has(0, 1));
        assert(!adj.has(0, 4));
        assert.strictEqual(adj.strengthBetween(0, 1), 0.8);
        assert.strictEqual(adj.strengthBetween(0, 4), 0);
    });

    await t.test('applyVoltage diffuses charge deterministically from sources', () => {
        const energy1 = applyVoltage(sampleGraph, [0]);
        const energy2 = applyVoltage(sampleGraph, [0]);
        
        assert.strictEqual(energy1.get(0), energy2.get(0));
        assert.strictEqual(energy1.get(1), energy2.get(1));
        assert((energy1.get(0) ?? 0) > (energy1.get(4) ?? 0));
    });

    await t.test('findBridges identifies topological bridge nodes', () => {
        const adj = buildAdjacency(sampleGraph);
        const bridges = findBridges(sampleGraph, adj, { minNeighbours: 1 });
        assert(Array.isArray(bridges));
        for (const b of bridges) {
            assert(b.neighbourCount >= 1);
            assert(b.bridgingFraction >= 0 && b.bridgingFraction <= 1);
        }
    });

    await t.test('findUnlinkedPairs detects lit unlinked nodes', () => {
        const adj = buildAdjacency(sampleGraph);
        const energy = applyVoltage(sampleGraph, [0]);
        const { pairs, found } = findUnlinkedPairs(sampleGraph, energy, adj, { threshold: 0.0001 });
        assert(typeof found === 'number');
        assert(Array.isArray(pairs));
        for (const p of pairs) {
            assert(!adj.has(p.a, p.b));
            assert(p.combined > 0);
        }
    });

    await t.test('findResonance detects non-trivial lit nodes', () => {
        const adj = buildAdjacency(sampleGraph);
        const sources = [0];
        const energy = applyVoltage(sampleGraph, sources);
        const { nodes: resonance, found } = findResonance(sampleGraph, energy, sources, adj, { threshold: 0.0001 });
        assert(typeof found === 'number');
        assert(Array.isArray(resonance));
        for (const r of resonance) {
            assert(!sources.includes(r.node));
            const srcNeighbours = adj.neighbours[sources[0]] || [];
            assert(!srcNeighbours.includes(r.node));
        }
    });

    await t.test('explainConnection returns shortest path and intermediates', () => {
        const adj = buildAdjacency(sampleGraph);
        const energy = applyVoltage(sampleGraph, [0]);
        const explanation = explainConnection(sampleGraph, 0, 4, energy, adj);
        assert.strictEqual(explanation.source, 0);
        assert.strictEqual(explanation.target, 4);
        assert(explanation.connected);
        assert(Array.isArray(explanation.shortestPath));
        assert(explanation.shortestPath[0] === 0);
        assert(explanation.shortestPath[explanation.shortestPath.length - 1] === 4);
        assert(Array.isArray(explanation.intermediates));
    });

    await t.test('findChains extracts disjoint paths', () => {
        const adj = buildAdjacency(sampleGraph);
        const chains = findChains(sampleGraph, adj, { minHops: 1, maxHops: 3 });
        assert(Array.isArray(chains));
        for (const chain of chains) {
            assert(chain.length >= 2);
        }
    });

    await t.test('labelCommunities assigns community IDs', () => {
        const adj = buildAdjacency(sampleGraph);
        const communities = labelCommunities(sampleGraph, adj);
        assert.strictEqual(communities.length, sampleGraph.nodes.length);
        for (const c of communities) {
            assert(typeof c === 'number');
            assert(c >= 0);
        }
    });

    await t.test('scoreChains produces valid rankable scores on 1-10 scale', () => {
        const adj = buildAdjacency(sampleGraph);
        const communities = labelCommunities(sampleGraph, adj);
        const chains = [[0, 1, 2], [1, 3, 4]];
        const scored = scoreChains(sampleGraph, chains, adj, communities);
        assert.strictEqual(scored.length, chains.length);
        for (const sc of scored) {
            assert(sc.truth >= 1 && sc.truth <= 10);
            assert(sc.novelty >= 1 && sc.novelty <= 10);
            assert(sc.usefulness >= 1 && sc.usefulness <= 10);
            assert(typeof sc.composite === 'number');
        }
    });

    await t.test('runScan executes full diffraction scan pass', () => {
        const result = runScan(sampleGraph, { sources: [0] });
        assert(result.activation);
        assert(Array.isArray(result.bridges));
        assert(Array.isArray(result.resonance));
        assert(Array.isArray(result.gaps));
        assert(Array.isArray(result.chains));
        assert(Array.isArray(result.communities));
        assert(result.diagnostics);
        assert.strictEqual(result.diagnostics.degenerate, false);
    });

    await t.test('findNodeByRef resolves path and label correctly', () => {
        assert.strictEqual(findNodeByRef(sampleGraph, 'node0.md'), 0);
        assert.strictEqual(findNodeByRef(sampleGraph, 'Node Zero'), 0);
        assert.strictEqual(findNodeByRef(sampleGraph, 'nonexistent'), -1);
    });
});
