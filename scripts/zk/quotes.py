#!/usr/bin/env python3
"""Luhmann and Semantic Hologram quotes for the zk trainer."""

LUHMANN_QUOTES = {
    "intake": {
        "quote": "One must be able to write down a thought in a way that it can be found again.",
        "source": "Luhmann, ZK 2 9/8 (translated notes)",
        "principle": "Atomicity: each zettel holds ONE idea, written in your own words, so it can be found and reused later.",
    },
    "filing": {
        "quote": "The Zettelkasten is a system of notes... every note has a fixed place.",
        "source": "Luhmann, 1968 manuscript",
        "principle": "Materialized path (Folgezettel): each zettel is filed at a specific location, creating a navigable tree.",
    },
    "linking": {
        "quote": "Links are not just references; they are the actual content of the system.",
        "source": "Luhmann, 1981 essay 'Kommunikation mit Zettelkästen'",
        "principle": "Thematic linking: every cross-reference must carry a 2-5 word context label. Bare links are not allowed.",
    },
    "query": {
        "quote": "The register is not an index. It is a set of entry points, curated by hand.",
        "source": "Luhmann, ZK 2 9/8 (translated notes)",
        "principle": "Register as curated entry points: max 4 per keyword, hand-selected, opinionated.",
    },
    "radial": {
        "quote": "A note is not stored in one place. It is stored in as many places as it has links.",
        "source": "Luhmann, 1981 essay 'Kommunikation mit Zettelkästen'",
        "principle": "Radial linking: one zettel links outward to many, building clusters. Multiple storage via links.",
    },
    "septic": {
        "quote": "Zettels that don't connect die. That is the system's self-cleaning.",
        "source": "Luhmann, 1968 manuscript",
        "principle": "Septic tank principle: unconnected zettels are filtered out. Dead ends are features, not bugs.",
    },
    "growth": {
        "quote": "I don't think everything on my own; much of it happens in the slip box.",
        "source": "Luhmann, 1981 essay 'Kommunikation mit Zettelkästen'",
        "principle": "Internal growth: you don't plan the structure; you follow threads and the structure emerges.",
    },
    "surprise": {
        "quote": "The Zettelkasten can surprise you.",
        "source": "Luhmann, 1981 essay 'Kommunikation mit Zettelkästen'",
        "principle": "Communication partner: the box thinks differently than you. It surfaces connections you didn't plan.",
    },
    "preselection": {
        "quote": "The Zettelkasten is a rationally constructed pre-selection of notes... One cannot know what one will find.",
        "source": "Luhmann, 1981 essay 'Kommunikation mit Zettelkästen'",
        "principle": "Pre-selection: the zettelkasten narrows the field so you can find what you need without searching everything.",
    },
    "communication": {
        "quote": "I treat the Zettelkasten as a communication partner.",
        "source": "Luhmann, 1987 interview",
        "principle": "Communication partner: the box is not storage; it is a thinking partner that responds differently than you.",
    },
    "memory": {
        "quote": "The slip box is my memory. But it is a memory that thinks differently than I do.",
        "source": "Luhmann, 1987 interview",
        "principle": "External memory: the zettelkasten holds connections you can't keep in your head.",
    },
    "books": {
        "quote": "Without the Zettelkasten, I would not have been able to write a single book.",
        "source": "Luhmann, 1987 interview",
        "principle": "Writing from the box: texts are composed by following threads of zettels.",
    },
    "easy": {
        "quote": "I only do what is easy for me. I only write when I immediately know how to do it.",
        "source": "Luhmann, 1981 essay 'Kommunikation mit Zettelkästen'",
        "principle": "Ease: if a zettel is hard to write, put it aside. The system works when writing is frictionless.",
    },
    "thinking": {
        "quote": "The Zettelkasten is not a filing system. It is a thinking system.",
        "source": "Luhmann, 1981 essay 'Kommunikation mit Zettelkästen' (paraphrase)",
        "principle": "Thinking system: the zettelkasten is a partner in thought, not a storage container.",
    },
    "intro": {
        "quote": "I don't think everything on my own; much of it happens in the slip box.",
        "source": "Luhmann, 1981 essay 'Kommunikation mit Zettelkästen'",
        "principle": "The zettelkasten is a communication partner. It thinks differently than you do.",
    },
}

