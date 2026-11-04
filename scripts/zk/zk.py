#!/usr/bin/env python3
"""zk — Zettelkasten Trainer CLI. Teaches Luhmann's system (1952) and Semantic Hologram (2026)."""
import argparse, json, os, sqlite3, subprocess, sys, time, shutil
from datetime import datetime
from pathlib import Path

BASE = Path(__file__).resolve().parent
TRAINING_DIR = BASE / "training"
DB_DIR = Path.home() / ".zk_trainer"
DB_PATH = DB_DIR / "zk.db"
JSON_DIR = DB_DIR / "json_records"
GIT_DIR = JSON_DIR
SESSION_PATH = DB_DIR / "session.json"
LOGS_DIR = BASE / "logs"
CHEAT_DIR = LOGS_DIR / "cheat-sheet"
SEEDS_DIR = BASE / "seeds"

sys.path.insert(0, str(BASE))
import session as sess_mod
from quotes import get_quote, get_sources, format_quote

_LOG_FILE = None
_MODE = "luhmann"
_NO_PAGER = False
_DEMO_MODE = False
_CURRENT_IDEAL = ""
_CURRENT_EXPECTED_PATH = ""
_CURRENT_EXPECTED_TARGET = "none"
_CURRENT_EXPECTED_LABEL = ""
_CURRENT_EXPECTED_KEYWORD = "Authority"
_CURRENT_EXPECTED_RANK = 1

PAGE_LINES = 24
SCREEN_WIDTH = 80


def set_mode(mode):
    global _MODE
    _MODE = mode


def get_mode():
    return _MODE

def set_no_pager(val):
    global _NO_PAGER
    _NO_PAGER = val

def set_demo(val):
    global _DEMO_MODE
    _DEMO_MODE = val

def get_demo():
    return _DEMO_MODE

def print_page(text):
    if _NO_PAGER:
        tprint(text)
        return
    lines = text.splitlines()
    for i in range(0, len(lines), PAGE_LINES):
        chunk = "\n".join(lines[i:i+PAGE_LINES])
        tprint(chunk)
        if i + PAGE_LINES < len(lines):
            ans = ask("-- More -- (Enter=continue, q=quit): ").strip()
            if ans.lower() == 'q':
                break


def tprint(msg=""):
    print(msg)
    if _LOG_FILE:
        _LOG_FILE.write(msg + "\n")
        _LOG_FILE.flush()


def ask(prompt):
    global _DEMO_MODE, _CURRENT_IDEAL, _CURRENT_EXPECTED_PATH, _CURRENT_EXPECTED_TARGET, _CURRENT_EXPECTED_LABEL, _CURRENT_EXPECTED_KEYWORD, _CURRENT_EXPECTED_RANK
    # Prefix interactive command prompts and logged instructions with `$ `
    prompt = f"$ {prompt}"
    sys.stdout.write(prompt)
    sys.stdout.flush()
    if _LOG_FILE:
        _LOG_FILE.write(prompt)
        _LOG_FILE.flush()
    
    if _DEMO_MODE:
        if "-- More --" in prompt:
            answer = ""
        elif "zettel body" in prompt:
            answer = _CURRENT_IDEAL or "Synthesized zettel body."
        elif "materialized path" in prompt or "Luhmann index" in prompt:
            answer = _CURRENT_EXPECTED_PATH or "/1/"
        elif "Target zettel ID" in prompt:
            answer = _CURRENT_EXPECTED_TARGET or "none"
        elif "Thematic link context" in prompt:
            answer = _CURRENT_EXPECTED_LABEL or "Informelle Widerstand"
        elif "Register keyword" in prompt:
            answer = _CURRENT_EXPECTED_KEYWORD or "Authority"
        elif "Priority rank" in prompt:
            answer = str(_CURRENT_EXPECTED_RANK or 1)
        elif "Source zettel" in prompt:
            answer = "zettel-1"
        elif "Target zettels" in prompt:
            answer = "zettel-b,zettel-c,zettel-d"
        elif "keyword to search" in prompt:
            answer = "Authority"
        else:
            answer = "resume"
    else:
        answer = input()

    print(answer)
    if _LOG_FILE:
        _LOG_FILE.write(answer + "\n")
        _LOG_FILE.flush()
    return answer


def open_log(path, level=1, mode="luhmann"):
    global _LOG_FILE
    if not path:
        return None
    if path is True:
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        path = LOGS_DIR / f"zk-trainer-level{level}-{mode}-{ts}.log"
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    _LOG_FILE = open(path, "w")
    tprint(f"Logging to: {path}")
    return _LOG_FILE


def close_log():
    global _LOG_FILE
    if _LOG_FILE:
        tprint("\n" + "=" * 60)
        tprint("SOURCES (for further research)")
        tprint("=" * 60)
        for title, url in get_sources(get_mode()):
            tprint(f"- {title}")
            if url:
                tprint(f"  {url}")
        tprint("")
        _LOG_FILE.close()
        _LOG_FILE = None


def chat_break():
    tprint("\n" + "═" * 60)
    tprint("CHAT MODE — AI is listening")
    tprint("═" * 60)
    req_path = DB_DIR / "chat_request.json"
    DB_DIR.mkdir(parents=True, exist_ok=True)
    import json as _json
    req_path.write_text(_json.dumps({
        "timestamp": datetime.now().isoformat(),
        "step": sess_mod.load_session().get("step", "?"),
        "dataset": sess_mod.load_session().get("dataset", "?"),
        "question": None,
    }, indent=2))

    tprint("Type your question (or 'resume' to continue, 'quit' to abort):")
    while True:
        ans = ask("> ").strip()
        if ans.lower() == "resume":
            req_path.unlink(missing_ok=True)
            (DB_DIR / "chat_response.txt").unlink(missing_ok=True)
            tprint("Resuming training...\n")
            return True
        if ans.lower() == "quit":
            tprint("Aborting session.")
            req_path.unlink(missing_ok=True)
            (DB_DIR / "chat_response.txt").unlink(missing_ok=True)
            return False
        req_path.write_text(_json.dumps({
            "timestamp": datetime.now().isoformat(),
            "step": sess_mod.load_session().get("step", "?"),
            "dataset": sess_mod.load_session().get("dataset", "?"),
            "question": ans,
        }, indent=2))
        tprint("Waiting for AI response...")
        resp_path = DB_DIR / "chat_response.txt"
        waited = 0
        while waited < 60:
            if resp_path.exists():
                response = resp_path.read_text()
                resp_path.unlink()
                tprint("\n--- AI Response ---")
                tprint(response)
                tprint("--- End Response ---\n")
                break
            time.sleep(2)
            waited += 2
        else:
            tprint("Timeout waiting for response. Type 'resume' to continue.")
        tprint("Type another question, 'resume' to continue, or 'quit' to abort:")


