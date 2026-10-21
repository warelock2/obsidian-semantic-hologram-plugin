# Semantic Hologram User Guide

**Version:** 3.0  
**Audience:** AI agents creating DAG-compatible Zettelkasten Semantic Hologram extended node notes  
**Project:** obsidian-semantic-hologram-plugin  

---

## 0. Assumed Context

You (the reader) are expected to already have loaded:

| Skill | What it gives you |
|---|---|
| **`zettelkasten`** | The original Luhmann method: atomicity, connectivity, link context, Folgezettel, structure notes, the three evidence layers. The *why*. |
| **`semantic-holograms`** | This project's extension: how Zettelkasten maps onto a typed-edge DAG, gravitas computation, node types, the plugin's behaviours. The *what*. |
| **`docs/relationships.txt`** | The full relationship taxonomy: 15 families, 188 registered types, each family with its central question. The *vocabulary*. |

**This guide is the operational layer**: the concrete file format, the decision
procedure for choosing a relationship type and its direction, and the integrity
rules. It does not restate the method — read the skills for that.

**Scope note:** this guide describes what a *correct* node looks like. It does
not ask you to repair existing notes; that is a separate undertaking.

---

## 1. Orientation

The plugin renders a graph where:

- **Nodes** = atomic Zettelkasten notes (one thought per note)
- **Edges** = typed relationships, each with strength *and* justification
- **Levels (0–4)** = DAG layers, derived from node type, positioning nodes in nD mode
- **Groups** = set membership (element → collection)
- **Gravitas** = computed influence, flowing up the DAG from sources

**Golden Rule:** One thought per note. Every relationship has a type, a strength, a direction, and a justification.

---

## 2. The Node File

A Semantic Node is **two regions**: YAML frontmatter, and one body. The body is
a single string; meaning is imposed on its slices by header delimiters and
nothing else. Prose is never touched — it is simply whatever sits between the
title and the first known header.

### 2.1 Frontmatter

```yaml
---
hologram-node: true
node-type: "idea"
created: "2026-10-20"
groups:
  - "Virtual Memory"
---
```

**Required:**

| Key | Value | Notes |
|-----|-------|-------|
| `hologram-node` | `true` | **Required marker.** The plugin's audit flags any note without it (`src/audit.ts`). A file without it is not a Semantic Node. |
| `node-type` | one of `source` / `concept` / `idea` / `pattern` / `topic` | Determines the DAG level (see §2.2) |
| `created` | ISO date, UTC (`YYYY-MM-DD`) | The audit flags a node without it |

**Optional:**

| Key | Value | Notes |
|-----|-------|-------|
| `groups` | list of collection titles | Each entry must be a **strictly higher level** (see §6) |
| `groups-excluded` | list of collection titles | Collections this node is deliberately *not* in |
| `source-kind` | e.g. `source/data`, `source/literature` | Source notes only; classifies the evidence |
| `confidence` | number | Overall confidence |
| `local-confidence` | number | Your own felt confidence for this note |
| `provenance` | list of source ids | The sources this node derives from |

**Canonical key order** (deliberate, not insertion order — the vault has
drifted between orderings, so anything that rewrites frontmatter should
normalize to this):

```
hologram-node → node-type → source-kind → created → groups → groups-excluded
→ confidence → local-confidence → provenance
```

Unknown keys are appended alphabetically after these.

**There is no `title:` key and no `level:` key.**

- The **filename is the node's identity.** The graph labels every node by its
  file's basename (`f.basename`), and `[[wikilinks]]` resolve by name against
  the vault. There is no frontmatter title — a `title:` key is dead weight.
  The body H1 should mirror the filename for human readability in Obsidian,
  but the plugin does not read it.
- The **level is derived**, not written. `node-type` maps to a DAG level through
  the `nodeTypes` table in settings. Writing `level:` by hand is redundant and
  can disagree with settings.

### 2.2 Node Types → DAG Levels

The level of a node is `nodeTypes[].level` for its `node-type` in settings.

