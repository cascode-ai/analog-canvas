import tempfile
import unittest
import hashlib
import http.client
import json
from types import SimpleNamespace
from pathlib import Path
import importlib.util
spec = importlib.util.spec_from_file_location('host_monitor', Path(__file__).with_name('host_monitor.py'))
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)
evaluate, notify, load = monitor.evaluate, monitor.notify, monitor.load


def sample(at=1000):
    return dict(at=at, boot='boot-a', cpuTotal=10000, cpuIdle=5000,
                rxBytes=0, txBytes=0, diskPct=35, inodePct=5, memoryPct=10,
                backupAgeHours=1, certificateDays=80, services={'nginx': True})


class MonitorTests(unittest.TestCase):
    def test_version_lag_uses_verified_production_during_an_ingress_fence(self):
        installed = 'a' * 40
        production = 'b' * 40

        class Production:
            def get(self, path, limit):
                digest = 'c' * 64
                if path == '/regional-release/current.json':
                    return json.dumps({'commit': production, 'sha256': digest,
                                       'manifest': f'/regional-release/{production}/release.json',
                                       'attempt': '123-1'}).encode()
                if path == f'/api/regional-release/verification/{production}/{digest}/123-1':
                    return json.dumps({'schemaVersion': 1, 'commit': production,
                                       'sha256': digest, 'attempt': '123-1',
                                       'verified': True}).encode()
                raise AssertionError(f'unexpected Production read: {path}')

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            release = root / installed
            release.mkdir()
            (release / '.verified').touch()
            current = root / 'current-formal'
            current.symlink_to(release, target_is_directory=True)
            state = root / 'monitor.json'
            state.write_text(json.dumps({'status': 'uncertain-write', 'serving': installed}))
            metrics = sample()
            metrics['release'] = monitor.observe_release(current, state, Production())
            _, since = evaluate(metrics, {}, {}, 1000)
            self.assertEqual(metrics['release']['status'], 'uncertain-write')
            self.assertIn('version-lag', evaluate(metrics, {}, since, 2800)[0])

    def test_version_lag_escalates_even_when_backup_already_alerted(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'delivery.json'
            messages = []

            def accepted(pending, _config):
                messages.append(pending['conditions'])
                return 'receipt'

            notify(path, ['daily-backup-failed'], {}, 1000, accepted)
            notify(path, ['daily-backup-failed', 'version-lag'], {}, 2800, accepted)
            notify(path, ['daily-backup-failed', 'version-lag'], {}, 2860, accepted)
            self.assertEqual(messages, [['daily-backup-failed'], ['daily-backup-failed', 'version-lag']])

    def test_temporary_source_observation_loss_does_not_restart_the_lag_clock(self):
        first = sample()
        first['release'] = {'fresh': True, 'serving': 'old', 'candidate': 'first'}
        _, since = evaluate(first, {}, {}, 1000)
        missed = sample(2800)
        missed['release'] = {'fresh': False, 'serving': 'old'}
        conditions, since = evaluate(missed, first, since, 2800)
        self.assertEqual(conditions, [])
        self.assertEqual(since, {'version-lag': 1000})
        latest = sample(2860)
        latest['release'] = {'fresh': True, 'serving': 'old', 'candidate': 'latest'}
        self.assertEqual(evaluate(latest, missed, since, 2860)[0], ['version-lag'])
        latest['release']['serving'] = 'latest'
        self.assertEqual(evaluate(latest, missed, since, 2860), ([], {}))

    def test_truncated_release_observation_returns_unknown(self):
        class Truncated:
            def get(self, path, limit):
                raise http.client.IncompleteRead(b'{')

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            result = monitor.observe_release(root / 'current', root / 'monitor.json', Truncated())
            self.assertEqual(result, {'fresh': False, 'status': None})

    def test_release_must_stay_converged_through_recovery_confirmation(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'delivery.json'
            messages = []

            def accepted(pending, _config):
                messages.append(pending['conditions'])
                return 'receipt'

            notify(path, ['version-lag'], {}, 1000, accepted)
            notify(path, [], {}, 1060, accepted)
            # The lag clock may have restarted, or Production may have been
            # unavailable. Neither sample proves that the release still matches.
            notify(path, [], {}, 1660, accepted, release_converged=False)
            notify(path, [], {}, 1720, accepted)
            self.assertEqual(messages, [['version-lag']])
            notify(path, [], {}, 2320, accepted)
            self.assertEqual(messages, [['version-lag'], []])

    def test_lag_escalation_survives_an_uncertain_email_and_then_convergence(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'delivery.json'
            deliveries = []

            def send(pending, _config):
                deliveries.append((pending['key'], pending['conditions']))
                if len(deliveries) <= 2:
                    raise TimeoutError()
                return 'receipt'

            with self.assertRaises(TimeoutError):
                notify(path, ['backup-stale'], {}, 1000, send)
            with self.assertRaises(TimeoutError):
                notify(path, ['backup-stale', 'version-lag'], {}, 1060, send)
            notify(path, [], {}, 1120, send)
            notify(path, [], {}, 1180, send)
            self.assertEqual(deliveries[:3], [deliveries[0]] * 3)
            self.assertEqual(deliveries[3][1], ['version-lag'])
            self.assertNotEqual(deliveries[3][0], deliveries[0][0])

    def test_lag_recurring_during_uncertain_recovery_is_delivered(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'delivery.json'
            deliveries = []

            def send(pending, _config):
                deliveries.append(pending['conditions'])
                if len(deliveries) in (2, 3):
                    raise TimeoutError()
                return 'receipt'

            notify(path, ['version-lag'], {}, 1000, send)
            notify(path, [], {}, 1060, send)
            with self.assertRaises(TimeoutError):
                notify(path, [], {}, 1660, send)
            with self.assertRaises(TimeoutError):
                notify(path, ['version-lag'], {}, 3500, send)
            notify(path, [], {}, 3560, send)
            notify(path, [], {}, 3620, send)
            self.assertEqual(deliveries, [['version-lag'], [], [], [], ['version-lag']])

    def test_stalled_business_is_reported_without_completed_http_requests(self):
        m = sample()
        m['business'] = {'ready': False}
        m['processMemory'] = {'available': True, 'current': 3300000000,
                              'high': 3221225472, 'pressureFull10': 62}
        m['http'] = {'available': True, 'incomplete': False, 'groups': {}}
        _, since = evaluate(m, {}, {}, 1000)
        self.assertEqual(evaluate(m, {}, since, 1120)[0],
                         ['business-unavailable', 'runtime-memory-pressure'])
        m['business']['ready'] = True
        m['processMemory']['current'] = 2000000000
        m['processMemory']['pressureFull10'] = 0
        self.assertEqual(evaluate(m, {}, since, 1180), ([], {}))

    def test_low_priority_events_are_recorded_without_mail(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'delivery.json'
            messages = []
            def accepted(p, c):
                messages.append(p['conditions'])
                return 'receipt'
            notify(path, ['http-agent-errors', 'service-canvas-cn-operator', 'cpu-high'], {}, 1000, accepted)
            notify(path, [], {}, 2000, accepted)
            self.assertEqual(messages, [])

    def test_one_incident_does_not_repeat_when_conditions_flap_or_an_hour_passes(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'delivery.json'
            messages = []
            def accepted(p, c):
                messages.append(p['conditions'])
                return 'receipt'
            notify(path, ['diskPct'], {}, 1000, accepted)
            notify(path, ['diskPct', 'runtime-check-failed'], {}, 1060, accepted)
            notify(path, ['diskPct'], {}, 5000, accepted)
            notify(path, [], {}, 5060, accepted)
            notify(path, [], {}, 5240, accepted)
            notify(path, ['diskPct'], {}, 5300, accepted)
            self.assertEqual(messages, [['diskPct']])
            notify(path, ['diskPct', 'disk-critical'], {}, 5360, accepted)
            notify(path, ['diskPct'], {}, 5420, accepted)
            notify(path, ['diskPct', 'disk-critical'], {}, 5480, accepted)
            self.assertEqual(messages, [['diskPct'], ['disk-critical', 'diskPct']])
            notify(path, [], {}, 5540, accepted)
            notify(path, [], {}, 6140, accepted)
            self.assertEqual(messages[-1], [])
            self.assertEqual(len(messages), 3)

    def test_new_backup_and_capacity_failures_are_not_hidden_by_an_open_warning(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'delivery.json'
            messages = []
            def accepted(p, c):
                messages.append(p['conditions'])
                return 'receipt'
            notify(path, ['diskPct'], {}, 1000, accepted)
            notify(path, ['diskPct', 'egress-critical', 'daily-backup-failed'], {}, 1060, accepted)
            notify(path, ['diskPct'], {}, 1120, accepted)
            notify(path, ['diskPct', 'egress-critical', 'daily-backup-failed'], {}, 1180, accepted)
            self.assertEqual(messages, [['diskPct'], ['daily-backup-failed', 'diskPct', 'egress-critical']])

    def test_exposed_internal_port_and_changed_runtime_are_reported_without_contents(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            release, units = root / 'release', root / 'units'
            release.mkdir(); units.mkdir()
            original = b'private binding configuration'
            (release / 'config.capnp').write_bytes(b'changed private configuration')
            # A Worker module beside index.js counts as runtime too.
            (release / 'worker').mkdir()
            (release / 'worker' / 'ab-face.ttf').write_bytes(b'swapped face')
            (release / 'worker' / 'index.js').write_bytes(b'entry')
            (release / 'release.json').write_text(json.dumps({'files': {
                'config.capnp': hashlib.sha256(original).hexdigest(),
                'worker/index.js': hashlib.sha256(b'entry').hexdigest(),
                'worker/ab-face.ttf': hashlib.sha256(b'face').hexdigest()}}))
            (release / 'canvas-cn-formal.service').write_text('expected unit')
            (units / 'canvas-cn-formal.service').write_text('changed unit')
            def run(args, **kwargs):
                if args[0] == 'ss':
                    return SimpleNamespace(stdout='LISTEN 0 10 0.0.0.0:443 0.0.0.0:*\n'
                        'LISTEN 0 10 [::]:443 [::]:*\nLISTEN 0 10 0.0.0.0:8792 0.0.0.0:*\n'
                        'LISTEN 0 10 127.0.0.1:8794 0.0.0.0:*\n')
                return SimpleNamespace(stdout='')
            result = monitor.runtime_checks(release, units, run)
            self.assertEqual(result['unexpectedPublicTcp'], [8792])
            self.assertEqual(result['changed'], ['canvas-cn-formal.service', 'config.capnp', 'worker/ab-face.ttf'])
            self.assertNotIn('private', json.dumps(result))
            m = sample(); m['runtime'] = result
            _, since = evaluate(m, {}, {}, 1000)
            self.assertEqual(evaluate(m, {}, since, 1120)[0], ['public-listener-drift', 'runtime-config-drift'])

    def test_release_archive_does_not_hide_failed_daily_backup(self):
        m = sample()
        m['dailyBackupResult'] = 'exit-code'
        _, since = evaluate(m, {}, {}, 1000)
        self.assertEqual(evaluate(m, {}, since, 1120)[0], ['daily-backup-failed'])
        m['dailyBackupResult'] = 'success'
        self.assertEqual(evaluate(m, {}, since, 1180), ([], {}))

    def test_disk_alert_needs_persistence_and_clears(self):
        m=sample(); m['diskPct']=85
        conditions,since=evaluate(m,{}, {},1000)
        self.assertEqual(conditions,[])
        self.assertEqual(evaluate(m,{},since,1120)[0],['diskPct'])
        self.assertEqual(evaluate(sample(),{},since,1180),([],{}))

    def test_backup_warning_uses_measured_workspace_after_maintenance(self):
        metrics = {**sample(), 'diskPct': 86, 'diskFreeBytes': 14 * 1024**3,
                   'backupRequiredBytes': 9 * 1024**3}
        _, since = evaluate(metrics, {}, {}, 1000)
        self.assertEqual(evaluate(metrics, {}, since, 1300)[0], [])
        metrics['diskFreeBytes'] = 8 * 1024**3
        _, since = evaluate(metrics, {}, {}, 1400)
        self.assertEqual(evaluate(metrics, {}, since, 1700)[0], ['backup-headroom'])
        metrics['backupRunning'] = True
        self.assertEqual(evaluate(metrics, {}, since, 1760)[0], [])
        metrics.update(diskPct=97, diskFreeBytes=512 * 1024**2)
        self.assertIn('disk-critical', evaluate(metrics, {}, {'disk-critical': 1500}, 1760)[0])

    def test_high_egress_and_restart(self):
        old=sample(); new=sample(1060); new['txBytes']=750_000_000
        self.assertEqual(evaluate(new,old,{'egress-critical':900},1060)[0],['egress-critical'])
        self.assertEqual(new['txMbps'],100)
        new=sample(1060); new['boot']='boot-b';new['txBytes']=9_000_000_000
        self.assertEqual(evaluate(new,old,{},1060)[0],[])
        self.assertNotIn('txMbps',new)

    def test_stale_backup_and_failed_tls(self):
        m=sample();m['backupAgeHours']=27;m['certificateDays']=None
        result=evaluate(m,{}, {'backup-stale':800,'certificate-check-failed':800},1000)[0]
        self.assertEqual(result,['backup-stale','certificate-check-failed'])

    def test_uncertain_delivery_reuses_key_and_recovers_once(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'delivery.json'; keys=[]
            def failing(p,c):
                keys.append(p['key']);raise TimeoutError()
            with self.assertRaises(TimeoutError):notify(path,['diskPct'],{},1000,failing)
            def accepted(p,c):keys.append(p['key']);return 'receipt'
            notify(path,['diskPct'],{},1060,accepted)
            self.assertEqual(keys[0],keys[1])
            self.assertEqual(notify(path,['diskPct'],{},1120,accepted),'healthy-or-suppressed')
            self.assertEqual(notify(path,[],{},1180,accepted),'recovery-confirming')
            self.assertEqual(notify(path,[],{},1780,accepted),'accepted-by-mail-service')
            self.assertEqual(notify(path,[],{},1840,accepted),'healthy-or-suppressed')
            self.assertEqual(len(keys),3)
            self.assertEqual(load(path)['accepted'],[])

    def test_expired_uncertain_mail_is_not_resent(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'delivery.json'
            def failing(p,c):raise TimeoutError()
            with self.assertRaises(TimeoutError):notify(path,['diskPct'],{},1000,failing)
            with self.assertRaises(ValueError):notify(path,['diskPct'],{},1000+24*3600,failing)

    def test_stale_sample_does_not_prove_continuous_failure(self):
        m=sample(2000);m['diskPct']=95
        self.assertEqual(evaluate(m,sample(1000),{'diskPct':800},2000)[0],[])

    def test_disk_and_certificate_escalation(self):
        m=sample();m['diskPct']=95;m['certificateDays']=6
        _,since=evaluate(m,{}, {},1000)
        self.assertEqual(evaluate(m,{},since,1120)[0],
                         ['certificate-critical','certificate-expiring','certificate-urgent','disk-critical','diskPct'])

    def test_http_errors_need_volume_and_slow_simulation_is_excluded(self):
        m=sample()
        m['http']={'available':True,'incomplete':False,'groups':{
            'auth':{'requests':20,'serverErrors':5,'histogram':[0,0,0,0,20,0,0,0]},
            'simulation':{'requests':20,'serverErrors':0,'histogram':[0,0,0,0,0,20,0,0]}}}
        _,since=evaluate(m,{}, {},1000)
        self.assertEqual(evaluate(m,{},since,1300)[0],['http-auth-errors','http-auth-slow'])
        m['http']['groups']['auth']['requests']=2
        self.assertEqual(evaluate(m,{},since,1360)[0],[])

    def test_new_candidates_do_not_reset_existing_version_lag(self):
        m=sample();m['release']={'fresh':True,'serving':'a','candidate':'b'}
        _,since=evaluate(m,{}, {},1000)
        m['release']['candidate']='c'
        self.assertEqual(evaluate(m,{},since,2800)[0],['version-lag'])
        m['release']['serving']='c'
        self.assertEqual(evaluate(m,{},since,2860)[0],[])


if __name__=='__main__':unittest.main()
