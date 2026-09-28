import { TFile, Vault, MetadataCache } from 'obsidian';
import { scanRelations } from './relations';
import { readNodeMetasFresh } from './gravitas';

export interface EnergyScanResult {
    energy: Map<string, number>;
}

/**
 * Perform a voltage diffusion scan (spreading activation) over the graph.
 */
export async function runDiffractometerScan(
    files: TFile[],
    vault: Vault,
    metadataCache: MetadataCache,
    sourceId: string,
    iterations: number = 15,
    decay: number = 0.85
): Promise<EnergyScanResult> {
    const metas = await readNodeMetasFresh(files, vault, 0.5);
    const scan = await scanRelations(files, vault, metadataCache, new Set(), 0.5, () => true);
    
    // Build adjacency list
    const adj = new Map<string, Set<string>>();
    for (const edge of scan.edges) {
        if (!adj.has(edge.source)) adj.set(edge.source, new Set());
        if (!adj.has(edge.target)) adj.set(edge.target, new Set());
        adj.get(edge.source)!.add(edge.target);
        adj.get(edge.target)!.add(edge.source);
    }

    let energy = new Map<string, number>();
    for (const f of files) energy.set(f.path, 0.0);
    if (energy.has(sourceId)) energy.set(sourceId, 1.0);

    for (let i = 0; i < iterations; i++) {
        const nextEnergy = new Map<string, number>(energy);
        for (const [node, val] of energy.entries()) {
            if (val > 0.001) {
                const neighbors = adj.get(node);
                if (neighbors) {
                    const spread = val * 0.3 / neighbors.size;
                    for (const nbr of neighbors) {
                        nextEnergy.set(nbr, (nextEnergy.get(nbr) ?? 0) + spread);
                    }
                }
            }
        }
        energy = nextEnergy;
        // Apply decay
        for (const [node, val] of energy.entries()) {
            energy.set(node, val * decay);
        }
    }

    return { energy };
}

/**
 * Detect structural defects: cycles and orphans.
 */
export async function detectStructuralDefects(
    files: TFile[],
    vault: Vault,
    metadataCache: MetadataCache
) {
    const scan = await scanRelations(files, vault, metadataCache, new Set(), 0.5, () => true);
    
    // Cycle detection using DFS
    const adj = new Map<string, string[]>();
    for (const e of scan.edges) {
        if (!adj.has(e.source)) adj.set(e.source, []);
        adj.get(e.source)!.push(e.target);
    }

    const visited = new Set<string>();
    const recStack = new Set<string>();
    const cycles: string[][] = [];

    function findCycles(u: string, path: string[]) {
        visited.add(u);
        recStack.add(u);
        for (const v of adj.get(u) ?? []) {
            if (recStack.has(v)) {
                cycles.push([...path, v]);
            } else if (!visited.has(v)) {
                findCycles(v, [...path, v]);
            }
        }
        recStack.delete(u);
    }

    for (const f of files) {
        if (!visited.has(f.path)) findCycles(f.path, [f.path]);
    }

    return { cycles };
}
