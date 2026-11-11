"""Publication pump acceptance through its CLI and peer HTTP boundary."""
import gzip
import hashlib
import importlib.util
import json
import pathlib
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SCRIPT = pathlib.Path(__file__).with_name('resource-sync-tick.py')


def request_body(handler):
    body = handler.rfile.read(int(handler.headers['Content-Length']))
    return json.loads(gzip.decompress(body) if handler.headers.get('Content-Encoding') == 'gzip' else body)


class Peers:
    """Two loopback regions answering one Handler, with runner files in a temporary folder."""

    def __init__(self, handler, sources=()):
        self.servers = []
        for region in ['cn', 'overseas']:
            server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
            server.region = region
            threading.Thread(target=server.serve_forever, daemon=True).start()
            self.servers.append(server)
        self.folder = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.folder.name)
        (self.root/'token').write_text('test-peer-token')
        (self.root/'sources').write_text(json.dumps({'sources': [{'key': key} for key in sources]}))
        (self.root/'config').write_text(json.dumps({
            'localOrigin': f'http://127.0.0.1:{self.servers[0].server_port}',
            'peerOrigin': f'http://127.0.0.1:{self.servers[1].server_port}',
            'localTokenFile': str(self.root/'token'), 'peerTokenFile': str(self.root/'token')}))

    def tick(self, seconds='1'):
        command = [sys.executable, str(SCRIPT), '--config', str(self.root/'config'),
                   '--sources', str(self.root/'sources'), '--state', str(self.root/'state'),
                   '--max-seconds', seconds]
        result = subprocess.run(command, text=True, capture_output=True, timeout=60)
        self.output = result.stdout + result.stderr
        return result

    def state(self):
        return json.loads((self.root/'state').read_text())

    def close(self):
        for server in self.servers:
            server.shutdown()
            server.server_close()
        self.folder.cleanup()


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
                cursor[0] = json.loads(request_body(self)['payload'])['sequence']
                self.respond({'sequence': cursor[0]})

        peers = Peers(Handler)
        try:
            old = time.time()-300
            (peers.root/'state').write_text(json.dumps({'lastCaughtUpAt': old}))
            for phase in ['fail', 'partial', 'caught']:
                mode[0] = phase
                result = peers.tick()
                self.assertNotIn('test-peer-token', peers.output)
                state = peers.state()
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
            peers.close()

    def test_one_failing_stream_does_not_stop_the_others(self):
        """Each stream keeps its own status; payloads cross gzipped and bounded."""
        cursors = {}
        exported = {('overseas', 'gallery'): 1, ('cn', 'ds-interactions'): 1, ('overseas', 'ds-opens'): 1}
        encodings = []
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def respond(self, value, status=200, raw=None):
                body = raw if raw is not None else json.dumps(value).encode()
                compress = raw is None and 'gzip' in (self.headers.get('Accept-Encoding') or '')
                self.send_response(status)
                if compress or raw is not None:
                    self.send_header('Content-Encoding', 'gzip')
                self.end_headers()
                self.wfile.write(gzip.compress(body) if compress else body)

            def do_GET(self):
                region, stream = self.server.region, self.path.split('/')[3]
                after = cursors.get((region, stream), 0)
                if stream == 'bomb' and self.path.endswith('/status'):
                    # More than the 50 MiB response bound once inflated.
                    return self.respond(None, raw=gzip.compress(b' ' * (51 * 1024 * 1024)))
                if self.path.endswith('/status'):
                    return self.respond({'region': region, 'received': {'epoch': 'e', 'sequence': after}})
                after = int(self.path.split('after=')[1])
                if after < exported.get((region, stream), 0):
                    payload = json.dumps({'origin': region, 'stream': stream, 'after': after, 'sequence': after + 1})
                    return self.respond({'payload': payload, 'digest': hashlib.sha256(payload.encode()).hexdigest()})
                self.respond({'event': None, 'region': region, 'epoch': 'e', 'sequence': after})

            def do_POST(self):
                encodings.append(self.headers.get('Content-Encoding'))
                region, stream = self.server.region, self.path.split('/')[3]
                if stream == 'components':
                    return self.respond({'error': 'resource-schema-newer'}, 409)
                cursors[(region, stream)] = json.loads(request_body(self)['payload'])['sequence']
                self.respond({'sequence': cursors[(region, stream)]})

        peers = Peers(Handler, sources=['ds', 'bomb'])
        exported[('overseas', 'components')] = 1
        try:
            result = peers.tick('30')
            self.assertEqual(result.returncode, 1)
            self.assertNotIn('test-peer-token', peers.output)
            self.assertNotIn('"payload"', peers.output)
            state = peers.state()
            self.assertEqual((state['health'], state['reason'], state['status']), ('error', 'blocked', 'blocked'))
            streams = state['streams']
            self.assertEqual(set(streams), {'gallery', 'components', 'ds', 'bomb', 'gallery-interactions',
                                            'ds-interactions', 'bomb-interactions', 'gallery-opens', 'ds-opens', 'bomb-opens',
                                            'gallery-activity', 'ds-activity', 'bomb-activity'})
            self.assertEqual(streams['components'], {'status': 'blocked', 'reason': 'resource-schema-newer',
                                                     'cursor': {'cn': None, 'overseas': 0}})
            self.assertEqual(streams['bomb']['status'], 'blocked')
            self.assertEqual(streams['bomb']['reason'], 'oversized-response')
            self.assertEqual(streams['gallery'], {'status': 'caught-up', 'reason': None,
                                                  'cursor': {'cn': 1, 'overseas': 0}})
            self.assertEqual(streams['ds-interactions']['cursor'], {'cn': 0, 'overseas': 1})
            self.assertEqual(streams['ds-opens']['cursor'], {'cn': 1, 'overseas': 0})
            for name in ['ds', 'gallery-interactions', 'ds-interactions', 'bomb-interactions']:
                self.assertEqual(streams[name]['status'], 'caught-up')
            self.assertEqual(state['transferred'], 3)
            self.assertEqual(set(encodings), {'gzip'})
        finally:
            peers.close()

    def test_timeouts_scale_with_payload_and_tick_budget(self):
        spec = importlib.util.spec_from_file_location('resource_sync_tick', SCRIPT)
        tick = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(tick)
        self.assertEqual(tick.request_timeout(0, 300), 15)
        self.assertEqual(tick.request_timeout(10 * 256 * 1024, 300), 25)
        self.assertEqual(tick.request_timeout(10 * 256 * 1024 + 1, 300), 26)
        self.assertEqual(tick.request_timeout(24 * 1024 * 1024 * 2, 300), 120)
        self.assertEqual(tick.request_timeout(24 * 1024 * 1024, 7.5), 7.5)

    def test_tick_budget_allows_240_seconds(self):
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                region = self.server.region
                body = ({'region': region, 'received': None} if self.path.endswith('/status')
                        else {'event': None, 'region': region, 'epoch': 'e', 'sequence': 0})
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps(body).encode())

        peers = Peers(Handler)
        try:
            self.assertEqual(peers.tick('240').returncode, 0)
            self.assertEqual(peers.state()['status'], 'caught-up')
            self.assertEqual(peers.tick('241').returncode, 2)
        finally:
            peers.close()


if __name__ == '__main__':
    unittest.main()
