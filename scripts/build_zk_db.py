#!/usr/bin/env python3
"""Convert Luhmann Zettelkasten JSON files to SQLite database (v2 - improved cross-ref extraction)."""
import json, glob, os, re, sqlite3

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'docs', 'luhmann-zk', 'luhmann.db')
JSON_DIR = os.path.join(os.path.dirname(__file__), '..', 'docs', 'luhmann-zk')

def get_conn():
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    conn = sqlite3.connect(DB_PATH)
    conn.execute('PRAGMA journal_mode=WAL')
    return conn

def create_schema(conn):
    conn.executescript('''
    CREATE TABLE zettels (
        id TEXT PRIMARY KEY,
        number TEXT,
        title TEXT,
        zk INTEGER,
        zettel_type TEXT,
        abteilung TEXT,
        auszug TEXT,
        body TEXT,
        transcription TEXT,
        is_front INTEGER,
        pub_date TEXT,
        short_title TEXT
    );
    CREATE TABLE cross_references (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT REFERENCES zettels(id),
        target_number TEXT,
        label TEXT,
        type TEXT
    );
    CREATE TABLE bibliography (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        zettel_id TEXT REFERENCES zettels(id),
        author TEXT,
        title TEXT,
        publication_info TEXT,
        cross_ref TEXT
    );
    CREATE TABLE register_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        zettel_id TEXT REFERENCES zettels(id),
        keyword TEXT,
        zettel_numbers TEXT
    );
    CREATE INDEX idx_zettels_number ON zettels(number);
    CREATE INDEX idx_zettels_type ON zettels(zettel_type);
    CREATE INDEX idx_zettels_abteilung ON zettels(abteilung);
    CREATE INDEX idx_zettels_zk ON zettels(zk);
    CREATE INDEX idx_cross_source ON cross_references(source_id);
    CREATE INDEX idx_cross_target ON cross_references(target_number);
    CREATE INDEX idx_bib_zettel ON bibliography(zettel_id);
    CREATE INDEX idx_reg_zettel ON register_entries(zettel_id);
    CREATE INDEX idx_reg_keyword ON register_entries(keyword);
    ''')

def parse_body_and_sections(text):
    text = text.strip()
    # Find Literatur section
    literatur_match = re.search(r'\n\s*Literatur\s*\n', text, re.IGNORECASE)

    # Find Verweisung marker (singular or plural, with or without colon)
    verweis_match = re.search(r'Verweisung(?:en)?\s*:?', text, re.IGNORECASE)

    body = text
    verweisungen = ''
    literatur = ''

    if verweis_match:
        pos = verweis_match.end()
        # Check if marker is followed by newline (section style) or inline refs
        if pos < len(text) and text[pos:pos+1] == '\n':
            verweis_start = pos
            if literatur_match and literatur_match.start() > verweis_start:
                verweisungen = text[verweis_start:literatur_match.start()].strip()
                body = text[:verweis_match.start()].strip()
            else:
                verweisungen = text[verweis_start:].strip()
                body = text[:verweis_match.start()].strip()
            verweisungen = verweisungen.lstrip(':').strip()
        else:
            # Inline style: "Verweisung 13,1; 17,3g1" or "Verweisungen: 60,4e64"
            rest_of_line = text[pos:].split('\n')[0].strip()
            if re.search(r'\d', rest_of_line):
                verweisungen = rest_of_line.lstrip(':').strip()
                body = text[:verweis_match.start()].strip()

    if literatur_match:
        lit_start = literatur_match.end()
        literatur = text[lit_start:].strip()
        if not verweisungen:
            body = text[:literatur_match.start()].strip()

    # Clean up body: remove trailing Verweisung marker if inline
    body = re.sub(r'\n\s*Verweisung(?:en)?\s*:?.*$', '', body, flags=re.DOTALL | re.IGNORECASE).strip()

    return body, verweisungen, literatur

