import { TFile } from 'obsidian';
import type SemanticHologramPlugin from './main';
import { HOLOGRAM_FOLDER } from './settings';

/** Write-through cache for hologram directory membership. */
export class HologramService {
	private plugin: SemanticHologramPlugin;
	private cache: Map<string, Set<string>> = new Map();

	constructor(plugin: SemanticHologramPlugin) {
		this.plugin = plugin;
	}

	async loadCache(): Promise<void> {
		this.cache.clear();
		const files = this.plugin.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(`${HOLOGRAM_FOLDER}/`));
		await Promise.all(
			files.map(async (f) => {
				const tags = this.readTagsFromPath(f.path);
				this.cache.set(f.path, tags);
			}),
		);
	}

	/**
	 * Derive hologram membership from directory location.
	 * A file at `hologram/<tag>/note.md` belongs to hologram `<tag>`.
	 * A file at `hologram/<tag>/<subtag>/note.md` belongs to both `<tag>` and `<subtag>`.
	 * A file directly in `hologram/` has no hologram membership.
	 */
	private readTagsFromPath(filePath: string): Set<string> {
		const prefix = `${HOLOGRAM_FOLDER}/`;
		if (!filePath.startsWith(prefix)) return new Set();
		const relative = filePath.slice(prefix.length);
		const parts = relative.split('/');
		if (parts.length < 2) return new Set();
		// All directory components except the filename are hologram memberships
		const tags = new Set<string>();
		for (let i = 0; i < parts.length - 1; i++) {
			const part = parts[i];
			if (part) tags.add(part);
		}
		return tags;
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

	/**
	 * Move a file to a hologram directory, creating it if necessary.
	 * Removes the file from its current hologram directory.
	 */
	async setTags(file: TFile, tags: ReadonlySet<string> | string[]): Promise<void> {
		const clean = new Set(Array.from(tags).map((t) => t.trim()).filter(Boolean));
		this.cache.set(file.path, new Set(clean));

		const vault = this.plugin.app.vault;
		const tagArray = Array.from(clean);
		if (tagArray.length === 0) {
			// Move to root hologram folder (no membership)
			const dest = `${HOLOGRAM_FOLDER}/${file.name}`;
			if (file.path !== dest) {
				await vault.rename(file, dest);
			}
			return;
		}

		// Move to first tag directory
		const primaryTag = tagArray[0]!;
		const dir = `${HOLOGRAM_FOLDER}/${primaryTag}`;
		try {
			if (!vault.getAbstractFileByPath(dir)) {
				await vault.createFolder(dir);
			}
		} catch {
			// Already exists
		}
		const dest = `${dir}/${file.name}`;
		if (file.path !== dest) {
			await vault.rename(file, dest);
		}

		// Copy to additional tag directories
		for (let i = 1; i < tagArray.length; i++) {
			const tag = tagArray[i]!;
			const extraDir = `${HOLOGRAM_FOLDER}/${tag}`;
			try {
				if (!vault.getAbstractFileByPath(extraDir)) {
					await vault.createFolder(extraDir);
				}
			} catch {
				// Already exists
			}
			const extraDest = `${extraDir}/${file.name}`;
			if (!vault.getAbstractFileByPath(extraDest)) {
				await vault.copy(file, extraDest);
			}
		}
	}

	/** Add a hologram membership (copy file to additional directory). */
	async addTag(file: TFile, tag: string): Promise<void> {
		const tags = this.getTags(file.path);
		if (tags.has(tag)) return;
		tags.add(tag);
		this.cache.set(file.path, new Set(tags));
		await this.setTags(file, tags);
	}

	/** Remove a hologram membership (move file out of directory). */
	async removeTag(file: TFile, tag: string): Promise<void> {
		const tags = this.getTags(file.path);
		if (!tags.has(tag)) return;
		tags.delete(tag);
		this.cache.set(file.path, new Set(tags));
		await this.setTags(file, tags);
	}
}
