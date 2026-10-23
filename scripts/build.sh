#!/bin/bash
# Rebuild plugin bundle and reload in Obsidian
set -euo pipefail

echo "=== Building plugin ==="
cd "$(dirname "$0")/.."
npm run build
echo "=== Build finished ==="

echo "=== Reload instructions ==="
echo "Plugin rebuilt. To reload in running Obsidian:"
echo "  Option A (fast): trigger hot-reload plugin command 'hot-reload:scan-for-changes'"
echo "  Option B (full): run 'node /home/warelock/.config/opencode/skills/obsidian-plugin-dev/scripts/cdp-harness.mjs reload'"
echo "  Option C (manual): disable/enable plugin in Obsidian settings"
echo "=== Verify load ==="
echo "Check main.js for filter: grep 'nodeLevel(node)<1' main.js"
echo "Check source edit: grep 'level: 1' ../Nextcloud/Notes/zettelkasten-notes/.obsidian/plugins/semantic-hologram/data.json"
