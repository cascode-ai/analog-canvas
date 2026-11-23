"""A completed backup restores exact stopped-state bytes, never a live seed."""
import pathlib
import shutil
import tarfile
import tempfile
import unittest
import importlib.util
import http.server
import os
import json
import hashlib
import mmap
import socketserver
import threading
from unittest.mock import patch
spec = importlib.util.spec_from_file_location('maintenance', pathlib.Path(__file__).with_name('maintenance.py'))
maintenance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(maintenance)
Snapshot = maintenance.Snapshot


@unittest.skipUnless(os.name == 'posix', 'requires a Unix socket')
class EntranceTest(unittest.TestCase):
    def test_status_hold_refusal_and_resume_use_the_private_http_socket(self):
        seen = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                seen.append((self.command, self.path))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"holding":false,"pending":0,"active":1,"uncertain":false}')

            def do_POST(self):
                seen.append((self.command, self.path))
                self.send_response(409 if self.path == '/hold' else 200)
                self.end_headers()

            def log_message(self, *args):
                pass

        with tempfile.TemporaryDirectory() as directory:
            control = str(pathlib.Path(directory) / 'control.sock')
            with socketserver.UnixStreamServer(control, Handler) as server:
                thread = threading.Thread(target=lambda: server.serve_forever(poll_interval=.01))
                thread.start()
                try:
                    with patch.object(maintenance, 'CONTROL', control):
                        self.assertEqual(maintenance.entrance('status'), {
                            'holding': False, 'pending': 0, 'active': 1, 'uncertain': False})
                        with self.assertRaisesRegex(RuntimeError, 'entrance-hold-refused'):
                            maintenance.entrance('hold')
                        self.assertIsNone(maintenance.entrance('resume'))
                finally:
                    server.shutdown()
                    thread.join()
            self.assertEqual(seen, [('GET', '/status'), ('POST', '/hold'), ('POST', '/resume')])


