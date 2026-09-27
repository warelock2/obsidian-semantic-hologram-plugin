import { TFile, TFolder, Vault } from 'obsidian';

export async function getIncomingNotes(vault: Vault, folderPath: string): Promise<TFile[]> {
	const folder = vault.getAbstractFileByPath(folderPath);
	if (!(folder instanceof TFolder)) {
		return [];
	}
	return folder.children.filter((f): f is TFile => f instanceof TFile && f.extension === 'md');
}

export async function normalizeNote(vault: Vault, file: TFile, content: string): Promise<string> {
	// Simple normalization: append or merge standard frontmatter
	const hasFrontmatter = content.startsWith('---\n');
	const newNodeFrontmatter = `---\nnode-type: thought\nlocal-confidence: 0.5\n---\n`;
	
	if (hasFrontmatter) {
		// Basic insertion after the opening ---
		return content.replace('---\n', newNodeFrontmatter);
	} else {
		return newNodeFrontmatter + content;
	}
}
