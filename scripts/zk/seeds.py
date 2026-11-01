#!/usr/bin/env python3
"""Generate pre-loaded seed databases for training levels."""
import json, sqlite3, sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
SEEDS_DIR = BASE / "seeds"
SEEDS_DIR.mkdir(parents=True, exist_ok=True)

# Zettel templates for organizational theory topic
ZETTELS = [
    ("zettel-a", "/1/", "Authority depends on the subordinate's zone of indifference. Beyond this zone, compliance becomes coerced.", "concept"),
    ("zettel-b", "/1/a/", "Barnard's incentive theory: when orders fall outside the zone, organizations must offer inducements.", "concept"),
    ("zettel-c", "/1/a/1/", "Informal groups override formal authority. The zone of indifference is socially constructed.", "concept"),
    ("zettel-d", "/2/", "Parsons: authority requires internalization of norms, not just power.", "concept"),
    ("zettel-e", "/2/a/", "The paradox of authority: it requires both autonomy and its surrender.", "concept"),
    ("zettel-f", "/3/", "Weber's three types: traditional, charismatic, legal-rational authority.", "concept"),
    ("zettel-g", "/3/a/", "Charismatic authority is inherently unstable; it must routinize or die.", "concept"),
    ("zettel-h", "/4/", "Bureaucracy as the iron cage: rationalization eliminates discretionary authority.", "concept"),
    ("zettel-i", "/4/a/", "Foucault: power is not possessed but exercised through discourse and institutions.", "concept"),
    ("zettel-j", "/5/", "Habermas: communicative action requires mutual understanding, not strategic compliance.", "concept"),
    ("zettel-k", "/5/a/", "Legitimacy crisis: when the system's outputs fail to match its promises.", "concept"),
    ("zettel-l", "/6/", "March and Simon: bounded rationality limits organizational decision-making.", "concept"),
    ("zettel-m", "/6/a/", "Satisficing: organizations seek satisfactory, not optimal, solutions.", "concept"),
    ("zettel-n", "/7/", "Cyert and March: organizational goals are negotiated, not given.", "concept"),
    ("zettel-o", "/7/a/", "Slack resources buffer organizations from environmental uncertainty.", "concept"),
    ("zettel-p", "/8/", "Thompson: organizations cope with uncertainty through buffering and leveling.", "concept"),
    ("zettel-q", "/8/a/", "Technology and structure: Woodward's contingency theory.", "concept"),
    ("zettel-r", "/9/", "Pfeffer and Salancik: resource dependence shapes organizational power.", "concept"),
    ("zettel-s", "/9/a/", "Political model: organizations as coalitions of interests.", "concept"),
    ("zettel-t", "/10/", "Institutional theory: organizations conform to myths and ceremonies.", "concept"),
    ("zettel-u", "/10/a/", "Isomorphism: organizations become similar through coercive, mimetic, normative pressures.", "concept"),
    ("zettel-v", "/11/", "Network theory: organizations as nodes in interdependent systems.", "concept"),
    ("zettel-w", "/11/a/", "Granovetter: weak ties bridge structural holes in networks.", "concept"),
    ("zettel-x", "/12/", "Complexity theory: organizations as complex adaptive systems.", "concept"),
    ("zettel-y", "/12/a/", "Emergence: system-level properties arise from local interactions.", "concept"),
    ("zettel-z", "/13/", "Knowledge management: organizations as knowledge-creating entities.", "concept"),
    ("zettel-aa", "/13/a/", "Nonaka: tacit knowledge conversion through socialization, externalization, combination, internalization.", "concept"),
    ("zettel-ab", "/14/", "Learning organizations: Senge's five disciplines.", "concept"),
    ("zettel-ac", "/14/a/", "Double-loop learning: questioning underlying assumptions.", "concept"),
    ("zettel-ad", "/15/", "Complexity leadership: enabling rather than directing.", "concept"),
    ("zettel-ae", "/15/a/", "Adaptive leadership: mobilizing people to tackle tough challenges.", "concept"),
    ("zettel-af", "/16/", "Servant leadership: leading by serving others first.", "concept"),
    ("zettel-ag", "/16/a/", "Transformational leadership: inspiring change through vision.", "concept"),
    ("zettel-ah", "/17/", "Transactional leadership: exchange-based, contingent reward.", "concept"),
    ("zettel-ai", "/17/a/", "Situational leadership: adapting style to follower readiness.", "concept"),
    ("zettel-aj", "/18/", "Distributed leadership: leadership as a collective property.", "concept"),
    ("zettel-ak", "/18/a/", "Shared leadership: multiple people influence the group.", "concept"),
    ("zettel-al", "/19/", "Ethical leadership: moral person + moral manager.", "concept"),
    ("zettel-am", "/19/a/", "Authentic leadership: self-awareness, relational transparency, balanced processing.", "concept"),
    ("zettel-an", "/20/", "Complexity: organizations face wicked problems, not tame ones.", "concept"),
    ("zettel-ao", "/20/a/", "VUCA: volatility, uncertainty, complexity, ambiguity.", "concept"),
    ("zettel-ap", "/21/", "Resilience: bouncing back from adversity.", "concept"),
    ("zettel-aq", "/21/a/", "Antifragility: gaining from disorder (Taleb).", "concept"),
    ("zettel-ar", "/22/", "Agility: responding to change over following a plan.", "concept"),
    ("zettel-as", "/22/a/", "Lean: eliminating waste, maximizing value.", "concept"),
    ("zettel-at", "/23/", "Design thinking: empathy, define, ideate, prototype, test.", "concept"),
    ("zettel-au", "/23/a/", "Systems thinking: seeing wholes, not just parts.", "concept"),
    ("zettel-av", "/24/", "Cybernetics: feedback loops control systems.", "concept"),
    ("zettel-aw", "/24/a/", "Second-order cybernetics: the observer is part of the system.", "concept"),
    ("zettel-ax", "/25/", "Autopoiesis: self-producing systems (Maturana/Varela).", "concept"),
    ("zettel-ay", "/25/a/", "Structural coupling: systems interact through perturbation, not instruction.", "concept"),
]

