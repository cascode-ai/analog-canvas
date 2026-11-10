"""Verify the installed analytics command over its loopback HTTP boundary."""
import json
import pathlib
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class AnalyticsTickTest(unittest.TestCase):
    def test_reports_catchup_and_blocks_on_a_rejected_batch_without_exposing_credentials(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            (root / 'sync-admin-token').write_text('private-analytics-admin')
            requests = []
            response_code = [200]

            class Handler(BaseHTTPRequestHandler):
                def log_message(self, *args):
                    pass

                def do_POST(self):
                    requests.append((self.path, self.headers.get('Authorization')))
                    self.send_response(response_code[0])
                    self.end_headers()
                    self.wfile.write(json.dumps(dict(mode='collector', sequence=4, acknowledged=4,
                                                    pending=0, oldestPendingAt=None)).encode())

            server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                command = [sys.executable, str(pathlib.Path(__file__).with_name('analytics-sync-tick.py')),
                           '--origin', f'http://127.0.0.1:{server.server_port}', '--credentials', str(root),
                           '--state', str(root / 'monitor.json')]
                caught_up = subprocess.run(command, capture_output=True, text=True, timeout=10)
                self.assertEqual(caught_up.returncode, 0, caught_up.stderr)
                self.assertEqual(json.loads(caught_up.stdout)['status'], 'caught-up')
                self.assertEqual(requests, [('/api/analytics-sync/tick', 'Bearer private-analytics-admin')])
                response_code[0] = 409
                blocked = subprocess.run(command, capture_output=True, text=True, timeout=10)
                self.assertEqual(blocked.returncode, 1)
                self.assertEqual(json.loads((root / 'monitor.json').read_text())['reason'], 'blocked')
                self.assertNotIn('private-analytics-admin', caught_up.stdout + caught_up.stderr + blocked.stdout + blocked.stderr)
            finally:
                server.shutdown()
                server.server_close()
                thread.join()


if __name__ == '__main__':
    unittest.main()