def parse_cross_references(verweisungen_text, body_text='', known_numbers=None):
    refs = []
    if not verweisungen_text and not body_text:
        return refs

    seen = set()

    # Parse Verweisungen section
    if verweisungen_text:
        text = verweisungen_text.replace('\u200a', ' ').replace('\xa0', ' ')
        lines = [l.strip() for l in text.split('\n') if l.strip()]
        current_label = ''
        for line in lines:
            if re.match(r'^[\d][\d,./a-zA-Z; ]*$', line) and len(line) < 50:
                for num in re.findall(r'\d[\d,./a-zA-Z]*', line):
                    if num and num not in seen:
                        seen.add(num)
                        label = current_label.strip() if current_label.strip() else 'related'
                        refs.append((num.strip(), label))
                continue

            inline_refs = re.findall(r'(?:vgl\.|siehe|cf\.|see|insb\.)\s+(\d[\d,./a-zA-Z]*)', line, re.IGNORECASE)
            for num in inline_refs:
                if num not in seen:
                    seen.add(num)
                    refs.append((num.strip(), line.strip()))

            clean_line = re.sub(r'(?:vgl\.|siehe|cf\.|see|insb\.)\s+\d[\d,./a-zA-Z]*', '', line).strip()
            if not clean_line:
                continue

            m = re.match(r'^(.+?)\s{1,}([\d][\d,./a-zA-Z; ,\s]+)$', clean_line)
            if m:
                label = m.group(1).strip()
                nums_str = m.group(2).strip()
                if re.search(r'[a-zA-ZäöüÄÖÜ]', label) or len(label) > 3:
                    current_label = label
                    for num in re.findall(r'\d[\d,./a-zA-Z]*', nums_str):
                        if num not in seen:
                            seen.add(num)
                            refs.append((num.strip(), label))
                    continue

            current_label = clean_line if not current_label else current_label + ' ' + clean_line

        # Also extract any known zettel number that appears as a standalone token
        # in the verweisungen text (catches bare numbers we might have missed)
        for m in re.finditer(r'(?<![\d,./a-zA-Z])(\d[\d,./a-zA-Z]*)(?![\d,./a-zA-Z])', verweisungen_text):
            token = m.group(1)
            if token in (known_numbers or set()) and token not in seen:
                seen.add(token)
                refs.append((token, 'bare reference'))

    # Extract inline vgl/siehe from body text
    if body_text:
        for m in re.finditer(r'(?:vgl\.|siehe|cf\.|see)\s+(\d[\d,./a-zA-Z]*)', body_text, re.IGNORECASE):
            num = m.group(1).strip()
            if num not in seen:
                seen.add(num)
                refs.append((num, 'inline reference'))

    # Bare number matching: find known zettel numbers in body text
    if known_numbers and body_text:
        for m in re.finditer(r'\d[\d,./a-zA-Z]*', body_text):
            token = m.group(0)
            if token in known_numbers and token not in seen:
                if re.search(r'[a-zA-Z,./]', token):
                    seen.add(token)
                    refs.append((token, 'bare reference'))

    # Ensure no empty labels
    refs = [(num, label if label.strip() else 'related') for num, label in refs]

    return refs

def parse_bibliography(text):
    entries = []
    if not text:
        return entries
    lines = text.split('\n')
    current_entry = ''
    for line in lines:
        line = line.strip()
        if not line:
            if current_entry:
                entries.append(current_entry)
                current_entry = ''
            continue
        if current_entry and (line[0].isupper() and ',' in line[:40] and not line.startswith('vgl') and not line.startswith('S.') and not line.startswith('S ')):
            entries.append(current_entry)
            current_entry = line
        else:
            if current_entry:
                current_entry += ' ' + line
            else:
                current_entry = line
    if current_entry:
        entries.append(current_entry)
    parsed = []
    for entry in entries:
        entry = entry.strip()
        if not entry:
            continue
        parts = entry.split(',', 1)
        author = parts[0].strip() if parts else ''
        rest = parts[1].strip() if len(parts) > 1 else ''
        cross_ref = ''
        cross_match = re.search(r'vgl\.\s*(\d[\d,./a-zA-Z]*)', entry)
        if cross_match:
            cross_ref = cross_match.group(1)
        parsed.append((author, rest, cross_ref))
    return parsed

def parse_register(text):
    entries = []
    if not text:
        return entries
    lines = text.split('\n')
    current_keyword = ''
    current_numbers = ''
    for line in lines:
        line = line.strip()
        if not line:
            if current_keyword and current_numbers:
                entries.append((current_keyword, current_numbers.strip()))
            current_keyword = ''
            current_numbers = ''
            continue
        if re.search(r'\d', line) and not re.search(r'[a-zA-ZäöüÄÖÜ]{3,}', line):
            if current_numbers:
                current_numbers += '; ' + line
            else:
                current_numbers = line
        elif re.search(r'\d', line) and re.search(r'[a-zA-ZäöüÄÖÜ]{3,}', line):
            m = re.match(r'^(.+?)\s+(\d[\d,./a-zA-Z;,\s]+)$', line)
            if m:
                if current_keyword and current_numbers:
                    entries.append((current_keyword, current_numbers.strip()))
                current_keyword = m.group(1).strip()
                current_numbers = m.group(2).strip()
            else:
                if current_keyword and current_numbers:
                    entries.append((current_keyword, current_numbers.strip()))
                current_keyword = line
                current_numbers = ''
        else:
            if current_keyword and current_numbers:
                entries.append((current_keyword, current_numbers.strip()))
            current_keyword = line
            current_numbers = ''
    if current_keyword and current_numbers:
        entries.append((current_keyword, current_numbers.strip()))
    return entries

