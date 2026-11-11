"""Read-only host sampling and bounded infrastructure notifications.

Runtime state belongs in /var/lib/canvas-ops-monitor, outside Canvas data.
Network counters include all eth0 traffic; they are NOT billable traffic.
"""
import argparse
import datetime
import json
import os
from pathlib import Path
import shutil
import socket
import ssl
import subprocess
import time
import urllib.request
import uuid
import importlib.util
import hashlib
import ipaddress

_spec = importlib.util.spec_from_file_location('observations', Path(__file__).with_name('observations.py'))
_observations = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_observations)
http_window, record_history = _observations.http_window, _observations.record_history


def save(path, value):
    temp = path.with_suffix('.next')
    with temp.open('w', encoding='utf-8') as stream:
        os.chmod(temp, 0o600)
        json.dump(value, stream)
    os.replace(temp, path)


def load(path):
    return json.loads(path.read_text()) if path.exists() else {}


def runtime_checks(release=Path('/opt/analog-canvas/current-formal'),
                   units=Path('/etc/systemd/system'), run=subprocess.run):
    """Observe listeners and release-owned config; never expose config bodies."""
    try:
        release = release.resolve()
        listeners = run(['ss', '-H', '-lnt'], capture_output=True, text=True, check=True, timeout=5)
        exposed, https = set(), set()
        for line in listeners.stdout.splitlines():
            address, port = line.split()[3].rsplit(':', 1)
            address = address.strip('[]').split('%')[0]
            ip = None if address == '*' else ipaddress.ip_address(address)
            if ip is not None and ip.is_loopback:
                continue
            if int(port) not in (22, 443):
                exposed.add(int(port))
            if int(port) == 443:
                https.add(ip.version if ip else 0)
        manifest = load(release / 'release.json')['files']
        changed = []
        for name in ('config.capnp', 'artifact-storage.capnp', 'worker/index.js', 'egress.mjs'):
            if name in manifest:
                path = release / name
                if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != manifest[name]:
                    changed.append(name)
        for name in ('canvas-cn-formal.service', 'canvas-cn-project-sync.service',
                     'canvas-cn-resource-sync.service', 'canvas-cn-analytics-sync.service'):
            expected, installed = release / name, units / name
            if not expected.is_file():
                continue
            if not installed.is_file() or expected.read_bytes() != installed.read_bytes():
                changed.append(name)
            overrides = run(['systemctl', 'show', name, '--property=DropInPaths', '--value'],
                            capture_output=True, text=True, check=True, timeout=5)
            if overrides.stdout.strip():
                changed.append(name + ':override')
        return {'available': True, 'unexpectedPublicTcp': sorted(exposed),
                'httpsFamilies': sorted(https), 'changed': sorted(changed)}
    except (OSError, ValueError, KeyError, IndexError, TypeError, AttributeError, subprocess.SubprocessError):
        return {'available': False}


def collect():
    now = time.time()
    memory = {line.split(':')[0]: int(line.split()[1]) for line in
              Path('/proc/meminfo').read_text().splitlines()
              if line.startswith(('MemTotal:', 'MemAvailable:'))}
    disk = shutil.disk_usage('/')
    fs = os.statvfs('/')
    cpu = [int(x) for x in Path('/proc/stat').read_text().splitlines()[0].split()[1:9]]
    metrics = {
        'at': now, 'boot': Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
        'cpuTotal': sum(cpu), 'cpuIdle': cpu[3] + cpu[4],
        'memoryPct': 100 * (1 - memory['MemAvailable'] / memory['MemTotal']),
        'diskPct': 100 * disk.used / (disk.used + disk.free),
        'diskFreeBytes': disk.free,
        'inodePct': 100 * (1 - fs.f_favail / fs.f_files) if fs.f_files else 0,
        'rxBytes': int(Path('/sys/class/net/eth0/statistics/rx_bytes').read_text()),
        'txBytes': int(Path('/sys/class/net/eth0/statistics/tx_bytes').read_text()),
    }
    metrics['services'] = {}
    for name in ['canvas-cn-formal', 'canvas-cn-ingress', 'nginx', 'canvas-cn-operator']:
        result = subprocess.run(['systemctl', 'is-active', name], capture_output=True,
                                text=True, timeout=5)
        metrics['services'][name] = result.returncode == 0
    backups = [p for p in Path('/var/backups/analog-canvas-formal').glob('*/state.tar.gz')
               if p.stat().st_size > 0 and (p.parent / 'state.sha256').is_file()
               and (p.parent / 'release.json').is_file()]
    metrics['backupAgeHours'] = (now - max(p.stat().st_mtime for p in backups)) / 3600 if backups else None
    result = subprocess.run(['systemctl', 'show', 'canvas-cn-formal-backup.service',
                             '--property=Result', '--value'], capture_output=True,
                            text=True, timeout=5)
    metrics['dailyBackupResult'] = result.stdout.strip() if result.returncode == 0 else 'unavailable'
    try:
        with socket.create_connection(('127.0.0.1', 443), timeout=5) as connection:
            with ssl.create_default_context().wrap_socket(
                    connection, server_hostname='analog-canvas.tokenzhang.com') as tls:
                metrics['certificateDays'] = (ssl.cert_time_to_seconds(tls.getpeercert()['notAfter']) - now) / 86400
    except (OSError, ValueError):
        metrics['certificateDays'] = None
    metrics['http'] = http_window(Path('/var/log/nginx/canvas-ops.log'), now)
    metrics['runtime'] = runtime_checks()
    try:
        release = load(Path('/var/lib/canvas-cn-release/monitor.json'))
        candidate = (release.get('pending') or {}).get('commit')
        metrics['release'] = {'serving': release.get('serving'), 'candidate': candidate,
                              'fresh': 0 <= now - release.get('lastAttemptAt', 0) <= 180,
                              'status': release.get('status')}
    except (OSError, ValueError, TypeError, AttributeError):
        metrics['release'] = {'fresh': False}
    return metrics