# Link pairs (source, target, label)
LINKS = [
    ("zettel-b", "zettel-a", "Grenze des Gehorsams"),
    ("zettel-c", "zettel-a", "Informelle Widerstand"),
    ("zettel-c", "zettel-b", "Anreize und Normen"),
    ("zettel-d", "zettel-a", "Normeninternalisierung"),
    ("zettel-e", "zettel-a", "Autonomieparadox"),
    ("zettel-e", "zettel-d", "Parsons Ergaenzung"),
    ("zettel-f", "zettel-a", "Autoritaetstypen"),
    ("zettel-g", "zettel-f", "Routinisierung"),
    ("zettel-h", "zettel-f", "Buerokratie"),
    ("zettel-i", "zettel-h", "Macht und Diskurs"),
    ("zettel-j", "zettel-a", "Kommunikative Vernunft"),
    ("zettel-k", "zettel-j", "Legitimationskrise"),
    ("zettel-l", "zettel-a", "Begrenzte Rationalitaet"),
    ("zettel-m", "zettel-l", "Satisficing"),
    ("zettel-n", "zettel-l", "Verhandelte Ziele"),
    ("zettel-o", "zettel-n", "Slack Ressourcen"),
    ("zettel-p", "zettel-o", "Pufferung"),
    ("zettel-q", "zettel-p", "Technologie und Struktur"),
    ("zettel-r", "zettel-a", "Ressourcenabhaengigkeit"),
    ("zettel-s", "zettel-r", "Politische Koalitionen"),
    ("zettel-t", "zettel-s", "Institutionelle Mythen"),
    ("zettel-u", "zettel-t", "Isomorphismus"),
    ("zettel-v", "zettel-u", "Netzwerktheorie"),
    ("zettel-w", "zettel-v", "Schwache Bindungen"),
    ("zettel-x", "zettel-v", "Komplexitaet"),
    ("zettel-y", "zettel-x", "Emergenz"),
    ("zettel-z", "zettel-y", "Wissensmanagement"),
    ("zettel-aa", "zettel-z", "Tacit Knowledge"),
    ("zettel-ab", "zettel-aa", "Lernende Organisation"),
    ("zettel-ac", "zettel-ab", "Double-Loop"),
    ("zettel-ad", "zettel-ac", "Komplexitaetsfuehrung"),
    ("zettel-ae", "zettel-ad", "Adaptive Fuehrung"),
    ("zettel-af", "zettel-ae", "Servant Leadership"),
    ("zettel-ag", "zettel-af", "Transformational"),
    ("zettel-ah", "zettel-ag", "Transactional"),
    ("zettel-ai", "zettel-ah", "Situational"),
    ("zettel-aj", "zettel-ai", "Distributed"),
    ("zettel-ak", "zettel-aj", "Shared Leadership"),
    ("zettel-al", "zettel-ak", "Ethische Fuehrung"),
    ("zettel-am", "zettel-al", "Authentische Fuehrung"),
    ("zettel-an", "zettel-am", "Wicked Problems"),
    ("zettel-ao", "zettel-an", "VUCA"),
    ("zettel-ap", "zettel-ao", "Resilienz"),
    ("zettel-aq", "zettel-ap", "Antifragilitaet"),
    ("zettel-ar", "zettel-aq", "Agilitaet"),
    ("zettel-as", "zettel-ar", "Lean"),
    ("zettel-at", "zettel-as", "Design Thinking"),
    ("zettel-au", "zettel-at", "Systems Thinking"),
    ("zettel-av", "zettel-au", "Kybernetik"),
    ("zettel-aw", "zettel-av", "Second-Order"),
    ("zettel-ax", "zettel-aw", "Autopoiesis"),
    ("zettel-ay", "zettel-ax", "Strukturelle Kopplung"),
]

