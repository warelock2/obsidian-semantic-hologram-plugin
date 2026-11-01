#!/usr/bin/env python3
"""SQLite database management for the zk trainer."""
import json, os, sqlite3, subprocess, sys
from pathlib import Path

DB_DIR = Path.home() / ".zk_trainer"
DB_PATH = DB_DIR / "zk.db"
JSON_DIR = DB_DIR / "json_records"
GIT_DIR = JSON_DIR  # Git repo lives in the same dir as the JSON files

def get_conn():
    DB_DIR.mkdir(parents=True, exist_ok=True)
    JSON_DIR.mkdir(parents=True, exist_ok=True)
    GIT_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn

def create_schema(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS zettels (
            id TEXT PRIMARY KEY,
            path TEXT NOT NULL,
            body TEXT NOT NULL,
            zettel_type TEXT DEFAULT 'concept',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS cross_references (
            source_id TEXT NOT NULL,
            target_id TEXT NOT NULL,
            thematic_label TEXT NOT NULL,
            PRIMARY KEY (source_id, target_id, thematic_label),
            FOREIGN KEY (source_id) REFERENCES zettels(id) ON DELETE CASCADE,
            FOREIGN KEY (target_id) REFERENCES zettels(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS register_entries (
            keyword TEXT NOT NULL,
            zettel_id TEXT NOT NULL,
            priority_rank INTEGER DEFAULT 1,
            PRIMARY KEY (keyword, zettel_id),
            FOREIGN KEY (zettel_id) REFERENCES zettels(id) ON DELETE CASCADE,
            CHECK (priority_rank BETWEEN 1 AND 4)
        );
        CREATE INDEX IF NOT EXISTS idx_zettels_path ON zettels(path);
        CREATE INDEX IF NOT EXISTS idx_cross_target ON cross_references(target_id);
        CREATE INDEX IF NOT EXISTS idx_register_keyword ON register_entries(keyword);
    """)
    conn.commit()

def reset_db(conn):
    conn.executescript("""
        DROP TABLE IF EXISTS register_entries;
        DROP TABLE IF EXISTS cross_references;
        DROP TABLE IF EXISTS zettels;
    """)
    create_schema(conn)
    conn.commit()

def add_zettel(conn, zettel_id, path, body, zettel_type="concept"):
    conn.execute(
        "INSERT OR REPLACE INTO zettels (id, path, body, zettel_type) VALUES (?, ?, ?, ?)",
        (zettel_id, path, body, zettel_type)
    )
    conn.commit()

def add_edge(conn, source_id, target_id, thematic_label):
    conn.execute(
        "INSERT OR REPLACE INTO cross_references (source_id, target_id, thematic_label) VALUES (?, ?, ?)",
        (source_id, target_id, thematic_label)
    )
    conn.commit()

def add_register(conn, keyword, zettel_id, priority_rank=1):
    conn.execute(
        "INSERT OR REPLACE INTO register_entries (keyword, zettel_id, priority_rank) VALUES (?, ?, ?)",
        (keyword, zettel_id, priority_rank)
    )
    conn.commit()

def dump_json(conn, out_dir=None):
    """Export all records as individual JSON files for Git sync."""
    out_dir = out_dir or JSON_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    for row in conn.execute("SELECT * FROM zettels"):
        r = dict(row)
        # Attach edges
        edges = conn.execute(
            "SELECT target_id, thematic_label FROM cross_references WHERE source_id = ?",
            (r["id"],)
        ).fetchall()
        r["edges"] = [dict(e) for e in edges]
        # Attach tags
        r["tags"] = []
        path = out_dir / f"{r['id']}.json"
        path.write_text(json.dumps(r, indent=2, ensure_ascii=False))

    # Export register
    reg = {}
    for row in conn.execute("SELECT * FROM register_entries"):
        r = dict(row)
        if r["keyword"] not in reg:
            reg[r["keyword"]] = []
        reg[r["keyword"]].append({"zettel_id": r["zettel_id"], "priority_rank": r["priority_rank"]})
    (out_dir / "_register.json").write_text(json.dumps(reg, indent=2, ensure_ascii=False))

def load_from_json(conn, in_dir=None):
    """Rebuild DB from JSON dump files."""
    in_dir = in_dir or JSON_DIR
    if not in_dir.exists():
        return False
    for path in in_dir.glob("*.json"):
        if path.name.startswith("_"):
            continue
        data = json.loads(path.read_text())
        add_zettel(conn, data["id"], data["path"], data["body"], data.get("zettel_type", "concept"))
        for edge in data.get("edges", []):
            add_edge(conn, data["id"], edge["target_id"], edge["thematic_label"])
    # Load register
    reg_path = in_dir / "_register.json"
    if reg_path.exists():
        reg = json.loads(reg_path.read_text())
        for keyword, entries in reg.items():
            for entry in entries:
                add_register(conn, keyword, entry["zettel_id"], entry.get("priority_rank", 1))
    return True

def git_commit(message):
    """Atomic git commit for the JSON dump."""
    try:
        r1 = subprocess.run(["git", "-C", str(GIT_DIR), "init"], capture_output=True, text=True)
        r2 = subprocess.run(["git", "-C", str(GIT_DIR), "add", "."], capture_output=True, text=True)
        r3 = subprocess.run(["git", "-C", str(GIT_DIR), "commit", "-m", message], capture_output=True, text=True)
    except Exception as e:
        print(f"Git error: {e}", flush=True)

def atomic_write_json(conn, zettel_id, message):
    """Write DB -> JSON -> Git as an atomic transaction."""
    dump_json(conn)
    git_commit(message)