def handle_chat_input(val):
    if val.strip() == "?":
        if not chat_break():
            return True
        return True
    if val.strip().startswith("? "):
        q = val.strip()[2:]
        req_path = DB_DIR / "chat_request.json"
        DB_DIR.mkdir(parents=True, exist_ok=True)
        import json as _json
        req_path.write_text(_json.dumps({
            "timestamp": datetime.now().isoformat(),
            "step": sess_mod.load_session().get("step", "?"),
            "dataset": sess_mod.load_session().get("dataset", "?"),
            "question": q,
        }, indent=2))
        tprint("Waiting for AI response...")
        resp_path = DB_DIR / "chat_response.txt"
        waited = 0
        while waited < 60:
            if resp_path.exists():
                response = resp_path.read_text()
                resp_path.unlink()
                tprint("\n--- AI Response ---")
                tprint(response)
                tprint("--- End Response ---\n")
                break
            time.sleep(2)
            waited += 2
        else:
            tprint("Timeout waiting for response.")
        while True:
            ans = ask("Type 'resume' to continue, or ask another question: ").strip()
            if ans.lower() == "resume":
                req_path.unlink(missing_ok=True)
                tprint("Resuming training...\n")
                return True
            if ans.lower() == "quit":
                tprint("Aborting session.")
                return True
            req_path.write_text(_json.dumps({
                "timestamp": datetime.now().isoformat(),
                "step": sess_mod.load_session().get("step", "?"),
                "dataset": sess_mod.load_session().get("dataset", "?"),
                "question": ans,
            }, indent=2))
            tprint("Waiting for AI response...")
            waited = 0
            while waited < 60:
                if resp_path.exists():
                    response = resp_path.read_text()
                    resp_path.unlink()
                    tprint("\n--- AI Response ---")
                    tprint(response)
                    tprint("--- End Response ---\n")
                    break
                time.sleep(2)
                waited += 2
            else:
                tprint("Timeout waiting for response.")
    return False


def get_conn():
    DB_DIR.mkdir(parents=True, exist_ok=True)
    JSON_DIR.mkdir(parents=True, exist_ok=True)
    GIT_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


SCHEMA = """
CREATE TABLE IF NOT EXISTS zettels (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    body TEXT NOT NULL,
    zettel_type TEXT DEFAULT 'concept',
    training INTEGER DEFAULT 0,
    mode TEXT DEFAULT 'luhmann',
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
"""


def init_db():
    conn = get_conn()
    conn.executescript(SCHEMA)
    for col in ["training INTEGER DEFAULT 0", "mode TEXT DEFAULT 'luhmann'"]:
        try:
            conn.execute(f"ALTER TABLE zettels ADD COLUMN {col}")
        except sqlite3.OperationalError:
            pass
    conn.commit()
    return conn


def git_commit(message):
    try:
        subprocess.run(["git", "-C", str(GIT_DIR), "init"], check=False, capture_output=True)
        subprocess.run(["git", "-C", str(GIT_DIR), "add", "."], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(GIT_DIR), "commit", "-m", message], check=True, capture_output=True)
    except subprocess.CalledProcessError:
        pass


def atomic_write_json(conn, zettel_id, message):
    row = conn.execute("SELECT * FROM zettels WHERE id = ?", (zettel_id,)).fetchone()
    if row:
        data = dict(row)
        edges = conn.execute(
            "SELECT target_id, thematic_label FROM cross_references WHERE source_id = ?",
            (zettel_id,)
        ).fetchall()
        data["edges"] = [dict(e) for e in edges]
        JSON_DIR.mkdir(parents=True, exist_ok=True)
        path = JSON_DIR / f"{zettel_id}.json"
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False))
        tmp.replace(path)
    git_commit(message)


INTAKE_TEXTS = {
    1: {
        "title": "Intake: Organizational Authority",
        "text": "Simon's theory of organizational authority posits that an individual's acceptance of authority is a function of their 'zone of indifference'—the range of decisions they accept without question. When an order falls outside this zone, the individual must either comply out of fear or reject it. Parsons adds that authority is not just about power but about the internalization of norms; the subordinate accepts the superior's decision because they believe the superior has the right to make it. However, this creates a paradox: authority requires the subordinate to surrender autonomy, yet the subordinate must retain enough autonomy to 'choose' to comply. If compliance is forced, it is no longer authority but coercion.",
        "ideal": "Authority in organizations depends on the subordinate zone of indifference. Beyond this zone compliance becomes coerced not authorized. Parsons adds that authority requires internalization of norms not just power. The paradox authority requires surrendering autonomy yet the subordinate must retain autonomy to choose compliance. If forced it ceases to be authority and becomes coercion.",
        "citekey": "Simon1947",
        "hint": "Focus on the paradox of authority: it requires both autonomy and its surrender.",
    },
    2: {
        "title": "Linking: Incentives and Compliance",
        "text": "Barnard's theory of incentives emphasizes that organizational compliance is maintained through a system of inducements. When an order falls outside the 'zone of indifference,' the organization must offer sufficient incentives (material, social, or personal) to secure cooperation. This suggests that authority is not a static property of a position but a dynamic equilibrium between the demands of the system and the inducements offered to the participant. Without adequate incentives, the 'zone of indifference' shrinks to zero, and the system must rely on coercion.",
        "ideal": "Barnard incentive theory complements Simon zone of indifference. When orders fall outside the zone organizations must offer inducements to maintain compliance. Authority is a dynamic equilibrium between system demands and participant incentives not a static positional property. Without sufficient incentives the zone of indifference collapses to zero.",
        "citekey": "Barnard1938",
        "hint": "Focus on how incentives relate to the 'zone of indifference' from your first note.",
    },
    3: {
        "title": "Query: Informal Resistance",
        "text": "Roethlisberger and Dickson's Hawthorne studies revealed that informal groups within organizations develop their own norms and resistances that override formal authority. Workers' output was not determined by managerial incentives or positional authority, but by the unwritten codes of their peer groups. This suggests that the 'zone of indifference' is not just an individual psychological threshold but a socially constructed boundary maintained by group norms. Formal authority exists only insofar as informal groups permit it.",
        "ideal": "Roethlisberger and Dickson Hawthorne studies complicate both Simon and Barnard. Informal peer groups develop norms that override formal authority. Output is determined by group codes not managerial incentives. The zone of indifference is socially constructed not individually psychological. Formal authority exists only where informal groups permit it.",
        "citekey": "Roethlisberger1939",
        "hint": "Focus on how informal groups limit or redefine formal authority.",
    },
}


def render_ascii_zettel(zettel_id, path, body, citekey=None):
    mode = get_mode()
    # No outline borders — clean plain text to eliminate alignment issues
    inner = 74
    tprint(f"ZETTEL: {zettel_id}")
    if mode != 'luhmann':
        tprint(f"PATH:   {path}")
    if citekey:
        tprint(f"CITE:   {citekey}")
    words = body.split()
    line = ""
    for w in words:
        next_line = (line + " " + w).strip() if line else w
        if len(next_line) <= inner:
            line = next_line
        else:
            tprint("  " + line)
            line = w
    if line:
        tprint("  " + line)


def show_quote(key):
    q = format_quote(key, get_mode())
    if q:
        tprint(q)


