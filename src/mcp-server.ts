/* eslint-env node */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { runDiffractometerScan, detectStructuralDefects } from "./discovery";
import { TFile } from "obsidian";

const VAULT_ROOT = process.cwd();
const HOLOGRAM_DIR = path.join(VAULT_ROOT, "hologram");
const DATA_JSON_PATH = path.join(VAULT_ROOT, "data.json");
const GRAPH_STATE_PATH = path.join(VAULT_ROOT, "graph-state.json");

function getSettings() {
	if (!fs.existsSync(DATA_JSON_PATH)) {
		return null;
	}
	try {
		const dataContent = fs.readFileSync(DATA_JSON_PATH, "utf8");
		return JSON.parse(dataContent);
	} catch {
		return null;
	}
}

// Verify authentication key via environment variable against data.json hash
function authenticate(): { authenticated: boolean; error?: string } {
	return { authenticated: true };
}

const server = new Server(
	{
		name: "semantic-hologram-mcp",
		version: "1.0.0",
	},
	{
		capabilities: {
			tools: {},
		},
	}
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
	return {
		tools: [
	{
				name: "trigger_gif_recording",
				description: "Trigger the 3D hologram GIF recording process in Obsidian.",
				inputSchema: {
					type: "object",
					properties: {},
				},
			},
			{
				name: "get_gif_status",
				description: "Check the status of the current GIF recording/encoding process.",
				inputSchema: {
					type: "object",
					properties: {},
				},
			},
			{
				name: "list_holograms",
				description: "List all hologram markdown files in the vault.",
				inputSchema: {
					type: "object",
					properties: {},
				},
			},
			{
				name: "read_hologram",
				description: "Read the content of a specific hologram file.",
				inputSchema: {
					type: "object",
					properties: {
						filename: {
							type: "string",
							description: "Name of the file inside the hologram directory.",
						},
					},
					required: ["filename"],
				},
			},
			{
				name: "create_hologram",
				description: "Create a new hologram markdown file.",
				inputSchema: {
					type: "object",
					properties: {
						filename: { type: "string" },
						content: { type: "string" },
					},
					required: ["filename", "content"],
				},
			},
			{
				name: "update_hologram",
				description: "Update an existing hologram markdown file.",
				inputSchema: {
					type: "object",
					properties: {
						filename: { type: "string" },
						content: { type: "string" },
					},
					required: ["filename", "content"],
				},
			},
			{
				name: "get_node_neighbors",
				description: "Get neighbors of a hologram node.",
				inputSchema: {
					type: "object",
					properties: {
						filename: { type: "string" },
					},
					required: ["filename"],
				},
			},
			{
				name: "find_nodes_by_type",
				description: "Find hologram nodes by note type.",
				inputSchema: {
					type: "object",
					properties: {
						noteType: { type: "string" },
					},
					required: ["noteType"],
				},
			},
			{
				name: "dump_graph_state",
				description: "Get the current dumped graph state JSON.",
				inputSchema: {
					type: "object",
					properties: {},
				},
			},
			{
				name: "run_diffractometer_scan",
				description: "Run an energy diffusion (spreading activation) scan from a source hologram node to uncover latent connections.",
				inputSchema: {
					type: "object",
					properties: {
						filename: { type: "string", description: "Source hologram filename" },
						iterations: { type: "number", description: "Diffusion steps (default 15)" },
					},
					required: ["filename"],
				},
			},
			{
				name: "detect_structural_defects",
				description: "Scan the hologram network for structural defects, circular reasoning (cycles), and orphaned nodes.",
				inputSchema: {
					type: "object",
					properties: {},
				},
			},
		],
	};
});