# Orphan zettel (no incoming links) for septic tank demo
ORPHAN = "zettel-orphan"


def create_seed_db(path, count, mode="luhmann"):
    """Create a seed database with `count` zettels."""
    path = Path(path)
    if path.exists():
        path.unlink()
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.executescript("""
        CREATE TABLE zettels (id TEXT PRIMARY KEY, path TEXT NOT NULL, body TEXT NOT NULL,
            zettel_type TEXT DEFAULT 'concept', training INTEGER DEFAULT 1, mode TEXT DEFAULT 'luhmann',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE cross_references (source_id TEXT NOT NULL, target_id TEXT NOT NULL,
            thematic_label TEXT NOT NULL, PRIMARY KEY (source_id, target_id, thematic_label));
        CREATE TABLE register_entries (keyword TEXT NOT NULL, zettel_id TEXT NOT NULL,
            priority_rank INTEGER DEFAULT 1, PRIMARY KEY (keyword, zettel_id));
    """)

    zettels = ZETTELS[:count]
    for zid, zpath, body, ztype in zettels:
        conn.execute("INSERT INTO zettels (id, path, body, zettel_type, training, mode) VALUES (?,?,?,?,1,?)",
                     (zid, zpath, body, ztype, mode))

    # Add orphan zettel for septic tank demo (only in level 2+)
    if count >= 10:
        conn.execute("INSERT INTO zettels (id, path, body, zettel_type, training, mode) VALUES (?,?,?,?,1,?)",
                     (ORPHAN, "/99/", "This zettel has no incoming links. It will be flagged by the septic tank.", "concept", mode))

    # Add links (only those where both source and target exist)
    existing = {z[0] for z in zettels}
    existing.add(ORPHAN)
    for src, tgt, label in LINKS:
        if src in existing and tgt in existing:
            conn.execute("INSERT OR IGNORE INTO cross_references (source_id, target_id, thematic_label) VALUES (?,?,?)",
                         (src, tgt, label))

    # Add register entries
    keywords = ["Authority", "Organization", "Leadership", "Knowledge", "Complexity"]
    for i, (zid, _, _, _) in enumerate(zettels[:len(keywords)]):
        conn.execute("INSERT OR IGNORE INTO register_entries (keyword, zettel_id, priority_rank) VALUES (?,?,?)",
                     (keywords[i % len(keywords)], zid, (i % 4) + 1))

    conn.commit()
    conn.close()
    print(f"Created seed db: {path} ({count} zettels + orphan)")


if __name__ == "__main__":
    # Generate seed dbs for levels 2, 3, 4
    create_seed_db(SEEDS_DIR / "level2-luhmann.db", 10, "luhmann")
    create_seed_db(SEEDS_DIR / "level3-luhmann.db", 20, "luhmann")
    create_seed_db(SEEDS_DIR / "level4-luhmann.db", 50, "luhmann")
    create_seed_db(SEEDS_DIR / "level2-semantic-hologram.db", 10, "semantic-hologram")
    create_seed_db(SEEDS_DIR / "level3-semantic-hologram.db", 20, "semantic-hologram")
    create_seed_db(SEEDS_DIR / "level4-semantic-hologram.db", 50, "semantic-hologram")
    print("All seed databases created.")