def cmd_intake(args):
    global _CURRENT_IDEAL
    conn = init_db()
    state = sess_mod.load_session()
    if state["step"] != "intake":
        tprint(f"Error: Current step is '{state['step']}'. Complete it first.")
        return

    ds = state["dataset"]
    data = INTAKE_TEXTS.get(ds)
    if not data:
        tprint("No more datasets. Run 'zk trainer reset' to replay.")
        return

    _CURRENT_IDEAL = data['ideal']
    mode = get_mode()
    tprint(f"\n=== {data['title']} ===")
    tprint("\nYou are Niklas Luhmann, researcher at your desk.")
    tprint("You sit down with a book. You are reading with an open, receptive mind,")
    tprint("letting the text provoke friction, surprise, or new questions.")
    tprint("You take out a blank slip of paper and a pencil.")
    tprint("\n--- Contemplation ---")
    tprint("As you read, you encounter a passage that captures a core truth or paradox.")
    tprint("You ask yourself: 'What is the single atomic idea here that I must capture'")
    tprint("in my own words, so it becomes part of my permanent thinking engine?'")
    
    tprint(f"\nPrompt: Read the source text below.")
    tprint(f"\nText:\n{data['text']}")
    tprint(f"\nHint: {data['hint']}")
    
    tprint(f"\nTo capture this as your first draft on paper, type these exact words:")
    tprint(f"> \033[30;107m{data['ideal']}\033[0m")
    show_quote("intake")

    while True:
        tprint("[Why: The zettel must be atomic to pass verification.]")
        tprint(f"[What to type: \033[30;107m{data['ideal']}\033[0m]")
        tprint("[Expected: '✓ Zettel created' with word count.]")
        body = ask("\nEnter your synthesized zettel body: ").strip()
        if handle_chat_input(body):
            continue
        if body != data['ideal']:
            tprint(f"Error: Mismatch. Type the exact text:\n> {data['ideal']}")
            continue
        break

    zettel_id = f"zettel-{ds}"
    path = f"/{ds}/"
    conn.execute(
        "INSERT OR REPLACE INTO zettels (id, path, body, zettel_type, training, mode) VALUES (?, ?, ?, ?, ?, ?)",
        (zettel_id, path, body, "concept", 1, mode)
    )
    conn.commit()

    state["notes"][zettel_id] = {"body": body, "citekey": data["citekey"]}
    sess_mod.save_session(state)

    atomic_write_json(conn, zettel_id, f"Intake: {zettel_id}")
    conn.close()

    tprint(f"\n✓ Zettel '{zettel_id}' created. Body: {len(body.split())} words.")
    tprint("\nZETTEL SLIP:")
    tprint("")
    tprint("─" * 40)
    render_ascii_zettel(zettel_id, path, body, data.get('citekey'))
    tprint("─" * 40)
    tprint("")

    tprint("Commands used (without trainer):")
    tprint("  zk add \"<body>\"  → creates zettel; zk file <id> <path>→assigns path manually")
    tprint("Run 'zk trainer nextstep' to advance to Filing.")
    ask("\nThis section is done. Press enter to continue: ")


def cmd_filing(args):
    global _CURRENT_EXPECTED_PATH
    conn = init_db()
    state = sess_mod.load_session()
    if state["step"] != "filing":
        tprint(f"Error: Current step is '{state['step']}'. Complete it first.")
        return

    ds = state["dataset"]
    zettel_id = f"zettel-{ds}"
    note = state["notes"].get(zettel_id)
    if not note:
        tprint("Error: No zettel found. Run 'zk trainer intake' first.")
        return

    mode = get_mode()
    tprint(f"\n{'=' * 60}")
    tprint(f"  STEP 2: FILING (Folgezettel Placement) — Dataset {ds}")
    tprint(f"{'=' * 60}")
    tprint("\nYou hold the fresh slip of paper in your hand.")
    tprint("You ask yourself: 'Where does this slip belong in my wooden box?'")
    tprint("Luhmann did not use top-down folders. Instead, he placed each new note")
    tprint("radially — physically adjacent to its closest conceptual neighbor.")
    tprint("If expanding a thought, he gave it a branch address (Folgezettel, e.g. 1a1).")
    
    tprint(f"\nBEFORE (Blank address):")
    tprint("")
    tprint("─" * 40)
    render_ascii_zettel(zettel_id, "", note['body'], note.get('citekey'))
    tprint("─" * 40)
    tprint("")
    
    tprint(f"Body: {note['body'][:100]}...")

    rows = conn.execute("SELECT id, path FROM zettels WHERE training=1 ORDER BY path").fetchall()
    if rows:
        tprint("\nExisting zettels:")
        for r in rows:
            if mode == 'luhmann':
                # In Luhmann mode show only zettel IDs; materialized paths hidden
                tprint(f"  {r['id']}")
            else:
                tprint(f"  {r['id']}  ({r['path']})")

    # Luhmann index / materialized path derived from dataset
    luhmann_index = f"{ds}" if ds == 1 else (f"1{chr(96+ds)}{ds}" if ds <= 3 else f"1a{ds}")
    expected_path = "/" + f"{ds}/" if ds == 1 else ("/1/a/" if ds == 2 else "/1/a/1/")
    
    tprint("\n--- Contemplation ---")
    tprint("You ask yourself: 'What is the address of this slip?'")
    tprint("You write the index at the top of the slip — this is its permanent home.")
    tprint("The address encodes where it sits in relation to its neighbors.")
    tprint("Luhmann never renumbered; the address is fixed forever.")

    if mode == 'luhmann':
        tprint(f"\nLuhmann Index:")
        tprint(f"> \033[30;107m{luhmann_index}\033[0m")
        _CURRENT_EXPECTED_PATH = luhmann_index
        prompt_text = f"\nEnter the Luhmann index (e.g., {luhmann_index}): "
    else:
        tprint(f"\nMaterialized path:")
        tprint(f"> \033[30;107m{expected_path}\033[0m")
        _CURRENT_EXPECTED_PATH = expected_path
        prompt_text = f"\nEnter the materialized path (e.g., {expected_path}): "
    
    show_quote("filing")

    while True:
        tprint("[Why: Filing assigns a materialized path derived from the Luhmann index.]")
        tprint("[What to type the Luhmann index:]")
        tprint(f"\033[30;107m{luhmann_index}\033[0m")
        tprint(f"[Expected result: Zettel filed with index mapped to /{ds}/ (internal storage).]")
        path_input = ask(prompt_text).strip()
        if handle_chat_input(path_input):
            continue
        
        # In luhmann mode, we expect the index, map it to the path for storage
        if mode == 'luhmann':
            if path_input != luhmann_index:
                tprint(f"Error: Mismatch. Type the exact Luhmann index:\n> {luhmann_index}")
                continue
            path = expected_path
        else:
            if not path_input.startswith("/"):
                path_input = "/" + path_input
            if path_input != expected_path:
                tprint(f"Error: Mismatch. Type the exact path:\n> {expected_path}")
                continue
            path = path_input
        break

    conn.execute("UPDATE zettels SET path = ? WHERE id = ?", (path, zettel_id))
    conn.commit()

    state["notes"][zettel_id]["path"] = path
    sess_mod.save_session(state)

    atomic_write_json(conn, zettel_id, f"Filing: {zettel_id} -> {path}")
    conn.close()

    if mode == 'luhmann':
        tprint(f"\n✓ Zettel '{zettel_id}' filed with Luhmann index: {luhmann_index}.")
    else:
        tprint(f"\n✓ Zettel '{zettel_id}' filed at path '{path}'.")
    
    tprint("\n--- Contemplation ---")
    tprint("You now write the index at the top of the slip and place it in the box.")
    tprint("The address is permanent: you will never renumber or move this slip.")
    tprint("Structure emerges from where slips sit next to each other, not from folders.")
    
    tprint("\nAFTER (Filed slip with address written at top):")
    tprint("")
    tprint("─" * 40)
    render_ascii_zettel(zettel_id, path, note['body'], note.get('citekey'))
    tprint("─" * 40)
    tprint("")
    
    tprint("Commands used (without trainer):")
    tprint("  zk file zettel-N <path>  → files zettel; zk add \"<body>\" → creates it")
    if ds > 1:
        tprint("Run 'zk trainer nextstep' to advance to Linking.")
    else:
        tprint("Run 'zk trainer nextstep' to advance to Query.")
    ask("\nThis section is done. Press enter to continue: ")


