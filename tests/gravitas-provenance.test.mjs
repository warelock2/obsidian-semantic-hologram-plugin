import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeProvenance } from '../src/gravitasProvenance.ts';

/**
 * Provenance derivation — pure module, no obsidian import.
 *
 * Rule 22 discipline: every expected value is re-derived inside the test from
 * the fixture inputs; nothing is copied from production output.
 *
 * Derived model (matches `gravitasReal` in src/gravitas.ts):
 *   direct(node)   = Σ(amount × sourceKindPercent)
 *   real(node)     = direct(node) + Σ(childReal × subsumedByStrength)
 *   listed amounts are scaled so they sum to Math.min(1, real(node))
 */

/** Fixture 1: two sources, one child, one parent (subtree under the cap). */
function fixtureUnderCap() {
  const sourceKinds = [
    { id: 'source/data', name: 'Data', percent: 90 },
    { id: 'source/scientific', name: 'Scientific', percent: 80 },
  ];
  const kindPercent = (id) => (sourceKinds.find((k) => k.id === id)?.percent ?? 0) / 100;

  const meta = new Map([
    ['sourceA.md', { path: 'sourceA.md', nodeType: 'source', sourceKind: 'source/data' }],
    ['sourceB.md', { path: 'sourceB.md', nodeType: 'source', sourceKind: 'source/scientific' }],
    ['parent.md', { path: 'parent.md', nodeType: 'concept', sourceKind: null }],
    ['child.md', { path: 'child.md', nodeType: 'concept', sourceKind: null }],
  ]);
  const gravEdges = [
    { source: 'sourceA.md', target: 'parent.md', amount: 0.80, authoredFrom: 'sourceA.md', raw: '' },
    { source: 'sourceB.md', target: 'child.md', amount: 0.60, authoredFrom: 'sourceB.md', raw: '' },
  ];
  const subsumedEdges = [
    { source: 'child.md', target: 'parent.md', relId: 'structural/subsumed-by', strength: 0.50, reversed: false, authoredFrom: 'child.md', raw: '' },
  ];

  // Hand-derivation of the expectations.
  const directAtoParent = 0.80 * kindPercent('source/data');       // 0.72
  const directBtoChild = 0.60 * kindPercent('source/scientific');  // 0.48
  const realChild = directBtoChild;                               // 0.48
  const realParent = directAtoParent + realChild * 0.50;           // 0.96
  const strengthChildToParent = 0.50;

  return { meta, gravEdges, subsumedEdges, sourceKinds, directAtoParent, directBtoChild, realChild, realParent, strengthChildToParent };
}

test('computeProvenance returns a Map', () => {
  const f = fixtureUnderCap();
  const result = computeProvenance(f.meta, f.subsumedEdges, f.gravEdges, f.sourceKinds);
  assert.ok(result instanceof Map, 'computeProvenance returns a Map');
  for (const path of f.meta.keys()) {
    assert.ok(result.has(path), `result has an entry for ${path}`);
  }
});

test('entry totals equal Math.min(1, gravitasReal) — under the cap', () => {
  const f = fixtureUnderCap();
  const result = computeProvenance(f.meta, f.subsumedEdges, f.gravEdges, f.sourceKinds);

  // --- parent: one direct lender + one inherited lender via the child ---
  const parentEntries = result.get('parent.md') ?? [];
  const totalParent = parentEntries.reduce((s, e) => s + e.amount, 0);
  const cappedParent = Math.min(1, f.realParent);
  assert.strictEqual(totalParent, cappedParent,
    `parent total ${totalParent} must equal capped gravitasReal ${cappedParent} ` +
    `(derived: direct ${f.directAtoParent} + childReal ${f.realChild} × ${f.strengthChildToParent} = ${f.realParent})`);

  const directParent = parentEntries.filter((e) => e.direct);
  const inheritedParent = parentEntries.filter((e) => !e.direct);
  assert.strictEqual(directParent.length, 1, 'parent has exactly one direct lender');
  assert.strictEqual(directParent[0].sourceName, 'sourceA', 'direct lender is Source A');
  assert.strictEqual(directParent[0].amount, f.directAtoParent, 'direct amount equals derived direct term');

  assert.strictEqual(inheritedParent.length, 1, 'parent has exactly one inherited lender (Source B via child)');
  assert.strictEqual(inheritedParent[0].sourceName, 'sourceB', 'inherited lender is Source B');
  const expectedInherited = f.realChild * f.strengthChildToParent;
  assert.strictEqual(inheritedParent[0].amount, expectedInherited,
    `inherited amount ${inheritedParent[0].amount} must equal derived ${expectedInherited}`);

  // --- child: direct only, no inherited ---
  const childEntries = result.get('child.md') ?? [];
  const totalChild = childEntries.reduce((s, e) => s + e.amount, 0);
  const cappedChild = Math.min(1, f.realChild);
  assert.strictEqual(totalChild, cappedChild,
    `child total ${totalChild} must equal capped gravitasReal ${cappedChild} (derived direct ${f.directBtoChild})`);
  assert.strictEqual(childEntries.length, 1, 'child has a single entry');
  assert.ok(childEntries[0].direct, 'child entry is direct');
  assert.strictEqual(childEntries[0].amount, f.directBtoChild, 'child amount equals derived direct term');
});

