// Remove generated bundles and sourcemaps.
//
// Both artifacts are derived from src/ and are gitignored. Stale copies are not
// harmless: an out-of-date mcp-server.js keeps answering MCP requests with code
// that no longer matches the source.
import { rmSync, readdirSync } from 'fs';
import { join } from 'path';

const root = new URL('..', import.meta.url).pathname;

const explicit = ['main.js', 'mcp-server.js'];
for (const name of explicit) {
	rmSync(join(root, name), { force: true });
}

const strayMaps = readdirSync(root).filter((f) => f.endsWith('.js.map') || f.endsWith('.mjs.map'));
for (const name of strayMaps) {
	rmSync(join(root, name), { force: true });
}

console.log(`clean: removed ${explicit.join(', ')}${strayMaps.length ? ` and ${strayMaps.length} sourcemap(s)` : ''}`);