def cmd_link(args):
    global _CURRENT_EXPECTED_TARGET, _CURRENT_EXPECTED_LABEL
    conn = init_db()
    state = sess_mod.load_session()
    if state["step"] != "linking":
        tprint(f"Error: Current step is '{state['step']}'. Complete it first.")
        return

    ds = state["dataset"]
    zettel_id = f"zettel-{ds}"
    note = state["notes"].get(zettel_id)
    if not note:
        tprint("Error: No zettel found. Run 'zk trainer intake' first.")
        return

    mode = get_mode()

    expected_target = "zettel-1" if ds > 1 else "none"
    expected_label = "Grenze des Gehorsams" if ds == 2 else ("Informelle Widerstand" if ds == 3 else "")
    _CURRENT_EXPECTED_TARGET = expected_target
    _CURRENT_EXPECTED_LABEL = expected_label

    tprint(f"\n{'=' * 60}")
    tprint(f"  STEP 3: LINKING (Verweisungstechnik) — Dataset {ds}")
    tprint(f"{'=' * 60}")
    tprint(f"\nYou hold two slips of paper: the new {zettel_id} and a prior note.")
    tprint("You ask yourself: 'How does this new thought relate to what I already know?'")
    tprint("Luhmann bridged distant branches with cross-references (vgl.), and crucially,")
    tprint("he attached a mandatory thematic context — 2-5 words explaining *why* the link exists.")
    tprint("A bare link is just a pointer; a justified link creates knowledge.")
    
    tprint(f"\nYour zettel: {note['body'][:100]}...")

    rows = conn.execute("SELECT id, path FROM zettels WHERE training=1 AND id != ? ORDER BY path", (zettel_id,)).fetchall()
    if rows:
        tprint("\nAvailable targets:")
        for r in rows:
            if mode == 'luhmann':
                tprint(f"  {r['id']}")
            else:
                tprint(f"  {r['id']}  ({r['path']})")

    if ds > 1:
        tprint("\n--- Contemplation ---")
        tprint("You ask yourself: 'Which existing slip does this new slip belong next to?'")
        tprint("You place your finger on the target zettel and write the cross-reference.")
        tprint("But you don't stop there — you must justify *why* you connect them.")
        tprint("You type the target ID and then a 2-5 word thematic context label.")
    
    if ds > 1:
        tprint(f"\nType this exact target ID:\n> \033[30;107m{expected_target}\033[0m")
        tprint(f"Type this exact context label:\n> \033[30;107m{expected_label}\033[0m")
    show_quote("linking")

    if ds == 1:
        tprint("\nAs this is your first zettel, there are no existing targets to link to.")
        tprint("Type 'none' to skip linking for now.")
    elif ds in (2, 3):
        tprint(f"\nType 'zettel-1' to link to your first note.")

    while True:
        tprint("[Why: Radial linking connects this zettel to a previous one; target must exist.]")
        if ds == 1:
            tprint("[What to type to skip linking:]")
            tprint(f"\033[30;107mnone\033[0m")
        else:
            tprint("[What to type target ID:]")
            tprint(f"\033[30;107m{expected_target}\033[0m")
        tprint("[Expected result: '✓ Linked ... :: label' or 'Skipped linking'.]")
        target = ask("\nTarget zettel ID (or 'none' to skip): ").strip()
        if handle_chat_input(target):
            continue
        if target != expected_target:
            tprint(f"Error: Mismatch. Type exact target:\n> {expected_target}")
            continue
        break

    if target.lower() == "none":
        state["notes"][zettel_id]["edges"] = state["notes"][zettel_id].get("edges", [])
        sess_mod.save_session(state)
        tprint("Commands used (without trainer):")
        tprint("  zk link <source> <target> <context> → creates link with label")
        tprint("Skipped linking (no edges). Run 'zk trainer nextstep' to advance to Query.")
        return

    target_row = conn.execute("SELECT id FROM zettels WHERE id = ?", (target,)).fetchone()
    if not target_row:
        tprint(f"Error: Target '{target}' not found.")
        return

    expected_label = "Grenze des Gehorsams" if ds == 2 else ("Informelle Widerstand" if ds == 3 else "")
    if expected_label:
        tprint(f"\nType this exact context label:\n> {expected_label}")
    show_quote("linking")

    while True:
        tprint("[Why: Link context justifies the connection (Luhmann's mandatory justification).]")
        tprint("[What to type thematic link context:]")
        tprint(f"\033[30;107m{expected_label}\033[0m")
        tprint("[Expected result: '✓ Linked ... :: label'.]")
        label = ask("Thematic link context (2-5 words): ").strip()
        if handle_chat_input(label):
            continue
        if expected_label and label != expected_label:
            tprint(f"Error: Mismatch. Type exact label:\n> {expected_label}")
            continue
        if not label or len(label.split()) < 2:
            tprint("Error: Link context must be at least 2 words.")
            continue
        break

    conn.execute(
        "INSERT OR REPLACE INTO cross_references (source_id, target_id, thematic_label) VALUES (?, ?, ?)",
        (zettel_id, target, label)
    )
    conn.commit()

    state["notes"][zettel_id]["edges"] = state["notes"][zettel_id].get("edges", [])
    state["notes"][zettel_id]["edges"].append({"target_id": target, "thematic_label": label})
    sess_mod.save_session(state)

    atomic_write_json(conn, zettel_id, f"Link: {zettel_id} -> {target} :: {label}")
    conn.close()

    tprint(f"\n✓ Linked '{zettel_id}' -> '{target}' :: '{label}'.")
    
    tprint("\n--- Contemplation ---")
    tprint("You now have two slips in conversation with each other.")
    tprint("Knowledge is created not by the slip itself, but by the link between slips.")
    tprint("Luhmann called his Zettelkasten his 'communication partner' — the links are where thinking happens.")

    tprint("Commands used (without trainer):")
    tprint("  zk link <source> <target-id> \"label\"  → target = existing zettel ID (e.g., zettel-1)")
    tprint("Run 'zk trainer nextstep' to advance to Query.")
    ask("\nThis section is done. Press enter to continue: ")