| node-type | Level | Role | Can be a collection parent? |
|-----------|-------|------|------------------------------|
| `source`  | 0 | External reference (paper, book, spec) | **No** |
| `concept` | 1 | Foundational idea (e.g. "Operating System", "CPU Ring") | Yes |
| `idea`    | 2 | Mechanism, algorithm, data structure (e.g. "Page Table") | Yes |
| `pattern` | 3 | Reusable idiom (e.g. "Copy On Write", "Demand Paging") | Yes |
| `topic`   | 4 | Hologram root (e.g. "Linux Kernel Internals") | Yes |

> ⚠️ **Trap:** some node types in settings have **no level** (e.g. `thought`,
> `authority`, `data`). A node using one of those resolves to level **0** —
> source tier — and will be treated as such. Use one of the five types above
> unless you have a specific reason.

### 2.3 Body

```markdown
# Page Table

A Page Table is a data structure used by the virtual memory system to store
the mapping between virtual page numbers and physical frame numbers. Each
process owns one; the OS kernel swaps it on context switch. On x86 it is a
two-level hierarchy (Page Directory + Page Table).

## Relationships

- compositional/part-whole [[Virtual Memory]] (0.8) :: ...
```

**The body is free-form prose.** There is no required `## Summary` /
`## Details` structure, and Zettelkasten does not ask for one — the zk
requirement is *one thought, in your own words*, which is a constraint on
content, not on layout. The plugin treats everything between the H1 and the
first known header as prose and will not touch it.

The H1 should mirror the filename (`Page Table.md` → `# Page Table`) for human
readability. The graph itself labels by filename, so a mismatched H1 is
cosmetic drift, not a parse failure.

**`## Relationships` must be the last heading you author.** The relation region
runs from the `## Relationships` line to the next heading of **any** level
(`#{1,6}`), so:

- Prose must sit **above** `## Relationships` (placing the delimiter above the
  prose would swallow the prose as relation lines and report every paragraph
  as malformed).
- **Any** heading after `## Relationships` — `#`, `##`, `###`, however deep —
  truncates the relation region. The plugin's own generated sections are
  written after it, which is why they work.

**Never hand-write these sections** — the plugin generates them:

- `## Incoming relationships`
- `## Confidence`
- `## Gravitas`

---

## 3. Relationships — Format

```markdown
## Relationships

- family/type [[Target Note]] (strength) :: justification
- family/type [[Target Note]] {R} (strength) :: justification    # {R} = reciprocal
```

| Field | Required | Notes |
|-------|----------|-------|
| `family/type` | Yes | A registered type. See `docs/relationships.txt` for the full list. |
| `[[Target]]` | Yes | Wiki-link to the target note's title. |
| `(strength)` | Yes | Float. Our convention is 0.0–1.0; the parser accepts up to two decimals. |
| `{R}` | No | Adds the inverse edge automatically. |
| `:: justification` | **Yes** (house rule) | The "why" — Luhmann's link context. The parser accepts a line without it, so this one is on you, not the tool. |

**Do not write the same `family/type` twice for the same pair.** Edges are
deduplicated on (source, target, type); a second line with the same type
merges into the first rather than adding a second edge.

### Strength

| Range | Meaning |
|-------|---------|
| 0.3–0.4 | Weak / incidental |
| 0.5 | Standard |
| 0.6–0.7 | Strong / primary |
| 0.8–1.0 | Definitive — the target cannot work without it |

### Justification

Mandatory. It states **why this connection exists in this direction**.

```markdown
- causal/enablement [[Page Table]] (1.0) :: Provides the mapping structures that enable virtual-to-physical translation
- compositional/part-whole [[Virtual Memory]] (0.8) :: Page Tables are the core data structure implementing virtual memory translation
- epistemic/evidence [[Source A]] (0.8) :: Ch. 4 describes two-level page tables
```

---

## 4. Writing the Note — Zettelkasten Practice

The sections above are what the *plugin* needs. This section is what makes the
note a *Zettel* — the method's own demands, which no file format can enforce
for you.

### 4.1 One thought, and the "new note or not?" test

Atomicity is the method's foundational constraint and the plugin cannot check
it for you. Before writing, ask:

> Does this note contain exactly one thought, argument, concept, or excerpt?

If you find a second thought, it is a second note. Split it.

The corollary is the question Luhmann's numbering answers: **when do you start
a new note?**

