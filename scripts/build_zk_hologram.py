#!/usr/bin/env python3
"""Convert Luhmann Zettelkasten SQLite DB to hologram markdown notes."""
import sqlite3, os, sys, re, shutil

def sanitize_filename(name):
    """Sanitize a zettel number for use as a filename."""
    # Replace problematic characters
    name = name.replace(',', '_').replace('/', '_').replace(' ', '_')
    name = name.replace('\\', '_').replace(':', '_').replace(';', '_')
    # Remove any remaining non-alphanumeric except underscore and hyphen
    name = re.sub(r'[^\w\-]', '_', name)
    # Collapse multiple underscores
    name = re.sub(r'_+', '_', name)
    # Strip leading/trailing underscores
    name = name.strip('_')
    if not name:
        name = 'unnamed'
    return name

def zettel_type_to_node_type(ztype):
    """Map Luhmann zettel type to hologram node type."""
    if 'Bibliographie' in ztype:
        return 'source'
    if 'Exzerpt' in ztype:
        return 'source'
    if 'Register' in ztype:
        return 'topic'
    if 'Arbeitsnotiz' in ztype:
        return 'idea'
    if 'Platzhalter' in ztype:
        return None  # Skip placeholders
    return 'concept'

def main():
    if len(sys.argv) < 2:
        print('Usage: python3 build_zk_hologram.py <destination_path>')
        sys.exit(1)

    dest = os.path.abspath(sys.argv[1])
    db_path = os.path.join(os.path.dirname(__file__), '..', 'docs', 'luhmann-zk', 'luhmann.db')

    if not os.path.exists(db_path):
        print(f'Error: Database not found at {db_path}')
        print('Run build_zk_db.py first.')
        sys.exit(1)

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    # Create destination directory with ZK-I and ZK-II subdirectories
    os.makedirs(dest, exist_ok=True)
    zk1_dir = os.path.join(dest, 'ZK-I')
    zk2_dir = os.path.join(dest, 'ZK-II')
    os.makedirs(zk1_dir, exist_ok=True)
    os.makedirs(zk2_dir, exist_ok=True)

    # Load all zettels
    zettels = conn.execute('SELECT * FROM zettels').fetchall()
    print(f'Loaded {len(zettels)} zettels')

    # Build number -> id mapping (normalize commas to hyphens for consistent matching)
    # Exclude placeholders
    number_to_id = {}
    id_to_number = {}
    for z in zettels:
        num = z['number']
        ztype = z['zettel_type'] or ''
        if num and 'Platzhalter' not in ztype:
            # Normalize: replace commas with hyphens (cross-refs use commas, zettels use hyphens)
            normalized = num.replace(',', '-')
            number_to_id[normalized] = z['id']
            id_to_number[z['id']] = num

    # Build incoming references map: target_number -> list of (source_id, label)
    # Count how many zettels have each number (to detect ambiguity)
    number_counts = {}
    for z in zettels:
        num = (z['number'] or '').replace(',', '-')
        number_counts[num] = number_counts.get(num, 0) + 1

    incoming = {}
    cross_refs = conn.execute('SELECT source_id, target_number, label, type FROM cross_references').fetchall()
    for cr in cross_refs:
        target = cr['target_number'].replace(',', '-')  # normalize to hyphen format
        # Only add incoming if the target number uniquely identifies a single zettel
        if number_counts.get(target, 0) == 1:
            if target not in incoming:
                incoming[target] = []
            # Deduplicate by source_id
            existing_srcs = {x[0] for x in incoming[target]}
            if cr['source_id'] not in existing_srcs:
                incoming[target].append((cr['source_id'], cr['label'] or 'related'))

    # Track used filenames to avoid collisions
    used_filenames_zk1 = set()
    used_filenames_zk2 = set()

    # Process each zettel
    created = 0
    skipped = 0
    for z in zettels:
        zid = z['id']
        number = z['number'] or ''
        title = z['title'] or ''
        ztype = z['zettel_type'] or ''
        abteilung = z['abteilung'] or ''
        body = z['body'] or ''
        zk = z['zk']
        transcription = z['transcription'] or ''

        node_type = zettel_type_to_node_type(ztype)
        if node_type is None:
            skipped += 1
            continue

        # Sanitize filename from zettel number
        if number:
            base = sanitize_filename(number)
        else:
            base = sanitize_filename(zid)

        # Handle filename collisions (per-directory)
        if zk == 1:
            used_set = used_filenames_zk1
        else:
            used_set = used_filenames_zk2
        fname = base + '.md'
        if fname in used_set:
            counter = 2
            while f'{base}_{counter}.md' in used_set:
                counter += 1
            fname = f'{base}_{counter}.md'
        used_set.add(fname)

        if zk == 1:
            filepath = os.path.join(zk1_dir, fname)
        else:
            filepath = os.path.join(zk2_dir, fname)

        # Determine tags
        tags = []
        if 'ZK I' in abteilung or zk == 1:
            tags.append('zk1')
        if 'ZK II' in abteilung or zk == 2:
            tags.append('zk2')
        if 'Bibliographie' in ztype or 'Bibliographie' in abteilung:
            tags.append('bibliographic')
        if 'Register' in ztype or 'Register' in abteilung:
            tags.append('register')
        if 'Exzerpt' in ztype:
            tags.append('excerpt')

        # Build relationships from cross_references
        outgoing_refs = conn.execute(
            'SELECT target_number, label, type FROM cross_references WHERE source_id = ?',
            (zid,)
        ).fetchall()

        relationships = []
        seen_targets = set()
        for ref in outgoing_refs:
            target_num = ref['target_number']
            label = ref['label'] or 'related'
            if not label.strip():
                label = 'related'
            # Normalize target (commas -> hyphens) for lookup
            target_norm = target_num.replace(',', '-')
            target_id = number_to_id.get(target_norm)
            if target_id and target_norm not in seen_targets:
                seen_targets.add(target_norm)
                target_fname = sanitize_filename(target_norm)
                relationships.append(f'- structural/related [[{target_fname}]] (1.00) :: {label}')

        # Build incoming relationships
        normalized_number = (number or '').replace(',', '-')
        incoming_refs = incoming.get(normalized_number, [])
        incoming_lines = []
        seen_src = set()
        for src_id, label in incoming_refs:
            if not label or not label.strip():
                label = 'related'
            src_num = id_to_number.get(src_id, src_id)
            if src_num in seen_src:
                continue
            seen_src.add(src_num)
            src_fname = sanitize_filename(src_num) if src_num in number_to_id else sanitize_filename(src_id)
            incoming_lines.append(f'- structural/related [[{src_fname}]] (1.00) :: {label}')

        # Build the note content
        lines = []
        lines.append('---')
        lines.append(f'title: "{number} — {title}"')
        lines.append(f'node-type: {node_type}')
        if tags:
            lines.append(f'tags: [{", ".join(tags)}]')
        lines.append('---')
        lines.append('')
        lines.append(f'# {number} — {title}')
        lines.append('')
        if body:
            lines.append(body)
            lines.append('')

        if relationships:
            lines.append('## Relationships')
            lines.append('')
            for rel in relationships:
                lines.append(rel)
            lines.append('')

        if incoming_lines:
            lines.append('## Incoming relationships')
            lines.append('')
            for inc in incoming_lines:
                lines.append(inc)
            lines.append('')

        # Write file
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write('\n'.join(lines))

        created += 1

    conn.close()
    print(f'Created {created} hologram notes, skipped {skipped} placeholders.')
    print(f'Output: {dest}')

if __name__ == '__main__':
    main()