SH_QUOTES = {
    "intake": {
        "quote": "A zettel is an atomic unit of thought. One idea, one note, written in your own words.",
        "source": "Ahrens, 'How to Take Smart Notes' (2017)",
        "principle": "Atomicity: each note holds one idea. This is shared with Luhmann's system.",
    },
    "filing": {
        "quote": "Tags are not folders. A note can have many tags, and tags create emergent structure.",
        "source": "Ahrens, 'How to Take Smart Notes' (2017)",
        "principle": "Tag-based filing: tags replace materialized paths, allowing multiple categorization.",
    },
    "linking": {
        "quote": "Links should be meaningful. But the meaning can be implicit in the context of the note.",
        "source": "Semantic Hologram project documentation",
        "principle": "Typed relationships: edges carry a family/type (e.g., causes/enables) instead of free-text context.",
    },
    "query": {
        "quote": "Search is the new register. Full-text search replaces hand-curated entry points.",
        "source": "Modern Zettelkasten practice (Roam, Obsidian)",
        "principle": "Full-text search: the system finds relevant notes automatically, no register needed.",
    },
    "radial": {
        "quote": "Backlinks are the modern equivalent of radial linking. Every note knows what links to it.",
        "source": "Modern Zettelkasten practice (Roam, Obsidian)",
        "principle": "Bidirectional links: links are automatically reciprocal. No need to manually add reverse links.",
    },
    "septic": {
        "quote": "In modern systems, no note is ever deleted. Search finds everything, even orphans.",
        "source": "Modern Zettelkasten practice",
        "principle": "No septic tank: all notes are kept. Search and tags make orphans findable.",
    },
    "growth": {
        "quote": "Structure emerges from use. MOCs (Maps of Content) grow organically from clusters of notes.",
        "source": "Modern Zettelkasten practice (Obsidian community)",
        "principle": "Planned growth: MOCs and tags provide structure that Luhmann's system lacks.",
    },
    "surprise": {
        "quote": "Graph view shows connections you didn't know existed. The visualization IS the surprise.",
        "source": "Semantic Hologram project documentation",
        "principle": "Graph visualization: the hologram renders connections spatially, making hidden links visible.",
    },
    "preselection": {
        "quote": "Gravitas scoring ranks notes by importance. High-gravitas notes surface first.",
        "source": "Semantic Hologram project documentation",
        "principle": "Gravitas: local/inherited/total scores rank notes by their connection weight.",
    },
    "communication": {
        "quote": "The hologram is a communication partner. It shows you what your notes look like from outside.",
        "source": "Semantic Hologram project documentation",
        "principle": "External perspective: the 3D visualization shows patterns invisible in linear text.",
    },
    "memory": {
        "quote": "Provenance tracking shows where each idea came from. Inherited gravitas flows up the chain.",
        "source": "Semantic Hologram project documentation",
        "principle": "Provenance: ideas carry their origin. Gravitas propagates through the link graph.",
    },
    "books": {
        "quote": "Composition is navigation. You write by following a path through the graph.",
        "source": "Semantic Hologram project documentation",
        "principle": "Graph navigation: texts are composed by traversing typed edges in the hologram.",
    },
    "easy": {
        "quote": "Templates reduce friction. A note template means you never start from a blank page.",
        "source": "Modern Zettelkasten practice (Obsidian, Notion)",
        "principle": "Templates: standardized note formats reduce cognitive load.",
    },
    "thinking": {
        "quote": "The Semantic Hologram is not a note system. It is a knowledge graph you can walk through.",
        "source": "Semantic Hologram project documentation",
        "principle": "Knowledge graph: notes are nodes, relationships are typed edges, gravitas is weight.",
    },
    "intro": {
        "quote": "The hologram thinks in 3D. Connections that are invisible in text become visible in space.",
        "source": "Semantic Hologram project documentation",
        "principle": "Spatial thinking: the 3D visualization reveals structure that linear text hides.",
    },
}

# All sources for the appendix at the end of log files
LUHMANN_SOURCES = [
    ("Luhmann, N. (1968). 'Zettelkasten' manuscript. Niklas Luhmann Archive.", "https://niklas-luhmann-archiv.de"),
    ("Luhmann, N. (1981). 'Kommunikation mit Zettelkästen.' In: Universitat Bielefeld.", None),
    ("Luhmann, N. (1987). Interview about the Zettelkasten. (Translated notes, ZK 2 9/8.)", None),
    ("Luhmann, N. ZK 2 9/8. Translated notes. Niklas Luhmann Archive.", "https://v0.api.niklas-luhmann-archiv.de"),
    ("Schmidt, J. F. K. (2015). 'Der Zettelkasten Niklas Luhmanns als Proto-Hypertext.' In: HyperKult.", None),
]

SH_SOURCES = [
    ("Ahrens, S. (2017). 'How to Take Smart Notes.' CreateSpace Independent Publishing.", None),
    ("Semantic Hologram project documentation (AGENTS.md, docs/).", "https://github.com/obsidian-semantic-hologram-plugin"),
    ("Modern Zettelkasten practice (Roam Research, Obsidian community).", None),
]


def get_quote(key, mode="luhmann"):
    """Get a quote dict for the given key and mode."""
    if mode == "semantic-hologram":
        return SH_QUOTES.get(key, LUHMANN_QUOTES.get(key))
    return LUHMANN_QUOTES.get(key)


def get_sources(mode="luhmann"):
    """Get list of (title, url) sources for the given mode."""
    if mode == "semantic-hologram":
        return LUHMANN_SOURCES + SH_SOURCES
    return LUHMANN_SOURCES


def format_quote(key, mode="luhmann"):
    """Format a quote for display."""
    q = get_quote(key, mode)
    if not q:
        return ""
    lines = [
        "",
        "─" * 60,
        f'Luhmann said: "{q["quote"]}"' if mode == "luhmann" else f'Quote: "{q["quote"]}"',
        f"— {q['source']}",
        "─" * 60,
        f"Principle: {q['principle']}",
        "─" * 60,
        "",
    ]
    return "\n".join(lines)
