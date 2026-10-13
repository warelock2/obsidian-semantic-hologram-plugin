/**
 * Section-header delimiters.
 *
 * Pure and Obsidian-free on purpose: the header matchers are the boundary
 * between "the user's prose" and "our structure", so they are the one thing
 * that must be unit-testable in isolation. They used to live inside
 * `relations.ts`, which imports `obsidian` — a type-only package with no
 * runtime — so none of them could be exercised outside the app. That is how
 * two real bugs stayed invisible (see `sectionHeader`).
 *
 * A note has only two regions, frontmatter and one body string. Meaning is
 * imposed on slices of the body by these headers and nothing else.
 */

/**
 * One matcher shape for every section header.
 *
 * These were four hand-written regexes that disagreed, which produced two real
 * bugs:
 *
 *   - `## Incoming Relationships (read only)` matched only the *incoming*
 *     header, so the annotated form of the *outgoing* header fell through and
 *     a second, real `## Relationships` was appended to the note.
 *   - Call sites tested `.trim()`ed lines, so an indented header inside a
 *     fenced code block or a quoted example matched — a pasted example of a
 *     relation line could be rewritten as if it were the live section.
 *
 * So: anchored at column 0 (no leading whitespace, so a header inside a code
 * block or blockquote is not a section, which is correct), uniformly tolerant
 * of case, whitespace, and a trailing parenthetical annotation.
 */
export function sectionHeader(names: string): RegExp {
	return new RegExp(`^#{1,6}[ \\t]+(?:${names})(?:[ \\t]*\\([^)\\n]*\\))?[ \\t]*$`, 'i');
}

/** Any section header at column 0 — used to bound the end of a section. */
export const ANY_HEADER = /^#{1,6}[ \t]+\S/;

export const RELATION_HEADER = sectionHeader('Relations(?:hips)?|Relationship');
export const INCOMING_HEADER = sectionHeader('Incoming[ \\t]+Relations(?:hips)?');
export const GRAVITAS_HEADER = sectionHeader('Gravitas');
export const CONFIDENCE_HEADER = sectionHeader('Confidence');
export const PROVENANCE_HEADER = sectionHeader('Provenance');

/** The canonical header text the skeleton emits. */
export const RELATIONS_HEADER_TEXT = '## Relationships';