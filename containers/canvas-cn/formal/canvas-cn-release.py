#!/usr/bin/env python3
"""Install the release Production serves, after it has stayed live long enough.

Production publishes /regional-release/current.json with every deploy. This
runner follows it: once a commit has been served for --settle-seconds (past
Production's own verification and rollback), it downloads only changed files,
checks every SHA-256 and required credential, backs up the stopped state,
switches the release, smoke-tests it and switches back on failure. It never
changes state directories, credentials or switches; a failed install leaves
the previous release serving and reports through its monitor file.
"""
import argparse
import concurrent.futures
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import time
import urllib.error
import urllib.request

SHA = re.compile(r'^[0-9a-f]{40}$')
SAFE_PATH = re.compile(r'^(?!.*\.\.)[A-Za-z0-9_@+\-./]+$')
SWITCHES = {'project-writes-enabled', 'resource-writes-enabled'}
SYNC_TIMERS = ['canvas-cn-project-sync.timer', 'canvas-cn-resource-sync.timer']
# Only these timers start by themselves when a release first ships them;
# replication timers stay an operator's decision.
AUTO_TIMERS = {'canvas-cn-scheduled.timer', 'canvas-cn-release.timer', 'canvas-cn-release-alert.timer'}
NGINX_SITE = '/etc/nginx/conf.d/analog-canvas-formal.conf'
# Written into a release only after it passed its smoke checks while serving.
VERIFIED = '.verified'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class ReleaseError(Exception):
    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


def sha256(data):
    return hashlib.sha256(data).hexdigest()


class Fetcher:
    def __init__(self, origin, timeout=60):
        if not re.match(r'^https://[A-Za-z0-9.-]+$', origin):
            raise ValueError('HTTPS origin required')
        self.origin = origin
        self.timeout = timeout
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def get(self, path, limit=64 * 1024 * 1024):
        request = urllib.request.Request(self.origin + path, headers={
            'Accept-Encoding': 'identity',
            'User-Agent': 'Analog-Canvas-Regional-Release/1',
        })
        with self.opener.open(request, timeout=self.timeout) as response:
            data = response.read(limit + 1)
        if len(data) > limit:
            # A missing release file answers with the editor shell.
            raise ReleaseError('transport-or-invalid-status')
        return data


def source_of(manifest, path):
    """The Production path a release file is fetched from (longest prefix).

    A source may name the file as `{path}`; root files carry a suffix there so
    Production's HTML handling cannot redirect them.
    """
    for prefix in sorted(manifest['sources'], key=len, reverse=True):
        if path.startswith(prefix):
            source, rest = manifest['sources'][prefix], path[len(prefix):]
            return source.replace('{path}', rest) if '{path}' in source else source + rest
    raise ReleaseError('release-failed')


def read_current(fetcher):
    try:
        current = json.loads(fetcher.get('/regional-release/current.json', 4096))
    except ValueError:
        raise ReleaseError('transport-or-invalid-status')
    commit = current.get('commit') if isinstance(current, dict) else None
    if not isinstance(commit, str) or not SHA.match(commit):
        raise ReleaseError('transport-or-invalid-status')
    if current.get('manifest') != f'/regional-release/{commit}/release.json':
        raise ReleaseError('transport-or-invalid-status')
    return current


def read_manifest(fetcher, current):
    commit = current['commit']
    text = fetcher.get(current['manifest'], 8 * 1024 * 1024)
    if sha256(text) != current.get('sha256'):
        raise ReleaseError('release-failed')
    manifest = json.loads(text)
    if manifest.get('schemaVersion') != 1 or manifest.get('commit') != commit:
        raise ReleaseError('release-failed')
    for path, digest in manifest['files'].items():
        if not SAFE_PATH.match(path) or path.startswith('/') or not re.match(r'^[0-9a-f]{64}$', digest):
            raise ReleaseError('release-failed')
    return commit, manifest, text


def required_credentials(config_text):
    return sorted(set(re.findall(r'embed "/([A-Za-z0-9_.-]+)"', config_text)))


def check_credentials(config_text, credentials):
    for name in required_credentials(config_text):
        path = credentials / name
        if not path.is_file():
            raise ReleaseError('release-failed')
        if name in SWITCHES and path.read_text() not in ('true', 'false'):
            raise ReleaseError('release-failed')


def assemble(fetcher, manifest, current, target, workers=6):
    """Copy unchanged files from the serving release; download the rest."""
    known = {}
    old = current / 'release.json'
    if old.is_file():
        for path, digest in json.loads(old.read_text()).get('files', {}).items():
            if (current / path).is_file():
                known.setdefault(digest, current / path)

    def place(item):
        path, digest = item
        destination = target / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        local = known.get(digest)
        if local is not None and sha256(local.read_bytes()) == digest:
            shutil.copyfile(local, destination)
            return 0
        data = fetcher.get(source_of(manifest, path))
        if sha256(data) != digest:
            raise ReleaseError('release-failed')
        destination.write_bytes(data)
        return len(data)

    with concurrent.futures.ThreadPoolExecutor(workers) as pool:
        return sum(pool.map(place, manifest['files'].items()))


