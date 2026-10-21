# Internet of Thoughts / Metaverse of Thoughts

> **Status:** IDEA — vision. Wave 2026-10-15. "A vision document, not a technical specification." See [`docs/README.md`](../README.md).

## A Conceptual Vision for the Semantic Hologram as a Navigable Knowledge Cosmos

**Author:** Semantic Hologram Plugin  
**Last Updated:** 2026-10-15  
**Version:** 1.0.0

---

## 1. Introduction: From Flat Links to Navigable Space

The Zettelkasten method has long been praised for its ability to grow a dense web of cross-linked notes. But anyone who has maintained a large ZK knows the limitation: the web is **flat**. A link network tells you *that* two notes are connected, but not *what kind* of connection holds, *which way* knowledge flows, or *which ideas are load-bearing* and which are dangling. You scroll. You search. You lose the forest for the trees.

This project asks: **What if the web weren't flat what if it were a space you could fly through?**

The Semantic Hologram plugin renders your knowledge network as a **3D semantic graph** — a "hologram" where every note is a sphere, every relationship a typed directed edge, and the user can traverse the structure as if it were an environment rather than a list.

This document explores the conceptual implications of that choice. It is a vision document, not a technical specification. It asks: what does it mean to have your thoughts as a metaverse — and what might come next?

---

## 2. The Local Metaverse: Your Knowledge as a Navigable Environment

### 2.1 The Core Metaphor

The plugin's camera model is built on a simple but powerful idea: **your knowledge is a place you can inhabit.**

The camera is a **rigid two-part assembly**: a focal point `T` and an eye `E`, separated by a standoff distance `R`. The eye is always derived as `E = T - R·F`, where `F` is the forward vector. The assembly moves through a fixed world; everything else in world space is immutable scenery.

This is not an orbit camera. You do not swivel around a target. **All rotation is anchored on the focal point `T`** — the one thing in world space that navigation touches. The eye sweeps a sphere of radius `R` centered on `T`. You are always grounded at `T`, even as you explore.

### 2.2 Why This Matters

When your knowledge is a list, you are a reader. When it's a 3D graph you can fly through, you are an **explorer**.

- **Spatial memory:** Humans remember spatial layouts better than linear lists. The "where" of a idea becomes as memorable as the "what."
- **Overview before detail:** In 3D, you can step back and see the whole structure at once — clusters, bridges, orphans, and the overall topology — then fly closer to specific nodes.
- **The journey is the insight:** Navigating from node to node, feeling the repulsion of like ideas, the attraction of supportive edges, the dead ends and the through-passes — the physical sensation of traversal changes how you discover connections.

> **The metaverse of thoughts is not a replacement for reading. It is a different mode of engagement. It turns knowledge from something you consume into something you inhabit.**

---

## 3. Single-Player to Multi-Player: The Internet of Thoughts

### 3.1 From Personal Graph to Shared Network

Currently, the hologram is **personal**. Your vault, your notes, your camera state. But the plugin includes an **MCP (Model Context Protocol) server** that provides remote access to the live graph state. This is the seed of the internet of thoughts.

The MCP provides 12 tools:

| Tool | What It Enables |
|------|----------------|
| `list_holograms` | See which notes exist in another vault |
| `read_hologram` | Read the content of any hologram note |
| `create_hologram` / `update_hologram` | Add or modify notes in a remote vault (if write access is enabled) |
| `get_node_neighbors` | Query the neighborhood of any node |
| `find_nodes_by_type` | Find all notes of a given type |
| `run_diffraction_scan` | Run activation, bridges, gaps, resonance, discovered chain analysis |
| `explain_connection` | Explain the shortest path and intermediates between two nodes |

With these tools, the hologram becomes **shareable** — not by copying data, but by giving another agent (another person, another plugin, another AI) access to the same live graph through the stdio-based MCP handshake.

### 3.2 The "Internet" of Thoughts

If many people's holograms were connected — if the MCP handshake could traverse between vaults — the result would be an **internet of thoughts**. Some possibilities:

- **Cross-user bridge detection:** If Alice's `pattern` node and Bob's `pattern` node have a high bridging power, it suggests a common idea that both independently discovered.
- ** Collaborative scan injection:** One user injects a "source" node; others see the scan ripple through their own graphs, revealing resonance chains they hadn't noticed.
- **Consensus mapping:** Multiple users' graphs, overlaid, show which ideas are universal and which are idiosyncratic.
- **AI-augmented traversal:** An LLM sits between two holograms, suggesting paths, filling gaps, translating node types, or generating new nodes in the other's vault.

> **The internet of thoughts is not a database of summaries. It is a live connection between living knowledge graphs, where the structure of one informs the traversal of the other.**

### 3.3 The Challenges

Building an internet of thoughts raises hard problems:

