import { MetadataCache, TFile, Vault } from 'obsidian';
import type { RelationEdge } from './relations';
import { scanRelations } from './relations';
import type SemanticHologramPlugin from './main';

export class IncomingIndex {
	private index: Map<string, RelationEdge[]> = new Map();

	constructor(private plugin: SemanticHologramPlugin) {}

	async update() {
		const files = this.plugin.app.vault.getMarkdownFiles();
		const scan = await scanRelations(
			files,
			this.plugin.app.vault,
			this.plugin.app.metadataCache,
			this.plugin.knownRelIds(),
			this.plugin.settings.defaultRelStrength,
			(path) => this.plugin.isInScope(path),
		);
		
		this.index.clear();
		for (const e of scan.edges) {
			console.log(`IncomingIndex: adding edge ${e.source} -> ${e.target}`);
			const arr = this.index.get(e.target) ?? [];
			arr.push(e);
			this.index.set(e.target, arr);
		}
	}

	getIncoming(path: string): RelationEdge[] {
		console.log(`IncomingIndex: lookup for ${path}`);
		const res = this.index.get(path) ?? [];
		console.log(`IncomingIndex: found ${res.length} edges for ${path}`);
		return res;
	}
}
