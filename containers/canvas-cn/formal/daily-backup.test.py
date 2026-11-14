"""Daily handover recovers service and replication before archiving."""
import importlib.util
import pathlib
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('daily', pathlib.Path(__file__).with_name('daily-backup.py'))
daily = importlib.util.module_from_spec(spec)
spec.loader.exec_module(daily)


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
    def test_sync_can_remove_restart_fence_before_compression_finishes(self):
        host = Host()
        with patch.object(daily.release, 'smoke', return_value=True):
            daily.daily(host)
        self.assertLess(host.events.index('resume'), host.events.index('sync'))
        self.assertLess(host.events.index('sync'), host.events.index('archive'))

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
            daily.daily(host)
        self.assertIn('archive', host.events)

    def test_failed_restart_still_restores_paused_timers(self):
        host = Host('start')
        with patch.object(daily.release, 'smoke', return_value=False):
            with self.assertRaises(OSError):
                daily.daily(host)
        self.assertIn('sync', host.events)
        self.assertNotIn('resume', host.events)
        self.assertNotIn('archive', host.events)


if __name__ == '__main__':
    unittest.main()