def cmd_query(args):
    global _CURRENT_EXPECTED_KEYWORD, _CURRENT_EXPECTED_RANK
    conn = init_db()
    state = sess_mod.load_session()
    if state["step"] != "query":
        tprint(f"Error: Current step is '{state['step']}'. Complete it first.")
        return

    ds = state["dataset"]
    zettel_id = f"zettel-{ds}"
    note = state["notes"].get(zettel_id)
    if not note:
        tprint("Error: No zettel found. Run 'zk trainer intake' first.")
        return

    mode = get_mode()

    tprint(f"\n{'=' * 60}")
    tprint(f"  STEP 4: QUERY (The Register / Abt. 4) — Dataset {ds}")
    tprint(f"{'=' * 60}")
    tprint(f"\nYou step back from your wooden box and look at the whole system.")
    tprint("You ask yourself: 'Given a keyword, which central entry-point slips does this point to?'")
    tprint("Luhmann's Register was not an exhaustive Google-style index — it pointed to only")
    tprint("1-4 curated entry-point zettels per keyword, acting like a directory of starting points.")
    
    tprint(f"\nYour zettel: {note['body'][:100]}...")

    rows = conn.execute("SELECT * FROM register_entries ORDER BY keyword").fetchall()
    if rows:
        tprint("\nCurrent Register:")
        for r in rows:
            tprint(f"  {r['keyword']}: {r['zettel_id']} (rank {r['priority_rank']})")

    expected_keyword = "Authority"
    expected_rank = ds
    _CURRENT_EXPECTED_KEYWORD = expected_keyword
    _CURRENT_EXPECTED_RANK = expected_rank

    tprint("\n--- Contemplation ---")
    tprint("You consult your index box: which slips are central to 'Authority'?")
    tprint("You register your new slip as an entry point with a priority rank.")
    tprint("The register is curated — only the most important entry points per keyword.")

    tprint(f"\nType this exact keyword:")
    tprint(f"> \033[30;107m{expected_keyword}\033[0m")
    tprint(f"Type this exact priority rank:")
    tprint(f"> \033[30;107m{expected_rank}\033[0m")
    show_quote("query")

    while True:
        tprint("[Why: Register is a curated entry point, not an exhaustive index (max 4 per keyword).]")
        tprint("[What to type register keyword:]")
        tprint(f"\033[30;107m{expected_keyword}\033[0m")
        tprint("[Expected result: Registered under keyword with assigned priority rank.]")
        keyword = ask("\nRegister keyword: ").strip()
        if handle_chat_input(keyword):
            continue
        if keyword != expected_keyword:
            tprint(f"Error: Mismatch. Type exact keyword:\n> {expected_keyword}")
            continue
        break

    while True:
        tprint("[Why: Priority rank orders the 1-4 register entries (derived from dataset sequence).]")
        tprint("[What to type priority rank:]")
        tprint(f"\033[30;107m{expected_rank}\033[0m")
        tprint("[Expected result: '✓ Registered ... (rank N)'.]")
        rank_str = ask("Priority rank (1-4): ").strip()
        if handle_chat_input(rank_str):
            continue
        try:
            rank = int(rank_str)
            if rank != expected_rank or rank < 1 or rank > 4:
                tprint(f"Error: Mismatch. Type exact rank:\n> {expected_rank}")
                continue
            break
        except ValueError:
            tprint("Error: Rank must be an integer 1-4.")

    conn.execute(
        "INSERT OR REPLACE INTO register_entries (keyword, zettel_id, priority_rank) VALUES (?, ?, ?)",
        (keyword, zettel_id, rank)
    )
    conn.commit()

    state["notes"][zettel_id]["register"] = {"keyword": keyword, "rank": rank}
    sess_mod.save_session(state)

    atomic_write_json(conn, zettel_id, f"Query: {zettel_id} -> register '{keyword}' rank {rank}")
    conn.close()

    tprint(f"\n✓ Registered '{zettel_id}' under '{keyword}' (rank {rank}).")
    
    tprint("\n--- Contemplation ---")
    tprint("Your slip is now a curated entry point in the Register box.")
    tprint("You can find this thought again by keyword — the Register is your directory.")
    tprint("Like Luhmann's 'communication partner,' the box now helps you compose original thought.")

    tprint("Commands used (without trainer):")
    tprint("  zk register <keyword> <zettel-id> → adds curated register entry; query traverses graph")
    tprint("Run 'zk trainer nextstep' to complete this dataset.")
    ask("\nThis section is done. Press enter to continue: ")


def cmd_nextstep(args):
    state = sess_mod.load_session()
    step = state["step"]

    if step == "done":
        tprint("Dataset complete! Run 'zk trainer reset' to replay.")
        return

    zettel_id = f"zettel-{state['dataset']}"
    note = state["notes"].get(zettel_id, {})

    if step == "intake" and "body" not in note:
        tprint("Error: Complete intake first (run 'zk trainer intake').")
        return
    if step == "filing" and "path" not in note:
        tprint("Error: Complete filing first (run 'zk trainer filing').")
        return
    if step == "linking" and "edges" not in note:
        tprint("Error: Complete linking first (run 'zk trainer link').")
        return
    if step == "query" and "register" not in note:
        tprint("Error: Complete query first (run 'zk trainer query').")
        return

    sess_mod.advance_step(state, step)
    new_step = state["step"]

    if new_step == "done":
        tprint(f"\n✓ Dataset {state['dataset']} complete!")
        next_ds = state["dataset"] + 1
        matches = list(TRAINING_DIR.glob(f"{next_ds:02d}_*.json"))
        if matches:
            state["dataset"] = next_ds
            state["step"] = "intake"
            sess_mod.save_session(state)
            tprint(f"Dataset {next_ds} is ready. Run 'zk trainer intake' to begin.")
        else:
            tprint("No more datasets. Run 'zk trainer reset' to replay.")
    else:
        tprint(f"\n✓ Advanced to: {new_step}")


def cmd_status(args):
    state = sess_mod.load_session()
    conn = init_db()
    tprint(f"\n=== Zettelkasten Trainer Status ===")
    tprint(f"Mode: {get_mode()}")
    tprint(f"Dataset: {state['dataset']}")
    tprint(f"Step: {state['step']}")
    tprint(f"Completed: {len(state['completed'])} steps")
    tprint(f"Notes created: {len(state['notes'])}")
    for nid, data in state["notes"].items():
        tprint(f"  {nid}: {len(data.get('body', '').split())} words, path={data.get('path', '?')}")
    conn.close()


def cmd_reset(args):
    state = sess_mod.reset_session()
    conn = init_db()
    conn.execute("DELETE FROM register_entries WHERE zettel_id IN (SELECT id FROM zettels WHERE training = 1)")
    conn.execute("DELETE FROM cross_references WHERE source_id IN (SELECT id FROM zettels WHERE training = 1) OR target_id IN (SELECT id FROM zettels WHERE training = 1)")
    conn.execute("DELETE FROM zettels WHERE training = 1")
    conn.commit()
    conn.close()
    tprint("Training session reset. Run 'zk trainer intake' to begin.")


def cmd_mcp(args):
    if args.mcp_command == "start":
        tprint("Starting MCP server...")
        (DB_DIR / "mcp_status.txt").write_text("running")
        tprint("MCP server started. Configure in opencode.json to connect.")
    elif args.mcp_command == "stop":
        (DB_DIR / "mcp_status.txt").write_text("stopped")
        tprint("MCP server stopped.")
    elif args.mcp_command == "status":
        status_file = DB_DIR / "mcp_status.txt"
        status = status_file.read_text().strip() if status_file.exists() else "unknown"
        tprint(f"MCP server status: {status}")


def cmd_add(args):
    conn = init_db()
    body = args.body
    import uuid
    zettel_id = f"zettel-{uuid.uuid4().hex[:8]}"
    conn.execute(
        "INSERT INTO zettels (id, path, body, zettel_type, training, mode) VALUES (?, ?, ?, ?, ?, ?)",
        (zettel_id, "/", body, "concept", 0, get_mode())
    )
    conn.commit()
    atomic_write_json(conn, zettel_id, f"Add: {zettel_id}")
    conn.close()
    tprint(f"✓ Created {zettel_id}")