def main():
    conn = get_conn()
    create_schema(conn)

    # Build set of known zettel numbers for bare-reference matching
    known_numbers = set()
    json_files = sorted(glob.glob(os.path.join(JSON_DIR, '*.json')))
    for filepath in json_files:
        with open(filepath, encoding='utf-8') as f:
            data = json.load(f)
        for r in data.get('results', []):
            num = r.get('luhmann_number', '') or ''
            ztype = r.get('zettel_type', '') or ''
            # Exclude placeholders
            if num and 'Platzhalter' not in ztype:
                known_numbers.add(num)
                known_numbers.add(num.replace('-', ','))
                known_numbers.add(num.replace(',', '-'))
    print(f'Known numbers: {len(known_numbers)}')
    print(f'Found {len(json_files)} JSON files')

    zettel_count = 0
    cross_ref_count = 0
    bib_count = 0
    reg_count = 0

    for filepath in json_files:
        print(f'Processing {os.path.basename(filepath)}...')
        with open(filepath, encoding='utf-8') as f:
            data = json.load(f)

        for r in data.get('results', []):
            ekin = r.get('ekin', '')
            if not ekin:
                continue

            number = r.get('luhmann_number', '') or r.get('zk_number', '')
            title = r.get('title', '')
            zk = int(r.get('meta', {}).get('logical_zettelkasten', '0') or '0')
            zettel_type = r.get('meta', {}).get('zettel_type', '')
            abteilung = r.get('meta', {}).get('abteilung', '')
            auszug = r.get('auszug', '')
            is_front = 1 if r.get('is_front', False) else 0
            pub_date = r.get('pubDate', '')
            short_title = r.get('shortTitle', '')
            transcription = r.get('transcriptionPreview', '')

            body, verweisungen, literatur = parse_body_and_sections(transcription)

            conn.execute('''INSERT OR REPLACE INTO zettels
                (id, number, title, zk, zettel_type, abteilung, auszug, body, transcription, is_front, pub_date, short_title)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)''',
                (ekin, number, title, zk, zettel_type, abteilung, auszug, body, transcription, is_front, pub_date, short_title))

            zettel_count += 1

            if zettel_type not in ('Registerzettel', 'Bibliographiezettel', 'Bibliographiezettel / Exzerptzettel'):
                refs = parse_cross_references(verweisungen, body, known_numbers)
                seen = set()
                for target, label in refs:
                    own_num = (number or '').replace('-', ',')
                    if target == own_num:
                        continue
                    key = (target, label)
                    if key in seen:
                        continue
                    seen.add(key)
                    ref_type = 'einzel'
                    if label and len(refs) > 5:
                        ref_type = 'sammel'
                    conn.execute('''INSERT INTO cross_references (source_id, target_number, label, type)
                        VALUES (?,?,?,?)''', (ekin, target, label, ref_type))
                    cross_ref_count += 1

            if 'Bibliographie' in zettel_type or 'Bibliographie' in abteilung:
                entries = parse_bibliography(literatur if literatur else transcription)
                if not entries and transcription:
                    entries = parse_bibliography(transcription)
                for author, pub_info, cross_ref in entries:
                    conn.execute('''INSERT INTO bibliography (zettel_id, author, title, publication_info, cross_ref)
                        VALUES (?,?,?,?,?)''', (ekin, author, '', pub_info, cross_ref))
                    bib_count += 1

            if zettel_type == 'Registerzettel':
                entries = parse_register(transcription)
                for keyword, numbers in entries:
                    conn.execute('''INSERT INTO register_entries (zettel_id, keyword, zettel_numbers)
                        VALUES (?,?,?)''', (ekin, keyword, numbers))
                    reg_count += 1

        conn.commit()
        print(f'  {os.path.basename(filepath)}: zettels={zettel_count}, cross-refs={cross_ref_count}, bib={bib_count}, reg={reg_count}')

    print()
    print('=== FINAL STATS ===')
    for table in ['zettels', 'cross_references', 'bibliography', 'register_entries']:
        count = conn.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
        print(f'  {table}: {count}')

    conn.close()
    print(f'\nDatabase created at: {DB_PATH}')

if __name__ == '__main__':
    main()
