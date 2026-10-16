import { Notice, TFile, TFolder, Vault } from 'obsidian';
import { HOLOGRAM_FOLDER } from './settings';

/**
 * Directory-level operations for the filesystem-mirrors-the-graph model.
 *
 * A hologram is a folder under `hologram/`, and membership is purely positional:
 * `hologram/<a>/<b>/note.md` belongs to both `a` and `b`. These helpers move
 * whole folders rather than rewriting notes, which is what makes split/merge/
 * un-emulsify the same operation at different nesting depths.
 */

/** Every markdown file under `dir`, at any depth. */
export function notesInDir(vault: Vault, dir: string): TFile[] {
	const root = vault.getAbstractFileByPath(dir);
	if (!(root instanceof TFolder)) return [];
	const out: TFile[] = [];
	const walk = (f: TFolder): void => {
		for (const child of f.children) {
			if (child instanceof TFile && child.extension === 'md') out.push(child);
			else if (child instanceof TFolder) walk(child);
		}
	};
	walk(root);
	return out;
}

/** Top-level hologram folders — the things the anchor list shows. */
export function topLevelHologramDirs(vault: Vault): TFolder[] {
	const root = vault.getAbstractFileByPath(HOLOGRAM_FOLDER);
	if (!(root instanceof TFolder)) return [];
	return root.children.filter((c): c is TFolder => c instanceof TFolder);
}

/** Every folder at or below `dir`, excluding `dir` itself. */
export function descendantDirs(vault: Vault, dir: string): TFolder[] {
	const root = vault.getAbstractFileByPath(dir);
	if (!(root instanceof TFolder)) return [];
	const out: TFolder[] = [];
	const walk = (f: TFolder, depth: number): void => {
		for (const child of f.children) {
			if (!(child instanceof TFolder)) continue;
			out.push(child);
			// Recurse without descending into hidden dirs; they are not holograms.
			if (depth < 8) walk(child, depth + 1);
		}
	};
	walk(root, 0);
	return out;
}

/** A path under `parentDir` that nothing occupies yet. */
function freePath(vault: Vault, parentDir: string, name: string): string {
	if (!vault.getAbstractFileByPath(`${parentDir}/${name}`)) return `${parentDir}/${name}`;
	let i = 2;
	while (vault.getAbstractFileByPath(`${parentDir}/${name} ${i}`)) i++;
	return `${parentDir}/${name} ${i}`;
}

export interface MoveResult {
	moved: string[];
	skipped: { path: string; reason: string }[];
}

/**
 * Move folder `srcPath` to become a child of `destDirPath`.
 *
 * Refuses anything that would build a cycle: a folder cannot be moved into
 * itself or into one of its own descendants, because `hologram/a/b` inside
 * `hologram/a` has no finite path. Obsidian's rename would either throw or
 * produce an unaddressable tree, so the check happens first.
 */
export async function moveDirInto(vault: Vault, srcPath: string, destDirPath: string): Promise<MoveResult> {
	const result: MoveResult = { moved: [], skipped: [] };

	const src = vault.getAbstractFileByPath(srcPath);
	if (!(src instanceof TFolder)) {
		result.skipped.push({ path: srcPath, reason: 'source is not a folder' });
		return result;
	}
	if (!(vault.getAbstractFileByPath(destDirPath) instanceof TFolder)) {
		result.skipped.push({ path: destDirPath, reason: 'destination is not a folder' });
		return result;
	}
	if (destDirPath === srcPath || destDirPath.startsWith(`${srcPath}/`)) {
		result.skipped.push({ path: srcPath, reason: 'destination is inside the source' });
		return result;
	}

	const dest = `${destDirPath}/${src.name}`;
	const existing = vault.getAbstractFileByPath(dest);
	if (existing instanceof TFolder && existing.children.length > 0) {
		// Merging folders wholesale would interleave two holograms without
		// resolving name collisions between them. That is the merge wizard's job,
		// not a silent side effect of a drag.
		result.skipped.push({ path: srcPath, reason: `"${dest}" already exists and is not empty` });
		return result;
	}
	const target = existing ? freePath(vault, destDirPath, src.name) : dest;
	try {
		await vault.rename(src, target);
		// `srcPath`, not `src.path`: rename mutates the folder's path in place, so
		// reading it back would report the destination as the source.
		result.moved.push(`${srcPath} -> ${target}`);
	} catch (e) {
		result.skipped.push({ path: srcPath, reason: String(e) });
	}
	return result;
}

/**
 * The single "un-emulsify" action: lift every nested hologram folder back to
 * `hologram/` top level.
 *
 * Reads the current tree rather than remembering what was done, so it reverses
 * any emulsification regardless of which action caused it — a drag, a move in
 * the OS file browser, or a sync client.
 */
export async function unEmulsifyAll(vault: Vault): Promise<MoveResult> {
	const result: MoveResult = { moved: [], skipped: [] };
	const nested = descendantDirs(vault, HOLOGRAM_FOLDER).filter((f) => f.path.split('/').length > 2);
	if (nested.length === 0) {
		return result;
	}
	// Deepest first: moving `a/b` out from under `a` before `a` itself moves
	// avoids re-resolving paths against a tree that is being rewritten.
	for (const folder of nested.sort((x, y) => y.path.length - x.path.length)) {
		const name = folder.name;
		// Snapshot before the rename: it rewrites `folder.path` in place.
		const from = folder.path;
		const target = freePath(vault, HOLOGRAM_FOLDER, name);
		try {
			await vault.rename(folder, target);
			result.moved.push(`${from} -> ${target}`);
		} catch (e) {
			result.skipped.push({ path: from, reason: String(e) });
		}
	}
	return result;
}

/** Human-readable summary of a {@link MoveResult}. */
export function describeMoveResult(r: MoveResult): string {
	const parts: string[] = [];
	if (r.moved.length) parts.push(`${r.moved.length} moved`);
	if (r.skipped.length) parts.push(`${r.skipped.length} skipped`);
	return parts.length ? parts.join(', ') : 'nothing to do';
}

/** Notice wrapper so callers do not each re-implement the reporting. */
export function reportMoveResult(r: MoveResult, verb: string): void {
	new Notice(`${verb}: ${describeMoveResult(r)}`, 6000);
	if (r.skipped.length) {
		console.warn(`${verb} skipped:`, r.skipped);
	}
}