Start a new note when the thought has its own address — when it will be
referenced on its own, when it diverges from the current one, or when it
belongs at a different level. Do not append it to an existing note "because it
is related": *related* is not *the same thought*. An over-full note breaks the
method even when every sentence in it is correct.

### 4.2 Write it in your own words

This is the rule most easily lost when an AI writes notes, and it is the one
that matters most.

- **Do not paste or lightly paraphrase the source's prose.** A Zettel is a
  re-expression: the source's claim, run through your understanding, in your
  sentences.
- Copying produces a note that carries someone else's thinking and adds nothing
  to the archive — and it makes the note indistinguishable from the source,
  which defeats the point of keeping them separate.
- A quote is fine *on top of* your own writing, clearly marked as a quote, with
  the source attributed.
- The test: if you could swap in a different source's sentence without the
  reader noticing, it isn't your thought yet.

### 4.3 An unprovenanced note is your own thought

zk's convention: a Zettel with no reference is your own thought by default. We
have the same thing, expressed as data:

- A node with **no** `epistemic/evidence` incoming edge is **unprovenanced** —
  you thought it yourself.
- The plugin reports this honestly: an unprovenanced note shows 0% gravitas
  rather than a broken value.

Do not manufacture provenance to make a note look better sourced. A node that
is genuinely your own thought, unprovenanced, is a correct node.

### 4.4 Connect radially, and record both directions

Luhmann: *"it is important to capture the connections radially … but at the
same time also by right away recording backlinks in the slips that are being
linked to."*

- **Radially:** a new note should link to *several* existing notes where the
  connections are real — not one, and not zero. The density of honest
  connection is the web.
- **Both directions:** when you link A → B, add the inverse B → A *if it is
  also true*. (`{R}` does this when it holds; do not use it when only one
  direction is true.)
- Backlinks are generated into the target note by the plugin — never
  hand-write them.

### 4.5 Collections are structure notes, not bins

zk's Structure Note is a meta-note about other notes: a table of contents that
says what is collected and why. Our `groups:` list gives you the *structure*;
the **collection node's body** is where the structure note's prose belongs.

A topic node ("Linux Kernel Internals") should say what it collects and what
the collection is *for* — otherwise it is an empty bin that the graph renders
but the reader cannot navigate. This is the register/entry-point role.

### 4.6 Altitude: pick the node type by the evidence layer

zk distinguishes three layers of evidence in a mature archive:

| zk layer | Our node types | The thought's status |
|---|---|---|
| Data description / pattern | `source` | The raw material, quoted and attributed |
| Interpretation | `idea` | What you make of it — a mechanism, a claim, an explanation |
| Synthesis | `pattern`, `topic` | What it generalises to — reusable idiom, organised domain |

Choose the type by the altitude of the thought, not by how interesting it
feels. A synthesis written at idea level is a note that will not compose; a
raw description written at pattern level is a note that will not ground.

### 4.7 Sources, citekeys, and provenance

External references are **their own notes**, not inline citations:

- Create a `source` node for each work, with `source-kind` classifying it.
- The concept note points *at* it with `epistemic/evidence`, whose
  `:: justification` says what in the source grounds this concept.
- The concept node's `provenance` frontmatter lists the source ids it derives
  from.

This is zk's bibliography discipline: the reference lives in the reference
manager (here: the source note), and the Zettel points at it.

### 4.8 Half-written notes are welcome

The skeleton seeds a body that may be a sentence or two — *"it is fine to leave
it half-written."* zk says the same thing as "trust the process": a note that
is not yet finished is still a note with an address, and having an address is
what makes it linkable. Do not withhold a note because it is unfinished, and do
not pad a note to look finished.

### 4.9 Tags are retrieval facets, not structure

zk: "Don't use categories. Use tags instead." In our system:

- **Structure** lives in `groups:` (collections) and in typed edges.
- **Tags** are for retrieval — a facet you might filter by, not a place in the
  hierarchy.
- Do not encode the same membership in a tag *and* in `groups:`; two sources of
  truth for one fact is how a graph rots.

---

## 5. Choosing the Relationship — The Decision Procedure

### 4.0 Master Direction Rule

> **Relationships always flow from the server to the served, from the supporter to the supported, from the source to the concept, from level n to level n+m.**

