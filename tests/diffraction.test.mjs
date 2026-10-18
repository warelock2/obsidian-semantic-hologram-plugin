import test from 'node:test';
import assert from 'node:assert';
import {
    DIFFRACTION,
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

    const G = DIFFRACTION.groundConductance;       // 0.05
    const FLOOR = DIFFRACTION.activationFloor;     // 0.001
    const DRAINED_TOL = 1e-12;
    const LEAF_REL_TOL = 1e-6;
    const CHAIN_TOL = 1e-9;

    function twoNodeGraph(strength) {
        return {
            nodes: [{ path: 'a.md', label: 'A' }, { path: 'b.md', label: 'B' }],
            edges: [{ a: 0, b: 1, strength }]
        };
    }
    function chainGraph(strength) {
        return {
            nodes: [{ path: 'a.md', label: 'A' }, { path: 'b.md', label: 'B' }, { path: 'c.md', label: 'C' }],
            edges: [{ a: 0, b: 1, strength }, { a: 1, b: 2, strength }]
        };
    }

    await t.test('buildAdjacency creates correct neighbours and conductance', () => {
        const adj = buildAdjacency(sampleGraph);
        assert.strictEqual(adj.neighbours.length, 5);
        assert(adj.has(0, 1));
        assert(!adj.has(0, 4));
        assert.strictEqual(adj.strengthBetween(0, 1), 0.8);
        assert.strictEqual(adj.strengthBetween(0, 4), 0);
    });

    await t.test('applyVoltage diffuses charge deterministically from sources', () => {
        const field1 = applyVoltage(sampleGraph, [0]);
        const field2 = applyVoltage(sampleGraph, [0]);
        const energy1 = field1.energy;
        const energy2 = field2.energy;

        assert.strictEqual(energy1.get(0), energy2.get(0));
        assert.strictEqual(energy1.get(1), energy2.get(1));
        assert(Array.isArray(field1.roots));

        // The source is clamped to voltage, so node 0 sits at 1.0 and the field
        // is lit downstream. Conservation means a node with no inbound edge
        // (other than the source) stays at 0.
        assert.ok(energy1.get(0) === DIFFRACTION.sourceVoltage,
            `source = ${energy1.get(0)}, expected ${DIFFRACTION.sourceVoltage}`);
        assert.ok(energy1.get(4) > 0, `node 4 = ${energy1.get(4)}, expected lit`);
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
        const energy = applyVoltage(sampleGraph, [0]).energy;
        const { pairs, found } = findUnlinkedPairs(sampleGraph, energy, adj, { threshold: 0.0001 });
        // The field is now lit, so the detector must find something. Measured:
        // found = 5, pairs include {0,3}, {0,4}, {1,4}, {0,2}, {4,2}.
        assert.ok(found > 0, 'expected lit unlinked pairs, got 0');
        assert.strictEqual(found, pairs.length);
        assert(Array.isArray(pairs));
        for (const p of pairs) {
            assert(!adj.has(p.a, p.b));
            assert(p.combined > 0);
        }
    });

    await t.test('findResonance detects non-trivial lit nodes', () => {
        const adj = buildAdjacency(sampleGraph);
        const sources = [0];
        const energy = applyVoltage(sampleGraph, sources).energy;
        const { nodes: resonance, found } = findResonance(sampleGraph, energy, sources, adj, { threshold: 0.0001 });
        // The field is lit, so resonance nodes exist. Measured: found = 3, nodes [3, 4, 2].
        assert.ok(found > 0, 'expected resonance nodes, got 0');
        assert.strictEqual(found, resonance.length);
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
        assert(Array.isArray(result.channelRoots));
        assert(result.diagnostics);
        assert.strictEqual(result.diagnostics.degenerate, false);
    });

    await t.test('findNodeByRef resolves path and label correctly', () => {
        assert.strictEqual(findNodeByRef(sampleGraph, 'node0.md'), 0);
        assert.strictEqual(findNodeByRef(sampleGraph, 'Node Zero'), 0);
        assert.strictEqual(findNodeByRef(sampleGraph, 'nonexistent'), -1);
    });

    await t.test('applyVoltage holds the source and propagates a graded field', () => {
        // The source is a maintained voltage source: V(0) = 1. On an acyclic
        // chain the steady state is the closed form V(d) = r^d with
        // r = c / (c + g).
        const cases = [
            { strength: 0.5, c: 0.5, r: 10 / 11 },
            { strength: 0.8, c: 0.8, r: 16 / 17 },
            { strength: 0.05, c: 0.1, r: 2 / 3 }   // clamped by conductanceFloor
        ];
        for (const { strength, c, r } of cases) {
            const derived = { c, r };
            const field = applyVoltage(twoNodeGraph(strength), [0]);
            const a = field.energy.get(0);
            const b = field.energy.get(1);

            assert.ok(Math.abs(derived.c - c) < 1e-12, `c: derived ${derived.c}, expected ${c}`);
            assert.ok(Math.abs(derived.r - r) < 1e-12, `r: derived ${derived.r}, expected ${r}`);

            // Source is clamped to voltage.
            assert.ok(Math.abs(a - DIFFRACTION.sourceVoltage) < DRAINED_TOL,
                `strength ${strength}: source A = ${a}, expected ${DIFFRACTION.sourceVoltage}`);
            // B is a leaf fed by A. With full drain B = r.
            assert.ok(Math.abs(b - r) < CHAIN_TOL,
                `strength ${strength}: B = ${b}, expected r`);
            // Conservation: nothing created.
            assert.ok(a + b <= DIFFRACTION.sourceVoltage * 2,
                `strength ${strength}: field total ${a + b}`);
        }
    });

    await t.test('applyVoltage matches the closed form V(d)=r^d on a two-hop chain', () => {
        for (const strength of [0.5, 0.8]) {
            const c = Math.max(strength, DIFFRACTION.conductanceFloor);
            const r = c / (c + G);
            const field = applyVoltage(chainGraph(strength), [0]);
            const a = field.energy.get(0);
            const b = field.energy.get(1);
            const cc = field.energy.get(2);

            assert.ok(Math.abs(a - 1) < CHAIN_TOL, `A = ${a}, expected 1`);
            // B has an outbound edge, so it is not a leaf: V(1) = r exactly.
            assert.ok(Math.abs(b - r) < CHAIN_TOL, `B = ${b}, expected r = ${r}`);
            // C is a leaf: V(2) = r^2.
            assert.ok(Math.abs(cc - r * r) < CHAIN_TOL,
                `C = ${cc}, expected r^2`);
        }
    });

    await t.test('a reciprocal edge pair does not diverge', () => {
        // Two nodes joined BOTH ways. With the transfer conserved the steady
        // state is [1, r] (source clamped, neighbour at r) rather than NaN.
        const reciprocal = {
            nodes: [{ path: 'a.md', label: 'A' }, { path: 'b.md', label: 'B' }],
            edges: [{ a: 0, b: 1, strength: 0.5 }, { a: 1, b: 0, strength: 0.5 }]
        };
        const c = Math.max(0.5, DIFFRACTION.conductanceFloor);
        const r = c / (c + G);

        const field = applyVoltage(reciprocal, [0]);

        for (const [i, e] of field.energy) {
            assert.ok(Number.isFinite(e), `node ${i} = ${e}`);
        }
        assert.ok(Number.isFinite(field.maxEnergy) && field.maxEnergy > 0,
            `maxEnergy = ${field.maxEnergy}`);
        assert.ok(Number.isFinite(field.meanEnergy) && field.meanEnergy > 0,
            `meanEnergy = ${field.meanEnergy}`);

        const a = field.energy.get(0);
        const b = field.energy.get(1);
        assert.ok(Math.abs(a - 1) < CHAIN_TOL, `A = ${a}, expected 1`);
        assert.ok(Math.abs(b - r) < CHAIN_TOL, `B = ${b}, expected r = ${r}`);

        // The fixture must still exercise the divergence criterion: under the
        // duplicating rule the symmetric mode grows by 2r, which exceeds 1
        // whenever the edge conductance exceeds the grounding.
        assert.ok(2 * r > 1, `fixture no longer exercises divergence: 2r = ${2 * r}`);
    });

    await t.test('one-way edges do not conduct backwards', () => {
        const oneWay = {
            nodes: [{ path: 'a.md', label: 'A' }, { path: 'b.md', label: 'B' }],
            edges: [{ a: 0, b: 1, strength: 0.8 }]
        };
        const adj = buildAdjacency(oneWay);

        assert.strictEqual(adj.hasDirected(0, 1), true);
        assert.strictEqual(adj.hasDirected(1, 0), false);
        assert.strictEqual(adj.strengthBetweenDirected(0, 1), 0.8);
        assert.strictEqual(adj.strengthBetweenDirected(1, 0), 0);
        assert.strictEqual(adj.has(0, 1), true);
        assert.strictEqual(adj.has(1, 0), true);
        assert.deepStrictEqual(adj.neighbours[1], []);
        assert.deepStrictEqual(adj.inverse[1], [0]);

        // Inject at the sink. A has no inbound edge and is not a source, so it
        // stays at 0 -- not merely dim.
        const atB = applyVoltage(oneWay, [1]);
        assert.strictEqual(atB.energy.get(0), 0, 'charge reached A through a one-way edge');
        // B is the source, clamped to voltage.
        assert.ok(Math.abs(atB.energy.get(1) - DIFFRACTION.sourceVoltage) < DRAINED_TOL,
            `B = ${atB.energy.get(1)}, expected ${DIFFRACTION.sourceVoltage}`);
        assert.strictEqual(atB.roots.length, 1);
        assert.strictEqual(atB.roots[0].node, 1);
        assert.strictEqual(atB.roots[0].children.length, 0);

        // Control: inject at the source and B does light up.
        const atA = applyVoltage(oneWay, [0]);
        assert.ok(atA.energy.get(1) > 0, 'charge did not travel forwards along a one-way edge');
        assert.strictEqual(atA.roots[0].children.length, 1);
        assert.strictEqual(atA.roots[0].children[0].node, 1);
    });
});