// Regex for matching a relation line
export const REL_LINE_SEARCH = /-\s+([a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?)\s+\[\[([^\]]+)\]\]\s*(\{R\})?\s*\((\d{1,2}(?:\.\d{1,2})?)\)/;

import type { TFile } from 'obsidian';

interface PluginLike {
	app: {
		vault: {
			getAbstractFileByPath: (p: string) => unknown;
		};
	};
	settings: {
		defaultRelStrength?: number;
	};
}

export function injectWikilinksAsRelations(content: string, _source?: TFile, _plugin?: PluginLike): string {
    // 1. Parse existing sections: Relations and Incoming relationships
    const relHeaderMatch = content.match(/(^|\n)(#{1,6}\s+Relations(?:hips)?\s*\r?\n)/i);
    const incomingHeaderMatch = content.match(/(^|\n)(#{1,6}\s+Incoming\s+Relations(?:hips)?\s*\r?\n)/i);

    // Determine the boundary of the formal content section
    const relStart = relHeaderMatch?.index ?? content.length;
    const incomingStart = incomingHeaderMatch?.index ?? content.length;
    const sectionStart = Math.min(relStart, incomingStart);

    if (sectionStart === content.length) {
        return content;
    }

    const bodyContent = content.slice(0, sectionStart);

    // 2. Find and extract existing valid relationship lines
    const existingLinesInBody: string[] = [];
    const wikilinkRegex = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
    const strippedTargets = new Set<string>();
    const bodyLines = bodyContent.split('\n');
    const cleanedBodyLines: string[] = [];

    for (const line of bodyLines) {
        const t = line.trim();
        if (REL_LINE_SEARCH.test(t)) {
            existingLinesInBody.push(t);
        } else if (/^Related:/i.test(t) || /^Taught in:/i.test(t)) {
            for (const im of t.matchAll(wikilinkRegex)) {
                const it = im[1]?.trim();
                if (it) strippedTargets.add(it);
            }
        } else {
            cleanedBodyLines.push(line);
        }
    }
    const newBodyContent = cleanedBodyLines.join('\n');

    const relAndIncoming = relStart < content.length && incomingStart < content.length;
    const endBoundary = relAndIncoming ? Math.max(relStart, incomingStart) : content.length;
    const existingLinesInSections: string[] = [];
    const sectionContent = content.slice(sectionStart, endBoundary);
    for (const line of sectionContent.split('\n')) {
        if (REL_LINE_SEARCH.test(line.trim())) {
            existingLinesInSections.push(line.trim());
        }
    }

    const targets = new Set<string>(strippedTargets);
    let match;
    wikilinkRegex.lastIndex = 0;
    while ((match = wikilinkRegex.exec(newBodyContent)) !== null) {
        const target = match[1]?.trim();
        if (target) {
            targets.add(target);
        }
    }

    // 4. Check targets already present in relations
    const existingRelTargets = new Set<string>();
    
    for (const line of [...existingLinesInBody, ...existingLinesInSections]) {
        const m = line.match(REL_LINE_SEARCH);
        if (m && m[2]) {
            existingRelTargets.add(m[2].trim());
        }
    }

    const qualify = (target: string): string => {
        const base = target.split('|').pop()!.split('/').pop()!.trim();
        if (!base) return target;
        return base;
    };

    const requalifyLine = (line: string): string => {
        const m = line.match(REL_LINE_SEARCH);
        if (!m) return line;
        const relId = m[1]!;
        const target = m[2]!;
        const revived = m[3] ? ' {R}' : '';
        const strength = m[4] ?? String(_plugin?.settings?.defaultRelStrength ?? 0.5);
        return `- ${relId} [[${qualify(target)}]]${revived} (${strength})`;
    };

    const allLines = [...existingLinesInBody, ...existingLinesInSections].map(requalifyLine);
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const l of allLines) {
        const m = l.match(REL_LINE_SEARCH);
        const key = m ? m[2]!.split('|').pop()!.split('/').pop()!.trim() : l;
        if (!seen.has(key)) {
            seen.add(key);
            deduped.push(l);
        }
    }

    const defaultStrength = String(_plugin?.settings?.defaultRelStrength ?? 0.5);
    const linesToAdd = [...deduped];
    for (const target of targets) {
        const base = target.split('|').pop()!.split('/').pop()!.trim();
        const exists = [...existingRelTargets].some((r) => r.split('|').pop()!.split('/').pop()!.trim() === base);
        if (!exists) {
            linesToAdd.push(`- related [[${qualify(target)}]] (${defaultStrength})`);
        }
    }

    // 6. Assemble (Ensure we keep or create the structure)
    const relSection = `\n\n## Relations\n\n${linesToAdd.join('\n')}\n`;
    const incomingSection = `\n\n## Incoming relationships\n`;

    // Reconstruct: Body + Relations Section + Incoming Section
    return newBodyContent.trimEnd() + relSection + incomingSection;
}
