"""Alert command acceptance at the external mail HTTP boundary."""
import json
import pathlib
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class AlertTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        (self.root / 'config.json').write_text(json.dumps({'apiKey': 'private-alert-key', 'from': 'sender@example.test', 'to': 'recipient@example.test'}))
        self.calls = []
        self.reject = False
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                owner.calls.append((self.headers.get('Idempotency-Key'), json.loads(self.rfile.read(int(self.headers['Content-Length'])))))
                self.send_response(503 if owner.reject else 200)
                self.end_headers()
                self.wfile.write(b'{"id":"accepted-test-id"}')

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.health('ok')

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def health(self, health, age=0):
        (self.root / 'monitor.json').write_text(json.dumps({'health': health, 'reason': 'retry' if health == 'failed' else None, 'lastAttemptAt': time.time() - age}))

    def tick(self, test=False):
        args = [sys.executable, str(pathlib.Path(__file__).with_name('sync-alert.py')),
                '--config', str(self.root / 'config.json'), '--monitor', str(self.root / 'monitor.json'),
                '--state', str(self.root / 'delivery.json'), '--mail-endpoint', f'http://127.0.0.1:{self.server.server_port}/emails']
        if test:
            args.append('--test')
        result = subprocess.run(args, capture_output=True, text=True, timeout=10)
        self.assertNotIn('private-alert-key', result.stdout + result.stderr)
        return result

    def test_healthy_service_sends_nothing(self):
        self.assertEqual(self.tick().returncode, 0)
        self.assertEqual(self.calls, [])

    def test_failure_is_deduplicated_and_recovery_is_announced(self):
        self.health('failed')
        self.assertEqual(self.tick().returncode, 0)
        self.assertEqual(self.tick().returncode, 0)
        self.assertEqual(len(self.calls), 1)
        self.health('ok')
        self.assertEqual(self.tick().returncode, 0)
        self.assertEqual(len(self.calls), 2)

    def test_stale_tick_is_detected_independently_of_sync_timer(self):
        self.health('ok', age=300)
        self.assertEqual(self.tick().returncode, 0)
        self.assertEqual(len(self.calls), 1)
        self.assertIn('stale-monitor', self.calls[0][1]['text'])

    def test_lost_mail_response_reuses_same_message_and_key(self):
        self.health('failed')
        self.reject = True
        self.assertNotEqual(self.tick().returncode, 0)
        self.reject = False
        self.assertEqual(self.tick().returncode, 0)
        self.assertEqual(self.calls[0], self.calls[1])

    def test_explicit_test_is_sent_once_and_not_followed_by_recovery(self):
        self.assertEqual(self.tick(test=True).returncode, 0)
        self.assertEqual(self.tick(test=True).returncode, 0)
        self.assertEqual(self.tick().returncode, 0)
        self.assertEqual(len(self.calls), 1)

    def test_expired_uncertain_send_requires_reconciliation(self):
        self.reject = True
        self.assertNotEqual(self.tick(test=True).returncode, 0)
        state_path = self.root / 'delivery.json'
        state = json.loads(state_path.read_text())
        state['pending']['createdAt'] = time.time() - 24 * 3600
        state_path.write_text(json.dumps(state))
        self.reject = False
        self.assertNotEqual(self.tick(test=True).returncode, 0)
        self.assertEqual(len(self.calls), 1)
        self.assertIn('pending', json.loads(state_path.read_text()))


if __name__ == '__main__':
    unittest.main()
