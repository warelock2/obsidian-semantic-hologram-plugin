import { App } from 'obsidian';

export async function migrateRelationship(
	app: App,
	relId: string,
	action: 'keep' | 'replace' | 'remove',
	replacement?: string
) {
	const files = app.vault.getMarkdownFiles();
	const relIdEscaped = relId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	
	const regex = new RegExp(`^-\\s+${relIdEscaped}\\s+\\[\\[`, 'gm');
	
	for (const file of files) {
		let content = await app.vault.read(file);
		
		if (action === 'remove') {
			const removeRegex = new RegExp(`^-\\s+${relIdEscaped}\\s+\\[\\[.*\\n?`, 'gm');
			content = content.replace(removeRegex, '');
		} else if (action === 'replace' && replacement) {
			content = content.replace(regex, `- ${replacement} [[`);
		} else if (action === 'keep') {
			content = content.replace(regex, `- DEFUNCT: ${relId} [[`);
		}
		
		await app.vault.modify(file, content);
	}
}

export async function restoreRelationship(
	app: App,
	relId: string
) {
	const files = app.vault.getMarkdownFiles();
	const relIdEscaped = relId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	
	const restoreRegex = new RegExp(`^-\\s+DEFUNCT:\\s+${relIdEscaped}\\s+\\[\\[`, 'gm');
	
	for (const file of files) {
		let content = await app.vault.read(file);
		content = content.replace(restoreRegex, `- ${relId} [[`);
		await app.vault.modify(file, content);
	}
}

export async function migrateNodeType(
	app: App,
	nodeId: string,
	action: 'keep' | 'replace' | 'remove',
	replacement?: string
) {
	const files = app.vault.getMarkdownFiles();
	const nodeIdEscaped = nodeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	
	const regex = new RegExp(`^(note-type|node-type):\\s*${nodeIdEscaped}\\s*$`, 'gm');
	
	for (const file of files) {
		let content = await app.vault.read(file);
		
		if (action === 'remove') {
			content = content.replace(regex, '$1: concept');
		} else if (action === 'replace' && replacement) {
			content = content.replace(regex, `$1: ${replacement}`);
		} else if (action === 'keep') {
			content = content.replace(regex, `$1: DEFUNCT:${nodeId}`);
		}
		
		await app.vault.modify(file, content);
	}
}

export async function restoreNodeType(
	app: App,
	nodeId: string
) {
	const files = app.vault.getMarkdownFiles();
	const nodeIdEscaped = nodeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	
	const regex = new RegExp(`^(note-type|node-type):\\s*DEFUNCT:${nodeIdEscaped}\\s*$`, 'gm');
	
	for (const file of files) {
		let content = await app.vault.read(file);
		content = content.replace(regex, `$1: ${nodeId}`);
		await app.vault.modify(file, content);
	}
}

export async function renameRelationship(
	app: App,
	oldId: string,
	newId: string
) {
	const files = app.vault.getMarkdownFiles();
	const oldIdEscaped = oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	
	// Live relationship lines only; `- DEFUNCT: ...` lines are intentionally
	// untouched (a defunct type has no relationship to rename).
	const regex = new RegExp(`^-\\s+${oldIdEscaped}\\s+\\[\\[`, 'gm');
	
	for (const file of files) {
		let content = await app.vault.read(file);
		content = content.replace(regex, `- ${newId} [[`);
		await app.vault.modify(file, content);
	}
}

export async function renameNodeType(
	app: App,
	oldId: string,
	newId: string
) {
	const files = app.vault.getMarkdownFiles();
	const oldIdEscaped = oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	
	// Live node-type lines only; `note-type: DEFUNCT:...` lines are left alone.
	const regex = new RegExp(`^(note-type|node-type):\\s*${oldIdEscaped}\\s*$`, 'gm');
	
	for (const file of files) {
		let content = await app.vault.read(file);
		content = content.replace(regex, `$1: ${newId}`);
		await app.vault.modify(file, content);
	}
}