def evaluate(metrics, previous, since, now):
    """Return sustained conditions; changing boot or a long gap resets rate baselines."""
    raw = {}
    runtime = metrics.get('runtime')
    if runtime is not None:
        if not runtime.get('available'):
            raw['runtime-check-failed'] = 120
        else:
            if runtime['unexpectedPublicTcp'] or runtime['httpsFamilies'] != [4, 6]:
                raw['public-listener-drift'] = 120
            if runtime['changed']:
                raw['runtime-config-drift'] = 120
    for key, threshold in [('diskPct', 80), ('inodePct', 80), ('memoryPct', 90)]:
        if metrics[key] >= threshold:
            raw[key] = 120
    if metrics['diskPct'] >= 90:
        raw['disk-critical'] = 120
    if metrics['backupAgeHours'] is None or metrics['backupAgeHours'] > 26:
        raw['backup-stale'] = 120
    if metrics.get('dailyBackupResult', 'success') != 'success':
        raw['daily-backup-failed'] = 120
    if metrics['certificateDays'] is None:
        raw['certificate-check-failed'] = 120
    elif metrics['certificateDays'] < 30:
        raw['certificate-expiring'] = 120
        if metrics['certificateDays'] < 14:
            raw['certificate-urgent'] = 120
        if metrics['certificateDays'] < 7:
            raw['certificate-critical'] = 120
    for service, active in metrics['services'].items():
        if not active:
            raw['service-' + service] = 120
    release = metrics.get('release', {})
    if (release.get('fresh') and release.get('serving') and release.get('candidate')
            and release['serving'] != release['candidate']):
        # A new upstream candidate cannot hide a region which never catches up.
        raw['version-lag'] = 1800
    http = metrics.get('http')
    if http is not None:
        if not http['available']:
            raw['http-monitor-missing'] = 120
        elif http['incomplete']:
            raw['http-monitor-backlog'] = 300
        for category, group in http['groups'].items():
            count = group['requests']
            if count < 20:
                continue
            if group['serverErrors'] >= 5 and group['serverErrors'] / count >= .1:
                raw['http-' + category + '-errors'] = 120
            # Do not treat long simulation/Agent calls or downloads as slow APIs.
            if category in {'auth', 'projects', 'gallery', 'api-other'}:
                slower_than_three = sum(group['histogram'][4:])
                if slower_than_three / count >= .2:
                    raw['http-' + category + '-slow'] = 300
    elapsed = now - previous.get('at', now)
    if previous and (metrics['boot'] != previous.get('boot') or elapsed > 180 or elapsed < 0):
        since = {}
    if metrics['boot'] == previous.get('boot') and 10 <= elapsed <= 180:
        total = metrics['cpuTotal'] - previous['cpuTotal']
        idle = metrics['cpuIdle'] - previous['cpuIdle']
        if total > 0 and 0 <= idle <= total:
            metrics['cpuPct'] = 100 * (1 - idle / total)
            if metrics['cpuPct'] >= 85:
                raw['cpu-high'] = 300
        for direction in ['rx', 'tx']:
            delta = metrics[direction + 'Bytes'] - previous[direction + 'Bytes']
            if delta >= 0:
                metrics[direction + 'Mbps'] = delta * 8 / elapsed / 1_000_000
        # Only transmit throughput is compared with the configured 100 Mbps ceiling.
        if metrics.get('txMbps', 0) >= 70:
            raw['egress-high'] = 300
        if metrics.get('txMbps', 0) >= 90:
            raw['egress-critical'] = 120
    sustained = {}
    for condition, delay in raw.items():
        started = since.get(condition, now)
        if not isinstance(started, (float, int)) or not 0 <= started <= now:
            started = now
        sustained[condition] = started
    conditions = sorted(k for k, started in sustained.items() if now - started >= raw[k])
    return conditions, sustained


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def send_pending(pending, config):
    request = urllib.request.Request('https://api.resend.com/emails',
        data=json.dumps({'from': config['from'], 'to': [config['to']],
                         'subject': '[Canvas CN] Infrastructure ' + ('RECOVERED' if not pending['conditions'] else 'WARNING'),
                         'text': 'Host: canvas-cn-prod-01\nConditions: ' +
                                 (', '.join(pending['conditions']) or 'healthy') +
                                 '\nInspect /var/lib/canvas-ops-monitor/monitor.json.\nNo automatic remediation was performed.'}).encode(),
        headers={'Authorization': 'Bearer ' + config['apiKey'], 'Content-Type': 'application/json',
                 'Idempotency-Key': pending['key'], 'User-Agent': 'Canvas-Ops-Monitor/1'})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(request, timeout=15) as response:
        raw = response.read(8193)
        if response.status != 200 or len(raw) > 8192:
            raise ValueError('invalid-mail-response')
        receipt = json.loads(raw)
        if not isinstance(receipt.get('id'), str) or not receipt['id']:
            raise ValueError('missing-mail-receipt')
        return receipt['id']


