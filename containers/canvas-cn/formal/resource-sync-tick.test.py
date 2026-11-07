"""Publication pump acceptance through its CLI and peer HTTP boundary."""
import hashlib
import json
import pathlib
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class PumpTest(unittest.TestCase):
    def test_failure_and_partial_progress_do_not_reset_lag(self):
        mode = ['fail']
        cursor = [0]
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def respond(self, value):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps(value).encode())

            def do_GET(self):
                if mode[0] == 'fail':
                    self.send_response(503)
                    self.end_headers()
                elif self.path.endswith('/status'):
                    self.respond({'region': self.server.region, 'received': {'epoch': 'e', 'sequence': cursor[0]}})
                elif mode[0] == 'partial':
                    time.sleep(0.025)
                    payload = json.dumps({'origin': self.server.region, 'stream': self.path.split('/')[3], 'after': cursor[0], 'sequence': cursor[0]+1})
                    self.respond({'payload': payload, 'digest': hashlib.sha256(payload.encode()).hexdigest()})
                else:
                    self.respond({'event': None, 'region': self.server.region, 'epoch': 'e', 'sequence': cursor[0]})

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                cursor[0] = json.loads(body['payload'])['sequence']
                self.respond({'sequence': cursor[0]})

        servers = []
        try:
            for region in ['cn', 'overseas']:
                server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
                server.region = region
                threading.Thread(target=server.serve_forever, daemon=True).start()
                servers.append(server)
            with tempfile.TemporaryDirectory() as folder:
                root = pathlib.Path(folder)
                (root/'token').write_text('test-peer-token')
                (root/'sources').write_text('{"sources": []}')
                (root/'config').write_text(json.dumps({
                    'localOrigin': f'http://127.0.0.1:{servers[0].server_port}',
                    'peerOrigin': f'http://127.0.0.1:{servers[1].server_port}',
                    'localTokenFile': str(root/'token'), 'peerTokenFile': str(root/'token')}))
                old = time.time()-300
                (root/'state').write_text(json.dumps({'lastCaughtUpAt': old}))
                command = [sys.executable, str(pathlib.Path(__file__).with_name('resource-sync-tick.py')),
                           '--config', str(root/'config'), '--sources', str(root/'sources'), '--state', str(root/'state'), '--max-seconds', '1']
                for phase in ['fail', 'partial', 'caught']:
                    mode[0] = phase
                    result = subprocess.run(command, text=True, capture_output=True, timeout=10)
                    self.assertNotIn('test-peer-token', result.stdout+result.stderr)
                    state = json.loads((root/'state').read_text())
                    if phase == 'caught':
                        self.assertEqual(result.returncode, 0)
                        self.assertEqual(state['status'], 'caught-up')
                        self.assertGreater(state['lastCaughtUpAt'], old)
                    else:
                        self.assertEqual(result.returncode, 1)
                        self.assertEqual(state['lastCaughtUpAt'], old)
                        self.assertEqual(state['health'], 'error')
                        if phase == 'partial':
                            self.assertGreater(cursor[0], 0)
        finally:
            for server in servers:
                server.shutdown()
                server.server_close()


if __name__ == '__main__':
    unittest.main()