@unittest.skipUnless(shutil.which('rsync'), 'requires Linux rsync')
class SnapshotTest(unittest.TestCase):
    @unittest.skipUnless(os.name == 'posix', 'requires Linux I/O accounting')
    def test_small_edit_to_large_database_fits_the_stopped_write_budget(self):
        import resource

        def output_bytes():
            return 512 * sum(resource.getrusage(who).ru_oublock
                             for who in (resource.RUSAGE_SELF, resource.RUSAGE_CHILDREN))

        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            data = root / 'data'
            (data / 'state' / 'gallery').mkdir(parents=True)
            (data / 'artifacts').mkdir()
            db = data / 'state' / 'gallery' / ('a' * 64 + '.sqlite')
            db.write_bytes(b'A' * (32 * 1024 * 1024))
            record = root / 'release.json'
            record.write_text('{}')
            snapshot = Snapshot(data, root / 'backups')
            with db.open('r+b') as dbfile, mmap.mmap(dbfile.fileno(), 0) as mapped:
                before = output_bytes()
                snapshot.prepare()
                if output_bytes() - before < db.stat().st_size:
                    self.skipTest('filesystem does not account for buffered disk writes')
                mapped[11000:11003] = b'new'
            before = output_bytes()
            snapshot.capture(record)
            self.assertLess(output_bytes() - before, 4 * 1024 * 1024)
            archive = snapshot.publish()
            with tarfile.open(archive / 'state.tar.gz') as bundle:
                self.assertEqual(bundle.extractfile(str(db.relative_to(data))).read(), db.read_bytes())

    def test_published_archives_keep_days_and_releases_after_verified_offsite_restore(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            backups = root / 'backups'
            backups.mkdir()
            digest = hashlib.sha256(b'fixture').hexdigest()

            def past(name, commit):
                folder = backups / name
                folder.mkdir()
                (folder / 'state.tar.gz').write_bytes(b'fixture')
                (folder / 'state.sha256').write_text(digest + '  state.tar.gz')
                (folder / 'release.json').write_text(json.dumps({'commit': commit * 40}))
                return folder

            # One archive a day and a burst of same-day deployments.
            for day in range(1, 10):
                past(f'202611{day:02}T040000Z-daily', 'a')
            for hour in range(16):
                past(f'20261110T{hour:02}0000Z-burst', 'b')
            recent = past('20261111T060000Z-release', 'c')
            past('20261111T070000Z-release', 'd')
            record = root / 'release.json'
            record.write_text(json.dumps({'commit': 'e' * 40}))
            data = root / 'data'
            (data / 'state').mkdir(parents=True)
            (data / 'artifacts').mkdir()

            stamps = iter(['20261112T080000Z', '20261112T090000Z'])

            def publish():
                snapshot = Snapshot(data, backups)
                snapshot.prepare()
                snapshot.capture(record)
                with patch.object(maintenance.time, 'strftime', return_value=next(stamps)):
                    return snapshot.publish()

            publish()
            first = backups / '20261110T010000Z-burst'
            self.assertTrue((backups / '20261106T040000Z-daily').is_dir(), 'the daily point survives a release burst')
            self.assertTrue(first.is_dir(), 'never shorten legacy retention before verifying the off-host restore')
            (backups / 'offsite-restore.json').write_text(json.dumps({
                'archive': recent.name, 'sha256': digest, 'verified': True,
            }))
            newest = publish()
            self.assertEqual({p.name for p in backups.iterdir() if p.is_dir()}, {
                '20261106T040000Z-daily', '20261107T040000Z-daily', '20261108T040000Z-daily',
                '20261109T040000Z-daily', '20261110T150000Z-burst', recent.name,
                '20261111T070000Z-release', newest.name,
            })

    def test_compression_preserves_live_disk_reserve_when_new_assets_do_not_compress(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            data = root / 'data'
            backups = root / 'backups'
            old = backups / '20261120T100000Z-old'
            old.mkdir(parents=True)
            (old / 'state.tar.gz').write_bytes(b'old small archive')
            (data / 'artifacts').mkdir(parents=True)
            (data / 'state').mkdir()
            asset = os.urandom(9 * 1024**2)
            (data / 'artifacts' / 'image').write_bytes(asset)
            record = root / 'release.json'
            record.write_text('{}')
            snapshot = Snapshot(data, backups)
            snapshot.prepare()
            snapshot.capture(record)
            room = iter((2 * 1024**3, 1024**3))
            with patch.object(maintenance.shutil, 'disk_usage',
                              side_effect=lambda _: type('Disk', (), {'free': next(room)})()):
                with self.assertRaisesRegex(RuntimeError, 'backup-headroom'):
                    snapshot.publish()
            self.assertFalse((snapshot.stage / 'state.tar.gz').exists())
            self.assertEqual((snapshot.stage / 'artifacts' / 'image').read_bytes(), asset)
            self.assertEqual(list(backups.glob('20*')), [old])

    def test_insufficient_capture_space_refuses_before_creating_a_seed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            for name in ('state', 'artifacts'):
                (root / 'data' / name).mkdir(parents=True)
            backups = root / 'backups'
            snapshot = Snapshot(root / 'data', backups)
            with patch.object(maintenance.shutil, 'disk_usage', return_value=type('Disk', (), {'free': 1})()):
                with self.assertRaisesRegex(RuntimeError, 'backup-headroom'):
                    snapshot.prepare()
            self.assertEqual(list(backups.glob('.incomplete.*')), [])

    def test_capture_includes_writes_through_an_existing_memory_mapping(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            data = root / 'data'
            (data / 'state').mkdir(parents=True)
            (data / 'artifacts').mkdir()
            db = data / 'state' / 'mapped.sqlite'
            db.write_bytes(b'init')
            record = root / 'release.json'
            record.write_text('{"commit":"old"}')
            snapshot = Snapshot(data, root / 'backups')
            with db.open('r+b') as file, mmap.mmap(file.fileno(), 0) as mapped:
                mapped[:] = b'base'
                snapshot.prepare()
                mapped[:] = b'next'
            snapshot.capture(record)
            archive = snapshot.publish()
            with tarfile.open(archive / 'state.tar.gz') as bundle:
                self.assertEqual(bundle.extractfile('state/mapped.sqlite').read(), b'next')

    def test_final_capture_replaces_changed_bytes_and_removes_deleted_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            data = root / 'data'
            (data / 'state').mkdir(parents=True)
            (data / 'artifacts').mkdir()
            db = data / 'state' / 'example.sqlite'
            db.write_bytes(b'before')
            (data / 'state' / 'deleted').write_text('obsolete')
            record = root / 'release.json'
            record.write_text('{"commit":"old"}')
            snapshot = Snapshot(data, root / 'backups')
            snapshot.prepare()
            self.assertEqual(list((root / 'backups').glob('20*')), [])
            # Same-size writes must not disappear through rsync's quick check.
            original = db.stat()
            db.write_bytes(b'after!')
            import os
            os.utime(db, ns=(original.st_atime_ns, original.st_mtime_ns))
            (data / 'state' / 'deleted').unlink()
            (data / 'artifacts' / 'result').write_bytes(b'result')
            snapshot.capture(record)
            archive = snapshot.publish()
            with tarfile.open(archive / 'state.tar.gz') as bundle:
                self.assertEqual(bundle.extractfile('state/example.sqlite').read(), b'after!')
                self.assertEqual(bundle.extractfile('artifacts/result').read(), b'result')
                self.assertNotIn('state/deleted', bundle.getnames())
            self.assertEqual((archive / 'release.json').read_text(), record.read_text())


if __name__ == '__main__':
    unittest.main()