def notify(path, conditions, config, now, sender=send_pending):
    state = load(path)
    previous = state.get('accepted', [])
    if 'pending' not in state:
        if not conditions and previous:
            state.setdefault('healthySince', now)
            save(path, state)
            if now - state['healthySince'] < 120:
                return 'recovery-confirming'
        else:
            state.pop('healthySince', None)
        if conditions == previous and (not conditions or now - state.get('lastSent', 0) < 3600):
            save(path, state)
            return 'healthy-or-suppressed'
        state['pending'] = {'key': 'canvas-ops-' + str(uuid.uuid4()),
                            'created': now, 'conditions': conditions}
        save(path, state)
    pending = state['pending']
    if not 0 <= now - pending['created'] < 23 * 3600:
        raise ValueError('delivery-uncertain-reconcile-required')
    receipt = sender(pending, config)
    state.update(accepted=pending['conditions'], lastSent=now, receipt=receipt)
    state.pop('pending')
    state.pop('healthySince', None)
    save(path, state)
    return 'accepted-by-mail-service'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--state-dir', required=True)
    parser.add_argument('--config')
    parser.add_argument('--sample-only', action='store_true')
    args = parser.parse_args()
    root = Path(args.state_dir)
    try:
        previous = load(root / 'sample.json')
        metrics = collect()
        conditions, since = evaluate(metrics, previous.get('metrics', {}), previous.get('since', {}), metrics['at'])
        history = record_history(load(root / 'history.json'), metrics, previous.get('metrics', {}))
        save(root / 'history.json', history)
        save(root / 'sample.json', {'metrics': metrics, 'since': since})
        save(root / 'monitor.json', {'checkedAt': metrics['at'], 'conditions': conditions,
             'pendingConditions': sorted(since), 'metrics': metrics, 'billingTraffic': False})
        outcome = 'sample-only'
        if not args.sample_only:
            config = load(Path(args.config))
            if any(not isinstance(config.get(k), str) or not config[k].strip()
                   or '\n' in config[k] or '\r' in config[k] for k in ['apiKey', 'from', 'to']):
                raise ValueError('invalid-mail-config')
            outcome = notify(root / 'delivery.json', conditions, config, metrics['at'])
        print(json.dumps({'conditions': conditions, 'notification': outcome}))
        return 0
    except Exception as error:
        # Never print exception text: HTTP/config errors can contain credentials.
        print(json.dumps({'error': type(error).__name__}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