class Host:
    """The privileged operations; replaced in tests."""

    def __init__(self, run=subprocess.run):
        self.run = run

    def systemctl(self, *args, check=True):
        return self.run(['systemctl', *args], check=check, capture_output=True)

    def active(self, unit):
        return self.systemctl('is-active', '--quiet', unit, check=False).returncode == 0

    def backup(self, release):
        self.run(['bash', str(release / 'formal-backup.sh')], check=True, capture_output=True)

    def nginx_reload(self):
        self.run(['nginx', '-t'], check=True, capture_output=True)
        self.run(['systemctl', 'reload', 'nginx'], check=True, capture_output=True)


def switch(link, target):
    temporary = link.with_name(link.name + '.next')
    if temporary.is_symlink() or temporary.exists():
        temporary.unlink()
    temporary.symlink_to(target)
    os.replace(temporary, link)


def install_units(release, unit_dir, host, changed, added):
    """Copy changed units, recording each before it is written."""
    units = sorted(release.glob('canvas-cn-*.service')) + sorted(release.glob('canvas-cn-*.timer'))
    for unit in (u for u in units if u.is_file()):
        installed = unit_dir / unit.name
        if installed.is_file() and installed.read_bytes() == unit.read_bytes():
            continue
        (changed if installed.is_file() else added).append(unit.name)
        shutil.copyfile(unit, installed)
    if changed or added:
        host.systemctl('daemon-reload')


def smoke(local, credentials, attempts=30, delay=2):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    inbound = (credentials / 'sync-inbound-token').read_text().strip()
    checks = [
        ('/', None, lambda r, b: b'<div id="root"' in b),
        ('/api/agent/mcp-manifest.json', None, lambda r, b: json.loads(b).get('version')),
        ('/api/project-sync/status', inbound, lambda r, b: json.loads(b).get('origin') == 'cn'),
    ]
    for attempt in range(attempts):
        try:
            for path, token, ok in checks:
                headers = {'Authorization': 'Bearer ' + token} if token else {}
                with opener.open(urllib.request.Request(local + path, headers=headers), timeout=20) as response:
                    if response.status != 200 or not ok(response, response.read(1024 * 1024)):
                        raise ValueError(path)
            return True
        except (OSError, ValueError, urllib.error.URLError):
            time.sleep(delay)
    return False


def save(path, value):
    temporary = path.with_suffix('.next')
    with temporary.open('w', encoding='utf-8') as output:
        os.chmod(temporary, 0o600)
        json.dump(value, output)
    os.replace(temporary, path)


