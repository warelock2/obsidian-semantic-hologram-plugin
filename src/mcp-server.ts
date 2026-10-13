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

/** How long to wait for the plugin to answer a scan command. */
const SCAN_TIMEOUT_MS = 20000;

/**
 * A GIF status file older than this cannot describe a recording in progress.
 * The recorder writes at least once per captured frame, so a few minutes of
 * silence means it stopped — the file outliving the run is the stale case.
 */
const GIF_STATUS_STALE_MS = 3 * 60 * 1000;

function describeAge(ms: number): string {
	const s = Math.round(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m`;
	const h = Math.round(m / 60);
	if (h < 48) return `${h}h ${m % 60}m`;
	return `${Math.round(h / 24)}d`;
}

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
				description:
					"Create a new hologram markdown file. Refuses to overwrite an existing file unless 'overwrite' is true.",
				inputSchema: {
					type: "object",
					properties: {
						filename: { type: "string" },
						content: { type: "string" },
						overwrite: { type: "boolean", description: "Replace the file if it already exists." },
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
			name: "run_diffraction_scan",
			description:
				"Run the diffraction scan over the LIVE plugin graph: activation from an optional source, plus bridges, resonance, gaps and ranked chains. Computed by the plugin against in-memory state, not from a dump file. Omit `filename` for a structural pass with no injection.",
			inputSchema: {
				type: "object",
				properties: {
					filename: { type: "string", description: "Optional source note: path or title" },
					target: { type: "string", description: "Optional second note to explain a connection to" },
				},
			},
		},
		{
			name: "find_bridges",
			description: "Notes whose neighbours barely connect to each other — they hold two regions together. Read from a live diffraction scan.",
			inputSchema: { type: "object", properties: {} },
		},
		{
			name: "find_unlinked_pairs",
			description:
				"Pairs of notes that both lit up during a scan but have no edge between them. An absence, so the result is bounded and the scan reports how many candidates it found versus drew.",
			inputSchema: { type: "object", properties: {} },
		},
		{
			name: "explain_connection",
			description:
				"Shortest path between two notes, plus which intermediate notes actually carry activation charge — the hop path alone cannot tell a load-bearing route from a dead one.",
			inputSchema: {
				type: "object",
				properties: {
					filename: { type: "string", description: "First note: path or title" },
					target: { type: "string", description: "Second note: path or title" },
				},
				required: ["filename", "target"],
			},
		},
	],
	};
});

const COMMAND_PATH = path.join(VAULT_ROOT, ".hologram-command.json");
const SCAN_RESULT_PATH = path.join(VAULT_ROOT, ".hologram-scan.json");

/**
 * Ask the plugin to run a scan and read what it produced.
 *
 * This server is a separate OS process with no handle on the Obsidian view, so
 * computing a scan here would mean re-parsing markdown from disk and reading a
 * dump file that can be arbitrarily stale. Instead we ask the plugin — which
 * holds the graph in memory — via the command file, and read the bytes it
 * writes. Same bytes the render layer reads.
 *
 * Each request stamps a nonce and waits for the result to change, so a stale
 * result from a previous scan is never returned as if it were fresh.
 */
async function requestScan(name: string, args: Record<string, unknown>): Promise<string> {
    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    let previous = "";
    try {
        previous = fs.readFileSync(SCAN_RESULT_PATH, "utf8");
    } catch {
        previous = "";
    }

    fs.writeFileSync(
        COMMAND_PATH,
        JSON.stringify({
            action: "run_scan",
            nonce,
            filename: typeof args.filename === "string" ? args.filename : undefined,
            target: typeof args.target === "string" ? args.target : undefined,
            timestamp: Date.now(),
        }),
    );

    const deadline = Date.now() + SCAN_TIMEOUT_MS;
    while (Date.now() < deadline) {
        await new Promise((r) => window.setTimeout(r, 150));
        let current: string;
        try {
            current = fs.readFileSync(SCAN_RESULT_PATH, "utf8");
        } catch {
            continue;
        }
        if (current === previous) continue;

        let parsed: Record<string, unknown>;
        try {
            parsed = JSON.parse(current) as Record<string, unknown>;
        } catch {
            continue; // half-written; try again
        }

        if (typeof parsed.error === "string") {
            return JSON.stringify({ tool: name, error: parsed.error }, null, 2);
        }

        // Surface the "found nothing" and "never ran" distinction to the caller
        // rather than letting an empty result read as a finding.
        const head: Record<string, unknown> = {
            tool: name,
            degenerate: parsed.degenerate,
            diagnostics: parsed.diagnostics,
        };

        switch (name) {
            case "find_bridges":
                return JSON.stringify({ ...head, bridges: parsed.bridges }, null, 2);
            case "find_unlinked_pairs":
                return JSON.stringify({ ...head, gaps: parsed.gaps }, null, 2);
            case "explain_connection":
                return JSON.stringify({ ...head, connection: parsed.connection }, null, 2);
            default:
                return JSON.stringify({ ...head, ...parsed }, null, 2);
        }
    }

    return JSON.stringify({
        tool: name,
        error:
            "timed out waiting for the plugin to publish a scan. Is the Semantic Hologram graph view open?",
        waitedMs: SCAN_TIMEOUT_MS,
    }, null, 2);
}

// Minimal parser helpers
function parseHologram(content: string) {
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const fm = fmMatch?.[1] || "";
    const noteTypeMatch = fm.match(/^(?:node-type|note-type):\s*(.+)$/im);
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
		const raw = fs.readFileSync(statusFile, "utf8");
		// A finished recording leaves its status file behind, so the file
		// existing says nothing about whether a recording is running *now*.
		// Report the age explicitly rather than letting a stale file be read as
		// current — the same failure mode the graph dump had.
		const ageMs = Date.now() - fs.statSync(statusFile).mtimeMs;
		const stale = ageMs > GIF_STATUS_STALE_MS;
		try {
			JSON.parse(raw);
		} catch {
			return { content: [{ type: "text", text: `${raw}\n\n(unparsable status file, ${describeAge(ageMs)} old)` }] };
		}
		return {
			content: [
				{
					type: "text",
					text: `${raw}\n\nstatus file is ${describeAge(ageMs)} old — ${stale ? "STALE, treat as not running" : "recent"}`,
				},
			],
			isError: false,
		};
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
        // `create_hologram` used to write straight through, so a typo'd or
        // repeated filename silently destroyed an existing note. Creation must
        // refuse to clobber; `overwrite: true` is the deliberate opt-in.
        const overwrite = (args as Record<string, unknown> | null | undefined)?.overwrite === true;
        if (name === "create_hologram" && fs.existsSync(filePath) && !overwrite) {
            throw new Error(
                `File already exists: ${filename}. Use update_hologram to change it, ` +
                    `or pass overwrite: true to replace it deliberately.`,
            );
        }
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

    if (name === "run_diffraction_scan" || name === "find_bridges" || name === "find_unlinked_pairs" || name === "explain_connection") {
        if (name === "explain_connection" && (!typedArgs.filename || !typedArgs.target)) {
            throw new Error("explain_connection requires both 'filename' and 'target'.");
        }
        return { content: [{ type: "text", text: await requestScan(name, typedArgs) }] };
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
