# zk — Zettelkasten Trainer CLI

A minimal, repeatable CLI tool for training Luhmann's 4 Zettelkasten workflows:
**Intake → Filing → Linking → Query**

## Setup
```bash
cd scripts/zk
pip install -r requirements.txt  # (none yet — pure stdlib)
```

## Usage
```bash
python3 zk.py intake    # Write an atomic zettel from a prompt
python3 zk.py filing    # Assign a materialized path
python3 zk.py link      # Add a cross-reference with thematic context
python3 zk.py query     # Add a register entry point
python3 zk.py nextstep  # Advance to the next workflow step
python3 zk.py status    # Show current session state
python3 zk.py reset     # Reset the session and database
```

## Architecture
- **Source of Truth:** SQLite (`~/.zk_trainer/zk.db`)
- **Git Sync:** JSON records dumped to `~/.zk_trainer/json_records/`
- **Session State:** `~/.zk_trainer/session.json`
- **Training Data:** `training/01_intake.json`, `training/02_link.json`, `training/03_query.json`

## Workflows
1. **Intake:** Read text, synthesize in own words, write atomic zettel
2. **Filing:** Assign materialized path (e.g., `/1/a/1`)
3. **Linking:** Add cross-reference with mandatory thematic label (`:: label`)
4. **Query:** Add entry to curated Register (max 4 per keyword)