| Role pair | Direction | Ask yourself |
|-----------|-----------|--------------|
| Server → Served | provider → consumer | *Who serves who?* |
| Supporter → Supported | enabler → enabled | *Who can exist without who?* |
| Source → Concept | evidence → claim | *What grounds what?* |
| Component → Whole | part → system | *What composes what?* |
| Member → Collection | element → set | *What belongs to what?* |
| Premise → Conclusion | argument step | *Does this follow from that?* |

**Level delta rule:**
- **Compositional / taxonomic (set & part-whole) relations:** target level **>  source level** (upward, level n → n+m, m ≥ 1).
- **Everything else:** any delta is permitted; prefer target level ≥ source level so gravity flows sensibly.

### 4.1 Find the Family by Asking Its Central Question

Each family in `docs/relationships.txt` owns a central question. **Ask the
question; the answer names the family.**

| Family | Central question |
|--------|------------------|
| **Logical** | *What follows from what?* |
| **Semantic** | *What does something mean in relation to something else?* |
| **Taxonomic** | *What kind of thing is it relative to another thing?* |
| **Compositional** | *How are things constituted, organized, or structured relative to one another?* |
| **Causal** | *What produces, influences, enables, or prevents what?* |
| **Temporal** | *When does something occur relative to something else?* |
| **Spatial** | *Where is something located or oriented relative to something else?* |
| **Quantitative** | *How much, how many, or in what measurable relationship?* |
| **Modal** | *What must, can, cannot, or could otherwise be the case?* |
| **Epistemic** | *What grounds, supports, limits, or establishes our knowledge or belief about something?* |
| **Functional** | *What does something do, enable, or contribute toward achieving?* |
| **Normative** | *How does something relate to a standard, value, obligation, or evaluation?* |
| **Agentive** | *How does an agent relate to beliefs, intentions, decisions, actions, or other agents?* |
| **Representational** | *How does something represent, describe, model, or refer to something else?* |
| **Formal** | *What structural or mathematical properties does a relationship possess?* |
| **Epistemic Basis** | *On what grounds or by what method do we establish the claim that a relationship holds?* |

**Work top-down. The first family whose question you can answer honestly wins.**
If you cannot answer the question for a family, you do not belong in that family
— move down the list.

### 4.2 Decision Procedure

```
Given two nodes A and B, and a felt connection:

1. DIRECTION
   Who serves whom? Who supports whom? What grounds what?
   Fix the direction BEFORE choosing the type.

2. FAMILY
   Walk the central-question table top-down.
   First family you can answer honestly → that family.

3. TYPE
   Within the family, pick the type that names the relation precisely.
   (Full list: docs/relationships.txt)

4. LOGIC GATE  ← mandatory if the family is Logical
   Ask: "Are these two elements of a logical argument?"
   (premise → conclusion, evidence → claim, condition → outcome)
   If NO → you are in the wrong family. Go back to step 2.

5. LEVEL CHECK
   Compositional / Taxonomic (set & part-whole): target level > source level?
   If NO → this is not a set/part-whole relation. Re-pick the type.

6. STRENGTH
   How essential is it? 0.3 incidental → 1.0 indispensable.

7. JUSTIFICATION
   Write the "why" in your own words, explaining THIS direction.

8. NO FIT?
   If no family honestly applies, DO NOT CREATE THE EDGE.
   A forced edge is worse than a missing one: it adds noise to the graph,
   inflates gravitas, and asserts a claim you cannot defend.
   A node with few, well-justified edges is correct. A node with many
   vague ones is not.
```

### 4.3 Worked Traces

**Trace A — "Page Table → Process"**

- *Direction:* Process cannot function without a Page Table; the Page Table
  serves the Process. → **Page Table → Process**
- *Family:* Causal? "What produces, influences, enables, or prevents what?" —
  yes, the table *enables* the process's address space. → **causal**
- *Type:* `causal/enablement`
- *Level:* source 2 (idea) → target 2 (idea). Same level is fine for causal.
- *Strength:* indispensable → 1.0
- *Justification:* "Each process owns a Page Table defining its address space"

**Trace B — "Copy On Write → Demand Paging" (both patterns, level 3)**

- *Direction:* Neither serves the other; they are peers. But COW *is a form of*
  demand-loaded page population. → **Copy On Write → Demand Paging**
