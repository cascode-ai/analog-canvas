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


class OperationReaderTest(unittest.TestCase):
    def test_a_legacy_declaration_requires_a_live_v1_receipt_reader(self):
        upgraded = False
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_POST(self):
                request = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                if request['action'] == 'capabilities' and not upgraded:
                    self.send_response(400)
                    self.end_headers()
                    return
                self.send_response(200)
                self.end_headers()
                body = ({'version':2, 'operationVersions':[1], 'writeVersion':1, 'pending':[]}
                        if upgraded else {'version':1, 'ticket':request['ticket'], 'state':'unknown'})
                self.wfile.write(json.dumps(body).encode())
        with http.server.HTTPServer(('127.0.0.1', 0), Handler) as server:
            url = f'http://127.0.0.1:{server.server_port}'
            thread = threading.Thread(target=server.serve_forever)
            thread.start()
            try:
                self.assertEqual(maintenance.project_operations(url, (0, 0)), [])
                upgraded = True
                with self.assertRaisesRegex(ValueError, 'capabilities-unavailable'):
                    maintenance.project_operations(url, (0, 0))
            finally:
                server.shutdown()
                thread.join()
        with self.assertRaises(OSError):
            maintenance.project_operations(url, (0, 0))
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(ValueError, 'invalid-operation-release-manifest'):
                maintenance.operation_format(pathlib.Path(folder), {})
            with self.assertRaisesRegex(ValueError, 'invalid-operation-declaration-digest'):
                maintenance.operation_format(pathlib.Path(folder), {'files': {maintenance.OPERATION_FORMAT: None}})


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

    def test_the_control_client_accepts_only_the_versioned_busy_reason_on_a_hold_conflict(self):
        payload = b'{"version":1,"reason":"busy-drain"}'
        status = 409
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_POST(self):
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(payload)
        with tempfile.TemporaryDirectory() as folder:
            control = str(pathlib.Path(folder) / 'control.sock')
            with socketserver.UnixStreamServer(control, Handler) as server, patch.object(maintenance, 'CONTROL', control):
                thread = threading.Thread(target=lambda: server.serve_forever(poll_interval=.01))
                thread.start()
                try:
                    with self.assertRaises(maintenance.HoldRefused) as busy:
                        maintenance.entrance('hold-project-operations/1')
                    self.assertEqual(busy.exception.reason, 'busy-drain')
                    for status, payload in ((503, payload), (409, b'{"version":true,"reason":"busy-drain"}'), (409, b'')):
                        with self.assertRaises(RuntimeError) as unknown:
                            maintenance.entrance('hold-project-operations/1')
                        self.assertNotIsInstance(unknown.exception, maintenance.HoldRefused)
                finally:
                    server.shutdown()
                    thread.join()


@unittest.skipUnless(shutil.which('rsync'), 'requires Linux rsync')
class SnapshotTest(unittest.TestCase):
    def test_restore_preserves_pending_input_and_receipt_and_refuses_a_legacy_reader(self):
        import sqlite3
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            data = root / 'data'
            (data / 'state/projects').mkdir(parents=True)
            (data / 'artifacts').mkdir()
            db = data / 'state/projects/synthetic.sqlite'
            with sqlite3.connect(db) as store:
                store.execute('CREATE TABLE intents (payload TEXT, receipt TEXT)')
                store.execute('INSERT INTO intents VALUES (?,?)', ('synthetic drawing', 'synthetic receipt'))
            release, legacy = root / 'reader', root / 'legacy'
            release.mkdir()
            legacy.mkdir()
            declaration = b'{"read":1,"write":0}'
            (release / maintenance.OPERATION_FORMAT).write_bytes(declaration)
            (release / 'release.json').write_text(json.dumps({'commit':'a'*40, 'files':{
                maintenance.OPERATION_FORMAT:hashlib.sha256(declaration).hexdigest()}}))
            (legacy / 'release.json').write_text('{"files":{}}')
            pending = [{'operationVersion':1,'count':1,'blocked':0}]
            backup = Snapshot(data, root / 'backups')
            backup.prepare()
            backup.capture(release / 'release.json', pending)
            result = backup.publish()
            with self.assertRaisesRegex(ValueError, 'incompatible-restore-reader'):
                maintenance.verify_operation_restore(result, legacy)
            self.assertEqual(maintenance.verify_operation_restore(result, release), pending)
            restored = root / 'restored.sqlite'
            with tarfile.open(result / 'state.tar.gz') as archive:
                restored.write_bytes(archive.extractfile('state/projects/synthetic.sqlite').read())
            with sqlite3.connect(restored) as store:
                self.assertEqual(store.execute('SELECT * FROM intents').fetchall(), [('synthetic drawing','synthetic receipt')])
            with patch.object(maintenance, 'project_operations', return_value=[]):
                with self.assertRaisesRegex(ValueError, 'inventory-mismatch'):
                    maintenance.verify_operation_restore(result, release, 'http://127.0.0.1:8792')

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
            record.write_text('{"files":{}}')
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
            record.write_text(json.dumps({'commit': 'e' * 40, 'files': {}}))
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
            record.write_text('{"files":{}}')
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
                with self.assertRaises(maintenance.BackupHeadroom):
                    snapshot.admit_capture()
                self.assertFalse((backups / 'capacity.json').exists())
                with self.assertRaises(maintenance.BackupHeadroom):
                    snapshot.prepare()
                with patch.object(pathlib.Path, 'write_text',
                                  side_effect=OSError(maintenance.errno.ENOSPC, 'No space left')):
                    with self.assertRaises(maintenance.BackupHeadroom):
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
            record.write_text('{"commit":"old","files":{}}')
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
            record.write_text('{"commit":"old","files":{}}')
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
