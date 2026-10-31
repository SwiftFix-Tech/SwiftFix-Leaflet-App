"""Transactional integration tests against a DEDICATED migrated Supabase test database.
No fixture records survive rollback. Requires SWIFTFIX_TEST_DATABASE=1 and DATABASE_URL.
"""
import os
import unittest
import uuid
import psycopg


@unittest.skipUnless(os.environ.get('SWIFTFIX_TEST_DATABASE') == '1', 'Dedicated test database not configured')
class DatabaseTests(unittest.TestCase):
    def setUp(self):
        self.db = psycopg.connect(os.environ['DATABASE_URL'])
        self.workspace = '5c7c15a9-3757-4c87-85d3-a5d671642f36'
        self.alice, self.bob, self.outsider = [str(uuid.uuid4()) for _ in range(3)]
        for user in (self.alice, self.bob, self.outsider):
            self.db.execute('insert into auth.users(id) values (%s)', (user,))
        for user in (self.alice, self.bob):
            self.db.execute('insert into public.workspace_members values (%s,%s)', (self.workspace, user))
        self.version = 'test_' + uuid.uuid4().hex
        self.segment = 'test:' + uuid.uuid4().hex
        self.db.execute('update public.road_datasets set active=false where active')
        self.db.execute('insert into public.road_datasets(version,source_url,sha256,active) values (%s,%s,%s,true)', (self.version, 'test-only', '0' * 64))
        self.db.execute("insert into public.road_segments values (%s,%s,'Synthetic test road',1,extensions.st_geomfromtext('LINESTRING(-0.164 51.587,-0.163 51.5873,-0.162 51.5871)',4326))", (self.segment, self.version))

    def user(self, uid, role='authenticated'):
        self.db.execute('reset role')
        self.db.execute("select set_config('request.jwt.claim.sub',%s,true)", (uid,))
        self.db.execute('set local role ' + role)  # role is fixed test code, not user input

    def mark(self, completed=True, revision=None):
        return self.db.execute('select public.set_completed(%s,%s,%s,%s)', (self.workspace, self.segment, completed, revision)).fetchone()[0]

    def tearDown(self):
        self.db.rollback()
        self.db.close()

    def test_shared_persistence_duplicate_count_geometry_and_removal(self):
        self.user(self.alice)
        baseline = self.db.execute('select count(*) from public.completed_roads').fetchone()[0]
        first = self.mark()
        self.assertTrue(first['changed'])
        self.assertFalse(self.mark()['changed'])
        self.user(self.bob)
        count = self.db.execute('select count(*) from public.completed_roads where road_segment_id=%s', (self.segment,)).fetchone()[0]
        self.assertEqual(count, 1)
        view = self.db.execute('select public.tracker_view(%s,array[-0.17,51.58,-0.15,51.60]::float8[],16::float8)', (self.workspace,)).fetchone()[0]
        found = [r for r in view['completed']['features'] if r['properties']['id'] == self.segment]
        self.assertEqual(view['count'], baseline + 1)
        self.assertEqual(len(found[0]['geometry']['coordinates']), 3)
        self.assertTrue(self.mark(False)['changed'])
        self.assertEqual(self.db.execute('select count(*) from public.completed_roads where road_segment_id=%s', (self.segment,)).fetchone()[0], 0)

    def test_outsider_and_anonymous_cannot_read_or_write(self):
        self.user(self.outsider)
        self.assertEqual(self.db.execute('select count(*) from public.completed_roads').fetchone()[0], 0)
        with self.assertRaises(psycopg.errors.InsufficientPrivilege), self.db.transaction():
            self.mark()
        self.user(self.outsider, 'anon')
        with self.assertRaises(psycopg.errors.InsufficientPrivilege), self.db.transaction():
            self.mark()

    def test_client_cannot_bypass_rpc_or_add_members(self):
        self.user(self.alice)
        with self.assertRaises(psycopg.errors.InsufficientPrivilege), self.db.transaction():
            self.db.execute('delete from public.completed_roads')
        with self.assertRaises(psycopg.errors.InsufficientPrivilege), self.db.transaction():
            self.db.execute('insert into public.workspace_members values (%s,%s)', (self.workspace, self.outsider))

    def test_undo_cannot_overwrite_intervening_staff_action(self):
        self.user(self.alice)
        revision = self.mark()['revision']
        self.user(self.bob)
        self.mark(False)
        self.mark(True)
        with self.assertRaises(psycopg.errors.SerializationFailure), self.db.transaction():
            self.mark(False, revision)


if __name__ == '__main__':
    unittest.main()
