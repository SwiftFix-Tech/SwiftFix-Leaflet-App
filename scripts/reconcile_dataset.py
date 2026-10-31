"""Reviewed dataset update: dry-run by default. CSV columns: old_id,new_id.
Every saved old section must map to >=1 reviewed new section. No fuzzy auto-completion.
"""
import argparse
import csv
import os
import psycopg

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--version', required=True)
parser.add_argument('--mapping', required=True)
parser.add_argument('--apply', action='store_true')
args = parser.parse_args()
with open(args.mapping, newline='', encoding='utf-8') as file:
    pairs = sorted({(r['old_id'], r['new_id']) for r in csv.DictReader(file)})
with psycopg.connect(os.environ['DATABASE_URL']) as db:
    # Same order as app writes: workspace locks, then road revisions.
    db.execute('select id from public.workspaces order by id for update')
    db.execute('lock table public.road_datasets in exclusive mode')
    target = db.execute('select active from public.road_datasets where version=%s', (args.version,)).fetchone()
    if target is None or target[0]:
        raise ValueError('Target must be an imported, inactive release.')
    db.execute('create temp table mapping(old_id text, new_id text, primary key(old_id,new_id)) on commit drop')
    with db.cursor().copy('copy mapping from stdin') as copy:
        for pair in pairs:
            copy.write_row(pair)
    bad = db.execute('''select count(*) from mapping m
        left join public.road_segments o on o.id=m.old_id
        left join public.road_segments n on n.id=m.new_id
        where o.id is null or n.id is null or n.dataset_version<>%s or o.dataset_version=%s''', (args.version, args.version)).fetchone()[0]
    missing = db.execute('''select distinct c.road_segment_id from public.completed_roads c
        where c.geometry_reference<>%s and not exists(select 1 from mapping m where m.old_id=c.road_segment_id)''', (args.version,)).fetchall()
    if bad or missing:
        raise ValueError(f'Invalid mappings: {bad}. Unmapped saved sections: {len(missing)}. Resolve before activation.')
    print(f'Validated {len(pairs)} reviewed mappings. Apply: {args.apply}')
    if args.apply:
        # Retain a complete JSON audit snapshot, including old geometry, before migrating.
        db.execute('''create table if not exists public.dataset_migration_audit(
            id bigint generated always as identity primary key, migrated_at timestamptz default now(),
            target_version text not null, old_record jsonb not null)''')
        db.execute('alter table public.dataset_migration_audit enable row level security')
        db.execute('revoke all on public.dataset_migration_audit from anon,authenticated')
        db.execute('''insert into public.dataset_migration_audit(target_version,old_record)
            select %s,to_jsonb(c) from public.completed_roads c where geometry_reference<>%s''', (args.version, args.version))
        db.execute('''insert into public.completed_roads(workspace_id,user_id,road_segment_id,road_name,geometry_reference,geom,completed_at)
            select c.workspace_id,c.user_id,n.id,n.road_name,n.dataset_version,n.geom,min(c.completed_at)
            from public.completed_roads c join mapping m on m.old_id=c.road_segment_id
            join public.road_segments n on n.id=m.new_id
            group by c.workspace_id,c.user_id,n.id,n.road_name,n.dataset_version,n.geom
            on conflict(workspace_id,road_segment_id) do nothing''')
        db.execute('delete from public.completed_roads where geometry_reference<>%s', (args.version,))
        db.execute('update public.road_revisions set revision=gen_random_uuid()')
        db.execute('update public.road_datasets set active=false where active')
        db.execute('update public.road_datasets set active=true where version=%s', (args.version,))
        db.execute('update public.workspaces set revision=revision+1')
    else:
        db.rollback()
