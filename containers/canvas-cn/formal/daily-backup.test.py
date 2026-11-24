"""Daily handover recovers service and replication before archiving."""
import importlib.util
import pathlib
import hashlib
import json
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('daily', pathlib.Path(__file__).with_name('daily-backup.py'))
daily = importlib.util.module_from_spec(spec)
spec.loader.exec_module(daily)
spec = importlib.util.spec_from_file_location('scheduler', pathlib.Path(__file__).with_name('daily-backup-schedule.py'))
scheduler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scheduler)


class Host:
    def __init__(self, failure=None):
        self.events = []
        self.failure = failure

    def event(self, name):
        self.events.append(name)
        if name == self.failure:
            raise OSError(name)

    def recover_entrance(self, *args): self.event('recover')
    def backup(self, *args): self.event('seed')
    def pause_background(self): self.event('pause')
    def hold(self): self.event('hold')
    def systemctl(self, action, unit): self.event(action)
    def capture(self, *args): self.event('capture')
    def resume(self): self.event('resume')
    def resume_background(self): self.event('sync')
    def finish_backup(self): self.event('archive')
    def discard_backup(self): self.event('discard')


class DailyTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.serving = pathlib.Path(self.directory.name)
        (self.serving / 'release.json').write_text('{"files":{}}')
    def test_sync_can_remove_restart_fence_before_compression_finishes(self):
        host = Host()
        with patch.object(daily.release, 'smoke', return_value=True):
            daily.daily(host, self.serving)
        self.assertLess(host.events.index('resume'), host.events.index('sync'))
        self.assertLess(host.events.index('sync'), host.events.index('archive'))

    def test_only_a_clean_drain_refusal_gets_the_reserved_retry_exit(self):
        class Busy(Host):
            def hold(self):
                raise daily.release._maintenance.HoldRefused('busy-drain')
        host = Busy()
        run = daily.daily
        with patch.object(daily, 'daily', side_effect=lambda: run(host, self.serving)):
            self.assertEqual(daily.attempt(), 42)
        self.assertEqual(host.events[-2:], ['discard', 'sync'])
        self.assertNotIn('capture', host.events)
        for refusal in (daily.release._maintenance.HoldRefused('active-write'),
                        daily.release._maintenance.HoldRefused('uncertain-write'),
                        RuntimeError('entrance-hold-refused')):
            with self.subTest(reason=str(refusal)), patch.object(daily, 'daily', side_effect=refusal):
                with self.assertRaises(type(refusal)):
                    daily.attempt()

    @unittest.skipUnless(shutil.which('flock') and pathlib.Path('/usr/bin/bash').exists(), 'Linux maintenance locks')
    def test_scheduled_retries_are_bounded_and_release_the_real_lock_between_attempts(self):
        script, lock = self.serving / 'attempt.sh', self.serving / 'release.lock'
        for results, code, delays, archived in [
                ('42 0', 0, [60], 1), ('42 42 42', 1, [60, 180], 0), ('1', 1, [], 0)]:
            with self.subTest(results=results):
                (self.serving / 'results').write_text(results)
                script.write_text('cd "$(dirname "$0")"\nread -r status rest < results || :\n'
                                  'printf "%s" "$rest" > results\n'
                                  'if test "$status" = 0; then echo archive >> published; fi\nexit "$status"\n')
                published = self.serving / 'published'
                published.unlink(missing_ok=True)
                pauses = []
                def wait(seconds):
                    subprocess.run(['flock', '-n', lock, 'true'], check=True)
                    pauses.append(seconds)
                with patch.object(scheduler.time, 'sleep', side_effect=wait):
                    self.assertEqual(scheduler.scheduled(script, lock), code)
                self.assertEqual(pauses, delays)
                self.assertEqual(len(published.read_text().splitlines()) if published.exists() else 0, archived)
                self.assertEqual((self.serving / 'results').read_text(), '')

    def test_a_slow_first_attempt_cannot_start_a_retry_with_less_than_the_original_unit_budget(self):
        from configparser import ConfigParser
        config = ConfigParser()
        config.read(pathlib.Path(__file__).with_name('canvas-cn-formal-backup.service'))
        expires = int(config['Service']['TimeoutStartSec'])
        with patch.object(scheduler.time, 'monotonic', side_effect=[0, expires - 1799]), \
                patch.object(scheduler.time, 'sleep'), \
                patch.object(scheduler.subprocess, 'run', return_value=subprocess.CompletedProcess([], 42)) as run:
            self.assertEqual(scheduler.scheduled(), 1)
        run.assert_called_once()

    def test_restarting_on_an_empty_store_cannot_release_the_held_entrance(self):
        declaration = b'{"read":1,"write":0}'
        name = daily.release._maintenance.OPERATION_FORMAT
        (self.serving / name).write_bytes(declaration)
        (self.serving / 'release.json').write_text(json.dumps({'files': {name: hashlib.sha256(declaration).hexdigest()}}))
        class ManagedHost(Host):
            def hold(self, reader=None): self.event('hold')
            def seal_operation_inventory(self, pending): self.event('seal')
        host = ManagedHost()
        pending = [{'operationVersion': 1, 'count': 1, 'blocked': 0}]
        with patch.object(daily.release, 'smoke', return_value=True), \
                patch.object(daily.release._maintenance, 'project_operations', side_effect=[pending, [], []]):
            with self.assertRaisesRegex(RuntimeError, 'backup-runtime-not-ready'):
                daily.daily(host, self.serving)
        self.assertNotIn('resume', host.events)
        self.assertNotIn('archive', host.events)

    def test_slow_start_gets_same_readiness_budget_as_release(self):
        host = Host()
        # Real readiness checker, isolated at its HTTP boundary: the runtime
        # refuses its first three connections, then returns the expected APIs.
        class Response:
            status = 200
            def __init__(self, body): self.body = body
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, limit): return self.body
        class Opener:
            attempts = 0
            def open(self, request, timeout):
                self.attempts += 1
                if self.attempts <= 3:
                    raise OSError('starting')
                if request.full_url.endswith('/status'):
                    return Response(b'{"origin":"cn","fenced":false}')
                if request.full_url.endswith('.json'):
                    return Response(b'{"version":"1"}')
                return Response(b'<div id="root"></div>')
        with patch.object(daily.release.urllib.request, 'build_opener', return_value=Opener()), \
             patch.object(pathlib.Path, 'read_text', return_value='test-token'), \
             patch.object(daily.release.time, 'sleep'):
            daily.daily(host, self.serving)
        self.assertIn('archive', host.events)

    def test_failed_restart_still_restores_paused_timers(self):
        host = Host('start')
        with patch.object(daily.release, 'smoke', return_value=False):
            with self.assertRaises(OSError):
                daily.daily(host, self.serving)
        self.assertIn('sync', host.events)
        self.assertNotIn('resume', host.events)
        self.assertNotIn('archive', host.events)


if __name__ == '__main__':
    unittest.main()
