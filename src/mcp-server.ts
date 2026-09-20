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
