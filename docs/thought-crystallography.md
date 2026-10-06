# Diffraction

## What this is

A note is a record of something you already understood. The *structure* between
notes is a record of something else — and that something is usually implicit.
Diffraction is the project's attempt to make the implicit explicit, and then to
look at it.

The framing comes from the crystallography of DNA. In 1952 Franklin and Gosling
could not see DNA; it is far too small for visible light. They aligned the
molecules into a lattice, fired an X-ray beam through it, and got back an
interference pattern — Photo 51, the dark "X". Watson and Crick read the
diffraction *geometry* and deduced the double helix that generated it. The
pattern was not the molecule. It was the molecule's effect on a beam.

Applied to thought:

| DNA, 1953 | Semantic Hologram |
|---|---|
| Atomic base pairs | Individual Zettelkasten notes |
| Molecular crystal lattice | The directed graph and its connection strengths |
| X-ray diffraction beam | Activation injected at a source, spreading along edges |
| Photo 51 — the interference pattern | Resonance chains, bridges, lit-but-unlinked pairs |
| Helical model deduction | An account of the macro-architecture the pattern implies |

The last row is the part that is still open. Everything below it is machinery.

## What is actually built

`src/diffraction.ts` is a pure module. It takes a graph — nodes as `{path,label}`,
edges as `{a,b,strength}` — and returns data. It imports nothing, reads no vault,
touches no DOM, and is deterministic: the same graph and sources always give the
same answer.

**Activation** (`applyVoltage`). Charge is injected at the source nodes, spreads to
each node's neighbours in proportion to conductance, decays each step, and the
whole field is renormalised. Synchronous update, so the result is
order-independent. This is a resistor-network relaxation, and it is the primitive
everything else is built on.

Five lenses read that field, ordered by how much authority their claim carries:

| Layer | Class | What it asserts |
|---|---|---|
| **Activation** | measurement | these nodes carry charge. Nothing more. |
| **Gaps** | absence | two lit notes have no edge between them |
| **Resonance** | inference | lit by the field but not linked to the source |
| **Bridges** | fact | a node's neighbours barely connect to each other |
| **Discovered** | composite | ranked resonance chains |

The ordering is not decoration — it is the render precedence. A node shows the
strongest reading it belongs to; weaker readings it also matches stay queryable
over MCP, and the panel states how many nodes were collapsed that way.

## Three rules that must keep holding

**1. Inferred structure never enters the layout.** The force simulation is what
gives the graph its shape. Feed a candidate edge into `applySprings` and the
layout physically rearranges itself around a fiction — and the fiction then looks
*confirmed by the shape*. The layers read activation values and write colour
only. This is the same trap ZettelFlow hit on their gap lens, where a "ghost
edge" added to the scene also joined the d3-force link set.

**2. "Found nothing" and "never ran" must not look alike.** The first version of
this passed an empty relation vocabulary, which made every relation line an
unknown type, which returned zero edges — and the tool then reported "no latent
connections found" with total confidence. `ScanDiagnostics.degenerate` exists
because of that. A bounded view that reports only what it drew tells the
flattering half of the truth, so every bound is stated: the gap lens reports
`{found: 129, reported: 30, limit: 30}`, not just the 30.

**3. AI-written relations are marked as inferred.** Human language is a lossy,
indirect encoding of intent. An AI reading a note can attempt to recover the
proposition rather than the string — which is the useful move, and the reason
this project wants an AI in the semantic layer rather than only in the
interface. But an inferred relation must not raise confidence the way an authored
one does, or the model launders guesses into beliefs, and the numbers look
*better* as it happens. `RelationEdge.authoredFrom` is where that distinction
lives. This is not implemented yet.

## Reach

The MCP server cannot see the view — it is a separate process with no handle on
live state, and computing a scan there would mean re-parsing markdown from disk.
So it asks the plugin to do the work: it writes a command file into the plugin
directory, the plugin answers against the graph it actually holds, and both
sides read the same bytes.

> `run_diffraction_scan` · `find_bridges` · `find_unlinked_pairs` · `explain_connection`

`explain_connection` exists because a hop path is uninformative on its own. A
four-hop path through dead notes and a four-hop path through load-bearing ones
look identical until you read the activation field. In the reference vault the
shortest path from `CPU Ring` to `Page Fault` runs through `Page Table Entry
(PTE)`, while the highest-charge intermediates are `Syscall` and `Operating
System` — neither of which is on that path.

## Provenance

Ported from `oldproject/` — a Python instrument set, kept as a read-only
reference and never modified. 6,010 lines: a diffractometer, a voltage meter, a
cable tracer, a signal follower, an LED display, an electromagnetic simulator,
and a three-axis score engine.

Three things changed rather than translating:

- **One `applyVoltage`, not seven.** The originals exist in seven files with three
  different signatures and drifting `steps`/`decay` defaults.
- **No vault access.** The originals walked the filesystem with `os.walk` against
  a hardcoded path and read note bodies. Nothing here reads note content.
- **The hand-written domain map is gone.** `score_engine.py` scored novelty
  against a literal table of five subsystems and twenty note names. Communities
  are derived from the graph now, by label propagation.

The hardcoded `if nbr == 'Linux Internals'` filter in the original diffractometer
did not survive the port, and neither did the "vault is read-only" constraint —
which was a property of that prototype, not a principle here. This plugin writes
to notes.

The vision statement this document is drawn from lived at
`oldproject/docs/thought_crystallography.md`, which was unlinked and easy to
miss. It is the clearest articulation of the project's identity in either
codebase, and it should not have been that hard to find.