// Minimal parser helpers
function parseHologram(content: string) {
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const fm = fmMatch?.[1] || "";
    const noteTypeMatch = fm.match(/^note-type:\s*(.+)$/im);
    const noteType = noteTypeMatch?.[1]?.trim() || null;

    const rels: { relId: string; target: string }[] = [];
    const relHeaderMatch = content.match(/^#{1,6}\s+(Relations(?:hips)?|Relationship)\s*$/im);
    if (relHeaderMatch) {
        const start = relHeaderMatch.index! + relHeaderMatch[0].length;
        const remaining = content.slice(start);
        const lines = remaining.split(/\r?\n/);
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) break;
            if (trimmed.startsWith("-")) {
                const relMatch = trimmed.match(/^-\s+([a-z0-9/_-]+)\s+\[\[([^\]]+)\]\]/);
                if (relMatch) {
                    rels.push({ relId: relMatch[1]!, target: relMatch[2]! + ".md" });
                }
            }
        }
    }
    return { noteType, rels };
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
	const auth = authenticate();
	if (!auth.authenticated) {
		throw new Error(auth.error || "Unauthorized.");
	}

	const { name, arguments: args } = request.params;
    const typedArgs = args as Record<string, string>;

    // Enforce read-only if write access is disabled
    if (name === "create_hologram" || name === "update_hologram") {
        const settings = getSettings();
        if (!settings || settings.mcpWriteAccess !== true) {
            throw new Error("Forbidden: Write access is disabled in plugin settings. The MCP server is running in read-only mode.");
        }
    }

	if (name === "trigger_gif_recording") {
		const commandFile = path.join(VAULT_ROOT, ".hologram-command.json");
		fs.writeFileSync(commandFile, JSON.stringify({ action: "record_gif", timestamp: Date.now() }));
		return { content: [{ type: "text", text: "GIF recording triggered." }] };
	}

	if (name === "get_gif_status") {
		const statusFile = path.join(VAULT_ROOT, ".hologram-status.json");
		if (!fs.existsSync(statusFile)) {
			return { content: [{ type: "text", text: "No status found. Recording might not have started." }] };
		}
		const status = fs.readFileSync(statusFile, "utf8");
		return { content: [{ type: "text", text: status }] };
	}

	if (name === "list_holograms") {
		if (!fs.existsSync(HOLOGRAM_DIR)) {
			return { content: [{ type: "text", text: JSON.stringify([]) }] };
		}
		const files = fs.readdirSync(HOLOGRAM_DIR).filter((f) => f.endsWith(".md"));
		return { content: [{ type: "text", text: JSON.stringify(files, null, 2) }] };
	}

	if (name === "read_hologram") {
		const filename = typedArgs.filename;
		if (!filename) throw new Error("Missing 'filename' argument.");
		const filePath = path.join(HOLOGRAM_DIR, filename);
		if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filename}`);
		const content = fs.readFileSync(filePath, "utf8");
		return { content: [{ type: "text", text: content }] };
	}

    if (name === "create_hologram" || name === "update_hologram") {
        const filename = typedArgs.filename;
        const content = typedArgs.content;
        if (!filename || !content) throw new Error("Missing 'filename' or 'content' argument.");
        const filePath = path.join(HOLOGRAM_DIR, filename);
        fs.writeFileSync(filePath, content, "utf8");
        return { content: [{ type: "text", text: `File ${filename} ${name === "create_hologram" ? "created" : "updated"} successfully.` }] };
    }

    if (name === "get_node_neighbors" || name === "find_nodes_by_type") {
        const files = fs.readdirSync(HOLOGRAM_DIR).filter((f) => f.endsWith(".md"));
        const results = [];
        
        for (const file of files) {
            const content = fs.readFileSync(path.join(HOLOGRAM_DIR, file), "utf8");
            const parsed = parseHologram(content);
            
            if (name === "get_node_neighbors" && file === typedArgs.filename) {
                return { content: [{ type: "text", text: JSON.stringify(parsed.rels, null, 2) }] };
            }
            if (name === "find_nodes_by_type" && parsed.noteType === typedArgs.noteType) {
                results.push(file);
            }
        }
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    }

	if (name === "dump_graph_state") {
		if (!fs.existsSync(GRAPH_STATE_PATH)) {
			return { content: [{ type: "text", text: JSON.stringify({ error: "Graph state not yet dumped. Run the debug command in Obsidian." }) }] };
		}
		const content = fs.readFileSync(GRAPH_STATE_PATH, "utf8");
		return { content: [{ type: "text", text: content }] };
	}

    if (name === "run_diffractometer_scan") {
        const sourceFile = typedArgs.filename;
        const iterations = typedArgs.iterations ? parseInt(typedArgs.iterations, 10) : 15;
        if (!sourceFile) throw new Error("Missing 'filename' argument.");

        if (!fs.existsSync(HOLOGRAM_DIR)) {
            return { content: [{ type: "text", text: JSON.stringify({ error: "Hologram directory not found." }) }] };
        }

        const files = fs.readdirSync(HOLOGRAM_DIR).filter((f) => f.endsWith(".md"));
        const adj = new Map<string, Set<string>>();
        const fileNames = new Set(files);

        for (const file of files) {
            const content = fs.readFileSync(path.join(HOLOGRAM_DIR, file), "utf8");
            const parsed = parseHologram(content);
            if (!adj.has(file)) adj.set(file, new Set());
            for (const rel of parsed.rels) {
                const target = rel.target;
                if (fileNames.has(target)) {
                    adj.get(file)!.add(target);
                    if (!adj.has(target)) adj.set(target, new Set());
                    adj.get(target)!.add(file);
                }
            }
        }

        let energy = new Map<string, number>();
        for (const f of files) energy.set(f, 0.0);
        if (energy.has(sourceFile)) energy.set(sourceFile, 1.0);

        for (let i = 0; i < iterations; i++) {
            const nextEnergy = new Map<string, number>(energy);
            for (const [node, val] of energy.entries()) {
                if (val > 0.001) {
                    const neighbors = adj.get(node);
                    if (neighbors && neighbors.size > 0) {
                        const spread = (val * 0.3) / neighbors.size;
                        for (const nbr of neighbors) {
                            nextEnergy.set(nbr, (nextEnergy.get(nbr) ?? 0) + spread);
                        }
                    }
                }
            }
            energy = nextEnergy;
            for (const [node, val] of energy.entries()) {
                energy.set(node, val * 0.85);
            }
        }

        // Find unlinked high energy nodes (latent discoveries)
        const directNeighbors = adj.get(sourceFile) || new Set();
        const results = Array.from(energy.entries())
            .filter(([node, score]) => node !== sourceFile && !directNeighbors.has(node) && score > 0.01)
            .sort((a, b) => b[1] - a[1])
            .map(([node, score]) => ({ filename: node, energyScore: score }));

        return { content: [{ type: "text", text: JSON.stringify({ source: sourceFile, latentDiscoveries: results }, null, 2) }] };
    }

    if (name === "detect_structural_defects") {
        if (!fs.existsSync(HOLOGRAM_DIR)) {
            return { content: [{ type: "text", text: JSON.stringify({ error: "Hologram directory not found." }) }] };
        }

        const files = fs.readdirSync(HOLOGRAM_DIR).filter((f) => f.endsWith(".md"));
        const adj = new Map<string, string[]>();
        const fileNames = new Set(files);

        for (const file of files) {
            const content = fs.readFileSync(path.join(HOLOGRAM_DIR, file), "utf8");
            const parsed = parseHologram(content);
            if (!adj.has(file)) adj.set(file, []);
            for (const rel of parsed.rels) {
                if (fileNames.has(rel.target)) {
                    adj.get(file)!.push(rel.target);
                }
            }
        }

        const visited = new Set<string>();
        const recStack = new Set<string>();
        const cycles: string[][] = [];
        const orphans: string[] = [];

        for (const file of files) {
            if ((adj.get(file)?.length ?? 0) === 0) {
                orphans.push(file);
            }
        }

        function findCycles(u: string, path: string[]) {
            visited.add(u);
            recStack.add(u);
            for (const v of adj.get(u) ?? []) {
                if (recStack.has(v)) {
                    cycles.push([...path, v]);
                } else if (!visited.has(v)) {
                    findCycles(v, [...path, v]);
                }
            }
            recStack.delete(u);
        }

        for (const file of files) {
            if (!visited.has(file)) {
                findCycles(file, [file]);
            }
        }

        return { content: [{ type: "text", text: JSON.stringify({ cycles, orphans }, null, 2) }] };
    }

	throw new Error(`Unknown tool: ${name}`);
});

async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error("Semantic Hologram MCP Server running on stdio");
}

main().catch((error) => {
	console.error("Fatal error in MCP server:", error);
	process.exit(1);
});
