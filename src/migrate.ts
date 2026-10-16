import { App, Notice, TFile, Vault } from 'obsidian';
import { extractFrontmatter, parseNoteFrontmatter } from './relations';
import { stripHologramKey } from './importNote';
import { HOLOGRAM_FOLDER } from './settings';

/**
 * One-time migration: convert tag-based hologram identity to directory-based.
 *
 * For each note with `holograms:` frontmatter:
 *   - Single tag: move file from hologram/ to hologram/<tag>/
 *   - Multiple tags: copy file to each hologram/<tag>/ directory
 *   - Strip the `holograms:` frontmatter from all files
 */
export async function migrateToDirectories(app: App): Promise<void> {
	const vault = app.vault;
	const files = vault.getMarkdownFiles().filter((f) => f.path.startsWith(`${HOLOGRAM_FOLDER}/`));

	// Ensure the hologram folder exists
	try {
		if (!vault.getAbstractFileByPath(HOLOGRAM_FOLDER)) {
			await vault.createFolder(HOLOGRAM_FOLDER);
		}
	} catch {
		// Already exists
	}

	let moved = 0;
	let copied = 0;
	let stripped = 0;
	let relinked = 0;
	const errors: string[] = [];

	for (const file of files) {
		try {
			const original = await vault.read(file);
			// Strip the tag AND de-qualify `hologram/`-prefixed wikilinks in one
			// write, so the note is rewritten once rather than twice.
			const content = unqualifyHologramLinks(stripHologramFrontmatter(original));
			if (content !== original) {
				relinked += countUnqualified(original);
			}
			const fm = parseNoteFrontmatter(extractFrontmatter(original));
			const raw = fm as unknown as Record<string, unknown>;
			const rawHolo = raw.hologram;
			const tags: string[] = fm.holograms ?? (Array.isArray(rawHolo) ? (rawHolo as string[]) : (typeof rawHolo === 'string' ? [rawHolo] : []));

			if (tags.length === 0) {
				// No hologram tags — nothing to move, but the note may still carry a
				// stale key or a `hologram/`-qualified link worth cleaning.
				if (content !== original) {
					await vault.modify(file, content);
					stripped++;
				}
				continue;
			}

			// Ensure target directories exist
			for (const tag of tags) {
				const dir = `${HOLOGRAM_FOLDER}/${tag}`;
				try {
					if (!vault.getAbstractFileByPath(dir)) {
						await vault.createFolder(dir);
					}
				} catch {
					// Already exists
				}
			}

			if (tags.length === 1) {
				// Single tag: move the file
				const dest = `${HOLOGRAM_FOLDER}/${tags[0]}/${file.name}`;
				if (content !== original) {
					await vault.modify(file, content);
					stripped++;
				}
				await vault.rename(file, dest);
				moved++;
			} else {
				// Multiple tags: the original becomes the *first* tag's copy, and
				// only the remaining tags need a duplicate.
				//
				// Copying to every tag first and then renaming the original would
				// collide with itself: the copy already occupies
				// `tags[0]/<name>`, so the rename would throw and leave the note
				// tagged-but-unmigrated, which is exactly the state the one-time
				// migration is supposed to eliminate.
				const newContent = content;
				if (content !== original) {
					await vault.modify(file, content);
					stripped++;
				}
				const firstDest = `${HOLOGRAM_FOLDER}/${tags[0]}/${file.name}`;
				if (vault.getAbstractFileByPath(firstDest)) {
					// A real note is already there; keep it and let this one move on.
					errors.push(`${file.path}: ${firstDest} already exists`);
					await vault.rename(file, `${HOLOGRAM_FOLDER}/${tags[0]}/${disambiguate(vault, file.name)}`);
				} else {
					await vault.rename(file, firstDest);
				}
				moved++;
				for (const tag of tags.slice(1)) {
					const dest = `${HOLOGRAM_FOLDER}/${tag}/${file.name}`;
					if (!vault.getAbstractFileByPath(dest)) {
						await vault.copy(file, dest);
						copied++;
					} else {
						errors.push(`${file.path}: ${dest} already exists, not copied`);
					}
				}
			}
		} catch (e) {
			errors.push(`${file.path}: ${String(e)}`);
		}
	}

	// Report
	const parts: string[] = [];
	if (moved > 0) parts.push(`${moved} moved`);
	if (copied > 0) parts.push(`${copied} copied`);
	if (stripped > 0) parts.push(`${stripped} rewritten`);
	if (relinked > 0) parts.push(`${relinked} link(s) de-qualified`);
	if (errors.length > 0) parts.push(`${errors.length} errors`);

	const msg = `Migration complete: ${parts.join(', ')}`;
	new Notice(msg, 10000);
	if (errors.length > 0) {
		console.error('Migration errors:', errors);
		new Notice(`First error: ${errors[0]}`, 10000);
	}
}

/**
 * `[[hologram/Syscall]]` → `[[Syscall]]`.
 *
 * Once a note moves to `hologram/<hologram>/`, a link that names the old flat
 * path no longer resolves: Obsidian matches links by path first, and there is no
 * longer any file at `hologram/Syscall.md`. A bare `[[Syscall]]` keeps working
 * because it resolves by basename, so the prefix has to go.
 *
 * Section and alias suffixes are preserved. A target that is *still* qualified
 * after the prefix is dropped (e.g. `hologram/Exec/Syscall`) is reduced to its
 * basename, because the leading `Exec` would otherwise be read as relative to
 * the linking note's own folder.
 */
function unqualifyHologramLinks(content: string): string {
	return content.replace(
		/\[\[hologram\/([^\]|#]+)(#[^\]|]*)?(\|[^\]]*)?\]\]/g,
		(_m, target: string, section = '', alias = '') => {
			const trimmed = target.trim();
			const bare = trimmed.includes('/') ? trimmed.slice(trimmed.lastIndexOf('/') + 1) : trimmed;
			return `[[${bare}${section}${alias}]]`;
		},
	);
}

/** How many `hologram/`-qualified wikilinks a note contains. */
function countUnqualified(content: string): number {
	return (content.match(/\[\[hologram\/[^\]|#]+/g) ?? []).length;
}

/**
 * Build a filename that is not yet taken in `dir`: `note.md` → `note 2.md`, etc.
 *
 * A migration must never overwrite: the destination may be a genuine
 * pre-existing note, and silently clobbering it would destroy data the user was
 * told they had backed up. Renaming into a free slot keeps both.
 */
function disambiguate(vault: Vault, fileName: string): string {
	const dot = fileName.lastIndexOf('.');
	const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
	const ext = dot > 0 ? fileName.slice(dot) : '';
	let i = 2;
	let candidate = `${stem} ${i++}${ext}`;
	while (vault.getAbstractFileByPath(candidate)) {
		candidate = `${stem} ${i++}${ext}`;
	}
	return candidate;
}

/**
 * Remove hologram/holograms frontmatter from note content.
 *
 * Delegates to the shared helper rather than reimplementing the parse: the local
 * copy this replaced dropped the key line but then tested `result` for it to find
 * the block-list items that followed — and the key line was never pushed, so
 * every `- item` under a block-form `holograms:` survived into the frontmatter,
 * leaving orphaned list items where a key had been.
 */
function stripHologramFrontmatter(content: string): string {
	return stripHologramKey(content);
}
