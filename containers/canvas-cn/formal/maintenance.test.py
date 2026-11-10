"""A completed backup restores exact stopped-state bytes, never a live seed."""
import pathlib
import shutil
import tarfile
import tempfile
import unittest
import importlib.util
spec = importlib.util.spec_from_file_location('maintenance', pathlib.Path(__file__).with_name('maintenance.py'))
maintenance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(maintenance)
Snapshot = maintenance.Snapshot


@unittest.skipUnless(shutil.which('rsync'), 'requires Linux rsync')
class SnapshotTest(unittest.TestCase):
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