- **Identity and provenance:** Who wrote this node? When? With what confidence? The plugin's frontmatter already tracks `created`, `source-kind`, `local-confidence`. An internet of thoughts would need to extend this.
- **Conflict resolution:** If two users create nodes with the same ID but different content, or rename the same relationship type differently, how does the graph reconcile? The plugin has migration tools (`renameNodeType`, `renameRelationship`) but they are manual and vault-local.
- **Sync vs. snapshot:** The MCP currently sends fresh dumps via a command-file handshake with nonce verification — each response is a **snapshot** in time, not a streaming sync. Building a true real-time shared graph would require a different architecture (CRDTs, distributed hash tables, etc.).
- **Privacy:** Not everyone wants their entire knowledge network visible. The MCP currently requires explicit `mcpWriteAccess` enablement and key generation. An internet of thoughts would need fine-grained consent models.

These are not insurmountable — they are simply the price of moving from a personal tool to a shared network.

---

## 4. Topology as Epistemology: Levels, Evidence, and the DAG

### 4.1 The Abstraction Ladder

The plugin's node-type system encodes an **epistemological model**:

| Level | Node type | What it represents |
|-------|-----------|-------------------|
| 0 | `percept` | Raw sense data, measurements, observations |
| 1 | `concept` | A single foundational concept |
| 2 | `idea` | An emerging idea or thought built from concepts |
| 3 | `pattern` | A recurring strategy or relationship among ideas |
| 4 | `topic` | A broader topical grouping |
| 5 | `domain` | A subject domain or field of study |
| 6 | `field` | A high-level academic or professional field |

**Higher-level nodes are built from lower-level ones.** The level gives the graph a **direction of abstraction** — a topological order. "This is more fundamental than that." The DAG guarantees that chains of justification are finite and non-circular.

### 4.2 Evidence Anchoring

At the base of the ladder are `source`, `authority`, and `data` nodes. These anchor the structure in objective reality. A claim whose support ultimately rests on nothing is a **floating abstraction** — structurally visible (it has no children beneath it), and structurally discouraged.

> **In the metaverse of thoughts, evidence anchoring is the difference between a floating island and a continent with bedrock. Without it, the graph is aesthetic but fragile. With it, the graph is a repository of justified belief.**

### 4.3 Orthographic vs. Perspective as Modes of Knowing

The plugin has two projection modes, toggled with `p`:

- **Perspective (pinhole):** Nearer nodes are genuinely larger. The pinhole divide `s(z) = d/(z+R)` makes depth visible. This is the "truth mode" — depth reveals genuine differences in abstraction level, proximity, authority.
- **Orthographic:** Constant scale `s = base/R`. Depth contributes nothing to geometry. Label size and opacity depend on rotated depth relative to `T`. This is the "structure mode" — patterns, clusters, and relationships emerge without the distraction of perceived proximity.

**The duality matters.** Sometimes you want to see *what is closer to the truth* (perspective). Sometimes you want to see *what structurally connects to what* (orthographic). The ability to toggle between them is not a gimmick — it's a reflection of how we actually come to know things: firsthand evidence (perspective) then structural coherence (orthographic).

---

## 5. The OS Filesystem as Enabler and Constraint

### 5.1 Why the Filesystem Matters for the Vision

The fact that this project's data lives in the **Obsidian vault filesystem** — not a database, not a proprietary format — is essential to the metaverse vision for several reasons:

1. **Longevity:** Markdown files outlive any single plugin or company. If the Semantic Hologram plugin were abandoned tomorrow, your notes would remain as valid Markdown. They could be read by any tool, converted to any format, or simply read in a text editor. The metaverse doesn't become a ghost town when the client disappears.

2. **Portability:** You can copy your `hologram/` folder to another vault, another machine, another cloud. The graph goes where you go. No export funnel, no data lock-in.

3. **Version control:** Git tracks the graph's evolution. You can see how your knowledge network has changed over years. You can branch, experiment, and merge — the same tools software teams use, applied to personal knowledge.

4. **Text-first, always:** The relationship lines, frontmatter, and node content are all plain text. This means you can edit them with any tool, search them with grep, diff them with `git diff`, and feed them to LLMs as context. The graph is not a black box — it's transparent text.

### 5.2 The Constraints of the Filesystem

The filesystem approach also constrains the vision:

1. **No native concurrency:** The vault filesystem was not built for real-time multi-user editing. The MCP workarounds (command files, nonce-verified dumps) are fundamentally snapshot-based, not streaming. An internet of thoughts built on top of this will need additional architecture.

2. **Gitignored notes:** The `hologram/` directory is gitignored by design. This means the graph structure (nodes, edges) is intentionally kept out of the "core" repository. If the internet of thoughts relies on seeing the full graph in a remote MCP view, the most important notes are by default excluded. This is a deliberate choice — user notes are separate from graph structure — but it creates a tension.

