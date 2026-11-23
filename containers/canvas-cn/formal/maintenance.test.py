"""A completed backup restores exact stopped-state bytes, never a live seed."""
import pathlib
import shutil
import tarfile
import tempfile
import unittest
import importlib.util
import http.server
import os
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
