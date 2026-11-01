#!/usr/bin/env python3
"""MCP server for the zk trainer.

Exposes session state, zettels, links, register, and events as JSON-RPC resources
over stdio. The trainer writes session state to ~/.zk_trainer/session.json and
the DB at ~/.zk_trainer/zk.db; this server reads from those directly so the AI
can observe a live training session.
"""
import json, sqlite3, sys, time
from pathlib import Path

DB_DIR = Path.home() / ".zk_trainer"
DB_PATH = DB_DIR / "zk.db"
SESSION_PATH = DB_DIR / "session.json"
CHAT_REQUEST_PATH = DB_DIR / "chat_request.json"
CHAT_RESPONSE_PATH = DB_DIR / "chat_response.txt"


def read_json(path, default=None):
    try:
        if path.exists():
            return json.loads(path.read_text())
    except Exception:
        pass
    return default


def get_conn():
    DB_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def resource_session():
    return read_json(SESSION_PATH, {"step": "intake", "dataset": 1, "completed": [], "notes": {}})


def resource_zettels():
    conn = get_conn()
    try:
        rows = conn.execute("SELECT * FROM zettels WHERE training = 1 ORDER BY id").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def resource_links():
    conn = get_conn()
    try:
        rows = conn.execute("SELECT * FROM cross_references ORDER BY source_id").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def resource_register():
    conn = get_conn()
    try:
        rows = conn.execute("SELECT * FROM register_entries ORDER BY keyword").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def resource_events():
    """Return chat events + recent activity as a list."""
    events = []
    cr = read_json(CHAT_REQUEST_PATH)
    if cr:
        events.append({"type": "chat_request", **cr})
    # Also read any recent events from session file
    sess = read_json(SESSION_PATH)
    if sess:
        events.append({"type": "session_snapshot", "step": sess.get("step"), "dataset": sess.get("dataset")})
    return events


RESOURCES = {
    "zk/session": resource_session,
    "zk/zettels": resource_zettels,
    "zk/links": resource_links,
    "zk/register": resource_register,
    "zk/events": resource_events,
    "zk/chat-request": lambda: read_json(CHAT_REQUEST_PATH, {}),
}


def handle_request(req):
    """Handle a JSON-RPC request."""
    method = req.get("method")
    params = req.get("params", {})
    rid = req.get("id")

    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": rid,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"resources": {}},
                "serverInfo": {"name": "zk-trainer", "version": "1.0.0"},
            },
        }

    if method == "resources/list":
        return {
            "jsonrpc": "2.0",
            "id": rid,
            "result": {
                "resources": [
                    {"uri": uri, "name": uri.replace("zk/", "").replace("-", " ").title()}
                    for uri in RESOURCES
                ]
            },
        }

    if method == "resources/read":
        uri = params.get("uri")
        if uri in RESOURCES:
            try:
                content = RESOURCES[uri]()
                return {"jsonrpc": "2.0", "id": rid, "result": {"contents": [{"uri": uri, "mimeType": "application/json", "text": json.dumps(content, indent=2)}]}}
            except Exception as e:
                return {"jsonrpc": "2.0", "id": rid, "error": {"code": -32603, "message": str(e)}}
        return {"jsonrpc": "2.0", "id": rid, "error": {"code": -32602, "message": f"Unknown resource: {uri}"}}

    return {"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": f"Unknown method: {method}"}}


def main():
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            continue
        resp = handle_request(req)
        sys.stdout.write(json.dumps(resp) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