- *Family:* Taxonomic? "What kind of thing is it relative to another?" — COW is
  a *kind of* demand paging. → **taxonomic**
- *Type:* `taxonomic/subclass`
- *Level:* 3 → 3. **Taxonomic is a set/part-whole family, so the target level
  must exceed the source level. 3 → 3 fails the level check.**
- *Correction:* the honest reading is that COW is a *mechanism within* demand
  paging, not a subclass of it. Re-ask: Compositional — "How are things
  constituted, organized, or structured relative to one another?" →
  `compositional/part-whole`, and it still requires the target to be a higher
  level. If the pair genuinely belongs at the same level, the relation is
  **peer continuation**, not containment: `logical/implication`,
  `temporal/succession`, or `causal/interaction` — pick the one whose family
  question you can actually answer.
- *Lesson:* **the level check is a real constraint, not a formality.** When it
  fails, the relationship is not "structural" — it is something else, and the
  family question will tell you which.

**Trace C — "Source A → Operating System"**

- *Direction:* The source grounds the concept. → **Source A → Operating System**
- *Family:* Epistemic — "What grounds, supports, limits, or establishes our
  knowledge or belief about something?" → **epistemic**
- *Type:* `epistemic/evidence`
- *Level:* source must be level 0. ✓
- *Strength:* 0.8 — strong but not definitional.
- *Justification:* "Describes the ring-based protection model in Ch. 3"

### 4.4 Frequently Used Types

These carry most real graphs. The full registry is in `docs/relationships.txt`.

| Type | Use for |
|------|---------|
| `compositional/member-collection` | Element belongs to a collection/set (group membership) |
| `compositional/part-whole` | Part composes a whole |
| `compositional/component-system` | Explicit component ↔ system pair (use `{R}`) |
| `functional/supports` | A enables B; the general-purpose enabler |
| `functional/prerequisite` | A must exist before B can |
| `causal/enablement` | A causally enables B |
| `causal/causation` | A directly causes B |
| `epistemic/evidence` | Source grounds a concept (source must be level 0) |
| `epistemic/explanation` | A explains B |
| `logical/implication` | A implies B |
| `taxonomic/subclass` | A is a kind of B (type hierarchy) |
| `semantic/hyponymy` | A is a narrower sense of B |
| `temporal/precedence` | A comes before B |
| `normative/obligation` | A is required by a standard or obligation |

### 4.5 Choosing Well — Pitfalls

| Pitfall | Instead |
|---------|---------|
| Defaulting to one type for everything | Use the family central questions; the vocabulary has 188 types for a reason |
| Reaching for Logical without an argument | Apply the logic gate (§5.2 step 4) |
| Treating a same-level pair as containment | Containment goes **up** a level. Same-level means peer continuation, not membership |
| Weak edges everywhere | Strength should reflect necessity, not politeness |
| Justification that restates the type | "…is part of…" is not a justification. Say *why it matters*. |
| Linking everything | A web of thoughts, not a hairball. Every edge needs its own justification. |
| Forcing an edge because two nodes feel related | If no family fits, leave them unlinked (§5.2 step 8) |

---

## 6. Source Nodes (Level 0)

```yaml
---
hologram-node: true
node-type: "source"
source-kind: "source/data"
created: "2026-10-20"
---
```

- Hidden in **Cognitive** mode (default), visible in **Perceptive** mode.
- Emit **only** epistemic-family edges outward (typically `epistemic/evidence`).
- Never appear in another node's `groups:`.
- Sources are the **roots** of the gravity flow — they ground the DAG.

```markdown
## Relationships

- epistemic/evidence [[Operating System]] (0.8) :: Describes the ring-based protection model in Ch. 3
```

---

## 7. Groups (Set Membership)

`groups:` in frontmatter lists **collections** this node belongs to. The plugin
generates one collection edge per entry, **element → collection**.

```yaml
groups:
  - "Linux Kernel Internals"
  - "Virtual Memory"
```

**Rules:**
1. **Every listed group must be a strictly higher level** than this node.
   Element level < Collection level.
2. **Never list a same-level node** in `groups:` — that produces an invalid
   collection edge.