3. **No built-in identity server:** There's no central authority that says "this node ID is valid." Each vault is its own universe. Connecting vaults requires trust and manual key exchange (the MCP key hash/mask system).

4. **Text parsing overhead:** The plugin must parse frontmatter and relationship text on every load. This is slower than a schema-enforced database, and errors in frontmatter can cause silent data loss. The verification discipline (checking `git ls-files`, `git check-ignore`) is required because there's no database constraint to prevent corruption.

### 5.3 The Balance

The tension between **enabler** and **constraint** is where the project actually lives. The filesystem ensures the metaverse is **portable and eternal**, while the constraints remind us that **building a shared network on top of it requires intentional design, not just wishful thinking.**

The project's AGENTS.md discipline (`git check-ignore --no-index`, `git ls-files` before committing, no pre-commit hook) is not bureaucracy — it's the recognition that the filesystem is a **trust-based system**, and trust must be actively maintained.

---

## 6. Potential Future Directions

### 6.1 Distributed Graph Sharing

If the MCP handshake could connect between vaults (via stdio pipes between processes, or a relay server), the following becomes possible:

- **Federated levels:** User A's `field` node could be User B's `domain` node, with a mapping table. The diffraction scan respects the mapping, so activation energy flows across the federation.
- **CRDT-backed edges:** Instead of strength numbers (`0` to `1`), edge strengths could be Conflict-Free Replicated Data Types, allowing two users to independently add relationships that merge without conflict.
- **Automatic node-type mapping:** When User A's `idea` connects to User B's `concept`, the system infers a mapping and adjusts levels accordingly.

### 6.2 AR/VR Integration

The camera model (focal point + eye, standoff R, orthographic/perspective toggle) maps directly to:

- **VR:** You stand in a room of spheres. Walking closer makes nodes larger (perspective). Stepping back shows the whole structure (orthographic). Reaching out to touch a node reveals its frontmatter.
- **AR:** Your physical room becomes the canvas. Nodes are anchored to real-world locations. You walk through your knowledge as you would through a park.
- **Spatial audio:** Node volume falls off with distance. Node type determines spatial location (percepts behind you, fields in front).

### 6.3 AI-Guided Traversal

An LLM could act as a "tour guide" through the metaverse:

- "You're standing at the `percept` node for 'confirmation bias.' The `concept` nodes within 10 units are 'availability heuristic' and 'base rate neglect.' The `pattern` node 'motivated reasoning' connects both at strength 0.7. Would you like to fly to 'availability heuristic' or see all nodes that contradict this pattern?"
- "There's a gap in the graph here — no nodes connect to 'confirmation bias' at strength > 0.3. Would you like to import a source note to fill this gap?"
- "Based on your query 'cognitive biases in economic decision-making,' the shortest path through the graph goes: `concept` → `pattern` → `topic` → `domain`. Would you like me to plot this route?"

### 6.4 The "Thought Followed by Inference" Loop

One of the most exciting possibilities is the loop:

1. **You traverse the graph** and notice a gap or a new connection.
2. **You generate a new node** (via the "Create hologram node" command, or via the MCP `create_hologram` tool).
3. **The new node changes the graph's topology** — new paths open, old paths become irrelevant.
4. **You traverse again** from the new position.
5. **The graph evolves** in real time as your knowledge evolves.

This is the **thought followed by inference** loop — and the metaverse is the environment where it happens.

---

## 7. Conclusion: Knowledge as an Environment, Not a Page

The metaverse of thoughts is not about building a fancier dashboard. It is about **dimensionality**.

A page is one-dimensional. You read left to right, top to bottom. A screen is two-dimensional. You scroll and zoom. But a 3D environment is **three-dimensional**. You can fly through it, feel its topology, sense its gaps and clusters, and understand your knowledge not as a collection of facts but as a place you inhabit.

The Semantic Hologram plugin is an early attempt at this. It takes the Zettelkasten — the most enduring personal knowledge system we have — and gives it depth. It adds a camera, a DAG, projection modes, and an MCP server. It does not solve the problem of the internet of thoughts — it builds the first room in the house.

The OS filesystem is the foundation. It ensures the house won't rot away. The camera model, the DAG, the projection modes, the MCP — these are the rooms, the windows, the doors. And the conceptual vision here is just the beginning of the conversation about what it means to have your thoughts as a space you can actually live in.

---
*This document was generated as part of the documentation for the Semantic Hologram Obsidian plugin. It represents a conceptual vision, not a commitment to any specific implementation timeline. The features described may be added, modified, or removed as the project evolves. For the latest actual features, enable the plugin and consult the in-app help (hold `h`).*