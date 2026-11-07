"""Exercise the installed command through its loopback HTTP boundary."""
import json
import pathlib
import subprocess
import sys
import tempfile
import threading
import unittest
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class SyncTickTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        (self.root / 'sync-admin-token').write_text('private-admin-test')
        (self.root / 'sync-inbound-token').write_text('private-peer-test')
        self.pump = {'status': 'caught-up'}
        self.status = dict(origin='cn', sequence=4, acknowledged=4, pending=0,
                           journalBytes=100, oldestPendingAt=None, fenced=False)
        self.redirect = False
        self.requests = []
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def answer(self, method):
                owner.requests.append((method, self.path, self.headers.get('Authorization')))
                if owner.redirect:
                    self.send_response(302)
                    self.send_header('Location', '/must-not-follow')
                    self.end_headers()
                    return
                self.send_response(200)
                self.end_headers()
                payload = owner.pump if method == 'POST' else owner.status
                self.wfile.write(json.dumps(payload).encode())

            def do_POST(self):
                self.answer('POST')

            def do_GET(self):
                self.answer('GET')

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def run_tick(self):
        result = subprocess.run([
            sys.executable, str(pathlib.Path(__file__).with_name('sync-tick.py')),
            '--origin', f'http://127.0.0.1:{self.server.server_port}',
            '--credentials', str(self.root), '--state', str(self.root / 'monitor.json'),
        ], capture_output=True, text=True, timeout=10)
        self.assertNotIn('private-admin-test', result.stdout + result.stderr)
        self.assertNotIn('private-peer-test', result.stdout + result.stderr)
        return result

    def test_caught_up_reports_success_and_uses_separate_credentials(self):
        result = self.run_tick()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['health'], 'ok')
        self.assertEqual(self.requests, [
            ('POST', '/api/project-sync/run', 'Bearer private-admin-test'),
            ('GET', '/api/project-sync/status', 'Bearer private-peer-test'),
        ])

    def test_http_success_with_retry_is_a_failed_tick(self):
        self.pump = {'status': 'retry'}
        result = self.run_tick()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout)['reason'], 'retry')

    def test_blocked_and_disabled_are_failures(self):
        for state in ['blocked', 'disabled']:
            self.pump = {'status': state}
            with self.subTest(state=state):
                self.assertNotEqual(self.run_tick().returncode, 0)

    def test_old_outbound_work_is_not_healthy_progress(self):
        self.pump = {'status': 'sent'}
        self.status.update(pending=1, oldestPendingAt=(datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat())
        result = self.run_tick()
        self.assertEqual(json.loads(result.stdout)['reason'], 'replication-lag')
        self.assertNotEqual(result.returncode, 0)

    def test_capacity_and_fence_are_reported(self):
        for extra, reason in [({'journalBytes': 1024**3}, 'journal-capacity'), ({'fenced': True}, 'write-fenced')]:
            self.status.update(journalBytes=100, fenced=False)
            self.status.update(extra)
            with self.subTest(reason=reason):
                result = self.run_tick()
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(json.loads(result.stdout)['reason'], reason)

    def test_missing_status_fields_fail_closed(self):
        self.status = {'origin': 'cn'}
        self.assertNotEqual(self.run_tick().returncode, 0)

    def test_redirect_is_not_followed(self):
        self.redirect = True
        self.assertNotEqual(self.run_tick().returncode, 0)
        self.assertEqual(len(self.requests), 1)
        self.assertEqual(json.loads((self.root / 'monitor.json').read_text())['health'], 'failed')

    def test_transport_failure_preserves_last_catch_up_time(self):
        previous = (datetime.now(timezone.utc) - timedelta(seconds=30)).timestamp()
        (self.root / 'monitor.json').write_text(json.dumps({'lastCaughtUpAt': previous}))
        self.redirect = True
        self.assertNotEqual(self.run_tick().returncode, 0)
        self.assertEqual(json.loads((self.root / 'monitor.json').read_text())['lastCaughtUpAt'], previous)

    def test_legacy_zero_checkpoint_does_not_report_epoch_lag(self):
        (self.root / 'monitor.json').write_text(json.dumps({'lastCaughtUpAt': 0}))
        self.pump = {'status': 'sent'}
        result = self.run_tick()
        self.assertEqual(result.returncode, 0)
        self.assertLess(json.loads(result.stdout)['lagSeconds'], 5)

    def test_prolonged_inbound_progress_raises_lag(self):
        self.pump = {'status': 'sent'}
        old = (datetime.now(timezone.utc) - timedelta(minutes=5)).timestamp()
        (self.root / 'monitor.json').write_text(json.dumps({'lastCaughtUpAt': old}))
        result = self.run_tick()
        self.assertEqual(json.loads(result.stdout)['reason'], 'replication-lag')
        self.assertNotEqual(result.returncode, 0)


if __name__ == '__main__':
    unittest.main()