3. A node may belong to several collections (heterarchy, not a tree).
4. Collection nodes list their own parent collection, or nothing.
5. `groups-excluded:` records collections this node is deliberately *not* in —
   useful when a node would otherwise be swept into a collection by a naming
   coincidence.

**Example — Page Table (idea, level 2):**
```yaml
groups:
  - "Virtual Memory"    # concept (level 1) — valid
  # NOT "Address Space" — also idea (level 2)
```

---

## 8. Gravitas & Confidence (Generated — never hand-write)

The plugin computes and writes these back into the note.

- `## Gravitas (generated)` — `local` (intrinsic, from in/out degree and edge
  strengths), `inherited` (received from ancestors through the DAG), `total`
  (`min(1.0, local + inherited)`), three decimals, no `%`.
- `## Confidence (generated)` — derived confidence score.
- `## Gravitas Provenance (generated)` — the derivation chain, on nodes that
  receive gravitas.
- `## Incoming relationships` — every relation pointing *at* this note.

**Do not hand-write or hand-edit any of these.** The plugin owns them.

---

## 9. DAG Integrity Rules

| Rule | Statement |
|------|-----------|
| **Collection edges go up** | element.level < collection.level |
| **No structural cycles** | The compositional/taxonomic subgraph must be acyclic, or gravity and layout break |
| **Sources are roots** | Only level-0 nodes emit epistemic-family edges |
| **Reciprocal is deliberate** | `{R}` creates both directions — use it only where both directions are true |
| **One thought per node** | Atomicity is a design law, not a preference |
| **One edge per pair per type** | Duplicate (source, target, type) lines merge, not multiply |

### Known registry mismatch (disclosure)

The plugin generates group edges with the id **`structural/subsumed-by`**, but
there is **no `structural/` family** in the 188-type registry — the semantically
matching registered type is `compositional/member-collection`
(element → collection). The generated id is also what inherited confidence
sums from. When you author a *membership* relation by hand, use
`compositional/member-collection`; use `groups:` for membership the plugin
should own.

---

## 10. Complete Example Note

```markdown
---
hologram-node: true
node-type: "idea"
created: "2026-10-20"
groups:
  - "Virtual Memory"
---
# Page Table

A Page Table is a data structure used by the virtual memory system to store the
mapping between virtual page numbers and physical frame numbers. Each process
owns one; the OS kernel swaps it on context switch. On x86 it is a two-level
hierarchy (Page Directory + Page Table).

## Relationships

- compositional/part-whole [[Virtual Memory]] (0.8) :: Page Tables are the core data structure implementing virtual memory translation
- compositional/component-system [[Page Table Entry (PTE)]] (1.0) :: Each PTE is one row in the Page Table
- causal/enablement [[Process]] (1.0) :: Each process owns a Page Table defining its address space
- causal/enablement [[Context Switch]] (1.0) :: The Page Table pointer (CR3) is swapped on context switch
- causal/causation [[Page Fault]] (0.7) :: An invalid PTE entry is what causes the MMU to raise a page fault
- epistemic/evidence [[Source A]] (0.8) :: Ch. 4 describes two-level page tables
```

Note what this example does **not** contain: a `title:` key, a `level:` key, a
`## Summary` / `## Details` split, or any hand-written generated section.

---

## 11. Audit Checklist

- [ ] Frontmatter starts with `hologram-node: true`
- [ ] `node-type` is one of the five valid types; no hand-written `level:`
- [ ] No `title:` key — the **filename** is the node's identity
- [ ] Every `[[wikilink]]` target resolves to an existing note (unresolved targets are reported as malformed)
- [ ] Frontmatter keys follow the canonical order
- [ ] Every `groups:` entry is **strictly higher level**
- [ ] Body is free-form prose between the H1 and `## Relationships`
- [ ] `## Relationships` is the **last** authored `##` header
- [ ] Every relationship line has type, `[[Target]]`, `(strength)`, `:: justification`
- [ ] Type exists in `docs/relationships.txt`
- [ ] Strength is 0.0–1.0 and reflects necessity
- [ ] Justification explains the *why* and the *direction*
- [ ] Direction was decided before the type
- [ ] If Logical family → logic gate applied (genuine argument elements)
- [ ] Set/part-whole relations go **up** a level
- [ ] No duplicate (source, target, type) triples
- [ ] Source nodes emit only epistemic-family edges
- [ ] No hand-written `## Incoming relationships` / `## Confidence` / `## Gravitas`

