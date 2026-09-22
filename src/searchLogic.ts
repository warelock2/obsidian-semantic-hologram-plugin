import type { SearchIndexEntry } from './view';

export const FIELD_ALIASES: Record<string, string> = {
	label: 'label',
	node: 'label',
	'node-type': 'type',
	path: 'path',
	type: 'type',
	relationship: 'relationship',
	rel: 'relationship',
	content: 'content',
};

export function parseSearchQuery(query: string) {
	let term: string = query.trim();

	// Strip outer quotes before parsing to allow field: "quoted term"
	if ((term.startsWith('"') && term.endsWith('"')) || (term.startsWith("'") && term.endsWith("'"))) {
		term = term.slice(1, -1);
	}

	const colonIndex = term.indexOf(':');
	let field: string | undefined;

	if (colonIndex > 0) {
		const fieldCandidate = term.slice(0, colonIndex).toLowerCase();
		if (FIELD_ALIASES[fieldCandidate]) {
			field = FIELD_ALIASES[fieldCandidate];
			term = term.slice(colonIndex + 1);
		}
	}

	return { field, term: term.toLowerCase() };
}

export function matchEntry(entry: SearchIndexEntry, field: string | undefined, term: string): Set<string> {
	const matches = new Set<string>();
	if (!term) return matches;

	// Entry matches if all tokens covered across in-scope fields
	const tokens: string[] = [];
	const regex = /"([^"]+)"|'([^']+)'|([^\s]+)/g;
	let match;
	while ((match = regex.exec(term)) !== null) {
		const token = match[1] || match[2] || match[3];
		if (token) {
			tokens.push(token.toLowerCase());
		}
	}
	
	const fieldsToCheck = [
		{ name: 'label', val: entry.label },
		{ name: 'path', val: entry.path },
		{ name: 'type', val: [entry.nodeType, entry.nodeTypeName, entry.nodeTypeDesc] },
		{ name: 'relationship', val: [entry.relIds, entry.relDescs] },
		{ name: 'content', val: entry.content }
	];

	const inScope = field ? fieldsToCheck.filter(f => f.name === field) : fieldsToCheck;
	const matchedFields = new Set<string>();
	const coveredTokens = new Set<string>();

	for (const f of inScope) {
		const text = (Array.isArray(f.val) ? f.val.join(' ') : f.val).toLowerCase();
		const fieldMatchedTokens = tokens.filter(t => text.includes(t.toLowerCase()));
		if (fieldMatchedTokens.length > 0) {
			matchedFields.add(f.name);
			fieldMatchedTokens.forEach(t => coveredTokens.add(t));
		}
	}

	if (coveredTokens.size !== tokens.length) {
		return new Set();
	}
	return matchedFields;
}
