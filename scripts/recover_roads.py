"""Recover a readable whole-way prefix from the legacy journal_mode=OFF importer.

The original staging file is opened read-only. Damaged batches and the final
possibly incomplete way are replayed from the pinned PBF by import_roads --resume.
This is specific to the original append-only cells schema, not general DB repair.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sqlite3


def recover(source, pbf, version, work, expected_md5=None, batch_size=25000):
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', version):
        raise ValueError('Invalid version.')
    source = Path(source).resolve()
    pbf = Path(pbf).resolve()
    root = Path(work).resolve()
    target = root / version
    if target.resolve().parent != root or target.exists():
        raise ValueError('Use a new recovery work/version directory; original files are never overwritten.')
    sha = hashlib.sha256()
    md5 = hashlib.md5()
    with pbf.open('rb') as file:
        while block := file.read(8 * 1024 * 1024):
            sha.update(block)
            md5.update(block)
    if expected_md5 and md5.hexdigest() != expected_md5:
        raise ValueError('Pinned source MD5 does not match. Do not resume with a changed extract.')
    original = sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)
    if original.execute("pragma integrity_check('refs')").fetchall() != [('ok',)]:
        raise ValueError('Junction table is damaged and cannot be reused safely.')
    ref_count = original.execute('select count(*) from refs').fetchone()[0]
    if not ref_count:
        raise ValueError('No completed junction counts found.')
    original.close()
    target.mkdir(parents=True)
    db = sqlite3.connect(str(target / 'nodes.sqlite'), uri=True)
    db.execute('pragma journal_mode=wal')
    db.execute('pragma synchronous=full')
    db.execute('pragma cache_size=-131072')
    db.execute('create table refs (id integer primary key, n integer not null)')
    db.execute('create table cells (cell text, id text, feature text, primary key(cell,id))')
    db.execute('create table meta (key text primary key, value text not null)')
    db.execute('attach database ? as legacy', (source.as_uri() + '?mode=ro',))
    print(f'Copying {ref_count:,} verified junction records into clean staging.', flush=True)
    db.execute('insert into refs select * from legacy.refs')
    db.commit()
    assert db.execute('select count(*) from refs').fetchone()[0] == ref_count
    row = 1
    last_way = 0
    stop_reason = 'Readable table ended; final way will be replayed.'
    pattern = re.compile(rf'^osm-uk:{re.escape(version)}:way:(\d+):[0-9a-f]{{24}}$')
    while True:
        try:
            # Rowid follows original insertion order. Never consult the damaged secondary index.
            batch = db.execute('select rowid,id from legacy.cells not indexed where rowid>=? and rowid<? order by rowid', (row, row + batch_size)).fetchall()
        except sqlite3.DatabaseError as error:
            stop_reason = f'Unreadable batch beginning at row {row}: {error}'
            break
        if not batch:
            break
        previous_way = last_way
        for expected_row, (actual_row, identity) in enumerate(batch, row):
            match = pattern.fullmatch(identity)
            if actual_row != expected_row or not match or int(match[1]) < previous_way:
                raise ValueError('Cannot prove contiguous, sorted source-way prefix. Original file preserved.')
            previous_way = int(match[1])
        # Each batch is copied atomically. A corrupt source read cannot leave half a batch.
        try:
            before = db.total_changes
            db.execute('insert into cells select cell,id,feature from legacy.cells not indexed where rowid>=? and rowid<?', (row, row + len(batch)))
            if db.total_changes - before != len(batch):
                raise ValueError('Cell copy count mismatch.')
            db.commit()
        except sqlite3.DatabaseError as error:
            db.rollback()
            stop_reason = f'Unreadable feature batch beginning at row {row}: {error}'
            break
        last_way = previous_way
        row += len(batch)
        if (row - 1) % 250000 == 0:
            print(f'Recovered {row - 1:,} cell records.', flush=True)
    if last_way:
        # All earlier ways are complete; this last way may cross the failed batch.
        db.execute('delete from cells where id glob ?', (f'osm-uk:{version}:way:{last_way}:*',))
    total = db.execute('select count(distinct id) from cells').fetchone()[0]
    safe_way = max(0, last_way - 1)
    db.executemany('insert into meta values (?,?)', [('sha256', sha.hexdigest()), ('version', version),
        ('phase', 'geometry'), ('last_way', str(safe_way)), ('segments', str(total))])
    db.commit()
    db.execute('detach database legacy')
    if db.execute('pragma integrity_check').fetchall() != [('ok',)]:
        raise ValueError('Recovered staging failed integrity checking.')
    db.execute('pragma wal_checkpoint(truncate)')
    db.close()
    report = {'originalPreservedReadOnly': str(source), 'sourceSha256': sha.hexdigest(),
              'sourceMd5': md5.hexdigest(), 'junctionRecordsReused': ref_count,
              'recoveredUniqueSections': total, 'resumeAfterWay': safe_way,
              'cleanStaging': str(target), 'stopReason': stop_reason,
              'strategy': 'Reuse verified junctions and contiguous complete-way prefix; replay uncertain tail with stable IDs.'}
    print(json.dumps(report, indent=2), flush=True)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, help='Original legacy nodes.sqlite (read-only).')
    parser.add_argument('--pbf', required=True)
    parser.add_argument('--version', required=True)
    parser.add_argument('--work', required=True, help='New recovery work root.')
    parser.add_argument('--expected-md5')
    parser.add_argument('--report', required=True)
    args = parser.parse_args()
    report = recover(args.source, args.pbf, args.version, args.work, args.expected_md5)
    Path(args.report).write_text(json.dumps(report, indent=2), encoding='utf-8')