test('entry totals equal Math.min(1, gravitasReal) — over the cap (scaling)', () => {
  // Two high-percent direct lenders to one node => raw sum > 1 => entries are scaled down.
  const sourceKinds = [{ id: 'source/data', name: 'Data', percent: 95 }];
  const kindPercent = (sourceKinds.find((k) => k.id === 'source/data')?.percent ?? 0) / 100;
  const meta = new Map([
    ['src1.md', { path: 'src1.md', nodeType: 'source', sourceKind: 'source/data' }],
    ['src2.md', { path: 'src2.md', nodeType: 'source', sourceKind: 'source/data' }],
    ['node.md', { path: 'node.md', nodeType: 'concept', sourceKind: null }],
  ]);
  const gravEdges = [
    { source: 'src1.md', target: 'node.md', amount: 0.9, authoredFrom: 'src1.md', raw: '' },
    { source: 'src2.md', target: 'node.md', amount: 0.9, authoredFrom: 'src2.md', raw: '' },
  ];

  const directPerSource = 0.9 * kindPercent; // 0.855
  const rawTotal = 2 * directPerSource;       // 1.71 (> 1)
  const expected = Math.min(1, rawTotal);     // 1

  const result = computeProvenance(meta, [], gravEdges, sourceKinds);
  const entries = result.get('node.md') ?? [];
  const total = entries.reduce((s, e) => s + e.amount, 0);
  assert.ok(Math.abs(total - expected) < 1e-9, `scaled total ${total} must equal capped 1 (derived raw ${rawTotal}), diff=${Math.abs(total-expected)}`);
  assert.strictEqual(entries.length, 2, 'two entries after scaling');
  const scale = expected / rawTotal;
  for (const e of entries) {
    assert.strictEqual(e.amount, directPerSource * scale, 'each scaled amount equals raw × scale');
  }
});

test('docs/functional/gravitas-provenance.md follows the live-vault format', () => {
  const docPath = join(import.meta.dirname, '../docs/functional/gravitas-provenance.md');
  const content = readFileSync(docPath, 'utf8');

  // Section order: Relationships → Incoming relationships → Gravitas Provenance → Confidence
  const relIdx = content.search(/\n## Relationships\n/);
  const incIdx = content.search(/\n## Incoming relationships\n/);
  const provIdx = content.search(/\n## Gravitas Provenance\n/);
  const confIdx = content.search(/\n## Confidence\n/);
  assert.ok(relIdx >= 0, 'has ## Relationships');
  assert.ok(incIdx > relIdx, '## Relationships before ## Incoming relationships');
  assert.ok(provIdx > incIdx, '## Incoming relationships before ## Gravitas Provenance');
  assert.ok(confIdx > provIdx, '## Gravitas Provenance before ## Confidence');

  // Header is exactly `## Gravitas Provenance`
  assert.ok(/^## Gravitas Provenance$/m.test(content), 'exact header line present');
  assert.ok(!/^## Gravitas$/m.test(content), 'legacy `## Gravitas` header is not used in the doc');

  // Direct: `- ([[Source]]) epistemic/evidence (0.72)`; inherited: same + ` (inherited)`
  const provenanceBody = content
    .split(/\r?\n/)
    .filter((l) => (l.startsWith('  - ([') || l.startsWith('- ([')) && l.includes('epistemic/evidence'));
  assert.ok(provenanceBody.length >= 1, 'at least one provenance entry line');
  for (const line of provenanceBody) {
    assert.ok(/^- \(\[\[[^\]]+\]\]\) epistemic\/evidence \(\d+(?:\.\d+)?\)( \(inherited\))?$/.test(line.trim()),
      `line matches the live format: ${line.trim()}`);
  }

  // No invented sections
  const headings = content.split(/\r?\n/).filter((l) => /^## /.test(l)).map((l) => l.trim());
  assert.deepStrictEqual(headings,
    ['## Relationships', '## Incoming relationships', '## Gravitas Provenance', '## Confidence'],
    'exactly the four live sections, in live order');
});