def tick(args, host=None, fetcher=None, now=None):
    host = host or Host()
    fetcher = fetcher or Fetcher(args.origin)
    now = time.time() if now is None else now
    state_path = pathlib.Path(args.state)
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    current = pathlib.Path(args.current)
    serving = current.resolve()
    record = serving / 'release.json'
    installed = json.loads(record.read_text()).get('commit') if record.is_file() else None
    credentials = pathlib.Path(args.credentials)
    if not (serving / VERIFIED).exists():
        # A runner stopped between switch and smoke left this release unproved.
        previous = state.get('previous')
        if smoke(args.local, credentials, attempts=args.smoke_attempts):
            (serving / VERIFIED).write_text('')
        elif previous and pathlib.Path(previous).is_dir() and pathlib.Path(previous) != serving:
            switch(current, pathlib.Path(previous))
            host.systemctl('restart', 'canvas-cn-formal.service', check=False)
            return {'health': 'failed', 'reason': 'release-rolled-back', 'status': 'rolled-back',
                    'serving': None, 'lastAttemptAt': now, 'failedCommit': installed,
                    'failedReason': 'release-rolled-back'}
        else:
            raise ReleaseError('release-failed')
    published = read_current(fetcher)
    commit = published['commit']
    result = {'health': 'ok', 'reason': None, 'serving': installed, 'lastAttemptAt': now}
    if commit == installed:
        return dict(result, status='current', lastCaughtUpAt=now)
    if state.get('failedCommit') == commit:
        return dict(result, health='failed', reason=state.get('failedReason', 'release-failed'),
                    status='refused', failedCommit=commit, failedReason=state.get('failedReason'))
    pending = state.get('pending') or {}
    if pending.get('commit') != commit:
        pending = {'commit': commit, 'firstSeen': now}
    if now - pending['firstSeen'] < args.settle_seconds:
        return dict(result, status='settling', pending=pending, lastCaughtUpAt=state.get('lastCaughtUpAt', now))
    commit, manifest, text = read_manifest(fetcher, published)
    releases = pathlib.Path(args.releases).resolve()
    target = releases / commit
    partial = releases / (commit + '.partial')
    shutil.rmtree(partial, ignore_errors=True)
    partial.mkdir(parents=True)
    downloaded = assemble(fetcher, manifest, serving, partial)
    (partial / 'release.json').write_bytes(text)
    check_credentials((partial / 'config.capnp').read_text(), credentials)
    if target.exists():
        shutil.rmtree(target)
    partial.rename(target)
    unit_dir = pathlib.Path(args.unit_dir)
    saved_units = {p.name: p.read_bytes() for p in unit_dir.glob('canvas-cn-*') if p.is_file()}
    site = pathlib.Path(NGINX_SITE)
    nginx_before = site.read_bytes() if site.exists() else None
    paused = [timer for timer in SYNC_TIMERS if host.active(timer)]
    for timer in paused:
        host.systemctl('stop', timer, check=False)
    changed, added, operator_restarted = [], [], False
    try:
        try:
            host.backup(target)
        except Exception:
            # Nothing is switched yet; do not stop the runtime again each minute.
            return dict(result, health='failed', reason='release-failed', status='backup-failed',
                        failedCommit=commit, failedReason='release-failed')
        try:
            # Persisted before switching, so an interrupted runner can roll back.
            save(state_path, dict(state, previous=str(serving), installing=commit))
            install_units(target, unit_dir, host, changed, added)
            nginx_new = (target / 'nginx.conf').read_bytes()
            if nginx_new != nginx_before:
                site.write_bytes(nginx_new)
                host.nginx_reload()
            switch(current, target)
            if 'canvas-cn-operator.service' in changed:
                operator_restarted = True
                host.systemctl('restart', 'canvas-cn-operator.service')
            host.systemctl('restart', 'canvas-cn-formal.service')
            ok = smoke(args.local, credentials, attempts=args.smoke_attempts)
        except Exception:
            ok = False
        if ok:
            (target / VERIFIED).write_text('')
            for unit in added:
                if unit in AUTO_TIMERS:
                    host.systemctl('enable', '--now', unit, check=False)
            prune(releases, keep={target, serving}, count=args.keep)
            return dict(result, status='installed', serving=commit, previous=str(serving),
                        downloadedBytes=downloaded, lastCaughtUpAt=now)
        # Restore the serving release exactly: link, units, nginx site, processes.
        switch(current, serving)
        for name in changed + added:
            if name not in saved_units:
                (unit_dir / name).unlink(missing_ok=True)
        for name, data in saved_units.items():
            (unit_dir / name).write_bytes(data)
        host.systemctl('daemon-reload', check=False)
        if site.exists() and site.read_bytes() != nginx_before:
            if nginx_before is None:
                site.unlink()
            else:
                site.write_bytes(nginx_before)
            try:
                host.nginx_reload()
            except Exception:
                pass
        if operator_restarted:
            host.systemctl('restart', 'canvas-cn-operator.service', check=False)
        host.systemctl('restart', 'canvas-cn-formal.service', check=False)
        restored = smoke(args.local, credentials, attempts=args.smoke_attempts)
        return dict(result, health='failed', reason='release-rolled-back' if restored else 'release-failed',
                    status='rolled-back', failedCommit=commit, failedReason='release-rolled-back')
    finally:
        for timer in paused:
            host.systemctl('start', timer, check=False)


def prune(releases, keep, count):
    keep = {p.resolve() for p in keep}
    candidates = sorted((p for p in releases.iterdir() if p.is_dir() and p.resolve() not in keep
                         and not p.name.endswith('.partial')), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in candidates[max(count - len(keep), 0):]:
        shutil.rmtree(old, ignore_errors=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--origin', default='https://analog-canvas.tokenzhang.com')
    parser.add_argument('--local', default='http://127.0.0.1:8792')
    parser.add_argument('--current', default='/opt/analog-canvas/current-formal')
    parser.add_argument('--releases', default='/opt/analog-canvas/formal-releases')
    parser.add_argument('--credentials', default='/etc/analog-canvas-formal')
    parser.add_argument('--unit-dir', default='/etc/systemd/system')
    parser.add_argument('--state', required=True)
    parser.add_argument('--settle-seconds', type=int, default=600)
    parser.add_argument('--smoke-attempts', type=int, default=30)
    parser.add_argument('--keep', type=int, default=10)
    args = parser.parse_args()
    state_path = pathlib.Path(args.state)
    previous = {}
    try:
        previous = json.loads(state_path.read_text()) if state_path.exists() else {}
    except (OSError, ValueError):
        pass
    try:
        result = tick(args)
    except ReleaseError as error:
        result = {'health': 'failed', 'reason': error.reason, 'lastAttemptAt': time.time()}
    except (OSError, ValueError, TypeError, KeyError, subprocess.CalledProcessError, urllib.error.URLError):
        # Bodies and paths may contain upstream payloads; report the class only.
        result = {'health': 'failed', 'reason': 'transport-or-invalid-status', 'lastAttemptAt': time.time()}
    for key in ['lastCaughtUpAt', 'failedCommit', 'failedReason', 'pending', 'previous']:
        if key not in result and key in previous:
            result[key] = previous[key]
    save(state_path, result)
    print(json.dumps(result))
    return 0 if result['health'] == 'ok' else 1


if __name__ == '__main__':
    raise SystemExit(main())
