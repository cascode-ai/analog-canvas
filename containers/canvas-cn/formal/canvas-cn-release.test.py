"""Exercise the release runner against an in-memory Production and host."""
import argparse
import hashlib
import importlib.util
import json
import os
import pathlib
import re
import tempfile
import unittest
import urllib.error
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    'release', pathlib.Path(__file__).with_name('canvas-cn-release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
OLD = 'a' * 40
NEW = 'b' * 40
check_readiness = release.smoke


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
        pointer = {
            'commit': commit, 'manifest': f'/regional-release/{commit}/release.json',
            'sha256': digest(text), 'attempt': '123-1'}
        self.served['/regional-release/current.json'] = json.dumps(pointer).encode()
        self.proof_path = f"/api/regional-release/verification/{commit}/{digest(text)}/123-1"
        self.proof = json.dumps({'schemaVersion': 1, 'commit': commit,
                                'sha256': digest(text), 'attempt': '123-1', 'verified': True}).encode()
        self.served[self.proof_path] = self.proof

    def get(self, path, limit=0):
        self.requests.append(path)
        if path not in self.served:
            raise urllib.error.HTTPError('https://example.test' + path, 404, 'missing', {}, None)
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

    def hold(self):
        self.calls.append(('hold',))

    def capture(self, serving):
        self.calls.append(('capture', serving.name))

    def resume(self):
        self.calls.append(('resume',))

    def finish_backup(self):
        self.calls.append(('archive',))

    def discard_backup(self):
        pass

    def recover_entrance(self, local, credentials):
        pass

    def pause_background(self):
        self.paused = [timer for timer in release.SYNC_TIMERS if self.active(timer)]
        for timer in self.paused:
            self.systemctl('stop', timer, check=False)

    def resume_background(self):
        for timer in getattr(self, 'paused', []):
            self.systemctl('start', timer, check=False)

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


class ReadinessTest(unittest.TestCase):
    def test_accepts_ready_runtime_without_a_fixed_two_second_pause(self):
        with tempfile.TemporaryDirectory() as directory:
            credentials = pathlib.Path(directory)
            (credentials / 'sync-inbound-token').write_text('peer')
            clock, requests = [0.0], []
            def open_request(request, timeout):
                requests.append(clock[0])
                if len(requests) == 1:
                    raise urllib.error.URLError('starting')
                body = (b'<div id="root"></div>' if request.full_url.endswith('/') else
                        b'{"version":"test"}' if request.full_url.endswith('mcp-manifest.json') else
                        b'{"origin":"cn"}')
                return nullcontext(SimpleNamespace(status=200, read=lambda size: body))
            with patch.object(release.urllib.request, 'build_opener', return_value=SimpleNamespace(open=open_request)), \
                    patch.object(release.time, 'monotonic', side_effect=lambda: clock[0]), \
                    patch.object(release.time, 'sleep', side_effect=lambda seconds: clock.__setitem__(0, clock[0]+seconds)):
                self.assertTrue(check_readiness('http://localhost', credentials))
            self.assertLess(requests[1], .5)
            self.assertGreater(requests[1], 0)

    def test_final_body_arriving_after_the_budget_is_not_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            credentials = pathlib.Path(directory)
            (credentials / 'sync-inbound-token').write_text('peer')
            clock = [0.0]
            def open_request(request, timeout):
                def read(size):
                    if request.full_url.endswith('/'):
                        return b'<div id="root"></div>'
                    if request.full_url.endswith('mcp-manifest.json'):
                        return b'{"version":"test"}'
                    clock[0] = 61
                    return b'{"origin":"cn"}'
                return nullcontext(SimpleNamespace(status=200, read=read))
            with patch.object(release.urllib.request, 'build_opener', return_value=SimpleNamespace(open=open_request)), \
                    patch.object(release.time, 'monotonic', side_effect=lambda: clock[0]):
                self.assertFalse(check_readiness('http://localhost', credentials))

    def test_slow_failures_count_toward_the_readiness_budget(self):
        with tempfile.TemporaryDirectory() as directory:
            credentials = pathlib.Path(directory)
            (credentials / 'sync-inbound-token').write_text('peer')
            clock = [0.0]
            def open_request(request, timeout):
                clock[0] += timeout
                raise urllib.error.URLError('timeout')
            with patch.object(release.urllib.request, 'build_opener', return_value=SimpleNamespace(open=open_request)), \
                    patch.object(release.time, 'monotonic', side_effect=lambda: clock[0]), \
                    patch.object(release.time, 'sleep', side_effect=lambda seconds: clock.__setitem__(0, clock[0]+seconds)):
                self.assertFalse(check_readiness('http://localhost', credentials))
            self.assertAlmostEqual(clock[0], 60)


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

    def test_an_available_release_without_overseas_verification_never_installs(self):
        production, host = FakeProduction(self.files), FakeHost()
        del production.served[production.proof_path]
        result = release.tick(self.args(0), host, production, now=1000)
        self.assertEqual(result['status'], 'awaiting-verification')
        self.assertEqual(self.current.resolve().name, OLD)
        self.assertEqual(host.calls, [])

    def test_stability_starts_at_proof_and_a_rerun_cannot_reuse_old_proof(self):
        production, host = FakeProduction(self.files), FakeHost()
        del production.served[production.proof_path]
        args = self.args(120)
        def tick(at):
            result = release.tick(args, host, production, now=at)
            pathlib.Path(args.state).write_text(json.dumps(result))
            return result['status']
        self.assertEqual(tick(1000), 'awaiting-verification')
        production.served[production.proof_path] = production.proof
        self.assertEqual(tick(2000), 'settling')
        pointer = json.loads(production.served['/regional-release/current.json'])
        pointer['attempt'] = '123-2'
        production.served['/regional-release/current.json'] = json.dumps(pointer).encode()
        self.assertEqual(tick(2200), 'awaiting-verification')
        new_path = production.proof_path.replace('/123-1', '/123-2')
        # A wrong receipt body fails too, even at the requested path.
        production.served[new_path] = production.proof
        self.assertEqual(tick(2300), 'awaiting-verification')
        proof = json.loads(production.proof)
        proof['attempt'] = '123-2'
        production.served[new_path] = json.dumps(proof).encode()
        self.assertEqual(tick(2400), 'settling')
        self.assertEqual(tick(2519), 'settling')
        self.assertEqual(host.calls, [])
        self.assertEqual(tick(2520), 'installed')
        self.assertEqual(self.current.resolve().name, NEW)

    def test_source_changed_during_download_does_not_restart_the_site(self):
        production, host = FakeProduction(self.files), FakeHost()
        original = production.get
        reads = 0
        def get(path, limit=0):
            nonlocal reads
            if path == '/regional-release/current.json':
                reads += 1
                if reads > 1:
                    return FakeProduction(self.files, OLD).get(path)
            return original(path, limit)
        production.get = get
        result = release.tick(self.args(0), host, production, now=1000)
        self.assertEqual(result['status'], 'source-changed')
        self.assertEqual(host.calls, [])
        self.assertEqual(self.current.resolve().name, OLD)

    def test_observed_rollback_resets_stability_in_the_persisted_runner(self):
        production = FakeProduction(self.files)
        pointer = production.served['/regional-release/current.json']
        args = self.args(120)
        argv = ['release', '--current', args.current, '--releases', args.releases,
                '--credentials', args.credentials, '--unit-dir', args.unit_dir,
                '--state', args.state, '--settle-seconds', '120']
        def run(at):
            with patch('sys.argv', argv), patch.object(release, 'Fetcher', return_value=production), \
                    patch.object(release.time, 'time', return_value=at), \
                    patch.object(release, 'Host', return_value=FakeHost()):
                release.main()
            return json.loads(pathlib.Path(args.state).read_text())
        self.assertEqual(run(1000)['status'], 'settling')
        production.served['/regional-release/current.json'] = FakeProduction(self.files, OLD).served['/regional-release/current.json']
        self.assertEqual(run(1060)['status'], 'current')
        production.served['/regional-release/current.json'] = pointer
        self.assertEqual(run(1120)['status'], 'settling')
        self.assertEqual(run(1121)['pending']['firstSeen'], 1120)

    def test_final_probe_failure_retries_without_install_or_permanent_refusal(self):
        production, host = FakeProduction(self.files), FakeHost()
        original = production.get
        reads = 0
        def get(path, limit=0):
            nonlocal reads
            if path == '/regional-release/current.json':
                reads += 1
                if reads == 3:
                    raise urllib.error.HTTPError('https://example.test', 503, 'unavailable', {}, None)
            return original(path, limit)
        production.get = get
        with self.assertRaises(urllib.error.HTTPError):
            release.tick(self.args(0), host, production, now=1000)
        self.assertEqual(self.current.resolve().name, OLD)
        self.assertNotIn(('systemctl', 'restart', 'canvas-cn-formal.service'), host.calls)
        self.assertEqual(release.tick(self.args(0), host, production, now=1100)['status'], 'installed')

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
        self.assertLess(host.calls.index(('systemctl', 'start', 'canvas-cn-project-sync.timer')),
                        host.calls.index(('archive',)))
        self.assertNotIn(('systemctl', 'start', 'canvas-cn-resource-sync.timer'), host.calls)
        lifecycle = [call for call in host.calls if call[0] in ('hold', 'capture', 'resume', 'archive') or
                     (call[0] == 'systemctl' and call[-1] == 'canvas-cn-formal.service')]
        self.assertEqual(lifecycle, [('hold',), ('systemctl', 'stop', 'canvas-cn-formal.service'),
                                    ('capture', OLD), ('systemctl', 'start', 'canvas-cn-formal.service'),
                                    ('resume',), ('archive',)])
        again = release.tick(self.args(), host, production, now=1800)
        self.assertEqual(again['status'], 'current')

    def test_reads_only_the_small_pointer_while_current(self):
        production = FakeProduction(self.files, commit=OLD)
        result = release.tick(self.args(0), FakeHost(), production, now=1000)
        self.assertEqual(result['status'], 'current')
        self.assertEqual(production.requests, ['/regional-release/current.json'])

    def test_updates_the_existing_host_monitor_without_enabling_a_second_timer(self):
        (self.units / 'canvas-ops-monitor.service').write_bytes(b'legacy monitor')
        self.files['host_monitor.py'] = b'monitor'
        self.files['observations.py'] = b'observations'
        self.files['canvas-ops-monitor.service'] = b'ExecStart=/usr/bin/python3 "@RELEASE@/host_monitor.py"'
        self.files['canvas-ops-monitor.timer'] = b'existing schedule'
        host = FakeHost({'canvas-ops-monitor.timer'})
        result = release.tick(self.args(0), host, FakeProduction(self.files), now=1000)
        self.assertEqual(result['status'], 'installed')
        self.assertEqual((self.units / 'canvas-ops-monitor.service').read_text(),
                         f'ExecStart=/usr/bin/python3 "{self.releases.parent / "monitor-releases" / NEW}/host_monitor.py"')
        self.assertEqual((self.units / 'canvas-ops-monitor.timer').read_bytes(), b'existing schedule')
        self.assertNotIn(('systemctl', 'enable', '--now', 'canvas-ops-monitor.timer'), host.calls)
        self.assertNotIn(('systemctl', 'restart', 'canvas-ops-monitor.service'), host.calls)

    def test_failed_release_restores_the_previous_monitor_unit(self):
        unit = self.units / 'canvas-ops-monitor.service'
        unit.write_bytes(b'legacy monitor')
        self.files['host_monitor.py'] = b'monitor'
        self.files['observations.py'] = b'observations'
        self.files['canvas-ops-monitor.service'] = b'candidate monitor'
        self.files['canvas-ops-monitor.timer'] = b'candidate timer'
        result = release.tick(self.args(0), FakeHost(broken_nginx=True),
                              FakeProduction(self.files), now=1000)
        self.assertEqual(result['status'], 'rolled-back')
        self.assertEqual(unit.read_bytes(), b'legacy monitor')
        self.assertFalse((self.units / 'canvas-ops-monitor.timer').exists())

    def test_older_release_retains_the_pinned_monitor_source_when_pruning(self):
        pinned = self.releases.parent / 'monitor-releases' / ('c' * 40)
        pinned.mkdir(parents=True)
        (pinned / 'host_monitor.py').write_text('monitor')
        unit = self.units / 'canvas-ops-monitor.service'
        unit.write_text(f'ExecStart=/usr/bin/python3 "{pinned}/host_monitor.py"')
        args = self.args(0)
        args.keep = 0
        result = release.tick(args, FakeHost(), FakeProduction(self.files), now=1000)
        self.assertEqual(result['status'], 'installed')
        # This is also the pre-monitor installer's pruning algorithm.
        release.prune(self.releases, keep={self.current.resolve()}, count=0)
        self.assertTrue((pinned / 'host_monitor.py').is_file())
        self.assertIn(str(pinned), unit.read_text())

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

    def test_uncertain_writes_report_failure_without_stopping_the_serving_release(self):
        host = FakeHost()
        host.backup = lambda target: (_ for _ in ()).throw(release.ReleaseError('uncertain-write'))
        result = release.tick(self.args(0), host, FakeProduction(self.files), now=1000)
        self.assertEqual((result['health'], result['status']), ('failed', 'uncertain-write'))
        self.assertEqual(self.current.resolve().name, OLD)
        self.assertNotIn(('systemctl', 'stop', 'canvas-cn-formal.service'), host.calls)

    def test_a_failed_candidate_restores_old_code_before_resuming_held_requests(self):
        host = FakeHost()
        answers = iter([False, True])
        release.smoke = lambda *args, **kwargs: next(answers)
        result = release.tick(self.args(0), host, FakeProduction(self.files), now=1000)
        self.assertEqual(result['status'], 'rolled-back')
        self.assertEqual(self.current.resolve().name, OLD)
        self.assertEqual(host.calls.count(('resume',)), 1)
        self.assertGreater(host.calls.index(('resume',)),
                           host.calls.index(('systemctl', 'restart', 'canvas-cn-formal.service')))

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


class HostDrainTest(unittest.TestCase):
    def test_an_uncertain_write_fences_before_copying_data(self):
        with patch.object(pathlib.Path, 'is_socket', return_value=True), \
                patch.object(release, 'entrance', return_value={'uncertain': True}), \
                patch.object(release, 'Snapshot') as snapshot:
            with self.assertRaisesRegex(release.ReleaseError, 'uncertain-write'):
                release.Host().backup(pathlib.Path('/candidate'))
            snapshot.assert_not_called()

    def test_a_new_installer_restores_only_timers_paused_by_the_interrupted_one(self):
        calls = []
        def run(args, **kwargs):
            calls.append(tuple(args))
            if 'is-active' in args:
                return SimpleNamespace(returncode=0 if args[-1] == 'canvas-cn-project-sync.timer' else 3)
            return SimpleNamespace(returncode=0)
        with tempfile.TemporaryDirectory() as directory:
            release.Host(run=run, maintenance_dir=directory).pause_background()
            # New process, no in-memory list from the interrupted installer.
            release.Host(run=run, maintenance_dir=directory).resume_background()
        starts = [call for call in calls if 'start' in call]
        self.assertEqual(starts, [('systemctl', 'start', 'canvas-cn-project-sync.timer')])

    def test_running_oneshot_job_defers_handover(self):
        host = release.Host(run=lambda args, **kwargs: SimpleNamespace(
            returncode=0 if 'show' in args else 3, stdout=b'activating\n'))
        with patch.object(release.time, 'monotonic', side_effect=[0, 91]), \
                patch.object(release, 'entrance') as entrance:
            with self.assertRaisesRegex(release.ReleaseError, 'background-busy'):
                host.hold()
            entrance.assert_not_called()

    def test_background_tick_finishes_before_the_public_entrance_is_held(self):
        busy = True
        def run(args, **kwargs):
            return SimpleNamespace(returncode=0, stdout=b'activating\n' if busy else b'inactive\n')
        def finish_tick(_seconds):
            nonlocal busy
            entrance.assert_not_called()
            busy = False
        with patch.object(release.time, 'monotonic', side_effect=[0, 4]), \
                patch.object(release.time, 'sleep', side_effect=finish_tick), \
                patch.object(release, 'entrance') as entrance:
            release.Host(run=run).hold()
        entrance.assert_called_once_with('hold')


class PeerEntranceTest(unittest.TestCase):
    def test_fixed_peer_routes_use_the_canonical_worker_authority(self):
        config = release.nginx_config(pathlib.Path(__file__).parent, {
            'mode': 'open', 'filingNumber': '京ICP备2026077076号-1',
        }).decode('utf-8')
        peer = config.split('server_name canvas-hangzhou-origin.tokenzhang.com;', 1)[1]
        # The fixed service address differs from AUTH_REGIONAL_CLIENT.clientOrigin.
        # Every peer API must reach the Worker's authentication, not invalid-host.
        hosts = re.findall(r'proxy_set_header Host ([^;]+);', peer)
        self.assertEqual(set(hosts), {'analog-canvas.tokenzhang.com'})


if __name__ == '__main__':
    unittest.main()