**Zettelkasten practice (not mechanically checkable — read for these):**

- [ ] **One thought.** The note contains exactly one idea; a second one was split out (§4.1)
- [ ] **Own words.** The prose is a re-expression, not copied or lightly paraphrased source text; quotes are marked as quotes (§4.2)
- [ ] **Honest provenance.** No `epistemic/evidence` was added to make a note look better sourced (§4.3)
- [ ] **Radial connection.** The note links to several existing notes where the connections are real, and inverses were added only where they are also true (§4.4)
- [ ] **The collection has a reason.** If this node is a collection, its body says what it collects and why (§4.5)
- [ ] **Right altitude.** The node type matches the thought's evidence layer — data / interpretation / synthesis (§4.6)
- [ ] **External sources are notes.** Each work is its own `source` node with `source-kind`; concepts point at it with `epistemic/evidence` (§4.7)
- [ ] **Not padded.** The note is as long as the thought needs; it is not padded to look finished, and not withheld for being unfinished (§4.8)
- [ ] **Tags are facets.** Structure lives in `groups:` and edges, never duplicated into a tag (§4.9)

### Validation commands

| Command | Purpose |
|---------|---------|
| `npm run check:example` | Fails if `docs/example-node.md` has drifted from `src/skeleton.ts` |
| `npm run gen:example` | Regenerates it from the canonical skeleton |
| `npm run check` | typecheck + example check + lint |
| `npm run test` | Unit tests (node:test) |
| `semantic-hologram:audit-hologram-nodes` | In-app audit of every node in the vault |

---

## 12. Quick Reference

| Task | Syntax |
|------|--------|
| New concept | `node-type: concept`, `groups: ["Parent Topic"]` |
| New mechanism | `node-type: idea`, `groups: ["Parent Concept"]` |
| Belongs to a collection | `compositional/member-collection [[Collection]] (0.8) :: ...` |
| Part of a whole | `compositional/part-whole [[Whole]] (0.8) :: ...` |
| Enables | `functional/supports [[Target]] (0.6) :: ...` |
| Causes | `causal/causation [[Effect]] (0.7) :: ...` |
| Grounded by source | `epistemic/evidence [[Source A]] (0.8) :: ...` |
| Argument step | `logical/implication [[Conclusion]] (0.7) :: ...` |
| Reciprocal | `[[Target]] {R} (0.5) :: ...` |

---

## 13. Plugin Commands

| Command | Purpose |
|---------|---------|
| `semantic-hologram:open-semantic-hologram` | Open the graph view |
| `semantic-hologram:audit-hologram-nodes` | Validate all nodes |
| `semantic-hologram:refresh-gravitas-confidence` | Recompute scores |
| `semantic-hologram:review-all-connections` | Interactive relationship review |
| `semantic-hologram:scan-hologram-relations` | Scan vault for candidate edges |

---

## 14. Relationship to Luhmann's Original System

| Luhmann | Semantic Hologram |
|----------|-------------------|
| Atomic slips (1 thought = 1 card) | One thought per node |
| Folgezettel (`1a`, `1a1` — same-altitude continuation) | Same-level relations (`logical/implication`, `temporal/succession`) |
| Register (entry points to clusters) | Topics + `groups:` collections + graph navigation |
| Hub / Structure Notes | Collection nodes + `groups:` frontmatter |
| Link context (the *why* after the link) | Mandatory `:: justification` on every relationship line |
| Hypertext surfing | 3D/2D graph navigation, reveal cards, diffraction scan |
| Weight and gravity of a slip (implied) | Computed gravitas: `local` + `inherited` → `total`, flowing up the DAG from level-0 sources |

**The adaptation:** Luhmann's physical adjacency encoded sequence in the
*address*. We encode sequence in *typed edges*, and the DAG levels carry the
hierarchy. The visualization replaces the card catalogue as the surfacing
surface.

---

*End of guide. Keep in sync with `docs/relationships.txt`, `src/skeleton.ts`,
and the plugin's type registry (`src/relTypesDerived.ts`).*