def cmd_file(args):
    conn = init_db()
    conn.execute("UPDATE zettels SET path = ? WHERE id = ?", (args.path, args.id))
    conn.commit()
    atomic_write_json(conn, args.id, f"File: {args.id} -> {args.path}")
    conn.close()
    tprint(f"✓ Filed {args.id} at {args.path}")


def cmd_link_scratch(args):
    conn = init_db()
    conn.execute(
        "INSERT OR REPLACE INTO cross_references (source_id, target_id, thematic_label) VALUES (?, ?, ?)",
        (args.source, args.target, args.context)
    )
    conn.commit()
    atomic_write_json(conn, args.source, f"Link: {args.source} -> {args.target} :: {args.context}")
    conn.close()
    tprint(f"✓ Linked {args.source} -> {args.target} :: {args.context}")


def cmd_register_scratch(args):
    conn = init_db()
    conn.execute(
        "INSERT OR REPLACE INTO register_entries (keyword, zettel_id, priority_rank) VALUES (?, ?, ?)",
        (args.keyword, args.id, args.rank)
    )
    conn.commit()
    conn.close()
    tprint(f"✓ Registered {args.id} under '{args.keyword}' (rank {args.rank})")


def cmd_query_scratch(args):
    conn = init_db()
    entries = conn.execute(
        "SELECT zettel_id, priority_rank FROM register_entries WHERE keyword = ?", (args.question,)
    ).fetchall()
    if not entries:
        # Try full-text search
        entries = conn.execute(
            "SELECT id as zettel_id, 1 as priority_rank FROM zettels WHERE body LIKE ?",
            (f"%{args.question}%",)
        ).fetchall()
    if not entries:
        tprint(f"No results for '{args.question}'")
        return
    tprint(f"\nQuery: {args.question}")
    for e in entries:
        tprint(f"\n  Entry: {e['zettel_id']} (rank {e['priority_rank']})")
        z = conn.execute("SELECT body, path FROM zettels WHERE id = ?", (e['zettel_id'],)).fetchone()
        if z:
            tprint(f"  Path: {z['path']}")
            tprint(f"  Body: {z['body'][:100]}...")
        links = conn.execute(
            "SELECT target_id, thematic_label FROM cross_references WHERE source_id = ?", (e['zettel_id'],)
        ).fetchall()
        for l in links:
            tprint(f"    -> {l['target_id']} :: {l['thematic_label']}")
    conn.close()


def cmd_orientation(args):
    tprint("\n" + "=" * 60)
    tprint("  ZK Trainer — Orientation")
    tprint("=" * 60)
    tprint("\n[1/3] THE LUHMANN FOUNDATION")
    tprint("Niklas Luhmann (1927-1998) worked on his Zettelkasten for over 40 years.")
    tprint("It grew to over 73,000 notes and served as the communication partner")
    tprint("that allowed him to produce over 40 books and hundreds of papers.")
    tprint("He did not just 'organize' knowledge; he built a hypermedia thinking engine.")

    tprint("\n[2/3] SYSTEM & PURPOSE")
    tprint("This is an advanced note-taking system. Luhmann created the Zettelkasten")
    tprint("not as a file cabinet, but to manage complexity and handle the paradoxes")
    tprint("of social systems. It captures interrelated concepts in a 'second brain'")
    tprint("that works through associative memory.")
    tprint("Our software translates his physical workflows (Intake, Filing, Linking,")
    tprint("Query) into a digital graph, turning your notes into a collaborative")
    tprint("partner that helps you compose original thought.")
    tprint("Linking connects one zettel to another by its zettel-ID (e.g., zettel-1).")

    tprint("\n[3/3] GETTING STARTED")
    tprint("To begin interactively:  'python3 scripts/zk/zk.py trainer level1'")
    tprint("(Omit --demo until you want to observe a replay; --demo feeds pre-canned")
    tprint("answers and creates the reference 'cheat-sheet' logs automatically.)")
    tprint("If you get stuck, the trainer guides you. You can also view previous")
    tprint("trainer sessions (cheat sheets) here:")
    tprint("  scripts/zk/logs/cheat-sheet/")
    tprint("\nGood luck. The machine is now listening.")
    tprint("=" * 60 + "\n")


def cmd_browse(args):
    conn = init_db()
    tprint("\n=== Card Catalog Browser ===")
    tprint("Commands: list, view <id>, search <kw>, links <id>, q (quit)")
    while True:
        cmd = ask("browse> ").strip()
        if cmd == "q" or cmd == "quit":
            break
        if cmd == "list":
            rows = conn.execute("SELECT id, path FROM zettels ORDER BY path").fetchall()
            for r in rows:
                tprint(f"  {r['id']}  ({r['path']})")
        elif cmd.startswith("view "):
            zid = cmd[5:].strip()
            z = conn.execute("SELECT * FROM zettels WHERE id = ?", (zid,)).fetchone()
            if z:
                tprint(f"\n  ID: {z['id']}")
                tprint(f"  Path: {z['path']}")
                tprint(f"  Body: {z['body']}")
            else:
                tprint(f"  Not found: {zid}")
        elif cmd.startswith("search "):
            kw = cmd[7:].strip()
            entries = conn.execute(
                "SELECT zettel_id FROM register_entries WHERE keyword = ?", (kw,)
            ).fetchall()
            for e in entries:
                tprint(f"  {e['zettel_id']}")
        elif cmd.startswith("links "):
            zid = cmd[6:].strip()
            links = conn.execute(
                "SELECT target_id, thematic_label FROM cross_references WHERE source_id = ?", (zid,)
            ).fetchall()
            for l in links:
                tprint(f"  -> {l['target_id']} :: {l['thematic_label']}")
            incoming = conn.execute(
                "SELECT source_id, thematic_label FROM cross_references WHERE target_id = ?", (zid,)
            ).fetchall()
            for i in incoming:
                tprint(f"  <- {i['source_id']} :: {i['thematic_label']}")
        else:
            tprint("Unknown command. Try: list, view <id>, search <kw>, links <id>, q")
    conn.close()


