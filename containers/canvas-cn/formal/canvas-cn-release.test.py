"""Exercise the release runner against an in-memory Production and host."""
import argparse
import hashlib
import importlib.util
import json
import os
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    'release', pathlib.Path(__file__).with_name('canvas-cn-release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
OLD = 'a' * 40
NEW = 'b' * 40


def digest(data):
    return hashlib.sha256(data).hexdigest()


class FakeProduction:
    def __init__(self, files, commit=NEW):
        self.served = {}
        self.requests = []
        manifest_files = {}
        for path, data in files.items():
            manifest_files[path] = digest(data)
            if path.startswith('assets/assets/'):
                self.served['/assets/' + path[len('assets/assets/'):]] = data
            elif path.startswith('assets/'):
                self.served[f'/regional-release/{commit}/root/' + path[len('assets/'):] + '.bin'] = data
            else:
                self.served[f'/regional-release/{commit}/' + path] = data
        manifest = {'schemaVersion': 1, 'commit': commit, 'files': manifest_files, 'sources': {
            'assets/assets/': '/assets/', 'assets/': f'/regional-release/{commit}/root/{{path}}.bin',
            '': f'/regional-release/{commit}/'}}
        text = json.dumps(manifest).encode()
        self.served[f'/regional-release/{commit}/release.json'] = text
        self.served['/regional-release/current.json'] = json.dumps({
            'commit': commit, 'manifest': f'/regional-release/{commit}/release.json',
            'sha256': digest(text)}).encode()

    def get(self, path, limit=0):
        self.requests.append(path)
        return self.served[path]


class FakeHost:
    def __init__(self, active=(), broken_nginx=False):
        self.calls = []
        self.active_units = set(active)
        self.broken_nginx = broken_nginx

    def systemctl(self, *args, check=True):
        self.calls.append(('systemctl',) + args)

    def active(self, unit):
        return unit in self.active_units

    def backup(self, target):
        self.calls.append(('backup', target.name))

    def nginx_reload(self):
        self.calls.append(('nginx',))
        if self.broken_nginx:
            self.broken_nginx = False
            raise OSError('nginx -t failed')


CONFIG = b'(name = "X", text = embed "/sync-inbound-token"),\n(name = "W", text = embed "/project-writes-enabled")'


def can_symlink():
    with tempfile.TemporaryDirectory() as d:
        try:
            (pathlib.Path(d) / 'link').symlink_to(d)
            return True
        except OSError:
            return False


@unittest.skipUnless(can_symlink(), 'the release link is a Linux symlink')
class ReleaseTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = pathlib.Path(self.temp.name)
        self.releases = root / 'releases'
        self.units = root / 'units'
        self.credentials = root / 'credentials'
        for d in [self.releases, self.units, self.credentials]:
            d.mkdir()
        (self.credentials / 'sync-inbound-token').write_text('peer')
        (self.credentials / 'project-writes-enabled').write_text('false')
        old = self.releases / OLD
        (old / 'assets/assets').mkdir(parents=True)
        (old / 'assets/assets/kept.js').write_bytes(b'kept')
        (old / 'config.capnp').write_bytes(CONFIG)
        (old / 'nginx.conf').write_bytes(b'private site')
        (old / 'release.json').write_text(json.dumps({'commit': OLD, 'files': {
            'assets/assets/kept.js': digest(b'kept'), 'config.capnp': digest(CONFIG)}}))
        (self.units / 'canvas-cn-formal.service').write_text('old')
        (old / '.verified').write_text('')
        self.current = root / 'current'
        self.current.symlink_to(old)
        self.nginx = root / 'nginx.conf'
        release.NGINX_SITE = str(self.nginx)
        self.public_config = root / 'public.json'
        release.PUBLIC_CONFIG = str(self.public_config)
        self.files = {
            'assets/assets/kept.js': b'kept',
            'assets/assets/new.js': b'new',
            'assets/index.html': b'<div id="root"></div>',
            'config.capnp': CONFIG,
            'nginx.conf': b'server {}',
            'nginx-public.conf': b'listen @LISTEN@; host @UPSTREAM_HOST@; filing @FILING_NUMBER@;',
            'canvas-cn-formal.service': b'new',
            'canvas-cn-scheduled.timer': b'timer',
            'canvas-cn-formal-backup.timer': b'backup timer',
            'canvas-cn-resource-sync.timer': b'replication',
        }
        self.smoked = True
        release.smoke = lambda *args, **kwargs: self.smoked
        self.sleep = release.time.sleep
        release.time.sleep = lambda seconds: None

    def tearDown(self):
        release.time.sleep = self.sleep
        self.temp.cleanup()

    def args(self, settle=600):
        return argparse.Namespace(current=str(self.current), releases=str(self.releases),
                                  credentials=str(self.credentials), unit_dir=str(self.units),
                                  state=str(pathlib.Path(self.temp.name) / 'state.json'),
                                  settle_seconds=settle, local='http://127.0.0.1:1',
                                  smoke_attempts=1, keep=10, origin='https://example.test')

    def test_waits_for_production_to_settle_then_installs_changed_files(self):
        production, host = FakeProduction(self.files), FakeHost({'canvas-cn-project-sync.timer'})
        first = release.tick(self.args(), host, production, now=1000)
        self.assertEqual(first['status'], 'settling')
        self.assertEqual(host.calls, [])
        state = {'pending': first['pending']}
        pathlib.Path(self.args().state).write_text(json.dumps(state))
        result = release.tick(self.args(), host, production, now=1700)
        self.assertEqual(result['status'], 'installed')
        self.assertEqual(self.current.resolve().name, NEW)
        self.assertNotIn('/assets/kept.js', production.requests)
        self.assertIn('/assets/new.js', production.requests)
        self.assertEqual((self.units / 'canvas-cn-formal.service').read_text(), 'new')
        self.assertEqual(self.nginx.read_bytes(), b'server {}')
        self.assertIn(('systemctl', 'enable', '--now', 'canvas-cn-scheduled.timer'), host.calls)
        self.assertIn(('systemctl', 'enable', '--now', 'canvas-cn-formal-backup.timer'), host.calls)
        self.assertNotIn(('systemctl', 'enable', '--now', 'canvas-cn-resource-sync.timer'), host.calls)
        # Only the replication timer that was running is paused and restarted.
        self.assertIn(('systemctl', 'start', 'canvas-cn-project-sync.timer'), host.calls)
        self.assertNotIn(('systemctl', 'start', 'canvas-cn-resource-sync.timer'), host.calls)
        self.assertLess(host.calls.index(('backup', NEW)),
                        host.calls.index(('systemctl', 'restart', 'canvas-cn-formal.service')))
        again = release.tick(self.args(), host, production, now=1800)
        self.assertEqual(again['status'], 'current')

    def test_reads_only_the_small_pointer_while_current(self):
        production = FakeProduction(self.files, commit=OLD)
        result = release.tick(self.args(0), FakeHost(), production, now=1000)
        self.assertEqual(result['status'], 'current')
        self.assertEqual(production.requests, ['/regional-release/current.json'])

    def test_keeps_the_staged_tls_listener_and_filing_number_across_releases(self):
        self.public_config.write_text(json.dumps({'mode': 'stage', 'filingNumber': '京ICP备12345678号-1'}))
        result = release.tick(self.args(0), FakeHost(), FakeProduction(self.files), now=1000)
        self.assertEqual(result['status'], 'installed')
        site = self.nginx.read_text(encoding='utf-8')
        self.assertIn('listen 127.0.0.1:8443 ssl;', site)
        self.assertIn('filing 京ICP备12345678号-1;', site)

    def test_follows_a_rollback_to_before_the_public_template(self):
        self.public_config.write_text(json.dumps({'mode': 'stage', 'filingNumber': ''}))
        old_files = {path: data for path, data in self.files.items() if path != 'nginx-public.conf'}
        result = release.tick(self.args(0), FakeHost(), FakeProduction(old_files), now=1000)
        self.assertEqual(result['status'], 'installed')
        self.assertEqual(self.nginx.read_bytes(), b'server {}')
        self.assertTrue(self.public_config.exists())

    def test_public_mode_requires_a_filing_number_before_changing_nginx(self):
        self.nginx.write_text('private site')
        host = FakeHost()
        with self.assertRaises(ValueError):
            release.configure_public(self.current.resolve(), 'open', '', self.credentials, host)
        self.assertEqual(self.nginx.read_text(), 'private site')
        self.assertFalse(self.public_config.exists())
        self.assertEqual(host.calls, [])

    @unittest.skipIf(os.name == 'nt', 'systemd and POSIX permissions')
    def test_activated_release_is_readable_under_the_service_umask(self):
        mask = os.umask(0o077)
        try:
            result = release.tick(self.args(0), FakeHost(), FakeProduction(self.files), now=1000)
        finally:
            os.umask(mask)
        self.assertEqual(result['status'], 'installed')
        target = self.current.resolve()
        self.assertEqual(target.stat().st_mode & 0o777, 0o755)
        self.assertEqual((target / 'assets').stat().st_mode & 0o777, 0o755)
        self.assertEqual((target / 'assets/index.html').stat().st_mode & 0o777, 0o644)

    def test_refuses_a_symlink_left_in_the_download_tree(self):
        partial = self.releases / 'incoming.partial'
        partial.mkdir()
        (partial / 'outside').symlink_to(self.credentials, target_is_directory=True)
        with self.assertRaises(release.ReleaseError):
            release.tick(self.args(0), FakeHost(), FakeProduction(self.files), now=1000)
        self.assertEqual(self.current.resolve().name, OLD)

    def test_rolls_back_a_failure_after_the_switch_began(self):
        (self.units / 'canvas-cn-formal.service.d').mkdir()
        self.nginx.write_bytes(b'old site')
        host = FakeHost(broken_nginx=True)
        result = release.tick(self.args(0), host, FakeProduction(self.files), now=1000)
        self.assertEqual(result['status'], 'rolled-back')
        self.assertEqual(self.current.resolve().name, OLD)
        self.assertEqual(self.nginx.read_bytes(), b'old site')
        self.assertEqual((self.units / 'canvas-cn-formal.service').read_text(), 'old')
        self.assertIn(('systemctl', 'restart', 'canvas-cn-formal.service'), host.calls)

    def test_rolls_back_an_unproved_release_left_by_an_interrupted_runner(self):
        new = self.releases / NEW
        new.mkdir()
        (new / 'release.json').write_text(json.dumps({'commit': NEW, 'files': {}}))
        self.current.unlink()
        self.current.symlink_to(new)
        pathlib.Path(self.args().state).write_text(json.dumps({'previous': str(self.releases / OLD)}))
        self.nginx.write_bytes(b'unproved public site')
        self.smoked = False
        result = release.tick(self.args(0), FakeHost(), FakeProduction(self.files), now=1000)
        self.assertEqual(result['status'], 'rolled-back')
        self.assertEqual(self.current.resolve().name, OLD)
        self.assertEqual(self.nginx.read_bytes(), b'private site')

    def test_records_a_failed_backup_so_the_runtime_is_not_stopped_every_minute(self):
        host = FakeHost()
        host.backup = lambda target: (_ for _ in ()).throw(OSError('disk full'))
        result = release.tick(self.args(0), host, FakeProduction(self.files), now=1000)
        self.assertEqual((result['status'], result['failedCommit']), ('backup-failed', NEW))
        self.assertEqual(self.current.resolve().name, OLD)

    def test_retries_a_dropped_read_and_keeps_verified_files_between_ticks(self):
        production = FakeProduction(self.files)
        served = production.get
        drops = {'/assets/new.js': 1}

        def flaky(path, limit=0):
            if drops.get(path):
                drops[path] -= 1
                raise TimeoutError('The read operation timed out')
            return served(path, limit)
        production.get = flaky
        # Progress from an interrupted download of an earlier commit is reused.
        partial = self.releases / ('c' * 40 + '.partial')
        (partial / 'assets').mkdir(parents=True)
        (partial / 'assets/index.html').write_bytes(b'<div id="root"></div>')
        result = release.tick(self.args(0), FakeHost(), production, now=1000)
        self.assertEqual(result['status'], 'installed')
        self.assertNotIn(f'/regional-release/{NEW}/root/index.html.bin', production.requests)
        self.assertEqual(drops['/assets/new.js'], 0)
        self.assertFalse(partial.exists())

    def test_keeps_the_serving_release_chunks_for_open_tabs(self):
        old = self.releases / OLD
        (old / 'assets/assets/retired.js').write_bytes(b'retired')
        record = json.loads((old / 'release.json').read_text())
        record['files']['assets/assets/retired.js'] = digest(b'retired')
        (old / 'release.json').write_text(json.dumps(record))
        production = FakeProduction(self.files)
        release.tick(self.args(0), FakeHost(), production, now=1000)
        installed = self.releases / NEW
        self.assertEqual((installed / 'assets/assets/retired.js').read_bytes(), b'retired')
        self.assertNotIn('assets/assets/retired.js', json.loads((installed / 'release.json').read_text())['files'])
        self.assertNotIn('/assets/retired.js', production.requests)

    def test_gives_up_on_a_missing_file_without_retrying(self):
        import urllib.error
        production = FakeProduction(self.files)
        calls = []

        def missing(path, limit=0):
            calls.append(path)
            if path == '/assets/new.js':
                raise urllib.error.HTTPError(path, 404, 'missing', {}, None)
            return production.served[path]
        production.get = missing
        with self.assertRaises(Exception):
            release.tick(self.args(0), FakeHost(), production, now=1000)
        self.assertEqual(calls.count('/assets/new.js'), 1)
        self.assertEqual(self.current.resolve().name, OLD)

    def test_refuses_a_file_whose_bytes_differ_from_the_manifest(self):
        production = FakeProduction(self.files)
        production.served['/assets/new.js'] = b'tampered'
        with self.assertRaises(release.ReleaseError):
            release.tick(self.args(0), FakeHost(), production, now=1000)
        self.assertEqual(self.current.resolve().name, OLD)

    def test_refuses_before_switching_when_a_host_switch_is_missing(self):
        (self.credentials / 'project-writes-enabled').unlink()
        host = FakeHost()
        with self.assertRaises(release.ReleaseError):
            release.tick(self.args(0), host, FakeProduction(self.files), now=1000)
        self.assertEqual(self.current.resolve().name, OLD)
        self.assertEqual(host.calls, [])
        (self.credentials / 'project-writes-enabled').write_text('yes')
        with self.assertRaises(release.ReleaseError):
            release.tick(self.args(0), host, FakeProduction(self.files), now=1000)

    def test_switches_back_when_the_new_release_fails_its_smoke_test(self):
        self.smoked = False
        result = release.tick(self.args(0), FakeHost(), FakeProduction(self.files), now=1000)
        self.assertEqual(result['status'], 'rolled-back')
        self.assertEqual(result['failedCommit'], NEW)
        self.assertEqual(self.current.resolve().name, OLD)
        self.assertEqual((self.units / 'canvas-cn-formal.service').read_text(), 'old')
        self.assertFalse((self.units / 'canvas-cn-scheduled.timer').exists())
        pathlib.Path(self.args().state).write_text(json.dumps(result))
        refused = release.tick(self.args(0), FakeHost(), FakeProduction(self.files), now=1100)
        self.assertEqual(refused['status'], 'refused')


if __name__ == '__main__':
    unittest.main()
