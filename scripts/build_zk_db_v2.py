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

# Zettel number pattern: starts with digit, contains digits/commas/dots/slashes/letters
ZETTEL_NUM_RE = re.compile(r'\d[\d,./a-zA-Z]*')

def parse_body_and_sections(text):
    text = text.strip()
    # Find Literatur section
    literatur_match = re.search(r'\n\s*Literatur\s*\n', text, re.IGNORECASE)
    # Find Verweisung section (singular or plural, with or without colon)
    verweis_match = re.search(r'Verweisung(?:en)?\s*:?\s*\n', text, re.IGNORECASE)
    
    body = text
    verweisungen = ''
    literatur = ''
    
    # Determine split points
    splits = []
    if verweis_match:
        splits.append((verweis_match.start(), 'verweisungen', verweis_match))
    if literatur_match:
        splits.append((literatur_match.start(), 'literatur', literatur_match))
    splits.sort()
    
    if not splits:
        return body, '', ''
    
    first_split_pos = splits[0][0]
    body = text[:first_split_pos].strip()
    
    for i, (pos, name, match) in enumerate(splits):
        start = match.end()
        if i + 1 < len(splits):
            end = splits[i + 1][0]
        else:
            end = len(text)
        section_text = text[start:end].strip()
        if name == 'verweisungen':
            verweisungen = section_text
        elif name == 'literatur':
            literatur = section_text
    
    # Also handle inline Verweisungen (on same line as zettel number)
    # e.g., "1 Verweisungen 13,1; 17,3g1; 16,8"
    inline_verweis = re.search(r'Verweisung(?:en)?\s*:?\s+(.+?)(?:\n|$)', text, re.IGNORECASE)
    if inline_verweis and not verweisungen:
        candidate = inline_verweis.group(1).strip()
        # Make sure it contains numbers (not just the word)
        if re.search(r'\d', candidate):
            verweisungen = candidate
    
    return body, verweisungen, literatur

def parse_cross_references(verweisungen_text, body_text=''):
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
            # Pure number line (just numbers and separators)
            if re.match(r'^[\d][\d,./a-zA-Z; ]*$', line) and len(line) < 60:
                for num in re.findall(r'\d[\d,./a-zA-Z]*', line):
                    if num and (num, current_label) not in seen:
                        seen.add((num, current_label))
                        refs.append((num.strip(), current_label.strip()))
                continue
            
            # Inline refs within the line
            inline_refs = re.findall(r'(?:vgl\.|siehe|cf\.|see|insb\.)\s+(\d[\d,./a-zA-Z]*)', line, re.IGNORECASE)
            for num in inline_refs:
                key = (num, line.strip())
                if key not in seen:
                    seen.add(key)
                    refs.append((num.strip(), line.strip()))
            
            # Remove inline refs for label/number parsing
            clean_line = re.sub(r'(?:vgl\.|siehe|cf\.|see|insb\.)\s+\d[\d,./a-zA-Z]*', '', line).strip()
            if not clean_line:
                continue
            
            # Label + multiple numbers separated by semicolons or multiple spaces
            m = re.match(r'^(.+?)\s{1,}([\d][\d,./a-zA-Z;,\s]+)$', clean_line)
            if m:
                label = m.group(1).strip()
                nums_str = m.group(2).strip()
                if re.search(r'[a-zA-ZäöüÄÖÜ]', label) or len(label) > 3:
                    current_label = label
                    for num in re.findall(r'\d[\d,./a-zA-Z]*', nums_str):
                        key = (num, label)
                        if key not in seen:
                            seen.add(key)
                            refs.append((num.strip(), label))
                    continue
            
            # Label only (number on next line)
            current_label = clean_line if not current_label else current_label + ' ' + clean_line
    
    # Also extract inline vgl/siehe from body text
    if body_text:
        for m in re.finditer(r'(?:vgl\.|siehe|cf\.|see)\s+(\d[\d,./a-zA-Z]*)', body_text, re.IGNORECASE):
            num = m.group(1).strip()
            key = (num, 'inline')
            if key not in seen:
                seen.add(key)
                refs.append((num, 'inline reference'))
    
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

    json_files = sorted(glob.glob(os.path.join(JSON_DIR, '*.json')))
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
                refs = parse_cross_references(verweisungen, body)
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