def run_level(level, mode, log_path, demo, no_pager=False, all_datasets=False):
    set_mode(mode)
    set_no_pager(no_pager)
    set_demo(demo)
    if log_path:
        open_log(log_path, level, mode)

    tprint(f"\n{'=' * 60}")
    tprint(f"  ZK Trainer — Level {level}")
    tprint(f"  Mode: {mode}")
    tprint(f"{'=' * 60}")

    show_quote("intro")
    tprint(f"\nThis level teaches the Zettelkasten through hands-on practice.")
    tprint("You will be told exactly what to type at each step.")
    tprint("Type '?' at any prompt to chat with the AI.")
    tprint("Type 'resume' to continue after chatting.\n")

    # Load seed database
    seed_path = SEEDS_DIR / f"level{level}-{mode}.db"
    if seed_path.exists():
        conn = init_db()
        conn.execute("DELETE FROM register_entries WHERE zettel_id IN (SELECT id FROM zettels WHERE training = 1)")
        conn.execute("DELETE FROM cross_references WHERE source_id IN (SELECT id FROM zettels WHERE training = 1) OR target_id IN (SELECT id FROM zettels WHERE training = 1)")
        conn.execute("DELETE FROM zettels WHERE training = 1")
        conn.commit()
        seed_conn = sqlite3.connect(str(seed_path))
        seed_conn.row_factory = sqlite3.Row
        for row in seed_conn.execute("SELECT * FROM zettels"):
            conn.execute("INSERT OR REPLACE INTO zettels (id, path, body, zettel_type, training, mode) VALUES (?,?,?,?,1,?)",
                        (row["id"], row["path"], row["body"], row["zettel_type"], mode))
        for row in seed_conn.execute("SELECT * FROM cross_references"):
            conn.execute("INSERT OR REPLACE INTO cross_references (source_id, target_id, thematic_label) VALUES (?,?,?)",
                        (row["source_id"], row["target_id"], row["thematic_label"]))
        for row in seed_conn.execute("SELECT * FROM register_entries"):
            conn.execute("INSERT OR REPLACE INTO register_entries (keyword, zettel_id, priority_rank) VALUES (?,?,?)",
                        (row["keyword"], row["zettel_id"], row["priority_rank"]))
        conn.commit()
        seed_conn.close()
        conn.close()
        tprint(f"Loaded seed database: {seed_path.name}")
    else:
        conn = init_db()
        conn.execute("DELETE FROM register_entries WHERE zettel_id IN (SELECT id FROM zettels WHERE training = 1)")
        conn.execute("DELETE FROM cross_references WHERE source_id IN (SELECT id FROM zettels WHERE training = 1) OR target_id IN (SELECT id FROM zettels WHERE training = 1)")
        conn.execute("DELETE FROM zettels WHERE training = 1")
        conn.commit()
        conn.close()

    sess_mod.reset_session()

    # Determine dataset count
    dataset_count = 3 if all_datasets else 1
    for ds in range(1, dataset_count + 1):
        tprint(f"\n{'─' * 60}")
        tprint(f"  Dataset {ds} of {dataset_count}")
        tprint(f"{'─' * 60}")

        tprint("\n>>> Step 1: Intake")
        cmd_intake(None)

        tprint("\n>>> Advancing to Filing")
        cmd_nextstep(None)

        tprint("\n>>> Step 2: Filing")
        cmd_filing(None)

        if ds > 1:
            tprint("\n>>> Advancing to Linking")
            cmd_nextstep(None)

            tprint("\n>>> Step 3: Linking")
            cmd_link(None)

            tprint("\n>>> Advancing to Query")
            cmd_nextstep(None)
        else:
            st = sess_mod.load_session()
            if "filing" not in st["completed"]:
                st["completed"].append("filing")
            st["step"] = "query"
            sess_mod.save_session(st)

        tprint("\n>>> Step 4: Query")
        cmd_query(None)

        # Review: render the finalized paper-slip equivalent for this dataset
        tprint(f"\n{'─' * 60}")
        tprint(f"  Dataset {ds} Review: Final Zettel Slip")
        tprint(f"{'─' * 60}")
        conn = init_db()
        zettel_id = f"zettel-{ds}"
        zrow = conn.execute("SELECT * FROM zettels WHERE id = ?", (zettel_id,)).fetchone()
        if zrow:
            render_ascii_zettel(zrow['id'], zrow['path'], zrow['body'], None)
        conn.close()
        tprint(f"{'─' * 60}\n")

        ask("\nThis section is done. Press enter to continue: ")

        tprint("\n>>> Completing dataset")
        cmd_nextstep(None)

        if ds < dataset_count:
            tprint(f"\n[Command to reach next dataset ({ds+1}):")
            mode_flag = "--semantic-hologram" if mode == "semantic-hologram" else "--luhmann"
            tprint(f"  python3 scripts/zk/zk.py trainer level{level} {mode_flag}")
            tprint("] Run that command to continue learning.\n")
        elif ds == 1 and dataset_count == 1:
            # Default single-dataset: prompt to continue to dataset 2
            tprint(f"\n[Continue to Dataset 2: run the same command again, or use --all for full session]")
            mode_flag = "--semantic-hologram" if mode == "semantic-hologram" else "--luhmann"
            tprint(f"  python3 scripts/zk/zk.py trainer level{level} {mode_flag}")
            tprint("] The session state advances; run again to resume at Dataset 2.\n")

    # Level-specific additional steps
    if level >= 2:
        tprint(f"\n{'─' * 60}")
        tprint("  Level 2: Radial Linking & Septic Tank")
        tprint(f"{'─' * 60}")
        show_quote("radial")
        tprint("\nRadial linking: one zettel links to MANY others.")
        tprint("Type \033[30;107mzettel-a\033[0m as the source, then \033[30;107mzettel-b,zettel-c,zettel-d\033[0m as targets.")

        while True:
            src = ask("\nSource zettel: ").strip()
            if handle_chat_input(src):
                continue
            break

        while True:
            tgts = ask("Target zettels (comma-separated): ").strip()
            if handle_chat_input(tgts):
                continue
            break

        for t in tgts.split(","):
            t = t.strip()
            if t:
                try:
                    conn = init_db()
                    conn.execute("INSERT OR IGNORE INTO cross_references (source_id, target_id, thematic_label) VALUES (?,?,?)",
                                (src, t, "Radial link"))
                    conn.commit()
                    conn.close()
                    tprint(f"  ✓ Linked {src} -> {t}")
                except Exception as e:
                    tprint(f"  Error: {e}")
        tprint(f"\n'{src}' is now stored in {len(tgts.split(','))} places via links.")
        show_quote("septic")
        tprint("\nSeptic tank: checking for unconnected zettels...")
        conn = init_db()
        orphans = conn.execute("""
            SELECT z.id FROM zettels z
            WHERE z.training = 1 AND z.id NOT IN (SELECT target_id FROM cross_references)
            AND z.id NOT IN (SELECT source_id FROM cross_references)
        """).fetchall()
        if orphans:
            for o in orphans:
                tprint(f"  ⚠ Flagged: {o['id']} has no incoming or outgoing links.")
                tprint(f"    This zettel would be filtered by the septic tank principle.")
        else:
            tprint("  No orphaned zettels found.")
        conn.close()
        ask("\nThis section is done. Press enter to continue: ")

    if level >= 3:
        tprint(f"\n{'─' * 60}")
        tprint("  Level 3: Query Traversal & Surprise")
        tprint(f"{'─' * 60}")
        show_quote("preselection")
        tprint("\nQuery traversal: given a keyword, walk the link graph.")

        while True:
            kw = ask("\nEnter a keyword to search (try 'Authority'): ").strip()
            if handle_chat_input(kw):
                continue
            break

        conn = init_db()
        entries = conn.execute("SELECT zettel_id, priority_rank FROM register_entries WHERE keyword = ?", (kw,)).fetchall()
        if entries:
            tprint(f"\nRegister entries for '{kw}':")
            for e in entries:
                tprint(f"  {e['zettel_id']} (rank {e['priority_rank']})")
                links = conn.execute("SELECT target_id, thematic_label FROM cross_references WHERE source_id = ?", (e['zettel_id'],)).fetchall()
                for l in links:
                    tprint(f"    -> {l['target_id']} :: {l['thematic_label']}")
        else:
            tprint(f"  No register entries for '{kw}'.")
        conn.close()
        ask("\nThis section is done. Press enter to continue: ")
        show_quote("surprise")
        tprint("\nThe zettelkasten surfaced connections you didn't explicitly make.")
        tprint("This is the 'surprise' — the box thinks differently than you.")

    if level >= 4:
        tprint(f"\n{'─' * 60}")
        tprint("  Level 4: Capstone — Full System")
        tprint(f"{'─' * 60}")
        show_quote("memory")
        show_quote("books")
        tprint("\nYou have completed all levels. The zettelkasten is now")
        tprint("a communication partner, not just a filing system.")
        tprint("\nWithout the Zettelkasten, Luhmann said he could not")
        tprint("have written a single book.")

    tprint(f"\n{'=' * 60}")
    tprint(f"  Level {level} Complete!")
    tprint(f"{'=' * 60}")
    tprint("\nRun 'zk trainer status' to see your work.")
    tprint("Run 'zk trainer reset' to replay.\n")
    ask("Press Enter to finish level: ")

    tprint("=" * 60)
    tprint("CLI COMMAND SUMMARY")
    tprint("=" * 60)
    tprint("  zk trainer level1 : Run Level 1 training session")
    tprint("  zk trainer level2 : Run Level 2 training session")
    tprint("  zk trainer level3 : Run Level 3 training session")
    tprint("  zk trainer level4 : Run Level 4 training session")
    tprint("  zk add \"body\"     : Create a new scratch zettel")
    tprint("  zk file <id> <p>  : Assign a materialized path to a zettel")
    tprint("  zk link <s> <t> <c>: Add a cross-reference with thematic context")
    tprint("  zk register <k> <i: Add a register entry point")
    tprint("  zk query <kw>     : Traverse links and show register entries")
    tprint("  zk browse         : Interactive zettelkasten card catalog browser")

    tprint("\n" + "=" * 60)
    tprint("SOURCES & LOCAL DOCUMENTATION")
    tprint("=" * 60)
    tprint("- Luhmann Archive: https://niklas-luhmann-archiv.de")
    tprint("  Local docs: docs/functional/luhmann-zettelkasten-digital-alchemy.md")
    tprint("- Luhmann ZK 2 9/8 API: https://v0.api.niklas-luhmann-archiv.de")
    tprint("  Local docs: docs/functional/semantic-hologram-user-guide.md")
    tprint("- Schmidt, J. F. K. (2015). 'Der Zettelkasten Niklas Luhmanns als Proto-Hypertext.'")
    tprint("  Local docs: ~/.config/opencode/skills/zettelkasten/SKILL.md")

    close_log()


