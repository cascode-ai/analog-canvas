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
    def test_completed_slow_observation_is_fresh_but_a_stopped_reporter_still_alerts(self):
        (self.root / 'monitor.json').write_text(json.dumps({
            'health': 'ok', 'lastAttemptAt': self.now - 140,
            'lastObservedAt': self.now - 70}))
        self.assertEqual(json.loads(self.tick(scope='Publication').stdout)['result'], 'healthy')
        self.now += 121
        self.tick(scope='Publication')
        self.now += 120
        self.tick(scope='Publication')
        self.assertEqual(len(self.calls), 1)
        self.assertIn('stale-monitor', self.calls[0][1]['text'])

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        (self.root / 'config.json').write_text(json.dumps({'apiKey': 'private-alert-key', 'from': 'sender@example.test', 'to': 'recipient@example.test'}))
        self.calls = []
        self.now = time.time()
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

    def health(self, health, age=0, reason='blocked'):
        (self.root / 'monitor.json').write_text(json.dumps({'health': health, 'reason': reason if health == 'failed' else None, 'lastAttemptAt': self.now - age}))

    def tick(self, test=False, scope=None):
        clocked_cli = '''
import runpy
import sys
import time

now = float(sys.argv[1])
time.time = lambda: now
sys.argv = sys.argv[2:]
runpy.run_path(sys.argv[0], run_name='__main__')
'''
        args = [sys.executable, '-c', clocked_cli, str(self.now),
                str(pathlib.Path(__file__).with_name('sync-alert.py')),
                '--config', str(self.root / 'config.json'), '--monitor', str(self.root / 'monitor.json'),
                '--state', str(self.root / 'delivery.json'), '--mail-endpoint', f'http://127.0.0.1:{self.server.server_port}/emails']
        if test:
            args.append('--test')
        if scope:
            args.extend(['--scope', scope])
        result = subprocess.run(args, capture_output=True, text=True, timeout=10)
        self.assertNotIn('private-alert-key', result.stdout + result.stderr)
        return result

    def publication(self, cn, overseas=0, overseas_status='caught-up', cn_status='sent'):
        (self.root / 'monitor.json').write_text(json.dumps({
            'health': 'error', 'reason': 'replication-lag', 'lastAttemptAt': self.now,
            'streams': {'image2net': {'directions': {
                'cn': {'status': cn_status, 'cursor': cn},
                'overseas': {'status': overseas_status, 'cursor': overseas}}}}}))

    def test_bulk_progress_stays_quiet_but_a_stalled_direction_alerts(self):
        self.publication(10)
        self.assertEqual(self.tick(scope='Publication').returncode, 0)
        self.now += 180
        self.publication(35)
        self.assertEqual(self.tick(scope='Publication').returncode, 0)
        self.assertEqual(self.calls, [])

        # CN continues, but that cannot hide the opposite direction stalling.
        self.publication(35, overseas_status='retry')
        self.assertEqual(self.tick(scope='Publication').returncode, 0)
        self.now += 300
        self.publication(80, overseas_status='retry')
        self.assertEqual(self.tick(scope='Publication').returncode, 0)
        self.assertEqual(len(self.calls), 1)
        self.assertIn('replication-lag', self.calls[0][1]['text'])

    def test_progress_cannot_hide_thirty_minutes_of_backlog_or_a_block(self):
        self.publication(10)
        self.assertEqual(self.tick(scope='Publication').returncode, 0)
        self.now += 1800
        self.publication(500)
        self.assertEqual(self.tick(scope='Publication').returncode, 0)
        self.assertEqual(len(self.calls), 1)
        self.health('failed', reason='blocked')
        self.assertEqual(self.tick(scope='Publication').returncode, 0)
        self.assertEqual(len(self.calls), 2)
        self.assertIn('Status: blocked', self.calls[-1][1]['text'])

    def test_unknown_cursor_cannot_claim_progress(self):
        self.publication(None, cn_status='retry')
        self.assertEqual(self.tick(scope='Publication').returncode, 0)
        self.now += 120
        self.publication(None, cn_status='retry')
        self.assertEqual(self.tick(scope='Publication').returncode, 0)
        self.assertEqual(len(self.calls), 1)

    def test_healthy_service_sends_nothing(self):
        self.assertEqual(self.tick().returncode, 0)
        self.assertEqual(self.calls, [])

    def test_brief_recovery_does_not_close_an_incident(self):
        self.health('failed')
        self.assertEqual(self.tick().returncode, 0)
        self.health('ok')
        self.assertEqual(self.tick().returncode, 0)
        self.now += 180
        self.health('ok')
        self.assertEqual(self.tick().returncode, 0)
        self.now += 60
        self.health('failed')
        self.assertEqual(self.tick().returncode, 0)
        self.assertEqual(len(self.calls), 1)

    def test_short_maintenance_and_replication_delays_stay_quiet(self):
        for scope, reason, age in [
            ('Project', 'write-fenced', 0),
            ('Project', 'replication-lag', 0),
            ('Publication', None, 121),
            ('Publication', 'transport-or-invalid-status', 0),
        ]:
            with self.subTest(scope=scope, reason=reason):
                self.health('failed' if reason else 'ok', age=age, reason=reason)
                self.assertEqual(self.tick(scope=scope).returncode, 0)
                self.now += 45
                self.health('ok')
                self.assertEqual(self.tick(scope=scope).returncode, 0)
        self.assertEqual(self.calls, [])

    def test_sustained_outage_reports_once_until_stably_recovered(self):
        self.health('failed', reason='retry')
        self.assertEqual(self.tick().returncode, 0)
        self.now += 75
        self.health('failed', reason='replication-lag')
        self.assertEqual(self.tick().returncode, 0)
        self.assertEqual(self.calls, [])
        self.now += 45
        self.health('failed', reason='replication-lag')
        self.assertEqual(self.tick().returncode, 0)
        self.assertEqual(len(self.calls), 1)
        self.assertIn('Status: replication-lag', self.calls[0][1]['text'])

        self.health('ok')
        self.assertEqual(self.tick().returncode, 0)
        self.now += 45
        self.health('failed', reason='write-fenced')
        self.assertEqual(self.tick().returncode, 0)
        self.assertEqual(len(self.calls), 1)

        self.health('ok')
        self.assertEqual(self.tick().returncode, 0)
        self.now += 599
        self.health('ok')
        self.assertEqual(self.tick().returncode, 0)
        self.assertEqual(len(self.calls), 1)
        self.now += 1
        self.assertEqual(self.tick().returncode, 0)
        self.assertEqual(len(self.calls), 2)
        self.assertIn('RECOVERED', self.calls[1][1]['subject'])

    def test_publication_alert_identifies_the_independent_service(self):
        self.health('failed')
        self.assertEqual(self.tick(scope='Publication').returncode, 0)
        self.assertEqual(self.calls[0][1]['subject'], '[Canvas CN] Publication sync FAILURE')
        self.assertIn('canvas-cn-resource-sync.service', self.calls[0][1]['text'])

    def test_failure_is_deduplicated_and_recovery_is_announced(self):
        self.health('failed')
        self.assertEqual(self.tick().returncode, 0)
        self.assertEqual(self.tick().returncode, 0)
        self.assertEqual(len(self.calls), 1)
        self.health('ok')
        self.assertEqual(self.tick().returncode, 0)
        self.assertEqual(len(self.calls), 1)
        self.now += 600
        self.health('ok')
        self.assertEqual(self.tick().returncode, 0)
        self.assertEqual(len(self.calls), 2)

    def test_journal_capacity_alert_escalates_an_open_sync_failure(self):
        self.health('failed', reason='replication-lag')
        self.assertEqual(self.tick().returncode, 0)
        self.now += 120
        self.health('failed', reason='replication-lag')
        self.assertEqual(self.tick().returncode, 0)
        self.assertEqual(len(self.calls), 1)

        self.health('failed', reason='journal-capacity')
        self.assertEqual(self.tick().returncode, 0)
        self.assertEqual(len(self.calls), 2)
        self.assertIn('Status: journal-capacity', self.calls[-1][1]['text'])
        self.assertEqual(self.tick().returncode, 0)
        self.assertEqual(len(self.calls), 2)

    def test_open_incident_never_sends_an_hourly_reminder(self):
        self.health('failed')
        self.assertEqual(self.tick().returncode, 0)
        self.now += 3590
        self.health('ok')
        self.assertEqual(self.tick().returncode, 0)

        self.now += 10
        self.health('failed', reason='write-fenced')
        self.assertEqual(self.tick().returncode, 0)
        self.assertEqual(len(self.calls), 1)
        self.now += 120
        self.health('failed', reason='write-fenced')
        self.assertEqual(self.tick().returncode, 0)
        self.assertEqual(len(self.calls), 1)

    def test_healthy_tick_breaks_failure_confirmation_during_mail_retry(self):
        self.health('failed', reason='retry')
        self.assertEqual(self.tick().returncode, 0)
        self.now += 30
        self.reject = True
        self.assertNotEqual(self.tick(test=True).returncode, 0)

        self.now += 30
        self.health('ok')
        self.reject = False
        self.assertEqual(self.tick().returncode, 0)
        self.assertEqual(self.calls[0], self.calls[1])

        self.now += 61
        self.health('failed', reason='retry')
        self.assertEqual(self.tick().returncode, 0)
        self.assertEqual(len(self.calls), 2)

    def test_existing_retry_window_survives_upgrade(self):
        state_path = self.root / 'delivery.json'
        state_path.write_text(json.dumps({'retrySince': self.now - 121}))
        self.health('failed', reason='retry')
        self.assertEqual(self.tick().returncode, 0)
        self.assertEqual(len(self.calls), 1)

    def test_stale_tick_is_detected_independently_of_sync_timer(self):
        self.health('ok', age=121)
        self.assertEqual(self.tick().returncode, 0)
        self.now += 60
        self.assertEqual(self.tick().returncode, 0)
        self.assertEqual(self.calls, [])
        self.now += 60
        self.assertEqual(self.tick().returncode, 0)
        self.assertEqual(len(self.calls), 1)
        self.assertIn('stale-monitor', self.calls[0][1]['text'])

    def test_release_failure_is_immediate_but_recovery_must_stay_healthy(self):
        self.health('failed', reason='release-rolled-back')
        self.assertEqual(self.tick(scope='Release').returncode, 0)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.calls[0][1]['subject'], '[Canvas CN] Release sync FAILURE')

        self.health('ok')
        self.assertEqual(self.tick(scope='Release').returncode, 0)
        self.assertEqual(len(self.calls), 1)
        self.now += 60
        self.health('failed', reason='release-failed')
        self.assertEqual(self.tick(scope='Release').returncode, 0)
        self.assertEqual(len(self.calls), 1)
        self.health('ok')
        self.assertEqual(self.tick(scope='Release').returncode, 0)
        self.now += 599
        self.health('ok')
        self.assertEqual(self.tick(scope='Release').returncode, 0)
        self.assertEqual(len(self.calls), 1)
        self.now += 1
        self.assertEqual(self.tick(scope='Release').returncode, 0)
        self.assertEqual(len(self.calls), 2)
        self.assertEqual(self.calls[1][1]['subject'], '[Canvas CN] Release sync RECOVERED')

    def test_release_retry_grace_resets_after_health(self):
        self.health('failed', reason='retry')
        self.assertEqual(self.tick(scope='Release').returncode, 0)
        self.now += 45
        self.health('ok')
        self.assertEqual(self.tick(scope='Release').returncode, 0)

        self.now += 80
        self.health('failed', reason='retry')
        self.assertEqual(self.tick(scope='Release').returncode, 0)
        self.assertEqual(self.calls, [])
        self.now += 120
        self.health('failed', reason='retry')
        self.assertEqual(self.tick(scope='Release').returncode, 0)
        self.assertEqual(len(self.calls), 1)
        self.assertIn('Status: retry', self.calls[0][1]['text'])

    def test_lost_mail_response_reuses_same_message_and_key(self):
        self.health('failed')
        self.reject = True
        self.assertNotEqual(self.tick().returncode, 0)
        self.reject = False
        self.assertEqual(self.tick().returncode, 0)
        self.assertEqual(self.calls[0], self.calls[1])

    def test_urgent_condition_survives_retry_of_an_earlier_alert(self):
        self.health('failed', reason='retry')
        self.assertEqual(self.tick().returncode, 0)
        self.now += 120
        self.health('failed', reason='retry')
        self.reject = True
        self.assertNotEqual(self.tick().returncode, 0)

        self.now += 30
        self.health('failed', reason='journal-capacity')
        self.reject = False
        self.assertEqual(self.tick().returncode, 0)
        self.assertEqual(self.calls[0], self.calls[1])

        self.now += 30
        self.health('ok')
        self.assertEqual(self.tick().returncode, 0)
        self.assertEqual(len(self.calls), 3)
        self.assertIn('Status: journal-capacity', self.calls[-1][1]['text'])

    def test_urgent_condition_survives_retry_of_confirmed_recovery(self):
        self.health('failed')
        self.assertEqual(self.tick().returncode, 0)
        self.health('ok')
        self.assertEqual(self.tick().returncode, 0)
        self.now += 600
        self.health('ok')
        self.reject = True
        self.assertNotEqual(self.tick().returncode, 0)

        self.now += 30
        self.health('failed', reason='journal-capacity')
        self.reject = False
        self.assertEqual(self.tick().returncode, 0)
        self.assertEqual(self.calls[1], self.calls[2])

        self.now += 30
        self.health('ok')
        self.assertEqual(self.tick().returncode, 0)
        self.assertEqual(len(self.calls), 4)
        self.assertIn('Status: journal-capacity', self.calls[-1][1]['text'])

    def test_recovery_confirmation_continues_during_failure_delivery_retry(self):
        self.health('failed')
        self.reject = True
        self.assertNotEqual(self.tick().returncode, 0)
        self.now += 30
        self.health('ok')
        self.assertNotEqual(self.tick().returncode, 0)

        self.now += 600
        self.health('ok')
        self.reject = False
        self.assertEqual(self.tick().returncode, 0)
        self.assertEqual(self.calls[0], self.calls[2])
        self.assertEqual(self.tick().returncode, 0)
        self.assertEqual(len(self.calls), 4)
        self.assertIn('RECOVERED', self.calls[-1][1]['subject'])

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
