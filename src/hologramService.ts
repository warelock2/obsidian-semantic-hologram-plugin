import { TFile, Vault, MetadataCache } from 'obsidian';
import type SemanticHologramPlugin from './main';
import { extractFrontmatter, parseNoteFrontmatter, setHologramsInContent } from './relations';

/** Write-through cache for hologram tags on notes. */
export class HologramService {
	private plugin: SemanticHologramPlugin;
	private cache: Map<string, Set<string>> = new Map();

	constructor(plugin: SemanticHologramPlugin) {
		this.plugin = plugin;
	}

	async loadCache(): Promise<void> {
		this.cache.clear();
		const files = this.plugin.app.vault.getMarkdownFiles().filter((f) => this.plugin.isInScope(f.path));
		console.log('[SH] Loading hologram cache for files:', files.map(f => f.path));
		await Promise.all(
			files.map(async (f) => {
				const tags = await this.readTagsFromFile(f);
				console.log('[SH] Tags for', f.path, ':', Array.from(tags));
				this.cache.set(f.path, tags);
			}),
		);
	}

	private async readTagsFromFile(file: TFile): Promise<Set<string>> {
		try {
			const content = await this.plugin.app.vault.cachedRead(file);
			const fm = parseNoteFrontmatter(extractFrontmatter(content));
			// Support both 'hologram' and 'holograms' keys
			const tags = fm.holograms ?? (fm as any).hologram ?? [];
			return new Set(Array.isArray(tags) ? tags : [tags]);
		} catch {
			return new Set();
		}
	}

	getTags(filePath: string): Set<string> {
		return this.cache.get(filePath) ?? new Set();
	}

	getAllTags(): string[] {
		const all = new Set<string>();
		for (const tags of this.cache.values()) {
			for (const t of tags) {
				all.add(t);
			}
		}
		return Array.from(all).sort();
	}

	async addTag(file: TFile, tag: string): Promise<void> {
		const tags = this.getTags(file.path);
		if (tags.has(tag)) return;
		tags.add(tag);
		this.cache.set(file.path, new Set(tags));
		await this.writeTagsToFile(file, tags);
	}

	async removeTag(file: TFile, tag: string): Promise<void> {
		const tags = this.getTags(file.path);
		if (!tags.has(tag)) return;
		tags.delete(tag);
		this.cache.set(file.path, new Set(tags));
		await this.writeTagsToFile(file, tags);
	}

	private async writeTagsToFile(file: TFile, tags: Set<string>): Promise<void> {
		const vault = this.plugin.app.vault;
		const content = await vault.read(file);
		await vault.modify(file, setHologramsInContent(content, Array.from(tags)));
	}
}