def main():
    parser = argparse.ArgumentParser(description="zk — Zettelkasten Trainer CLI")
    sub = parser.add_subparsers(dest="command")

    trainer = sub.add_parser("trainer", help="Training mode")
    trainer_sub = trainer.add_subparsers(dest="trainer_command")

    for lvl in [1, 2, 3, 4]:
        p = trainer_sub.add_parser(f"level{lvl}", help=f"Run training level {lvl}")
        mode_group = p.add_mutually_exclusive_group()
        mode_group.add_argument("--luhmann", "--1952", "--human", action="store_true", default=True,
                              dest="luhmann", help="Luhmann 1952 mode (default)")
        mode_group.add_argument("--semantic-hologram", action="store_true", default=False,
                              dest="semantic_hologram", help="Semantic Hologram mode")
        p.add_argument("--log", nargs="?", const=True, default=False, metavar="PATH",
                      help="Enable logging")
        p.add_argument("--demo", action="store_true", default=False,
                      help="Demo mode (pre-canned answers)")
        p.add_argument("--no-pager", action="store_true", default=False,
                      help="Disable pagination")
        p.add_argument("--all", action="store_true", default=False,
                      dest="all_datasets", help="Run all 3 datasets (default: dataset 1 only)")

    trainer_sub.add_parser("reset", help="Reset training data only")

    mcp = trainer_sub.add_parser("mcp", help="MCP server management")
    mcp_sub = mcp.add_subparsers(dest="mcp_command")
    mcp_sub.add_parser("start", help="Start MCP server")
    mcp_sub.add_parser("stop", help="Stop MCP server")
    mcp_sub.add_parser("status", help="MCP server status")

    sub.add_parser("intake", help="Write an atomic zettel from a prompt")
    sub.add_parser("filing", help="Assign a materialized path")
    link_p = sub.add_parser("link", help="Add a cross-reference (training) or link two zettels (scratch)")
    link_p.add_argument("source", nargs="?", help="Source zettel ID (scratch mode)")
    link_p.add_argument("target", nargs="?", help="Target zettel ID (scratch mode)")
    link_p.add_argument("context", nargs="?", help="Thematic context (scratch mode)")
    query_p = sub.add_parser("query", help="Add a register entry (training) or query zettelkasten (scratch)")
    query_p.add_argument("question", nargs="?", help="Search question (scratch mode)")
    sub.add_parser("nextstep", help="Advance to the next workflow step")
    sub.add_parser("status", help="Show current session state")
    sub.add_parser("reset", help="Reset everything")
    sub.add_parser("browse", help="Browse the card catalog")
    sub.add_parser("orientation", help="Orientation: learn about Luhmann and the Zettelkasten system")

    # Scratch mode
    add_p = sub.add_parser("add", help="Create a zettel")
    add_p.add_argument("body", help="Zettel body text")
    file_p = sub.add_parser("file", help="File a zettel")
    file_p.add_argument("id", help="Zettel ID")
    file_p.add_argument("path", help="Materialized path")
    reg_p = sub.add_parser("register", help="Register a zettel")
    reg_p.add_argument("keyword", help="Keyword")
    reg_p.add_argument("id", help="Zettel ID")
    reg_p.add_argument("rank", type=int, help="Priority rank 1-4")

    args = parser.parse_args()

    mode = "luhmann"
    if hasattr(args, "semantic_hologram") and args.semantic_hologram:
        mode = "semantic-hologram"
    set_mode(mode)

    if args.command == "trainer":
        if args.trainer_command and args.trainer_command.startswith("level"):
            level = int(args.trainer_command.replace("level", ""))
            log_path = args.log if hasattr(args, "log") else False
            demo = args.demo if hasattr(args, "demo") else False
            all_datasets = args.all_datasets if hasattr(args, "all_datasets") else False
            run_level(level, mode, log_path, demo, all_datasets=all_datasets)
        elif args.trainer_command == "reset":
            cmd_reset(args)
        elif args.trainer_command == "mcp":
            cmd_mcp(args)
        else:
            parser.print_help()
    elif args.command == "intake":
        cmd_intake(args)
    elif args.command == "filing":
        cmd_filing(args)
    elif args.command == "link":
        if getattr(args, 'source', None):
            cmd_link_scratch(args)
        else:
            cmd_link(args)
    elif args.command == "query":
        if getattr(args, 'question', None):
            cmd_query_scratch(args)
        else:
            cmd_query(args)
    elif args.command == "nextstep":
        cmd_nextstep(args)
    elif args.command == "status":
        cmd_status(args)
    elif args.command == "reset":
        cmd_reset(args)
    elif args.command == "browse":
        cmd_browse(args)
    elif args.command == "orientation":
        cmd_orientation(args)
    elif args.command == "add":
        cmd_add(args)
    elif args.command == "file":
        cmd_file(args)
    elif args.command == "register":
        cmd_register_scratch(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
