import tempfile
import unittest
import hashlib
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
            (release / 'release.json').write_text(json.dumps({'files': {
                'config.capnp': hashlib.sha256(original).hexdigest()}}))
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
            self.assertEqual(result['changed'], ['canvas-cn-formal.service', 'config.capnp'])
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
