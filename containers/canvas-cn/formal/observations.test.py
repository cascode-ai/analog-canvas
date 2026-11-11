import json
from pathlib import Path
import tempfile
import unittest
import importlib.util
spec = importlib.util.spec_from_file_location('observations', Path(__file__).with_name('observations.py'))
observations = importlib.util.module_from_spec(spec)
spec.loader.exec_module(observations)
http_window, record_history = observations.http_window, observations.record_history


class ObservationsTests(unittest.TestCase):
    def test_rotated_requests_count_once_and_no_raw_fields_survive(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'ops.log'
            path.with_name('ops.log.1').write_text(json.dumps(dict(at=900, status=500, seconds=2, bytes=100, category='auth', ignored='secret'))+'\n')
            path.write_text(json.dumps(dict(at=950, status=200, seconds=.2, upstream='.05', bytes=300, category='auth'))+'\n')
            window = http_window(path, 1000)
            group = window['groups']['auth']
            self.assertEqual((group['requests'],group['serverErrors'],group['bytes']), (2,1,400))
            self.assertEqual(group['p95UpperSeconds'], 3)
            self.assertEqual(group['upstreamAverageSeconds'], .05)
            self.assertEqual(group['upstreamSamples'], 1)
            self.assertNotIn('secret',json.dumps(window))
            self.assertEqual(http_window(path, 1400)['groups'], {})

    def test_read_limit_reports_incomplete_window(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'ops.log'
            path.write_text((json.dumps(dict(at=950,status=200,seconds=.1,bytes=1,category='page'))+'\n')*30)
            self.assertTrue(http_window(path,1000,limit=300)['incomplete'])

    def test_daily_bytes_do_not_double_count_and_skip_restart(self):
        history={}
        old=dict(at=1000,boot='a',rxBytes=100,txBytes=200)
        new=dict(at=1060,boot='a',rxBytes=200,txBytes=500,memoryPct=10)
        record_history(history,new,old)
        record_history(history,new,old)
        day=history['dailyNetwork']['1970-01-01']
        self.assertEqual((day['rxBytesObserved'],day['txBytesObserved'],day['coveredSeconds']),(100,300,60))
        record_history(history,dict(at=1120,boot='b',rxBytes=10000,txBytes=10000),new)
        self.assertEqual(day['txBytesObserved'],300)
        self.assertEqual(day['gaps'],1)

    def test_midnight_split_and_retention(self):
        history={'fiveMinute':{'0':{}},'dailyNetwork':{'1969-12-31':{}}}
        now=8*86400+30
        old=dict(at=now-60,boot='a',rxBytes=0,txBytes=0)
        new=dict(at=now,boot='a',rxBytes=600,txBytes=1200)
        record_history(history,new,old)
        self.assertEqual(history['dailyNetwork']['1970-01-08']['txBytesObserved'],600)
        self.assertEqual(history['dailyNetwork']['1970-01-09']['txBytesObserved'],600)
        self.assertNotIn('0',history['fiveMinute'])


if __name__=='__main__':unittest.main()
