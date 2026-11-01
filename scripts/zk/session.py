#!/usr/bin/env python3
"""Session state management for the zk trainer."""
import json, os
from pathlib import Path

SESSION_PATH = Path.home() / ".zk_trainer" / "session.json"

def load_session():
    if not SESSION_PATH.exists():
        return {"step": "intake", "dataset": 1, "completed": [], "notes": {}}
    return json.loads(SESSION_PATH.read_text())

def save_session(state):
    SESSION_PATH.parent.mkdir(parents=True, exist_ok=True)
    SESSION_PATH.write_text(json.dumps(state, indent=2))

def reset_session():
    if SESSION_PATH.exists():
        SESSION_PATH.unlink()
    return {"step": "intake", "dataset": 1, "completed": [], "notes": {}}

def advance_step(state, completed_step):
    state["completed"].append(completed_step)
    steps = ["intake", "filing", "linking", "query"]
    try:
        idx = steps.index(completed_step)
        if idx + 1 < len(steps):
            state["step"] = steps[idx + 1]
        else:
            state["step"] = "done"
    except ValueError:
        pass
    save_session(state)
    return state

def get_current_step(state):
    return state.get("step", "intake")

def set_note(state, note_id, data):
    state["notes"][note_id] = data
    save_session(state)
    return state

def get_note(state, note_id):
    return state["notes"].get(note_id)
